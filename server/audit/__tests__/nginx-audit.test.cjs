// server/audit/__tests__/nginx-audit.test.cjs
//
// Denetim > "Nginx Audit" ekraninin hesabini kilitler (bes tablo -> host bazli gorunum).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeAudit } = require('../nginx-audit.cjs');

const host = (h, over = {}) => ({
  host: h,
  status: 'ok',
  files: 7,
  server_blocks: 2,
  locations: 10,
  locations_proxy: 8,
  upstreams: 5,
  ups_no_resolve: 0,
  ups_no_keepalive: 0,
  ups_no_zone: 0,
  unused_upstreams: 0,
  proxy_fqdn: 0,
  proxy_undefined: 0,
  settings_mismatch: 0,
  ...over,
});

test('bes tablo host bazinda birlesir; dosya adi kisaltilir, tam yol korunur', () => {
  const out = summarizeAudit({
    hosts: [host('GBRVPP07')],
    servers: [
      {
        host: 'GBRVPP07',
        conf_file: '/usr/nginx/conf.d/GLOMO-PROD.conf',
        seq: 1,
        listen: '10.0.0.1:444 ssl',
        server_name: 'glomo.x',
        ssl: 1,
        cert_file: '/usr/nginx/ssl/wildcard.x.crt',
        locations: 9,
      },
    ],
    locations: [],
    upstreams: [],
    settings: [],
  });
  const s = out.hosts[0].servers[0];
  assert.equal(s.file, 'GLOMO-PROD.conf');
  assert.equal(s.filePath, '/usr/nginx/conf.d/GLOMO-PROD.conf');
  assert.equal(s.cert, 'wildcard.x.crt');
  assert.equal(s.ssl, true);
  assert.equal(s.locations, 9);
});

test('location ozeti DOSYA bazinda; bulgu olanlar ADIYLA listelenir', () => {
  const L = (file, location, kind, target) => ({
    host: 'GBRVPP07',
    conf_file: file,
    srv_seq: 1,
    location,
    behaviour: kind === 'none' ? 'deny' : 'proxy',
    proxy_target: target,
    target_kind: kind,
  });
  const out = summarizeAudit({
    hosts: [host('GBRVPP07')],
    servers: [],
    locations: [
      L('/c/A.conf', '/a/', 'upstream', 'ups-a'),
      L('/c/A.conf', '/b/', 'fqdn', 'b.apps.fw'),
      L('/c/A.conf', '/c/', 'undefined', 'yok'),
      L('/c/A.conf', '~ /\\.', 'none', ''),
      L('/c/B.conf', '/d/', 'upstream', 'ups-d'),
    ],
    upstreams: [],
    settings: [],
  });
  const files = out.hosts[0].locationsByFile;
  assert.equal(files.length, 2);
  const a = files.find((f) => f.file === 'A.conf');
  assert.equal(a.total, 4);
  assert.equal(a.proxy, 3);
  assert.equal(a.other, 1);
  assert.deepEqual(a.fqdnList, [{ location: '/b/', target: 'b.apps.fw' }]);
  assert.deepEqual(a.undefinedList, [{ location: '/c/', target: 'yok' }]);
  // Cok location'i olan dosya ustte.
  assert.equal(files[0].file, 'A.conf');
});

test('ayarlar: GLOBAL uyumsuzluk bulgu, server/location farki OVERRIDE (sayilir)', () => {
  const S = (ctx, directive, value, ref, matches, file = '/c/x.conf') => ({
    host: 'GBRVPP07',
    conf_file: file,
    context: ctx,
    directive,
    value,
    reference_value: ref,
    matches,
  });
  const out = summarizeAudit({
    hosts: [host('GBRVPP07')],
    servers: [],
    locations: [],
    upstreams: [],
    settings: [
      S('main', 'autoindex', 'off', 'off', 1),
      S('main', 'server_tokens', 'on', 'off', 0), // GLOBAL SAPMA
      S('global', 'charset', '', 'utf-8', 0, ''), // referansta var, sunucuda YOK
      S('location', 'proxy_read_timeout', '60s', '20s', 0),
      S('location', 'proxy_read_timeout', '60s', '20s', 0),
      S('location', 'proxy_read_timeout', '60s', '20s', 0),
      S('server', 'ssl_protocols', 'TLSv1.2', 'TLSv1.2 TLSv1.3', 0),
    ],
  });
  const h = out.hosts[0];
  assert.deepEqual(
    h.settingsMismatched.map((m) => [m.directive, m.missing]),
    [
      ['charset', true],
      ['server_tokens', false],
    ],
  );
  // 3 ayni override -> TEK satir, count=3. Once en cok tekrar eden.
  assert.deepEqual(
    h.settingsOverrides.map((o) => [o.directive, o.value, o.count]),
    [
      ['proxy_read_timeout', '60s', 3],
      ['ssl_protocols', 'TLSv1.2', 1],
    ],
  );
  // STANDART DEGERLER (2026-09-16): TUM global referans direktifleri, uyumlu olanlar dahil,
  // alfabetik; sunucuda hic olmayan null deger + matches=false. Location/server satirlari
  // (yerel override) bu listeye GIRMEZ.
  assert.deepEqual(
    h.settingsAll.map((m) => [m.directive, m.reference, m.value, m.matches]),
    [
      ['autoindex', 'off', 'off', true],
      ['charset', 'utf-8', null, false],
      ['server_tokens', 'off', 'on', false],
    ],
  );
  // Referans listesi sonuc duzeyinde (tum sunucular icin ayni kurulum dosyalari)
  assert.deepEqual(
    out.reference.map((r) => [r.directive, r.value]),
    [['autoindex', 'off'], ['charset', 'utf-8'], ['server_tokens', 'off']],
  );
});

