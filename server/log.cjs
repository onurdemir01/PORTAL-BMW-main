// server/log.cjs — SUREC ICI log dosyasi ve boyut tabanli ROTASYON.
//
// SORUN: rotasyon `deploy/run.sh` icinde bir kabuk fonksiyonuydu ve YALNIZCA surec
// BASLARKEN calisiyordu (`rotate_log_if_needed`, start_env'den bir kez). Uzun sure
// ayakta kalan bir prod sureci `logs/<env>.out` dosyasini bir sonraki yeniden
// baslatmaya kadar SINIRSIZ buyutuyordu — haftalarca ayakta kalan bir surecte disk
// dolabilir.
//
// NEDEN KABUKTAN COZULEMEZ: dosyayi kabuk yonlendirmesi (`>> "$OUT_FILE"`) aciyor ve
// fd'yi SUREC tutuyor. Disaridan `mv` yapmak dosyayi yeniden adlandirir ama surec
// AYNI inode'a yazmaya devam eder: yeni dosya bos kalir, eski dosya buyumeye devam
// eder ve rotasyon SESSIZCE hicbir sey yapmamis olur. Rotasyonun ise yaramasi icin
// dosyayi YAZAN surecin sahiplenmesi gerekir. Bu modul tam olarak bunu yapar.
//
// NEDEN `console.*` SARMALANIYOR: sunucuda 348 `console.*` cagrisi var ve hepsi
// `[Modul]` onekli anlamli satirlar. Hepsini bir logger API'sine cevirmek buyuk ve
// riskli bir degisiklik olurdu; oysa cozulmesi gereken sey MESAJLARIN BICIMI degil
// NEREYE YAZILDIGI. Sarmalayici mesaji DEGISTIRMEZ, yalnizca hedefe ekler.
//
// KURAL: LOGLAMA UYGULAMAYI ASLA DUSURMEZ. Dosya acilamaz, disk dolar ya da yazma
// patlarsa modul kendini KAPATIR (bir kez uyarir) ve uygulama hicbir sey olmamis gibi
// devam eder. Log kaybi, hizmet kaybindan iyidir.
'use strict';

const fs = require('fs');
const path = require('path');

const MB = 1024 * 1024;

// Varsayilanlar BILEREK kabuk rotasyonuyla ayni: davranis degismesin, yalnizca
// rotasyonun NE ZAMAN calistigi degissin (baslangicta -> surekli).
const DEFAULT_MAX_BYTES = 20 * MB;
const DEFAULT_KEEP = 5;

