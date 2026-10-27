// server/nginx-loadtest/__tests__/fixtures/senaryolar.cjs -- farkli-gerceklesim fikstur katalogu.
//
// Her ADIM bir Portal kosu dizinidir (R<id>). R10-R25 el kitinin test_karsilastir.py kurgusunun
// birebir karsiligidir (yorumda Python adi); R30+ Portal'a ozgu ya da eksik kalan durumlari kapsar.
// KARARLAR: karsilastir.py `karar_ver` ile Node `kararVer`in ayni girdide karsilastirilacagi ciftler.
//   py   : Python'a verilen secenekler (kademe_cpu/kademe_p95 varsayilani 250/400)
//   node : Node'a verilen secenekler; verilmezse VARSAYILAN kademe secimi sinanir (ortadaki / en yuksek)
//   portalKarar : Portal'in bilincli farki (analiz.cjs basligi, madde 3) -> Python karari yerine bu
'use strict';

const { Kurgu, standart } = require('./kurgu.cjs');

const ADIMLAR = [
  {
    ad: 'R10', aciklama: 'T0 taban: K/yeni/br + K/ka/br + K/yeni/identity (ayristirma)',
    uret: () => {
      const k = standart('R10');
      k.kosu({ kip: 'ka', hiz: 250, r: 1, ru: 16, rs: 4 });
      k.kosu({ ae: 'identity', hiz: 250, r: 1, ru: 20, rs: 5 });
      k.kosu({ ae: 'identity', hiz: 250, r: 2, ru: 20, rs: 5 });
      return k.dosyalar({ not: 'taban' });
    },
  },
  { ad: 'R11', aciklama: 'T1: %10 CPU kazanci (esikte), govde +%10', uret: () => standart('R11', { ru: 22, govde: 1100 }).dosyalar({ not: 'brotli 6->4' }) },
  { ad: 'R12', aciklama: 'T1b: %5 CPU kazanci, govde +%15', uret: () => standart('R12', { ru: 23, govde: 1150 }).dosyalar() },
  { ad: 'R13', aciklama: 'T11: 250_r1 once 429 ile DUR (deneme 1, hatali_), sonra deneme 2', uret: () => standart('R13', { ru: 22, yarim: true }).dosyalar() },
  {
    ad: 'R14', aciklama: 'T12: reload ile GECERSIZ 250_r1 + r3 -> kademede 2 gecerli',
    uret: () => {
      const k = standart('R14', { ru: 22, reload: true });
      k.kosu({ hiz: 250, r: 3, ru: 22 });
      return k.dosyalar();
    },
  },
  { ad: 'R15', aciklama: 'U0: referansta hata %0.4', uret: () => standart('R15', { hata: 0.004 }).dosyalar() },
  { ad: 'R16', aciklama: 'U1: adayda ayni hata %0.4', uret: () => standart('R16', { ru: 22, hata: 0.004 }).dosyalar() },
  { ad: 'R17', aciklama: 'T15: referansta hata yok, adayda %0.4 -> RET', uret: () => standart('R17', { ru: 22, hata: 0.004 }).dosyalar() },
  { ad: 'R18', aciklama: 'T16: isinmada 503 (gecerli kalir)', uret: () => standart('R18', { ru: 22, s5xx_isinma: 2 }).dosyalar() },
  { ad: 'R19', aciklama: 'T17: olcumde 503 -> GECERSIZ', uret: () => standart('R19', { ru: 22, s5xx_olcum: 1 }).dosyalar() },
  { ad: 'R20', aciklama: 'T2: reload', uret: () => standart('R20', { ru: 22, reload: true }).dosyalar() },
  { ad: 'R21', aciklama: 'T3: 429', uret: () => standart('R21', { ru: 22, n429: 3 }).dosyalar() },
  { ad: 'R22', aciklama: 'T4: p95 @400 +%20', uret: () => standart('R22', { ru: 22, p95_400: 60.0 }).dosyalar() },
  { ad: 'R23', aciklama: 'T6: host %95 -> DOYMA (400_r2)', uret: () => standart('R23', { ru: 22, host: 760 }).dosyalar() },
  { ad: 'R24', aciklama: 'T7: df_bas 70', uret: () => standart('R24', { ru: 22 }).dosyalar({ df_bas: 70 }) },
  { ad: 'R25', aciklama: 'T8: log/istemci farki %5', uret: () => standart('R25', { ru: 22, fark: 1.05 }).dosyalar() },
  // ---- Portal'a ozgu / ek kapsam ----
  { ad: 'R30', aciklama: 'iki hiz (50, 120) referans', uret: () => standart('R30', { hizlar: [50, 120] }).dosyalar() },
  { ad: 'R31', aciklama: 'iki hiz (50, 120) aday, %12.5 kazanc', uret: () => standart('R31', { hizlar: [50, 120], ru: 21 }).dosyalar() },
  {
    ad: 'R32', aciklama: 'uc hiz (80, 160, 320) x 3 tekrar, tekrar arasi gurultu',
    uret: () => standart('R32', { hizlar: [80, 160, 320], tekrar: 3, kosuEk: (h, r) => ({ ru: 23 + r - 1, p95: 48 + 2 * r }) }).dosyalar(),
  },
  {
    ad: 'R33', aciklama: 'uc hiz x 3 tekrar aday',
    uret: () => standart('R33', { hizlar: [80, 160, 320], tekrar: 3, kosuEk: (h, r) => ({ ru: 20 + r - 1, p95: 46 + r }) }).dosyalar(),
  },
  {
    ad: 'R34', aciklama: 'saat dilimi -0500, kesirli epoch, CRLF istemci, BOM zaman.csv',
    uret: () => standart('R34', { ru: 22, kurgu: { ofsDk: -300 } }).dosyalar({ kesir: '.25', crlfIstemci: true, bomZaman: true }),
  },
  { ad: 'R35', aciklama: 'kayit sirasinda log dondu', uret: () => standart('R35', { ru: 22 }).dosyalar({ gecersiz: ['log_dondu:access.log'] }) },
  { ad: 'R36', aciklama: 'konf ozeti degisti', uret: () => standart('R36', { ru: 22 }).dosyalar({ konf_bit: 'def', uyari: ['konf_degisti(kayit_sirasinda):abc->def'] }) },
  { ad: 'R37', aciklama: 'df_bit tam 65 (sinir)', uret: () => standart('R37', { ru: 22 }).dosyalar({ df_bit: 65 }) },
  {
    ad: 'R38', aciklama: 'dropped > 0 -> DOYMA (400_r1)',
    uret: () => standart('R38', { ru: 22, kosuEk: (h, r) => (h === 400 && r === 1 ? { dropped: 5 } : {}) }).dosyalar(),
  },
  { ad: 'R39', aciklama: 'sunucu kaydi yok (sunucu_*.csv, bilgi yok)', uret: () => standart('R39', { ru: 22 }).dosyalar({ sunucuYok: true, bilgiYok: true }) },
  { ad: 'R40', aciklama: 'sunucu logu yok: pencere istemci saatinden', uret: () => standart('R40', { ru: 22 }).dosyalar({ logYok: true }) },
  {
    ad: 'R41', aciklama: 'istemci alanlari eksik (bos, -, nan, None) -> null',
    uret: () => standart('R41', { ru: 22, kosuEk: (h, r) => (h === 100 && r === 1 ? { istemciAlan: { p95: '', hata_orani: '-', ttfb_p95: 'nan', p99: 'None', bayt_istek: 'null' } } : {}) }).dosyalar(),
  },
  {
    ad: 'R42', aciklama: 'arka plan yok (bosta 5 sn, bosluk 3 sn) -> 0 kabul, 15 ms',
    uret: () => standart('R42', { kurgu: { bosta: 5 }, kosuEk: () => ({ bosluk: 3 }) }).dosyalar(),
  },
  {
    ad: 'R43', aciklama: '250 kademesinin tamami DOYMA (host %95)',
    uret: () => standart('R43', { ru: 22, kosuEk: (h) => (h === 250 ? { host: 760 } : {}) }).dosyalar(),
  },
  {
    ad: 'R44', aciklama: 'yeni kipinde baglanti yeniden kullanimi %10 + ka kipi',
    uret: () => {
      const k = new Kurgu('R44');
      k.kosu({ hiz: 250, r: 1, yenidenKullan: 10 });
      k.kosu({ kip: 'ka', hiz: 250, r: 1, ru: 16, rs: 4 });
      return k.dosyalar();
    },
  },
  {
    ad: 'R45', aciklama: 'log/istemci farki sinirlari: %1.96 gecerli, %2.13 gecersiz',
    uret: () => standart('R45', { ru: 22, kosuEk: (h, r) => (h === 100 ? { fark: r === 1 ? 1.02 : 0.979 } : {}) }).dosyalar(),
  },
  {
    ad: 'R46', aciklama: 'hata sinirlari: 0.001 gecerli, 0.0011 gecersiz',
    uret: () => standart('R46', { ru: 22, kosuEk: (h, r) => (h === 100 ? { istemciAlan: { hata_orani: r === 1 ? '0.001' : '0.0011' } } : {}) }).dosyalar(),
  },
  {
    ad: 'R47', aciklama: 'sunucu saati 15 sn ileride (saat_farki uyarisi)',
    uret: () => standart('R47', { ru: 22, kosuEk: () => ({ kayma: 15 }) }).dosyalar(),
  },
  {
    ad: 'R48', aciklama: 'eski kaydedici: log deneme kolonu yok + tekrar kosu',
    uret: () => standart('R48', { ru: 22, yarim: true, kurgu: { denemeKolonu: false } }).dosyalar(),
  },
  {
    ad: 'R49', aciklama: 'B senaryosu referans (10 istek/sn)',
    uret: () => {
      const k = new Kurgu('R49', { rps: 10 });
      for (const r of [1, 2]) k.kosu({ sen: 'B', hiz: 10, r, ru: 12, rs: 3, p95: 400 });
      return k.dosyalar();
    },
  },
  {
    ad: 'R50', aciklama: 'B senaryosu aday',
    uret: () => {
      const k = new Kurgu('R50', { rps: 10 });
      for (const r of [1, 2]) k.kosu({ sen: 'B', hiz: 10, r, ru: 11, rs: 3, p95: 380 });
      return k.dosyalar();
    },
  },
  {
    ad: 'R51', aciklama: 'iki kesit (kaydedici yeniden basladi): cok ornekli secilir',
    uret: () => {
      const k = standart('R51', { ru: 22, hizlar: [250] });
      return k.dosyalar({ ekKesit: [k.t0 + 100, k.t0 + 140] });
    },
  },
  {
    ad: 'R52', aciklama: 'test disi trafik saniyede 1 (%5) -> uyari',
    uret: () => {
      const k = standart('R52', { ru: 22 });
      k.digerEkle(k.t0, k.t, 1);
      return k.dosyalar();
    },
  },
  {
    ad: 'R53', aciklama: "kapanan worker ('shutting down') 250_r1 icinde -> reload",
    uret: () => standart('R53', { ru: 22, kosuEk: (h, r) => (h === 250 && r === 1 ? { kapanan: [30, 36] } : {}) }).dosyalar(),
  },
  {
    ad: 'R54', aciklama: 'son TUR yarida kesildi (baslatilan var, zaman/istemci yok)',
    uret: () => {
      const k = standart('R54', { ru: 22, hizlar: [100, 250] });
      k.kesik({ hiz: 400, r: 1 });
      return k.dosyalar();
    },
  },
  {
    ad: 'R55', aciklama: "kos.sh 250_r1'de 429 ile DUR (sonrasi kosulmadi)",
    uret: () => {
      const k = standart('R55', { ru: 22, hizlar: [100] });
      k.kosu({ hiz: 250, r: 1, ru: 22, n429: 3, hatali: true });
      return k.dosyalar();
    },
  },
  {
    ad: 'R56', aciklama: 'isinmada 429 (429 her fazda sayilir; 5xx yalniz olcumde)',
    uret: () => standart('R56', { ru: 22, kosuEk: (h, r) => (h === 250 && r === 1 ? { n429_isinma: 2 } : {}) }).dosyalar(),
  },
  { ad: 'R57', aciklama: 'CPU ayni, p95 %12 iyi -> KALICI (p95 kurali)', uret: () => standart('R57', { p95: 44.0 }).dosyalar() },
  {
    // Kosu disi bosluk (bas+81..89, 8 sn): kapanan worker ve pid degisimi blogu boler -> blok < 8 sn atilir.
    ad: 'R58', aciklama: "kosular ARASINDA 'shutting down' worker ve reload: arka plan bloklari bolunur",
    uret: () => standart('R58', {
      ru: 22,
      kosuEk: (h, r) => (h === 100 && r === 1 ? { kapanan: [83, 86] } : h === 250 && r === 1 ? { reload: true, reloadOfs: 85 } : {}),
    }).dosyalar(),
  },
];

