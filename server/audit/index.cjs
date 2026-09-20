// server/audit/index.cjs — Portal geneli hash-zincirli denetim kaydi.
// logx/audit.cjs'teki v3 tek-yazar-kuyrugu deseninin tablo-parametreli genellemesi:
// createAuditChain(tableName) ayni semali herhangi bir audit tablosuna yazar/dogrular.
// Portal instance'i portal_audit_logs tablosuna yazar; LogX kendi tablosunda kalir.
//
// auditPortal(req, action, opts): request'ten kullanici/rol/IP cikarip fire-and-forget
// yazar — cagiran handler DB hatasindan bloklanmaz.
'use strict';

const crypto = require('crypto');
const db = require('../db/index.cjs');
const spool = require('./spool.cjs');

const HASH_PREFIX = 'v3:';

function computeEntryHash(prevHash, username, action, detail) {
  return HASH_PREFIX + crypto
    .createHash('sha256')
    .update([prevHash, username, action, String(detail || '')].join('|'))
    .digest('hex');
}

// Tablo basina bagimsiz zincir + tek-yazar kuyrugu.
function createAuditChain(tableName) {
  let _writeQueue = Promise.resolve();

  // HATADA FIRLATIR, '' DONMEZ.
  //
  // Onceden `catch { return ''; }` vardi. SELECT'in dustugu ama INSERT'in
  // basarili oldugu bir pencerede `prev_hash=''` yazilir ve `verifyChain` o
  // noktayi KIRIK ZINCIR olarak raporlardi — kurtarma yolu olmadan. Zincirin
  // anlami "araya kayit sokulmadi/silinmedi"dir; onu kendi elimizle kirmak
  // garantiyi yok eder.
  //
  // Firlatmak dogru davranis: yazim tumuyle duser ve girdi spool'a gider, yani
  // KAYIT KAYBOLMAZ, yalnizca gecikir.
  async function getLastHash() {
    const { rows } = await db.query(
      `SELECT TOP 1 entry_hash FROM ${tableName} ORDER BY id DESC`
    );
    return rows[0]?.entry_hash || '';
  }

  /**
   * @param {object} entry
   * @param {{ spoolOnFailure?: boolean }} [opts]
   *   `spoolOnFailure: false` YALNIZCA spool aktariminda kullanilir: girdi ZATEN
   *   spool dosyasinda duruyor; dusen bir yazim onu ikinci kez eklerse dosyada
   *   MUKERRER kayit olusur ve zincire iki kez girer. (Bu, akis tabanli `drain`e
   *   gecince ortaya cikti — eski `drain` tum dosyayi okuyup uzerine yazdigi icin
   *   mukerrer kaydi farkinda olmadan SILIYORDU.)
   */
  async function writeEntry(entry, { spoolOnFailure = true } = {}) {
    const {
      sessionId, username, authSource, role, targetHost, targetIp,
      action, result, detail, clientIp,
    } = entry;
    try {
      const prevHash = await getLastHash();
      // detail kirpmasi hash'ten ONCE — hash DB'de birebir saklanan deger uzerinden hesaplanir.
      const storedDetail = detail ? String(detail).slice(0, 2000) : null;
      const entryHash = computeEntryHash(prevHash, username, action, storedDetail);
      await db.query(
        `INSERT INTO ${tableName}
           (session_id, username, auth_source, role, target_host, target_ip, action, result, detail, client_ip, prev_hash, entry_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          sessionId || null, username || 'system',
          authSource || 'local', role || null,
          targetHost || null, targetIp || null,
          action, result || null,
          storedDetail,
          clientIp || null, prevHash, entryHash,
        ]
      );
      return true;
    } catch (err) {
      // KAYIT YUTULMAZ — DISKE ALINIR. Hash BURADA hesaplanmis olsa bile spool'a
      // HAM GIRDI gider: `prev_hash` aktarim anindaki son kayda baglidir ve
      // beklerken baska kayitlar yazilmis olabilir.
      if (!spoolOnFailure) {
        // Aktarim yolu: girdi spool'da KALIYOR (drain onu dosyadan dusurmez).
        console.error(`[audit:${tableName}] spool aktarimi dustu:`, err.message);
        return false;
      }
      const alindi = spool.append(tableName, entry);
      console.error(
        `[audit:${tableName}] write failed:`,
        err.message,
        alindi ? '— kayit spool`a alindi, DB donunce aktarilacak.' : '— SPOOL DA DUSTU, KAYIT KAYIP.',
      );
      return false;
    }
  }

  function log(entry) {
    const task = _writeQueue.then(() => writeEntry(entry));
    _writeQueue = task.catch(() => {});
    return task;
  }

  // `action` TAM ESITLIKLE aranir; `actionPrefix` ise bir MODULUN tum izini getirir
  // (or. `scalex_` → `scalex_operation`, `scalex_gate_decision`, `scalex_finalize`…).
  // Onceden yalnizca tam esitlik vardi: bir modulun izine bakmak icin aksiyon adlarini
  // TEK TEK ve EZBERDEN yazmak gerekiyordu, ekranda liste de yoktu.
  //
  // `LIKE` deseni PARAMETRE olarak gecirilir ve `%` SONA eklenir — kullanicinin
  // girdisi desene donusturulmez (`%` ve `_` icerse bile yalnizca kendi anlamlarini
  // tasir; burada risk enjeksiyon degil, yanlislikla genis eslesme).
  //
  // `dateFrom`/`dateTo`: denetim kaydinda tarih araligi HIC YOKTU — bir olayin
  // gununu bilen kullanici 50'serlik sayfalari geriye dogru cevirmek zorundaydi.
  async function getLogs({ limit = 200, offset = 0, username, targetHost, action, actionPrefix, dateFrom, dateTo } = {}) {
    const conditions = [];
    const params = [];
    if (username)   { params.push(username);   conditions.push(`username = $${params.length}`);    }
    if (targetHost) { params.push(targetHost); conditions.push(`target_host = $${params.length}`); }
    if (action)     { params.push(action);     conditions.push(`action = $${params.length}`);      }
    if (actionPrefix) {
      params.push(`${String(actionPrefix).replace(/[%_[]/g, '')}%`);
      conditions.push(`action LIKE $${params.length}`);
    }
    if (dateFrom)   { params.push(dateFrom);   conditions.push(`created_at >= $${params.length}`); }
    if (dateTo)     { params.push(dateTo);     conditions.push(`created_at < $${params.length}`);  }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(offset, limit);
    const { rows } = await db.query(
      `SELECT * FROM ${tableName} ${where}
       ORDER BY created_at DESC
       OFFSET $${params.length - 1} ROWS FETCH NEXT $${params.length} ROWS ONLY`,
      params
    );
    return rows;
  }

  // Zincir dogrulamasi SAYFALI kosar. Eski hali tum tabloyu tek `SELECT` ile
  // bellege aliyordu (`ORDER BY id ASC`, TOP/OFFSET YOK) ve `portal_audit_logs`
  // icin RETENTION YOK — `housekeeping.cjs` bu tabloyu hic temizlemiyor. Satir
  // basina ~2-4 KB ile 500 bin satir ~1-2 GB eder; uretimdeki heap tavani 2 GB.
  // Yani bu ucun cokmesi zaman meselesiydi: tablo buyudukce kacinilmazdi.
  //
  // SAYFALAMA ZINCIRI BOZMAZ: `runningPrev` sayfalar arasinda TASINIR ve sira
  // `id ASC` ile sabittir. Sayfa sinirinda zinciri sifirlamak, her sayfanin ilk
  // kaydini YANLISLIKLA saglam gosterirdi — kurcalama tam orada gizlenebilirdi.
  const VERIFY_PAGE = 2000;

  async function verifyChain() {
    const { rows: countRows } = await db.query(`SELECT COUNT(*) AS total FROM ${tableName}`);
    const totalRows = Number(countRows[0]?.total || 0);

    const brokenIds = new Set();
    let firstBrokenId = null;
    let runningPrev = null;
    let verified = 0;
    let offset = 0;

    for (;;) {
      const { rows } = await db.query(
        `SELECT id, username, action, detail, prev_hash, entry_hash
         FROM ${tableName} WHERE entry_hash LIKE 'v3:%' ORDER BY id ASC
         OFFSET $1 ROWS FETCH NEXT $2 ROWS ONLY`,
        [offset, VERIFY_PAGE],
      );
      if (!rows.length) break;
      for (const row of rows) {
        // Ilk kaydin `prev_hash`i kiyaslanmaz — oncesi yok.
        const prevMismatch = runningPrev !== null && row.prev_hash !== runningPrev;
        const expected = computeEntryHash(row.prev_hash, row.username, row.action, row.detail);
        const hashMismatch = expected !== row.entry_hash;
        if (prevMismatch || hashMismatch) {
          brokenIds.add(row.id);
          if (!firstBrokenId) firstBrokenId = row.id;
        }
        runningPrev = row.entry_hash;
      }
      verified += rows.length;
      if (rows.length < VERIFY_PAGE) break;
      offset += VERIFY_PAGE;
    }

    const legacyCount = totalRows - verified;
    const broken = brokenIds.size;
    return { ok: broken === 0, verified, broken, firstBrokenId, legacyCount };
  }

  // ── SPOOL BOSALTMA ─────────────────────────────────────────────────────────
  //
  // Bekleyen kayitlar TEK YAZAR KUYRUGUNDAN gecer (`_writeQueue`): aktarim
  // sirasinda gelen yeni bir kayit araya girip sirayi bozamaz. Hash zinciri
  // sirali bir yapidir; paralel yazim onu anlamsiz kilardi.
  function drainSpool() {
    const task = _writeQueue.then(() =>
      // `spoolOnFailure: false` — girdi zaten spool'da; basarisiz yazim onu ikinci
      // kez eklemeyecek, `drain` dosyada BIRAKACAK.
      spool.drain(tableName, (entry) => writeEntry(entry, { spoolOnFailure: false })),
    );
    _writeQueue = task.catch(() => {});
    return task;
  }

  function spoolDepth() {
    return spool.depth(tableName);
  }

  return { log, getLogs, verifyChain, drainSpool, spoolDepth };
}

