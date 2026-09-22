// server/nginx-cis/score.cjs — CIS skorlamasi (SAF, test edilir).
//
// Girdi: tarayici sonuclari (host, item_id, status, observed), istisnalar, kurum referanslari.
// Cikti: her sunucu icin madde madde KARAR + skor; madde bazinda filo ozeti.
//
// KARAR SIRASI (kullanici istegi):
//   1) istisna (global ya da o sunucuya ozel)   -> "excepted": skora GIRMEZ (payda disi)
//   2) kurum referansi (override.expected)      -> olculen deger referansa esitse PASS, degilse FAIL
//   3) tarayici karari (PASS/FAIL/NA/MANUAL)    -> NA ve MANUAL skora girmez
// Skor = gecen / (gecen + kalan) * 100, yalniz "scored" ve skora giren maddeler uzerinden.
'use strict';

const { ITEMS, BY_ID, normVal } = require('./catalog.cjs');

const U = (s) => String(s || '').trim().toUpperCase();

/**
 * results: [{host, item_id, status, observed, detail}]
 * hosts:   [{host, nginx_version, t_state, msg, scan_date}]
 * exceptions: [{item_id, host|null, note}]   host null = tum filo
 * overrides:  [{item_id, expected, note}]
 */
function scoreAll({ results = [], hosts = [], exceptions = [], overrides = [] } = {}) {
  const excGlobal = new Map();
  const excHost = new Map(); // HOST|item -> note
  for (const e of exceptions) {
    if (e.host) excHost.set(`${U(e.host)}|${e.item_id}`, e.note || '');
    else excGlobal.set(String(e.item_id), e.note || '');
  }
  const ovr = new Map(overrides.map((o) => [String(o.item_id), { expected: String(o.expected ?? ''), note: o.note || '' }]));

  const byHost = new Map();
  for (const h of hosts) {
    byHost.set(U(h.host), {
      host: U(h.host), nginxVersion: h.nginx_version || null, tState: h.t_state || null, msg: h.msg || null,
      scanDate: h.scan_date ? String(h.scan_date).slice(0, 10) : null, items: [], score: null, passed: 0, failed: 0, excepted: 0, skipped: 0,
    });
  }
  const resByHost = new Map();
  for (const r of results) {
    const H = U(r.host);
    if (!resByHost.has(H)) resByHost.set(H, new Map());
    resByHost.get(H).set(String(r.item_id), r);
  }
  for (const H of resByHost.keys()) if (!byHost.has(H)) byHost.set(H, { host: H, nginxVersion: null, tState: null, msg: null, scanDate: null, items: [], score: null, passed: 0, failed: 0, excepted: 0, skipped: 0 });

  for (const h of byHost.values()) {
    const rs = resByHost.get(h.host) || new Map();
    for (const item of ITEMS) {
      const r = rs.get(item.id);
      const exNote = excHost.has(`${h.host}|${item.id}`) ? excHost.get(`${h.host}|${item.id}`) : (excGlobal.has(item.id) ? excGlobal.get(item.id) : null);
      const exScope = excHost.has(`${h.host}|${item.id}`) ? 'host' : (excGlobal.has(item.id) ? 'global' : null);
      const o = ovr.get(item.id) || null;
      const observed = r ? (r.observed == null ? '' : String(r.observed)) : '';
      let status; let source;
      if (!r) { status = 'NODATA'; source = 'tarama yok'; }
      else if (exScope) { status = 'EXCEPTED'; source = exScope === 'host' ? 'istisna (bu sunucu)' : 'istisna (tüm filo)'; }
      else if (o) { status = normVal(observed) === normVal(o.expected) ? 'PASS' : 'FAIL'; source = 'kurum referansı'; }
      else { status = U(r.status) || 'NODATA'; source = 'CIS'; }

      const counts = item.scored && status !== 'EXCEPTED' && status !== 'NA' && status !== 'MANUAL' && status !== 'NODATA';
      if (status === 'EXCEPTED') h.excepted += 1;
      else if (!counts) h.skipped += 1;
      else if (status === 'PASS') h.passed += 1;
      else h.failed += 1;

      h.items.push({
        id: item.id, title: item.title, section: item.section, level: item.level, scored: item.scored,
        status, source, observed, detail: r ? r.detail || '' : '',
        expected: o ? o.expected : item.expects, expectedSource: o ? 'kurum' : (item.expects ? 'CIS' : null),
        exceptionNote: exNote, counts, fix: item.fix,
      });
    }
    const tot = h.passed + h.failed;
    h.score = tot > 0 ? Math.round((h.passed / tot) * 100) : null;
  }

  const list = [...byHost.values()].sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || a.host.localeCompare(b.host));
  // madde bazinda filo ozeti: kac sunucuda gecti/kaldi/istisna
  const perItem = ITEMS.map((item) => {
    const cells = list.map((h) => h.items.find((x) => x.id === item.id)).filter(Boolean);
    const pass = cells.filter((c) => c.status === 'PASS').length;
    const fail = cells.filter((c) => c.status === 'FAIL').length;
    const exc = cells.filter((c) => c.status === 'EXCEPTED').length;
    const other = cells.length - pass - fail - exc;
    return { id: item.id, title: item.title, section: item.section, level: item.level, scored: item.scored, pass, fail, excepted: exc, other, fix: item.fix,
      expected: (ovr.get(item.id) || {}).expected ?? item.expects, expectedSource: ovr.has(item.id) ? 'kurum' : (item.expects ? 'CIS' : null),
      exception: excGlobal.has(item.id) ? { scope: 'global', note: excGlobal.get(item.id) } : null };
  }).sort((a, b) => b.fail - a.fail || a.id.localeCompare(b.id));

  const scored = list.filter((h) => h.score != null);
  const summary = {
    hosts: list.length,
    scanDate: list.reduce((a, h) => (h.scanDate && (!a || h.scanDate > a) ? h.scanDate : a), null),
    avgScore: scored.length ? Math.round(scored.reduce((a, h) => a + h.score, 0) / scored.length) : null,
    under80: scored.filter((h) => h.score < 80).length,
    perfect: scored.filter((h) => h.score === 100).length,
    failCells: list.reduce((a, h) => a + h.failed, 0),
    exceptedCells: list.reduce((a, h) => a + h.excepted, 0),
    items: ITEMS.length,
    tFail: list.filter((h) => h.tState === 'fail').length,
  };
  return { hosts: list, perItem, summary };
}

module.exports = { scoreAll };
