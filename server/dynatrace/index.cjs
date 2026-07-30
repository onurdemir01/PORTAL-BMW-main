// server/dynatrace/index.cjs — Dynatrace MANAGED MCP proxy routes
//
// Kurumdaki sunucu dynatrace-managed-mcp (SaaS dynatrace-mcp DEGIL):
//  - Tool adlari `dynatrace_managed_*` (bkz. client.cjs ustundeki not)
//  - DQL/Grail YOK → eski /query, /verify-query, /nl-query, /chat route'lari kaldirildi
//    (dogal dil analizi artik /api/ai-analyst uzerinden — MCP orkestrasyonu)
//  - Tool yanitlari formatlanmis METIN doner; problems/events icin hafif parse yapilir,
//    ham metin de `text` alaninda gecirilir.
'use strict';

const {
  isConfigured, checkReachable, callTool, listTools,
  getStatus, checkConnect, getEnvironments, getDefaultAlias,
} = require('./client.cjs');
const cache = require('./cache.cjs');

let _getTeamOwnership = async () => new Map();
try {
  ({ getTeamOwnership: _getTeamOwnership } = require('../inventory/index.cjs'));
} catch { /* inventory modulu yoksa takim sahipligi sessizce devre disi */ }

const PROBLEMS_TTL = 5 * 60 * 1000; // 5 dakika
const EVENTS_TTL   = 2 * 60 * 1000;

let _healthCache = null;
let _healthCacheAt = 0;
const HEALTH_TTL = 30 * 1000;

