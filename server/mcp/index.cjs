// server/mcp/index.cjs — Generic MCP yonetim endpoint'leri (admin-only)
// GET  /api/mcp/:server/tools        → sunucunun sundugu tool listesi
// POST /api/mcp/:server/call         → { tool, args, env? } ile tool cagirma
// GET  /api/mcp/:server/status       → baglanti durumu + son hata
// :server ∈ { dynatrace, instana }  (instana icin ?env=nonprod|prod)
'use strict';

function initMcp(app) {
  // Paylasilan auth guard'lari (secret-kapili). Auth modulu yuklenemezse fallback KAPALI
  // (deny) — MCP admin endpoint'leri asla guard'siz acilmasin.
  let requireAuth = (req, res, next) => res.status(401).json({ ok: false, message: 'Auth modülü yok.' });
  let requireAdmin = (req, res, next) => res.status(403).json({ ok: false, message: 'Auth modülü yok.' });
  try {
    const auth = require('../auth/index.cjs');
    if (typeof auth.requireAuth === 'function') requireAuth = auth.requireAuth;
    if (typeof auth.requireAdmin === 'function') requireAdmin = auth.requireAdmin;
  } catch { /* auth modulu yoksa deny kalir */ }

  function getServerModule(name) {
    if (name === 'dynatrace') return require('../dynatrace/client.cjs');
    if (name === 'instana')   return require('../instana/client.cjs');
    return null;
  }

  app.get('/api/mcp/:server/status', requireAuth, requireAdmin, (req, res) => {
    const mod = getServerModule(req.params.server);
    if (!mod) return res.status(404).json({ ok: false, message: 'Bilinmeyen MCP sunucusu.' });
    const env = req.query.env === 'prod' ? 'prod' : 'nonprod';
    const status = req.params.server === 'instana' ? mod.getStatus(env) : mod.getStatus();
    res.json({ ok: true, status });
  });

  app.get('/api/mcp/:server/tools', requireAuth, requireAdmin, async (req, res) => {
    const mod = getServerModule(req.params.server);
    if (!mod) return res.status(404).json({ ok: false, message: 'Bilinmeyen MCP sunucusu.' });
    try {
      const env = req.query.env === 'prod' ? 'prod' : 'nonprod';
      // ?full=1 → inputSchema dahil (AI orkestrasyonu / debug icin)
      const full = req.query.full === '1';
      const fn = full ? 'listToolsFull' : 'listTools';
      const tools = req.params.server === 'instana' ? await mod[fn](env) : await mod[fn]();
      res.json({ ok: true, tools });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  app.post('/api/mcp/:server/call', requireAuth, requireAdmin, async (req, res) => {
    const mod = getServerModule(req.params.server);
    if (!mod) return res.status(404).json({ ok: false, message: 'Bilinmeyen MCP sunucusu.' });
    const { tool, args = {}, env } = req.body || {};
    if (!tool || typeof tool !== 'string') {
      return res.status(400).json({ ok: false, message: 'tool alanı gerekli.' });
    }
    try {
      const result = req.params.server === 'instana'
        ? await mod.callTool(tool, args, env === 'prod' ? 'prod' : 'nonprod')
        : await mod.callTool(tool, args);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(502).json({ ok: false, message: err.message });
    }
  });

  console.log('[MCP] generic endpoints mounted at /api/mcp/:server');
}

module.exports = { initMcp };
