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

const csvSatiri = (kolonlar, r) => `${kolonlar.map(([, f]) => csvHucre(f(r))).join(';')}\r\n`;

/**
 * CSV AKISI (2026-11-05): tum kume parca parca okunur ve yazilir; bellekte buyuk metin birikmez.
 * parcaGetir(offset, adet) -> { satirlar, toplam }. EKSIKSIZLIK: toplam parcalar arasinda degisirse ya
 * da yazilan satir toplamla tutmazsa (veri akis sirasinda degisti) akis HATA ile kesilir; tarayici
 * indirmeyi "basarisiz" gosterir, yarim dosya tam sanilmaz.
 */
async function csvAkisi(yaz, kolonlar, parcaGetir, { parca = 5000 } = {}) {
  await yaz(`${BOM}${kolonlar.map(([b]) => csvHucre(b)).join(';')}\r\n`);
  let offset = 0;
  let beklenen = null;
  for (;;) {
    const { satirlar, toplam } = await parcaGetir(offset, parca);
    if (beklenen == null) beklenen = toplam;
    else if (satirlar.length && toplam !== beklenen)
      throw Object.assign(new Error('Veri dışa aktarım sırasında değişti; yeniden indirin.'), {
        code: 'veri_degisti',
      });
    if (satirlar.length) await yaz(satirlar.map((r) => csvSatiri(kolonlar, r)).join(''));
    offset += satirlar.length;
    if (satirlar.length < parca) break;
  }
  if (offset !== (beklenen || 0))
    throw Object.assign(new Error(`Dışa aktarım eksik kaldı (${offset}/${beklenen}).`), {
      code: 'eksik_aktarim',
    });
  return offset;
}

