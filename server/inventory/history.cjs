// server/inventory/history.cjs — Envanter geçmişi: SCD-2 anlık görüntü motoru + sorgular.
//
// MODEL. Her satır için bir GEÇERLİLİK ARALIĞI tutulur:
//   valid_from  satırın bu hâliyle ilk görüldüğü an
//   valid_to    bu hâlin sona erdiği an (NULL = hâlâ geçerli)
// Bir satır T anında geçerlidir  ⟺  valid_from <= T AND (valid_to IS NULL OR valid_to > T)
//
// NEDEN GÜNLÜK TAM KOPYA DEĞİL: envanter çoğu gün değişmez. Günlük tam kopyada 5.000
// satırlık bir tablo yılda ~1,8 milyon satır üretirdi; burada YALNIZCA gerçek değişiklik
// yazılır, yani depolama değişimle orantılıdır. Karşılığında sorgu biraz daha karmaşık
// (yukarıdaki aralık koşulu) ama tek bir yardımcıda kapsanıyor.
//
// TEKRAR ÇALIŞTIRMA GÜVENLİ: aynı gün ikinci kez çalıştırılırsa hiçbir satır değişmemiş
// görünür ve HİÇBİR ŞEY yazılmaz. Zamanlayıcı gecikse/iki kez tetiklense de geçmiş
// bozulmaz.
'use strict';

const crypto = require('crypto');
const { getEffectiveTable, effectiveSnapshotTables, MIN_ROW_RATIO } = require('./history-config.cjs');

const INSERT_BATCH = 200; // MSSQL'de 2100 parametre siniri var; 200 x 5 = 1000, guvenli.

function db() {
  return require('../db/index.cjs');
}

// ── Normalizasyon ──────────────────────────────────────────────────────────────
// Hash'in KARARLI olmasi sart: ayni veri her calistirmada ayni hash'i uretmeli. Tarih
// nesneleri surucuye gore Date ya da string gelebilir; ikisi de ISO metne indirgenir.
// null ile bos dize AYNI sayilir - kaynak yukleyiciler bos degeri bazen NULL bazen ''
// yaziyor ve bu fark "degisiklik" olarak gorunmemeli.
function normValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return String(v).trim();
}

/** Anahtar kolon degerlerinden okunabilir, benzersiz bir satir anahtari uretir. */
function rowKeyOf(row, keyCols) {
  const raw = keyCols.map((c) => normValue(row[c])).join('');
  // row_key indekslenebilmeli (MSSQL indeks anahtarinda 900 bayt siniri). Uzun
  // anahtarlar kisaltilir ama SONUNA tam anahtarin hash'i eklenir - kisaltma yuzunden
  // iki farkli satirin ayni anahtara dusmesi (cakisma) boylece imkansiz.
  if (raw.length <= 400) return raw;
  return raw.slice(0, 360) + '#' + sha256(raw).slice(0, 32);
}

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Satirin ICERIK hash'i. `volatile` kolonlar DISLANIR — ozellikle last_seen_at her
 * basarili taramada guncellenir; dahil edilseydi her satir her gece "degisti" sayilir,
 * gecmis tablosu her gece tum envanter kadar buyur ve ekran kullanilamaz hale gelirdi.
 */
function contentOf(row, volatile) {
  const skip = new Set((volatile || []).map((c) => c.toLowerCase()));
  const out = {};
  for (const k of Object.keys(row).sort()) {
    if (skip.has(k.toLowerCase())) continue;
    out[k] = normValue(row[k]);
  }
  return out;
}

// ── Tablo adi guvenligi ────────────────────────────────────────────────────────
// Tablo adi SQL'e parametre olarak gecirilemez, metne gomulur. Bu yuzden ad ASLA
// cagirandan gelen ham dizeden alinmaz: yalnizca history-config'teki kayitli tanimin
// KENDI `table` alani kullanilir (allowlist). Ek olarak bicim de dogrulanir.
function safeTableName(def) {
  const n = String(def.table || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) {
    throw new Error(`Guvenli olmayan tablo adi: ${n}`);
  }
  return n;
}

async function tableExists(name) {
  const { rows } = await db().query(
    `SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = $1`,
    [name],
  );
  return rows.length > 0;
}

