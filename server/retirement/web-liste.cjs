// server/retirement/web-liste.cjs — retirement hedefinin web (vhost) listesi yardimcilari.
//
// AYNI VHOST IKI KEZ (uretim 2026-10-08, job 3387660 + 3387662): kesif ayni host / conf /
// ServerName'i iki kaynaktan getirebiliyor; liste tekillestirilmediginde web adimi ayni vhost icin
// IKI is baslatiyordu (biri blogu yorumluyor, digeri "zaten yorumlu" diyordu) ve onizleme ayni
// blogu iki kez gosteriyordu. Anahtar: HOST (buyuk harf) | conf yolu | ServerName (kucuk harf).
//
// AYNI DOSYA, IKI YAZIM (2026-10-23, Retirement #27 GBCEPPOSDASHBOARD: her hedefte ayni vhost 4 satir,
// web adimi ayni dosyaya iki is). Sertifika envanteri (ihs.sh) conf_file'a yalniz DOSYA ADINI yazar
// ('mod-jk.conf'); Server Hub DUMP_VHOSTS'un MUTLAK yolunu ('/usr/IBMIHS/conf/mod-jk.conf').
// Esdegerlik BELIRLENIMCI, aday sayimi YOK: ihs.sh yalniz /usr/IBMIHS/conf/<ad> dosyalarini okur
// (FILEPATHS), server_hub_fix.sh dosya_coz da IHS goreli adi IHS_ROOT (/usr/IBMIHS) altinda cozer.
// Yani IHS urunlu goreli 'X' = '/usr/IBMIHS/conf/X' - baska bir kurulumun '<...>/conf/X'i DEGIL
// (ilk tasarim "tek aday" sayiyordu: Server Hub'in gormedigi asil blok yerine baska kokun dosyasina
// baglanabiliyordu, inceleme 2026-10-23). RHA satirlari (redhat_apache.sh) zaten mutlak.
//
// TEKILLESTIRME DURUMA SAYGILI (inceleme 2026-10-23: ilk tasarim "ilk gelen kalir" diyordu - eski
// kayitta isi yapmis 'ok' girdiyi silip geri almayi bozuyor, calisan isi takipsiz birakip ayni dosyaya
// ikinci is aciyor, in-place'te AJP kanitli girdiyi 'elle' girdiye yediriyordu). Bkz. ONCELIK.
'use strict';

const IHS_KOK = '/usr/IBMIHS';

/** Urun ailesi: IHS|IBMIHS -> IHS, RHA|APACHE -> RHA, digerleri ''. (server_hub_fix.sh:28 ile ayni.) */
function urunAilesi(p) {
  const u = String(p || '').trim().toUpperCase();
  if (u === 'IHS' || u === 'IBMIHS') return 'IHS';
  if (u === 'RHA' || u === 'APACHE') return 'RHA';
  return '';
}

/** Girdinin conf dosyasinin kanonik (mutlak) yolu: IHS goreli ad -> /usr/IBMIHS/conf/<ad>; digerleri oldugu gibi. */
function webConfKanonik(w) {
  const c = String((w && w.confFile) || '');
  if (!c || c.includes('/') || urunAilesi(w && w.product) !== 'IHS') return c;
  return `${IHS_KOK}/conf/${c}`;
}

function webAnahtar(w) {
  return `${String(w?.host || '').toUpperCase()}|${String(w?.confFile || '')}|${String(w?.serverName || '').toLowerCase()}`;
}

/** Ayni FIZIKSEL dosya + ServerName + urun ailesi icin ayni anahtar (goreli/mutlak IHS yazimi esit;
 *  IHS ile RHA etiketli girdiler ayri - kesifteki "RHA birlesmez" kuraliyla tutarli). */
function webKanonikAnahtar(w) {
  return `${webAnahtar({ ...w, confFile: webConfKanonik(w) })}|${urunAilesi(w && w.product)}`;
}

const kosmadi = (w) => !!w && (w.status == null || w.status === 'pending') && w.jobId == null;

// KOSMAMIS girdiler arasinda temsilci onceligi: kosacak bekleyen > failed > skip > manual (is acilmamis
// failed: baslatma hatasi; skip: kesif sonradan ekledi; manual: elle/NGINX). Listede olmayan durum (geri
// alma ara durumlari vb.) bilinmeyen sayilir ve hic birlesmez.
const ONCELIK = { pending: 4, '': 4, failed: 3, skip: 2, manual: 1 };
function oncelik(w) {
  const s = w && w.status != null ? String(w.status) : '';
  return Object.prototype.hasOwnProperty.call(ONCELIK, s) ? ONCELIK[s] : null;
}
/** Is acilmis (jobId), dosyayi kapatan/kapatmis (running/ok) ya da durumu bilinmeyen girdi: HIC atilmaz. */
const kalici = (w) => !w || w.jobId != null || w.status === 'running' || w.status === 'ok' || oncelik(w) == null;