const al = (k) => (r) => r[k];
function jsonListe(v) {
  if (Array.isArray(v)) return v.map(String);
  try {
    const x = JSON.parse(String(v || '[]'));
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
}
const degiskenMetni = (r) =>
  (r.degiskenler || []).map((d) => `${d.harf}=${(d.hostlar || []).join(',')}`).join(' | ');
const evet = (k) => (r) =>
  { if (r[k] === true || r[k] === 1) return 'evet'; if (r[k] === false || r[k] === 0) return 'hayır'; return ''; };
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
    ['uyarilar', (r) => jsonListe(r.uyarilar).join(' | ')],
    ['bag_hedefi', al('bag_hedefi')],
    ['ear_kutuphane_sayisi', al('ear_kutuphane_sayisi')],
    ['war_adlari', al('war_adlari')],
    ['spring_security', al('spring_security')],
    ['logback', al('logback')],
    ['jackson', al('jackson')],
    ['thymeleaf', al('thymeleaf')],
    ['struts', al('struts')],
    ['eslenik_ortam_ici', al('eslenik_ortam_ici')],
    ['eslenik_ortamlar_arasi', al('eslenik_ortamlar_arasi')],
    ['eslenik_nesil', al('eslenik_nesil')],
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
    ['neden', al('neden')],
    ['playbook', al('playbook_etiket')],
    ['playbook_durum', al('playbook_durum')],
    ['eksik_uygulama', al('eksik_uygulama')],
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
    ['kutuphane', al('kutuphane')],
    ['yapi', al('yapi')],
    ['sunucu_sayisi', al('host_sayisi')],
    ['sunucular', (r) => (r.hostlar || []).join(' ')],
    ['degiskenler', degiskenMetni],
    ['tarih_farki_gun', al('tarih_farki_gun')],
    ['eksik', (r) => (r.eksik || []).join(' ')],
  ],
  eslenikler_ortamlar_arasi: [
    ['uygulama', al('uygulama')],
    ['jboss', al('jboss')],
    ['karar', al('karar')],
    ['kutuphane', al('kutuphane')],
    ['yapi', al('yapi')],
    ['ortam_sayisi', al('ortam_sayisi')],
    ['ortamlar', (r) => (r.ortamlar || []).map((o) => `${o.ortam}=${o.harfler.join('+')}`).join(' ')],
    ['farkli_ortamlar', (r) => (r.farkli_ortamlar || []).join(' ')],
    ['degiskenler', degiskenMetni],
    ['tarih_farki_gun', al('tarih_farki_gun')],
    ['eksik', (r) => (r.eksik || []).join(' ')],
  ],
  eslenikler_nesil: [
    ['sunucu', al('host')],
    ['uygulama', al('uygulama')],
    ['ortam', al('ortam')],
    ['karar', al('karar')],
    ['kutuphane', al('kutuphane')],
    ['yapi', al('yapi')],
    ['tarih_farki_gun', al('tarih_farki_gun')],
  ],
  eslenikler_ortam_yok: [
    ['uygulama', al('uygulama')],
    ['jboss', al('jboss')],
    ['sunucu_sayisi', al('host_sayisi')],
    ['kopya_sayisi', al('kopya_sayisi')],
    ['sunucular', (r) => (r.hostlar || []).join(' ')],
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
        `${sag(s[7], 10)} ${sol(s[2], 10)} ${sag(s[3], 5)} ${sag(s[4], 5)} ${sag(s[5], 12)} ${tarihMetni(s[6])} ${ad}${s[8] ? (" -> " + s[8]) : ''}`,
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

ESLENIKLER
  eslenikler.csv                  ayni uygulama, ayni ortam, ayni JBoss nesli, en az iki sunucu
  eslenikler_ortamlar_arasi.csv   ayni uygulama, ayni nesil, farkli ortamlar (harf = kutuphane degiskeni)
  eslenikler_jboss7_8.csv         ayni sunucuda ayni EAR hem /vhosting hem /vhosting8 altinda
  eslenikler_ortam_bilinmiyor.csv envanterde ortami bos sunucular: karsilastirilmadi
  karar: AYNI / FARKLI_KUTUPHANE (jar ya da surum farki) / AYNI_SURUM_FARKLI_DOSYA (ayni surum,
         farkli boyut) / FARKLI_YAPI (dosya yapisi farkli) / EKSIK_TARAMA (bir kopya tam taranmadi:
         karsilastirilmadi)
  kutuphane ve yapi sutunlari ayri sonuclardir; karar ikisinin en kotusudur.

tree.txt: ls -lrtiR benzeri (inode mod uid gid boyut mtime ad); yalniz TAM kipte ve saklama suresindeki
kosularda vardir. inventory.json: uygulamanin tum alanlari (yapay zeka analizi icin).
`;

/** Filo ZIP'i: CSV'ler + BENIOKU. eslenik: eslenik motorunun analizi (dort liste). */
function filoZipGirisleri({ uygulamalar, warlar, kutuphaneler, sunucular, eslenikler, eslenik }) {
  const e = eslenik || { ortamIci: eslenikler || [], ortamlarArasi: [], nesil: [], ortamYok: [] };
  return [
    { ad: 'BENIOKU.txt', veri: BENIOKU },
    { ad: 'uygulamalar.csv', veri: csv(KOLONLAR.uygulamalar, uygulamalar) },
    { ad: 'warlar.csv', veri: csv(KOLONLAR.warlar, warlar) },
    { ad: 'kutuphaneler.csv', veri: csv(KOLONLAR.kutuphaneler, kutuphaneler) },
    { ad: 'sunucular.csv', veri: csv(KOLONLAR.sunucular, sunucular) },
    { ad: 'eslenikler.csv', veri: csv(KOLONLAR.eslenikler, e.ortamIci) },
    {
      ad: 'eslenikler_ortamlar_arasi.csv',
      veri: csv(KOLONLAR.eslenikler_ortamlar_arasi, e.ortamlarArasi),
    },
    { ad: 'eslenikler_jboss7_8.csv', veri: csv(KOLONLAR.eslenikler_nesil, e.nesil) },
    { ad: 'eslenikler_ortam_bilinmiyor.csv', veri: csv(KOLONLAR.eslenikler_ortam_yok, e.ortamYok) },
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
  csvAkisi,
  agacMetni,
  guvenliParca,
  inventoryJson,
  filoZipGirisleri,
  hostZipGirisleri,
};
