// server/audit/spool.cjs — DB yazilamadiginda denetim kaydini DISKE al, sonra aktar.
//
// NEDEN VAR (2026-09-18 uretim): `portal_audit_logs`a yazim bes saat boyunca
// dustu ve **25 kayit KALICI OLARAK KAYBOLDU**:
//     [ERROR] [audit:portal_audit_logs] write failed:
//             The transaction log for database '...' is full due to 'LOG_BACKUP'
// `writeEntry` hatayi yakalayip LOGLUYOR ve yutuyordu; kuyruk yok, yeniden deneme
// yok. Oysa `docs/DEPLOYMENT.md` acikca "kayit, ayar, oturum, tercih, sohbet,
// AUDIT hicbir sey kaybolmaz" diyor.
//
// Denetim kaydi icin `log.cjs`in felsefesi TERSINE cevrilir: orada "log kaybi
// hizmet kaybindan iyidir"; burada kayip KABUL EDILEMEZ. Hash zinciri kurcalamaya
// karsi bir garantidir ve sessizce kayip veren bir zincir o garantiyi yok eder —
// silinen kayit, kurcalamadan ayirt edilemez hale gelir.
//
// ── EN KRITIK TASARIM KARARI ────────────────────────────────────────────────
// Spool HAM GIRDIYI saklar, HESAPLANMIS HASH'I DEGIL.
//
// `prev_hash` o anda DB'de duran SON kaydin hash'ine baglidir. Kayit spool'da
// beklerken baska kayitlar DB'ye yazilabilir; spool'da hesaplanmis bir hash
// aktarim aninda ZATEN YANLIS olurdu ve `verifyChain` zinciri KIRIK raporlardi.
// Bu yuzden hash yalnizca AKTARIM aninda, gercek `prev_hash` ile hesaplanir.
//
// ── BELLEK KAPILARI (2026-09-20) ────────────────────────────────────────────
// Bu dosyanin ILK hali (PR #107) OOM'a karsi yazilmisti ama KENDISI sinirsizdi:
// `depth()` ve `drain()` TUM dosyayi `readFileSync` + `split('\n')` ile bellege
// aliyordu, `append()`te ise boyut/satir tavani ve rotasyon YOKTU. Ustelik
// spool satirlarinda `detail` KIRPILMIYORDU (2000 karakter kirpmasi yalnizca
// `writeEntry` icinde), yani spool satirlari DB satirlarindan DAHA BUYUKTU.
//
// `depth()` her 5 dakikada bir cagriliyor (`audit/index.cjs`). 2026-09-18
// kesintisi BES SAAT surdu. Bes saatlik tam portal trafigi yuzlerce MB olabilir
// ve `split('\n')` onu dosya boyutunun 3-4 kati heap'e acardi — yani OOM'a karsi
// yazilmis modul, DB kesintisinin tam ortasinda OOM'u KENDISI tetiklerdi.
//
// Uc kapi konuldu: satir basina bayt tavani, dosya basina bayt tavani, ve
// hicbir okuma yolunun dosyayi bellege almamasi (akis tabanli `depth`/`drain`).
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/** Tek bir spool satirinin tavani. Asan girdinin `detail`i kirpilir, girdi ATILMAZ. */
const SPOOL_MAX_LINE_BYTES = 16 * 1024;
/** Spool dosyasinin tavani. Asildiginda yeni girdi KABUL EDILMEZ (bkz. append). */
const SPOOL_MAX_BYTES = 64 * 1024 * 1024;
/** Tek bir `drain` turunda aktarilacak en fazla satir — tur sonsuza kosmasin. */
const DRAIN_BATCH_LINES = 5000;

// Spool dosyasi log dizininde durur — `log.cjs` ile AYNI cozumleme (LOG_DIR ya da
// <repo>/logs). Ayri bir dizin, dagitim betiklerinde ikinci bir izin/temizlik
// kurali demek olurdu.
function spoolPath(tableName) {
  const root = path.join(__dirname, '..', '..');
  const dir = String(process.env.LOG_DIR || '').trim() || path.join(root, 'logs');
  return path.join(dir, `audit-spool.${tableName}.ndjson`);
}

