// server/app-hub/__tests__/app-hub.test.cjs - AH1..AH10 (2026-11-08).
//
// Kilitler:
//   * Admin disi hicbir uca ulasamaz (faz 1: Server Hub verisi yalniz Admin'e acik).
//   * JVM env degerleri betikte maskelenir; secretKeyRef / configMapKeyRef degeri okunmaz;
//     JVM disi env (DB_PASSWORD gibi) hic yazilmaz. Portal ikinci kez maskeler.
//   * Betik SALT OKUNUR: oc login + oc get disinda oc alt komutu yok.
//   * Playbook: '#' yorum yok, kimlik gorevleri no_log, set_stats fail'den once.
//   * OLCULEMEDI != YOK: okunamayan kaynak hata alaniyla doner, bos liste gibi degil.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const express = require('express');

const ROOT = path.join(__dirname, '..', '..', '..');
const BETIK = path.join(ROOT, 'server', 'ansible', 'bmw_portal', 'app_hub', 'files', 'app_hub_ocp.sh');
const PLAYBOOK = process.env.APP_HUB_PLAYBOOK || path.join(ROOT, 'server', 'ansible', 'bmw_portal', 'app_hub', 'app_hub_ocp.yml');

function sahte(yol, exp) {
  const m = new Module(yol, null);
  m.loaded = true;
  m.exports = exp;
  require.cache[yol] = m;
}

const bashVar = spawnSync('bash', ['-c', 'command -v awk timeout cut >/dev/null && echo ok'], { encoding: 'utf8' }).stdout.trim() === 'ok';
const ansibleVar = spawnSync('ansible-playbook', ['--version'], { encoding: 'utf8' }).status === 0;

function sahteOcKur() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apphub-oc-'));
  const oc = path.join(dir, 'oc');
  const T = '\t';
  const dep = [
    ['OBJ', 'Deployment', 'musteri-api', '3', '2', '3', '2', 'RollingUpdate', 'musteri-api', '2026-01-01T00:00:00Z'].join(T),
    ['CONT', '-', '-', 'app', 'registry/x:1.2', '500m', '1Gi', '1', '2Gi'].join(T),
    ['ENVRAW', 'app', 'JAVA_OPTS', 'deger', '-Xmx1g -XX:+UseG1GC -Dspring.profiles.active=prod -Ddb.password=gizli1 -Dfoo=bar --token=abc123 -Duser.timezone=Europe/Istanbul'].join(T),
    ['ENVRAW', 'app', 'DB_PASSWORD', 'deger', 'cokgizli'].join(T),
    ['ENVRAW', 'app', 'JAVA_TOOL_OPTIONS', 'ref', 'secret:jto-secret'].join(T),
    ['ENVRAW', 'app', 'OTHER', 'deger', 'x'].join(T),
    'SEL\tapp=musteri-api,',
    '',
  ].join('\n');
  const pods = [
    ['POD', 'musteri-api-1', 'Running', 'worker-01', 'RCRC', '1,2,', '2026-11-08T08:00:00Z'].join(T),
    ['POD', 'musteri-api-2', 'Pending', '-', 'C', '0,', '-'].join(T),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'dep.txt'), dep);
  fs.writeFileSync(path.join(dir, 'pods.txt'), pods);
  fs.writeFileSync(path.join(dir, 'calls.txt'), '');
  fs.writeFileSync(
    oc,
    [
      '#!/bin/bash',
      `D="${dir.replace(/\\/g, '/')}"`,
      'echo "$1 $2" >> "$D/calls.txt"',
      'case "$1" in',
      '  login) : > "$KUBECONFIG"; [ -n "${APP_HUB_FAKE_SLEEP:-}" ] && sleep "$APP_HUB_FAKE_SLEEP"; exit 0 ;;',
      '  get)',
      '    case "$2" in',
      '      deployment) cat "$D/dep.txt" ;;',
      '      rollouts.argoproj.io) echo "error: the server doesn\'t have a resource type \\"rollouts\\"" >&2; exit 1 ;;',
      '      pods) cat "$D/pods.txt" ;;',
      '      *) : ;;',
      '    esac ;;',
      '  *) echo "beklenmeyen: $*" >&2; exit 9 ;;',
      'esac',
      '',
    ].join('\n'),
  );
  fs.chmodSync(oc, 0o755);
  return { dir, oc };
}