// ── Portal geneli instance ───────────────────────────────────────────────────
const portalChain = createAuditChain('portal_audit_logs');

// Request'ten kimlik/IP cikaran kisa yol. Fire-and-forget — hicbir handler'i bloklamaz.
// action: 'login', 'role_change', 'selfservice_update', 'ansible_launch' ... gibi
// snake_case eylem adi. opts: { detail, result, targetHost, targetIp, username }.
function auditPortal(req, action, opts = {}) {
  const user = (req && (req.session?.user || req.user)) || {};
  portalChain.log({
    sessionId: req?.sessionID || null,
    username: opts.username || user.username || 'system',
    authSource: user.authSource || 'local',
    role: user.role || null,
    targetHost: opts.targetHost || null,
    targetIp: opts.targetIp || null,
    action,
    result: opts.result || 'ok',
    detail: opts.detail || null,
    clientIp: req?.ip || null,
  });
}

// ── Body redaksiyonu — sifre/token/secret degerleri audit'e asla yazilmaz ────
const SECRET_KEY_RE = /(pass|password|token|secret|key|credential|authorization)/i;

function redactObject(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY_RE.test(k)) out[k] = '[REDACTED]';
    else if (v && typeof v === 'object') out[k] = redactObject(v, depth + 1);
    else out[k] = v;
  }
  return out;
}

