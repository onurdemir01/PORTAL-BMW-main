// server/selfservice/lb-ip-kurallari.cjs - sunucu listesinden LB'de kullanilacak IP'ler.
//
// bmw_inventory/lb_suspend_excludelist/operations/files/lb_suspend_excludelist.sh kurallarinin
// Portal karsiligi. Betik lbSuspendList-<tarih>.txt dosyasini okur; dbo.IPInventory ayni dosyadan
// yuklenir, bu yuzden AWX isi baslatmadan ayni sonuc verilebilir. Kural degisirse iki taraf da
// degismeli. __tests__/lb-ip-kurallari.test.cjs gercek betigin ciktisindan alinmis beklentileri tasir.
//
// Eslesme betikteki gibi buyuk / kucuk harf duyarsiz ALT METINDIR ("grep -i"), tam ad degil.
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const SUNUCU_AD_RE = /^[A-Za-z0-9._-]{6,64}$/;
const VERI_BAYAT_SAAT = 30;

// Kaynak: bmw_inventory/lb_suspend_excludelist/operations/files/operational_hazard.csv.
// Ansible deposu Portal'a teslim edilmedigi icin kopyadir; CSV degisirse burasi da guncellenir.
const OPERASYON_UYARILARI = [
  { sunucu: 'GBJGKP01', uygulama: 'GBBKMGKSINQUIRY-GBBKMGKSANNOUNCEMENT', aciklama: '01 sunucusu primary konumda Umut Kizgindere ile iletisime gecilip diger sunuculara primary status alinmali' },
  { sunucu: 'GBJBOP07', uygulama: '-', aciklama: 'Mert arisan ile iletisime gecilip ark batch bu sunucuda calisiyorsa GBJBOP08 sunucusunda calisacak sekilde ayarlanmali' },
  { sunucu: 'GBJBOP08', uygulama: '-', aciklama: 'Mert arisan ile iletisime gecilip ark batch bu sunucuda calisiyorsa GBJBOP07 sunucusunda calisacak sekilde ayarlanmali' },
];

function raporDizini() {
  return process.env.LB_SUSPEND_RAPOR_DIZIN || '/sw/WAS_IMAGES/LB_SUSPEND_REPORT';
}

// Betikteki "${line:0:(${#line}-n)}" ve "${line:(-n)}" karsiligi.
const uEslenik2 = (s) => `${s.slice(0, -2)}U${s.slice(-2)}`;
const uEslenik3 = (s) => `${s.slice(0, -3)}U${s.slice(-3)}`;
const wEslenik = (s) => `${s.slice(0, -4)}W${s.slice(-3)}`;
const ankaraWEslenik = (s) => `${s.slice(0, -5)}W${s.slice(-4)}`;
const webEslenik = (s) => `GBWEB${s.slice(-2)}`;

/** Betik buyuk harfe cevirir; tekrar eden ad bir kez islenir. */
function girdiyiAyikla(ham) {
  const sunucular = [];
  const gecersiz = [];
  const gorulen = new Set();
  for (const oge of ham) {
    const ad = String(oge ?? '').trim().toUpperCase();
    if (!ad || gorulen.has(ad)) continue;
    gorulen.add(ad);
    if (SUNUCU_AD_RE.test(ad)) sunucular.push(ad);
    else gecersiz.push(ad);
  }
  return { sunucular, gecersiz };
}

function hostDizini(kayitlar) {
  const dizin = new Map();
  for (const k of kayitlar) {
    const host = String(k.host ?? '').trim();
    const ip = String(k.ip ?? '').trim();
    if (!host || !ip) continue;
    const anahtar = host.toUpperCase();
    if (!dizin.has(anahtar)) dizin.set(anahtar, []);
    dizin.get(anahtar).push({ host, ip });
  }
  return dizin;
}

/**
 * lbIpCoz: saf kural motoru.
 * @param sunucular buyuk harfli sunucu adlari (girdiyiAyikla)
 * @param kayitlar dbo.IPInventory satirlari ({ host, ip })
 * @param dijitalKanalMetni dijital-kanal-sunuculari.txt icerigi; okunamadiysa bos metin
 */