const KARARLAR = [
  { ref: 'R10', aday: 'R11', py_ad: 'T1' },
  { ref: 'R10', aday: 'R12', py_ad: 'T1b' },
  { ref: 'R10', aday: 'R12', py: { esik_cpu: 5 }, node: { esikCpu: 5 }, py_ad: 'T1b esik 5 (EPS siniri)' },
  { ref: 'R10', aday: 'R13', py_ad: 'T11' },
  { ref: 'R10', aday: 'R14', py_ad: 'T12' },
  { ref: 'R15', aday: 'R16', py_ad: 'U1/U0' },
  { ref: 'R10', aday: 'R17', py_ad: 'T15' },
  { ref: 'R10', aday: 'R18', py_ad: 'T16' },
  { ref: 'R10', aday: 'R19', py_ad: 'T17' },
  { ref: 'R10', aday: 'R20', py_ad: 'T2' },
  { ref: 'R10', aday: 'R21', py_ad: 'T3' },
  { ref: 'R10', aday: 'R22', py_ad: 'T4' },
  { ref: 'R10', aday: 'R22', py: { esik_zarar: 25 }, node: { esikZarar: 25 }, py_ad: 'T4 zarar esigi 25' },
  { ref: 'R10', aday: 'R23', py_ad: 'T6' },
  { ref: 'R10', aday: 'R24', py_ad: 'T7' },
  { ref: 'R10', aday: 'R25', py_ad: 'T8' },
  { ref: 'R11', aday: 'R10', py_ad: 'ters: CPU %11 kotu -> RET' },
  { ref: 'R11', aday: 'R12', py: { esik_p95: 0 }, node: { esikP95: 0 }, py_ad: 'p95 esigi 0 (kosul2)' },
  { ref: 'R30', aday: 'R31', py: { kademe_cpu: 120, kademe_p95: 120 }, py_ad: 'iki hiz: varsayilan kademe 120/120' },
  { ref: 'R32', aday: 'R33', py: { kademe_cpu: 160, kademe_p95: 320 }, py_ad: 'uc hiz x3: varsayilan kademe 160/320' },
  { ref: 'R32', aday: 'R33', py: { kademe_cpu: 80, kademe_p95: 160 }, node: { kademeCpu: 80, kademeP95: 160 }, py_ad: 'acik kademe 80/160' },
  { ref: 'R10', aday: 'R34', py_ad: 'saat dilimi / kesirli epoch' },
  { ref: 'R10', aday: 'R35', py_ad: 'log dondu' },
  { ref: 'R10', aday: 'R36', py_ad: 'konf degisti' },
  { ref: 'R10', aday: 'R37', py_ad: 'df 65' },
  { ref: 'R10', aday: 'R38', py_ad: 'dropped DOYMA' },
  { ref: 'R10', aday: 'R39', py_ad: 'sunucu kaydi yok -> VERI_YOK' },
  { ref: 'R10', aday: 'R40', py_ad: 'log yok' },
  { ref: 'R10', aday: 'R41', py_ad: 'eksik istemci alanlari' },
  { ref: 'R10', aday: 'R42', py_ad: 'arka plan yok' },
  { ref: 'R10', aday: 'R43', portalKarar: 'DOYMA', py_ad: '250 tamamen DOYMA: Python VERI_YOK, Portal DOYMA' },
  { ref: 'R10', aday: 'R45', py_ad: 'log farki sinirlari' },
  { ref: 'R10', aday: 'R46', py_ad: 'hata sinirlari' },
  { ref: 'R10', aday: 'R47', py_ad: 'saat farki' },
  { ref: 'R10', aday: 'R48', py_ad: 'deneme kolonu yok' },
  { ref: 'R10', aday: 'R52', py_ad: 'diger trafik' },
  { ref: 'R10', aday: 'R53', py_ad: 'kapanan worker' },
  { ref: 'R10', aday: 'R54', node: { kademeCpu: 250, kademeP95: 400 }, py_ad: 'kesik TUR (HATALI karara girmez)' },
  { ref: 'R10', aday: 'R55', node: { kademeCpu: 250, kademeP95: 400 }, py_ad: 'hatali_ TUR karara girmez' },
  // Node varsayilani kademeP95 = en yuksek ORTAK hiz (250) olurdu; Python'la ayni girdi icin 400 verilir.
  { ref: 'R10', aday: 'R44', node: { kademeCpu: 250, kademeP95: 400 }, py_ad: 'aday yalniz 250: p95 kademesi (400) yok' },
  { ref: 'R10', aday: 'R56', py_ad: 'isinmada 429 -> RET' },
  { ref: 'R10', aday: 'R57', py_ad: 'p95 kurali (kosul2) -> KALICI' },
  { ref: 'R10', aday: 'R58', py_ad: 'bosluktaki kapanan/reload kosulari bozmaz' },
  { ref: 'R49', aday: 'R50', py_ad: 'yalniz B: Python VERI_YOK', yalnizPython: true },
];

module.exports = { ADIMLAR, KARARLAR };