test('siralama: -T dusen en ustte, sonra tanimsiz hedef, sonra global sapma', () => {
  const out = summarizeAudit({
    hosts: [
      host('GBTEMIZ'),
      host('GBSAPMA', { settings_mismatch: 2 }),
      host('GBTANIMSIZ', { proxy_undefined: 1 }),
      host('GBBOZUK', { status: 'fail' }),
    ],
    servers: [],
    locations: [],
    upstreams: [],
    settings: [],
  });
  assert.deepEqual(
    out.hosts.map((h) => h.host),
    ['GBBOZUK', 'GBTANIMSIZ', 'GBSAPMA', 'GBTEMIZ'],
  );
  assert.equal(out.totals.configInvalid, 1);
  assert.equal(out.totals.hostsWithMismatch, 1);
});

test('ortam ve lokasyon sunucu adindan turer', () => {
  const out = summarizeAudit({
    hosts: [host('GBRVPAP03'), host('GBNGXT50')],
    servers: [],
    locations: [],
    upstreams: [],
    settings: [],
  });
  const ap = out.hosts.find((h) => h.host === 'GBRVPAP03');
  assert.equal(ap.env, 'PROD');
  assert.equal(ap.site, 'Ankara');
  const t50 = out.hosts.find((h) => h.host === 'GBNGXT50');
  assert.equal(t50.tier, 'intranet');
});

test('bos girdi cokmez', () => {
  const out = summarizeAudit({ hosts: [], servers: [], locations: [], upstreams: [], settings: [] });
  assert.equal(out.hosts.length, 0);
  assert.equal(out.totals.hosts, 0);
});

// ── Ortam: ad kalibi tutmayan hostlar envanterden (2026-09-14) ──────────────────────
// Kullanici bildirimi: "cogu sunucunun ortam bilgisi BILINMIYOR". Nginx Audit TUM
// filoyu tarar; GBNGX/GBNGW/GBRVP disindaki adlar kaliba uymaz. dbo.Inventory.env
// (Production/Test/QA/Alpha/ODM) devreye girer; kalip tutuyorsa kalip kazanir.
test('ortam: kalip tutmayan host envanterden alir, tutan host kalibi korur', () => {
  const out = summarizeAudit({
    hosts: [host('GBWEBP01'), host('GBWEBT05'), host('GBNGXT51'), host('GBBILINMEZ')],
    servers: [],
    locations: [],
    upstreams: [],
    settings: [],
    inventory: [
      { host: 'gbwebp01', env: 'Production' },
      { host: 'GBWEBT05', env: 'Test' },
      // GBNGXT51: envanter "Test" der ama kalip istisnasi EDU - kalip kazanmali
      { host: 'GBNGXT51', env: 'Test' },
      { host: 'GBBILINMEZ', env: 'Saçma' },
    ],
  });
  const by = Object.fromEntries(out.hosts.map((h) => [h.host, h]));
  assert.equal(by.GBWEBP01.env, 'PROD');
  assert.equal(by.GBWEBP01.envSource, 'inventory');
  assert.equal(by.GBWEBT05.env, 'TEST');
  assert.equal(by.GBNGXT51.env, 'EDU');
  assert.equal(by.GBNGXT51.envSource, 'name');
  // Envanter de bilmiyorsa SESSIZCE atanmaz; kaynak "inventory-unknown" olarak gorunur
  assert.equal(by.GBBILINMEZ.env, 'BILINMIYOR');
  assert.equal(by.GBBILINMEZ.envSource, 'inventory-unknown');
  assert.equal(out.totals.hostsEnvUnknown, 1);
});