function dosyaBoyutu(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Girdiyi tek satira cevirir ve SPOOL_MAX_LINE_BYTES'i asmayacak sekilde kirpar.
 *
 * KIRPILAN SEY `detail`DIR, girdinin kendisi DEGIL: kim/ne/ne zaman alanlari
 * denetimin ozudur ve asla dusurulmez. Kirpma oldugunda `detail` icine ACIKCA
 * yazilir — sessiz kirpma, kurcalamadan ayirt edilemez.
 */
function satiraCevir(entry) {
  const ham = JSON.stringify({ ts: new Date().toISOString(), entry });
  if (Buffer.byteLength(ham, 'utf8') <= SPOOL_MAX_LINE_BYTES) return ham;

  const kirpik = { ...entry };
  // `detail`i kademeli kucult: once tamamen at, sonra bir aciklama koy. Once
  // olcup sonra dilimlemek, cok baytli karakterlerde yanlis uzunluk verirdi.
  kirpik.detail = '[PORTAL] detail bellek korumasi nedeniyle KIRPILDI';
  const taban = JSON.stringify({ ts: new Date().toISOString(), entry: kirpik });
  const tabanBayt = Buffer.byteLength(taban, 'utf8');
  if (tabanBayt > SPOOL_MAX_LINE_BYTES) {
    // `detail` disindaki alanlar bile tavani asiyor — girdiyi yine de saklariz,
    // cunku kaybetmek daha kotu; ama bu durum gorunur olmali.
    console.error(
      '[audit:spool] girdi `detail` disinda da tavani asiyor, oldugu gibi yaziliyor:',
      tabanBayt,
    );
    return taban;
  }
  // Kalan bosluga orijinal `detail`in bas kismini sigdir.
  const bosluk = SPOOL_MAX_LINE_BYTES - tabanBayt - 64;
  if (bosluk > 0) {
    const ozgun = String(entry?.detail ?? '');
    const dilim = Buffer.from(ozgun, 'utf8').subarray(0, bosluk).toString('utf8');
    kirpik.detail = `${dilim}… [PORTAL] KIRPILDI`;
    const aday = JSON.stringify({ ts: new Date().toISOString(), entry: kirpik });
    if (Buffer.byteLength(aday, 'utf8') <= SPOOL_MAX_LINE_BYTES) return aday;
  }
  return taban;
}

/** Bir girdiyi spool'a ekler. Basarisizsa `false` doner — cagiran SUSMAZ. */
function append(tableName, entry) {
  const file = spoolPath(tableName);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });

    // DOSYA TAVANI. Asildiginda YENI girdi reddedilir; ESKILER silinmez.
    //
    // Neden en eskiyi atip yer acmiyoruz: hash zinciri SIRALI bir yapidir ve
    // ortadan kayit dusurmek zinciri kurcalamadan ayirt edilemez hale getirir.
    // Reddetmek, elimizdeki en eski KESINTISIZ on eki korur. Her iki halde de
    // kayip vardir; bu secim kaybi GORUNUR ve SINIRLI tutar.
    if (dosyaBoyutu(file) >= SPOOL_MAX_BYTES) {
      console.error(
        `[audit:${tableName}] KAYIT KAYBI — spool tavana ulasti ` +
          `(${Math.round(SPOOL_MAX_BYTES / (1024 * 1024))} MB, ${file}). ` +
          'DB yazimi cok uzun suredir dusuk; once DB duzeltilmeli.',
      );
      return false;
    }

    // NDJSON: satir satir eklenebilir, yarim yazilmis son satir okuma sirasinda
    // atilabilir. Tam dosya JSON'u olsaydi her ekleme tum dosyayi yeniden yazardi.
    fs.appendFileSync(file, satiraCevir(entry) + '\n');
    return true;
  } catch (err) {
    // SON CARE DE DUSTU. Burada yapacak bir sey kalmiyor ama SESSIZ KALMAYIZ:
    // bu satir "denetim kaydi gercekten kayboldu" demektir ve oyle okunmali.
    console.error(
      `[audit:${tableName}] KAYIT KAYBI — spool'a da yazilamadi (${file}):`,
      err.message,
    );
    return false;
  }
}

/**
 * Spool'da bekleyen kayit sayisi. Gorunurluk icin; dosya yoksa 0.
 *
 * DOSYAYI BELLEGE ALMAZ: sabit boyutlu bir tamponla okuyup yalnizca satir sonu
 * sayar. Eski hali `readFileSync` + `split('\n')` yapiyordu ve bu fonksiyon HER
 * 5 DAKIKADA cagriliyor — yani spool buyudukce duzenli araliklarla OOM riski
 * ureten yer burasiydi.
 */
function depth(tableName) {
  const file = spoolPath(tableName);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return 0;
  }
  try {
    const tampon = Buffer.allocUnsafe(64 * 1024);
    let sayi = 0;
    let okunan;
    while ((okunan = fs.readSync(fd, tampon, 0, tampon.length, null)) > 0) {
      for (let i = 0; i < okunan; i++) if (tampon[i] === 0x0a) sayi++;
    }
    return sayi;
  } catch {
    return 0;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* yoksay */
    }
  }
}

/** Dosyayi satir satir, BELLEGE ALMADAN gezer. */
async function* satirlariOku(file) {
  const akis = fs.createReadStream(file, { encoding: 'utf8' });
  try {
    const rl = readline.createInterface({ input: akis, crlfDelay: Infinity });
    for await (const satir of rl) {
      if (satir.trim()) yield satir;
    }
  } finally {
    akis.destroy();
  }
}

