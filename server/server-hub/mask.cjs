// server/server-hub/mask.cjs - Server Hub maskelemesinin UCUNCU katmani (sozlesme v3, kural 9).
//
// Katmanlar: (1) tarayici finalize (awk, alan bazli), (2) loader (Python), (3) burasi.
// Uc uygulama AYNI desenlerle ve AYNI ortak vaka listesiyle esdegerligi sinanir
// (__tests__/fixtures/mask_cases.json; Ansible deposunda server_hub_mask_cases.tsv).
// Liste 14 sozlesme vakasi + dalga 1 duzeltmesinin M1-M3 vakalari (15-19) + Unicode anahtar/kullanici
// adi vakalari (20-25, 32, 33; T2-M1) + jvm_arg_diff vakalari (26-31, tur 'jvm_arg_diff', T2-M2) +
// 34 (literal '<password value=...>', R8a) + 35-40 (jvm_arg_diff bicimsiz oge ve devam kurali, #5).
//
// NEREYE UYGULANIR (sozlesme maskeleme.serbest_metin_alanlari):
//   - desen maskesi (R1-R7) YALNIZ serbest metin alanlarina: HOST.note, JBOSS.note,
//     JBOSS.cli_rescue, WEB.detail, DEPLOY.note, JVMERR.message, LoadIssues.detail
//   - beyaz liste YALNIZ jvm_args ailesine: jvm_args, configured_jvm_args, jvm_arg_diff
//   - listen / server_name / aliases / access_log / proxy_targets / conf_file / ports ve
//     kimlik alanlarina HIC uygulanmaz ('passport-be.bmw.de:8443' -> ':***' olur ve
//     assess.cjs parseTargets hedefi dusururdu).
//
// DESENLERDE '[ ]' VAR, '\s' YOK: Portal her alani ayri ayri maskeler; yine de desen sekmeyi
// asmamali (vaka 13). '\s' sekmeyi de eslerdi.
//
// KORLUK (README'de de yazili): anahtar adi olmayan konumsal sir (base64 blob,
// '-jar x.jar <parola>'), beyaz listedeki bir onekin altina konmus ve anahtar ERE'sine uymayan
// sir (-Djboss.x.hiddenValue=...), -X/-XX degerine gomulu sir ve anahtar adi listede olmayan
// serbest 'k=v' yakalanmaz.
'use strict';

/** Anahtar ERE'si (buyuk/kucuk harf duyarsiz). R7 genislemesi dahil; R1, R2, R6 paylasir. */
const KEY_ERE =
  '(pass(word|wd|phrase)?|pwd|secret|token|credential|' +
  '(access|license|signing|encryption|private|api|client|master|auth)[_.-]?key|' +
  'key[_.-]?(store|pass)[_.-]?pass(word)?|keypass|storepass|truststore[_.-]?pass(word)?)';

/**
 * UNICODE (T2-M1, uc katmanda ayni; loader server_hub_loader.py ve tarayici awk ile bire bir):
 *  - Buyuk/kucuk harf katlamasi YALNIZ ASCII: bayrak 'i', 'u' YOK (JS 'u'suz 'i' ASCII disi harfi
 *    ASCII harfe katlamaz). Loader re.I | re.A, awk LC_ALL=C + tolower ile ayni.
 *  - GUVENLI YON: dort harf anahtar kelimelerde (KEY_ERE, R4, R8a, R8b) ACIKCA esdegerdir:
 *    i -> (i|U+0130|U+0131), s -> (s|U+017F), k -> (k|U+212A). 'AP<U+0130>_KEY=abc' -> '...=***'
 *    (Java Locale tr toUpperCase/toLowerCase ciktisi). Eskiden yalniz loader (Python re.I'nin
 *    Unicode katlamasiyla) maskeliyordu; Portal ve tarayici sirri acik birakiyordu.
 *  - Kullanici / anahtar-adi siniflari (R2 son eki, R5 kullanici) ASCII DISI her karakteri kapsar
 *    ('kullan<U+0131>c<U+0131>/Parola9@dbhost' -> '.../***@dbhost'). JS'te UTF-16 birimi araligi
 *    U+0080-U+FFFF (vekil ciftinin iki yarisi da icinde), loader'da U+0080-U+10FFFF, awk'ta bayt
 *    araligi 0x80-0xFF. Ortak vakalar 20-25, 32 (astral harf), 33 (R4/R8a/R8b katlamasi).
 * Bu dosya ASCII kalir (lint:ascii): Unicode harfler String.fromCharCode ile uretilir.
 */