// ── Formatlanmis metin parser'lari ────────────────────────────────────────────
// Managed MCP formatter ciktisi deterministik "anahtar: deger" bloklari uretir
// (referans: dynatrace-managed-mcp/src/capabilities/*.ts formatList fonksiyonlari).
function parseBlocks(text, startKey) {
  const blocks = [];
  let current = null;
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_ ]*?):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const value = m[2].trim();
    if (key === startKey) {
      if (current) blocks.push(current);
      current = { [key]: value };
    } else if (current && line.startsWith('  ')) {
      // ayni anahtar iki kez yazilabiliyor (formatter bug'i: severityLevel) — ilkini koru
      if (!(key in current)) current[key] = value;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function parseProblems(text) {
  return parseBlocks(text, 'problemId').map((b) => ({
    problemId:     b.problemId,
    displayId:     b.displayId || '',
    title:         b.title || '',
    status:        b.status || '',
    severityLevel: b.severityLevel || '',
    impactLevel:   b.impactLevel || '',
    startTime:     b.startTime || null,
    endTime:       b.endTime || null,
  }));
}

function parseEvents(text) {
  return parseBlocks(text, 'eventId').map((b) => ({
    eventId:   b.eventId,
    eventType: b.eventType || '',
    status:    b.status || '',
    title:     b.title || '',
    startTime: b.startTime || null,
    endTime:   b.endTime || null,
  }));
}

function parseEntities(text) {
  return parseBlocks(text, 'entityId').map((b) => ({
    entityId:    b.entityId,
    displayName: b.displayName || b.name || '',
    type:        b.type || '',
    tags:        b.tags || '',
  }));
}

function asText(result) {
  return typeof result === 'string' ? result : (result?.text || JSON.stringify(result));
}

// ── entitySelector klozu ekleme (tag/managementZone) ─────────────────────────
// Dynatrace entitySelector sozdizimi virgulle AND'lenen klozlardan olusur:
// type("X"),tag("k:v"),tag("v2"),mzName("Zone"). Var olan selector'a ek klozlari
// guvenle ekler — mevcut serbest-metin `selector` param'i bozulmadan genisletilir.
function appendSelectorClauses(baseSelector, { tag, managementZone } = {}) {
  const clauses = [baseSelector].filter(Boolean);
  if (tag) {
    for (const t of String(tag).split(',').map((s) => s.trim()).filter(Boolean)) {
      clauses.push(`tag("${t.replace(/"/g, '')}")`);
    }
  }
  if (managementZone?.trim()) {
    clauses.push(`mzName("${managementZone.trim().replace(/"/g, '')}")`);
  }
  return clauses.join(',');
}

function initDynatrace(app) {
  let requireAuth = (req, res, next) => next();
  try {
    const { requireAuth: ra } = require('../auth/index.cjs');
    if (typeof ra === 'function') requireAuth = ra;
  } catch { /* auth modulu yoksa passthrough */ }

  // Performance sayfasi gizliyse bu API GERCEKTEN 403 doner (kozmetik degil). /health
  // muaf — dashboard KPI/probe icin tum authenticated kullanicilara acik.
  try {
    const { requireVisiblePrefix } = require('../auth/visibility.cjs');
    app.use('/api/dynatrace', requireVisiblePrefix('Performance', { exempt: ['/health'] }));
  } catch { /* motor yoksa yoksay */ }

  // ── Health ────────────────────────────────────────────────────────────────
  app.get('/api/dynatrace/health', requireAuth, async (req, res) => {
    if (_healthCache && Date.now() - _healthCacheAt < HEALTH_TTL) {
      return res.json(_healthCache);
    }
    const reachable = await checkReachable();
    const mcpConnected = reachable ? await checkConnect() : false;
    const status = getStatus();
    let defaultAlias = null;
    if (mcpConnected) {
      try { defaultAlias = await getDefaultAlias(); } catch { /* kesif basarisiz */ }
    }
    _healthCache = {
      ok:          true,
      configured:  isConfigured(),
      reachable,
      mcpConnected,
      environment: status.connectedUrl || status.configuredUrl,
      defaultAlias,
      lastError:   status.lastError,
      message: mcpConnected
        ? undefined
        : !reachable
          ? 'Dynatrace MCP sunucusuna ulaşılamıyor (ağ/VPN erişimi gerekli olabilir).'
          : `Sunucuya TCP erişimi var ama MCP bağlantısı kurulamadı${status.lastError ? `: ${status.lastError.message}` : '.'}`,
    };
    _healthCacheAt = Date.now();
    res.json(_healthCache);
  });

  // ── Environment alias'lari ────────────────────────────────────────────────
  app.get('/api/dynatrace/environments', requireAuth, async (req, res) => {
    try {
      const { aliases, raw } = await getEnvironments(req.query.refresh === '1');
      const defaultAlias = await getDefaultAlias();
      res.json({ ok: true, aliases, defaultAlias, text: raw });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // ── Tools listesi (admin debug) ───────────────────────────────────────────
  app.get('/api/dynatrace/tools', requireAuth, async (req, res) => {
    try {
      const tools = await listTools();
      res.json({ ok: true, tools });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // ── Problemler ────────────────────────────────────────────────────────────
  // NOT: dynatrace_managed_list_problems entitySelector kabul etmiyor (yalnizca
  // status/from/to/limit) — bu yuzden host/serbest-metin filtresi entitySelector
  // olarak DEGIL, alinmis problem listesi uzerinde baslik bazli metin aramasiyla
  // uygulanir (sahte bir filtre yetenegi iddia etmemek icin); cache hem cache-hit
  // hem fresh-fetch yolunda AYNI sekilde filtrelenir.
  function filterProblems(problems, req) {
    const hostFilter = (req.query.host || req.query.q || '').trim().toLowerCase();
    return hostFilter ? problems.filter((p) => p.title.toLowerCase().includes(hostFilter)) : problems;
  }

  app.get('/api/dynatrace/problems', requireAuth, async (req, res) => {
    const envAlias = req.query.env || null;
    const refresh  = req.query.refresh === '1';
    const cacheKey = `problems-${envAlias || 'default'}-${req.query.status || 'OPEN'}`;
    if (!refresh) {
      const cached = cache.get(cacheKey, PROBLEMS_TTL);
      if (cached) return res.json({ ok: true, source: 'cache', ...cached, problems: filterProblems(cached.problems, req) });
    }
    try {
      const result = await callTool('dynatrace_managed_list_problems', {
        status: req.query.status || 'OPEN',
        from:   req.query.from || 'now-24h',
        to:     req.query.to || 'now',
        ...(req.query.limit ? { limit: Number(req.query.limit) } : {}),
      }, envAlias);
      const text = asText(result);
      const payload = { problems: parseProblems(text), text };
      cache.set(cacheKey, payload);
      res.json({ ok: true, source: 'mcp', ...payload, problems: filterProblems(payload.problems, req) });
    } catch (err) {
      console.error('[DT-MCP] list_problems hatasi:', err.message);
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // ── Problem detayi ────────────────────────────────────────────────────────
  app.get('/api/dynatrace/problems/:id', requireAuth, async (req, res) => {
    try {
      const result = await callTool('dynatrace_managed_get_problem_details', {
        problemId: req.params.id,
      }, req.query.env || null);
      res.json({ ok: true, text: asText(result) });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // ── Events ────────────────────────────────────────────────────────────────
  // host/tag/managementZone verilirse (raw entitySelector yoksa) `type("HOST"),
  // entityName.contains(host)` capasina tag()/mzName() klozlari eklenerek bir
  // entitySelector kurulur — tool zaten entitySelector kabul ediyor (mevcut
  // davranis), burada yalnizca UI'dan yapilandirilmis bir uretim ekleniyor.
  app.get('/api/dynatrace/events', requireAuth, async (req, res) => {
    const envAlias = req.query.env || null;
    const { host, tag, managementZone } = req.query;
    let entitySelector = req.query.entitySelector || '';
    if (!entitySelector && (host?.trim() || tag || managementZone?.trim())) {
      const base = host?.trim() ? `type("HOST"),entityName.contains("${host.trim().replace(/"/g, '')}")` : '';
      entitySelector = appendSelectorClauses(base, { tag, managementZone });
    }
    const cacheKey = `events-${envAlias || 'default'}-${req.query.eventType || 'all'}-${req.query.from || 'now-1h'}-${entitySelector || 'none'}`;
    if (req.query.refresh !== '1') {
      const cached = cache.get(cacheKey, EVENTS_TTL);
      if (cached) return res.json({ ok: true, source: 'cache', ...cached });
    }
    try {
      const args = {
        from:  req.query.from || 'now-1h',
        to:    req.query.to || 'now',
        limit: req.query.limit ? Number(req.query.limit) : 50,
      };
      if (req.query.eventType) args.eventType = req.query.eventType;
      if (entitySelector)      args.entitySelector = entitySelector;
      const result = await callTool('dynatrace_managed_list_events', args, envAlias);
      const text = asText(result);
      const payload = { events: parseEvents(text), text };
      cache.set(cacheKey, payload);
      res.json({ ok: true, source: 'mcp', ...payload });
    } catch (err) {
      console.error('[DT-MCP] list_events hatasi:', err.message);
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // ── Entity arama / detay ──────────────────────────────────────────────────
  // discover_entities YALNIZCA entitySelector alir ve tam olarak BIR entity type
  // icermelidir. UI'dan name+type gelirse selector burada kurulur; raw selector
  // da dogrudan gecirilebilir. `host` verilirse (ve type belirtilmemisse) tip
  // varsayilan olarak HOST alinir — host bazli arama en yaygin senaryo.
  // tag/managementZone ek klozlar olarak appendSelectorClauses ile eklenir.
  app.get('/api/dynatrace/entities', requireAuth, async (req, res) => {
    const { name, host, type, selector, tag, managementZone, env } = req.query;
    const searchName = (name || host || '').trim();
    if (!searchName && !selector?.trim()) {
      return res.status(400).json({ ok: false, message: 'name/host (+ opsiyonel type) veya selector query param zorunlu.' });
    }
    try {
      const effectiveType = (type || (host ? 'HOST' : 'SERVICE')).trim().toUpperCase();
      const baseSelector = selector?.trim()
        || `type("${effectiveType}"),entityName.contains("${searchName.replace(/"/g, '')}")`;
      const entitySelector = appendSelectorClauses(baseSelector, { tag, managementZone });
      const args = {
        entitySelector,
        limit: req.query.limit ? Number(req.query.limit) : 25,
      };
      const result = await callTool('dynatrace_managed_discover_entities', args, env || null);
      const text = asText(result);
      const entities = parseEntities(text);

      // Ekip sahipligi zenginlestirme — best-effort, eslesme yoksa owningTeam: null
      // (bkz. server/inventory/index.cjs getTeamOwnership; ekip_infos semasi yoksa
      // veya DB erisilemezse bos Map doner, istek basarisiz OLMAZ).
      const teamMap = await _getTeamOwnership(entities.map((e) => e.displayName)).catch(() => new Map());
      const enriched = entities.map((e) => ({
        ...e,
        owningTeam: teamMap.get(e.displayName.toLowerCase()) || null,
      }));

      res.json({ ok: true, entitySelector, entities: enriched, text });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  app.get('/api/dynatrace/entities/:id', requireAuth, async (req, res) => {
    try {
      const result = await callTool('dynatrace_managed_get_entity_details', {
        entityId: req.params.id,
      }, req.query.env || null);
      res.json({ ok: true, text: asText(result) });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // ── Metrikler ─────────────────────────────────────────────────────────────
  app.get('/api/dynatrace/metrics', requireAuth, async (req, res) => {
    try {
      const args = { limit: req.query.limit ? Number(req.query.limit) : 30 };
      if (req.query.search)   args.searchText = String(req.query.search);
      if (req.query.selector) args.entitySelector = String(req.query.selector);
      const result = await callTool('dynatrace_managed_list_available_metrics', args, req.query.env || null);
      res.json({ ok: true, text: asText(result) });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  app.post('/api/dynatrace/metrics/query', requireAuth, async (req, res) => {
    const { metricSelector, from, to, entitySelector, env } = req.body || {};
    if (!metricSelector?.trim()) return res.status(400).json({ ok: false, message: 'metricSelector zorunlu.' });
    try {
      const args = {
        metricSelector: metricSelector.trim(),
        from: from || 'now-1h',
        to:   to || 'now',
      };
      if (entitySelector?.trim()) args.entitySelector = entitySelector.trim();
      const result = await callTool('dynatrace_managed_query_metrics_data', args, env || null);
      res.json({ ok: true, text: asText(result) });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // ── Loglar ────────────────────────────────────────────────────────────────
  app.post('/api/dynatrace/logs', requireAuth, async (req, res) => {
    const { query, from, to, limit, env } = req.body || {};
    try {
      const args = {
        from:  from || 'now-1h',
        to:    to || 'now',
        limit: limit ? Number(limit) : 50,
      };
      if (query?.trim()) args.query = query.trim();
      const result = await callTool('dynatrace_managed_query_logs', args, env || null);
      res.json({ ok: true, text: asText(result) });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  // ── Cache temizle (admin) ─────────────────────────────────────────────────
  app.delete('/api/dynatrace/cache', requireAuth, (req, res) => {
    cache.clear();
    res.json({ ok: true });
  });
}

module.exports = { initDynatrace };
