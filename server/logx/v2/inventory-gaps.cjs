// server/logx/v2/inventory-gaps.cjs — ENVANTER BOSLUKLARI.
//
// NEDEN VAR: LogX legacy'de envanterde olmayan bir uygulama/sunucu ELLE girilebiliyor
// ve is calisiyor — ama o ad envantere YAZILMIYOR (kullanici karari: oraya yalnizca
// duzenli tarama yazar, bkz. legacy-inventory-readonly.test.cjs).
//
// Bu dogru bir karar, ama DONGUYU ACIK BIRAKIYORDU: elle girilen ad denetim kaydina
// yazilip orada kaliyordu. Hangi adlarin HALA envantere girmedigini kimse bilmiyordu.
// Ayni adi her hafta yeniden yazan bir kullanici sessizce yeniden yazmaya devam eder
// ve envanterdeki bosluk hic kapanmaz.
//
// Bu modul o denetim kayitlarini okunabilir bir listeye cevirir ve HER AD ICIN
// SIMDIKI durumu CANLI sorar: hala yok mu, yoksa tarama artik eklemis mi.
//
// UC HAL, IKI DEGIL:
//   hala_yok          envanter OKUNDU, ad yok            -> gercek bosluk
//   envantere_girdi   envanter OKUNDU, ad var            -> dongu kapandi
//   kontrol_edilemedi envanter OKUNAMADI                 -> BILINMIYOR
//
// Ucuncu hal pazarlik konusu degil: envanter/DB okunamadiginda bir adi "hala yok"
// diye isaretlemek, bilinmezligi suclama olarak yazmaktir. Ekranda kirmizi bir
// "eksik" rozeti gorup envantere el ile kayit acan biri, aslinda VAR OLAN bir
// kaydi ikinci kez olusturabilirdi.
'use strict';

const db = require('../../db/index.cjs');

const MANUAL_ACTIONS = ['v2_legacy_manual_app', 'v2_legacy_manual_host'];

/**
 * Denetim `detail` alanini cozer. Bicim `server/logx/v2/index.cjs` tarafindan
 * YAZILIR ve sabittir:
 *
 *   v2_legacy_manual_app   ->  "app=<AD> jobId=<N>"
 *   v2_legacy_manual_host  ->  "app=<AD> hosts=<A,B,C> jobId=<N>"
 *
 * Doner: { app, hosts: string[] }. Cozulemeyen satir icin `null` — sessizce
 * yanlis bir ad uretmektense o satiri atlamak dogru.
 */
function parseManualDetail(action, detail) {
  const text = String(detail || '');
  const app = (text.match(/\bapp=([^\s]+)/) || [])[1] || '';
  if (!app) return null;

  if (action === 'v2_legacy_manual_host') {
    const raw = (text.match(/\bhosts=([^\s]+)/) || [])[1] || '';
    const hosts = raw
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    if (!hosts.length) return null;
    return { app, hosts };
  }
  return { app, hosts: [] };
}

/** Denetim satirlarini ad basina toplar. Saf fonksiyon — dogrudan test edilir. */
function aggregate(rows) {
  const byKey = new Map();

  for (const r of rows || []) {
    const parsed = parseManualDetail(r.action, r.detail);
    if (!parsed) continue;

    // Bir denetim satiri BIR uygulama ya da N sunucu tasir.
    const items =
      r.action === 'v2_legacy_manual_host'
        ? parsed.hosts.map((h) => ({ kind: 'host', name: h, app: parsed.app }))
        : [{ kind: 'app', name: parsed.app, app: parsed.app }];

    for (const it of items) {
      const key = `${it.kind}:${it.app.toUpperCase()}:${it.name.toUpperCase()}`;
      const at = r.created_at ? new Date(r.created_at) : null;
      const cur = byKey.get(key);
      if (!cur) {
        byKey.set(key, {
          kind: it.kind,
          name: it.name.toUpperCase(),
          app: it.app.toUpperCase(),
          count: 1,
          users: new Set(r.username ? [r.username] : []),
          firstSeen: at,
          lastSeen: at,
        });
        continue;
      }
      cur.count++;
      if (r.username) cur.users.add(r.username);
      if (at && (!cur.firstSeen || at < cur.firstSeen)) cur.firstSeen = at;
      if (at && (!cur.lastSeen || at > cur.lastSeen)) cur.lastSeen = at;
    }
  }

  return [...byKey.values()].map((g) => ({
    kind: g.kind,
    name: g.name,
    app: g.app,
    count: g.count,
    userCount: g.users.size,
    users: [...g.users].sort(),
    firstSeen: g.firstSeen ? g.firstSeen.toISOString() : null,
    lastSeen: g.lastSeen ? g.lastSeen.toISOString() : null,
  }));
}

/**
 * Bir grubun SIMDIKI envanter durumu.
 *
 * `legacy.cjs`'in MEVCUT okuma fonksiyonlari yeniden kullanilir — envanteri okumanin
 * ikinci bir yolu yazilmaz; yoksa iki yol zamanla ayrisir ve ekran, sihirbazin
 * gordugunden BASKA bir gercek gosterir.
 */
async function resolveStatus(group, legacy) {
  try {
    if (group.kind === 'app') {
      const found = await legacy.searchApps(group.name);
      // FALLBACK MODU BIR CEVAP DEGIL: snapshot, envanterin SON BILINEN halidir.
      // Ondan "hala yok" sonucu cikarmak, bayat veriyi kanit saymaktir.
      if (found && found.fallbackMode) return 'kontrol_edilemedi';
      const var_mi = (found.apps || []).some(
        (a) => String(a).toUpperCase() === group.name.toUpperCase(),
      );
      return var_mi ? 'envantere_girdi' : 'hala_yok';
    }

    const hosts = await legacy.resolveHostsForApp(group.app, false);
    // `resolveHostsForApp` bos dizi donerse bu "uygulamanin sunucusu yok" demektir;
    // ayirt edilemedigi icin durum BILINMIYOR sayilmaz — sorgu BASARILI oldu.
    const var_mi = (hosts || []).some((h) => String(h).toUpperCase() === group.name.toUpperCase());
    return var_mi ? 'envantere_girdi' : 'hala_yok';
  } catch {
    // Envanter/DB okunamadi. "hala_yok" DEMEYIZ.
    return 'kontrol_edilemedi';
  }
}

/** Ekranin okudugu tam liste. */
async function listGaps({ limit = 2000 } = {}) {
  const { rows } = await db.query(
    `SELECT TOP (${Number(limit) || 2000}) username, action, detail, created_at
       FROM logx_audit_logs
      WHERE action IN ('${MANUAL_ACTIONS.join("','")}')
      ORDER BY created_at DESC`,
  );

  const groups = aggregate(rows);
  const legacy = require('./legacy.cjs');
  const out = [];
  for (const g of groups) {
    out.push({ ...g, status: await resolveStatus(g, legacy) });
  }

  // EN UZUN SUREDIR EKSIK OLAN ONCE: hala_yok > kontrol_edilemedi > envantere_girdi,
  // sonra ilk gorulme tarihine gore eskiden yeniye.
  const rank = { hala_yok: 0, kontrol_edilemedi: 1, envantere_girdi: 2 };
  out.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      String(a.firstSeen || '').localeCompare(String(b.firstSeen || '')),
  );
  return out;
}

module.exports = { parseManualDetail, aggregate, resolveStatus, listGaps, MANUAL_ACTIONS };
