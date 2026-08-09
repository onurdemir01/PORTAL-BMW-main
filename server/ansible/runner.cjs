// server/ansible/runner.cjs
"use strict";

const https = require("https");
const http = require("http");
const path = require("path");
const fs = require("fs");

// ── Simple YAML key:value parser (extra_vars fallback icin, frontend AnsiblePage.tsx
// ile ayni mantik — AWX Survey tanimli olmayan template'lerin extra_vars default'larini
// self-service akisinda da gostermek icin kullanilir) ─────────────────────────
function parseSimpleYaml(src) {
  const out = {};
  for (const line of String(src || "").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf(":");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

// ── Config ────────────────────────────────────────────────────────────────────

function getConfig() {
  const url = process.env.AWX_URL || "";
  const rawIds = process.env.AWX_READ_ONLY_TEMPLATE_IDS || "";
  const allowedIds = rawIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);

  return { url, allowedIds };
}

function isConfigured() {
  // True if any multi-server is configured OR legacy AWX_URL is set
  const multiServers = getServers();
  if (multiServers.length > 0) return true;
  const { url } = getConfig();
  const hasStaticToken = !!process.env.AWX_TOKEN;
  const hasUserPass = !!(process.env.AWX_USER && process.env.AWX_PASSWORD);
  return url.length > 0 && (hasStaticToken || hasUserPass);
}

// ── Multi-server support ───────────────────────────────────────────────────────

// AWX sunuculari artik ansible_awx_servers tablosundan (DB-oncelikli) okunur; bos
// secret alanlari icin env AWX_{no}_* fallback surer. DB yuklenmediyse/tablo bossa
// eski davranis (yalniz env) aynen korunur.
let _awxServersCache = null; // null → DB henuz yuklenmedi

async function loadAwxServers() {
  try {
    const dbx = require("../db/index.cjs");
    const { rows } = await dbx.query(
      `SELECT * FROM ansible_awx_servers WHERE enabled = 1 ORDER BY server_no`
    );
    _awxServersCache = rows.map((r) => ({
      id:           Number(r.server_no),
      name:         r.name || `AWX ${r.server_no}`,
      url:          r.url,
      token:        (r.token         || process.env[`AWX_${r.server_no}_TOKEN`]         || "").trim() || null,
      user:         (r.username      || process.env[`AWX_${r.server_no}_USER`]          || "").trim() || null,
      password:     (r.password      || process.env[`AWX_${r.server_no}_PASSWORD`]      || "").trim() || null,
      clientId:     (r.client_id     || process.env[`AWX_${r.server_no}_CLIENT_ID`]     || "").trim() || null,
      clientSecret: (r.client_secret || process.env[`AWX_${r.server_no}_CLIENT_SECRET`] || "").trim() || null,
    }));
    if (_awxServersCache.length) {
      console.log(`[Ansible] ${_awxServersCache.length} AWX sunucusu DB'den yuklendi.`);
    }
  } catch (e) {
    console.warn("[Ansible] AWX sunuculari DB'den yuklenemedi, env fallback:", e.message);
  }
}

function getServers() {
  if (_awxServersCache && _awxServersCache.length) return _awxServersCache.slice();
  const servers = [];
  for (let i = 1; i <= 9; i++) {
    const url = (process.env[`AWX_${i}_URL`] || "").trim();
    if (!url) continue;
    servers.push({
      id:           i,
      name:         (process.env[`AWX_${i}_NAME`]          || `AWX ${i}`).trim(),
      url,
      token:        (process.env[`AWX_${i}_TOKEN`]         || "").trim() || null,
      user:         (process.env[`AWX_${i}_USER`]          || "").trim() || null,
      password:     (process.env[`AWX_${i}_PASSWORD`]      || "").trim() || null,
      clientId:     (process.env[`AWX_${i}_CLIENT_ID`]     || "").trim() || null,
      clientSecret: (process.env[`AWX_${i}_CLIENT_SECRET`] || "").trim() || null,
    });
  }
  // Backward compat: legacy AWX_URL as server 0
  if (servers.length === 0 && process.env.AWX_URL) {
    servers.push({
      id:       0,
      name:     "AWX",
      url:      process.env.AWX_URL.trim(),
      token:    process.env.AWX_TOKEN || null,
      user:     process.env.AWX_USER  || null,
      password: process.env.AWX_PASSWORD || null,
    });
  }
  return servers;
}

function getServerById(id) {
  const numId = Number(id);
  return getServers().find((s) => s.id === numId) || null;
}

// Per-server token caches
const _serverTokenCaches = new Map(); // serverId → { token, expiresAt }

async function getTokenForServer(server) {
  if (server.token) return server.token;

  const { user, password, url, id, clientId, clientSecret } = server;
  if (!user || !password) throw new Error(`${server.name} için token veya user/password eksik.`);

  const cache = _serverTokenCaches.get(id) || { token: null, expiresAt: null };
  if (cache.token && cache.expiresAt && new Date(cache.expiresAt) > new Date(Date.now() + 60_000)) {
    return cache.token;
  }

  const result = await fetchNewToken(url, user, password, clientId, clientSecret);
  _serverTokenCaches.set(id, { token: result.token, expiresAt: result.expires });
  console.log(`[AWX:${server.name}] Yeni token alindi, expire: ${result.expires}`);
  return result.token;
}

// AWX template sayfalarini sonuna kadar dolasir (sinirsiz kayit icin).
// Emniyet siniri: bozuk bir sunucunun surekli `next` dondurmesine karsi 50 sayfa
// (page_size=100 → 5.000 template kapasitesi).
const MAX_TEMPLATE_PAGES = 50;

async function fetchAllTemplatePages(requestFn, baseUrl) {
  const allResults = [];
  let nextUrl = "/api/v2/job_templates/?page_size=100";
  let pageCount = 0;
  while (nextUrl && pageCount < MAX_TEMPLATE_PAGES) {
    const data = await requestFn(nextUrl);
    allResults.push(...(data.results || []));
    pageCount++;
    // data.next AWX/Tower'a gore absolute VEYA relative olabilir (ters proxy/host
    // ayarlarina bagli) — new URL(value, base) iki argumanli formu her ikisini de
    // dogru cozer (value absolute ise base yok sayilir).
    if (data.next) {
      try {
        const parsed = new URL(data.next, baseUrl);
        nextUrl = parsed.pathname + parsed.search;
      } catch (err) {
        console.warn("[AWX] next sayfa URL'i parse edilemedi, sayfalama durduruldu:", data.next, err.message);
        nextUrl = null;
      }
    } else {
      nextUrl = null;
    }
  }
  return allResults;
}

async function listTemplatesForServer(server) {
  const rawIds = process.env.AWX_READ_ONLY_TEMPLATE_IDS || "";
  const allowedIds = rawIds.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);

  const token = await getTokenForServer(server);

  // F-03: Paginate through all AWX template pages via the shared helper
  const allResults = await fetchAllTemplatePages((path) => awxRequestToServer(server, token, "GET", path), server.url);

  const results = allResults.filter((t) => allowedIds.length === 0 || allowedIds.includes(t.id));
  return results.map((t) => ({
    id:           t.id,
    name:         t.name,
    description:  t.description || "",
    playbook:     t.playbook,
    inventory:    t.summary_fields?.inventory?.name || "",
    ask_variables: t.ask_variables_on_launch || false,
    variables:    t.extra_vars || "",
    labels:       (t.summary_fields?.labels?.results || []).map((l) => l.name),
    isReadOnly:   allowedIds.length === 0 || allowedIds.includes(t.id),
    lastLaunch:   t.summary_fields?.recent_jobs?.[0]?.finished || null,
    // actions.md #8 — asagidaki 6 alan AYNI AWX yanitindan (ek cagri GEREKMEZ) okunur,
    // eskiden cikartilmiyorlardi (admin ekrani bunlari gostermeye calisiyordu ama hep bostu):
    jobType:      t.job_type || "run",
    project:      t.summary_fields?.project?.name || "",
    credentials:  (t.summary_fields?.credentials || []).map((c) => c.name),
    surveyEnabled: t.survey_enabled || false,
    modified:     t.modified || null,
    // AWX'in job_template nesnesinde gercek bir "active/enabled" alani YOK (soft-delete'li
    // sablonlar zaten bu listede hic gorunmez) — bunun yerine dogrudan launch edilebilirligi
    // etkileyen gercek bir sinyal donduruyoruz: envanter atanmis mi.
    hasInventory: !!t.summary_fields?.inventory,
  }));
}

function awxRequestToServer(server, token, method, pathname, body = null) {
  const parsed  = new URL(pathname, server.url);
  const lib     = parsed.protocol === "https:" ? https : http;
  const bodyStr = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
      rejectUnauthorized: false,
      timeout: 15000,
    };
    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) reject(Object.assign(new Error(`AWX HTTP ${res.statusCode}`), { status: res.statusCode, body: json }));
          else resolve(json);
        } catch {
          reject(new Error(`AWX yanıtı JSON değil (${res.statusCode}): ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("AWX isteği zaman aşımına uğradı.")); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Token cache (user/pass → token, expire kontrolu) ─────────────────────────
const _tokenCache = { token: null, expiresAt: null };

async function getToken() {
  // Once statik token (geriye uyumluluk)
  if (process.env.AWX_TOKEN) return process.env.AWX_TOKEN;

  const user = process.env.AWX_USER;
  const pass = process.env.AWX_PASSWORD;
  if (!user || !pass) throw new Error("AWX_TOKEN veya AWX_USER+AWX_PASSWORD tanımlı değil.");

  // Cache gecerliyse kullan (1 dk erken yenile)
  if (_tokenCache.token && _tokenCache.expiresAt && new Date(_tokenCache.expiresAt) > new Date(Date.now() + 60_000)) {
    return _tokenCache.token;
  }

  // Yeni token al
  const { url } = getConfig();
  const token = await fetchNewToken(url, user, pass);
  _tokenCache.token = token.token;
  _tokenCache.expiresAt = token.expires;
  console.log("[AWX] Yeni token alindi, expire:", token.expires);
  return _tokenCache.token;
}

// OAuth2 password grant: POST /api/o/token/ (preferred) or /o/token/ (legacy)
function fetchTokenOAuth2AtPath(baseUrl, tokenPath, user, pass, clientId = null, clientSecret = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(tokenPath, baseUrl);
    const lib    = parsed.protocol === "https:" ? https : http;
    let body = `grant_type=password&username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
    if (clientId)     body += `&client_id=${encodeURIComponent(clientId)}`;
    if (clientSecret) body += `&client_secret=${encodeURIComponent(clientSecret)}`;
    const bodyBuf = Buffer.from(body);

    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname,
      method:   "POST",
      headers: {
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": bodyBuf.length,
        Accept:           "application/json",
      },
      rejectUnauthorized: false,
      timeout: 10000,
    };

    const req = lib.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`AWX OAuth2 token başarısız (${res.statusCode}) [${tokenPath}]: ${json?.error_description || json?.error || data.slice(0, 100)}`));
          } else {
            // OAuth2 returns access_token; no explicit expires, use 8h
            const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
            resolve({ token: json.access_token, expires });
          }
        } catch {
          reject(new Error(`AWX OAuth2 yanıtı JSON değil [${tokenPath}]: ${data.slice(0, 100)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("AWX OAuth2 token zaman aşımı.")); });
    req.write(bodyBuf);
    req.end();
  });
}

async function fetchTokenOAuth2(baseUrl, user, pass, clientId = null, clientSecret = null) {
  // Newer AWX deployments commonly expose OAuth at /api/o/token/ behind proxies.
  const firstPath = "/api/o/token/";
  const secondPath = "/o/token/";
  try {
    return await fetchTokenOAuth2AtPath(baseUrl, firstPath, user, pass, clientId, clientSecret);
  } catch (firstErr) {
    try {
      return await fetchTokenOAuth2AtPath(baseUrl, secondPath, user, pass, clientId, clientSecret);
    } catch (secondErr) {
      throw new Error(`${firstErr.message} | ${secondErr.message}`);
    }
  }
}

// AWX API token via Basic auth: POST /api/v2/tokens/ (fallback method)
function fetchTokenV2(baseUrl, user, pass) {
  return new Promise((resolve, reject) => {
    const parsed    = new URL("/api/v2/tokens/", baseUrl);
    const lib       = parsed.protocol === "https:" ? https : http;
    const basicAuth = Buffer.from(`${user}:${pass}`).toString("base64");
    const bodyStr   = "{}";

    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname,
      method:   "POST",
      headers: {
        Authorization:    `Basic ${basicAuth}`,
        "Content-Type":   "application/json",
        Accept:           "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      },
      rejectUnauthorized: false,
      timeout: 10000,
    };

    const req = lib.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`AWX v2/tokens başarısız (${res.statusCode}): ${json?.detail || data.slice(0, 100)}`));
          } else {
            resolve({ token: json.token, expires: json.expires });
          }
        } catch {
          reject(new Error(`AWX v2/tokens yanıtı JSON değil: ${data.slice(0, 100)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("AWX v2/tokens zaman aşımı.")); });
    req.write(bodyStr);
    req.end();
  });
}