/**
 * Ayni fiziksel dosya + ServerName (kanonik anahtar) icin web listesi:
 *  - kalici girdiler (is acilmis / running / ok / bilinmeyen) OLDUGU GIBI kalir - geri alma 'ok'u bulur,
 *    calisan isin sonucu okunur (inceleme 2026-10-23: oncelikle secim kosmus girdiyi atabiliyordu);
 *  - kosmamis kopyalardan TEK temsilci kalir (ONCELIK, esitlikte 'elle' olmayan, sonra ilk gelen); conf
 *    kanonik yola yukselir;
 *  - ayni dosyayi kapatan/kapatmis ('running'/'ok') girdi varsa kosmamis kopyalar duser (ikinci is yok) -
 *    kullanicinin istedigi yeniden deneme (yenidenDene) haric.
 * Atilan sayisi doner (cagiran degisikligi yazip olay dusebilsin).
 */
function webTekille(liste) {
  if (!Array.isArray(liste)) return { liste, atilan: 0 };
  const kapali = new Set(liste.filter((w) => w && (w.status === 'running' || w.status === 'ok')).map(webKanonikAnahtar));
  const temsilci = new Map();
  for (const w of liste) {
    if (kalici(w)) continue;
    const k = webKanonikAnahtar(w);
    if (kapali.has(k) && !w.yenidenDene) continue;
    const t = temsilci.get(k);
    const p = oncelik(w);
    if (!t || p > oncelik(t) || (p === oncelik(t) && t.elle && !w.elle)) temsilci.set(k, w);
  }
  const out = [];
  for (const w of liste) {
    if (kalici(w)) { out.push(w); continue; }
    if (temsilci.get(webKanonikAnahtar(w)) !== w) continue;
    const c = webConfKanonik(w);
    out.push(kosmadi(w) && c !== String(w.confFile || '') ? { ...w, confFile: c } : w);
  }
  return { liste: out, atilan: liste.length - out.length };
}

/**
 * "Web adimini yeniden dene" (onizleme ve uygulama AYNI fonksiyonu kullanir - onizlenen ile kosan ayni).
 * failed/skip girdiler pending'e doner (onceki is numarasi ve mesaj korunur), conf kanonik yola yukselir.
 *  - Ayni dosyada is SURUYORSA ('running') o girdi bu tur yeniden denenmez (eszamanli ikinci is yok).
 *  - Ayni dosyanin birden cok basarisiz yazimi TEK yeniden denemeye iner; digerleri listeden duser.
 *  - Dosyayi zaten kapatmis ('ok') kardes yeniden denemeyi ENGELLEMEZ: is "zaten yorumlu" ile OK doner ve
 *    satir temizlenir (eski davranis; engellenirse dugme kalici takiliyordu - inceleme 2026-10-23).
 * Saf: { liste (yazilacak), secilen (kosacak girdiler, listedeki nesneler), surenYuzunden }.
 */
function webYenidenDeneHazirla(liste) {
  const YENIDEN = new Set(['failed', 'skip']);
  const kaynak = Array.isArray(liste) ? liste : [];
  const suren = new Set(kaynak.filter((w) => w && w.status === 'running').map(webKanonikAnahtar));
  const gorulen = new Set();
  const out = [];
  const secilen = [];
  let surenYuzunden = 0;
  for (const w of kaynak) {
    if (!w || !YENIDEN.has(w.status)) { out.push(w); continue; }
    const k = webKanonikAnahtar(w);
    if (suren.has(k)) { surenYuzunden += 1; out.push(w); continue; }
    if (gorulen.has(k)) continue;
    gorulen.add(k);
    const y = { ...w, oncekiJobId: w.jobId ?? null, oncekiMesaj: w.message ?? null, status: 'pending', jobId: null,
      message: 'yeniden denenecek', yenidenDene: true, confFile: webConfKanonik(w) };
    out.push(y);
    secilen.push(y);
  }
  return { liste: out, secilen, surenYuzunden };
}

module.exports = { webAnahtar, webKanonikAnahtar, webConfKanonik, urunAilesi, webTekille, webYenidenDeneHazirla, IHS_KOK };