function betikKos(env, sureSiniri = false) {
  const { dir, oc } = sahteOcKur();
  const kubeconfig = `/tmp/app-hub-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.kubeconfig`;
  try {
    const betik = BETIK.replace(/\\/g, '/');
    const r = spawnSync(sureSiniri ? 'timeout' : 'bash', sureSiniri ? ['-k', '5', '1', 'bash', betik] : [betik], {
      encoding: 'utf8',
      env: { ...process.env, OC_BIN: oc.replace(/\\/g, '/'), OCP_URL: 'https://api.x:6443', OCP_USER: 'u', OCP_PASS: 'p', NS: 'musteri', APP: 'musteri-api', KUBECONFIG: kubeconfig, ...env },
    });
    assert.equal(fs.existsSync(kubeconfig), false, 'betik kendi kubeconfig dosyasini temizlemedi');
    return { ...r, calls: fs.readFileSync(path.join(dir, 'calls.txt'), 'utf8') };
  } finally {
    fs.rmSync(kubeconfig, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('AH1 betik: JVM env maskelenir, JVM disi env ve referans degeri yazilmaz', { skip: !bashVar && 'bash/awk yok' }, () => {
  const r = betikKos({});
  assert.equal(r.status, 0, r.stderr);
  const satir = r.stdout.split('\n');
  const env = satir.filter((l) => l.startsWith('ENV\t'));
  assert.equal(env.length, 2, `ENV satirlari: ${env.join(' | ')}`);
  const jo = env.find((l) => l.split('\t')[4] === 'JAVA_OPTS');
  assert.ok(jo, 'JAVA_OPTS yok');
  const deger = jo.split('\t').slice(6).join('\t');
  assert.ok(deger.includes('-Xmx1g') && deger.includes('-XX:+UseG1GC'), deger);
  assert.ok(deger.includes('-Dspring.profiles.active=prod'), 'beyaz listedeki deger kapandi');
  assert.ok(deger.includes('-Duser.timezone=Europe/Istanbul'), deger);
  assert.ok(deger.includes('-Ddb.password=***'), 'parola maskelenmedi');
  assert.ok(deger.includes('-Dfoo=***'), 'beyaz liste disi -D acik kaldi');
  for (const sir of ['gizli1', 'abc123', 'cokgizli', 'bar']) assert.ok(!r.stdout.includes(sir), `sir sizdi: ${sir}`);
  const jto = env.find((l) => l.split('\t')[4] === 'JAVA_TOOL_OPTIONS');
  assert.equal(jto.split('\t')[5], 'ref');
  assert.ok(!satir.some((l) => l.includes('DB_PASSWORD')), 'JVM disi env yazildi');
});

test('AH2 betik: tur, pod -> node, rollout CRD yoksa NOTE (hata degil), yalniz login + get', { skip: !bashVar && 'bash/awk yok' }, () => {
  const r = betikKos({});
  assert.match(r.stdout, /^OBJ\tDeployment\tmusteri-api\t3\t2/m);
  assert.match(r.stdout, /^POD\tmusteri-api-1\tRunning\tworker-01\t2\/2\t3\t/m);
  assert.match(r.stdout, /^POD\tmusteri-api-2\tPending\t-\t0\/1\t0\t/m);
  assert.match(r.stdout, /^NOTE\trollouts\.argoproj\.io bu cluster'da tanimli degil/m);
  assert.ok(!/^ERR\t/m.test(r.stdout), r.stdout);
  assert.match(r.stdout, /^END\t1\t2$/m);
  const altKomutlar = new Set(r.calls.trim().split('\n').map((l) => l.split(' ')[0]));
  assert.deepEqual([...altKomutlar].sort(), ['get', 'login'], `salt okunur degil: ${[...altKomutlar]}`);
  assert.ok(!/OCP_PASS|--password=p\b/.test(r.stdout));
});

test('AH3 betik: gecersiz namespace / ad / kubeconfig -> ERR, oc HIC cagrilmaz', { skip: !bashVar && 'bash/awk yok' }, () => {
  for (const env of [{ NS: 'Kotu NS' }, { APP: 'a;rm -rf /' }, { KUBECONFIG: '/etc/passwd' }, { OCP_URL: '' }]) {
    const r = betikKos(env);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /^ERR\t/m);
    assert.equal(r.calls.trim(), '', `oc cagrildi: ${r.calls}`);
  }
});

test('AH3b betik: graceful TERM yolunda kosuya ozel kubeconfig temizlenir', { skip: !bashVar && 'bash/timeout yok' }, () => {
  const r = betikKos({ APP_HUB_FAKE_SLEEP: '2' }, true);
  assert.notEqual(r.status, 0, 'sure siniri betigi durdurmadi');
});

test('AH4 betik kaynagi: oc yalniz login ve get ile cagrilir (metin bekcisi)', () => {
  const s = fs.readFileSync(BETIK, 'utf8');
  const cagrilar = [...s.matchAll(/\bOC\s+([a-z-]+)/g)].map((m) => m[1]);
  assert.ok(cagrilar.length >= 4);
  for (const c of cagrilar) assert.ok(['login', 'get'].includes(c), `yazan oc alt komutu: ${c}`);
  // oc ikilisi YALNIZ OC() sarmalayicisinda calisir; dogrudan "$OC_BIN" cagrisi alt komut bekcisini atlatirdi.
  const dogrudan = s.split('\n').filter((l) => !/^\s*#/.test(l) && l.includes('"$OC_BIN"'));
  assert.equal(dogrudan.length, 1, `OC() disinda oc cagrisi: ${dogrudan.join(' | ')}`);
  assert.match(dogrudan[0], /^OC\(\) \{ timeout /);
});

test('AH5 playbook: # yorum yok, kimlik gorevleri no_log, set_stats fail oncesi, hedef tavani', () => {
  const s = fs.readFileSync(PLAYBOOK, 'utf8');
  assert.ok(!s.split('\n').some((l) => /^\s*#/.test(l)), "playbook'ta # yorum satiri var");
  assert.ok(!s.includes('\\"'), 'Jinja icinde kacisli tirnak');
  const bloklar = s.split(/\n\s*- name: /);
  for (const b of bloklar) {
    if (/resolved_password|OCP_PASS/.test(b) && !/^"Gecici|^"Betik|^"Bastion sonuclari|^"Her hedefin/.test(b)) {
      if (/resolved_password:|OCP_PASS:/.test(b)) assert.match(b, /no_log: true/, `no_log eksik: ${b.slice(0, 60)}`);
    }
  }
  const iStats = s.indexOf('ansible.builtin.set_stats');
  const iFail = s.indexOf('ansible.builtin.fail');
  assert.ok(iStats > 0 && iFail > iStats, 'set_stats fail oncesinde degil');
  assert.match(s, /app_hub_targets \| length <= 20/);
  assert.match(s, /checksum/);
});

test('AH5b playbook: gecici kimlik ve betik normal/rescue yolunda temizlenir, kalinti fail-closed', () => {
  const s = fs.readFileSync(PLAYBOOK, 'utf8');
  const okuma = s.split('- name: "Okuma"')[1]?.split('- name: "Application Hub OCP - sonuclari topla ve yayinla"')[0] || '';
  const always = okuma.split('\n      always:\n');
  assert.equal(always.length, 2, 'temizlik block always sinirinda degil');
  const normal = always[0];
  const temizlik = always[1];
  assert.ok(!normal.includes('Gecici kubeconfig dosyalari silinir'), 'kubeconfig temizligi normal block icinde kaldi');
  assert.match(temizlik, /Gecici kubeconfig dosyalari silinir/);
  assert.match(temizlik, /Betik silinir/);
  assert.match(temizlik, /my_targets \| default\(\[\]\)/, 'erken hata yolunda tanimsiz my_targets korunmuyor');
  assert.match(temizlik, /Gecici kubeconfig temizligi dogrulanir/);
  assert.match(temizlik, /Gecici betik temizligi dogrulanir/);
  assert.match(temizlik, /Gecici dosyalar kaldiysa host basarisiz/);
  assert.match(temizlik, /selectattr\('stat\.exists', 'equalto', true\) \| list \| length == 0/, 'kalinti fail-closed exact denetlenmiyor');
});

test('AH5c playbook: hedef okumasi sonrasi sentetik hata kubeconfig ve betigi birakmaz', { skip: !ansibleVar && 'ansible-playbook yok' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apphub-cleanup-'));
  const appDir = path.join(tmp, 'bmw_portal', 'app_hub');
  const varsDir = path.join(tmp, 'bmw_portal', 'bmw_openshift_jobs', 'global_variables');
  const fixturePlaybook = path.join(appDir, 'app_hub_ocp.yml');
  const fakeOc = path.join(tmp, 'oc');
  const jobId = (process.pid % 100000) * 10000 + (Date.now() % 10000);
  const kubeconfig = `/tmp/app-hub-${jobId}-c1-demo.kubeconfig`;
  const scriptPrefix = `.app_hub_ocp.${jobId}.`;
  try {
    fs.mkdirSync(path.join(appDir, 'files'), { recursive: true });
    fs.mkdirSync(varsDir, { recursive: true });
    fs.copyFileSync(BETIK, path.join(appDir, 'files', 'app_hub_ocp.sh'));
    fs.writeFileSync(path.join(varsDir, 'credentials.yaml'), '---\n');
    fs.writeFileSync(
      fakeOc,
      [
        '#!/bin/bash',
        'if [ "$1" = login ]; then : > "$KUBECONFIG"; exit 0; fi',
        'if [ "$1" = get ]; then exit 0; fi',
        'exit 9',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const marker = '        - name: "Bastion sonuclari"';
    const kaynak = fs.readFileSync(PLAYBOOK, 'utf8');
    assert.ok(kaynak.includes(marker), 'sentetik hata noktasi bulunamadi');
    fs.writeFileSync(
      fixturePlaybook,
      kaynak
        .replace('            prefix: .app_hub_ocp.', `            prefix: ${scriptPrefix}`)
        .replace(
          marker,
          '        - name: "Sentetik kubeconfig kalintisi"\n          ansible.builtin.copy:\n            dest: "' + kubeconfig + '"\n            content: "fixture"\n            mode: "0600"\n\n' +
            '        - name: "Sentetik okuma sonrasi hata"\n          ansible.builtin.fail:\n            msg: "fixture failure"\n\n' + marker,
        ),
    );
    const extra = JSON.stringify({
      terminal_hosts: ['localhost'],
      ocp_clusters: [{ cluster_name: 'c1', terminal_host: 'localhost', api_url: 'https://api.example', username: 'u' }],
      app_hub_targets: [{ cluster: 'c1', namespace: 'demo' }],
      app_hub_app: 'demo',
      oc_binary: fakeOc,
      tower_job_id: jobId,
    });
    const r = spawnSync('ansible-playbook', [fixturePlaybook, '-i', 'localhost,', '--connection=local', '-e', extra], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, `sentetik hata job'u dusurmedi:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /TASK \[Gecici kubeconfig dosyalari silinir\]/);
    assert.match(r.stdout, /TASK \[Betik silinir\]/);
    assert.equal(fs.existsSync(kubeconfig), false, 'kubeconfig sentetik hata sonrasi kaldi');
    const sonrakiBetikler = fs.readdirSync('/var/tmp').filter((x) => x.startsWith(scriptPrefix));
    assert.deepEqual(sonrakiBetikler, [], 'bu fixture gecici betigi sentetik hata sonrasi kaldi');

    const cleanupMarker = '        - name: "Gecici kubeconfig dosyalari silinir"';
    const cleanupStart = fs.readFileSync(fixturePlaybook, 'utf8').split(cleanupMarker);
    assert.equal(cleanupStart.length, 2, 'kubeconfig cleanup mutation noktasi tek degil');
    const cleanupMutation = path.join(appDir, 'app_hub_ocp_cleanup_mutation.yml');
    fs.writeFileSync(
      cleanupMutation,
      cleanupStart[0] + cleanupMarker + cleanupStart[1].replace('            state: absent', '            state: touch'),
    );
    const m = spawnSync('ansible-playbook', [cleanupMutation, '-i', 'localhost,', '--connection=local', '-e', extra], { encoding: 'utf8' });
    assert.notEqual(m.status, 0, 'cleanup no-op mutasyonu job basarisi olmamali');
    assert.match(m.stdout, /Application Hub gecici kimlik veya betik dosyasi temizlenemedi/);
    assert.equal(fs.existsSync(kubeconfig), true, `cleanup mutasyonu gercek kalinti uretmedi:\n${m.stdout}\n${m.stderr}`);
  } finally {
    fs.rmSync(kubeconfig, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const C = require('../canli.cjs');

test('AH6 ayristirici: nesne, container, maskeli env, pod, node, hata ve not', () => {
  const T = '\t';
  const c = C.satirlariCoz([
    ['OBJ', 'Rollout', 'app', '4', '4', '4', '4', '', 'argo-app', '2026-01-01T00:00:00Z'].join(T),
    ['CONT', 'Rollout', 'app', 'main', 'img:1', '1', '2Gi', '<no value>', ''].join(T),
    ['ENV', 'Rollout', 'app', 'main', 'JAVA_OPTS', 'deger', '-Xmx2g -Dsecret.key=sizdi -Dfile.encoding=UTF-8'].join(T),
    ['ENV', 'Rollout', 'app', 'main', 'JAVA_TOOL_OPTIONS', 'ref', 'configmap:jvm'].join(T),
    ['POD', 'app-1', 'Running', 'node-a', '1/1', '0', '2026-11-08T00:00:00Z'].join(T),
    ['POD', 'app-2', 'Running', 'node-a', '1/1', '7', '-'].join(T),
    ['POD', 'app-3', 'Running', 'node-b', '1/1', '0', '-'].join(T),
    ['HPA', 'app-hpa', 'Rollout', '2', '8', '4'].join(T),
    'NOTE\tbir not',
    'ERR\tbir hata',
    'END\t1\t3',
  ]);
  assert.equal(c.nesneler.length, 1);
  const n = c.nesneler[0];
  assert.equal(n.tur, 'Argo Rollout');
  assert.equal(n.istenen, 4);
  assert.equal(n.gitops, 'argo-app');
  assert.equal(n.containerlar[0].limit.cpu, null, '<no value> bos sayilmadi');
  const e = n.containerlar[0].jvmEnv;
  assert.equal(e[0].deger, '-Xmx2g -Dsecret.key=*** -Dfile.encoding=UTF-8', 'Portal ikinci maske katmani calismadi');
  assert.equal(e[1].kaynak, 'referans');
  assert.deepEqual(c.nodelar, [{ ad: 'node-a', pod: 2 }, { ad: 'node-b', pod: 1 }]);
  assert.equal(c.podlar[1].restart, 7);
  assert.equal(c.podlar[1].baslama, null);
  assert.equal(c.hpa[0].max, 8);
  assert.deepEqual(c.notlar, ['bir not']);
  assert.deepEqual(c.hatalar, ['bir hata']);
  assert.equal(c.bitti, true);
  const s = C.sonucuCoz({ overall_status: 'partial', results: [{ cluster: 'c1', namespace: 'n', ok: true, lines: ['END\t0\t0'] }, { cluster: 'c2', namespace: 'n', ok: false, error: 'login dustu', lines: ['ERR\toc login basarisiz'] }] });
  assert.equal(s.hedefler[0].ok, true);
  assert.equal(s.hedefler[1].ok, false);
  assert.match(s.hedefler[1].hata, /login dustu · oc login basarisiz/);
  const yarim = C.sonucuCoz({ results: [{ cluster: 'c', namespace: 'n', ok: true, lines: ['OBJ\tDeployment\tx\t1\t1\t1\t1'] }] });
  assert.equal(yarim.hedefler[0].ok, false, 'END gelmeyen (kesilen) cikti tamam sayildi');
  assert.equal(C.statsOku({ ansible_stats: { data: { app_hub_ocp_result: { a: 1 } } } }).a, 1);
});

// ── Router ve veri birlestirme: sahte TBMWANS / Portal DB / Server Hub ─────────────
const SQL = { NVarChar: () => 'nvarchar' };
const sorgu = { yanit: /** @type {(t?: any, p?: any) => any} */ (() => ({ recordset: [] })) };
sahte(require.resolve('../../inventory/mssql.cjs'), { sql: SQL, query: async (t, p) => sorgu.yanit(t, p) });
sahte(require.resolve('../../db/index.cjs'), { query: async () => ({ rows: [] }) });
sahte(require.resolve('../../config/apps-table.cjs'), { getAppsTable: () => 'MWAppsInventory', getWasAppsTable: () => 'WASAppsInventory' });
const hub = { hosts: [], agir: new Map() };
sahte(require.resolve('../../server-hub/index.cjs'), {
  getAssessment: async () => ({ hosts: hub.hosts, latestScan: '2026-11-08' }),
  loadJvmAgir: async () => hub.agir,
  hostDetail: (h, agir) => ({ jvms: h.jvms.map((j) => ({ ...j, jvmArgs: (agir.get(`${j.gen}|${j.name.toLowerCase()}`) || {}).jvm_args || null })) }),
});
sahte(require.resolve('../../retirement/discover.cjs'), {
  parseAppName: (a) => {
    const m = /^(.*)-([DTQ])$/i.exec(String(a));
    return m ? { base: m[1], env: 'X' } : { base: String(a), env: 'PROD' };
  },
  discover: async () => ({
    targets: [{ host: 'GOJBAP01', appName: 'MUSTERI', env: 'PROD', site: 'Pendik', gen: 8, tier: '3-tier', web: [{ host: 'GOJBWP01', serverName: 'musteri.bank', product: 'RHA', kaynak: 'ajp', trafik: { durum: 'var', req7: 1200 } }] }],
    summary: { trafik: { vhost: 1, var: 1, yok: 0, olculemedi: 0, req7Toplam: 1200, altSinir: false, okunamadi: null } },
  }),
});
sahte(require.resolve('../../auth/index.cjs'), {
  getRequestUser: (req) => (req.session && req.session.user) || null,
  requireAdmin: (req, res, next) => {
    const u = req.session && req.session.user;
    if (!u) return res.status(401).json({ ok: false, error: 'oturum yok' });
    if (u.role !== 'Admin') return res.status(403).json({ ok: false, error: 'admin gerekli' });
    next();
  },
});
sahte(require.resolve('../../auth/visibility.cjs'), { requireVisiblePrefix: () => (_q, _s, n) => n() });
sahte(require.resolve('../../audit/index.cjs'), { auditMutations: () => (_q, _s, n) => n() });

const V = require('../veri.cjs');
const { createRouter, _ic } = require('../index.cjs');

let kimlik = { username: 'onur', role: 'Admin' };
async function istek(method, yol) {
  const app = express();
  app.use((req, _r, n) => {
    req.session = kimlik ? { user: kimlik } : {};
    n();
  });
  app.use('/api/app-hub', createRouter());
  const srv = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/app-hub${yol}`, { method });
    return { status: r.status, body: await r.json() };
  } finally {
    srv.close();
  }
}

test('AH7 Admin disi kullanici aramaya ve ayrintiya ulasamaz', async () => {
  kimlik = { username: 'ayse', role: 'User' };
  for (const y of ['/ara?q=musteri', '/uygulama/jboss/MUSTERI']) {
    const r = await istek('GET', y);
    assert.equal(r.status, 409, `${y}: ${r.status}`);
    assert.equal(r.body.upstreamStatus, 403);
  }
  assert.equal((await istek('POST', '/ocp/x/canli')).body.upstreamStatus, 403);
  kimlik = { username: 'onur', role: 'Admin' };
  assert.equal((await istek('GET', '/uygulama/xyz/A')).status, 400);
  assert.equal((await istek('GET', '/uygulama/jboss/a%3Bdrop')).status, 400);
});

test('AH8 arama: JBoss -D/-T/-Q taban ada toplanir, okunamayan tip ayri soylenir', async () => {
  sorgu.yanit = (t) => {
    if (t.includes('MWAppsInventory')) return { recordset: [{ app: 'MUSTERI', host: 'H1' }, { app: 'MUSTERI-T', host: 'H2' }, { app: 'MUSTERIX', host: 'H3' }] };
    if (t.includes('WASAppsInventory')) throw new Error('WAS tablosu yok');
    return { recordset: [{ app: 'musteri-api', ns: 2, cl: 3 }] };
  };
  const r = await V.ara('musteri');
  const jb = r.sonuclar.filter((s) => s.tip === 'jboss');
  assert.deepEqual(jb.map((s) => s.ad), ['MUSTERI', 'MUSTERIX']);
  assert.deepEqual(jb[0].varyantlar, ['MUSTERI', 'MUSTERI-T']);
  assert.equal(jb[0].ozet, '2 sunucu');
  assert.equal(r.okunamayan.length, 1);
  assert.equal(r.okunamayan[0].tip, 'was');
  assert.ok(r.sonuclar.some((s) => s.tip === 'ocp' && s.ozet.includes('2 namespace')));
});

test('AH9 JBoss birlesik gorunum: surum, heap, JVM (maskeli), web, kapasite MB -> GB', async () => {
  sorgu.yanit = (t) => {
    if (t.includes('FROM dbo.MWAppsInventory')) return { recordset: [{ app: 'MUSTERI', host: 'gojbap01', env: 'Production', jboss_version: 'EAP 8.0', jdk_type: 'OpenJDK', jre_version: '17', min_heap: '1024', max_heap: '4096', app_path: '/vhosting8/x' }] };
    if (t.includes('FROM dbo.Inventory')) return { recordset: [{ host: 'GOJBAP01', cpu: 8, memory: 32768, os: 'RHEL', os_version: '8.10' }] };
    return { recordset: [] };
  };
  hub.hosts = [{ host: 'GOJBAP01', fresh: true, scanDate: '2026-11-08', jvms: [{ name: 'MUSTERI', gen: 8, running: true, runningKnown: true, autoStart: 'true', ports: [8080] }, { name: 'BASKA', gen: 8, running: true }] }];
  hub.agir = new Map([['8|musteri', { jvm_args: '-Xmx4g -Dsifre=*** -Dfile.encoding=UTF-8' }]]);
  const d = await V.jbossDetay('MUSTERI');
  assert.equal(d.sunucular.length, 1);
  const s = d.sunucular[0];
  assert.equal(s.host, 'GOJBAP01');
  assert.equal(s.ortam, 'PROD');
  assert.equal(s.minHeap, '1024 MB');
  assert.equal(s.kapasite.bellekGb, 32);
  assert.equal(s.kapasite.cpu, 8);
  assert.equal(s.jvmler.length, 1, 'baska uygulamanin JVM i karisti');
  assert.equal(s.jvmler[0].jvmArgs, '-Xmx4g -Dsifre=*** -Dfile.encoding=UTF-8');
  assert.equal(d.webSunuculari[0].host, 'GOJBWP01');
  assert.equal(d.webSunuculari[0].istek7g, 1200);
  assert.equal(d.ozet.calisanJvm, 1);
  assert.equal(d.kaynaklar.envanter.hata, null);
  sorgu.yanit = () => ({ recordset: [] });
  assert.equal(await V.jbossDetay('YOKBOYLE'), null, 'olmayan uygulama null donmeli (404)');
  sorgu.yanit = () => {
    throw new Error('TBMWANS ulasilamiyor');
  };
  const okunamadi = await V.jbossDetay('MUSTERI');
  assert.ok(okunamadi && okunamadi.kaynaklar.envanter.hata, 'envanter okunamadi ama "yok" (null) dondu');
});

test('AH10 onbellek: ayni anahtar tek ucus, hata onbellege yazilmaz', async () => {
  let n = 0;
  const uret = () => new Promise((r) => setTimeout(() => r(++n), 20));
  const [a, b] = await Promise.all([_ic.onbellekli('k1', false, uret), _ic.onbellekli('k1', false, uret)]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(await _ic.onbellekli('k1', false, uret), 1);
  assert.equal(await _ic.onbellekli('k1', true, uret), 2, 'fresh onbellegi atlamadi');
  await assert.rejects(_ic.onbellekli('k2', false, () => Promise.reject(new Error('x'))));
  assert.equal(await _ic.onbellekli('k2', false, () => Promise.resolve('tamam')), 'tamam');
});

test('AH11 WAS: was_ozeti sunucular[].jvm okunur; okunamayan durum "parametre yok" sayilmaz; eski tarayici null', () => {
  const oz = {
    sunucular: [
      { profil: 'AppSrv01', dugum: 'n1', ad: 'srv1', jvm: { yol: '/x/server.xml', durum: 'OKUNDU', ilk_heap_mb: 512, en_cok_heap_mb: 2048, jvm_argumanlari: '-Xquickstart -Dapp.ortam=***', sistem_ozellikleri: [{ ad: 'java.security.policy', deger: '/opt/p' }], ozellik_kesildi: false } },
      { ad: 'srv2', jvm: { yol: '/y/server.xml', durum: 'IZIN' } },
      { ad: 'srv3' },
    ],
  };
  const a = V.wasSunucuBilgisi(oz, 'SRV1');
  assert.equal(a.jvmDurumu, 'OKUNDU');
  assert.equal(a.maxHeap, '2048');
  assert.equal(a.jvmArgs, '-Xquickstart -Dapp.ortam=***');
  assert.equal(a.sistemOzellikleri.length, 1);
  const b = V.wasSunucuBilgisi(oz, 'srv2');
  assert.equal(b.jvmDurumu, 'IZIN');
  assert.equal(b.jvmArgs, null);
  assert.equal(b.maxHeap, null);
  assert.equal(V.wasSunucuBilgisi(oz, 'srv3').jvmDurumu, null, 'eski tarayici olculmedi olmali');
  assert.equal(V.wasSunucuBilgisi(oz, 'yok'), null);
});

// AH12 (kullanici, 2026-11-12): "sunucu sekmeleri ya acilmiyor ya kapanmiyor" + "1 calisiyor 1 kapali
// dogru mu nasil anlarim". MWAppsInventory'de ayni host + uygulama icin domain basina satir: TEK
// sunucu satiri, domain'ler listelenir; JVM durumunun kaynagi ve envanterle celiskisi tasinir.
test('AH12 ayni host + uygulama tek satir; JVM durum kaniti tasinir', async () => {
  sorgu.yanit = (t) => {
    if (t.includes('FROM dbo.MWAppsInventory'))
      return {
        recordset: [
          { app: 'MUSTERI', host: 'gojbap01', env: 'Production', domain: 'dom-a', jboss_version: 'EAP 8.0' },
          { app: 'MUSTERI', host: 'gojbap01', env: 'Production', domain: 'dom-b', jboss_version: 'EAP 8.0' },
        ],
      };
    return { recordset: [] };
  };
  hub.hosts = [
    {
      host: 'GOJBAP01',
      fresh: true,
      scanDate: '2026-11-11',
      jvms: [
        { name: 'MUSTERI', gen: 8, running: true, runningKnown: true, runningSrc: 'PS', invStatus: 'running', mismatch: [], domain: 'dom-a' },
        { name: 'MUSTERI', gen: 0, running: false, runningKnown: true, invStatus: 'stopped', mismatch: [], domain: 'dom-b' },
      ],
    },
  ];
  hub.agir = new Map();
  const d = await V.jbossDetay('MUSTERI');
  assert.equal(d.sunucular.length, 1, 'ayni host + uygulama iki satir oldu (ekranda ayni anahtar)');
  assert.deepEqual(d.sunucular[0].domainler, ['dom-a', 'dom-b']);
  const [a, b] = d.sunucular[0].jvmler;
  assert.equal(a.durumKaynagi, 'PS');
  assert.equal(a.envanterDurumu, 'running');
  assert.equal(b.durumKaynagi, 'ENVANTER', 'taramada gorulmeyen JVM envanterden geldigini soylemiyor');
  assert.equal(b.calisiyor, false);
});
