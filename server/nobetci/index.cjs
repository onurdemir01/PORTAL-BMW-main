// server/nobetci/index.cjs — Nobetci API proxy (gbnys) + admin cache-temizleme uclari.
//
// Eskiden server/index.cjs (ana giris dosyasi) icine gomuluydu; digerlerinden farkli olarak
// bagimsiz bir modul degildi (kurumsal AI kod incelemesi Finding 7 — SRP ihlali). Diger tum
// domain modulleri (dynatrace, duty-roster, ansible...) kendi server/<domain>/index.cjs
// dosyasinda init<Domain>(app) desenini kullanirken nobetci tek istisnaydi — artik ayni desene
// uyar (bkz. server/dynatrace/index.cjs, server/duty-roster/index.cjs referans).
//
// GUVENLIK NOTU: /api/nobetci/today, /today/avatar, /list route'lari BILEREK auth-gate'siz
// kalir — Dashboard nobetci widget'i tum kimliklenmis/kimliklenmemis kullanicilara acik olmasi
// icin tasarlandi (bkz. server/duty-roster/index.cjs'deki "Nobet" sayfa-gorunurlugu MUAFIYET
// notuyla tutarli). Yalniz admin cache-temizleme uclari (Finding 15) requireAdmin ile korunur.
'use strict';

const https = require('https');
const http = require('http');

const { readDutyRoster } = require('../duty-roster/index.cjs');
const { clearTokenCache } = require('../ansible/runner.cjs');

// Iki ayri cache: liste 1 saat, bugunku 5 dakika (T61)
const NOBETCI_LIST_CACHE  = { data: null, ts: 0 };
const NOBETCI_TODAY_CACHE = { data: null, ts: 0 };
const LIST_TTL  = 60 * 60 * 1000; // 1 saat
const TODAY_TTL =  5 * 60 * 1000; // 5 dakika
// G-02: avatar ayri saklanir; ana today yaniti base64 tasimaz
let _nobetciAvatarDataUrl = null;

// Duty-roster'dan bugunku kaydi arar → API erisilemezse fallback
function nobetciFallback(teamName) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const store = readDutyRoster();
    const entry = store.find((x) => x.date === today);
    if (entry) {
      return {
        ok: true,
        name: `${entry.firstName} ${entry.lastName}`.trim(),
        phone: entry.phone || "",
        teamName,
        date: new Date().toLocaleDateString("tr-TR"),
        source: "local_roster",
      };
    }
  } catch { /* readDutyRoster hata verirse yok say */ }
  return { ok: false, message: "Nöbet API'ye ulaşılamıyor, yerel kayıt da bulunamadı.", source: "none" };
}

