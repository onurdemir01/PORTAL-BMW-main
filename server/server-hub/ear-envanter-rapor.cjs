// server/server-hub/ear-envanter-rapor.cjs - Uygulama Envanteri disa aktarimi (2026-11-04).
//
// Kullanici: "human readable olmali bir excel olarak cikti bir zip olarak cikti verebilmeli excel
// cikti .csv olabilir". Uc bicim:
//   CSV  ';' ayracli, UTF-8 BOM'lu (Turkce Excel dogrudan acar). FORMUL ENJEKSIYONU: = + - @ sekme
//        ya da CR ile baslayan metin hucresi "'" onekiyle yazilir (uygulama / dosya adlari uzaktan gelir).
//   tree.txt  ls -lrtiR benzeri: dizin basliklari, dizin icinde mtime artan; inode mod uid gid boyut
//        tarih ad [-> bag]. Arsiv (paketli WAR / EAR) icindeki girisler "ARSIV.war!/yol" bicimindedir.
//   inventory.json  uygulamanin tum alanlari (agac satirlari haric), yapay zeka analizi icin.
// ZIP yeni bagimlilik olmadan server/util/zip-yazici.cjs ile; tum arsiv bellekte, sinirli.
'use strict';

const BOM = '\uFEFF';

function csvHucre(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** kolonlar: [[baslik, (satir) => deger], ...] */
function csv(kolonlar, satirlar) {
  const out = [kolonlar.map(([b]) => csvHucre(b)).join(';')];
  for (const r of satirlar || []) out.push(kolonlar.map(([, f]) => csvHucre(f(r))).join(';'));
  return `${BOM}${out.join('\r\n')}\r\n`;
}

const al = (k) => (r) => r[k];
const evet = (k) => (r) =>
  r[k] === true || r[k] === 1 ? 'evet' : r[k] === false || r[k] === 0 ? 'hayır' : '';
const tarih = (k) => (r) =>
  r[k] ? new Date(r[k]).toISOString().slice(0, 19).replace('T', ' ') : '';

const KOLONLAR = Object.freeze({
  uygulamalar: [
    ['sunucu', al('host')],
    ['ortam', al('ortam')],
    ['jboss', al('jboss')],
    ['kok', al('kok')],
    ['uygulama', al('ad')],
    ['bicim', al('bicim')],
    ['durum', al('durum')],
    ['kip', al('kip')],
    ['war_sayisi', al('war_sayisi')],
    ['spring_boot', al('spring_boot')],
    ['spring_framework', al('spring_framework')],
    ['servlet', al('servlet')],
    ['log4j', al('log4j')],
    ['jsp', al('jsp')],
    ['tld', al('tld')],
    ['jar', al('jar')],
    ['class', al('class_sayisi')],
    ['application_xml', evet('application_xml')],
    ['giris', al('giris')],
    ['yapi_izi', al('yapi_izi')],
    ['kutuphane_izi', al('kutuphane_izi')],
    ['uyari_sayisi', al('uyari_sayisi')],
    ['bag_hedefi', al('bag_hedefi')],
    ['kosu', al('kosu_id')],
    ['taranma_utc', tarih('taranma_utc')],
  ],
  warlar: [
    ['sunucu', al('host')],
    ['ortam', al('ortam')],
    ['jboss', al('jboss')],
    ['kok', al('kok')],
    ['uygulama', al('uygulama')],
    ['war', al('ad')],
    ['yol', al('yol')],
    ['bicim', al('bicim')],
    ['durum', al('durum')],
    ['jsp', al('jsp')],
    ['tld', al('tld')],
    ['tld_dizini', evet('tld_dizini')],
    ['jar', al('jar')],
    ['class', al('class_sayisi')],
    ['web_xml', evet('web_xml')],
    ['web_varyantlari', al('web_varyantlari')],
    ['jboss_web_xml', evet('jboss_web_xml')],
    ['jboss_deployment_structure', evet('jboss_deployment_structure')],
    ['spring_boot', al('spring_boot')],
    ['spring_framework', al('spring_framework')],
    ['spring_security', al('spring_security')],
    ['log4j', al('log4j')],
    ['logback', al('logback')],
    ['jackson', al('jackson')],
    ['thymeleaf', al('thymeleaf')],
    ['struts', al('struts')],
    ['servlet', al('servlet')],
    ['kutuphane_sayisi', al('kutuphane_sayisi')],
    ['kosu', al('kosu_id')],
  ],
  kutuphaneler: [
    ['kutuphane', al('ad')],
    ['surum', al('surum')],
    ['sunucu_sayisi', al('host_sayisi')],
    ['uygulama_sayisi', al('uygulama_sayisi')],
    ['kopya', al('kopya')],
  ],
  sunucular: [
    ['sunucu', al('host')],
    ['ortam', al('ortam')],
    ['durum', al('durum')],
    ['playbook_durum', al('playbook_durum')],
    ['uygulama_sayisi', al('uygulama_sayisi')],
    ['war_sayisi', al('war_sayisi')],
    ['giris', al('giris')],
    ['sure_sn', al('sure_sn')],
    ['python', al('python')],
    ['kullanici', al('kullanici')],
    ['kosu', al('kosu_id')],
    ['veri_kosusu', al('veri_kosu_id')],
    ['taranma_utc', tarih('taranma_utc')],
    ['hata', al('hata')],
  ],
  eslenikler: [
    ['uygulama', al('uygulama')],
    ['ortam', al('ortam')],
    ['jboss', al('jboss')],
    ['karar', al('karar')],
    ['sunucu_sayisi', al('host_sayisi')],
    ['sunucular', (r) => r.hostlar.join(' ')],
    ['gruplar', (r) => r.gruplar.map((g) => `${g.iz}=${g.hostlar.join(',')}`).join(' | ')],
    ['eksik', (r) => r.eksik.join(' ')],
  ],
});

// ── AGAC ────────────────────────────────────────────────────────────────────────────────────────

const tarihMetni = (sn) => {
  const n = Number(sn);
  return Number.isFinite(n) && n > 0
    ? new Date(n * 1000).toISOString().slice(0, 16).replace('T', ' ')
    : '----------------';
};
const sag = (v, n) => String(v === '' || v == null ? '-' : v).padStart(n);
const sol = (v, n) => String(v === '' || v == null ? '-' : v).padEnd(n);

/** Tarayicinin satirlari ([rel, tip, mod, uid, gid, boyut, mtime, ino, hedef]) -> ls -lrtiR benzeri metin. */
function agacMetni({ host, kosu, uygulama, taranmaUtc }) {
  const u = uygulama || {};
  const satirlar = Array.isArray(u.satirlar) ? u.satirlar : [];
  const dizinler = new Map();
  for (const s of satirlar) {
    const rel = String(s[0] || '');
    const i = rel.lastIndexOf('/');
    const d = i < 0 ? '.' : rel.slice(0, i);
    if (!dizinler.has(d)) dizinler.set(d, []);
    dizinler.get(d).push(s);
  }
  const out = [
    `# Uygulama Envanteri — ${host} ${u.kok || ''}/${u.ad || ''}`,
    `# kip=${u.kip || ''} durum=${u.durum || ''} bicim=${u.bicim || ''} kosu=${kosu} taranma_utc=${taranmaUtc || ''}`,
    `# alanlar: inode mod uid gid boyut mtime(UTC) ad [-> bag]; arsiv icindeki girisler ARSIV!/yol`,
  ];
  if (!satirlar.length) out.push('# agac satiri yok (OZET kipinde agac tutulmaz)');
  for (const d of [...dizinler.keys()].sort()) {
    out.push('', `${d}:`);
    const liste = dizinler
      .get(d)
      .slice()
      .sort(
        (a, b) => Number(a[6] || 0) - Number(b[6] || 0) || String(a[0]).localeCompare(String(b[0])),
      );
    for (const s of liste) {
      const ad = String(s[0]).slice(String(s[0]).lastIndexOf('/') + 1);
      out.push(
        `${sag(s[7], 10)} ${sol(s[2], 10)} ${sag(s[3], 5)} ${sag(s[4], 5)} ${sag(s[5], 12)} ${tarihMetni(s[6])} ${ad}${s[8] ? ` -> ${s[8]}` : ''}`,
      );
    }
  }
  return `${out.join('\n')}\n`;
}

/** Arsiv adi parcasi: yalniz [A-Za-z0-9._-]; '.' / '..' / bos olamaz. */
function guvenliParca(s) {
  const t = String(s || '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 120);
  return !t || t === '.' || t === '..' ? '_' : t;
}

function inventoryJson({ host, ortam, kosu, taranmaUtc, uygulama }) {
  const { satirlar, ...u } = uygulama || {};
  return `${JSON.stringify({ sema: 'ear-envanter/1', host, ortam: ortam || null, kosu, taranma_utc: taranmaUtc || null, agac_satiri: Array.isArray(satirlar) ? satirlar.length : 0, uygulama: u }, null, 2)}\n`;
}

const BENIOKU = `Uygulama Envanteri (Server Hub) disa aktarimi
=============================================

CSV dosyalari ';' ayraclidir ve UTF-8 BOM ile baslar; Excel dogrudan acar.
"'" ile baslayan hucre: formul olarak calismasin diye onek eklendi (= + - @ ile baslayan ad).

DURUMLAR
  TAM              tarama eksiksiz
  KISMI_*          tarama eksik: SINIR (giris siniri), ZAMAN (sure butcesi), IZIN (okuma izni)
  ARSIV_ACILMADI   paketli arsivin icindeki WAR acilmadi (OZET kip ya da boyut siniri)
  KOK_YOK          sunucuda /vhosting ve /vhosting8 yok
  SONUC_YOK        sunucudan sonuc gelmedi; OKUNAMADI sonuc dosyasi okunamadi
  Eksik tarama hicbir dosyada "TAM" gorunmez.

ESLENIKLER (karar)
  AYNI / FARKLI_KUTUPHANE / FARKLI_YAPI / EKSIK_TARAMA (karsilastirilmadi) / KARSILASTIRILAMAZ (farkli kip)

tree.txt: ls -lrtiR benzeri (inode mod uid gid boyut mtime ad); yalniz TAM kipte ve saklama suresindeki
kosularda vardir. inventory.json: uygulamanin tum alanlari (yapay zeka analizi icin).
`;

/** Filo ZIP'i: bes CSV + BENIOKU. */
function filoZipGirisleri({ uygulamalar, warlar, kutuphaneler, sunucular, eslenikler }) {
  return [
    { ad: 'BENIOKU.txt', veri: BENIOKU },
    { ad: 'uygulamalar.csv', veri: csv(KOLONLAR.uygulamalar, uygulamalar) },
    { ad: 'warlar.csv', veri: csv(KOLONLAR.warlar, warlar) },
    { ad: 'kutuphaneler.csv', veri: csv(KOLONLAR.kutuphaneler, kutuphaneler) },
    { ad: 'sunucular.csv', veri: csv(KOLONLAR.sunucular, sunucular) },
    { ad: 'eslenikler.csv', veri: csv(KOLONLAR.eslenikler, eslenikler) },
  ];
}

/** Tek sunucu ZIP'i: o sunucunun CSV satirlari + uygulama basina tree.txt ve inventory.json. */
function hostZipGirisleri({
  host,
  ortam,
  kosu,
  yuk,
  uygulamaSatirlari,
  warSatirlari,
  sunucuSatiri,
}) {
  const girisler = [
    { ad: 'BENIOKU.txt', veri: BENIOKU },
    { ad: 'uygulamalar.csv', veri: csv(KOLONLAR.uygulamalar, uygulamaSatirlari) },
    { ad: 'warlar.csv', veri: csv(KOLONLAR.warlar, warSatirlari) },
    { ad: 'sunucu.csv', veri: csv(KOLONLAR.sunucular, sunucuSatiri ? [sunucuSatiri] : []) },
  ];
  const gorulen = new Set();
  for (const u of (yuk && yuk.uygulamalar) || []) {
    const taban = `uygulamalar/${guvenliParca(String(u.kok || '').replace(/^\/+/, ''))}/${guvenliParca(u.ad)}`;
    let dizin = taban;
    for (let i = 2; gorulen.has(dizin); i++) dizin = `${taban}_${i}`;
    gorulen.add(dizin);
    const taranmaUtc = yuk.baslangic_utc || null;
    girisler.push({
      ad: `${dizin}/tree.txt`,
      veri: agacMetni({ host, kosu, uygulama: u, taranmaUtc }),
    });
    girisler.push({
      ad: `${dizin}/inventory.json`,
      veri: inventoryJson({ host, ortam, kosu, taranmaUtc, uygulama: u }),
    });
  }
  return girisler;
}

module.exports = {
  BOM,
  KOLONLAR,
  BENIOKU,
  csvHucre,
  csv,
  agacMetni,
  guvenliParca,
  inventoryJson,
  filoZipGirisleri,
  hostZipGirisleri,
};