/**
 * Spool'u DB'ye aktarir. `writeOne` bir girdiyi yazar ve BASARILIYSA true doner.
 *
 * SIRA KORUNUR: girdiler yazildiklari SIRAYLA aktarilir; hash zinciri sirali bir
 * yapidir ve karisik sirayla aktarim zinciri anlamsiz kilardi.
 *
 * ILK BASARISIZLIKTA DURUR: bir kayit yazilamadiysa DB hala bozuktur; kalanlari
 * denemek hem bosuna hem de SIRAYI bozar. Kalanlar dosyada kalir, sonraki turda
 * bastan denenir.
 *
 * DOSYAYI BELLEGE ALMAZ: iki akis gecisi yapar — once aktarim, sonra kalanlari
 * gecici bir dosyaya kopyalayip `rename`. Eski hali tum dosyayi okuyup
 * `split('\n')` + `slice` + `join` yapiyordu; ayni icerik ayni anda heap'te DORT
 * kopya halinde durabiliyordu.
 */
async function drain(tableName, writeOne) {
  const file = spoolPath(tableName);
  if (!dosyaBoyutu(file)) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* yoksay */
    }
    return { drained: 0, remaining: 0 };
  }

  let aktarilan = 0;
  let durdu = false;
  for await (const satir of satirlariOku(file)) {
    // TUR TAVANI: tek cagri sonsuza kosmasin, sonraki tur kaldigi yerden devam eder.
    if (aktarilan >= DRAIN_BATCH_LINES) {
      durdu = true;
      break;
    }
    let kayit;
    try {
      kayit = JSON.parse(satir);
    } catch {
      // BOZUK SATIR ATLANMAZ, SAYILIR. Yarim yazilmis bir satiri sessizce atmak
      // "kayip yok" yalanini soylerdi. Aktarilmis sayilir ki dosyadan dussun,
      // ama ACIKCA loglanir.
      console.error(`[audit:${tableName}] spool satiri okunamadi, ATLANDI:`, satir.slice(0, 200));
      aktarilan++;
      continue;
    }
    const ok = await writeOne(kayit.entry);
    if (!ok) {
      durdu = true;
      break;
    }
    aktarilan++;
  }

  const kalan = await dosyayiKirp(tableName, file, aktarilan);
  if (aktarilan) {
    console.log(
      `[audit:${tableName}] ${aktarilan} bekleyen denetim kaydi DB'ye aktarildi` +
        (kalan ? `, ${kalan} kayit hala bekliyor.` : '.'),
    );
  } else if (durdu) {
    console.warn(`[audit:${tableName}] spool aktarilamadi, ${kalan} kayit bekliyor.`);
  }
  return { drained: aktarilan, remaining: kalan };
}

/**
 * Ilk `atlanacak` satiri dosyadan duserir; kalan satir sayisini doner.
 * Kalanlar gecici dosyaya AKIS ile kopyalanir, sonra `rename` ile yerine gecer —
 * `rename` atomiktir, yarim kalmis bir kirpma spool'u bozmaz.
 */
async function dosyayiKirp(tableName, file, atlanacak) {
  const tmp = `${file}.tmp`;
  let kalan = 0;
  let cikis = null;
  try {
    let i = 0;
    for await (const satir of satirlariOku(file)) {
      if (i++ < atlanacak) continue;
      if (!cikis) cikis = fs.createWriteStream(tmp, { encoding: 'utf8' });
      if (!cikis.write(satir + '\n')) {
        await new Promise((r) => cikis.once('drain', r));
      }
      kalan++;
    }
    if (cikis) {
      // `end(cb)` hatayi GECIRMEZ — hata `error` olayindan gelir. Yalnizca
      // geri cagriya guvenmek, yarim yazilmis bir dosyayi saglam sanip
      // `rename` etmek demekti.
      const akis = cikis;
      await new Promise((r, j) => {
        akis.once('error', j);
        akis.end(() => r());
      });
      fs.renameSync(tmp, file);
    } else {
      fs.unlinkSync(file);
    }
  } catch (err) {
    console.error(`[audit:${tableName}] spool guncellenemedi:`, err.message);
    try {
      if (cikis) cikis.destroy();
      fs.unlinkSync(tmp);
    } catch {
      /* yoksay */
    }
    // Kirpma dustu: dosya OLDUGU GIBI kalir. Ayni kayitlar sonraki turda tekrar
    // yazilabilir — MUKERRER kayit, KAYIP kayittan iyidir.
    return depth(tableName);
  }
  return kalan;
}

module.exports = {
  append,
  depth,
  drain,
  spoolPath,
  SPOOL_MAX_LINE_BYTES,
  SPOOL_MAX_BYTES,
  DRAIN_BATCH_LINES,
};
