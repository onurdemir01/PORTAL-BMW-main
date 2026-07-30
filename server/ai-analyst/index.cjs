// server/ai-analyst/index.cjs — AI Analist route'lari
//
// Portalin "herkes icin tek kanal" ozelligi: VSCode/Copilot kurulumu gerektirmeden,
// LLM'in Dynatrace + Instana MCP araclarini zincirleme cagirdigi analiz sohbeti.
// POST /chat SSE doner — adimlar (tool_call/tool_result/text) canli akar.
'use strict';

const express = require('express');
const { isConfigured, getProvider, activeModel, checkRateLimit, getFeatureLimits } = require('../ai/provider.cjs');
const aiAnalyzer = require('../logx/ai-analyzer.cjs');
const { orchestrate } = require('./orchestrator.cjs');
const history = require('./history.cjs');

function initAiAnalyst(app) {
  let requireAuth = (req, res, next) => next();
  try {
    const { requireAuth: ra } = require('../auth/index.cjs');
    if (typeof ra === 'function') requireAuth = ra;
  } catch { /* auth modulu yoksa passthrough */ }

  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  // AI Analist sayfasi gizliyse gercek 403 (kozmetik degil). /health muaf (probe).
  try {
    const { requireVisiblePrefix } = require('../auth/visibility.cjs');
    router.use(requireVisiblePrefix('AI Analist', { exempt: ['/health'] }));
  } catch { /* motor yoksa yoksay */ }

  // ── Saglik/yapilandirma ─────────────────────────────────────────────────────
  router.get('/health', requireAuth, (req, res) => {
    res.json({
      ok: true,
      configured: isConfigured(),
      provider: getProvider(),
      model: activeModel(),
      features: getFeatureLimits(),
      message: isConfigured() ? undefined
        : 'AI sağlayıcı anahtarı tanımlı değil (ANTHROPIC_API_KEY / OPENAI_API_KEY) — AI Analist devre dışı.',
    });
  });

  // ── Log analizi (tek atimlik, PII maskeli) ─────────────────────────────────
  // LogX'ten tasinan ozellik — AI Analist'in "Log Analizi" modu bunu kullanir.
  // Eski /api/logx/analyze route'u geriye donuk alias olarak ayni analiz mantigina
  // bagli kalir (bkz. server/logx/index.cjs).
  router.post('/analyze-logs', requireAuth, async (req, res) => {
    if (!isConfigured()) {
      return res.status(503).json({ ok: false, message: 'AI sağlayıcı anahtarı tanımlı değil (ANTHROPIC_API_KEY / OPENAI_API_KEY).' });
    }
    const { lines, context } = req.body || {};
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ ok: false, message: 'lines array gerekli.' });
    }
    const username = req.session?.user?.username || 'anonymous';
    const startedAt = Date.now();
    try {
      const result = await aiAnalyzer.analyze(lines, context || '', username);
      history.logUsage({
        username, feature: 'logs', provider: getProvider(), model: activeModel(),
        latencyMs: Date.now() - startedAt, toolCalls: 0, ok: true,
      }).catch(() => {});
      res.json({ ok: true, ...result });
    } catch (err) {
      history.logUsage({
        username, feature: 'logs', provider: getProvider(), model: activeModel(),
        latencyMs: Date.now() - startedAt, toolCalls: 0, ok: false, error: err.message,
      }).catch(() => {});
      const status = err.status || 500;
      const isProviderQuota = status === 429 && /AI API 429/.test(err.message || '');
      const message = isProviderQuota
        ? 'AI sağlayıcı kotası doldu (API anahtarı/plan limiti). Portal tarafında düzeltilecek bir şey yok — API planı/kredisi kontrol edilmeli.'
        : err.message;
      res.status(status).json({ ok: false, message });
    }
  });

  // ── Analiz sohbeti (SSE) ────────────────────────────────────────────────────
  router.post('/chat', requireAuth, async (req, res) => {
    if (!isConfigured()) {
      return res.status(503).json({
        ok: false,
        message: 'AI sağlayıcı anahtarı tanımlı değil (ANTHROPIC_API_KEY / OPENAI_API_KEY).',
      });
    }

    const username = req.session?.user?.username || 'anonymous';
    if (checkRateLimit(username, 'chat')) {
      return res.status(429).json({ ok: false, message: 'Saatlik AI Analist limitine ulaşıldı (20 istek/saat).' });
    }

    const { messages, sources = { dynatrace: true, instana: false }, instanaEnv = 'nonprod' } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ ok: false, message: 'messages dizisi zorunlu.' });
    }
    // Sadece role+string content kabul edilir; gecmis 20 mesajla sinirlanir
    const cleanMessages = messages
      .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
    if (cleanMessages.length === 0 || cleanMessages[cleanMessages.length - 1].role !== 'user') {
      return res.status(400).json({ ok: false, message: 'Son mesaj kullanıcıya ait olmalı.' });
    }

    // Sohbet kaliciligi: conversationId geldiyse o sohbete eklenir; gelmediyse yeni
    // sohbet acilir (baslik = ilk kullanici mesaji). DB yoksa sohbet yine akar
    // (best-effort) — yalnizca gecmis saklanmaz.
    let conversationId = Number(req.body?.conversationId) || null;
    const lastUserMsg = cleanMessages[cleanMessages.length - 1].content;
    if (!conversationId) {
      conversationId = await history
        .createConversation(username, lastUserMsg.slice(0, 80))
        .catch(() => null);
    }
    if (conversationId) {
      history.appendMessage(conversationId, 'user', lastUserMsg).catch(() => {});
    }

    // SSE baslat
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    req.on('close', () => { closed = true; });
    // emit sarici: SSE'ye yazarken asistan metnini ve arac cagrilarini da toplar —
    // akis bitince sohbet gecmisine (ai_messages) ve kullanim kaydina (ai_usage_log) yazilir.
    const assistantParts = [];
    let toolCallCount = 0;
    const emit = (event) => {
      if (event?.type === 'text' && event.text) assistantParts.push(event.text);
      if (event?.type === 'tool_call') {
        toolCallCount++;
        if (conversationId) {
          history.appendMessage(conversationId, 'tool', JSON.stringify(event.args || {}), event.name).catch(() => {});
        }
      }
      if (closed) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    if (conversationId) emit({ type: 'conversation', id: conversationId });

    const role = req.session?.user?.role || 'User';
    const startedAt = Date.now();
    console.log(`[AI-Analyst] ${username} → analiz basladi (dt:${!!sources.dynatrace}, instana:${!!sources.instana}/${instanaEnv})`);
    try {
      await orchestrate({ messages: cleanMessages, sources, instanaEnv, emit, user: { username, role } });
      emit({ type: 'done' });
      history.logUsage({
        username, feature: 'chat', provider: getProvider(), model: activeModel(),
        latencyMs: Date.now() - startedAt, toolCalls: toolCallCount, ok: true,
      }).catch(() => {});
    } catch (err) {
      console.error('[AI-Analyst] hata:', err.message);
      const isQuota = /AI API 429/.test(err.message || '');
      emit({
        type: 'error',
        message: isQuota
          ? 'AI sağlayıcı kotası doldu (API anahtarı/plan limiti) — portal tarafında düzeltilecek bir şey yok.'
          : err.message,
      });
      emit({ type: 'done' });
      history.logUsage({
        username, feature: 'chat', provider: getProvider(), model: activeModel(),
        latencyMs: Date.now() - startedAt, toolCalls: toolCallCount, ok: false, error: err.message,
      }).catch(() => {});
    } finally {
      if (conversationId && assistantParts.length) {
        history.appendMessage(conversationId, 'assistant', assistantParts.join('\n')).catch(() => {});
      }
      if (!closed) res.end();
    }
  });

  // ── Sohbet gecmisi (ai_conversations / ai_messages) ─────────────────────────
  router.get('/conversations', requireAuth, async (req, res) => {
    const username = req.session?.user?.username || 'anonymous';
    try {
      res.json({ ok: true, conversations: await history.listConversations(username) });
    } catch (e) {
      res.json({ ok: true, conversations: [], degraded: true, error: e.message });
    }
  });

  router.get('/conversations/:id', requireAuth, async (req, res) => {
    const username = req.session?.user?.username || 'anonymous';
    try {
      const conv = await history.getConversation(username, req.params.id);
      if (!conv) return res.status(404).json({ ok: false, message: 'Sohbet bulunamadı.' });
      res.json({ ok: true, ...conv });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  router.delete('/conversations/:id', requireAuth, async (req, res) => {
    const username = req.session?.user?.username || 'anonymous';
    try {
      const okDel = await history.deleteConversation(username, req.params.id);
      if (!okDel) return res.status(404).json({ ok: false, message: 'Sohbet bulunamadı.' });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // ── Kullanim ozeti (admin) — ai_usage_log gunluk toplamlari ─────────────────
  router.get('/usage', requireAuth, async (req, res) => {
    const role = req.session?.user?.role || 'User';
    if (role !== 'Admin') return res.status(403).json({ ok: false, message: 'Admin yetkisi gerekli.' });
    try {
      res.json({ ok: true, summary: await history.usageSummary(req.query.days) });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message, summary: [] });
    }
  });

  app.use('/api/ai-analyst', router);
  console.log('[AI-Analyst] module mounted at /api/ai-analyst');
}

module.exports = { initAiAnalyst };
