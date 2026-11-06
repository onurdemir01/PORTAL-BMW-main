// server/server-hub/retire-etiket.cjs - Retirement etiketleri (2026-11-06; saf, birim testli).
//
// Kullanici: "Kesin olarak retire edilecek teknoloji de retirement tagi olsun supheli olan da";
// "retiere etiketi ayri olsun bulgular ayri olsun retiere etiketi koyma kismi vs de admin tarafindan
// editlenebilir olsun"; "eger uygulama tier2 ise ona gore ayri ayri inceleme tier3 ise birlikte
// inceleme eslenik durumuna gore inceleme"; "Manuel kontrol de gerekecek".
//
// GIRDI: assess() sunuculari (h.retireAdaylari bulgudan ayri uretilir), Admin kural seviyeleri
// (ayarlar.etiketler: R1..R5 -> KESIN | SUPHELI | KAPALI) ve kayitli manuel kontroller.
//
// KONU + ORTAM BASINA TEK ETIKET. Konu:
//   JVM   ad + JBoss nesli (7 ve 8 kopyasi ayri: 8'e tasinmis uygulamanin 7 kopyasi tam da retire
//         konusudur; diger nesildeki calisan kopya not olarak yazilir, etiketi dusurmez)
//   EAR   diskteki EAR adi + nesil (/vhosting = 7, /vhosting8 = 8)
//   GIRDI kokteki .ear disi girdi adi + kok
// ESLENIK KOPYALAR BIRLIKTE: ayni ortamda ayni konunun TUM kopyalari (aday olsun olmasin) zincire
// girer. Uygulama sunucusu -> o JVM'in web sunuculari (ayni makine = 2 katman, A->W / Web-App = 3
// katman; assess'in j.vhosts eslemesi) -> trafik. KESIN su durumlarda SUPHELI'ye iner ve NEDENI yazilir:
// bir kopya calisiyor ya da calismasi olculemedi, bir kopyanin web katmaninda trafik var, trafik
// olculemedi / web katmani eslenemedi, retire kaniti eksik (assess retireEngeli), tarama bayat.
//
// MANUEL KONTROL: kayit KANIT IMZASINA baglidir (kopyalarin durumu + kurallar). Imza degisirse kayit
// "veri degisti, yeniden kontrol" olur. YANLIS_ALARM etiketi varsayilan listeden cikarir (ayri suzgec).
// Yalniz KESIN + DOGRULANDI etiket Retirement akisina gonderilebilir (retirementHazir).
'use strict';

const crypto = require('node:crypto');
const { ETIKET_KURALLARI } = require('./kural-katalogu.cjs');

const KURAL = new Map(ETIKET_KURALLARI.map((k) => [k.kural, k]));
const SIRA = { KESIN: 2, SUPHELI: 1, KAPALI: 0 };
const L = (s) =>
  String(s || '')
    .trim()
    .toLowerCase();
const U = (s) =>
  String(s || '')
    .trim()
    .toUpperCase();
const nesilOfKok = (kok) =>
  /\/vhosting8\/?$/.test(String(kok || ''))
    ? '8'
    : /\/vhosting\/?$/.test(String(kok || ''))
      ? '7'
      : '?';
const iz = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);

/** Konu anahtari (manuel kontrolun anahtari da budur). */
function anahtarOf(a, ortam) {
  if (a.tur === 'JVM') return `JVM|${U(a.ad)}|${ortam}|${Number(a.gen) || 0}`;
  if (a.tur === 'EAR') return `EAR|${U(a.ad)}|${ortam}|${nesilOfKok(a.kok)}`;
  return `GIRDI|${a.ad}|${ortam}|${a.kok}`;
}

/** JVM kopyasi: zincirin bir halkasi (sunucu -> web -> trafik). */
function jvmKopyasi(h, j, adaylar) {
  return {
    host: h.host,
    gen: Number(j.gen) || 0,
    calisiyor: j.runningKnown === false ? null : !!j.running,
    autoStart: j.autoStart || 'unknown',
    trafik: j.trafficState || null,
    esleme: j.mapping || 'NOT_MAPPED',
    tier: j.tier == null ? null : String(j.tier),
    taze: h.fresh !== false,
    taramaTarihi: h.scanDate || null,
    web: (j.vhosts || []).slice(0, 10).map((m) => ({
      host: m.host,
      vhost: (m.v && m.v.serverName) || m.serverName || '',
      trafik: (m.v && m.v.trafficState) || m.trafficState || null,
      istek7g: m.v ? (m.v.req7d == null ? null : m.v.req7d) : m.req7d == null ? null : m.req7d,
      log: (m.v && m.v.accessLog) || '',
      tur: m.kind || null,
    })),
    kurallar: adaylar.map((a) => a.kural).sort(),
    engel: (adaylar.find((a) => a.engel) || {}).engel || null,
  };
}

