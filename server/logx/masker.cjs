// server/logx/masker.cjs
// PII masking before log lines are sent to external AI APIs.
// All replacements are one-way: original data is never returned.
//
// Kurallar artik DB'den (logx_mask_rules) yuklenir ve admin tarafindan duzenlenebilir;
// asagidaki RULES sabiti yalnizca DB erisilemezken/yuklenmeden onceki fallback'tir
// (ilk kurulum seed'i mssql-setup.cjs MASK_RULES_SEED ile ayni). Kural SIRASI onemlidir:
// PHONE_GEN, TCKN'den sonra kosmali (cifte maskeleme onlenir).
'use strict';

const RULES = [
  // Turkish TCKN (11 digits, starts with non-zero)
  { name: 'TCKN',       re: /\b[1-9]\d{10}\b/g,                                      tag: '[TCKN]'        },
  // IBAN — TR format with or without spaces (TR33 0006 1005 1978 6457 8413 26)
  { name: 'IBAN',       re: /\bTR\d{2}(?:[ -]?\d{4}){5}[ -]?\d{2}\b/gi,                tag: '[IBAN]'    },
  // IBAN — generic international (no spaces, 15-34 alphanum after 2 letter country code)
  { name: 'IBAN_INTL',  re: /\b[A-Z]{2}\d{2}[0-9A-Z]{11,30}\b/g,                       tag: '[IBAN]'    },
  // Card numbers (13-16 digits, optionally separated by space/dash)
  { name: 'CARD',       re: /\b(?:\d[ -]?){13,16}\b/g,                               tag: '[CARD]'        },
  // Bearer tokens / JWT (Authorization header values)
  { name: 'BEARER',     re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,                      tag: 'Bearer [TOKEN]'},
  // JWT standalone (three base64url segments)
  { name: 'JWT',        re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,  tag: '[JWT]'         },
  // Authorization header value
  { name: 'AUTH_HDR',   re: /Authorization:\s*\S+/gi,                                tag: 'Authorization: [REDACTED]' },
  // Passwords in JSON/query-string patterns
  { name: 'PASSWORD',   re: /("password"\s*:\s*)"[^"]*"/gi,                          tag: '$1"[REDACTED]"'},
  { name: 'PASSWORD2',  re: /(password=)[^&\s]+/gi,                                   tag: '$1[REDACTED]'  },
  // E-mail addresses
  { name: 'EMAIL',      re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, tag: '[EMAIL]'     },
  // Turkish mobile numbers (+90 5xx xxx xx xx or 05xx...)
  { name: 'PHONE_TR',   re: /(\+90|0)[\s-]?(5\d{2})[\s\-]?(\d{3})[\s\-]?(\d{2})[\s\-]?(\d{2})\b/g, tag: '[PHONE]' },
  // Generic phone-like (10+ consecutive digits not already matched by TCKN rule)
  // Intentionally placed AFTER TCKN to avoid double-masking
  { name: 'PHONE_GEN',  re: /(?<!\d)\d{10,12}(?!\d)/g,                              tag: '[PHONE]'       },
];

// ── DB'den yuklenen kural seti (cache) ────────────────────────────────────────
let _dbRules = null; // null → DB henuz yuklenmedi (fallback: RULES sabiti)

function compileRule(row) {
  try {
    return { name: row.name, re: new RegExp(row.pattern, row.flags || 'g'), tag: row.replacement };
  } catch (e) {
    console.warn(`[Masker] kural derlenemedi (${row.name}):`, e.message);
    return null;
  }
}

async function reloadMaskRules() {
  const db = require('../db/index.cjs');
  const { rows } = await db.query(
    `SELECT name, pattern, flags, replacement, sort_order FROM logx_mask_rules WHERE enabled = 1 ORDER BY sort_order, id`
  );
  const compiled = rows.map(compileRule).filter(Boolean);
  // Guvenlik: DB'de hic gecerli kural yoksa fallback sabit set kullanilmaya devam eder —
  // maskeleme hicbir kosulda tamamen devre disi kalmaz.
  _dbRules = compiled.length ? compiled : null;
  return compiled.length;
}

async function loadMaskRules() {
  try {
    const n = await reloadMaskRules();
    console.log(`[Masker] ${n} maskeleme kurali DB'den yuklendi.`);
  } catch (e) {
    console.warn("[Masker] kurallar DB'den yuklenemedi, sabit set aktif:", e.message);
  }
}

function activeRules() {
  return _dbRules || RULES;
}

/**
 * Mask a single string.
 * @returns { masked: string, counts: Record<string, number> }
 */
function maskString(input) {
  if (typeof input !== 'string') return { masked: String(input), counts: {} };

  let text = input;
  const counts = {};

  for (const rule of activeRules()) {
    const matches = text.match(rule.re);
    if (matches && matches.length > 0) {
      counts[rule.name] = (counts[rule.name] || 0) + matches.length;
      text = text.replace(rule.re, rule.tag);
    }
  }

  return { masked: text, counts };
}

/**
 * Mask an array of log lines.
 * @param {string[]} lines
 * @returns { maskedLines: string[], totalMasked: number, countsByRule: Record<string, number> }
 */
function maskLines(lines) {
  if (!Array.isArray(lines)) return { maskedLines: [], totalMasked: 0, countsByRule: {} };

  const maskedLines = [];
  const countsByRule = {};
  let totalMasked = 0;

  for (const line of lines) {
    const { masked, counts } = maskString(line);
    maskedLines.push(masked);
    for (const [rule, n] of Object.entries(counts)) {
      countsByRule[rule] = (countsByRule[rule] || 0) + n;
      totalMasked += n;
    }
  }

  return { maskedLines, totalMasked, countsByRule };
}

module.exports = { maskString, maskLines, loadMaskRules, reloadMaskRules };
