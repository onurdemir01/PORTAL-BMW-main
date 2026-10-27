// server/nginx-loadtest/kilit.cjs - Yuk Testi kilitleri (nginx_loadtest_kilitleri, compare-and-set).
//
// Desen opsx/was-state.cjs kilit takiminin KOPYASI (o da ScaleX tryLockRestore'dan): TEK UPDATE
// ifadesi hem kontrol hem yazmadir, TOCTOU yok. Anahtarlar:
//   G|global   - ayni anda tek yuk KOSUSU (estate genelinde; paylasilan TEST kullanicilari 429 yemesin)
//   T|<HEDEF>  - ayni hedefe ikinci is (on kontrol istekleri de hedefin loguna yazilir ve olcumu bozar)
//   L|<YUK>    - ayni yuk makinesinden ikinci is
// On kontrol T + L alir; kosu G + T + L alir. Alma sirasi HER ZAMAN G, T, L.
// Kilit UPDATE ile BIRAKILIR, satir SILINMEZ (TBMWANS: DELETE yok). `db` nesnesi PARAMETRE olarak
// gelir (testte sahte db).
//
// IS BITTI != YUK BITTI (2026-10-27 tur 2): AWX iptali (canceled) ya da hatasi (error) uzaktaki
// async kos.sh/k6'yi ve ayrik CPU kaydediciyi DURDURMAZ. Kilit bu yuzden bagli isin TURUNE
// (bag_turu: on_kontrol | kosu | durdur) ve AWX durumuna gore birakilir ya da TUTULUR
// (bagliIsKarari). Tutulan kilit isten cozulur (awx_* = NULL) ve yalniz TTL ile duser; Durdur
// isi basarili biterse (iki sunucu da "kalan surec yok") kilit hemen birakilir.
'use strict';

// KILIT SURESI: AWX template timeout'u en cok SABLON_ZAMAN_ASIMI_DK olmali (belge:
// docs/NGINX-YUK-TESTI.md); kilit ondan UZUN tutulur ki AWX isi oldurmeden kilit dusmesin. Kilit
// launch'tan HEMEN ONCE TAM sureyle alinir (kisa alip uzatmak opsx'te reddedildi: uzatma yazimi
// dusse kilit is surerken duserdi).
const SABLON_ZAMAN_ASIMI_DK = 60;
const VARSAYILAN_KILIT_DK = 75;

function kilitSuresiDk(env = process.env) {
  const ham = String(env.NGINX_LOADTEST_LOCK_TTL_MIN ?? '').trim();
  if (!ham) return VARSAYILAN_KILIT_DK;
  const n = Number(ham);
  if (!Number.isInteger(n)) return VARSAYILAN_KILIT_DK;
  // Alt sinir: template timeout + 5 dk pay. Ust sinir: yarim gun (kalici kilit olmasin).
  return Math.min(Math.max(n, SABLON_ZAMAN_ASIMI_DK + 5), 720);
}

/** Anahtar listesi, ALMA SIRASIYLA. `kosu` true ise global anahtar da alinir. */
function kilitAnahtarlari({ hedef, yuk, kosu = false }) {
  const out = [];
  if (kosu) out.push('G|global');
  out.push(`T|${String(hedef).trim().toUpperCase()}`, `L|${String(yuk).trim().toUpperCase()}`);
  return out;
}

function isUniqueViolation(e) {
  return /2627|2601|duplicate|UNIQUE/i.test(String(e?.number ?? '') + String(e?.message ?? ''));
}