// ── Kurulum dosyasi uyumu (Nginx_Audit_Files) ───────────────────────────────────────
test('dosya uyumu: birebir / farkli / eksik ayrisir, ayrinti JSON cozulur, puana girer', () => {
  const F = (host, ref_file, over = {}) => ({
    host,
    ref_file,
    path: '/usr/nginx/conf/' + ref_file,
    file_exists: 1,
    identical: 1,
    n_missing: 0,
    n_changed: 0,
    n_extra: 0,
    details: '[]',
    ...over,
  });
  const out = summarizeAudit({
    hosts: [host('GBRVPP07'), host('GBRVPP08')],
    servers: [],
    locations: [],
    upstreams: [],
    settings: [],
    files: [
      F('GBRVPP07', 'proxy_settings.conf'),
      F('GBRVPP07', 'bmw_defaults.conf', {
        identical: 0,
        n_missing: 1,
        n_changed: 1,
        details: JSON.stringify([
          { kind: 'missing', key: 'main/autoindex', ref: 'off', server: null },
          { kind: 'changed', key: 'main/client_max_body_size', ref: '1m', server: '50m' },
        ]),
      }),
      F('GBRVPP07', 'log_format.conf', { file_exists: 0, identical: 0 }),
      // referans bulunamadi: hukum yok
      F('GBRVPP07', 'mime.types', { identical: null, details: '{"error":"x"}' }),
      F('GBRVPP08', 'bmw_defaults.conf'),
    ],
  });
  const p7 = out.hosts.find((h) => h.host === 'GBRVPP07');
  assert.equal(p7.refFiles.length, 4);
  assert.equal(p7.refFilesDiff, 2, 'bmw_defaults (farkli) + log_format (yok, identical=0)');
  assert.equal(p7.refFilesMissing, 1);
  const bd = p7.refFiles.find((f) => f.refFile === 'bmw_defaults.conf');
  assert.equal(bd.details.length, 2);
  assert.equal(bd.details[1].server, '50m');
  const mt = p7.refFiles.find((f) => f.refFile === 'mime.types');
  assert.equal(mt.identical, null);
  assert.deepEqual(mt.details, [], 'bozuk/obje ayrinti bos listeye duser');
  // Sorunlu sunucu USTTE: dosya farki puana girer
  assert.equal(out.hosts[0].host, 'GBRVPP07');
  assert.equal(out.totals.refFilesDiff, 2);
  assert.equal(out.totals.hostsWithFileDiff, 1);
  // Tablo yokken (files verilmedi) alanlar sifir, cokme yok
  const p8 = out.hosts.find((h) => h.host === 'GBRVPP08');
  assert.equal(p8.refFilesDiff, 0);
});

// ── Istisnalar (2026-09-15, ikinci tur — kullanici karari): istisna YALNIZ "Atlayan" ve
// "Tanimsiz"i sifirlar; "Ayar sapmasi" ve "Dosya farki" gosterilmeye ve sayilmaya devam eder.
test('istisnali sunucu: atlayan/tanimsiz 0 (ham korunur), ayar sapmasi + dosya farki SAYILIR, excepted sayilir', () => {
  const out = summarizeAudit({
    hosts: [
      host('GBISTISNA', { proxy_undefined: 3, proxy_fqdn: 7, settings_mismatch: 5 }),
      host('GBNORMAL', { settings_mismatch: 1 }),
    ],
    servers: [], locations: [], upstreams: [], settings: [],
    exceptions: [{ host: 'gbistisna', note: 'Eski reverse proxy, referans uygulanmaz', created_by: 'odemir', created_at: '2026-09-15T08:00:00Z' }],
  });
  const ex = out.hosts.find((h) => h.host === 'GBISTISNA');
  assert.equal(ex.exception.note, 'Eski reverse proxy, referans uygulanmaz');
  assert.equal(ex.exception.by, 'odemir');
  assert.equal(ex.proxyUndefined, 0, 'istisna: tanimsiz sifirlanir');
  assert.equal(ex.proxyFqdn, 0, 'istisna: atlayan sifirlanir');
  assert.equal(ex.proxyUndefinedRaw, 3, 'ham deger korunur (sunucu sayfasi gosterir)');
  assert.equal(ex.proxyFqdnRaw, 7);
  assert.equal(ex.settingsMismatch, 5, 'ayar sapmasi istisnada da gosterilir');
  assert.equal(ex.issues, 50, 'puan yalniz ayar sapmasindan (5x10); atlayan/tanimsiz girmez');
  assert.equal(out.hosts[0].host, 'GBISTISNA', 'ayar sapmasi buyuk oldugu icin listede onde kalir');
  assert.equal(out.totals.hosts, 2);
  assert.equal(out.totals.excepted, 1);
  assert.equal(out.totals.proxyUndefined, 0, 'istisnalinin tanimsizi toplama girmez');
  assert.equal(out.totals.proxyFqdn, 0);
  assert.equal(out.totals.settingsMismatch, 6, 'ayar sapmasi istisnali dahil sayilir');
  assert.equal(out.totals.hostsWithMismatch, 2);
  assert.equal(out.hosts.find((h) => h.host === 'GBNORMAL').exception, null);
});