// fetchNewToken: OAuth2 (when client creds are present), v2/tokens fallback/default
async function fetchNewToken(baseUrl, user, pass, clientId = null, clientSecret = null) {
  const hasClientId = !!(clientId && String(clientId).trim());
  const hasClientSecret = !!(clientSecret && String(clientSecret).trim());
  const canTryOAuth = hasClientId && hasClientSecret;

  if (canTryOAuth) {
    try {
      return await fetchTokenOAuth2(baseUrl, user, pass, clientId, clientSecret);
    } catch (oauthErr) {
      console.warn(`[AWX] OAuth2 token basarisiz (${oauthErr.message}), /api/v2/tokens/ deneniyor...`);
    }
  } else if (hasClientId !== hasClientSecret) {
    console.warn("[AWX] OAuth2 client bilgisi eksik (client_id/client_secret birlikte olmali), dogrudan /api/v2/tokens/ kullanilacak.");
  }

  try {
    return await fetchTokenV2(baseUrl, user, pass);
  } catch (v2Err) {
    if (canTryOAuth) {
      throw new Error(`AWX token alınamadı — OAuth2 denendi ama başarısız oldu; v2/tokens: ${v2Err.message}`);
    }
    throw new Error(`AWX token alınamadı — v2/tokens: ${v2Err.message}`);
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function awxRequest(method, pathname, body = null) {
  const { url } = getConfig();
  if (!url) throw new Error("AWX_URL ortam değişkeni tanımlı değil.");

  const token = await getToken();
  const parsed = new URL(pathname, url);
  const lib = parsed.protocol === "https:" ? https : http;
  const bodyStr = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
      rejectUnauthorized: false,
      timeout: 15000,
    };

    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        // Token expire olduysa cache'i temizle
        if (res.statusCode === 401) {
          _tokenCache.token = null;
          _tokenCache.expiresAt = null;
        }
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(Object.assign(new Error(`AWX HTTP ${res.statusCode}`), { status: res.statusCode, body: json }));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error(`AWX yanıtı JSON değil (${res.statusCode}): ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("AWX isteği zaman aşımına uğradı.")); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Job templates ─────────────────────────────────────────────────────────────

async function listTemplates() {
  const { url, allowedIds } = getConfig();
  const allResults = await fetchAllTemplatePages((path) => awxRequest("GET", path), url);
  const results = allResults.filter((t) => {
    if (allowedIds.length === 0) return true;
    return allowedIds.includes(t.id);
  });
  return results.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description || "",
    playbook: t.playbook,
    inventory: t.summary_fields?.inventory?.name || "",
    ask_variables: t.ask_variables_on_launch || false,
    variables: t.extra_vars || "",
    labels: (t.summary_fields?.labels?.results || []).map((l) => l.name),
    isReadOnly: allowedIds.length === 0 || allowedIds.includes(t.id),
    lastLaunch: t.summary_fields?.recent_jobs?.[0]?.finished || null,
    jobType:      t.job_type || "run",
    project:      t.summary_fields?.project?.name || "",
    credentials:  (t.summary_fields?.credentials || []).map((c) => c.name),
    surveyEnabled: t.survey_enabled || false,
    modified:     t.modified || null,
    hasInventory: !!t.summary_fields?.inventory,
  }));
}

// ── Launch job ────────────────────────────────────────────────────────────────

async function launchJob(templateId, extraVars = {}, limit = "") {
  const { allowedIds } = getConfig();
  const id = Number(templateId);

  if (isNaN(id) || id <= 0) throw new Error("Geçersiz template ID.");

  if (allowedIds.length > 0 && !allowedIds.includes(id)) {
    throw Object.assign(new Error("Bu template ID'ye izin verilmiyor."), { status: 403 });
  }

  const payload = {};
  if (Object.keys(extraVars).length > 0) {
    payload.extra_vars = JSON.stringify(extraVars);
  }
  if (limit) payload.limit = limit;

  const data = await awxRequest("POST", `/api/v2/job_templates/${id}/launch/`, payload);
  return { jobId: data.id, status: data.status };
}

// ── Job status ────────────────────────────────────────────────────────────────

async function getJobStatus(jobId) {
  const id = Number(jobId);
  if (isNaN(id) || id <= 0) throw new Error("Geçersiz job ID.");

  const data = await awxRequest("GET", `/api/v2/jobs/${id}/`);

  // "changed" uyarisi: production guvenlik kurali
  const hasChanged = data.result_traceback
    ? data.result_traceback.includes("changed=") && !data.result_traceback.includes("changed=0")
    : false;

  return {
    jobId: data.id,
    status: data.status,           // pending | waiting | running | successful | failed | error | canceled
    started: data.started,
    finished: data.finished,
    elapsed: data.elapsed,
    failed: data.failed,
    hasChanged,
    playbook: data.playbook,
    inventory: data.summary_fields?.inventory?.name || "",
    launchedBy: data.summary_fields?.launched_by?.name || "",
  };
}

// ── Job output ────────────────────────────────────────────────────────────────

// AWX'in stdout ucu (`?format=txt`) DUZ METIN doner, JSON DEGIL — awxRequest/
// awxRequestToServer'in kosulsuz JSON.parse'i burada asla kullanilamaz (onceden
// getJobOutputOnServer bu hatayi yapiyordu, her zaman JSON.parse patlayip bos
// cikti donduruyordu). Tek-sunucu (getJobOutput) ve coklu-sunucu
// (getJobOutputOnServer) varyantlarinin IKISI de bu tek yardimciyi kullanir.
function fetchAwxPlainText(baseUrl, token, pathname) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(pathname, baseUrl);
    const lib = parsed.protocol === "https:" ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/plain",
      },
      rejectUnauthorized: false,
      timeout: 30000,
    };

    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(Object.assign(new Error(`AWX HTTP ${res.statusCode}`), { status: res.statusCode }));
        } else {
          resolve(data);
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Stdout isteği zaman aşımına uğradı.")); });
    req.end();
  });
}

// AWX'in `/stdout/?format=txt` ucu, cikti kendi ic esigini (varsayilan 1MB,
// STDOUT_MAX_BYTES_DISPLAY) astiginda HTTP 200 ile birlikte GERCEK stdout YERINE
// "Standard Output too large to display (N bytes), only download supported for
// sizes over M bytes." metnini doner — bu bir hata durumu DEGIL (4xx firlatmaz),
// dolayisiyla `!output.trim()` bos-cikti kontrolu bunu YAKALAMAZ ve bu uyari metni
// kullaniciya SANKI GERCEK STDOUT'MUS gibi gosterilirdi. job_events yedegine
// (sayfalanmis, boyut siniri olmayan) dusmek icin bu deseni ayrica tespit ederiz.
function isAwxStdoutTooLarge(text) {
  return typeof text === "string" && /Standard Output too large to display/i.test(text);
}

// Stdout gercekten bos donduren (parse hatasi degil, gercek bosluk) durumlar icin
// yedek: job_events uzerinden her event'in kendi `stdout` alanini birlestirir.
// requestJson: (pathname) => Promise<jsonBody> — cagirana gore awxRequest veya
// awxRequestToServer(server, token, ...) baglanir (bkz. asagidaki iki sarmalayici).
async function collectJobEventsStdout(requestJson, jobId) {
  // page_size/guard: "cikti cok buyuk" senaryosunun tam olarak KENDISI icin bir yedek
  // oldugundan (bkz. isAwxStdoutTooLarge) eski 200*25=5000 event sinirini asan gercekten
  // buyuk job'lar (ör. 1MB+ stdout) yarim cikti gorurdu — 500*80=40000 event'e cikarildi.
  let pathname = `/api/v2/jobs/${jobId}/job_events/?page_size=500&order_by=counter`;
  const chunks = [];
  let guard = 0;
  while (pathname && guard < 80) {
    let data;
    try {
      data = await requestJson(pathname);
    } catch {
      break; // events ucu da basarisizsa sessizce elimizdekiyle yetin
    }
    const results = Array.isArray(data.results) ? data.results : [];
    for (const ev of results) {
      if (ev && typeof ev.stdout === "string" && ev.stdout.length) chunks.push(ev.stdout);
    }
    pathname = data.next || null;
    guard++;
  }
  return chunks.join("\n");
}

async function getJobOutput(jobId) {
  const id = Number(jobId);
  if (isNaN(id) || id <= 0) throw new Error("Geçersiz job ID.");

  const { url } = getConfig();
  const token = await getToken();

  let output = await fetchAwxPlainText(url, token, `/api/v2/jobs/${id}/stdout/?format=txt`);
  if (!output || !output.trim() || isAwxStdoutTooLarge(output)) {
    output = await collectJobEventsStdout((p) => awxRequest("GET", p), id);
  }

  // Production safety: warn if "changed" appears in output
  const lines = output.split("\n");
  const changedWarning = lines.some((l) => /changed=\s*[1-9]/.test(l));
  return { output, changedWarning };
}

// ── Coklu-sunucu launch/status/output (LogX v2 tarafindan kullanilir) ─────────
// launchJob/getJobStatus/getJobOutput yukarida tek-legacy-AWX'e (`awxRequest`) sabit —
// bu uc sarmalayici, zaten var olan coklu-sunucu ic yardimcilarini (getServerById,
// getTokenForServer, awxRequestToServer — /launch-ss/:serverId/:templateId route'unun
// kullandigi ayni primitifler) LogX v2'nin ihtiyac duydugu serverId-parametreli genel
// API olarak export eder. Mevcut tek-sunucu fonksiyonlarina dokunmaz.

async function launchJobOnServer(serverId, templateId, extraVars = {}, limit = "") {
  const server = getServerById(serverId);
  if (!server) throw Object.assign(new Error("AWX sunucusu bulunamadı."), { status: 404 });

  const id = Number(templateId);
  if (isNaN(id) || id <= 0) throw Object.assign(new Error("Geçersiz template ID."), { status: 400 });

  const payload = {};
  if (extraVars && Object.keys(extraVars).length > 0) payload.extra_vars = JSON.stringify(extraVars);
  if (limit) payload.limit = limit;

  const token = await getTokenForServer(server);
  const data = await awxRequestToServer(server, token, "POST", `/api/v2/job_templates/${id}/launch/`, payload);
  return { jobId: data.id, status: data.status };
}

async function getJobStatusOnServer(serverId, jobId) {
  const server = getServerById(serverId);
  if (!server) throw Object.assign(new Error("AWX sunucusu bulunamadı."), { status: 404 });

  const id = Number(jobId);
  if (isNaN(id) || id <= 0) throw Object.assign(new Error("Geçersiz job ID."), { status: 400 });

  const token = await getTokenForServer(server);
  const data = await awxRequestToServer(server, token, "GET", `/api/v2/jobs/${id}/`);

  return {
    jobId: data.id,
    status: data.status,   // pending | waiting | running | successful | failed | error | canceled
    started: data.started,
    finished: data.finished,
    elapsed: data.elapsed,
    failed: data.failed,
    // LogX v2 yapilandirilmis job ciktisini ham stdout parse ederek DEGIL, playbook'un
    // son adiminda `ansible.builtin.set_stats` ile yayinladigi `artifacts` alanindan okur
    // (bkz. plan dosyasi B-new-2) — kirilgan regex/stdout-parsing YOK.
    artifacts: data.artifacts || {},
    playbook: data.playbook,
    inventory: data.summary_fields?.inventory?.name || "",
    launchedBy: data.summary_fields?.launched_by?.name || "",
  };
}

async function getJobOutputOnServer(serverId, jobId) {
  const server = getServerById(serverId);
  if (!server) throw Object.assign(new Error("AWX sunucusu bulunamadı."), { status: 404 });

  const id = Number(jobId);
  if (isNaN(id) || id <= 0) throw Object.assign(new Error("Geçersiz job ID."), { status: 400 });

  const token = await getTokenForServer(server);

  let output = "";
  try {
    output = await fetchAwxPlainText(server.url, token, `/api/v2/jobs/${id}/stdout/?format=txt`);
  } catch (err) {
    console.warn(`[AWX] stdout cekilemedi (job ${id}, server ${serverId}): ${err.message}`);
  }

  if (!output || !output.trim() || isAwxStdoutTooLarge(output)) {
    output = await collectJobEventsStdout((p) => awxRequestToServer(server, token, "GET", p), id);
  }

  return { output };
}

// AWX'te calisan bir job'i iptal eder (POST /api/v2/jobs/:id/cancel/). AWX zaten terminal
// duruma gelmis bir job icin 405/400 doner — bunu yutup sessizce basarili sayariz (idempotent
// iptal: kullanici "Iptal Et"e bastiginda job o an bitmisse yine de temiz sonuc donsun).
async function cancelJobOnServer(serverId, jobId) {
  const server = getServerById(serverId);
  if (!server) throw Object.assign(new Error("AWX sunucusu bulunamadı."), { status: 404 });

  const id = Number(jobId);
  if (isNaN(id) || id <= 0) throw Object.assign(new Error("Geçersiz job ID."), { status: 400 });

  const token = await getTokenForServer(server);
  try {
    await awxRequestToServer(server, token, "POST", `/api/v2/jobs/${id}/cancel/`);
    return { canceled: true };
  } catch (err) {
    const status = err && err.status;
    // 405 Method Not Allowed = job zaten terminal (iptal edilemez); bunu hata sayma.
    if (status === 405 || status === 409) return { canceled: false, alreadyTerminal: true };
    throw err;
  }
}

// ── OCP clusters CRUD ─────────────────────────────────────────────────────────
// Faz 5: veri katmani server/ansible/ocp-store.cjs modulune tasindi (god-module kucultme).
const {
  getOcpClusters, addOcpCluster, updateOcpCluster, deleteOcpCluster, loadOcpStore,
} = require("./ocp-store.cjs");

// ── Express route init ────────────────────────────────────────────────────────

function initAnsibleRunner(app) {
  // Tum /api/ansible mutasyonlari (launch, SS item/customization, OCP cluster CRUD)
  // portal_audit_logs'a yazilir — bkz. server/audit/index.cjs (secret'lar redakte edilir).
  try { app.use("/api/ansible", require("../audit/index.cjs").auditMutations("ansible")); } catch { /* yoksay */ }
  // Paylasilan auth guard'lari (secret-kapili; header'a dogrudan guvenmez). Auth modulu
  // yuklenemezse fallback KAPALI (deny) — guvenli varsayilan.
  let requireAuth = (req, res, next) => res.status(401).json({ ok: false, message: "Auth modülü yok." });
  let requireAdmin = (req, res, next) => res.status(403).json({ ok: false, message: "Auth modülü yok." });
  try {
    const authMod = require("../auth/index.cjs");
    if (typeof authMod.requireAuth === "function") requireAuth = authMod.requireAuth;
    if (typeof authMod.requireAdmin === "function") requireAdmin = authMod.requireAdmin;
  } catch {
    // auth modulu yoksa deny kalir
  }

  // "Ansible" SAYFASINA ozgu uclar icin gercek server-side gorunurluk kontrolu: sayfa
  // kullaniciya kapatilsa bile bu API'ler aciktir ve URL'i bilen biri cagirabilirdi.
  //
  // DIKKAT: /api/ansible prefix'inin TAMAMI kapatilamaz — /ss/*, /survey/*,
  // /awx/recent-jobs gibi uclar Self Service sayfasi ve Dashboard tarafindan, Ansible
  // sayfasi gorunmese de kullanilir. Bu yuzden gate SAYFAYA OZGU uclara tek tek konur.
  let requireAnsiblePage = (req, res, next) => next();
  try {
    requireAnsiblePage = require("../auth/visibility.cjs").requireVisible("Ansible");
  } catch { /* motor yoksa gecis serbest (mevcut davranis) */ }

  // GET /api/ansible/awx/health — GERCEK AWX baglanti kontrolu (actions.md #8).
  // Onceden bu ucu yalniz env/DB'de yapilandirma VAR MI kontrol ediyordu, AWX'e hic
  // baglanmiyordu — frontend'in gostermeye calistigi url/version alanlari hep boyle
  // olu kalmisti. Artik her yapilandirilmis sunucuya gercek bir /api/v2/ping/ atilir,
  // sonuc (ulasilabilirlik, kimlik dogrulama, sure, versiyon) hem yanitta doner hem
  // (DB'den yuklenmis sunucular icin) ansible_awx_servers'a kalici yazilir.
  app.get("/api/ansible/awx/health", requireAuth, requireAnsiblePage, async (req, res) => {
    const servers = getServers();
    if (servers.length === 0) {
      return res.json({ ok: false, configured: false, serverCount: 0, servers: [], message: "Hiçbir AWX sunucusu yapılandırılmamış." });
    }

    const results = await Promise.all(servers.map(async (server) => {
      const configured = !!(server.token || (server.user && server.password));
      if (!configured) {
        return {
          id: server.id, name: server.name, url: server.url, configured: false,
          reachable: false, authOk: false, checkedAt: new Date().toISOString(),
          responseTimeMs: null, awxVersion: null, error: "Kimlik bilgisi eksik.",
        };
      }

      const startedAt = Date.now();
      let authOk = false, reachable = false, awxVersion = null, error = null;
      try {
        const token = await getTokenForServer(server);
        authOk = true;
        const pingData = await awxRequestToServer(server, token, "GET", "/api/v2/ping/");
        reachable = true;
        awxVersion = pingData?.version || null;
      } catch (err) {
        error = err.message;
      }
      const responseTimeMs = Date.now() - startedAt;
      const status = reachable ? "ok" : (authOk ? "unreachable" : "auth_failed");

      // Best-effort kalicilik — yalniz DB'den yuklenmis sunucular icin bir satir bulunur
      // (env-only sunucularda ansible_awx_servers satiri olmayabilir, UPDATE 0 satir doner).
      try {
        const dbx = require("../db/index.cjs");
        await dbx.query(
          `UPDATE ansible_awx_servers SET last_checked_at = GETUTCDATE(), last_status = $1, last_response_ms = $2 WHERE server_no = $3`,
          [status, responseTimeMs, server.id]
        );
      } catch { /* best-effort */ }

      return {
        id: server.id, name: server.name, url: server.url, configured: true,
        reachable, authOk, checkedAt: new Date().toISOString(), responseTimeMs, awxVersion, error,
        connectionType: server.token ? "token" : "user_pass",
      };
    }));

    const anyOk = results.some((r) => r.reachable && r.authOk);
    const primary = results[0] || null;
    res.json({
      ok: anyOk,
      configured: isConfigured(),
      serverCount: servers.length,
      servers: results,
      // Geriye uyumluluk: eski tek-deger alanlar ilk sunucudan turetilir (AnsibleConfigTab).
      url: primary?.url,
      version: primary?.awxVersion,
      message: anyOk ? undefined : (primary?.error || "AWX'e erişilemedi."),
    });
  });

  // GET /api/ansible/servers — multi-server list (no credentials exposed)
  app.get("/api/ansible/servers", requireAuth, (req, res) => {
    const servers = getServers().map((s) => ({
      id:         s.id,
      name:       s.name,
      configured: !!(s.token || (s.user && s.password)),
    }));
    res.json({ ok: true, servers });
  });

  // GET /api/ansible/awx/recent-jobs — Dashboard "Kuyruktaki Ansible İşleri" karti icin
  // Maestro/Maestro2 AWX sunucularinda su an kuyrukta/calisan (pending|waiting|running)
  // job'lari doner. Sunucu adi "maestro" ile BASLAYANLAR taranir (case-insensitive) —
  // onceki halde tam "maestro"/"maestro2" esitligi araniyordu; "Maestro" eslesince
  // fallback hic tetiklenmiyordu, "Maestro2" adi ufak bir bosluk/tire farkiyla bile
  // kayiyordu (bkz. kullanici bildirimi: Maestro gorunuyor, Maestro2 gorunmuyor).
  app.get("/api/ansible/awx/recent-jobs", requireAuth, async (req, res) => {
    const all = getServers();
    const targets = all.filter((s) => String(s.name || "").toLowerCase().replace(/[\s_-]/g, "").startsWith("maestro"));
    const servers = targets.length > 0 ? targets : all;

    const results = await Promise.all(servers.map(async (server) => {
      if (!server.token && !(server.user && server.password)) {
        return { serverId: server.id, serverName: server.name, ok: false, jobs: [], error: "Kimlik bilgisi eksik." };
      }
      try {
        const token = await getTokenForServer(server);
        const data = await awxRequestToServer(
          server, token, "GET",
          "/api/v2/jobs/?status__in=pending,waiting,running&order_by=-created&page_size=15"
        );
        const jobs = (data.results || []).map((j) => ({
          jobId:       j.id,
          status:      j.status,
          jobTemplate: j.summary_fields?.job_template?.name || j.name || "—",
          // AWX'in LISTE endpoint'i (list serializer) summary_fields.launched_by'i
          // DETAY endpoint'inden farkli olarak bazen atlar — created_by'e de dusuyoruz.
          executer:    j.summary_fields?.launched_by?.name
                       || j.summary_fields?.created_by?.username
                       || j.summary_fields?.created_by?.name
                       || "—",
          created:     j.created,
        }));
        return { serverId: server.id, serverName: server.name, ok: true, jobs };
      } catch (err) {
        return { serverId: server.id, serverName: server.name, ok: false, jobs: [], error: err.message || "AWX'e erişilemedi." };
      }
    }));

    res.json({ ok: true, servers: results });
  });

  // GET /api/ansible/templates/:serverId — templates for a specific server
  // F-09: ?search=query filters by name/description
  app.get("/api/ansible/templates/:serverId", requireAuth, requireAnsiblePage, async (req, res) => {
    const server = getServerById(req.params.serverId);
    if (!server) return res.status(404).json({ ok: false, message: "Sunucu bulunamadı." });
    if (!server.token && !(server.user && server.password)) {
      return res.json({ ok: false, message: `${server.name} için kimlik bilgisi eksik.`, templates: [] });
    }
    try {
      let templates = await listTemplatesForServer(server);
      const search = req.query.search ? String(req.query.search).toLowerCase().trim() : "";
      if (search) {
        templates = templates.filter((t) =>
          t.name.toLowerCase().includes(search) || t.description.toLowerCase().includes(search)
        );
      }
      res.json({ ok: true, templates, total: templates.length });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message, templates: [] });
    }
  });

  // GET /api/ansible/clusters
  app.get("/api/ansible/clusters", requireAuth, (req, res) => {
    res.json({ ok: true, clusters: getOcpClusters() });
  });

  // POST /api/ansible/clusters — admin, yeni cluster ekle
  app.post("/api/ansible/clusters", requireAuth, requireAdmin, async (req, res) => {
    const { name, display, env, apiUrl, consoleUrl, token, description, namespace, jumpHost, tenant } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ ok: false, message: "name zorunlu." });
    }
    let cluster;
    try {
      cluster = await addOcpCluster({
        name, display, env, apiUrl, consoleUrl, token, description, namespace, jumpHost, tenant,
        createdBy: req.session?.user?.username || null,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, message: `Kaydedilemedi: ${e.message}` });
    }
    res.json({ ok: true, cluster });
  });

  // PUT /api/ansible/clusters/:id — admin, cluster guncelle
  app.put("/api/ansible/clusters/:id", requireAuth, requireAdmin, async (req, res) => {
    let cluster;
    try {
      cluster = await updateOcpCluster(req.params.id, req.body || {});
    } catch (e) {
      return res.status(500).json({ ok: false, message: `Kaydedilemedi: ${e.message}` });
    }
    if (!cluster) return res.status(404).json({ ok: false, message: "Cluster bulunamadı." });
    res.json({ ok: true, cluster });
  });

  // DELETE /api/ansible/clusters/:id — admin, cluster sil
  app.delete("/api/ansible/clusters/:id", requireAuth, requireAdmin, async (req, res) => {
    let deleted;
    try {
      deleted = await deleteOcpCluster(req.params.id);
    } catch (e) {
      return res.status(500).json({ ok: false, message: `Silinemedi: ${e.message}` });
    }
    if (!deleted) return res.status(404).json({ ok: false, message: "Cluster bulunamadı." });
    res.json({ ok: true, clusters: getOcpClusters() });
  });

  // POST /api/ansible/clusters/:id/test-connection — admin, HAFIF erisilebilirlik testi
  // (actions.md #9). "Pod Durumu" ozelliginden (AWX playbook + jump-host GEREKTIRIR) KASITLI
  // olarak AYRI ve daha basit: cluster'in kendi api_url'ine, kendi token'iyla dogrudan bir
  // OCP/Kubernetes API cagrisi (GET /version) atar — jump-host tanimli olmasa bile calisir.
  app.post("/api/ansible/clusters/:id/test-connection", requireAuth, requireAdmin, async (req, res) => {
    const { setClusterConnectionStatus } = require("./ocp-store.cjs");
    const cluster = getOcpClusters().find((c) => c.id === req.params.id);
    if (!cluster) return res.status(404).json({ ok: false, message: "Cluster bulunamadı." });
    if (!cluster.apiUrl) return res.status(400).json({ ok: false, message: "Bu cluster için API URL tanımlı değil." });

    const startedAt = Date.now();
    const result = await new Promise((resolve) => {
      let parsed;
      try {
        parsed = new URL("/version", cluster.apiUrl);
      } catch {
        resolve({ ok: false, message: "Geçersiz API URL." });
        return;
      }
      const lib = parsed.protocol === "https:" ? https : http;
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname,
        method: "GET",
        headers: cluster.token ? { Authorization: `Bearer ${cluster.token}` } : {},
        rejectUnauthorized: false,
        timeout: 5000,
      };
      const httpReq = lib.request(options, (httpRes) => {
        let data = "";
        httpRes.on("data", (c) => { data += c; });
        httpRes.on("end", () => {
          if (httpRes.statusCode && httpRes.statusCode < 400) {
            resolve({ ok: true });
          } else if (httpRes.statusCode === 401 || httpRes.statusCode === 403) {
            resolve({ ok: false, message: `Erişilebilir ama kimlik doğrulama başarısız (HTTP ${httpRes.statusCode}).` });
          } else {
            resolve({ ok: false, message: `HTTP ${httpRes.statusCode}: ${data.slice(0, 150)}` });
          }
        });
      });
      httpReq.on("error", (err) => resolve({ ok: false, message: err.message }));
      httpReq.on("timeout", () => { httpReq.destroy(); resolve({ ok: false, message: "Bağlantı zaman aşımına uğradı." }); });
      httpReq.end();
    });

    const responseTimeMs = Date.now() - startedAt;
    const status = result.ok ? "ok" : "unreachable";
    await setClusterConnectionStatus(cluster.id, status).catch(() => {});
    res.json({ ok: result.ok, message: result.message, responseTimeMs, status });
  });

  // POST /api/ansible/clusters/:id/pod-status — admin, canli pod/node durumu (salt-okunur `oc get`)
  // bkz. server/ansible/playbooks/ocp_pod_status.yml — jump/bastion host uzerinden calisir.
  app.post("/api/ansible/clusters/:id/pod-status", requireAuth, requireAdmin, async (req, res) => {
    const cluster = getOcpClusters().find((c) => c.id === req.params.id);
    if (!cluster) return res.status(404).json({ ok: false, message: "Cluster bulunamadı." });
    if (!cluster.jumpHost) return res.status(400).json({ ok: false, message: "Bu cluster için jump/bastion host tanımlı değil." });

    if (!isConfigured()) return res.status(503).json({ ok: false, message: "AWX yapılandırılmamış." });
    const playbookRegistry = require("./playbook-registry.cjs");
    const registryRow = await playbookRegistry.getByKey("ocp_pod_status");
    const templateId = registryRow && playbookRegistry.getEffectiveTemplateId(registryRow);
    if (!templateId) return res.status(503).json({ ok: false, message: "OCP pod durumu için template ID tanımlı değil (Admin > Playbook Kayıtları veya AWX_OCP_POD_STATUS_TEMPLATE_ID)." });

    const { namespace, labelSelector } = req.body || {};
    try {
      const launch = await launchJob(Number(templateId), {
        jump_host: cluster.jumpHost,
        namespace: namespace || cluster.namespace || "",
        label_selector: labelSelector || "",
      }, cluster.jumpHost);

      let attempts = 0;
      let jobStatus;
      while (attempts < 30) {
        await new Promise((r) => setTimeout(r, 2000));
        jobStatus = await getJobStatus(launch.jobId);
        if (["successful", "failed", "error", "canceled"].includes(jobStatus.status)) break;
        attempts++;
      }
      if (!jobStatus || jobStatus.status !== "successful") {
        return res.status(502).json({ ok: false, message: `AWX job ${jobStatus?.status || "timeout"}`, jobId: launch.jobId });
      }
      const output = await getJobOutput(launch.jobId);
      res.json({ ok: true, output: output.output, jobId: launch.jobId });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // ── Playbook Kayitlari (AI'in sohbette cagirdigi salt-okunur tanilama araclari) ────
  // bkz. server/ansible/playbook-registry.cjs — DB'de tutulur, admin ekranindan yonetilir.

  // GET /api/ansible/playbooks — admin, tum kayitlar (template ID dahil)
  app.get("/api/ansible/playbooks", requireAuth, requireAdmin, async (req, res) => {
    try {
      const playbookRegistry = require("./playbook-registry.cjs");
      const rows = await playbookRegistry.listAll();
      const withSource = rows.map((r) => ({
        ...r,
        effectiveTemplateId: playbookRegistry.getEffectiveTemplateId(r),
      }));
      res.json({ ok: true, playbooks: withSource });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/ansible/playbooks/available — herkese acik (yalnizca giris), template ID SIZDIRILMAZ
  // LogX sayfasinin dinamik "Tanilama Araclari" listesi bunu kullanir.
  app.get("/api/ansible/playbooks/available", requireAuth, async (req, res) => {
    try {
      const playbookRegistry = require("./playbook-registry.cjs");
      const rows = await playbookRegistry.listEnabled();
      const available = rows
        .filter((r) => playbookRegistry.getEffectiveTemplateId(r) !== null)
        .map((r) => ({ keyName: r.keyName, displayName: r.displayName, description: r.description, category: r.category, handler: r.handler }));
      res.json({ ok: true, playbooks: available });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // POST /api/ansible/playbooks — admin, yeni kayit ekle (her zaman handler=host_target)
  app.post("/api/ansible/playbooks", requireAuth, requireAdmin, async (req, res) => {
    try {
      const playbookRegistry = require("./playbook-registry.cjs");
      const row = await playbookRegistry.create(req.body || {});
      res.json({ ok: true, playbook: row });
    } catch (err) {
      res.status(400).json({ ok: false, message: err.message });
    }
  });

  // PUT /api/ansible/playbooks/:id — admin, guncelle (key_name/handler degismez)
  app.put("/api/ansible/playbooks/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const playbookRegistry = require("./playbook-registry.cjs");
      const row = await playbookRegistry.update(req.params.id, req.body || {});
      if (!row) return res.status(404).json({ ok: false, message: "Kayıt bulunamadı." });
      res.json({ ok: true, playbook: row });
    } catch (err) {
      res.status(400).json({ ok: false, message: err.message });
    }
  });

  // DELETE /api/ansible/playbooks/:id — admin, kayit sil
  app.delete("/api/ansible/playbooks/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const playbookRegistry = require("./playbook-registry.cjs");
      const deleted = await playbookRegistry.remove(req.params.id);
      if (!deleted) return res.status(404).json({ ok: false, message: "Kayıt bulunamadı." });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/ansible/awx/templates — list AWX allowed templates (legacy/admin)
  app.get("/api/ansible/awx/templates", requireAuth, requireAdmin, async (req, res) => {
    if (!isConfigured()) {
      return res.json({ ok: false, message: "AWX yapılandırılmamış.", templates: [] });
    }
    try {
      const templates = await listTemplates();
      res.json({ ok: true, templates });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // F-07: GET /api/ansible/awx/templates/all — multi-server template summary (admin)
  app.get("/api/ansible/awx/templates/all", requireAuth, requireAdmin, async (req, res) => {
    const servers = getServers();
    const results = await Promise.allSettled(
      servers.map(async (server) => {
        const templates = await listTemplatesForServer(server);
        return { serverId: server.id, serverName: server.name, templates };
      })
    );
    const summary = results.map((r, i) => ({
      serverId:   servers[i].id,
      serverName: servers[i].name,
      ok:         r.status === "fulfilled",
      templates:  r.status === "fulfilled" ? r.value.templates : [],
      error:      r.status === "rejected"  ? r.reason?.message : undefined,
    }));
    const total = summary.reduce((acc, s) => acc + s.templates.length, 0);
    res.json({ ok: true, summary, total });
  });

  // POST /api/ansible/run — launch a job (admin only)
  app.post("/api/ansible/run", requireAuth, requireAdmin, async (req, res) => {
    if (!isConfigured()) {
      return res.status(503).json({ ok: false, message: "AWX yapılandırılmamış. NEEDS.md dosyasına bakın." });
    }

    const { templateId, extraVars = {}, limit = "" } = req.body || {};
    if (!templateId) {
      return res.status(400).json({ ok: false, message: "templateId gerekli." });
    }

    try {
      const result = await launchJob(templateId, extraVars, limit);
      console.log(`[Ansible] Job baslatildi: templateId=${templateId} jobId=${result.jobId} user=${req.session?.user?.username || "unknown"}`);
      res.json({ ok: true, ...result });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ ok: false, message: err.message });
    }
  });

  // GET /api/ansible/job/:id/status
  app.get("/api/ansible/job/:id/status", requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
      const status = await getJobStatus(id);
      res.json({ ok: true, ...status });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // GET /api/ansible/job/:id/output
  app.get("/api/ansible/job/:id/output", requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
      const { output, changedWarning } = await getJobOutput(id);
      res.json({ ok: true, output, changedWarning });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // ── Self-Service Ansible (kullanici erisimli) ─────────────────────────────

  // SS items + survey override'lari artik DB'de (ansible_ss_items /
  // ansible_ss_customizations). Eski server/data/ansible-ss-items.json ve
  // ansible-customizations/*.json dosyalari yalnizca tek seferlik goc kaynagidir.
  const SS_ITEMS_FILE = path.join(__dirname, "../data/ansible-ss-items.json");
  const CUSTOM_DIR    = path.join(__dirname, "../data/ansible-customizations");
  const dbx = require("../db/index.cjs");

  let _ssItems = null;   // null → DB henuz yuklenmedi (fallback: eski dosya)
  let _ssCustom = null;  // Map: `${serverId}_${templateId}` → override objesi

  function ssItemsFileFallback() {
    try { return JSON.parse(fs.readFileSync(SS_ITEMS_FILE, "utf-8")).items || []; }
    catch { return []; }
  }

  function readSsItems() {
    return _ssItems ? _ssItems.slice() : ssItemsFileFallback();
  }

  function ssRowToItem(r) {
    return {
      id: r.id, title: r.title, description: r.description || "",
      awxServerId: Number(r.awx_server_id), awxTemplateId: Number(r.awx_template_id),
      enabled: !!r.enabled, order: r.sort_order ?? 0,
    };
  }

  async function reloadSsItemsCache() {
    const { rows } = await dbx.query(`SELECT * FROM ansible_ss_items ORDER BY sort_order, id`);
    _ssItems = rows.map(ssRowToItem);
  }

  // Yazma: delete-all + re-insert (kucuk, admin-only liste) — sonra cache tazele.
  async function writeSsItems(items) {
    await dbx.query(`DELETE FROM ansible_ss_items`);
    for (const i of items) {
      await dbx.query(
        `INSERT INTO ansible_ss_items (id, title, description, awx_server_id, awx_template_id, enabled, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [i.id, i.title, i.description || "", Number(i.awxServerId) || 1,
         Number(i.awxTemplateId), i.enabled ? 1 : 0, Number(i.order) || 0]
      );
    }
    await reloadSsItemsCache();
  }

  // Overrides composite (serverId_templateId) anahtariyla saklanir — ayni template ID
  // numarasi birden fazla AWX sunucusunda farkli template'lere denk gelebilir.
  function customKey(serverId, templateId) {
    return `${serverId}_${templateId}`;
  }

  function customFileFallback(serverId, templateId) {
    try {
      const f = path.join(CUSTOM_DIR, `${customKey(serverId, templateId)}.json`);
      return JSON.parse(fs.readFileSync(f, "utf-8"));
    } catch {
      try {
        const legacy = path.join(CUSTOM_DIR, `${templateId}.json`);
        return JSON.parse(fs.readFileSync(legacy, "utf-8"));
      } catch { return {}; }
    }
  }

  function readCustom(serverId, templateId) {
    if (_ssCustom) return _ssCustom.get(customKey(serverId, templateId)) || {};
    return customFileFallback(serverId, templateId);
  }

  async function reloadSsCustomCache() {
    const { rows } = await dbx.query(`SELECT * FROM ansible_ss_customizations`);
    _ssCustom = new Map();
    for (const r of rows) {
      try { _ssCustom.set(customKey(r.awx_server_id, r.template_id), JSON.parse(r.data)); }
      catch { /* bozuk satiri atla */ }
    }
  }

  async function writeCustom(serverId, templateId, data) {
    const json = JSON.stringify(data);
    const upd = await dbx.query(
      `UPDATE ansible_ss_customizations SET data = $1, updated_at = GETUTCDATE()
       WHERE awx_server_id = $2 AND template_id = $3`,
      [json, Number(serverId), Number(templateId)]
    );
    if (!upd.rowCount) {
      await dbx.query(
        `INSERT INTO ansible_ss_customizations (awx_server_id, template_id, data) VALUES ($1, $2, $3)`,
        [Number(serverId), Number(templateId), json]
      );
    }
    if (_ssCustom) _ssCustom.set(customKey(serverId, templateId), data);
  }

  // Tek seferlik goc: tablolar bossa eski JSON dosyalarindan icaktar.
  async function importSsLegacyIfEmpty() {
    const itemsCount = await dbx.query(`SELECT COUNT(*) AS n FROM ansible_ss_items`);
    if (Number(itemsCount.rows[0]?.n || 0) === 0) {
      const legacy = ssItemsFileFallback();
      if (legacy.length) {
        try { await writeSsItems(legacy); console.log(`[DB] migrated ansible-ss-items (${legacy.length} satir)`); }
        catch (e) { console.warn("[Ansible] SS items import hata:", e.message); }
      }
    }
    const customCount = await dbx.query(`SELECT COUNT(*) AS n FROM ansible_ss_customizations`);
    if (Number(customCount.rows[0]?.n || 0) === 0 && fs.existsSync(CUSTOM_DIR)) {
      let migrated = 0;
      for (const f of fs.readdirSync(CUSTOM_DIR)) {
        if (!f.endsWith(".json")) continue;
        const base = f.slice(0, -5);
        // `srv_tpl.json` veya eski tek-anahtarli `tpl.json` (srv=1 varsayilir)
        const m = base.match(/^(\d+)_(\d+)$/);
        const serverId = m ? Number(m[1]) : 1;
        const templateId = m ? Number(m[2]) : Number(base);
        if (!Number.isFinite(templateId) || templateId <= 0) continue;
        try {
          const data = JSON.parse(fs.readFileSync(path.join(CUSTOM_DIR, f), "utf-8"));
          await writeCustom(serverId, templateId, data);
          migrated++;
        } catch { /* bozuk dosyayi atla */ }
      }
      if (migrated) console.log(`[DB] migrated ansible-customizations (${migrated} satir)`);
    }
  }

  async function loadSsStores() {
    try {
      await importSsLegacyIfEmpty();
      await reloadSsItemsCache();
      await reloadSsCustomCache();
      console.log(`[Ansible] SS store DB'den yuklendi (${_ssItems.length} item, ${_ssCustom.size} override).`);
    } catch (e) {
      console.warn("[Ansible] SS store DB yuklenemedi, dosya fallback aktif:", e.message);
    }
  }
  loadSsStores().catch((e) => console.warn("[Ansible] SS store yukleme hata:", e.message));
  loadAwxServers().catch((e) => console.warn("[Ansible] AWX sunucu yukleme hata:", e.message));
  loadOcpStore().catch((e) => console.warn("[Ansible] OCP store yukleme hata:", e.message));

  // AWX survey_spec alanlarini admin override'lariyla birlestirip tutarli bir sekle sokar
  // (survey route VE template-detail route arasindaki eski kod tekrarinin yerini alir).
  // ONEMLI: `required` AWX'in kendi degerinden gelir, override EDILEMEZ — bir admin'in
  // gercekten zorunlu bir alani "zorunlu degil" olarak isaretleyip kullanicinin o alani
  // atlamasina (ve launch'in AWX tarafinda reddedilmesine ya da eksik veriyle calismasina)
  // izin vermemek icin. FAKAT zorunlu bir alan GIZLENEBILIR — yeter ki gecerli (bos
  // olmayan) bir varsayilan degeri olsun (bu kural POST /api/ansible/ss/custom/... icinde
  // uygulanir); bu, hassas/credential niteligindeki zorunlu alanlarin admin tarafindan
  // bilinen bir degerle kullanicidan saklanabilmesini saglar.
  function mapSurveySpec(rawFields, overrides, { includeHidden = false } = {}) {
    const mapped = (rawFields || []).map((field) => {
      const ov = (overrides.fieldOverrides || []).find((o) => o.fieldName === field.variable) || {};
      const required = !!field.required;
      return {
        name:         field.variable,
        label:        ov.label        || field.question_name,
        type:         field.type,
        required,
        defaultValue: ov.defaultValue !== undefined ? ov.defaultValue : (field.default || ""),
        choices:      field.choices   || [],
        hidden:       !!ov.hidden,
        description:  field.question_description || "",
        min:          field.min,
        max:          field.max,
      };
    });
    return includeHidden ? mapped : mapped.filter((f) => !f.hidden);
  }

  // Bir AWX job_template detay nesnesinden (ham, /api/v2/job_templates/:id/ yaniti) kullaniciya
  // sunulabilecek built-in "prompt on launch" seceneklerini cikarir. Credential/Inventory
  // BILINCLI OLARAK burada yok — kullanici hicbir zaman hangi credential/inventory'nin
  // kullanilacagini secemez (guvenlik siniri, bkz. plan).
  function extractLaunchOptions(detail) {
    return {
      limit:     { enabled: !!detail.ask_limit_on_launch,     current: detail.limit || "" },
      forks:     { enabled: !!detail.ask_forks_on_launch,     current: detail.forks ?? 0 },
      jobTags:   { enabled: !!detail.ask_tags_on_launch,      current: detail.job_tags || "" },
      skipTags:  { enabled: !!detail.ask_skip_tags_on_launch, current: detail.skip_tags || "" },
      verbosity: { enabled: !!detail.ask_verbosity_on_launch, current: detail.verbosity ?? 0 },
      jobType:   { enabled: !!detail.ask_job_type_on_launch,  current: detail.job_type || "run" },
    };
  }

  // Sunucu tarafinda survey'e karsi YENIDEN dogrular (client gonderdigi extraVars'a
  // guvenilmez) ve gizli alanlarin varsayilan degerlerini ACIKCA extra_vars'a ekler —
  // hicbir alan sessizce atlanmaz. Dogrulama basarisiz olursa {status, field} tasiyan
  // bir Error firlatir.
  function resolveLaunchExtraVars(rawFields, overrides, submittedValues) {
    const extraVars = {};
    for (const field of (rawFields || [])) {
      const ov = (overrides.fieldOverrides || []).find((o) => o.fieldName === field.variable) || {};
      const required = !!field.required;
      const isHidden = !!ov.hidden;
      const label = field.question_name || field.variable;

      if (isHidden) {
        const def = ov.defaultValue !== undefined ? ov.defaultValue : (field.default || "");
        if (def === "") {
          // Kayit zamaninda (POST /ss/custom) zaten engellenmis olmasi gerekir — buraya
          // duserse bir yapilandirma tutarsizligidir, sessizce eksik veriyle devam ETME.
          throw Object.assign(new Error(`Gizli alanın varsayılan değeri yok, launch güvenli değil: ${label}`), { status: 500, field: field.variable });
        }
        extraVars[field.variable] = def;
        continue;
      }

      const raw = submittedValues ? submittedValues[field.variable] : undefined;
      const val = raw === undefined || raw === null ? "" : String(raw).trim();

      if (required && val === "") {
        throw Object.assign(new Error(`Zorunlu alan boş: ${label}`), { status: 400, field: field.variable });
      }
      if (val === "") continue; // opsiyonel + bos → AWX'in kendi survey default'una birakilir

      if (Array.isArray(field.choices) && field.choices.length > 0 && !field.choices.includes(val)) {
        throw Object.assign(new Error(`Geçersiz seçim (${label}): ${val}`), { status: 400, field: field.variable });
      }
      if (field.type === "integer" || field.type === "float") {
        const num = Number(val);
        if (isNaN(num)) throw Object.assign(new Error(`Sayısal olmayan değer: ${label}`), { status: 400, field: field.variable });
        if (field.min !== undefined && field.min !== null && num < field.min) {
          throw Object.assign(new Error(`${label} minimum ${field.min} olmalı.`), { status: 400, field: field.variable });
        }
        if (field.max !== undefined && field.max !== null && num > field.max) {
          throw Object.assign(new Error(`${label} maksimum ${field.max} olmalı.`), { status: 400, field: field.variable });
        }
      }
      extraVars[field.variable] = val;
    }
    return extraVars;
  }

  // resolveLaunchExtraVars'in "Survey Tasarimcisi" (customSurveyFields) surumu — AYNI
  // kurallar (zorunlu/tip/min-max/choices dogrulamasi, gizli alan icin sunucu-tarafi
  // varsayilan enjeksiyonu), ama AWX'in kendi survey_spec sekli yerine SurveyField
  // seklini (name/label/defaultValue/hidden dogrudan alanin UZERINDE, ayri bir
  // overrides katmani YOK — admin bu degerleri zaten Survey Tasarimcisi'nda dogrudan
  // ayarliyor) okur.
  function resolveCustomSurveyExtraVars(customFields, submittedValues) {
    const fields = customFields || [];

    // 1. gecis: dependsOn kosullarini degerlendirebilmek icin TUM alanlarin "etkin
    // deger"ini onceden hesapla (gizliyse admin varsayilani, degilse kullanicinin
    // gonderdigi HAM deger — henuz zorunlu/tip dogrulamasi YAPILMADI, sadece kosul
    // kontrolu icin kullanilacak).
    const effective = {};
    for (const field of fields) {
      if (field.hidden) {
        effective[field.name] = field.defaultValue || "";
      } else {
        const raw = submittedValues ? submittedValues[field.name] : undefined;
        effective[field.name] = raw === undefined || raw === null ? "" : String(raw).trim();
      }
    }

    function isActive(field) {
      const dep = field.dependsOn;
      if (!dep || !Array.isArray(dep.conditions) || dep.conditions.length === 0) return true;
      const results = dep.conditions.map((c) => (effective[c.field] ?? "") === (c.equals ?? ""));
      // mode="any" → VEYA (herhangi biri yeterli), aksi halde (varsayilan "all") VE (hepsi sart).
      return dep.mode === "any" ? results.some(Boolean) : results.every(Boolean);
    }

    const extraVars = {};
    for (const field of fields) {
      // Kosul saglanmiyorsa bu alan kullaniciya HIC sorulmadi — dogrulanmaz, extra_vars'a
      // eklenmez (istemci tarafiyla AYNI davranis, bkz. SurveyModal visibleFields).
      if (!isActive(field)) continue;

      const label = field.label || field.name;

      if (field.hidden) {
        const def = field.defaultValue || "";
        if (def === "") {
          throw Object.assign(new Error(`Gizli alanın varsayılan değeri yok, launch güvenli değil: ${label}`), { status: 500, field: field.name });
        }
        extraVars[field.name] = def;
        continue;
      }

      const val = effective[field.name];

      if (field.required && val === "") {
        throw Object.assign(new Error(`Zorunlu alan boş: ${label}`), { status: 400, field: field.name });
      }
      if (val === "") {
        if (field.defaultValue) extraVars[field.name] = field.defaultValue;
        continue;
      }

      if (Array.isArray(field.choices) && field.choices.length > 0 && !field.choices.includes(val)) {
        throw Object.assign(new Error(`Geçersiz seçim (${label}): ${val}`), { status: 400, field: field.name });
      }
      if (field.type === "integer" || field.type === "float") {
        const num = Number(val);
        if (isNaN(num)) throw Object.assign(new Error(`Sayısal olmayan değer: ${label}`), { status: 400, field: field.name });
        if (field.min !== undefined && field.min !== null && num < field.min) {
          throw Object.assign(new Error(`${label} minimum ${field.min} olmalı.`), { status: 400, field: field.name });
        }
        if (field.max !== undefined && field.max !== null && num > field.max) {
          throw Object.assign(new Error(`${label} maksimum ${field.max} olmalı.`), { status: 400, field: field.name });
        }
      }
      extraVars[field.name] = val;
    }
    return extraVars;
  }

  // Admin'in add-time'da (FieldOverridesModal) built-in launch secenekleri (limit/forks/
  // job_tags/skip_tags/verbosity/job_type) icin tanimladigi varsayilan+gizleme kuralini
  // uygular — survey field'larin "hidden" kuraliyla BIREBIR ayni mantik: admin bir
  // secenegi "kullaniciya gosterme" isaretlediyse, kullanicinin gonderdigi deger YOK
  // SAYILIR, admin'in ayarladigi sabit deger kullanilir (defense-in-depth, client'a guvenilmez).
  function resolveLaunchOptions(overrides, submitted) {
    const lo = overrides.launchOptionOverrides || {};
    function pick(key, submittedVal) {
      const ov = lo[key];
      if (ov && ov.hidden) return ov.default ?? "";
      return submittedVal;
    }
    return {
      limit: pick("limit", submitted.limit || ""),
      forks: pick("forks", submitted.forks),
      jobTags: pick("jobTags", submitted.jobTags),
      skipTags: pick("skipTags", submitted.skipTags),
      verbosity: pick("verbosity", submitted.verbosity),
      jobType: pick("jobType", submitted.jobType),
    };
  }

  // launchOptions bayraklarina gore yalnizca AWX'in gercekten "prompt on launch" olarak
  // isaretledigi VE bir deger saglanmis built-in alanlari AWX launch payload'ina ekler —
  // launchJob() ve /launch-ss/... icindeki tekrarlayan inline mantigin yerini alir.
  function buildAwxLaunchPayload(detail, { extraVars, limit, forks, jobTags, skipTags, verbosity, jobType } = {}) {
    const payload = {};
    if (extraVars && Object.keys(extraVars).length > 0) payload.extra_vars = JSON.stringify(extraVars);
    if (detail?.ask_limit_on_launch && limit) payload.limit = limit;
    if (detail?.ask_forks_on_launch && forks !== undefined && forks !== "" && forks !== null) {
      const n = Number(forks);
      if (!isNaN(n) && n >= 0) payload.forks = n;
    }
    if (detail?.ask_tags_on_launch && jobTags) payload.job_tags = jobTags;
    if (detail?.ask_skip_tags_on_launch && skipTags) payload.skip_tags = skipTags;
    if (detail?.ask_verbosity_on_launch && verbosity !== undefined && verbosity !== "" && verbosity !== null) {
      const n = Number(verbosity);
      if (!isNaN(n) && n >= 0 && n <= 5) payload.verbosity = n;
    }
    if (detail?.ask_job_type_on_launch && jobType) payload.job_type = jobType;
    return payload;
  }

  // AWX'in ham hata govdesinden (varsa) anlasilir bir mesaj + dogru HTTP status cikarir —
  // her zaman 502 donmek yerine (or. eksik zorunlu degisken → 400).
  function friendlyAwxError(err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    const body = err.body;
    if (body && typeof body === "object") {
      if (Array.isArray(body.variables_needed_to_start) && body.variables_needed_to_start.length > 0) {
        return { status: 400, message: `Eksik zorunlu alan(lar): ${body.variables_needed_to_start.join(", ")}` };
      }
      if (body.extra_vars) {
        const msg = Array.isArray(body.extra_vars) ? body.extra_vars.join(" ") : String(body.extra_vars);
        return { status: 400, message: `Parametre hatası: ${msg}` };
      }
      if (body.detail) return { status, message: String(body.detail) };
    }
    return { status, message: err.message || "AWX isteği başarısız." };
  }

  // Launch gecmisine yazilacak/API yanitinda donulecek extraVars kopyasini redakte eder —
  // gizli (override hidden:true) VEYA AWX tarafinda type==="password" olan her alanin degeri
  // "***gizli***" ile degistirilir. `specFields`/`overrides` yoksa (survey yok/devre disi)
  // hicbir alan bu kritere uymadigindan extraVars oldugu gibi doner.
  function redactExtraVarsForHistory(extraVars, specFields, overrides) {
    if (!extraVars || Object.keys(extraVars).length === 0) return extraVars;
    const redacted = {};
    for (const [key, value] of Object.entries(extraVars)) {
      const field = (specFields || []).find((f) => f.variable === key);
      const ov = (overrides?.fieldOverrides || []).find((o) => o.fieldName === key);
      // Survey Tasarimcisi (customSurveyFields) alanlari AYRI bir dizide yasar (AWX
      // specFields'ta degil) — password-tipi veya gizli olarak isaretlenmis bir custom
      // alan da AYNI sekilde redakte edilmeli, aksi halde gecmis kaydinda acikta kalirdi.
      const customField = (overrides?.customSurveyFields || []).find((f) => f.name === key);
      const isSensitive = !!ov?.hidden || field?.type === "password" || !!customField?.hidden || customField?.type === "password";
      redacted[key] = isSensitive ? "***gizli***" : value;
    }
    return redacted;
  }

  // AWX'e GERCEKTEN job baslatan tek yer — hem POST /launch-ss'in dogrudan (Smart onayi
  // gerekmeyen) yolundan, hem de server/smart/poller.cjs'in "talep onaylandi" callback'inden
  // cagirilir. `req` poller'dan cagrildiginda null'dur (canli bir HTTP istegi yok) —
  // auditPortal ve username bunu tolere eder (bkz. server/audit/index.cjs).
  async function performSsLaunch(server, templateId, { detail, extraVars, resolvedLaunchOptions, specFields, overrides, username, templateName, req }) {
    const token = await getTokenForServer(server);
    const payload = buildAwxLaunchPayload(detail, { extraVars, ...resolvedLaunchOptions });
    const data = await awxRequestToServer(server, token, "POST", `/api/v2/job_templates/${templateId}/launch/`, payload);
    const jobId = data.id;

    const paramsForHistory = redactExtraVarsForHistory(extraVars, specFields, overrides);
    const db = require("../db/index.cjs");
    await db.query(
      `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [username, server.id, templateId, templateName || String(templateId), jobId, data.status || "pending", JSON.stringify(paramsForHistory)]
    ).catch((e) => console.warn("[AnsibleSS] Geçmiş kaydedilemedi:", e.message));

    require("../audit/index.cjs").auditPortal(req || null, "selfservice_ansible_launch", {
      username,
      detail: JSON.stringify({
        awxServerId: server.id,
        templateId,
        templateName: templateName || String(templateId),
        jobId,
        status: data.status || "pending",
        inventory: detail?.summary_fields?.inventory?.name || null,
        project: detail?.summary_fields?.project?.name || null,
        credentials: (detail?.summary_fields?.credentials || []).map((c) => c.name),
        extraVars: paramsForHistory,
      }),
    });

    return { jobId, status: data.status || "pending" };
  }

  // Smart poller'i BIR KEZ baslat — onay bekleyen bir talep onaylandiginda cagrilacak
  // callback, o talebin acilis anindaki TAM launch baglamini (pendingLaunch) kullanir.
  // isConfigured() false ise (SMART_API_URL vb. henuz girilmemis) poller yine de kurulur
  // ama her tick'te sessizce hicbir sey yapmaz (bkz. poller.cjs basi).
  try {
    require("../smart/poller.cjs").startPoller(async (ticket) => {
      const server = getServerById(ticket.awxServerId);
      if (!server) throw new Error(`AWX sunucusu bulunamadı: ${ticket.awxServerId}`);
      const { detail, extraVars, resolvedLaunchOptions, specFields, overrides, username, templateName } = ticket.pendingLaunch;
      return performSsLaunch(server, ticket.awxTemplateId, { detail, extraVars, resolvedLaunchOptions, specFields, overrides, username, templateName, req: null });
    });
  } catch (e) {
    console.warn("[Smart] poller başlatılamadı:", e.message);
  }

  // GET /api/ansible/ss/items — Self-Service Ansible item listesi
  app.get("/api/ansible/ss/items", requireAuth, (req, res) => {
    res.json({ ok: true, items: readSsItems() });
  });

  // POST /api/ansible/ss/items — Admin, SS item ekle/guncelle
  // Saglamlastirma: bos title, NaN/gecersiz template ID, AWX'te var olmayan template,
  // allowlist disi ID ve (server,template) cifti dedupe kontrolu — hepsi kayittan ONCE
  // reddedilir (onceden bunlarin hicbiri kontrol edilmiyordu, bkz. plan).
  app.post("/api/ansible/ss/items", requireAuth, requireAdmin, async (req, res) => {
    // Varsayilan KAPALI: yeni bir Self Service otomasyonu admin bilinclii sekilde
    // acmadan hicbir kullaniciya gorunmesin (istek govdesi enabled belirtmezse).
    const { id, title, description, awxServerId, awxTemplateId, enabled = false, order = 0 } = req.body || {};

    const trimmedTitle = String(title || "").trim();
    if (!trimmedTitle) {
      return res.status(400).json({ ok: false, message: "Başlık (title) zorunlu." });
    }

    const serverId = Number(awxServerId) || 1;
    const templateId = Number(awxTemplateId);
    if (isNaN(templateId) || templateId <= 0) {
      return res.status(400).json({ ok: false, message: "Geçersiz template ID." });
    }

    const server = getServerById(serverId);
    if (!server) {
      return res.status(400).json({ ok: false, message: `Sunucu bulunamadı: AWX ${serverId}.` });
    }

    const { allowedIds } = getConfig();
    if (allowedIds.length > 0 && !allowedIds.includes(templateId)) {
      return res.status(400).json({ ok: false, message: "Bu template ID, AWX_READ_ONLY_TEMPLATE_IDS izin listesinde değil." });
    }

    const items = readSsItems();
    const dup = items.find((i) => i.id !== id && Number(i.awxServerId) === serverId && Number(i.awxTemplateId) === templateId);
    if (dup) {
      return res.status(400).json({ ok: false, message: `Bu template zaten kayıtlı: "${dup.title}".` });
    }

    try {
      const token = await getTokenForServer(server);
      await awxRequestToServer(server, token, "GET", `/api/v2/job_templates/${templateId}/`);
    } catch (err) {
      if (err.status === 404) {
        return res.status(400).json({ ok: false, message: `Template AWX'te bulunamadı: #${templateId} (${server.name}).` });
      }
      const friendly = friendlyAwxError(err);
      return res.status(friendly.status).json({ ok: false, message: `AWX doğrulaması başarısız: ${friendly.message}` });
    }

    const trimmedDescription = String(description || "").trim();

    if (id) {
      const idx = items.findIndex((i) => i.id === id);
      if (idx >= 0) {
        items[idx] = { ...items[idx], title: trimmedTitle, description: trimmedDescription, awxServerId: serverId, awxTemplateId: templateId, enabled: !!enabled, order: Number(order) || 0 };
        try { await writeSsItems(items); } catch (e) {
          return res.status(500).json({ ok: false, message: `Kaydedilemedi: ${e.message}` });
        }
        return res.json({ ok: true, item: items[idx], items });
      }
    }
    const newItem = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, title: trimmedTitle, description: trimmedDescription, awxServerId: serverId, awxTemplateId: templateId, enabled: !!enabled, order: Number(order) || 0 };
    items.push(newItem);
    try { await writeSsItems(items); } catch (e) {
      return res.status(500).json({ ok: false, message: `Kaydedilemedi: ${e.message}` });
    }
    res.json({ ok: true, item: newItem, items });
  });

  // DELETE /api/ansible/ss/items/:id — Admin, SS item sil
  app.delete("/api/ansible/ss/items/:id", requireAuth, requireAdmin, async (req, res) => {
    const items = readSsItems().filter((i) => i.id !== req.params.id);
    try { await writeSsItems(items); } catch (e) {
      return res.status(500).json({ ok: false, message: `Silinemedi: ${e.message}` });
    }
    res.json({ ok: true, items });
  });

  // GET /api/ansible/survey/:serverId/:templateId — AWX survey_spec + admin ozellestirmeleri
  // Fallback: template'te AWX Survey tanimli degilse (survey_spec bos/404), extra_vars
  // default'larini parse ederek ayni alanlari goster — "Ansible'dan calistir" akisi
  // (LaunchModal, extra_vars'i zaten boyle gosteriyor) ile self-service arasindaki
  // tutarsizligi giderir.
  app.get("/api/ansible/survey/:serverId/:templateId", requireAuth, async (req, res) => {
    const server = getServerById(req.params.serverId);
    if (!server) return res.status(404).json({ ok: false, message: "Sunucu bulunamadı." });
    try {
      const token = await getTokenForServer(server);
      const overrides = readCustom(server.id, req.params.templateId);
      // ?admin=1 yalnizca GERCEKTEN Admin olan oturumlarda onurlandirilir — client'in
      // kendi bildirdigi bir bayraga guvenilmez, rol sunucu tarafinda (session) kontrol edilir.
      const isAdmin = req.session?.user?.role === "Admin";
      const wantsAdminView = isAdmin && req.query.admin === "1";

      const detail = await awxRequestToServer(server, token, "GET", `/api/v2/job_templates/${req.params.templateId}/`);
      const launchOptions = extractLaunchOptions(detail);
      // AWX'in "Prompt on Launch → Variables" bayragi — FieldOverridesModal'in serbest
      // "Ek Degiskenler" kutusunu bilgilendirmek icin (bkz. plan: free-form extra_vars gap).
      const askVariables = !!detail.ask_variables_on_launch;

      // Survey AWX'te devre disiysa (survey_enabled === false): admin bu template icin
      // portal uzerinden KENDI survey'ini tasarladiysa (bkz. FieldOverridesModal "Survey
      // Tasarimcisi") o alanlar gosterilir; tasarlanmamissa eskisi gibi hicbir alan
      // gosterilmez/istenmez (AWX'in kendi extra_vars fallback'ine de dusulmez).
      if (detail.survey_enabled === false) {
        const customFields = Array.isArray(overrides.customSurveyFields) ? overrides.customSurveyFields : [];
        const visibleCustomFields = wantsAdminView ? customFields : customFields.filter((f) => !f.hidden);
        return res.json({ ok: true, fields: visibleCustomFields, surveyEnabled: false, launchOptions, askVariables, templateId: req.params.templateId });
      }

      let fields = [];
      let specHadFields = false;
      try {
        const spec = await awxRequestToServer(server, token, "GET", `/api/v2/job_templates/${req.params.templateId}/survey_spec/`);
        specHadFields = Array.isArray(spec.spec) && spec.spec.length > 0;
        fields = mapSurveySpec(spec.spec, overrides, { includeHidden: wantsAdminView });
      } catch (surveyErr) {
        // survey_spec olmayan template'ler icin AWX 404 doner — extra_vars fallback'e gec
        if (surveyErr.status !== 404) throw surveyErr;
      }

      // Yalnizca GERCEKTEN bir survey tanimli degilse (404 veya bos spec) fallback'e
      // dusulur — admin bir survey'in TUM alanlarini gizlemis olmasi (specHadFields=true
      // ama filtrelenmis fields.length=0) fallback'i TETIKLEMEMELI, aksi halde kullanici
      // gizlenmis gercek survey alanlari yerine yanlislikla ham extra_vars pseudo-alanlarini
      // duzenleyebilir hale gelirdi.
      if (!specHadFields) {
        const defaults = parseSimpleYaml(detail.extra_vars || "");
        fields = Object.keys(defaults).map((name) => {
          const ov = (overrides.fieldOverrides || []).find((o) => o.fieldName === name) || {};
          return {
            name,
            label:        ov.label        || name,
            type:         "text",
            required:     ov.required     !== undefined ? ov.required : false,
            defaultValue: ov.defaultValue !== undefined ? ov.defaultValue : defaults[name],
            choices:      [],
            hidden:       ov.hidden       || false,
            description:  "",
          };
        }).filter((f) => wantsAdminView || !f.hidden);
      }

      res.json({ ok: true, fields, surveyEnabled: true, launchOptions, askVariables, templateId: req.params.templateId });
    } catch (err) {
      const { status, message } = friendlyAwxError(err);
      res.status(status).json({ ok: false, message });
    }
  });

  // GET /api/ansible/template-detail/:serverId/:templateId — Template tam detayi
  // (bilgi modali icin: genel ayarlar + survey + extra_vars + credentials + son calistirmalar)
  app.get("/api/ansible/template-detail/:serverId/:templateId", requireAuth, async (req, res) => {
    const server = getServerById(req.params.serverId);
    if (!server) return res.status(404).json({ ok: false, message: "Sunucu bulunamadı." });
    try {
      const token = await getTokenForServer(server);
      const [detail, surveySpec] = await Promise.all([
        awxRequestToServer(server, token, "GET", `/api/v2/job_templates/${req.params.templateId}/`),
        awxRequestToServer(server, token, "GET", `/api/v2/job_templates/${req.params.templateId}/survey_spec/`)
          .catch((e) => (e.status === 404 ? { spec: [] } : Promise.reject(e))),
      ]);

      // Ayni override/required/hidden mantigini survey route'uyla paylasmak icin
      // mapSurveySpec kullanilir, ama bu route'un mevcut frontend tuketicisi (`AwxTemplateDetail`)
      // `default` alan adini bekledigi icin geriye donuk uyumlu sekilde yeniden sekillendirilir.
      const isAdmin = req.session?.user?.role === "Admin";
      const mappedFields = mapSurveySpec(surveySpec.spec, readCustom(server.id, req.params.templateId), { includeHidden: isAdmin });
      const surveyFields = mappedFields.map((f) => ({
        name: f.name, label: f.label, type: f.type, required: f.required,
        default: f.defaultValue, choices: f.choices, description: f.description,
      }));

      res.json({
        ok: true,
        template: {
          id:            detail.id,
          name:          detail.name,
          description:   detail.description || "",
          jobType:       detail.job_type || "",
          playbook:      detail.playbook || "",
          inventory:     detail.summary_fields?.inventory?.name || "",
          project:       detail.summary_fields?.project?.name || "",
          credentials:   (detail.summary_fields?.credentials || []).map((c) => ({ name: c.name, kind: c.kind || c.credential_type_name || "" })),
          extraVars:     detail.extra_vars || "",
          extraVarsParsed: parseSimpleYaml(detail.extra_vars || ""),
          limit:         detail.limit || "",
          verbosity:     detail.verbosity ?? 0,
          askVariables:  !!detail.ask_variables_on_launch,
          askLimit:      !!detail.ask_limit_on_launch,
          askInventory:  !!detail.ask_inventory_on_launch,
          surveyEnabled: detail.survey_enabled !== false,
          launchOptions: extractLaunchOptions(detail),
          created:       detail.created || null,
          modified:      detail.modified || null,
          recentJobs:    (detail.summary_fields?.recent_jobs || []).map((j) => ({
            id: j.id, status: j.status, finished: j.finished || null,
          })),
          surveyFields,
        },
      });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // POST /api/ansible/ss/custom/:serverId/:templateId — Admin, field override kaydet
  // Kayittan once CANLI AWX survey spec'ine karsi dogrular: zorunlu bir alan asla
  // gizlenemez; gizlenen bir alanin cozumlenebilir (override veya AWX default'u) bos
  // olmayan bir varsayilan degeri olmalidir — aksi halde launch her seferinde sessizce
  // eksik/bos bir degiskenle calisirdi.
  app.post("/api/ansible/ss/custom/:serverId/:templateId", requireAuth, requireAdmin, async (req, res) => {
    const server = getServerById(req.params.serverId);
    if (!server) return res.status(404).json({ ok: false, message: "Sunucu bulunamadı." });
    const data = req.body || {};
    const overrides = Array.isArray(data.fieldOverrides) ? data.fieldOverrides : [];

    try {
      const token = await getTokenForServer(server);
      let specFields = [];
      try {
        const spec = await awxRequestToServer(server, token, "GET", `/api/v2/job_templates/${req.params.templateId}/survey_spec/`);
        specFields = spec.spec || [];
      } catch (specErr) {
        if (specErr.status !== 404) throw specErr;
      }

      // Kural: HANGI ALAN OLURSA OLSUN (zorunlu dahil) gizlenebilir — YETER KI cozumlenen
      // varsayilan deger bos olmasin. Bu, hassas/credential niteligindeki zorunlu alanlarin
      // admin tarafindan bilinen bir degerle kullanicidan saklanabilmesini saglar; zorunlu
      // olmayi hâlâ "gizlemeyi engelleyen" bir kural olarak KULLANMIYORUZ.
      for (const ov of overrides) {
        if (!ov.hidden) continue;
        const field = specFields.find((f) => f.variable === ov.fieldName);
        if (!field) continue; // survey'de olmayan (extra_vars fallback) pseudo-alan — serbest
        const resolvedDefault = ov.defaultValue !== undefined ? ov.defaultValue : (field.default || "");
        if (!resolvedDefault) {
          return res.status(400).json({ ok: false, message: `"${field.question_name || field.variable}" alanının varsayılan değeri yok — gizlemeden önce bir varsayılan değer belirleyin.` });
        }
      }

      // Ayni kural built-in launch secenekleri (limit/forks/job_tags/skip_tags/verbosity/
      // job_type) icin de gecerli: "kullaniciya gosterme" isaretlenmis bir secenegin
      // bos olmayan bir varsayilan degeri olmali — aksi halde launch sessizce bos gecerdi.
      const LAUNCH_OPTION_LABELS = { limit: "Limit", forks: "Forks", jobTags: "Job Tags", skipTags: "Skip Tags", verbosity: "Verbosity", jobType: "Job Type" };
      for (const [key, ov] of Object.entries(data.launchOptionOverrides || {})) {
        if (!ov?.hidden) continue;
        if (ov.default === undefined || ov.default === null || String(ov.default).trim() === "") {
          return res.status(400).json({ ok: false, message: `"${LAUNCH_OPTION_LABELS[key] || key}" gizli ama varsayılan değeri yok — gizlemeden önce bir varsayılan değer belirleyin.` });
        }
      }

      // Cikti filtresi: enabled=true ise "contains" bos birakilamaz — aksi halde admin
      // "filtrele" isaretledigini saniyor ama fiilen HICBIR satir kalmiyor (bos needle
      // her satirla eslesir degil, split/filter ile ANLAMSIZ bir goruntu uretir).
      const outputFilter = data.outputFilter;
      if (outputFilter?.enabled && !String(outputFilter.contains || "").trim()) {
        return res.status(400).json({ ok: false, message: "Çıktı filtresi etkin ama aranacak metin boş — bir metin girin veya filtreyi kapatın." });
      }

      // Survey Tasarimcisi (customSurveyFields): AWX survey KAPALIYKEN admin'in portaldan
      // baştan tanımladığı sahte survey alanları — client'e güvenilmez, kayıttan önce
      // burada da doğrulanır (isim benzersiz + güvenli değişken-adı deseni, gizli alanın
      // varsayılan değeri olması, çoktan-seçmeli alanların en az bir seçeneği olması).
      const customSurveyFields = Array.isArray(data.customSurveyFields) ? data.customSurveyFields : [];
      const seenNames = new Set();
      for (const f of customSurveyFields) {
        const name = String(f?.name || "").trim();
        if (!name) return res.status(400).json({ ok: false, message: "Her özel alanın bir değişken adı olmalı." });
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          return res.status(400).json({ ok: false, message: `Geçersiz değişken adı: "${name}" — yalnızca harf, rakam, alt çizgi içerebilir ve rakamla başlayamaz.` });
        }
        if (seenNames.has(name)) {
          return res.status(400).json({ ok: false, message: `Değişken adı tekrar ediyor: "${name}"` });
        }
        seenNames.add(name);
        if (!String(f?.label || "").trim()) {
          return res.status(400).json({ ok: false, message: `"${name}" alanının bir görünen adı (label) olmalı.` });
        }
        if (f?.hidden && !String(f?.defaultValue || "").trim()) {
          return res.status(400).json({ ok: false, message: `"${f.label}" gizli ama varsayılan değeri yok — gizlemeden önce bir varsayılan değer belirleyin.` });
        }
        if ((f?.type === "multiplechoice" || f?.type === "multiselect") && (!Array.isArray(f.choices) || f.choices.filter((c) => String(c || "").trim()).length === 0)) {
          return res.status(400).json({ ok: false, message: `"${f.label}" bir seçim alanı ama hiç seçeneği yok.` });
        }
        if (f?.dependsOn) {
          const conditions = Array.isArray(f.dependsOn.conditions) ? f.dependsOn.conditions : [];
          if (conditions.length === 0) {
            return res.status(400).json({ ok: false, message: `"${f.label}" koşullu işaretli ama hiç koşulu yok.` });
          }
          for (const c of conditions) {
            const condField = String(c?.field || "").trim();
            if (!condField) {
              return res.status(400).json({ ok: false, message: `"${f.label}" için bir koşul alanı seçilmemiş.` });
            }
            if (condField === name) {
              return res.status(400).json({ ok: false, message: `"${f.label}" kendi kendine bağlı olamaz.` });
            }
            if (!customSurveyFields.some((other) => String(other?.name || "").trim() === condField)) {
              return res.status(400).json({ ok: false, message: `"${f.label}" tanımsız bir alana bağlı: "${condField}"` });
            }
          }
        }
      }

      await writeCustom(server.id, req.params.templateId, data);
      res.json({ ok: true });
    } catch (err) {
      const { status, message } = friendlyAwxError(err);
      res.status(status).json({ ok: false, message });
    }
  });

  // GET /api/ansible/ss/custom/:serverId/:templateId — Admin, mevcut override'lari getir
  app.get("/api/ansible/ss/custom/:serverId/:templateId", requireAuth, requireAdmin, (req, res) => {
    const server = getServerById(req.params.serverId);
    if (!server) return res.status(404).json({ ok: false, message: "Sunucu bulunamadı." });
    res.json({ ok: true, customization: readCustom(server.id, req.params.templateId) });
  });

  // POST /api/ansible/launch-ss/:serverId/:templateId — Self-Service is baslat (tum authenticated kullanicilar)
  //
  // GUVENLIK: bu endpoint yalnizca admin'in `ansible-ss-items.json`'a KAYITLI VE
  // ENABLED isaretledigi (serverId, templateId) ciftlerini calistirabilmeli — self
  // service'in tum guvenlik modeli bu curated listeye dayanir (bkz. NEEDS.md).
  // Onceki halde bu kontrol EKSIKTI: route dogrudan awxRequestToServer cagiriyordu,
  // yalnizca requireAuth (requireAdmin DEGIL) istiyordu ve templateId URL'den
  // geldigi gibi kullaniliyordu — herhangi bir authenticated kullanici, UI'i hic
  // kullanmadan, o AWX sunucusundaki HERHANGI BIR template'i (curated listede
  // olmasa bile) dogrudan API cagrisiyla tetikleyebilirdi.
  app.post("/api/ansible/launch-ss/:serverId/:templateId", requireAuth, async (req, res) => {
    const server = getServerById(req.params.serverId);
    if (!server) return res.status(404).json({ ok: false, message: "Sunucu bulunamadı." });
    const templateId = Number(req.params.templateId);
    if (isNaN(templateId) || templateId <= 0) return res.status(400).json({ ok: false, message: "Geçersiz template ID." });

    // enabled=false bir item kullanicilardan gizlenir (bkz. SelfServicePage.tsx
    // visibleItems), ama ADMIN'e panelde yine de gosterilir (once-goz-atma/test
    // amacli) — bu yuzden enabled kontrolu Admin'ler icin atlanir, aksi halde admin
    // kendi henuz yayinlamadigi bir isi bile calistiramaz ("kullanicilara kapali"
    // == diger kullanicilardan gizli, Admin'den degil).
    const isAdmin = req.session?.user?.role === "Admin";
    const ssItem = readSsItems().find((i) =>
      (isAdmin || i.enabled) && Number(i.awxServerId) === server.id && Number(i.awxTemplateId) === templateId
    );
    if (!ssItem) {
      return res.status(403).json({ ok: false, message: "Bu template Self Service listesinde kayıtlı/etkin değil." });
    }

    const username = req.session?.user?.username || "anonymous";
    const { extraVars: submittedExtraVars = {}, templateName = "", limit = "", forks, jobTags, skipTags, verbosity, jobType } = req.body || {};

    try {
      const token = await getTokenForServer(server);

      // Launch parametrelerini AWX'e gondermeden ONCE sunucu tarafinda yeniden cozer/dogrular
      // — client'in gonderdigi extraVars'a asla dogrudan guvenilmez (savunma katmani).
      const detail = await awxRequestToServer(server, token, "GET", `/api/v2/job_templates/${templateId}/`);

      // Override'lar (field hidden/default, ek serbest degiskenler, launch-option
      // varsayilanlari) survey olsun olmasin HER ZAMAN okunur — hicbiri survey'e bagimli degil.
      const overrides = readCustom(server.id, templateId);

      let extraVars = {};
      let specFields = null;
      if (detail.survey_enabled === false) {
        // Survey devre disi. Admin bu template icin bir "Survey Tasarimcisi" tanimladiysa
        // (overrides.customSurveyFields) o alanlar AYNI AWX-native survey kadar sikica
        // (zorunlu/tip/min-max/choices, gizli alan icin sunucu-tarafi varsayilan) dogrulanip
        // extra_vars'a donusturulur. Tanimlanmamissa eskisi gibi hicbir survey degiskeni
        // kullanicidan gelmez, AWX template'in kendi statik extra_vars'iyla calisir.
        if (Array.isArray(overrides.customSurveyFields) && overrides.customSurveyFields.length > 0) {
          extraVars = resolveCustomSurveyExtraVars(overrides.customSurveyFields, submittedExtraVars);
        } else {
          extraVars = {};
        }
      } else {
        try {
          const spec = await awxRequestToServer(server, token, "GET", `/api/v2/job_templates/${templateId}/survey_spec/`);
          specFields = spec.spec || [];
        } catch (specErr) {
          if (specErr.status !== 404) throw specErr;
        }

        if (specFields && specFields.length > 0) {
          extraVars = resolveLaunchExtraVars(specFields, overrides, submittedExtraVars);
        } else {
          // Gercek bir survey yok (extra_vars fallback senaryosu) — mevcut esnek davranis
          // korunur: yalnizca dolu degerler gecirilir, kati dogrulama uygulanmaz.
          for (const [k, v] of Object.entries(submittedExtraVars || {})) {
            const val = v === undefined || v === null ? "" : String(v).trim();
            if (val !== "") extraVars[k] = val;
          }
        }
      }

      // Admin'in add-time'da tanimladigi serbest ("degiskenler") blogu — survey'de
      // karsiligi olmayan ek key:value'lar icin, HANGI YOLDAN GECILIRSE GECILSIN
      // (survey var/yok, fallback) tek merkezden birlestirilir. Survey/fallback
      // alanlari cakisan anahtarlarda ONCELIKLIDIR (yapilandirilmis olan kazanir).
      if (overrides.rawExtraVars) {
        extraVars = { ...parseSimpleYaml(overrides.rawExtraVars), ...extraVars };
      }

      // Baslatan kullanicinin e-posta/kullanici adi — EN SON adimda, oturumdan okunarak
      // enjekte edilir (client'in gonderdigi HICBIR deger bu iki anahtari EZEMEZ — survey/
      // custom-survey/rawExtraVars her ne uretmis olursa olsun burada ustune yazilir).
      if (overrides.injectUserInfo?.enabled) {
        const emailKey = String(overrides.injectUserInfo.emailKey || "").trim() || "email";
        const usernameKey = String(overrides.injectUserInfo.usernameKey || "").trim() || "username";
        extraVars[emailKey] = req.session?.user?.mail || "";
        extraVars[usernameKey] = req.session?.user?.username || "";
      }

      const resolvedLaunchOptions = resolveLaunchOptions(overrides, { limit, forks, jobTags, skipTags, verbosity, jobType });

      // SMART ONAYI: bu template icin admin "Smart onayi gerekli" isaretlediyse (bkz.
      // FieldOverridesModal.tsx, overrides.smartApproval) AWX job'i HEMEN tetiklenmez —
      // Smart'ta bir talep acilir, gerekli her sey (extraVars, launch secenekleri) DB'ye
      // yazilir ve onay geldiginde server/smart/poller.cjs bu ayni launch mantigini
      // (performSsLaunch) cagirir. Kullanici "onay bekleniyor" ekranini gorur.
      if (overrides.smartApproval?.enabled) {
        const smartClient = require("../smart/client.cjs");
        const smartStore = require("../smart/store.cjs");
        const flowKey = String(overrides.smartApproval.flowKey || "").trim();
        if (!flowKey) {
          return res.status(400).json({ ok: false, message: "Bu servis için Smart Flow Key tanımlanmamış — yöneticiye başvurun." });
        }
        let created;
        try {
          created = await smartClient.createTicket({
            flowKey,
            username,
            metadata: { application: templateName || String(templateId), requestedBy: username },
          });
        } catch (smartErr) {
          return res.status(smartErr.status || 502).json({ ok: false, message: `Smart talebi açılamadı: ${smartErr.message}` });
        }
        const ticket = await smartStore.createTicket({
          externalTicketId: created.ticketId,
          username,
          awxServerId: server.id,
          awxTemplateId: templateId,
          flowKey,
          pendingLaunch: { detail, extraVars, resolvedLaunchOptions, specFields, overrides, username, templateName },
        });
        require("../audit/index.cjs").auditPortal(req, "selfservice_smart_ticket_open", {
          detail: JSON.stringify({ awxServerId: server.id, templateId, flowKey, ticketId: created.ticketId }),
        });
        return res.json({ ok: true, pendingApproval: true, ticketId: ticket.id });
      }

      const result = await performSsLaunch(server, templateId, { detail, extraVars, resolvedLaunchOptions, specFields, overrides, username, templateName, req });
      res.json({ ok: true, jobId: result.jobId, status: result.status });
    } catch (err) {
      if (err.field) {
        return res.status(err.status || 500).json({ ok: false, message: err.message, field: err.field });
      }
      const { status, message } = friendlyAwxError(err);
      res.status(status).json({ ok: false, message });
    }
  });

  // GET /api/ansible/ss/smart-ticket/:id/status — Smart onayi bekleyen bir talebin
  // durumu (kullanici bu ID'yi launch-ss'in pendingApproval yanitindan alir, kendi
  // talebi olup olmadigi username karsilastirmasiyla korunur).
  app.get("/api/ansible/ss/smart-ticket/:id/status", requireAuth, async (req, res) => {
    try {
      const smartStore = require("../smart/store.cjs");
      const ticket = await smartStore.getTicket(Number(req.params.id));
      if (!ticket) return res.status(404).json({ ok: false, message: "Talep bulunamadı." });
      const reqUser = req.session?.user || {};
      if (reqUser.role !== "Admin" && ticket.username.toLowerCase() !== String(reqUser.username || "").toLowerCase()) {
        return res.status(403).json({ ok: false, message: "Bu talep size ait değil." });
      }
      res.json({
        ok: true,
        status: ticket.status,
        smartStateName: ticket.smartStateName,
        jobId: ticket.awxJobId,
        errorMessage: ticket.errorMessage,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/ansible/ss/job-status/:serverId/:jobId — Job durumu (tum kullanicilar)
  app.get("/api/ansible/ss/job-status/:serverId/:jobId", requireAuth, async (req, res) => {
    const server = getServerById(req.params.serverId);
    if (!server) return res.status(404).json({ ok: false, message: "Sunucu bulunamadı." });

    // Tek `dbx` — fonksiyon boyunca IDOR kontrolunde VE terminal-durum finalize
    // blogunda ayni degisken kullanilir (onceden ikinci kullanim ayri bir ic
    // try-blogundaki `const dbx`'e erisemiyordu → ReferenceError, bos catch{}
    // tarafindan yutuluyordu; gecmis/stdout arsivi hicbir zaman yazilmiyordu).
    const dbx = require("../db/index.cjs");

    // IDOR korumasi: job gecmiste KAYITLI ve BASKA kullaniciya aitse (admin degilse) reddet —
    // aksi halde serverId+jobId tahmin edip baskasinin stdout'unu okumak mumkundu. Kayit yoksa
    // veya DB hatasi varsa fail-open (mesru akisi bozma; gecmis artik launch'ta await edilerek yaziliyor).
    //
    // Ayni sorguda template_id de cekilir — Admin'in bu SS item icin bir "Cikti Filtresi"
    // tanimlayip tanimlamadigini kontrol etmek icin gerekir (asagida). IDOR kontrolu ADMIN
    // OLMAYANLAR icin yapilir, ama template_id ARAMASI HERKES icin gerekli oldugundan sorgu
    // rol farki gozetmeden calistirilir.
    let jobTemplateId = null;
    try {
      const reqUser = req.session?.user || req.user || {};
      const { rows } = await dbx.query(
        `SELECT TOP 1 username, template_id FROM ansible_job_history WHERE job_id = $1 AND awx_server_id = $2`,
        [Number(req.params.jobId), Number(req.params.serverId)]
      );
      if (rows.length) {
        jobTemplateId = Number(rows[0].template_id) || null;
        if (reqUser.role !== "Admin" && rows[0].username &&
            String(rows[0].username).toLowerCase() !== String(reqUser.username || "").toLowerCase()) {
          return res.status(403).json({ ok: false, message: "Bu iş size ait değil." });
        }
      }
    } catch { /* DB hiccup → fail-open (mesru polling bozulmasin) */ }

    try {
      const token = await getTokenForServer(server);
      const data = await awxRequestToServer(server, token, "GET", `/api/v2/jobs/${req.params.jobId}/`);
      const { output: stdoutText } = await getJobOutputOnServer(req.params.serverId, req.params.jobId);

      // Is gecmisi durumunu SONLANDIR: ansible_job_history yalniz launch aninda (pending) yaziliyor;
      // canli durum terminal ise gecmis satirini guncelle (herhangi biri job'i goruntulediginde) —
      // aksi halde gecmis sonsuza dek "pending" gorunur (Faz 4).
      const TERMINAL = ["successful", "failed", "error", "canceled"];
      if (TERMINAL.includes(data.status)) {
        try {
          const upd = await dbx.query(
            `UPDATE ansible_job_history SET status = $1, finished_at = COALESCE(finished_at, GETUTCDATE())
             WHERE job_id = $2 AND awx_server_id = $3 AND status <> $1`,
            [data.status, Number(req.params.jobId), Number(req.params.serverId)]
          );
          // Sadece bu poll'da GERCEKTEN terminale gecisi biz yakaladiysak (satir
          // guncellendiyse) bir kez audit'le — her poll'da tekrar tekrar yazmasin.
          if (upd.rowCount > 0) {
            require("../audit/index.cjs").auditPortal(req, "selfservice_ansible_complete", {
              detail: JSON.stringify({
                awxServerId: Number(req.params.serverId),
                jobId: Number(req.params.jobId),
                status: data.status,
                failed: !!data.failed,
                resultTraceback: (data.result_traceback || "").slice(0, 500),
                jobExplanation: (data.job_explanation || "").slice(0, 500),
                finished: data.finished || null,
              }),
              result: data.failed ? "failed" : "ok",
            });
          }
        } catch { /* best-effort — durum sorgusu bundan etkilenmesin */ }
        // Stdout arsivi: terminal duruma gecen job'in ciktisi bir kez ansible_job_output'a
        // yazilir — AWX tarafinda job silinse bile gecmis portal DB'sinde kalir.
        try {
          if (stdoutText) {
            const ex = await dbx.query(
              `SELECT 1 FROM ansible_job_output WHERE awx_server_id = $1 AND job_id = $2`,
              [Number(req.params.serverId), Number(req.params.jobId)]
            );
            if (!ex.rows.length) {
              await dbx.query(
                `INSERT INTO ansible_job_output (awx_server_id, job_id, stdout) VALUES ($1, $2, $3)`,
                [Number(req.params.serverId), Number(req.params.jobId), stdoutText]
              );
            }
          }
        } catch { /* best-effort */ }
      }

      // Parse/erken hatalarda AWX stdout'u BOS doner; hata `result_traceback`/`job_explanation`
      // alanlarindadir — bunlari da dondur ki modal "failed" yerine gercek logu gosterebilsin.
      //
      // CIKTI FILTRESI: Admin bu SS item icin "Alanlari Yonet" ekranindan bir outputFilter
      // tanimladiysa (ansible_ss_customizations.data.outputFilter), ham AWX stdout'undan
      // yalnizca belirtilen alt-diziyi ICEREN satirlar kullaniciya gosterilir — geri kalani
      // ATLANIR. Bu YALNIZCA bu response'un `output` alanini etkiler: DB'ye (ansible_job_output)
      // birkac satir yukarida ZATEN yazilan `stdoutText` HAM haliyle kalir (denetim/tam-log
      // butunlugu bozulmaz) — filtre yalniz EKRANDA gorunen goruntu.
      let displayOutput = stdoutText;
      if (jobTemplateId) {
        try {
          const overrides = readCustom(Number(req.params.serverId), jobTemplateId);
          const filt = overrides?.outputFilter;
          if (filt?.enabled && String(filt.contains || "").trim()) {
            const needle = String(filt.contains).trim();
            const totalLines = stdoutText ? stdoutText.split("\n").length : 0;
            displayOutput = stdoutText
              // .trim() — eslesen satirlarin bastaki/sondaki bosluklarini kaldirir.
              // Ham stdout'ta playbook cikti girintili (TASK altinda birkac bosluk)
              // veya CRLF kalintili (\r) gelebilir; filtre EKRANA yalniz ozet satirlari
              // koydugu icin bu girinti anlamsizlasiyor ve satirlar "kaymis" gorunuyordu.
              // NOT: bu yalniz FILTRE ACIKKEN uygulanir — ham (filtresiz) goruntude
              // playbook'un orijinal bicimi/girintisi DOKUNULMADAN kalir.
              ? stdoutText.split("\n").filter((line) => line.includes(needle)).map((line) => line.trim()).join("\n")
              : stdoutText;
            const matchedLines = displayOutput ? displayOutput.split("\n").filter(Boolean).length : 0;
            // TESHIS LOGU: filtre GERCEKTEN okundu mu (overrides bos degil), ve NEEDLE
            // kac satirla eslesti. matchedLines=0 ama totalLines>0 ise sebep ya karakter
            // uyusmazligi (needle stdout'ta hic gecmiyor) ya da yanlis needle. Bu satir
            // gecici degildir — dusuk hacimli bir uc nokta (polling), kalici birakilabilir.
            console.log(`[SS-Filter] server=${req.params.serverId} template=${jobTemplateId} needle=${JSON.stringify(needle)} totalLines=${totalLines} matchedLines=${matchedLines}`);
          } else if (overrides && Object.keys(overrides).length > 0) {
            // Ozellestirme kaydi VAR ama outputFilter yok/kapali — beklenen: tam cikti donuyor.
            console.log(`[SS-Filter] server=${req.params.serverId} template=${jobTemplateId} outputFilter tanimli degil/kapali — tam cikti donuyor.`);
          } else {
            // HIC ozellestirme kaydi bulunamadi — "Kaydet" hic calismamis veya farkli
            // (serverId, templateId) ciftine yazilmis olabilir.
            console.log(`[SS-Filter] server=${req.params.serverId} template=${jobTemplateId} customization KAYDI YOK — tam cikti donuyor.`);
          }
        } catch { /* customization okunamadiysa ham ciktiya duz — sessizce yoksay */ }
      } else {
        // jobTemplateId HIC bulunamadi — ansible_job_history'de bu (jobId, serverId)
        // icin satir yok. Bu durumda filtre asla uygulanamaz (hangi customization'a
        // bakilacagi bilinmiyor) — tam cikti donuyor, YANLIS DAVRANIS DEGIL ama
        // sebebi teshis etmek icin loglanir.
        console.log(`[SS-Filter] server=${req.params.serverId} job=${req.params.jobId} ansible_job_history'de kayit YOK — template belirlenemedi, filtre uygulanamiyor.`);
      }

      res.json({
        ok: true,
        status: data.status,
        output: displayOutput,
        resultTraceback: data.result_traceback || "",
        jobExplanation: data.job_explanation || "",
        finished: data.finished,
        failed: data.failed,
      });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // GET /api/ansible/history — Kullanicinin is gecmisi (son 30 gun)
  // Sutunlar acikca listelenir (SELECT * DEGIL) — `params` artik launch aninda redakte
  // edilerek yazildigi icin guvenle dahil edilebilir, ama acik liste ileride tabloya
  // eklenecek bilincsiz bir sutunun otomatik/farkinda olmadan sizmasini onler.
  const HISTORY_COLUMNS = "id, username, awx_server_id, template_id, template_name, job_id, status, started_at, finished_at, params";
  app.get("/api/ansible/history", requireAuth, async (req, res) => {
    const username = req.session?.user?.username || "";
    const role     = req.session?.user?.role     || "User";
    const days     = Math.min(Number(req.query.days) || 30, 90);
    try {
      const db = require("../db/index.cjs");
      const sql = role === "Admin"
        ? `SELECT TOP 100 ${HISTORY_COLUMNS} FROM ansible_job_history WHERE started_at >= DATEADD(day, -${days}, GETUTCDATE()) ORDER BY started_at DESC`
        : `SELECT TOP 100 ${HISTORY_COLUMNS} FROM ansible_job_history WHERE username = $1 AND started_at >= DATEADD(day, -${days}, GETUTCDATE()) ORDER BY started_at DESC`;
      const params = role === "Admin" ? [] : [username];
      const r = await db.query(sql, params);
      res.json({ ok: true, history: r.rows });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message, history: [] });
    }
  });
}

function clearTokenCache() {
  _serverTokenCaches.clear();
  console.log("[Cache] AWX token onbellegi temizlendi.");
}

module.exports = {
  initAnsibleRunner, isConfigured, launchJob, getJobStatus, getJobOutput, listTemplates,
  getOcpClusters, getServers, listTemplatesForServer, clearTokenCache,
  // LogX v2 coklu-sunucu sarmalayicilari:
  launchJobOnServer, getJobStatusOnServer, getJobOutputOnServer, cancelJobOnServer, getServerById,
};