async function ensureLockRow(db, key) {
  try {
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM nginx_loadtest_kilitleri WHERE lock_key = $1)
         INSERT INTO nginx_loadtest_kilitleri (lock_key, held) VALUES ($1, 0)`,
      [key],
    );
  } catch (e) {
    // Esszamanli iki istek ayni anda INSERT edebilir; UNIQUE ihlali satirin ZATEN var oldugu
    // anlamina gelir - sorun degil. Baska hata yukari.
    if (!isUniqueViolation(e)) throw e;
  }
}

/**
 * Bagli isin TURU + AWX'in TERMINAL durumu -> 'birak' | 'tut'. TEK saf kural; poller
 * sonuclandirmasi, kilit supurmesi ve acquireLocks'un bayat-kilit kontrolu bunu kullanir.
 *
 *   AWX durumu        | on_kontrol / NULL | kosu | durdur
 *   successful        | birak             | birak| birak
 *   failed            | birak             | birak| tut
 *   canceled, error   | birak             | tut  | tut
 *
 * `tut`: kilit DOLU kalir ama isten cozulur (yalniz TTL birakir). Terminal OLMAYAN ya da
 * bilinmeyen durum icin cagrilmaz (cagiran TERMINAL'e bakar); yine de cagrilirsa 'tut' doner
 * (birakmak yuk surerken kilidi acardi). Bilinmeyen bag turu en siki sutun (durdur) sayilir.
 */
function bagliIsKarari(bagTuru, awxStatus) {
  const s = String(awxStatus ?? '').trim().toLowerCase();
  const t = bagTuru == null || bagTuru === '' || bagTuru === 'on_kontrol' ? 'on_kontrol' : bagTuru === 'kosu' ? 'kosu' : 'durdur';
  if (s === 'successful') return 'birak';
  if (s === 'failed') return t === 'durdur' ? 'tut' : 'birak';
  if (s === 'canceled' || s === 'error') return t === 'on_kontrol' ? 'birak' : 'tut';
  return 'tut';
}

// Suresi dolmus kilit YALNIZ bir ise bagli degilse devralinir: ise bagli kilit bayat-kilit
// yolundan (AWX'e sorularak, bagliIsKarari ile) gecer. 12 saatten fazla once dolmus kilit AWX
// okunamasa da devralinir (okunamayan AWX kilidi sonsuza dek tutmasin).
async function casLock(db, key, { lockId, holder, desc, ttlMin }) {
  const { rowCount } = await db.query(
    `UPDATE nginx_loadtest_kilitleri
        SET held = 1, holder = $2, lock_id = $3, target_desc = $4,
            locked_until = DATEADD(MINUTE, $5, GETUTCDATE()),
            awx_server_id = NULL, awx_job_id = NULL, bag_turu = NULL, updated_at = GETUTCDATE()
      WHERE lock_key = $1
        AND (held IS NULL OR held = 0 OR locked_until IS NULL
             OR (locked_until < GETUTCDATE() AND awx_job_id IS NULL)
             OR locked_until < DATEADD(HOUR, -12, GETUTCDATE()))`,
    [key, holder, lockId, desc, ttlMin],
  );
  return rowCount > 0;
}

async function readLock(db, key) {
  const { rows } = await db.query(
    `SELECT TOP 1 lock_key, held, holder, lock_id, target_desc, locked_until, awx_server_id, awx_job_id, bag_turu, last_op_finished_at
       FROM nginx_loadtest_kilitleri WHERE lock_key = $1`,
    [key],
  );
  return rows[0] || null;
}

// AWX zamanini (ISO) tek bicime getirir. Bu bicimde metin karsilastirmasi zaman karsilastirmasidir.
function isoOrNull(v) {
  if (v == null || v === '') return null;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// last_op_finished_at: bu anahtardaki SON isin AWX bitis zamani; yalniz ileri gider ve kilit
// birakilirken AYNI UPDATE'te yazilir.
const LAST_OP_SET = `last_op_finished_at = CASE WHEN $FIN IS NOT NULL AND (last_op_finished_at IS NULL OR last_op_finished_at < $FIN) THEN $FIN ELSE last_op_finished_at END`;

async function releaseLockById(db, key, lockId, finishedIso = null) {
  const { rowCount } = await db.query(
    `UPDATE nginx_loadtest_kilitleri SET held = 0, updated_at = GETUTCDATE(), ${LAST_OP_SET.replace(/\$FIN/g, '$3')}
      WHERE lock_key = $1 AND lock_id = $2 AND held = 1`,
    [key, lockId, isoOrNull(finishedIso)],
  );
  return rowCount > 0;
}

// Dolu kilidin bagli oldugu is bitmis mi? Hata = BITMEMIS (fail-closed: kilit dolu sayilir).
// `status`: AWX durumu (bagliIsKarari icin); bilinmiyorsa null -> kural 'tut' der.
async function boundJobState(jobState, row) {
  try {
    const r = await jobState(Number(row.awx_server_id), Number(row.awx_job_id));
    if (r === true) return { terminal: true, finished: null, status: null };
    if (r && typeof r === 'object' && r.terminal === true) return { terminal: true, finished: r.finished ?? null, status: r.status ?? null };
  } catch {
    /* AWX okunamadi: bitmis SAYILMAZ */
  }
  return { terminal: false, finished: null, status: null };
}

/**
 * Anahtarlari TUMU YA DA HICBIRI mantigiyla alir. Dolu kilit bir AWX isine bagliysa ve o is TERMINAL
 * ise (`isJobTerminal` -> { terminal, finished, status }) karar bagliIsKarari'nindir: 'birak' ise
 * kilit bayattir, birakilip bir kez daha denenir; 'tut' ise kilit DOLU sayilir ve isten cozulur
 * (yalniz TTL birakir). `isJobTerminal` hata atarsa kilit DOLU sayilir.
 * Donus: { ok:true, keys } | { ok:false, busyKey, busy }
 */
async function acquireLocks(db, keys, { lockId, holder, desc, isJobTerminal, ttlMin }) {
  const taken = [];
  const ttl = Number.isInteger(ttlMin) && ttlMin > SABLON_ZAMAN_ASIMI_DK ? ttlMin : kilitSuresiDk();
  for (const key of keys) {
    await ensureLockRow(db, key);
    let ok = await casLock(db, key, { lockId, holder, desc, ttlMin: ttl });
    let row = null;
    if (!ok) {
      row = await readLock(db, key);
      if (row && row.awx_job_id != null && row.awx_server_id != null && isJobTerminal) {
        const js = await boundJobState(isJobTerminal, row);
        if (js.terminal && bagliIsKarari(row.bag_turu, js.status) === 'tut') {
          await isinKilitleriniCoz(db, Number(row.awx_server_id), Number(row.awx_job_id));
          row = (await readLock(db, key)) || row;
        } else if (js.terminal && row.lock_id) {
          await releaseLockById(db, key, row.lock_id, js.finished);
          ok = await casLock(db, key, { lockId, holder, desc, ttlMin: ttl });
          if (!ok) row = await readLock(db, key);
        }
      }
    }
    if (!ok) {
      for (const k of taken) await releaseLockById(db, k, lockId);
      return { ok: false, busyKey: key, busy: row };
    }
    taken.push(key);
  }
  return { ok: true, keys: taken };
}

// Launch basarili: kilit AWX isine baglanir; is terminale ulasinca poller (ya da bir sonraki kilit
// denemesindeki bayat-kilit kontrolu) bagliIsKarari ile birakir ya da tutar. Sure DEGISMEZ: kilit
// zaten tam TTL ile alindi. `bagTuru`: isin turu (kosuyuBaslat islemi verir).
async function bindLocks(db, keys, lockId, { awxServerId, awxJobId, bagTuru = null }) {
  for (const key of keys) {
    await db.query(
      `UPDATE nginx_loadtest_kilitleri
          SET awx_server_id = $3, awx_job_id = $4, bag_turu = $5, updated_at = GETUTCDATE()
        WHERE lock_key = $1 AND lock_id = $2 AND held = 1`,
      [key, lockId, awxServerId, awxJobId, bagTuru],
    );
  }
}

async function releaseLocks(db, keys, lockId) {
  for (const key of keys) await releaseLockById(db, key, lockId);
}

// Is terminale ulasti ve kural 'birak' dedi: o ise bagli TUM kilitler birakilir (ayni UPDATE'te
// bitis zamani).
async function releaseLocksForJob(db, awxServerId, awxJobId, finishedIso = null) {
  const { rowCount } = await db.query(
    `UPDATE nginx_loadtest_kilitleri SET held = 0, updated_at = GETUTCDATE(), ${LAST_OP_SET.replace(/\$FIN/g, '$3')}
      WHERE awx_server_id = $1 AND awx_job_id = $2 AND held = 1`,
    [awxServerId, awxJobId, isoOrNull(finishedIso)],
  );
  return rowCount;
}

// Kilit suresini EN AZ simdi + n saniyeye cekme (kisaltmaz). Tek ifade, iki yerde ayni.
const SURE_UZAT = (p) => `locked_until = CASE WHEN locked_until IS NULL OR locked_until < DATEADD(SECOND, ${p}, GETUTCDATE()) THEN DATEADD(SECOND, ${p}, GETUTCDATE()) ELSE locked_until END`;
const UZATMA_TAVANI_SN = 24 * 3600;

function uzatmaSn(v) {
  return Number.isInteger(v) && v > 0 ? Math.min(v, UZATMA_TAVANI_SN) : null;
}

/**
 * Kural 'tut' dedi: o ise bagli DOLU kilitler isten COZULUR (awx_* ve bag_turu NULL) ama
 * birakilmaz; yalniz TTL ile duser. `uzatSn` verilirse kilit suresi en az simdi + uzatSn olur
 * (poller kosu isini cozerken butce + 180 verir). Donus: cozulen satir sayisi.
 */
async function isinKilitleriniCoz(db, awxServerId, awxJobId, uzatSn = null) {
  const n = uzatmaSn(uzatSn);
  const { rowCount } = await db.query(
    `UPDATE nginx_loadtest_kilitleri
        SET awx_server_id = NULL, awx_job_id = NULL, bag_turu = NULL, updated_at = GETUTCDATE()${n === null ? '' : `, ${SURE_UZAT('$3')}`}
      WHERE awx_server_id = $1 AND awx_job_id = $2 AND held = 1`,
    n === null ? [awxServerId, awxJobId] : [awxServerId, awxJobId, n],
  );
  return rowCount;
}

/**
 * Durdur isi baslatildi: kosunun DOLU kilitleri (kosu satirindaki kilit_id) durdur isine baglanir
 * (bag_turu 'durdur') ve suresi en az simdi + uzatSn olur. Durdur isi 'successful' biterse kural
 * kilidi hemen birakir; aksi halde TTL. Donus: baglanan satir sayisi.
 */
async function durdurIsineBagla(db, kilitId, { awxServerId, awxJobId, uzatSn }) {
  if (!kilitId) return 0;
  const n = uzatmaSn(uzatSn) ?? kilitSuresiDk() * 60;
  const { rowCount } = await db.query(
    `UPDATE nginx_loadtest_kilitleri
        SET awx_server_id = $2, awx_job_id = $3, bag_turu = 'durdur', ${SURE_UZAT('$4')}, updated_at = GETUTCDATE()
      WHERE lock_id = $1 AND held = 1`,
    [String(kilitId), awxServerId, awxJobId, n],
  );
  return rowCount;
}

// Ayni ise bagli kilitlerin bag turu normalde tektir (bindLocks hepsine ayni degeri yazar); yine de
// farkli gelirse EN SIKI olan alinir (durdur > kosu > on_kontrol/NULL).
const BAG_SIRASI = (t) => (t == null || t === '' || t === 'on_kontrol' ? 0 : t === 'kosu' ? 1 : 2);

/** Bir ise bagli DOLU kilitlerin isleri (poller supurmesi). Kosu satiri yazilamamis olsa da birakilsin. */
async function bekleyenKilitIsleri(db, limit = 20) {
  const n = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const { rows } = await db.query(
    `SELECT TOP 50 awx_server_id, awx_job_id, bag_turu FROM nginx_loadtest_kilitleri
      WHERE held = 1 AND awx_server_id IS NOT NULL AND awx_job_id IS NOT NULL
      ORDER BY id ASC`,
  );
  const out = [];
  const seen = new Map();
  for (const r of rows || []) {
    const sid = Number(r.awx_server_id);
    const jid = Number(r.awx_job_id);
    if (!Number.isInteger(sid) || !Number.isInteger(jid)) continue;
    const bagTuru = r.bag_turu == null || r.bag_turu === '' ? null : String(r.bag_turu);
    const onceki = seen.get(`${sid}:${jid}`);
    if (onceki) {
      if (BAG_SIRASI(bagTuru) > BAG_SIRASI(onceki.bagTuru)) onceki.bagTuru = bagTuru;
      continue;
    }
    const is = { serverId: sid, jobId: jid, bagTuru };
    seen.set(`${sid}:${jid}`, is);
    out.push(is);
  }
  return out.slice(0, n);
}

/** Dolu kilit icin kullaniciya gosterilecek tek satir (kim, ne, ne zamana kadar). */
function doluKilitMesaji(busyKey, busy) {
  const ne = busyKey === 'G|global' ? 'Başka bir yük testi koşuyor' : busyKey.startsWith('T|') ? `${busyKey.slice(2)} üzerinde başka bir iş var` : `${busyKey.slice(2)} yük makinesi meşgul`;
  const kim = busy && busy.holder ? ` (${busy.holder}${busy.target_desc ? `: ${busy.target_desc}` : ''}${busy.awx_job_id != null ? `, AWX iş #${busy.awx_job_id}` : ''})` : '';
  return `${ne}${kim}. İş bitince kilit kendiliğinden bırakılır.`;
}

module.exports = {
  SABLON_ZAMAN_ASIMI_DK,
  VARSAYILAN_KILIT_DK,
  kilitSuresiDk,
  kilitAnahtarlari,
  bagliIsKarari,
  ensureLockRow,
  casLock,
  readLock,
  isoOrNull,
  releaseLockById,
  acquireLocks,
  bindLocks,
  releaseLocks,
  releaseLocksForJob,
  isinKilitleriniCoz,
  durdurIsineBagla,
  bekleyenKilitIsleri,
  doluKilitMesaji,
};
