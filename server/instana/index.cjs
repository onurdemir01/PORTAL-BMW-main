// server/instana/index.cjs — Instana MCP proxy routes
'use strict';

const { isConfigured, callTool, listTools } = require('./client.cjs');

let _getTeamOwnership = async () => new Map();
try {
  ({ getTeamOwnership: _getTeamOwnership } = require('../inventory/index.cjs'));
} catch { /* inventory modulu yoksa takim sahipligi sessizce devre disi */ }

const _cache   = new Map(); // key → { data, ts }
const CACHE_TTL = 5 * 60 * 1000; // 5 dakika

function cached(key, ttl) {
  const e = _cache.get(key);
  return (e && Date.now() - e.ts < ttl) ? e.data : null;
}

// ── Serbest-metin filtre (host/servis/tag arama) ─────────────────────────────
// Instana MCP tool semalari repo'da statik tanimli degil (canli sunucudan
// geliyor) — host/tag gibi parametreleri dogrudan tool cagrisina eklemek,
// sema dogrulamasi tool tarafinda sikiysa calisan bir cagriyi sessizce
// bozabilir. Bunun yerine donen veride (bilinen alan adlarina bagli kalmadan)
// jenerik bir metin filtresi uygulanir: `data` icindeki dizi alanlari (issues/
// events/services/…) elemanlari JSON'a cevrilip `q` ile aranir. Tool cagrisi
// DEGISMEZ — yalnizca zaten donen sonuc suzulur.
function filterByFreeText(data, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle || !data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const [key, value] of Object.entries(out)) {
    if (Array.isArray(value)) {
      out[key] = value.filter((item) => JSON.stringify(item).toLowerCase().includes(needle));
    }
  }
  return out;
}

// ── Ekip sahipligi zenginlestirme (Dynatrace entities ile ayni yaklasim) ─────
// Instana tool semalari bilinmedigi icin (bkz. yukaridaki not) hangi alanin
// "host/servis adi" oldugu sabit degil — yaygin alan adlari sirayla denenir.
// Eslesme yoksa owningTeam: null (fail-open, istek basarisiz olmaz).
const NAME_KEY_CANDIDATES = ['host', 'hostName', 'hostname', 'entityName', 'label', 'name', 'serviceName', 'title'];

function pickNameField(item) {
  if (!item || typeof item !== 'object') return null;
  for (const k of NAME_KEY_CANDIDATES) {
    const v = item[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

async function enrichWithTeamOwnership(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const [key, value] of Object.entries(out)) {
    if (!Array.isArray(value)) continue;
    const names = value.map(pickNameField).filter(Boolean);
    if (names.length === 0) continue;
    const teamMap = await _getTeamOwnership(names).catch(() => new Map());
    out[key] = value.map((item) => {
      const name = pickNameField(item);
      return { ...item, owningTeam: name ? (teamMap.get(name.toLowerCase()) || null) : null };
    });
  }
  return out;
}

// q veya host — ikisi de ayni serbest-metin filtresini besler (UI'da ayri
// alan olabilir ama sunucu tarafinda tek bir arama mekanizmasi yeterli).
function searchTerm(req) {
  return req.query.q || req.query.host || '';
}

function initInstana(app) {
  let requireAuth = (req, res, next) => next();
  try {
    const { requireAuth: ra } = require('../auth/index.cjs');
    if (typeof ra === 'function') requireAuth = ra;
  } catch { /* auth modulu yoksa passthrough */ }

  // Performance sayfasi gizliyse gercek 403 (dynatrace ile ayni desen). /health muaf.
  try {
    const { requireVisiblePrefix } = require('../auth/visibility.cjs');
    app.use('/api/instana', requireVisiblePrefix('Performance', { exempt: ['/health'] }));
  } catch { /* motor yoksa yoksay */ }

  // ── Health ────────────────────────────────────────────────────────────────
  app.get('/api/instana/health', requireAuth, (req, res) => {
    const env = req.query.env || 'nonprod';
    res.json({
      ok:         true,
      configured: isConfigured(env),
      env,
      mcpUrl:     process.env.INSTANA_MCP_URL || 'https://instana-mcp.apps-3rd-t.fw.garanti.com.tr/mcp',
    });
  });

  // ── Tools listesi (admin debug) ───────────────────────────────────────────
  app.get('/api/instana/tools', requireAuth, async (req, res) => {
    const env = req.query.env || 'nonprod';
    if (!isConfigured(env)) return res.json({ ok: false, message: 'Instana yapılandırılmamış.', tools: [] });
    try {
      const tools = await listTools(env);
      res.json({ ok: true, env, tools });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // ── Problemler / Acik Issue'lar ──────────────────────────────────────────
  app.get('/api/instana/problems', requireAuth, async (req, res) => {
    const env = req.query.env || 'nonprod';
    if (!isConfigured(env)) return res.json({ ok: false, message: 'Instana yapılandırılmamış.', problems: [] });

    const cacheKey = `problems-${env}`;
    if (req.query.refresh !== '1') {
      const hit = cached(cacheKey, CACHE_TTL);
      if (hit) return res.json({ ok: true, source: 'cache', env, ...(await enrichWithTeamOwnership(filterByFreeText(hit, searchTerm(req)))) });
    }

    try {
      const data = await callTool('get_open_issues', {}, env);
      _cache.set(cacheKey, { data, ts: Date.now() });
      res.json({ ok: true, source: 'mcp', env, ...(await enrichWithTeamOwnership(filterByFreeText(data, searchTerm(req)))) });
    } catch (err) {
      console.error('[Instana-MCP] get_open_issues hatasi:', err.message);
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // ── Event'ler ─────────────────────────────────────────────────────────────
  app.get('/api/instana/events', requireAuth, async (req, res) => {
    const env = req.query.env || 'nonprod';
    if (!isConfigured(env)) return res.json({ ok: false, message: 'Instana yapılandırılmamış.', events: [] });

    try {
      const data = await callTool('get_events', {}, env);
      res.json({ ok: true, source: 'mcp', env, ...(await enrichWithTeamOwnership(filterByFreeText(data, searchTerm(req)))) });
    } catch (err) {
      console.error('[Instana-MCP] get_events hatasi:', err.message);
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // ── Servisler ─────────────────────────────────────────────────────────────
  app.get('/api/instana/services', requireAuth, async (req, res) => {
    const env = req.query.env || 'nonprod';
    if (!isConfigured(env)) return res.json({ ok: false, message: 'Instana yapılandırılmamış.', services: [] });

    const cacheKey = `services-${env}`;
    if (req.query.refresh !== '1') {
      const hit = cached(cacheKey, CACHE_TTL);
      if (hit) return res.json({ ok: true, source: 'cache', env, ...(await enrichWithTeamOwnership(filterByFreeText(hit, searchTerm(req)))) });
    }

    try {
      const data = await callTool('get_services', {}, env);
      _cache.set(cacheKey, { data, ts: Date.now() });
      res.json({ ok: true, source: 'mcp', env, ...(await enrichWithTeamOwnership(filterByFreeText(data, searchTerm(req)))) });
    } catch (err) {
      console.error('[Instana-MCP] get_services hatasi:', err.message);
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // ── Cache temizle (admin) ─────────────────────────────────────────────────
  app.delete('/api/instana/cache', requireAuth, (req, res) => {
    _cache.clear();
    res.json({ ok: true });
  });
}

module.exports = { initInstana };
