// server/ai-analyst/history.cjs — AI sohbet gecmisi (ai_conversations/ai_messages) ve
// kullanim telemetrisi (ai_usage_log) veri erisimi. Sohbetler kullanici basina saklanir;
// refresh/restart sonrasi kaldigi yerden devam edilebilir. Tum yazimlar best-effort
// olacak sekilde cagiran tarafta sarilir (AI akisi DB hatasindan bloklanmaz).
'use strict';

const db = require('../db/index.cjs');

const TITLE_MAX = 500;
const CONTENT_MAX = 1024 * 1024; // mesaj basina 1MB ust sinir

function uname(u) {
  return String(u || '').trim().toLowerCase();
}

async function listConversations(username) {
  const { rows } = await db.query(
    `SELECT id, title, archived, created_at, updated_at
     FROM ai_conversations WHERE username = $1 AND archived = 0
     ORDER BY updated_at DESC`,
    [uname(username)]
  );
  return rows;
}

async function createConversation(username, title) {
  // Adaptorun taniyip cevirdigi tasinabilir RETURNING sozdizimi kullanilir — ham MSSQL'e
  // ozgu OUTPUT INSERTED.id yazmak katman soyutlamasini (db.query PG-uyumlu sorgu bekler)
  // atlar ve bakim/tasinabilirlik riski yaratirdi (bkz. server/db/index.cjs handleReturning).
  const { rows } = await db.query(
    `INSERT INTO ai_conversations (username, title) VALUES ($1, $2) RETURNING id`,
    [uname(username), String(title || 'Yeni analiz').slice(0, TITLE_MAX)]
  );
  return rows[0]?.id ?? null;
}

// Sahiplik kontrolu dahil — baska kullanicinin sohbeti 'yok' gibi davranir (IDOR onlemi).
async function getConversation(username, id) {
  const conv = await db.query(
    `SELECT id, title, archived, created_at, updated_at
     FROM ai_conversations WHERE id = $1 AND username = $2`,
    [Number(id), uname(username)]
  );
  if (!conv.rows.length) return null;
  const msgs = await db.query(
    `SELECT id, role, content, tool_name, created_at
     FROM ai_messages WHERE conversation_id = $1 ORDER BY id`,
    [Number(id)]
  );
  return { conversation: conv.rows[0], messages: msgs.rows };
}

async function deleteConversation(username, id) {
  const { rowCount } = await db.query(
    `DELETE FROM ai_conversations WHERE id = $1 AND username = $2`,
    [Number(id), uname(username)]
  );
  return rowCount > 0;
}

// SSE akisinda her arac cagrisinda cagrilir (MAX_ITERATIONS=15 → bir sohbet turunda ~15-30
// cagriya kadar cikabilir) — eskiden INSERT+UPDATE ayri iki db.query() (2 network round-trip)
// idi. Ikisi noktali-virgullu TEK bir T-SQL batch olarak gonderilir (mssql surucusu coklu
// ifadeyi tek round-trip'te calistirir); $1 (conversationId) her iki ifadede de ayni degere
// baglanir — adaptSql metin-tabanli $n→@pn cevirisi yaptigi icin bu guvenle calisir.
async function appendMessage(conversationId, role, content, toolName) {
  await db.query(
    `INSERT INTO ai_messages (conversation_id, role, content, tool_name) VALUES ($1, $2, $3, $4);
     UPDATE ai_conversations SET updated_at = GETUTCDATE() WHERE id = $1;`,
    [Number(conversationId), String(role), String(content || '').slice(0, CONTENT_MAX), toolName || null]
  );
}

async function logUsage({ username, feature, provider, model, inputTokens, outputTokens, latencyMs, toolCalls, ok, error }) {
  await db.query(
    `INSERT INTO ai_usage_log (username, feature, provider, model, input_tokens, output_tokens, latency_ms, tool_calls, ok, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      uname(username), String(feature || 'chat'), provider || null, model || null,
      Number.isFinite(inputTokens) ? inputTokens : null,
      Number.isFinite(outputTokens) ? outputTokens : null,
      Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
      Number(toolCalls) || 0, ok ? 1 : 0, error ? String(error).slice(0, 500) : null,
    ]
  );
}

// Admin ozeti: gunluk toplamlar (son N gun).
async function usageSummary(days = 30) {
  const d = Math.min(Number(days) || 30, 365);
  // d degeri string-interpolasyon yerine baglanmis parametre olarak gecilir — aksi halde
  // her farkli days degeri (1,7,14,30,90...) MSSQL execution plan cache'inde ayri bir plan
  // olusturup gereksiz yer kaplar (adaptSql zaten $1 → @p1 cevirisini yapar).
  const { rows } = await db.query(
    `SELECT CAST(created_at AS DATE) AS day, feature,
            COUNT(*) AS calls, SUM(CASE WHEN ok = 1 THEN 0 ELSE 1 END) AS errors,
            AVG(latency_ms) AS avg_latency_ms, SUM(tool_calls) AS tool_calls
     FROM ai_usage_log
     WHERE created_at >= DATEADD(day, -$1, GETUTCDATE())
     GROUP BY CAST(created_at AS DATE), feature
     ORDER BY day DESC`,
    [d]
  );
  return rows;
}

module.exports = {
  listConversations, createConversation, getConversation, deleteConversation,
  appendMessage, logUsage, usageSummary,
};