/** Konu -> kopyalar (ayni ortamdaki TUM kopyalar; aday olmayan kopya da zincire girer). */
function kopyalariTopla(konu, hostlar, adayIndeksi) {
  const { tur, ortam } = konu;
  const out = [];
  for (const h of hostlar) {
    if (h.env !== ortam) continue;
    const ada = (adayIndeksi.get(h.host) || []).filter((a) => anahtarOf(a, ortam) === konu.anahtar);
    if (tur === 'JVM') {
      for (const j of h.jvms || [])
        if (L(j.name) === L(konu.ad) && (Number(j.gen) || 0) === konu.gen)
          out.push(jvmKopyasi(h, j, ada));
    } else if (tur === 'EAR') {
      const ear = h.ear && h.ear.durum === 'VAR' ? h.ear : null;
      for (const u of (ear && ear.uygulamalar) || [])
        if (U(u.ad) === U(konu.ad) && nesilOfKok(u.kok) === konu.nesil)
          out.push({
            host: h.host,
            kok: u.kok,
            durum: u.durum,
            warSayisi: u.warSayisi,
            xml: u.xml ? u.xml.durum : null,
            xmlNeden: u.xml ? u.xml.neden || null : null,
            jvmler: ((u.xml && u.xml.jvmler) || []).map((x) => {
              const sj = (h.jvms || []).find((j) => L(j.name) === L(x.ad));
              return {
                ad: x.ad,
                autoStart: x.auto_start !== false,
                calisiyor: !sj ? null : sj.runningKnown === false ? null : !!sj.running,
              };
            }),
            taranma: ear.taranma || null,
            kurallar: ada.map((a) => a.kural).sort(),
          });
    } else {
      const ear = h.ear && h.ear.durum === 'VAR' ? h.ear : null;
      if (!ear) continue;
      for (const a of ada)
        out.push({
          host: h.host,
          kok: a.kok,
          tip: a.tip || '?',
          hedef: a.hedef || null,
          taranma: ear.taranma || null,
          kurallar: [a.kural],
        });
    }
  }
  return out.sort(
    (a, b) =>
      a.host.localeCompare(b.host) || String(a.kok || '').localeCompare(String(b.kok || '')),
  );
}

/** KESIN'i SUPHELI'ye indiren zincir nedenleri (bos dizi = kesin kalir). */
function zincirNedenleri(konu, kopyalar, kurallar) {
  const n = [];
  if (konu.tur === 'JVM') {
    for (const k of kopyalar) {
      if (k.calisiyor === null) n.push(`${k.host}: çalışma durumu ölçülemedi`);
      else if (k.calisiyor) n.push(`${k.host}: eşlenik kopya çalışıyor`);
      if (!k.taze) n.push(`${k.host}: tarama bayat (${k.taramaTarihi || '?'})`);
    }
    // R1 trafik yok iddiasidir: her kopyanin web katmani olculmus ve bos olmali.
    if (kurallar.includes('R1'))
      for (const k of kopyalar) {
        if (k.trafik === 'ACTIVE') n.push(`${k.host}: web katmanında trafik var`);
        else if (k.trafik === 'UNREADABLE' || k.trafik === 'UNVERIFIED')
          n.push(`${k.host}: trafik ölçülemedi`);
        else if (k.trafik !== 'NO_RECENT_TRAFFIC')
          n.push(`${k.host}: web katmanı eşlenemedi (${k.esleme})`);
        if (k.engel) n.push(`${k.host}: retire kanıtı eksik — ${k.engel}`);
      }
  } else if (konu.tur === 'EAR') {
    for (const k of kopyalar) {
      const calisan = k.jvmler.filter((j) => j.calisiyor === true).map((j) => j.ad);
      if (calisan.length) n.push(`${k.host}: çalışan JVM'e bağlı (${calisan.join(', ')})`);
      if (kurallar.includes('R3') && k.warSayisi > 0)
        n.push(`${k.host}: bu kopyada ${k.warSayisi} WAR var`);
      if (kurallar.includes('R5') && k.xml === 'VAR') n.push(`${k.host}: bu kopya JVM'e bağlı`);
      if (k.xml === 'OLCULEMEDI') n.push(`${k.host}: JBoss yapılandırması okunamadı`);
    }
  }
  return [...new Set(n)];
}

/** Kanit imzasi: kopyalarin karar veren alanlari + kurallar (sayilar ve tarihler GIRMEZ). */
function kanitImzasi(konu, kopyalar, kurallar) {
  const satir = (k) =>
    konu.tur === 'JVM'
      ? [k.host, k.gen, k.calisiyor, k.autoStart, k.trafik, k.esleme, !!k.engel, k.taze]
      : konu.tur === 'EAR'
        ? [
            k.host,
            k.kok,
            k.durum,
            k.warSayisi,
            k.xml,
            k.xmlNeden,
            k.jvmler.map((j) => [j.ad, j.calisiyor]),
          ]
        : [k.host, k.kok, k.tip, k.hedef];
  return iz({ anahtar: konu.anahtar, kurallar, kopyalar: kopyalar.map(satir) });
}

