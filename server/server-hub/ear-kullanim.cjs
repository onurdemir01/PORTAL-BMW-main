// server/server-hub/ear-kullanim.cjs - JBoss'a bagli olmayan EAR dizininin kullanim kaniti (2026-11-17).
//
// Saha (ODCRPAP01): /vhosting8/DASCRYPTOWEBSITENODE.ear domain.xml'de yok (EAR_JVM_YOK, TANIM_YOK) ama dizinde
// canli bir Node.js sureci calisiyor (cwd = .../X.war) ve logs/ bugun yaziliyor. "Diskte duruyor, hicbir JVM'e
// yuklenmiyor" metni kullaniciyi "artik, silinebilir" sonucuna goturuyordu.
//
// Kaynak: Uygulama Envanteri tarayicisi (ear_tara.py surum 4) uygulama.kullanim -> xml_eslesme.kullanim:
//   { durum: VAR | YOK | KISMI | OLCULEMEDI, surecler: [{pid, comm, kullanici, nasil}], son_yazma: epoch|null,
//     okunamayan: sayi, hidepid: metin, not }
// Karar (Server Hub bulgusu ve EAR Temizligi engeli AYNI fonksiyonu kullanir):
//   aktif      = dizini gosteren surec var (durum VAR) YA DA son yazma TARAMA ANINDAN KULLANIM_YAZMA_GUN gun
//                once ya da sonra (saat kaymasi payi GELECEK_PAY_MS) icinde. Referans TARAMA anidir, duvar saati
//                DEGIL: veri EAR_VERI_MAX_GUN (35) gun kullanilir; surec kaniti gibi yazma kaniti da taramaya aittir.
//   olculemedi = aktif degil ve kullanim KISMI / OLCULEMEDI ya da hic yok (eski tarayici), son yazma tarama
//                anindan payin otesinde gelecekte (kanit sayilmaz) ya da hidepid acik (diger kullanicilarin
//                surecleri gorunmez): sessiz basari yok.
//   kor        = aktif degil, olculemedi degil ama N surec izin yuzunden yalniz komut satirindan denetlendi:
//                metin bunu ek olarak soyler ("kullanilmiyor" kesin degil).
'use strict';

const { kurumZamanMetni } = require('./capraz.cjs');

const KULLANIM_YAZMA_GUN = 7;
const GUN_MS = 86400000;
// Sunucu saati ile tarama saati arasindaki kayma payi; otesindeki "gelecekteki" mtime kanit sayilmaz.
const GELECEK_PAY_MS = GUN_MS;
const OLCULEMEDI_EKI = 'dizin kullanımı ölçülemedi';

const pozitif = (v) =>
  v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;

/** Tarama zamani (ISO / ms) -> ms; okunamazsa null. */
function taramaMs(t) {
  if (t == null || t === '') return null;
  if (typeof t === 'number') return Number.isFinite(t) ? t : null;
  const s = String(t);
  const ms = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(s) || !/T/.test(s) ? s : `${s}Z`);
  return Number.isFinite(ms) ? ms : null;
}

function olculemediNedeni(k, gelecek) {
  if (gelecek) return 'son yazma tarama anından ileri tarihli (saat kayması?) — kanıt sayılmaz';
  if (k.durum === 'YOK' && k.hidepid)
    return `hidepid=${String(k.hidepid).slice(0, 16)}: diğer kullanıcıların süreçleri görünmüyor`;
  return String(k.not || k.durum || '').slice(0, 200);
}

/**
 * @param {object|null|undefined} k  xml_eslesme.kullanim
 * @param {number|string|null} tarama  TARAMA ani (ms ya da ISO; h.ear.taranma). Yoksa simdi (yedek).
 * @param {number} [simdi]  yalniz tarama okunamazsa referans (ms)
 * @returns {{ aktif: boolean, olculemedi: boolean, metin: string, neden: string, kor: string }}
 *   metin: "surec: node pid 76867 [cwd], son yazma: 17.11.2026 00:53" (bilinen parcalar; metin Turkce)
 *   neden: olculemedi ise kisa neden (tarayici notu / eski tarayici / gelecek tarih / hidepid)
 *   kor:   olculemedi degilken izin yuzunden yalniz komut satirindan denetlenen surec sayisi metni ('' = yok)
 */
function kullanimKaniti(k, tarama, simdi = Date.now()) {
  if (!k || typeof k !== 'object') {
    return {
      aktif: false,
      olculemedi: true,
      metin: '',
      neden: 'tarama kullanım ölçmeyen eski tarayıcıyla yapıldı',
      kor: '',
    };
  }
  const ref = taramaMs(tarama) ?? simdi;
  const surecler = (Array.isArray(k.surecler) ? k.surecler : []).filter((p) => p && pozitif(p.pid));
  const surecVar = k.durum === 'VAR' && surecler.length > 0;
  const sonSn = pozitif(k.son_yazma);
  const sonMs = sonSn == null ? null : sonSn * 1000;
  const gelecek = sonMs != null && sonMs - ref > GELECEK_PAY_MS;
  const yakin = sonMs != null && !gelecek && ref - sonMs <= KULLANIM_YAZMA_GUN * GUN_MS;
  const parcalar = [];
  if (surecVar)
    parcalar.push(
      `süreç: ${surecler
        .slice(0, 3)
        .map((p) => `${String(p.comm || '?')} pid ${pozitif(p.pid)} [${String(p.nasil || '?')}]`)
        .join(', ')}${surecler.length > 3 ? ' +' + (surecler.length - 3) : ''}`,
    );
  if (sonMs != null) parcalar.push(`son yazma: ${kurumZamanMetni(sonMs)}`);
  const aktif = surecVar || yakin;
  const gizli = k.durum === 'YOK' && Boolean(k.hidepid);
  const olculemedi = !aktif && (k.durum !== 'YOK' || gelecek || gizli);
  const okunamayan = pozitif(k.okunamayan);
  return {
    aktif,
    olculemedi,
    metin: parcalar.join(', '),
    neden: olculemedi ? olculemediNedeni(k, gelecek) : '',
    kor:
      !aktif && !olculemedi && okunamayan
        ? `${okunamayan} süreç izin yüzünden yalnız komut satırından denetlendi`
        : '',
  };
}

module.exports = {
  KULLANIM_YAZMA_GUN,
  GELECEK_PAY_MS,
  OLCULEMEDI_EKI,
  kullanimKaniti,
  taramaMs,
};