// ── Genel mutasyon audit middleware'i ────────────────────────────────────────
// Router/prefix'e takilir; basarili (2xx) her non-GET istegi otomatik audit'ler:
// action = `${prefix}_${method}`, detail = URL + redakte edilmis body ozeti.
// Handler'lara dokunmadan tum CRUD'u kapsar; hassas alanlar redactObject ile maskelenir.
function auditMutations(prefix, { exclude = [] } = {}) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const pathOnly = (req.path || '').toLowerCase();
    if (exclude.some((e) => pathOnly.startsWith(e))) return next();
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      let detail = req.originalUrl;
      try {
        if (req.body && typeof req.body === 'object') {
          const body = JSON.stringify(redactObject(req.body));
          if (body && body !== '{}') detail += ' ' + body.slice(0, 800);
        }
      } catch { /* body serilestirilemedi — yalnizca URL */ }
      auditPortal(req, `${prefix}_${req.method.toLowerCase()}`, { detail });
    });
    next();
  };
}

// ── Admin okuma endpoint'leri ────────────────────────────────────────────────
// GET /api/portal-audit         → portal geneli denetim kayitlari
//   filtreler: username · targetHost · action (tam) · actionPrefix (modul izi) · dateFrom/dateTo
// GET /api/portal-audit/verify  → hash zinciri dogrulama ozeti
function initPortalAudit(app) {
  let requireAuth, requireAdmin;
  try {
    const auth = require('../auth/index.cjs');
    requireAuth = auth.requireAuth;
    requireAdmin = auth.requireAdmin;
  } catch { /* auth yok → endpoint acilmaz */ }
  if (!requireAuth || !requireAdmin) return;

  app.get('/api/portal-audit', requireAuth, requireAdmin, async (req, res) => {
    try {
      const rows = await portalChain.getLogs({
        limit: Math.min(Number(req.query.limit) || 200, 1000),
        offset: Number(req.query.offset) || 0,
        username: req.query.username || undefined,
        // `targetHost` uc tarafinda HIC OKUNMUYORDU: ekranda kutu vardi, yazilan deger
        // sorguya girmiyordu — olu bir filtre.
        targetHost: req.query.targetHost || undefined,
        action: req.query.action || undefined,
        actionPrefix: req.query.actionPrefix || undefined,
        dateFrom: req.query.dateFrom || undefined,
        dateTo: req.query.dateTo || undefined,
      });
      res.json({ ok: true, logs: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, logs: [] });
    }
  });

  app.get('/api/portal-audit/verify', requireAuth, requireAdmin, async (req, res) => {
    try {
      // `pendingSpool` ZINCIR SONUCUYLA BIRLIKTE doner: "zincir saglam" demek,
      // "hicbir kayit eksik degil" demek DEGILDIR — diskte bekleyen kayitlar
      // henuz zincire girmemistir. Ikisini ayri ayri gostermezsek yonetici
      // saglam bir zincire bakip eksigi olmadigini sanar.
      const zincir = await portalChain.verifyChain();
      res.json({ ok: true, ...zincir, pendingSpool: portalChain.spoolDepth() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── BEKLEYEN KAYITLARI AKTAR ───────────────────────────────────────────────
  //
  // Acilista bir kez: onceki calismada DB dustuyse kayitlar diskte bekliyordur.
  // Sonra periyodik: DB kesintisi calisir durumdayken de gecebilir (2026-09-18'de
  // tam boyle oldu — bes saat surdu ve proses hic yeniden baslamadi).
  //
  // `unref()`: bu zamanlayici surecin kapanmasini ENGELLEMEZ; aksi halde
  // dagitim sirasindaki `stop` adimi bu yuzden asili kalirdi.
  const DRAIN_INTERVAL_MS = 5 * 60 * 1000;
  setTimeout(() => {
    portalChain.drainSpool().catch(() => {});
  }, 10_000).unref();
  setInterval(() => {
    if (portalChain.spoolDepth() > 0) portalChain.drainSpool().catch(() => {});
  }, DRAIN_INTERVAL_MS).unref();

  console.log('[Audit] /api/portal-audit (admin) mounted');
}

module.exports = {
  createAuditChain,
  auditPortal,
  auditMutations,
  portalAudit: portalChain,
  initPortalAudit,
};