const KATLAMA = Object.freeze({
  i: `(?:i|${String.fromCharCode(0x130)}|${String.fromCharCode(0x131)})`,
  s: `(?:s|${String.fromCharCode(0x17f)})`,
  k: `(?:k|${String.fromCharCode(0x212a)})`,
});
/** Anahtar kelime ERE'sinde i/s/k harflerini Unicode esdegerleriyle genisletir (harfler yalniz duz metin). */
function katla(ere) {
  let o = '';
  for (const c of ere) o += Object.prototype.hasOwnProperty.call(KATLAMA, c) ? KATLAMA[c] : c;
  return o;
}
const ASCII_DISI = `${String.fromCharCode(0x80)}-${String.fromCharCode(0xffff)}`;
const KEY_KATLI = katla(KEY_ERE);

/**
 * Serbest metin desenleri, sozlesmedeki sirayla. JS cevirisi: '\1' -> '$1', bayrak 'gi'.
 * Her desende 1. grup DIS gruptur (korunacak onek).
 *
 * ORTAK MASKE KARARI (dalga 1 duzeltmesi, uc uygulamada ayni):
 *   M1 R2'nin degeri TIRNAKLI degeri de kapsar: deger = ("[^"]*"|[^ ,;&"]+). Tirnakliysa
 *      tirnaklar korunur, ici '***' olur: 'x password="S3cr3t" y' -> 'x password="***" y'.
 *      Eskiden deger sinifi tirnakla baslayan degeri hic eslemiyordu (sir duz kaliyordu).
 *   M2 XML bicimi (JBoss host-slave.xml server-identities, datasource):
 *      '<secret value="abc"/>' -> '<secret value="***"/>' (ayni kural <password value=...>),
 *      '<password>abc</password>' -> '<password>***</password>'.
 *   M3 jvm_args'ta -X ve -D disindaki belirtecler serbest metin desenlerinden gecer
 *      (maskJvmArgs; bu dosyada zaten boyleydi, vakalar ortak listeye eklendi).
 * 'yerine' bir islev olabilir (String.prototype.replace ile ayni imza).
 */
const R2_ONEK = '(' + KEY_KATLI + '[A-Za-z0-9_' + ASCII_DISI + ']*[ ]*[=:][ ]*)';
const DESENLER = Object.freeze([
  { ad: 'R1', desen: '(-D[^= ]*' + KEY_KATLI + '[^= ]*=)[^ ]+', yerine: '$1***' },
  {
    ad: 'R2',
    desen: R2_ONEK + '("[^"]*"|[^ ,;&"]+)',
    // tirnakli deger: tirnaklar kalir, ici '***'; tirnaksiz: '***'
    yerine: (tam, onek) => onek + (tam.slice(onek.length).startsWith('"') ? '"***"' : '***'),
  },
  { ad: 'R3', desen: '(://[^/:@ ]+:)[^@/ ]+@', yerine: '$1***@' },
  {
    ad: 'R4',
    desen: '(-{1,2}(' + katla('password|pwd|pass') + ')[ =]+)[^ -][^ ]*',
    yerine: '$1***',
  },
  { ad: 'R5', desen: '([A-Za-z0-9_$#.' + ASCII_DISI + '-]+/)[^@/ "]+@', yerine: '$1***@' },
  { ad: 'R6', desen: '("[^"]*' + KEY_KATLI + '[^"]*" *=> *")[^"]*"', yerine: '$1***"' },
  { ad: 'R8a', desen: '(<(' + katla('secret|password') + ')[^>]*value=")[^"]*"', yerine: '$1***"' },
  {
    ad: 'R8b',
    desen: '(<' + katla('password') + '>)[^<]*(</' + katla('password') + '>)',
    yerine: '$1***$2',
  },
]);