// Ham HTTP fetch: /api/nobetkayit/list/{teamId}/{teamType} → Promise<Array>
function fetchNobetList() {
  return new Promise((resolve, reject) => {
    const teamId   = (process.env.NOBETCI_TEAM_ID   || "").trim();
    const teamType = (process.env.NOBETCI_TEAM_TYPE  || "AGILE").trim();
    const baseGbnys = "https://gbnys.fw.garanti.com.tr";

    // T59: URL'i teamId/teamType env'dan olustur
    const apiUrl = teamId
      ? `${baseGbnys}/api/nobetkayit/list/${teamId}/${teamType}`
      : (process.env.NOBETCI_API_URL || `${baseGbnys}/api/nobetkayit/homepage/currentlist`);

    const hostOverride = (process.env.NOBETCI_API_HOST || "").trim();
    const parsed = new URL(apiUrl);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const opts = {
      hostname: hostOverride || parsed.hostname,
      port: Number(parsed.port) || (isHttps ? 443 : 80),
      path: parsed.pathname + (parsed.search || ""),
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "text/plain",
        Referer: `${parsed.protocol}//${parsed.host}/`,
        "User-Agent": "BMW-Portal/1.0",
        ...(hostOverride ? { Host: parsed.host } : {}),
      },
      timeout: 8000,
      rejectUnauthorized: false,
    };

    console.log(`[Nobetci] Baglaniyor: ${opts.hostname}:${opts.port}${opts.path}`);

    const req = lib.request(opts, (res2) => {
      const chunks = [];
      res2.on("data", (c) => chunks.push(c));
      res2.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8").trim();
        try {
          const data = JSON.parse(raw.replace(/^﻿/, ""));
          const arr = Array.isArray(data) ? data : (data?.data ?? data?.result ?? []);
          resolve(arr);
        } catch (e) {
          reject(new Error(`JSON parse hatasi: ${e.message} | raw: ${raw.slice(0, 120)}`));
        }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error",   (e) => reject(e));
    req.end();
  });
}

// DB-yazma katmani (actions.md #6) — bellek-ici Map'lerin YANINDA, restart-hayatta-kalan
// fallback icin. Yazma/okuma best-effort'tur: DB erisilemezse mevcut bellek-ici davranis
// (fetchNobetList basarisiz olursa nobetciFallback'e dus) AYNEN korunur.
async function dbCacheWrite(key, payload) {
  try {
    const db = require('../db/index.cjs');
    const json = JSON.stringify(payload);
    const upd = await db.query(
      `UPDATE nobetci_cache SET payload_json = $1, source = 'api', fetched_at = GETUTCDATE() WHERE cache_key = $2`,
      [json, key]
    );
    if (!upd.rowCount) {
      await db.query(`INSERT INTO nobetci_cache (cache_key, payload_json, source) VALUES ($1, $2, 'api')`, [key, json]);
    }
  } catch { /* best-effort */ }
}

async function dbCacheRead(key) {
  try {
    const db = require('../db/index.cjs');
    const { rows } = await db.query(`SELECT payload_json, fetched_at FROM nobetci_cache WHERE cache_key = $1`, [key]);
    if (!rows.length) return null;
    return { data: JSON.parse(rows[0].payload_json), fetchedAt: rows[0].fetched_at };
  } catch { return null; }
}

// Cache'li liste getter
async function getNobetList() {
  if (NOBETCI_LIST_CACHE.data && Date.now() - NOBETCI_LIST_CACHE.ts < LIST_TTL) {
    return NOBETCI_LIST_CACHE.data;
  }
  try {
    const list = await fetchNobetList();
    NOBETCI_LIST_CACHE.data = list;
    NOBETCI_LIST_CACHE.ts = Date.now();
    dbCacheWrite('nobetci_list', list).catch(() => {});
    return list;
  } catch (err) {
    // Bellek-ici cache de bossa (or. ilk istek, restart sonrasi) — DB'deki EN SON basarili
    // sonuca dus, harici API'nin TAMAMEN erisilemez oldugu bir "ilk istek" senaryosunu
    // (eskiden dogrudan nobetciFallback'e — tek-kisilik duty_roster kaydina — dusuyordu) onler.
    const cached = await dbCacheRead('nobetci_list');
    if (cached) {
      NOBETCI_LIST_CACHE.data = cached.data;
      NOBETCI_LIST_CACHE.ts = Date.now() - LIST_TTL + 60_000; // 1dk sonra tekrar canli denensin
      return cached.data;
    }
    throw err;
  }
}

// T60: startDate <= now < endDate kontrolu
function findTodayRecord(list) {
  const now = new Date();
  return list.find((r) => {
    const start = r.startDate ? new Date(r.startDate) : null;
    const end   = r.endDate   ? new Date(r.endDate)   : null;
    if (!start || !end) return false;
    return start <= now && now < end;
  }) || null;
}

// T32/T53: asNobetci ve yedekNobetci her ikisini parse et, intercom/email/phone dahil
function formatPerson(obj) {
  if (!obj) return null;
  const rawIntercom = obj.intercom || obj.dahili || null;
  return {
    name:     obj.fullName    || obj.name   || null,
    intercom: rawIntercom === "NULL" || rawIntercom === "null" ? null : rawIntercom,
    email:    obj.email       || obj.mail   || null,
    phone:    obj.phoneNumber || obj.gsm    || obj.phone || null,
  };
}

function initNobetci(app) {
  let requireAdmin = (req, res, next) => res.status(403).json({ ok: false, error: "Auth modulu yok." });
  try {
    const { requireAdmin: ra } = require("../auth/index.cjs");
    if (typeof ra === "function") requireAdmin = ra;
  } catch { /* auth modulu yoksa deny kalir */ }

  // /api/nobetci/today — T31: liste+tarih karsilastirmasi
  app.get("/api/nobetci/today", async (req, res) => {
    if (NOBETCI_TODAY_CACHE.data && Date.now() - NOBETCI_TODAY_CACHE.ts < TODAY_TTL) {
      return res.json(NOBETCI_TODAY_CACHE.data);
    }

    const teamName = process.env.NOBETCI_TEAM_NAME || "GT-Agile BMW";

    try {
      const list = await getNobetList();
      const record = findTodayRecord(list);

      let result;
      if (record) {
        const as    = formatPerson(record.asNobetci);
        const yedek = formatPerson(record.yedekNobetci);

        // LDAP'tan nobetci profil zenginlestirme (email varsa)
        let ldapProfile = null;
        if (as?.email) {
          try {
            const { findLdapUserByEmail } = require("../auth/ldap.cjs");
            ldapProfile = await findLdapUserByEmail(as.email);
          } catch { /* LDAP erisilemezse sessizce devam et */ }
        }

        // As ve yedek ayni kisiyse yedek bilgisini gosterme
        const isSamePerson = !!(as?.email && yedek?.email && as.email === yedek.email);

        // G-02: avatar ayri sakla, ana yanitta sadece URL
        const rawAvatar = ldapProfile?.avatarUrl || null;
        _nobetciAvatarDataUrl = rawAvatar;

        result = {
          ok: true,
          source: "api",
          name:         ldapProfile?.displayName || as?.name    || null,
          intercom:     as?.intercom || null,
          email:        as?.email    || null,
          phone:        as?.phone || null,
          avatarUrl:    rawAvatar ? "/api/nobetci/today/avatar" : null,
          department:   ldapProfile?.department  || null,
          title:        ldapProfile?.title       || null,
          yedekName:    isSamePerson ? null : yedek?.name    || null,
          yedekIntercom: isSamePerson ? null : yedek?.intercom || null,
          yedekEmail:   isSamePerson ? null : yedek?.email    || null,
          teamName,
          startDate: record.startDate || null,
          endDate:   record.endDate   || null,
          date: new Date().toLocaleDateString("tr-TR"),
        };
      } else {
        result = { ok: false, source: "api", message: `${teamName} icin bugun nobetci kaydi bulunamadi.` };
      }

      NOBETCI_TODAY_CACHE.data = result;
      NOBETCI_TODAY_CACHE.ts = Date.now();
      return res.json(result);
    } catch (err) {
      console.warn("[Nobetci] today hatasi:", err.message, "— fallback deneniyor");
      return res.json(nobetciFallback(teamName));
    }
  });

  // G-02: Nobetci avatar — ayri endpoint, binary JPEG olarak serve eder
  app.get("/api/nobetci/today/avatar", (req, res) => {
    if (!_nobetciAvatarDataUrl) return res.status(404).end();
    const match = _nobetciAvatarDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return res.status(404).end();
    const [, mime, data] = match;
    const buf = Buffer.from(data, "base64");
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.end(buf);
  });

  // /api/nobetci/list — T30: tum kayitlari dondur, startDate'e gore sirali (yeni→eski)
  // G-03: ?month=YYYY-MM filtresi
  app.get("/api/nobetci/list", async (req, res) => {
    try {
      const list = await getNobetList();
      const now = new Date();
      const { month } = req.query; // optional YYYY-MM filter

      let records = list.map((r) => {
        const as    = formatPerson(r.asNobetci);
        const yedek = formatPerson(r.yedekNobetci);
        const start = r.startDate ? new Date(r.startDate) : null;
        const end   = r.endDate   ? new Date(r.endDate)   : null;
        const isToday = start && end ? (start <= now && now < end) : false;
        const isSame = !!(as?.email && yedek?.email && as.email === yedek.email);
        return {
          asRecordId:   r.asRecordId   || null,
          startDate:    r.startDate    || null,
          endDate:      r.endDate      || null,
          isToday,
          asNobetci:    as,
          yedekNobetci: isSame ? null : yedek,
        };
      });

      // ?month=YYYY-MM → startDate'e gore filtrele
      if (month && /^\d{4}-\d{2}$/.test(String(month))) {
        records = records.filter((r) => r.startDate?.startsWith(String(month)));
      }

      // startDate DESC (yeni→eski)
      records.sort((a, b) => {
        const da = a.startDate ? new Date(a.startDate).getTime() : 0;
        const db = b.startDate ? new Date(b.startDate).getTime() : 0;
        return db - da;
      });

      return res.json({ ok: true, source: "api", records, month: month || null });
    } catch (err) {
      console.warn("[Nobetci] list hatasi:", err.message);
      return res.status(503).json({ ok: false, error: err.message });
    }
  });

  // K-08: Admin cache-clear endpoints — eskiden manuel req.session?.user?.role kontrolu
  // yapiyordu (Finding 15); artik paylasilan requireAdmin middleware'i kullanir (secret-kapili
  // trusted-header auth yolunu da destekler, diger moduller ile tutarli).
  // actions.md #6 — admin ekraninda ACIKCA gosterilecek veri-kaynagi bilgisi: su an bellek-ici
  // cache canli mi (API'den geldi), yoksa DB'deki en son basarili sonuca mi dusuldu, ve DB'ye
  // en son ne zaman basariyla yazildi (restart sonrasi da anlamli — DB satiri kalicidir).
  app.get("/api/admin/nobetci/source-status", requireAdmin, async (req, res) => {
    const memoryFresh = !!(NOBETCI_LIST_CACHE.data && Date.now() - NOBETCI_LIST_CACHE.ts < LIST_TTL);
    const dbCached = await dbCacheRead('nobetci_list');
    res.json({
      ok: true,
      currentSource: memoryFresh ? 'api_live' : (dbCached ? 'db_fallback' : 'none'),
      memoryFresh,
      dbLastSyncedAt: dbCached?.fetchedAt || null,
      config: {
        teamId: process.env.NOBETCI_TEAM_ID || null,
        teamType: process.env.NOBETCI_TEAM_TYPE || null,
        apiUrl: process.env.NOBETCI_API_URL || null,
        apiHost: process.env.NOBETCI_API_HOST || null,
      },
    });
  });

  app.post("/api/admin/cache/nobetci", requireAdmin, (req, res) => {
    NOBETCI_TODAY_CACHE.data = null;
    NOBETCI_TODAY_CACHE.ts = 0;
    console.log("[Cache] Nobet onbellegi temizlendi.");
    res.json({ ok: true, cleared: "nobetci" });
  });

  app.post("/api/admin/cache/awx-tokens", requireAdmin, (req, res) => {
    clearTokenCache();
    res.json({ ok: true, cleared: "awx-tokens" });
  });

  console.log("[Nobetci] module mounted at /api/nobetci (+ admin cache endpoints)");
}

module.exports = { initNobetci };
