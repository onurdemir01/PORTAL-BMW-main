// server/server-hub/toplu-cekirdek.cjs - Toplu Auto-Start ve Toplu Restart'in ORTAK cekirdegi (2026-11-24).
//
// Iki modul ayni tablolari (server_hub_toplu_isler / server_hub_toplu_ogeler, `tur` kolonu) ve ayni yasam
// dongusunu kullanir: SECIM (istekle yazilir) -> taze dogrulama -> ADAY -> plan / onizleme -> PLAN_HAZIR ->
// onay (15 dk) -> CALISIYOR -> BITTI / BITTI_HATALI; iptal, plan eskimesi, kira ve YARIM_KALDI. Bu kod iki
// dosyada kopyaydi (Sonar CPD ~1000 satir); burada tek kez yazilir. Modul farklari parametredir: tur, log
// etiketi, denetim kodu oneki, limit anahtari, bitis durumlari, sayim kolonlarinin durumlari ve kullaniciya
// giden metinler. DAVRANIS DEGISMEDI: SQL metinleri ve mesajlar modullerdeki halleriyle birebir aynidir
// (testlerin sahte DB'si SQL'i yorumlar; ekran mesajlari testlerde sabit).
//
// Modulun kendine ozgu kismi (aday turetme, secim dogrulamasinin kapilari, plan / onizleme isleri, uygulama
// adimi, adaylar ucu) modulde kalir; cekirdek onlari kanca olarak alir (planIlerlet, uygulaIlerlet, yarimEk,
// tickSonra).
'use strict';

const { hataYanitlayici } = require('../util/nginx-red.cjs');

const db = () => require('../db/index.cjs');

const M = (v, n) => String(v == null ? '' : v).slice(0, n);
const IN = (l) => l.map((x) => `'${x}'`).join(', ');
const hata = (status, message, code) => Object.assign(new Error(message), { status, code });
const iso = (v) => (v ? new Date(v).toISOString() : null);
const ogeAnahtari = (host, gen, jvm) =>
  `${String(host || '').toUpperCase()}|${Number(gen)}|${String(jvm || '').toLowerCase()}`;
const sureAsti = (bas, ms) => bas && Date.now() - new Date(bas).getTime() > ms;
const kimOf = (req) => M(req.session?.user?.username || 'unknown', 128);

const JVM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HOST_RE_VARSAYILAN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
const OLUSTURULUYOR = 'OLUSTURULUYOR';
const SECIM = 'SECIM';

/** Yurutucunun AWX'e ve denetime "kim istedi" diye verecegi sozde istek. */
function sozdeIstek(kim) {
  const ad = M(kim, 128) || 'unknown';
  return {
    session: { user: { username: ad, displayName: ad, role: 'Admin' } },
    sessionID: null,
    ip: null,
  };
}

/** En cok n esli calisan fn; sonuc sirasi liste sirasi. */
async function sinirliParalel(liste, n, fn) {
  const out = new Array(liste.length);
  let sonraki = 0;
  const isci = async () => {
    while (sonraki < liste.length) {
      const k = sonraki;
      sonraki += 1;
      out[k] = await fn(liste[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, liste.length) }, isci));
  return out;
}

function isSatiri(r) {
  if (!r) return null;
  return {
    id: r.id,
    durum: r.durum,
    olusturan: r.olusturan,
    onaylayan: r.onaylayan || null,
    iptalEden: r.iptal_eden || null,
    ustSinir: r.ust_sinir,
    aday: r.aday,
    planGecti: r.plan_gecti,
    dusen: r.dusen,
    ok: r.ok_sayisi,
    skip: r.skip_sayisi,
    fail: r.fail_sayisi,
    hata: r.hata || null,
    createdAt: iso(r.created_at),
    planBitisAt: iso(r.plan_bitis_at),
    onayAt: iso(r.onay_at),
    bitisAt: iso(r.bitis_at),
  };
}

/**
 * Modulun cekirdegi. cfg:
 *   tur ('AUTOSTART' | 'RESTART'), etiket (log oneki), op (denetim kodu oneki), yurutucu (sozde istek adi),
 *   limitAnahtari, deps (() => mount'ta verilen bagimliliklar), surecId, kiraSn, pollSn, planYasMs,
 *   aktif / yuruyen (is durumlari), secimZamanAsimiMs, secimYenidenMs,
 *   bitisDurumlari (bitis_at yazilan oge durumlari), sayim ({ dusen, ok, skip } SQL kosullari),
 *   sayimAdlari ({ ok, skip }: denetim alanlari), metin ({...} kullaniciya giden metinler),
 *   planOkunamadiRe (plan hic okunamadi sayilan DUSTU nedenleri),
 *   kancalar: planIlerlet(is, og, iptalMi), uygulaIlerlet(is, og) -> bitti mi, yarimEk(is), tickSonra().
 */