// 'u' bayragi YOK (bilincli): ASCII disi harf ASCII harfe katlanmaz; esdegerler yalniz katla()'dan.
const DERLI = DESENLER.map((d) => ({ re: new RegExp(d.desen, 'gi'), yerine: d.yerine }));
// 'g' bayraksiz: test() lastIndex durumu tasimasin.
const KEY_RE = new RegExp(KEY_KATLI, 'i');

/**
 * jvm_args beyaz listesi (sozlesmede DONUK; genisletme yalniz sozlesme surumuyle).
 * -D anahtari bu oneklerden biriyle basliyor VE anahtar ERE'sine uymuyorsa deger acik kalir.
 */
const BEYAZ_LISTE = Object.freeze([
  'java.',
  'javax.management.',
  'sun.',
  'jboss.',
  'org.jboss.',
  'org.wildfly.',
  'file.encoding',
  'user.timezone',
  'user.language',
  'user.country',
  'user.region',
  'logging.configuration',
  'java.util.logging.manager',
  'com.sun.management.jmxremote.port',
  'com.sun.management.jmxremote.ssl',
  'com.sun.management.jmxremote.authenticate',
  'networkaddress.cache.ttl',
  'jdk.tls.client.protocols',
  'https.protocols',
]);

/** -D anahtarinin degeri acik kalabilir mi: once ERE (sir), sonra beyaz liste. */
function degerAcik(anahtar) {
  const k = String(anahtar || '');
  if (KEY_RE.test(k)) return false;
  return BEYAZ_LISTE.some((p) => k.startsWith(p));
}

function maskAlan(alan) {
  let out = alan;
  for (const d of DERLI) out = out.replace(d.re, d.yerine);
  return out;
}

/**
 * Serbest metin alani: R1-R6 + R8 (XML; R7 ERE icinde). null/undefined oldugu gibi doner.
 * ALAN BAZLI: sekme bir alan siniridir (vaka 13). R2'nin deger sinifi '[^ ,;&"]' sekmeyi
 * dislamaz; sekmeyi asip SONRAKI alani yutmasin diye her parca ayri maskelenir.
 */
function maskText(s) {
  if (s == null) return s;
  return String(s).split('\t').map(maskAlan).join('\t');
}

/**
 * jvm_args / configured_jvm_args: belirtec bazli BEYAZ LISTE.
 *   -X*, -XX:*            -> acik
 *   -Dk=v                 -> k ERE'ye uyuyorsa ya da beyaz listede degilse '-Dk=***'
 *   -Dk (esittirsiz)      -> oldugu gibi
 *   diger belirtecler     -> serbest metin deseni (temkinli taraf)
 * Bosluklar korunur (split/join ' ').
 */
function maskJvmArgs(s) {
  if (s == null) return s;
  return String(s)
    .split(' ')
    .map((tok) => {
      if (!tok) return tok;
      if (tok.startsWith('-X')) return tok;
      if (tok.startsWith('-D')) {
        const eq = tok.indexOf('=');
        if (eq < 0) return tok;
        const anahtar = tok.slice(2, eq);
        return degerAcik(anahtar) ? tok : `-D${anahtar}=***`;
      }
      return maskText(tok);
    })
    .join(' ');
}

/** jvm_arg_diff ogesi: anahtar ilk bosluga kadar, ' running=' ve SON ' configured=' (acgozlu, 's'). */
const DIFF_OGE = /^([^ ]+) running=(.*) configured=(.*)$/s;
const DIFF_KESME = / \.\.\.\+[0-9]+$/;

