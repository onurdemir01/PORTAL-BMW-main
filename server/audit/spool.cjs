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
'use strict';

const fs = require('fs');
const path = require('path');

// Spool dosyasi log dizininde durur — `log.cjs` ile AYNI cozumleme (LOG_DIR ya da
// <repo>/logs). Ayri bir dizin, dagitim betiklerinde ikinci bir izin/temizlik
// kurali demek olurdu.
function spoolPath(tableName) {
  const root = path.join(__dirname, '..', '..');
  const dir = String(process.env.LOG_DIR || '').trim() || path.join(root, 'logs');
  return path.join(dir, `audit-spool.${tableName}.ndjson`);
}

/** Bir girdiyi spool'a ekler. Basarisizsa `false` doner — cagiran SUSMAZ. */
function append(tableName, entry) {
  const file = spoolPath(tableName);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // NDJSON: satir satir eklenebilir, yarim yazilmis son satir okuma sirasinda
    // atilabilir. Tam dosya JSON'u olsaydi her ekleme tum dosyayi yeniden yazardi.
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), entry }) + '\n');
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

/** Spool'da bekleyen kayit sayisi. Gorunurluk icin; dosya yoksa 0. */
function depth(tableName) {
  try {
    const src = fs.readFileSync(spoolPath(tableName), 'utf8');
    return src.split('\n').filter((l) => l.trim()).length;
  } catch {
    return 0;
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
 */
async function drain(tableName, writeOne) {
  const file = spoolPath(tableName);
  let satirlar;
  try {
    satirlar = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  } catch {
    return { drained: 0, remaining: 0 };
  }
  if (!satirlar.length) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* yoksay */
    }
    return { drained: 0, remaining: 0 };
  }

  let aktarilan = 0;
  for (const satir of satirlar) {
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
    if (!ok) break;
    aktarilan++;
  }

  const kalan = satirlar.slice(aktarilan);
  try {
    if (kalan.length) fs.writeFileSync(file, kalan.join('\n') + '\n');
    else fs.unlinkSync(file);
  } catch (err) {
    console.error(`[audit:${tableName}] spool guncellenemedi:`, err.message);
  }
  if (aktarilan) {
    console.log(
      `[audit:${tableName}] ${aktarilan} bekleyen denetim kaydi DB'ye aktarildi` +
        (kalan.length ? `, ${kalan.length} kayit hala bekliyor.` : '.'),
    );
  }
  return { drained: aktarilan, remaining: kalan.length };
}

module.exports = { append, depth, drain, spoolPath };