function topluCekirdek(cfg) {
  const { tur, etiket, op, metin } = cfg;
  const secimSonraki = new Map();
  let timer = null;
  let ticking = false;

  const d = () => cfg.deps();
  const hostRe = () => d()?.HOST_RE || HOST_RE_VARSAYILAN;
  const autoStart = () => {
    const x = d();
    return x && typeof x.autoStart === 'function' ? x.autoStart() : null;
  };

  function denetim(req, detail) {
    try {
      const x = d();
      if (x?.audit) x.audit(req, detail);
    } catch {
      // denetim kaydi yazilamadi: islem yine tamam
    }
  }

  // ── DB ─────────────────────────────────────────────────────────────────────────────────────────

  async function aktifIs() {
    const { rows } = await db().query(
      `SELECT TOP 1 * FROM server_hub_toplu_isler WHERE tur = $1 AND durum IN (${IN(cfg.aktif)}) ORDER BY id DESC`,
      [tur],
    );
    return rows?.[0] || null;
  }

  async function isOku(id) {
    const { rows } = await db().query(
      `SELECT * FROM server_hub_toplu_isler WHERE id = $1 AND tur = $2`,
      [id, tur],
    );
    return rows?.[0] || null;
  }

  async function ogeler(isId) {
    const { rows } = await db().query(
      `SELECT * FROM server_hub_toplu_ogeler WHERE is_id = $1 ORDER BY sira`,
      [isId],
    );
    return rows || [];
  }

  /** Is satirinin sayimlarini ogelerden yeniden hesaplar (kolonlarin durumlari modulden: cfg.sayim). */
  async function sayimYaz(isId) {
    await db().query(
      `UPDATE server_hub_toplu_isler SET
        aday = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1),
        plan_gecti = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum NOT IN ('SECIM', 'ADAY', 'PLANLANIYOR', 'DUSTU')),
        dusen = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum ${cfg.sayim.dusen}),
        ok_sayisi = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum = '${cfg.sayim.ok}'),
        skip_sayisi = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum = '${cfg.sayim.skip}'),
        fail_sayisi = (SELECT COUNT(*) FROM server_hub_toplu_ogeler WHERE is_id = $1 AND durum = 'FAIL')
      WHERE id = $1`,
      [isId],
    );
  }

  /** Kira: yalniz bu surec, kendi kirasini yeniler. Donus: true (bizde). */
  async function kiraYenile(isId) {
    const r = await db().query(
      `UPDATE server_hub_toplu_isler SET kira_bitis = DATEADD(second, ${cfg.kiraSn}, SYSUTCDATETIME())
      WHERE id = $1 AND kira_id = $2`,
      [isId, cfg.surecId],
    );
    return r.rowCount === 1;
  }

  /** Ogeye durum yaz; yalniz beklenen durumdaysa (CAS). */
  async function ogeDurum(id, eski, yeni, alanlar = {}) {
    const set = ['durum = $2'];
    const p = [id, yeni];
    for (const [k, v] of Object.entries(alanlar)) {
      p.push(v);
      set.push(`${k} = $${p.length}`);
    }
    if (cfg.bitisDurumlari.includes(yeni)) set.push('bitis_at = SYSUTCDATETIME()');
    p.push(...eski);
    const kosul = eski.map((_, i) => `$${p.length - eski.length + i + 1}`).join(', ');
    const r = await db().query(
      `UPDATE server_hub_toplu_ogeler SET ${set.join(', ')} WHERE id = $1 AND durum IN (${kosul})`,
      p,
    );
    return r.rowCount === 1;
  }

  // ── OLUSTUR ────────────────────────────────────────────────────────────────────────────────────

  /**
   * Secimin ortak bicim kapilari (sunucu adi, JVM adi, gen, tekrar) + limit. ogeyiDuzle(x, temel): modulun
   * kendi alanlari (or. eylem); tekrar denetiminden ONCE cagrilir (hata sirasi modullerdeki gibi).
   */
  function secimiDuzle(secim, enCok, ogeyiDuzle = (_x, temel) => temel) {
    if (!Array.isArray(secim) || !secim.length) throw hata(400, 'En az bir JVM seçilmeli.');
    if (secim.length > enCok)
      throw hata(
        400,
        `${metin.tekIs} en fazla ${enCok} JVM (${secim.length} seçildi; Admin Server Hub › Kurallar & Limitler'den artırabilir).`,
        'limit',
      );
    const gorulen = new Set();
    const out = [];
    for (const x of secim) {
      const host = String(x?.host || '')
        .trim()
        .toUpperCase();
      const jvm = String(x?.jvm || '').trim();
      const gen = Number(x?.gen);
      if (!hostRe().test(host)) throw hata(400, `Geçersiz sunucu adı: ${M(host, 64) || '(boş)'}`);
      if (!JVM_RE.test(jvm)) throw hata(400, `Geçersiz JVM adı: ${M(jvm, 64) || '(boş)'}`);
      if (gen !== 7 && gen !== 8) throw hata(400, `Geçersiz JBoss sürümü (gen): ${host}/${jvm}`);
      const oge = ogeyiDuzle(x, { host, jvm, gen });
      const k = ogeAnahtari(host, gen, jvm);
      if (gorulen.has(k)) throw hata(400, `Aynı JVM iki kez seçilmiş: ${host}/${jvm}`);
      gorulen.add(k);
      out.push(oge);
    }
    return out;
  }

  /** Aktif is varsa 409 (ayni turden tek aktif is). */
  async function aktifIsYok() {
    const akt = await aktifIs();
    if (akt)
      throw hata(
        409,
        `Toplu ${metin.isAdi} işi #${akt.id} hâlâ aktif (${akt.durum}) — önce o bitmeli ya da iptal edilmeli.`,
        'aktif_is',
      );
  }

  /**
   * Is + ogeler (SECIM) yazilir; taze dogrulama yurutucude. sutunlar: oge kolonlari (is_id, sira, ... ; durum
   * HARIC), deger(c, sira): o kolonlarin degerleri. Donus: is numarasi.
   */
  async function isYaz(req, enCok, secilen, { sutunlar, deger }) {
    const kim = kimOf(req);
    let isId;
    try {
      const r = await db().query(
        `INSERT INTO server_hub_toplu_isler (tur, durum, olusturan, ust_sinir, aday, kira_id, kira_bitis)
       VALUES ($1, 'PLANLANIYOR', $2, $3, $4, $5, DATEADD(second, ${cfg.kiraSn}, SYSUTCDATETIME())) RETURNING id`,
        [tur, kim, enCok, secilen.length, OLUSTURULUYOR],
      );
      isId = r.rows?.[0]?.id;
    } catch (e) {
      // UX_shti_aktif: eszamanli ikinci olusturma
      if (/UX_shti_aktif|duplicate key|UNIQUE/i.test(String(e?.message)))
        throw hata(
          409,
          `Başka bir toplu ${metin.isAdi} işi az önce açıldı — sayfayı yenileyin.`,
          'aktif_is',
        );
      throw e;
    }
    if (!isId) throw hata(500, 'Toplu iş kaydı oluşturulamadı.');
    const n = sutunlar.length;
    try {
      // 2100 parametre siniri: 100'luk parcalar.
      for (let i = 0; i < secilen.length; i += 100) {
        const parca = secilen.slice(i, i + 100);
        const p = [];
        const v = parca.map((c, j) => {
          p.push(...deger(c, isId, i + j + 1));
          const b = p.length - n;
          return `(${Array.from({ length: n }, (_, k) => '$' + (b + k + 1)).join(', ')}, '${SECIM}')`;
        });
        await db().query(
          `INSERT INTO server_hub_toplu_ogeler (${sutunlar.join(', ')}, durum) VALUES ${v.join(', ')}`,
          p,
        );
      }
      await db().query(
        `UPDATE server_hub_toplu_isler SET kira_id = $2 WHERE id = $1 AND kira_id = $3`,
        [isId, cfg.surecId, OLUSTURULUYOR],
      );
    } catch (e) {
      await db()
        .query(
          `UPDATE server_hub_toplu_isler SET durum = 'PLAN_HATA', hata = $2, bitis_at = SYSUTCDATETIME() WHERE id = $1`,
          [isId, M(`Öğeler yazılamadı: ${e?.message}`, 1000)],
        )
        .catch(() => {});
      await db()
        .query(
          `UPDATE server_hub_toplu_ogeler SET durum = 'DUSTU', neden = 'kayıt yarım kaldı' WHERE is_id = $1`,
          [isId],
        )
        .catch(() => {});
      throw hata(500, `Toplu iş öğeleri yazılamadı: ${e?.message}`);
    }
    return isId;
  }

  // ── SECIM DOGRULAMASI ──────────────────────────────────────────────────────────────────────────

  /**
   * Dogrulama basarisiz (taze okuma ya da beklenmeyen hata): secimZamanAsimiMs icinde en erken secimYenidenMs
   * sonra yeniden denenir (is hatasinda yazilir), sonra kalan SECIM ogeleri DUSTU (is PLAN_HATA).
   * ne: hatanin turu (kullaniciya giden metin).
   */
  async function secimOkunamadi(is, liste, e, ne = 'Taze değerlendirme okunamadı') {
    const msg = M(e?.message, 300) || 'bilinmeyen hata';
    console.warn(`[${etiket}] is #${is.id} secim dogrulanamadi:`, msg);
    if (sureAsti(is.created_at, cfg.secimZamanAsimiMs)) {
      secimSonraki.delete(is.id);
      for (const o of liste)
        await ogeDurum(o.id, [SECIM], 'DUSTU', {
          neden: M(
            `seçim doğrulanamadı: 10 dakikada başarılamadı — ${ne} (${msg}); JVM'e dokunulmadı`,
            1000,
          ),
        });
      return;
    }
    secimSonraki.set(is.id, Date.now() + cfg.secimYenidenMs);
    await db().query(`UPDATE server_hub_toplu_isler SET hata = $2 WHERE id = $1`, [
      is.id,
      M(`${ne} (${msg}) — yeniden deneniyor; hiçbir JVM'e dokunulmadı.`, 1000),
    ]);
  }

  /**
   * Plan fazinin basi: secim once taze degerlendirmeyle dogrulanir (olustur istegi yalniz secimi yazar);
   * basaramazsa sonraki tick. Beklenmeyen hata da (turetme / DB yazimi) ayni zaman asimina baglidir: is
   * sonsuza dek PLANLANIYOR kalip JVM kilitlerini ve aktif is yuvasini tutamaz. Donus: true (plan surer).
   */
  async function secimAsamasi(is, og, iptalMi, secimDogrula) {
    if (iptalMi || !og.some((o) => o.durum === SECIM)) return true;
    if (Date.now() < (secimSonraki.get(is.id) || 0)) return false;
    let tamam;
    try {
      tamam = await secimDogrula(is, og);
    } catch (e) {
      await secimOkunamadi(
        is,
        og.filter((o) => o.durum === SECIM),
        e,
        'Seçim doğrulaması hata verdi',
      );
      tamam = false;
    }
    if (!tamam) return false;
    secimSonraki.delete(is.id);
    return true;
  }

  /** Dogrulanan secim: hata yaziliysa temizlenir. */
  async function secimHatasiTemizle(is) {
    if (is.hata)
      await db().query(`UPDATE server_hub_toplu_isler SET hata = NULL WHERE id = $1`, [is.id]);
  }

  // ── PLAN SONU / ONAY / IPTAL ───────────────────────────────────────────────────────────────────

  const planEskiMi = (is) =>
    !is.plan_bitis_at || Date.now() - new Date(is.plan_bitis_at).getTime() > cfg.planYasMs;

  /** PLAN_HAZIR -> PLAN_ESKIDI (CAS); PLAN_GECTI ogeler IPTAL (JVM kilitleri kalkar). Onay ve yurutucu ortak. */
  async function planEskit(req, id) {
    const r = await db().query(
      `UPDATE server_hub_toplu_isler SET durum = 'PLAN_ESKIDI', hata = $2, bitis_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'PLAN_HAZIR'`,
      [id, metin.planEskidi],
    );
    if (r.rowCount !== 1) return false;
    await db().query(
      `UPDATE server_hub_toplu_ogeler SET durum = 'IPTAL', neden = '${metin.planEskidiNeden}', bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum = 'PLAN_GECTI'`,
      [id],
    );
    await sayimYaz(id);
    denetim(req, { op: `${op}_plan_eskidi`, id });
    return true;
  }

  /** Plan / onizleme fazi bitti: PLAN_HAZIR ya da (gecen yoksa) PLAN_HATA / BITTI. */
  async function planBitir(is) {
    const og = await ogeler(is.id);
    const gecen = og.filter((o) => o.durum === 'PLAN_GECTI').length;
    const okunamadi = og.filter(
      (o) => o.durum === 'DUSTU' && cfg.planOkunamadiRe.test(o.neden || ''),
    ).length;
    const secimOkunamadiSay = og.filter(
      (o) => o.durum === 'DUSTU' && /^seçim doğrulanamadı/.test(o.neden || ''),
    ).length;
    let durum = 'PLAN_HAZIR';
    let mesaj = null;
    if (!gecen && og.length && secimOkunamadiSay === og.length) {
      durum = 'PLAN_HATA';
      mesaj =
        "Taze değerlendirme okunamadı — seçim doğrulanamadı, hiçbir JVM'e dokunulmadı. Listeyi yenileyip yeniden deneyin.";
    } else if (!gecen && og.length && okunamadi === og.length) {
      durum = 'PLAN_HATA';
      mesaj = metin.planOkunamadi;
    } else if (!gecen) {
      durum = 'BITTI';
      mesaj = metin.planBos;
    }
    const r = await db().query(
      `UPDATE server_hub_toplu_isler SET durum = $2, hata = $3, plan_bitis_at = SYSUTCDATETIME()${durum === 'PLAN_HAZIR' ? '' : ', bitis_at = SYSUTCDATETIME()'}
      WHERE id = $1 AND durum = 'PLANLANIYOR' AND kira_id = $4`,
      [is.id, durum, mesaj, cfg.surecId],
    );
    await sayimYaz(is.id);
    if (r.rowCount === 1 && durum !== 'PLAN_HAZIR')
      denetim(sozdeIstek(is.olusturan), {
        op: `${op}_bitti`,
        id: is.id,
        durum,
        [cfg.sayimAdlari.ok]: 0,
        fail: 0,
        dusen: og.length - gecen,
      });
  }

  /**
   * Onayin ortak kapilari: is var, PLAN_HAZIR, plan 15 dk icinde (eskidiyse PLAN_ESKIDI + 409). Ardindan
   * oncesi (modulun ek kapisi, or. AWX limit denetimi) ve TAZE sema kapisi, limit. Donus: { is, kim, a, byHost,
   * gecen } (gecen: PLAN_GECTI ogeler).
   */
  async function onayHazirla(req, id, oncesi = null) {
    const is = await isOku(id);
    if (!is) throw hata(404, `Toplu iş #${id} yok.`);
    if (is.durum !== 'PLAN_HAZIR')
      throw hata(409, `Toplu iş #${id} onaylanamaz (durum ${is.durum}).`, 'durum');
    const kim = kimOf(req);
    if (planEskiMi(is)) {
      await planEskit(req, id);
      throw hata(409, metin.onayEskidi, 'plan_eskidi');
    }
    if (oncesi) await oncesi();
    // Onay aninda TAZE sema / tazelik kapisi: sunucu bu arada bayatladiysa o sunucunun ogeleri dusurulur.
    const a = await d().getAssessment(true);
    if (a.schemaUnknown === true)
      throw hata(
        400,
        'Server Hub şeması (sys.columns) okunamadı — onay verilmedi; sayfayı yenileyin.',
      );
    const byHost = new Map((a.hosts || []).map((h) => [h.host, h]));
    const og = await ogeler(id);
    const enCok = await d().ayarlar.limit(cfg.limitAnahtari);
    const gecen = og.filter((o) => o.durum === 'PLAN_GECTI');
    if (gecen.length > enCok)
      throw hata(
        400,
        `Limit ${enCok} JVM'e düşürülmüş (${gecen.length} öğe) — yeniden ${metin.planla}.`,
        'limit',
      );
    return { is, kim, a, byHost, gecen };
  }

  /** Onayin sonu: kalan yoksa BITTI (bosMesaj); varsa CALISIYOR (kira bizde), PLAN_GECTI -> BEKLIYOR. */
  async function onayBitir(req, id, kim, kalan, bosMesaj, ekDenetim = {}) {
    if (!kalan) {
      await db().query(
        `UPDATE server_hub_toplu_isler SET durum = 'BITTI', onaylayan = $2, onay_at = SYSUTCDATETIME(), bitis_at = SYSUTCDATETIME(), hata = $3 WHERE id = $1 AND durum = 'PLAN_HAZIR'`,
        [id, kim, bosMesaj],
      );
      await sayimYaz(id);
      denetim(req, { op: `${op}_onay`, id, adet: 0 });
      return { id, adet: 0 };
    }
    const r = await db().query(
      `UPDATE server_hub_toplu_isler SET durum = 'CALISIYOR', onaylayan = $2, onay_at = SYSUTCDATETIME(),
        kira_id = $3, kira_bitis = DATEADD(second, ${cfg.kiraSn}, SYSUTCDATETIME())
      WHERE id = $1 AND durum = 'PLAN_HAZIR'`,
      [id, kim, cfg.surecId],
    );
    if (r.rowCount !== 1)
      throw hata(409, `Toplu iş #${id} bu arada değişti — sayfayı yenileyin.`, 'durum');
    await db().query(
      `UPDATE server_hub_toplu_ogeler SET durum = 'BEKLIYOR' WHERE is_id = $1 AND durum = 'PLAN_GECTI'`,
      [id],
    );
    await sayimYaz(id);
    denetim(req, { op: `${op}_onay`, id, adet: kalan, ...ekDenetim });
    return { id, adet: kalan };
  }

  async function iptal(req, id) {
    const is = await isOku(id);
    if (!is) throw hata(404, `Toplu iş #${id} yok.`);
    const kim = kimOf(req);
    if (is.durum === 'PLAN_HAZIR') {
      const r = await db().query(
        `UPDATE server_hub_toplu_isler SET durum = 'IPTAL', iptal_eden = $2, bitis_at = SYSUTCDATETIME() WHERE id = $1 AND durum = 'PLAN_HAZIR'`,
        [id, kim],
      );
      if (r.rowCount !== 1)
        throw hata(409, `Toplu iş #${id} bu arada değişti — sayfayı yenileyin.`, 'durum');
      await db().query(
        `UPDATE server_hub_toplu_ogeler SET durum = 'IPTAL', neden = 'iptal edildi', bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum IN ('SECIM', 'ADAY', 'PLAN_GECTI', 'BEKLIYOR')`,
        [id],
      );
      await sayimYaz(id);
      denetim(req, { op: `${op}_iptal`, id, durum: 'IPTAL' });
      return { id, durum: 'IPTAL' };
    }
    if (is.durum !== 'PLANLANIYOR' && is.durum !== 'CALISIYOR')
      throw hata(409, `Toplu iş #${id} iptal edilemez (durum ${is.durum}).`, 'durum');
    const r = await db().query(
      `UPDATE server_hub_toplu_isler SET durum = 'IPTAL_ISTENDI', iptal_eden = $2 WHERE id = $1 AND durum IN ('PLANLANIYOR', 'CALISIYOR')`,
      [id, kim],
    );
    if (r.rowCount !== 1)
      throw hata(409, `Toplu iş #${id} bu arada değişti — sayfayı yenileyin.`, 'durum');
    // Bekleyen ogeler hemen IPTAL; suren AWX isi iptal EDILMEZ (bitmesi beklenir, sonucu yazilir).
    await db().query(
      `UPDATE server_hub_toplu_ogeler SET durum = 'IPTAL', neden = 'iptal edildi (çalıştırılmadı)', bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum IN ('SECIM', 'ADAY', 'BEKLIYOR')`,
      [id],
    );
    await sayimYaz(id);
    denetim(req, { op: `${op}_iptal`, id, durum: 'IPTAL_ISTENDI' });
    return { id, durum: 'IPTAL_ISTENDI' };
  }

  // ── YURUTUCU ───────────────────────────────────────────────────────────────────────────────────

  async function uygulaBitir(is) {
    await sayimYaz(is.id);
    const son = await isOku(is.id);
    const iptalMi = son.durum === 'IPTAL_ISTENDI';
    if (iptalMi)
      await db().query(
        `UPDATE server_hub_toplu_ogeler SET durum = 'IPTAL', neden = 'iptal edildi (çalıştırılmadı)', bitis_at = SYSUTCDATETIME() WHERE is_id = $1 AND durum IN ('SECIM', 'ADAY', 'PLAN_GECTI', 'BEKLIYOR')`,
        [is.id],
      );
    await sayimYaz(is.id);
    const s = await isOku(is.id);
    // YARIM_KALDI oge (is numarasi yazilamadi; AWX'e gitmis olabilir) da kirmizidir: yesil "Tamamlandi" onu gizlemez.
    const og = await ogeler(is.id);
    const kirmizi = s.fail_sayisi > 0 || og.some((o) => o.durum === 'YARIM_KALDI');
    let durum = kirmizi ? 'BITTI_HATALI' : 'BITTI';
    if (iptalMi) durum = 'IPTAL';
    const r = await db().query(
      `UPDATE server_hub_toplu_isler SET durum = $2, bitis_at = SYSUTCDATETIME(), kira_id = NULL, kira_bitis = NULL
      WHERE id = $1 AND durum IN ('CALISIYOR', 'IPTAL_ISTENDI', 'PLANLANIYOR') AND kira_id = $3`,
      [is.id, durum, cfg.surecId],
    );
    if (r.rowCount === 1)
      denetim(sozdeIstek(s.onaylayan || s.olusturan), {
        op: `${op}_bitti`,
        id: is.id,
        durum,
        [cfg.sayimAdlari.ok]: s.ok_sayisi,
        [cfg.sayimAdlari.skip]: s.skip_sayisi,
        fail: s.fail_sayisi,
        dusen: s.dusen,
      });
  }

  /**
   * KIRASI DUSMUS aktif is: ILERLETILMEZ (sessiz yeniden kosma yok). Is ve calistirilmamis ogeler YARIM_KALDI;
   * suren ogeler modulun kancasiyla (yarimEk: is numarali ogeler, nedenleri).
   */
  async function yarimBirak(is) {
    const r = await db().query(
      `UPDATE server_hub_toplu_isler SET durum = 'YARIM_KALDI', kira_id = NULL, kira_bitis = NULL, bitis_at = SYSUTCDATETIME(),
        hata = $3
      WHERE id = $1 AND durum = $2 AND (kira_id IS NULL OR kira_id <> $4) AND (kira_bitis IS NULL OR kira_bitis < SYSUTCDATETIME())`,
      [is.id, is.durum, metin.yarimKaldi, cfg.surecId],
    );
    if (r.rowCount !== 1) return;
    await db().query(
      `UPDATE server_hub_toplu_ogeler SET durum = 'YARIM_KALDI', neden = $2, bitis_at = SYSUTCDATETIME()
      WHERE is_id = $1 AND durum IN ('SECIM', 'ADAY', 'PLANLANIYOR', 'PLAN_GECTI', 'BEKLIYOR')`,
      [is.id, 'Portal yeniden başladı — çalıştırılmadı'],
    );
    await cfg.kancalar.yarimEk(is);
    await sayimYaz(is.id);
    denetim(sozdeIstek(cfg.yurutucu), {
      op: `${op}_yarim_kaldi`,
      id: is.id,
      onceki: is.durum,
    });
  }

  async function tick() {
    const x = d();
    if (!x || typeof x.launch !== 'function') return;
    const { rows } = await db().query(
      `SELECT *, CASE WHEN kira_bitis IS NULL OR kira_bitis < SYSUTCDATETIME() THEN 1 ELSE 0 END AS kira_dustu
       FROM server_hub_toplu_isler WHERE tur = $1 AND durum IN (${IN([...cfg.yuruyen, 'PLAN_HAZIR'])}) ORDER BY id`,
      [tur],
    );
    for (const is of rows || []) {
      try {
        // Onay bekleyen is ILERLETILMEZ (kirasi yok sayilir); 15 dk'yi asinca PLAN_ESKIDI olur, kilitler kalkar.
        if (is.durum === 'PLAN_HAZIR') {
          if (planEskiMi(is)) await planEskit(sozdeIstek(cfg.yurutucu), is.id);
          continue;
        }
        if (is.kira_id !== cfg.surecId) {
          if (Number(is.kira_dustu) === 1) await yarimBirak(is);
          continue;
        }
        if (!(await kiraYenile(is.id))) continue;
        let og = await ogeler(is.id);
        const iptalMi = is.durum === 'IPTAL_ISTENDI';
        // Onaylanmamis is PLAN fazindadir (iptal istense de: suren plan isi biter, sonra IPTAL).
        if (is.durum === 'PLANLANIYOR' || (iptalMi && !is.onay_at)) {
          await cfg.kancalar.planIlerlet(is, og, iptalMi);
          og = await ogeler(is.id);
          if (iptalMi) {
            if (!og.some((o) => o.durum === 'PLANLANIYOR')) await uygulaBitir(is);
            else await sayimYaz(is.id);
          } else if (
            !og.some((o) => o.durum === SECIM || o.durum === 'ADAY' || o.durum === 'PLANLANIYOR')
          )
            await planBitir(is);
          else await sayimYaz(is.id);
          continue;
        }
        const bitti = await cfg.kancalar.uygulaIlerlet(is, og);
        if (bitti) await uygulaBitir(is);
        else await sayimYaz(is.id);
      } catch (e) {
        console.warn(`[${etiket}] is #${is.id} ilerletilemedi:`, e?.message);
      }
    }
    if (cfg.kancalar.tickSonra) await cfg.kancalar.tickSonra();
  }

  function startPoller() {
    if (timer) return;
    timer = setInterval(() => {
      if (ticking) return;
      ticking = true;
      tick()
        .catch((e) => console.warn(`[${etiket}] tick hatasi:`, e?.message))
        .finally(() => {
          ticking = false;
        });
    }, cfg.pollSn * 1000);
    if (timer.unref) timer.unref();
    console.log(`[${etiket}] yurutucu basladi (${cfg.pollSn} sn)`);
  }

  function durdur() {
    if (timer) clearInterval(timer);
    timer = null;
    ticking = false;
    secimSonraki.clear();
  }

  // ── UCLAR ──────────────────────────────────────────────────────────────────────────────────────

  // 5xx: kurumsal nginx govdeyi index.html ile degistirir; GET disi isteklerde 424 + upstreamStatus + nginxRed.
  const gonder = hataYanitlayici({ etiket, kod: 'toplu_sunucu_hatasi' });

  const idOf = (req, res) => {
    const id = Number(req.params.id);
    if (Number.isInteger(id) && id > 0) return id;
    res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    return null;
  };

  /**
   * Ortak uclar: GET /<yol> (son 10 is), GET /<yol>/:id, POST /<yol>, POST /<yol>/:id/onayla, POST /<yol>/:id/iptal.
   * u: { yol, isDetay(is, ogeler), olustur(req), onayla(req, id) }. Adaylar ucu modulde.
   */
  function rotalar(router, u) {
    router.get(`/${u.yol}`, async (req, res) => {
      try {
        const { rows } = await db().query(
          `SELECT TOP 10 * FROM server_hub_toplu_isler WHERE tur = $1 ORDER BY id DESC`,
          [tur],
        );
        const akt = (rows || []).find((r) => cfg.aktif.includes(r.durum)) || (await aktifIs());
        res.json({ ok: true, aktif: isSatiri(akt), son: (rows || []).map(isSatiri) });
      } catch (err) {
        gonder(req, res, err);
      }
    });

    router.get(`/${u.yol}/:id`, async (req, res) => {
      const id = idOf(req, res);
      if (id == null) return;
      try {
        const is = await isOku(id);
        if (!is) return res.status(404).json({ ok: false, message: `Toplu iş #${id} yok.` });
        res.json({ ok: true, ...u.isDetay(is, await ogeler(id)) });
      } catch (err) {
        gonder(req, res, err);
      }
    });

    router.post(`/${u.yol}`, async (req, res) => {
      try {
        res.json({ ok: true, ...(await u.olustur(req)) });
      } catch (err) {
        gonder(req, res, err);
      }
    });

    router.post(`/${u.yol}/:id/onayla`, async (req, res) => {
      const id = idOf(req, res);
      if (id == null) return;
      if (req.body?.confirmed !== true)
        return res
          .status(400)
          .json({ ok: false, message: 'Bu işlem açık onay ister (confirmed).' });
      try {
        res.json({ ok: true, ...(await u.onayla(req, id)) });
      } catch (err) {
        gonder(req, res, err);
      }
    });

    router.post(`/${u.yol}/:id/iptal`, async (req, res) => {
      const id = idOf(req, res);
      if (id == null) return;
      try {
        res.json({ ok: true, ...(await iptal(req, id)) });
      } catch (err) {
        gonder(req, res, err);
      }
    });
  }

  return {
    secimSonraki,
    hostRe,
    autoStart,
    denetim,
    aktifIs,
    isOku,
    ogeler,
    sayimYaz,
    kiraYenile,
    ogeDurum,
    secimiDuzle,
    aktifIsYok,
    isYaz,
    secimOkunamadi,
    secimAsamasi,
    secimHatasiTemizle,
    planEskiMi,
    planEskit,
    planBitir,
    onayHazirla,
    onayBitir,
    iptal,
    uygulaBitir,
    yarimBirak,
    tick,
    startPoller,
    durdur,
    gonder,
    rotalar,
  };
}

module.exports = {
  M,
  IN,
  hata,
  iso,
  ogeAnahtari,
  sureAsti,
  kimOf,
  sozdeIstek,
  sinirliParalel,
  isSatiri,
  JVM_RE,
  HOST_RE_VARSAYILAN,
  SECIM,
  topluCekirdek,
};