/** -D oneki atilmis anahtar adi (beyaz liste karari -D'siz ad uzerinden verilir). */
const dAdi = (anahtar) => (anahtar.startsWith('-D') ? anahtar.slice(2) : anahtar);

/**
 * jvm_arg_diff (T2-M2 + #5): loader maske_jvm_diff ve tarayici jd() ile bire bir, DAHA COK maskeleyen yon.
 *   'partial; ' oneki korunur; 'reason=<SEBEP>...' metni serbest metin maskesinden gecer;
 *   sondaki ' ...+N' kesme isareti korunur; kalan '; ' ile ogelere bolunur:
 *   '<anahtar> running=<v> configured=<v>' ve anahtar -X DEGIL -> beyaz liste karari (-D oneki
 *       atilarak); liste disi ya da sir anahtarinda '<anahtar> running=*** configured=*** (farkli)'
 *   -X ogesi (bu bicimde) -> serbest metin maskesi (maskText).
 *   BICIMSIZ oge (#5: degerdeki '; ' ogeyi boler, ' running=' / cift bosluk bicimi bozar): ilk
 *       belirtec (ilk bosluga kadar) -D atilarak acik degilse (degerAcik: sir ERE'si ya da beyaz liste
 *       disi) belirtec maskText'ten gecer, ilk bosluktan sonrasi '***'; boslugu yoksa ya da belirteci
 *       aciksa maskText.
 *   DEVAM: gizlenen ogeden (yapisal sir/liste disi ya da gizlenen bicimsiz oge) sonraki bicimsiz
 *       ogeler o degerin parcasidir -> TAMAMEN '***'; devam yalniz yapisal bir ogede biter.
 *       '-Ddb.password running=a; b configured=c; d' -> '-Ddb.password ***; ***; ***'.
 * Eskiden -X ogesi duz birakiliyordu ve loader yalniz '-D' ogelerini isliyordu
 * ('reason=CLI_FAIL password=x', 'k running=password=x configured=y', 'garbage token=abc'
 * loader'da duz kaliyordu); tur 3'e dek bicimsiz oge yalniz serbest maskeden gecip anahtarli sirri
 * ('-Ddb.password running=Gizli1') uc katmanda acik birakiyordu. '\S' yerine '[^ ]': JS ve Python
 * bosluk kumeleri farkli. Ortak vakalar 26-31, 35-40.
 */
function maskJvmArgDiff(s) {
  if (s == null) return s;
  let govde = String(s);
  if (!govde) return govde;
  let onek = '';
  if (govde.startsWith('partial; ')) {
    onek = 'partial; ';
    govde = govde.slice('partial; '.length);
  }
  if (govde.startsWith('reason=')) return onek + maskText(govde);
  let son = '';
  const kes = DIFF_KESME.exec(govde);
  if (kes) {
    son = kes[0];
    govde = govde.slice(0, kes.index);
  }
  let devam = false;
  const ogeler = govde.split('; ').map((oge) => {
    const m = DIFF_OGE.exec(oge);
    if (m) {
      const anahtar = m[1];
      devam = false;
      if (anahtar.startsWith('-X')) return maskText(oge);
      if (degerAcik(dAdi(anahtar))) return oge;
      devam = true;
      return `${anahtar} running=*** configured=*** (farkli)`;
    }
    if (devam) return '***';
    const bosluk = oge.indexOf(' ');
    if (bosluk < 0) return maskText(oge);
    const ilk = oge.slice(0, bosluk);
    if (degerAcik(dAdi(ilk))) return maskText(oge);
    devam = true;
    return `${maskText(ilk)} ***`;
  });
  return onek + ogeler.join('; ') + son;
}

module.exports = {
  KEY_ERE,
  KATLAMA,
  katla,
  DESENLER,
  BEYAZ_LISTE,
  maskText,
  maskJvmArgs,
  maskJvmArgDiff,
  degerAcik,
};