// ── Anlik goruntu alma ─────────────────────────────────────────────────────────

/**
 * Tek bir tablonun anlik goruntusunu alir ve geçmişe YALNIZCA farki yazar.
 * @returns {{status:string, sourceRows:number, added:number, changed:number, removed:number, message?:string}}
 */
async function snapshotTable(def, now = new Date()) {
  const name = safeTableName(def);
  const startedAt = new Date();

  if (!(await tableExists(name))) {
    return finishRun(def, startedAt, {
      status: 'skipped', sourceRows: 0, added: 0, changed: 0, removed: 0,
      message: 'Kaynak tablo bulunamadi.',
    });
  }

  const { rows: srcRows } = await db().query(`SELECT * FROM dbo.${name}`);

  // Kaynak satirlari anahtar -> {hash, json}
  const src = new Map();
  for (const r of srcRows) {
    const key = rowKeyOf(r, def.key);
    const content = contentOf(r, def.volatile);
    src.set(key, { hash: sha256(JSON.stringify(content)), json: JSON.stringify(content) });
  }

  // Su an ACIK olan gecmis satirlari
  const { rows: openRows } = await db().query(
    `SELECT row_key, row_hash FROM inventory_history WHERE table_name = $1 AND valid_to IS NULL`,
    [name],
  );
  const open = new Map(openRows.map((r) => [r.row_key, r.row_hash]));

  const added = [];
  const changed = [];
  for (const [key, cur] of src) {
    const prev = open.get(key);
    if (prev === undefined) added.push(key);
    else if (prev !== cur.hash) changed.push(key);
  }
  const removed = [...open.keys()].filter((k) => !src.has(k));

  // ── GUVENLIK ESIGI ───────────────────────────────────────────────────────────
  // Bozuk/yarim bir tarama (envanter job'i hata alip tabloyu yarim doldurdu) binlerce
  // satiri "silinmis" diye gecmise yazardi ve bu GERI ALINAMAZDI. Kaynak satir sayisi
  // acik satir sayisinin yarisinin altina duserse hicbir sey yazilmaz; kayit "aborted"
  // olarak loglanir ve operator "Tarama Sagligi"nda gorur. Loader'larin kendi esik
  // korumasiyla ayni mantik: bilinmezlik, veri kaybina yazilmaz.
  if (open.size > 0 && src.size < open.size * MIN_ROW_RATIO) {
    return finishRun(def, startedAt, {
      status: 'aborted', sourceRows: src.size, added: 0, changed: 0, removed: 0,
      message:
        `Kaynak satir sayisi ani dustu (${open.size} -> ${src.size}). Bozuk tarama ` +
        `olabilir; gecmise HICBIR SEY yazilmadi.`,
    });
  }

  if (added.length === 0 && changed.length === 0 && removed.length === 0) {
    return finishRun(def, startedAt, {
      status: 'ok', sourceRows: src.size, added: 0, changed: 0, removed: 0,
      message: 'Degisiklik yok.',
    });
  }

  // Kapatilacaklar: degisenler + kaybolanlar
  const toClose = [...changed, ...removed];
  for (let i = 0; i < toClose.length; i += INSERT_BATCH) {
    const slice = toClose.slice(i, i + INSERT_BATCH);
    const ph = slice.map((_, j) => `$${j + 3}`).join(', ');
    await db().query(
      `UPDATE inventory_history SET valid_to = $1
       WHERE table_name = $2 AND valid_to IS NULL AND row_key IN (${ph})`,
      [now, name, ...slice],
    );
  }

  // Acilacaklar: yeniler + degisenlerin YENI hali
  const toOpen = [...added, ...changed];
  for (let i = 0; i < toOpen.length; i += INSERT_BATCH) {
    const slice = toOpen.slice(i, i + INSERT_BATCH);
    const values = [];
    const params = [];
    slice.forEach((key, j) => {
      const b = j * 5;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`);
      const cur = src.get(key);
      params.push(name, key, cur.hash, cur.json, now);
    });
    await db().query(
      `INSERT INTO inventory_history (table_name, row_key, row_hash, row_json, valid_from)
       VALUES ${values.join(', ')}`,
      params,
    );
  }

  return finishRun(def, startedAt, {
    status: 'ok', sourceRows: src.size,
    added: added.length, changed: changed.length, removed: removed.length,
  });
}

async function finishRun(def, startedAt, res) {
  try {
    await db().query(
      `INSERT INTO inventory_history_runs
         (table_name, started_at, finished_at, source_rows, added, changed, removed, status, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [def.table, startedAt, new Date(), res.sourceRows, res.added, res.changed,
       res.removed, res.status, res.message || null],
    );
  } catch (e) {
    console.warn('[EnvanterGecmis] calistirma kaydi yazilamadi:', e.message);
  }
  return { table: def.table, ...res };
}

/** ACIK olan TUM snapshot tablolari icin anlik goruntu alir (kapsam Admin'den yonetilir). */
async function snapshotAll(now = new Date()) {
  const out = [];
  for (const def of await effectiveSnapshotTables()) {
    try {
      out.push(await snapshotTable(def, now));
    } catch (e) {
      console.warn(`[EnvanterGecmis] ${def.table} anlik goruntusu alinamadi:`, e.message);
      out.push({ table: def.table, status: 'error', message: e.message });
    }
  }
  return out;
}

// ── Sorgular ───────────────────────────────────────────────────────────────────

/** Tablonun verilen andaki hali. */
async function rowsAt(tableName, at) {
  const def = await getEffectiveTable(tableName);
  if (!def) throw new Error(`Gecmisi tutulmayan tablo: ${tableName}`);
  const { rows } = await db().query(
    `SELECT row_key, row_json FROM inventory_history
     WHERE table_name = $1 AND valid_from <= $2 AND (valid_to IS NULL OR valid_to > $2)`,
    [def.table, at],
  );
  return rows.map((r) => ({ key: r.row_key, data: JSON.parse(r.row_json) }));
}

/** Iki an arasindaki fark: eklenen / silinen / degisen (eski+yeni degerleriyle). */
async function diff(tableName, from, to) {
  const [a, b] = await Promise.all([rowsAt(tableName, from), rowsAt(tableName, to)]);
  const A = new Map(a.map((r) => [r.key, r.data]));
  const B = new Map(b.map((r) => [r.key, r.data]));

  const added = [];
  const removed = [];
  const changed = [];
  for (const [k, v] of B) {
    if (!A.has(k)) added.push({ key: k, data: v });
    else {
      const before = A.get(k);
      const fields = {};
      for (const col of new Set([...Object.keys(before), ...Object.keys(v)])) {
        if (normValue(before[col]) !== normValue(v[col])) {
          fields[col] = { before: before[col] ?? null, after: v[col] ?? null };
        }
      }
      if (Object.keys(fields).length) changed.push({ key: k, fields });
    }
  }
  for (const [k, v] of A) if (!B.has(k)) removed.push({ key: k, data: v });

  return { added, removed, changed };
}

/** Gun gun satir sayisi (trend). */
async function rowCountSeries(tableName, days = 30) {
  const def = await getEffectiveTable(tableName);
  if (!def) throw new Error(`Gecmisi tutulmayan tablo: ${tableName}`);
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    d.setUTCHours(23, 59, 59, 999);
    const { rows } = await db().query(
      `SELECT COUNT(*) AS n FROM inventory_history
       WHERE table_name = $1 AND valid_from <= $2 AND (valid_to IS NULL OR valid_to > $2)`,
      [def.table, d],
    );
    out.push({ date: d.toISOString().slice(0, 10), count: Number(rows[0]?.n || 0) });
  }
  return out;
}

/** Son calistirmalar — "Tarama Sagligi" metrigi bunun uzerine kurulur. */
async function recentRuns(limit = 50) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const { rows } = await db().query(
    `SELECT TOP ${n} table_name, started_at, finished_at, source_rows, added, changed,
            removed, status, message
     FROM inventory_history_runs ORDER BY started_at DESC`,
  );
  return rows;
}

module.exports = {
  snapshotTable, snapshotAll, rowsAt, diff, rowCountSeries, recentRuns,
  // saf yardimcilar — birim testleri DB gerektirmeden calissin diye acildi
  _normValue: normValue, _rowKeyOf: rowKeyOf, _contentOf: contentOf, _sha256: sha256,
  _safeTableName: safeTableName,
};