function lbIpCoz({ sunucular, kayitlar, dijitalKanalMetni = '' }) {
  const dizin = hostDizini(kayitlar);
  const hostlar = [...dizin.keys()];
  const eslesen = (parca) => hostlar.filter((h) => h.includes(parca));
  const varMi = (parca) => hostlar.some((h) => h.includes(parca));
  const tumGirdi = sunucular.join(' ');
  const dijitalSatirlar = dijitalKanalMetni.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  const sonuclar = sunucular.map((sunucu) => {
    const kayit = new Map();
    const eslenikler = [];
    const ekle = (parca, neden) => {
      for (const anahtar of eslesen(parca)) {
        for (const r of dizin.get(anahtar)) {
          const id = `${r.host.toUpperCase()}|${r.ip}`;
          if (!kayit.has(id)) kayit.set(id, { host: r.host, ip: r.ip, neden });
        }
      }
    };

    const uygulamaYaDaSube = sunucu[4] === 'A' || sunucu[4] === 'S';
    const w = wEslenik(sunucu);
    const web = webEslenik(sunucu);
    const bulundu = varMi(sunucu) || varMi(uEslenik2(sunucu)) || varMi(uEslenik3(sunucu))
      || (uygulamaYaDaSube && varMi(w));

    if (bulundu) {
      ekle(sunucu, 'sunucu');
      ekle(uEslenik2(sunucu), 'u_eslenigi');
      ekle(uEslenik3(sunucu), 'u_eslenigi');
    }

    // Eslenik girdide zaten varsa kendi satirinda listelenir, burada eklenmez. Betikte "CGW"
    // denetimi tum girdi tek satir olarak suzuldugu icin bir CGW adi W kuralini kapatir.
    const wGirdide = !tumGirdi.includes('CGW') && tumGirdi.includes(w);
    if (!wGirdide && !tumGirdi.includes(web)) {
      if (sunucu.includes('GBSUB') && varMi(web)) {
        eslenikler.push(web);
        ekle(web, 'web_eslenigi');
      }
      if (uygulamaYaDaSube && varMi(w)) {
        eslenikler.push(w);
        ekle(w, 'web_eslenigi');
      }
      const ankara = ankaraWEslenik(sunucu);
      if (uygulamaYaDaSube && varMi(ankara)) {
        eslenikler.push(ankara);
        ekle(ankara, 'web_eslenigi');
      }
      for (const satir of dijitalSatirlar) {
        if (!satir.toUpperCase().includes(sunucu)) continue;
        const dijitalWeb = satir.split(/\s+/)[0].toUpperCase();
        eslenikler.push(dijitalWeb);
        ekle(dijitalWeb, 'dijital_kanal_web');
      }
    }

    return { sunucu, bulundu, eslenikler, kayitlar: [...kayit.values()] };
  });

  const ipler = [...new Set(sonuclar.flatMap((s) => s.kayitlar.map((k) => k.ip)))];
  const istenen = new Set(sunucular);
  const uyarilar = OPERASYON_UYARILARI.filter((u) => istenen.has(u.sunucu));
  return { sonuclar, ipler, uyarilar };
}

/** Okunamazsa ok:false doner; dosya eksikligi "eslenik yok" diye sessizce gecmesin. */
async function dijitalKanalOku() {
  try {
    const metin = await fs.readFile(path.join(raporDizini(), 'dijital-kanal-sunuculari.txt'), 'utf8');
    return { ok: true, metin };
  } catch {
    return { ok: false, metin: '' };
  }
}

function veriDurumu(kayitlar, simdi = Date.now()) {
  let son = 0;
  for (const k of kayitlar) {
    const t = k.last_seen_at ? new Date(k.last_seen_at).getTime() : 0;
    if (Number.isFinite(t) && t > son) son = t;
  }
  return {
    veriTarihi: son ? new Date(son).toISOString() : null,
    veriBayat: simdi - son > VERI_BAYAT_SAAT * 3600 * 1000,
  };
}

module.exports = { lbIpCoz, girdiyiAyikla, dijitalKanalOku, veriDurumu, OPERASYON_UYARILARI, VERI_BAYAT_SAAT };
