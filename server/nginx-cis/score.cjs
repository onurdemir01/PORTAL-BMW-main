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

const { ITEMS, BY_ID, normVal, sameVal, cmpItemId } = require('./catalog.cjs');

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
  // KURUM REFERANSLARI (2026-09-22): bir madde icin BIRDEN FAZLA kabul edilen deger olabilir
  // (ornek 5.2.2 -> "1m" ve "10m"); olculen deger bunlardan HERHANGI BIRINE esitse gecer.
  const ovr = new Map();
  for (const o of overrides) {
    const k = String(o.item_id);
    if (!ovr.has(k)) ovr.set(k, { values: [], notes: [] });
    ovr.get(k).values.push(String(o.expected ?? ''));
    if (o.note) ovr.get(k).notes.push(o.note);
  }
  const expectedText = (k) => (ovr.has(k) ? ovr.get(k).values.join(' | ') : null);

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
      // ISTISNA HER SEYDEN ONCE (2026-09-22): madde istisnaya alindiysa tarama verisi olmasa da
      // "istisna" gorunur; boylece madde detayinda filo genelinde tek bir durum okunur.
      if (exScope) { status = 'EXCEPTED'; source = exScope === 'host' ? 'istisna (bu sunucu)' : 'istisna (tüm filo)'; }
      else if (!r) { status = 'NODATA'; source = 'tarama yok'; }
      else if (o) { status = o.values.some((v) => sameVal(observed, v)) ? 'PASS' : 'FAIL'; source = o.values.length > 1 ? `kurum referansı (${o.values.length} kabul edilen değer)` : 'kurum referansı'; }
      else { status = U(r.status) || 'NODATA'; source = 'CIS'; }

      // KURUM REFERANSI OLAN MADDE SKORA GIRER (2026-09-22): CIS'te "manuel" (scored:false)
      // isaretli maddeler olculebilir degildi; kurum kendi beklenen degerini tanimladiginda
      // madde OLCULEBILIR hale gelir. Aksi halde referans ekleyen kullanici skorun hic
      // kipirdamadigini goruyor ve "referansin gectigini yazmiyor" diyordu.
      const measurable = item.scored || !!o;
      const counts = measurable && status !== 'EXCEPTED' && status !== 'NA' && status !== 'MANUAL' && status !== 'NODATA';
      if (status === 'EXCEPTED') h.excepted += 1;
      else if (!counts) h.skipped += 1;
      else if (status === 'PASS') h.passed += 1;
      else h.failed += 1;

      h.items.push({
        id: item.id, title: item.title, section: item.section, level: item.level, scored: item.scored,
        rationale: item.rationale || null, check: item.check || null,
        status, source, observed, detail: r ? r.detail || '' : '', measurable,
        expected: o ? expectedText(item.id) : item.expects, expectedSource: o ? 'kurum' : (item.expects ? 'CIS' : null),
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
    // OLCULEN DEGERLER (2026-09-22): "referansi ekledim ama gecmiyor" durumunda kullanici
    // filoda GERCEKTEN hangi degerlerin oldugunu gorsun ve tek tikla referans yapabilsin.
    const obsMap = new Map();
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.status === 'EXCEPTED' || c.status === 'NODATA') continue;
      const v = String(c.observed || '').trim();
      if (!v || v === '-') continue;
      if (!obsMap.has(v)) obsMap.set(v, []);
      obsMap.get(v).push(list[i].host);
    }
    const observedValues = [...obsMap.entries()]
      .map(([value, hs]) => ({ value, count: hs.length, hosts: hs.slice(0, 20) }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, 25);
    return { id: item.id, title: item.title, section: item.section, level: item.level, scored: item.scored, pass, fail, excepted: exc, other, fix: item.fix, observedValues,
      rationale: item.rationale || null, check: item.check || null,
      hosts: cells.map((c, i) => ({ host: list[i].host, status: c.status, observed: c.observed, detail: c.detail, exceptionNote: c.exceptionNote })),
      expected: expectedText(item.id) ?? item.expects, expectedSource: ovr.has(item.id) ? 'kurum' : (item.expects ? 'CIS' : null),
      expectedValues: ovr.has(item.id) ? ovr.get(item.id).values : (item.expects ? [item.expects] : []),
      exception: excGlobal.has(item.id) ? { scope: 'global', note: excGlobal.get(item.id) } : null };
  }).sort((a, b) => cmpItemId(a.id, b.id));

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