/**
 * @param {{ hosts: object[], kurallar?: Record<string,string>, kontroller?: Map<string,object>|null }} g
 *   kontroller null = kayitlar OKUNAMADI (etiketler yine cikar, hicbiri dogrulanmis sayilmaz)
 * @returns {{ etiketler: object[], ozet: object }}
 */
function etiketle({ hosts, kurallar = {}, kontroller = new Map() }) {
  const seviyeOf = (kural) => kurallar[kural] || (KURAL.get(kural) || {}).varsayilan || 'KAPALI';
  const hostlar = (hosts || []).filter((h) => !h.taramadanDustu);
  const adayIndeksi = new Map();
  const konular = new Map();
  for (const h of hostlar) {
    const ada = (h.retireAdaylari || []).filter(
      (a) => KURAL.has(a.kural) && seviyeOf(a.kural) !== 'KAPALI',
    );
    adayIndeksi.set(h.host, ada);
    for (const a of ada) {
      const anahtar = anahtarOf(a, h.env);
      if (!konular.has(anahtar))
        konular.set(anahtar, {
          anahtar,
          tur: a.tur,
          ad: a.ad,
          ortam: h.env,
          gen: a.tur === 'JVM' ? Number(a.gen) || 0 : null,
          nesil: a.tur === 'EAR' ? nesilOfKok(a.kok) : null,
          kok: a.tur === 'GIRDI' ? a.kok : null,
          kurallar: new Set(),
        });
      konular.get(anahtar).kurallar.add(a.kural);
    }
  }
  const etiketler = [];
  for (const konu of konular.values()) {
    const kl = [...konu.kurallar].sort();
    const ham = kl.reduce((m, k) => (SIRA[seviyeOf(k)] > SIRA[m] ? seviyeOf(k) : m), 'KAPALI');
    const kopyalar = kopyalariTopla(konu, hostlar, adayIndeksi);
    const nedenler = zincirNedenleri(konu, kopyalar, kl);
    const seviye = ham === 'KESIN' && nedenler.length ? 'SUPHELI' : ham;
    // Diger nesildeki kopya (JVM): tasinma isareti, etiketi dusurmez.
    const notlar = [];
    if (konu.tur === 'JVM')
      for (const h of hostlar)
        if (h.env === konu.ortam)
          for (const j of h.jvms || [])
            if (
              L(j.name) === L(konu.ad) &&
              (Number(j.gen) || 0) !== konu.gen &&
              j.running &&
              j.runningKnown !== false
            )
              notlar.push(
                `${h.host}: JBoss ${j.gen} kopyası çalışıyor — uygulama taşınmış olabilir`,
              );
    const imza = kanitImzasi(konu, kopyalar, kl);
    const kayit = kontroller ? kontroller.get(konu.anahtar) || null : null;
    const durum = !kontroller
      ? 'BILINMIYOR'
      : !kayit
        ? 'BEKLIYOR'
        : kayit.imza !== imza
          ? 'VERI_DEGISTI'
          : kayit.sonuc;
    etiketler.push({
      anahtar: konu.anahtar,
      tur: konu.tur,
      ad: konu.ad,
      ortam: konu.ortam,
      gen: konu.gen,
      nesil: konu.nesil,
      kok: konu.kok,
      seviye,
      hamSeviye: ham,
      kurallar: kl,
      nedenler,
      notlar: [...new Set(notlar)],
      tier: konu.tur === 'JVM' ? [...new Set(kopyalar.map((k) => k.tier).filter(Boolean))] : [],
      hostlar: [...new Set(kopyalar.map((k) => k.host))],
      kopyalar,
      imza,
      kontrol: kayit,
      durum,
      retirementHazir: seviye === 'KESIN' && durum === 'DOGRULANDI',
    });
  }
  etiketler.sort(
    (a, b) =>
      SIRA[b.seviye] - SIRA[a.seviye] ||
      a.ortam.localeCompare(b.ortam) ||
      a.tur.localeCompare(b.tur) ||
      U(a.ad).localeCompare(U(b.ad)),
  );
  const say = (f) => etiketler.filter(f).length;
  return {
    etiketler,
    ozet: {
      toplam: etiketler.length,
      kesin: say((e) => e.seviye === 'KESIN'),
      supheli: say((e) => e.seviye === 'SUPHELI'),
      dusurulen: say((e) => e.hamSeviye === 'KESIN' && e.seviye !== 'KESIN'),
      bekliyor: say((e) => e.durum === 'BEKLIYOR' || e.durum === 'VERI_DEGISTI'),
      dogrulandi: say((e) => e.durum === 'DOGRULANDI'),
      yanlisAlarm: say((e) => e.durum === 'YANLIS_ALARM'),
      retirementHazir: say((e) => e.retirementHazir),
    },
  };
}

module.exports = { etiketle, anahtarOf, kanitImzasi, zincirNedenleri, nesilOfKok };
