// server/audit/nginx-host-labels.cjs - Nginx Hub > Envanter: sunucuya elle etiket (2026-11-12).
//
// Kullanici: "sunuculari istedigim gibi label'layabilir miyim? oto kesif yapmistik conf.d/ altindaki
// dosyalarin ismine bakiyorduk ama benim overwrite edebilecegim sekilde bir feature mi yapsak?"
//
// OTOMATIK KESIF: nginx_metadata betigi conf.d/*.conf adlarindan `services` yazar (5'ten fazlaysa
// 'too_many'). ELLE ETIKET Portal DB'de (nginx_host_labels) tutulur; TBMWANS tablosuna DOKUNULMAZ
// (her kosuda TRUNCATE edilir, elle deger orada yasayamaz). Iki kip:
//   degistir - otomatik listenin YERINE gecer (too_many dahil; kullanici tam listeyi verir)
//   ekle     - otomatik listeye eklenir (otomatik kesif surer, elle etiket ustune biner)
// Otomatik liste satirda `etiket.oto` olarak KALIR: ekran ikisini birlikte gosterir (elle deger
// otomatigi sessizce silmesin; kesif degisirse fark gorunsun).
'use strict';

const HOST_RE = /^[A-Z0-9._-]{1,64}$/;
const ETIKET_RE = /^[A-Za-z0-9._-]{1,64}$/;
const MODLAR = new Set(['degistir', 'ekle']);
const EN_COK_ETIKET = 20;

function bol(v) {
  return String(v == null ? '' : v)
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Istek govdesini dogrular. Hata metni ya da { mod, etiketler, not } doner. */
function dogrula(govde) {
  const mod = String(govde?.mod || 'degistir');
  if (!MODLAR.has(mod)) return { hata: 'Kip geçersiz (degistir | ekle).' };
  const ham = Array.isArray(govde?.etiketler) ? govde.etiketler.flatMap(bol) : bol(govde?.etiketler);
  const etiketler = [...new Set(ham)];
  if (!etiketler.length) return { hata: 'En az bir etiket gerekli.' };
  if (etiketler.length > EN_COK_ETIKET) return { hata: `En çok ${EN_COK_ETIKET} etiket.` };
  const kotu = etiketler.find((e) => !ETIKET_RE.test(e) || e.toLowerCase() === 'too_many');
  if (kotu) return { hata: `Etiket geçersiz: "${kotu.slice(0, 64)}" (harf, rakam, . _ - ; en çok 64).` };
  const not = String(govde?.not || '').trim().slice(0, 500) || null;
  return { mod, etiketler, not };
}

/**
 * Etiketleri envanter satirlarina uygular (SAF; satirlar kopyalanir).
 * @param rows dbo.nginx_inventory satirlari
 * @param etiketler Map<HOST, { mod, etiketler: string[], not, by, at }>
 */
function etiketUygula(rows, etiketler) {
  if (!etiketler || !etiketler.size) return rows;
  return rows.map((r) => {
    const e = etiketler.get(String(r.hostname || '').trim().toUpperCase());
    if (!e) return r;
    const oto = bol(r.services);
    const etkin = e.mod === 'ekle' ? [...new Set([...oto, ...e.etiketler])] : [...e.etiketler];
    return {
      ...r,
      services: etkin.join(','),
      service_count: etkin.includes('too_many') ? r.service_count : etkin.length,
      etiket: { mod: e.mod, etiketler: e.etiketler, not: e.not || null, by: e.by || null, at: e.at || null, oto },
    };
  });
}

/** Portal DB'den tum etiketler: Map<HOST, kayit>. */
async function etiketleriOku(db) {
  const r = await db.query(
    `SELECT host, kip, etiketler, note, updated_by, updated_at FROM nginx_host_labels`,
    [],
  );
  const m = new Map();
  for (const x of r.rows || []) {
    m.set(String(x.host).toUpperCase(), {
      mod: MODLAR.has(x.kip) ? x.kip : 'degistir',
      etiketler: bol(x.etiketler),
      not: x.note || null,
      by: x.updated_by || null,
      at: x.updated_at ? new Date(x.updated_at).toISOString() : null,
    });
  }
  return m;
}

async function etiketYaz(db, host, { mod, etiketler, not }, by) {
  const ex = await db.query(`SELECT 1 FROM nginx_host_labels WHERE host = $1`, [host]);
  if ((ex.rows || []).length) {
    await db.query(
      `UPDATE nginx_host_labels SET kip = $2, etiketler = $3, note = $4, updated_by = $5, updated_at = GETUTCDATE() WHERE host = $1`,
      [host, mod, etiketler.join(','), not, by],
    );
  } else {
    await db.query(
      `INSERT INTO nginx_host_labels (host, kip, etiketler, note, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5)`,
      [host, mod, etiketler.join(','), not, by],
    );
  }
}

async function etiketSil(db, host) {
  await db.query(`DELETE FROM nginx_host_labels WHERE host = $1`, [host]);
}

module.exports = { HOST_RE, dogrula, etiketUygula, etiketleriOku, etiketYaz, etiketSil, _bol: bol };