// BOS/AYARSIZ DEGER "0" DEGILDIR.
//
// Ilk surum `Number(String(raw ?? '').trim())` yaziyordu ve ayarlanmamis bir env
// degiskeni `''` → `Number('')` → **0** uretiyordu. 0 SONLU oldugu icin `fallback`
// dali hic calismiyor, deger alt sinira kelepceleniyordu: hicbir ayar yapilmamis
// bir uretim kurulumunda esik 20 MB yerine **64 KB**, saklanan dosya sayisi 5 yerine
// **1** oluyordu — yani rotasyon calisiyor gorunurken log neredeyse hic tutulmuyordu.
// (Bekci LR8 ile yakalandi.)
function numEnv(raw, fallback, { min, max }) {
  const text = String(raw ?? '').trim();
  if (text === '') return fallback;
  const n = Number(text);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// Modul durumu. `install()` bir kez cagrilir; ikinci cagri sessizce yok sayilir
// (test/hot-reload ortaminda cift sarmalama, her satiri IKI kez yazardi).
let installed = false;
let fd = null;
let bytes = 0;
let broken = false;
let cfg = null;
let original = null;

function reportOnce(message, err) {
  if (broken) return;
  broken = true;
  try {
    // Orijinal stderr'e yazilir: sarmalayiciyi kullanmak sonsuz donguye girerdi.
    process.stderr.write(`[log] dosya loglamasi devre disi: ${message}: ${err?.message || err}\n`);
  } catch {
    /* stderr de yoksa yapacak bir sey yok */
  }
  closeQuietly();
}

function closeQuietly() {
  if (fd == null) return;
  try {
    fs.closeSync(fd);
  } catch {
    /* zaten kapali olabilir */
  }
  fd = null;
}

function openFile() {
  fs.mkdirSync(path.dirname(cfg.file), { recursive: true });
  fd = fs.openSync(cfg.file, 'a');
  // Mevcut boyutu bir kez oku; sonrasinda yazilan bayt sayisiyla ilerletilir.
  // Her yazimda `fstat` cagirmak, satir basina fazladan bir sistem cagrisi demekti.
  bytes = fs.fstatSync(fd).size;
}

// Eski rotasyonlari budar. En YENI `keep` tanesi kalir.
function prune() {
  const dir = path.dirname(cfg.file);
  const base = path.basename(cfg.file);
  const rotated = fs
    .readdirSync(dir)
    // `-N` son eki de sayilir (bkz. `rotationTarget`: ayni saniyedeki cakisma).
    // Siralamada `...05815` < `...05815-2` cunku ayni onekte UZUN olan sonra gelir —
    // yani ayni saniye icinde uretilenler de dogru sirada.
    .filter((n) => n.startsWith(`${base}.`) && /\.\d{14}(-\d+)?$/.test(n))
    .sort()
    .reverse();
  for (const stale of rotated.slice(cfg.keep)) {
    try {
      fs.unlinkSync(path.join(dir, stale));
    } catch {
      /* baskasi silmis olabilir */
    }
  }
}

// `YYYYMMDDHHmmss` — SIRALANABILIR olmasi sart: `prune` ada gore siraliyor.
// `toISOString` UTC verir; rotasyon adinin yerel saate gore okunmasi gerekmiyor,
// siralamanin dogru olmasi gerekiyor.
function stamp(d = new Date()) {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

// CAKISMA GUVENLI hedef ad. Damga SANIYE cozunurlukludur; yogun bir surecte ayni
// saniye icinde birden fazla rotasyon olabilir ve `rename` hedefi SESSIZCE EZER —
// olculdu: 64KB esikle ~18 rotasyon beklenen bir kosuda geriye TEK dosya kaldi,
// digerlerinin tamami kaybolmustu. Ad zaten varsa `-2`, `-3` ... eklenir.
function rotationTarget() {
  const base = `${cfg.file}.${stamp()}`;
  if (!fs.existsSync(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  // 1000 rotasyon/saniye gercekci degil; yine de sessizce EZMEK yerine son adi
  // dondururuz (kayip tek dosyayla sinirli kalir).
  return `${base}-999`;
}

function rotate() {
  closeQuietly();
  const target = rotationTarget();
  try {
    fs.renameSync(cfg.file, target);
  } catch (err) {
    // Dosya baskasi tarafindan tasinmis olabilir; yeniden acmayi yine deneriz.
    if (err && err.code !== 'ENOENT') throw err;
  }
  prune();
  openFile();
}

function writeLine(line) {
  if (broken || fd == null) return;
  try {
    const buf = Buffer.from(line, 'utf8');
    // ONCE ROTASYON, SONRA YAZIM: esik asildiktan sonra yazmak, her rotasyonda
    // dosyanin bir satir kadar esigi asmasina yol acardi (onemsiz ama gereksiz).
    if (bytes + buf.length > cfg.maxBytes && bytes > 0) rotate();
    fs.writeSync(fd, buf);
    bytes += buf.length;
  } catch (err) {
    reportOnce('yazma basarisiz', err);
  }
}

// `console.*` argumanlarini tek bir satira cevirir. `util.format` kullanilmaz:
// `console.log("%s", x)` gibi bicimlendirme zaten ORIJINAL console tarafindan
// stdout'a uygulaniyor; burada amac okunabilir bir DOSYA satiri.
function formatArgs(args) {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack || a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

const LEVELS = ['log', 'warn', 'error', 'info', 'debug'];

/**
 * `console.*` cagrilarini surec ici, boyut tabanli rotasyonlu bir dosyaya da yazar.
 *
 * `toStdout` VARSAYILANI ORTAMA GORE:
 *   - production: KAPALI. `deploy/run.sh` stdout'u `logs/<env>.out`a yonlendiriyor;
 *     acik birakmak AYNI satirlari iki dosyaya yazmak ve `<env>.out`un SINIRSIZ
 *     buyumesi demekti — yani cozulen sorunun aynisi geri gelirdi. Kapali olunca
 *     `<env>.out` yalnizca bu modul kurulmadan ONCEKI cikti ile sert cokmelere
 *     ait satirlari tutar ve kendiliginden kucuk kalir.
 *   - digerleri (gelistirme): ACIK. Gelistirici terminalde log gormeye devam eder.
 */
function install(opts = {}) {
  if (installed) return { ok: true, alreadyInstalled: true };

  const root = opts.root || path.join(__dirname, '..');
  const envName = String(opts.envName || process.env.APP_ENV || 'dev').trim() || 'dev';
  const isProd = String(process.env.NODE_ENV || '') === 'production';

  cfg = {
    file:
      String(process.env.LOG_FILE || '').trim() ||
      path.join(
        String(process.env.LOG_DIR || '').trim() || path.join(root, 'logs'),
        `${envName}.app.log`,
      ),
    maxBytes: numEnv(process.env.LOG_MAX_BYTES, DEFAULT_MAX_BYTES, {
      min: 64 * 1024,
      max: 512 * MB,
    }),
    keep: numEnv(process.env.LOG_KEEP, DEFAULT_KEEP, { min: 1, max: 50 }),
    toStdout:
      String(process.env.LOG_TO_STDOUT || '').trim() === '1'
        ? true
        : String(process.env.LOG_TO_STDOUT || '').trim() === '0'
          ? false
          : !isProd,
  };

  if (String(process.env.LOG_DISABLED || '').trim() === '1') {
    return { ok: false, disabled: true };
  }

  try {
    openFile();
  } catch (err) {
    reportOnce('dosya acilamadi', err);
    return { ok: false, error: String(err?.message || err) };
  }

  original = {};
  for (const level of LEVELS) {
    original[level] = console[level].bind(console);
    console[level] = (...args) => {
      if (cfg.toStdout) original[level](...args);
      writeLine(`${new Date().toISOString()} [${level.toUpperCase()}] ${formatArgs(args)}\n`);
    };
  }
  installed = true;
  return {
    ok: true,
    file: cfg.file,
    maxBytes: cfg.maxBytes,
    keep: cfg.keep,
    toStdout: cfg.toStdout,
  };
}

// Testler icin: sarmalamayi geri al ve dosyayi kapat.
function uninstall() {
  if (!installed) return;
  for (const level of LEVELS) console[level] = original[level];
  closeQuietly();
  installed = false;
  broken = false;
  original = null;
  cfg = null;
}

module.exports = {
  install,
  uninstall,
  // saf/ic yardimcilar — birim testleri icin acildi
  stamp,
  formatArgs,
  numEnv,
  DEFAULT_MAX_BYTES,
  DEFAULT_KEEP,
};
