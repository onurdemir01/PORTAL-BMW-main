// server/ansible/__tests__/scalex-awx-package.test.cjs
//
// `server/ansible/scalex_file/` altindaki AWX paketi ile PORTALIN sozlesmesini
// kilitler. Paket AWX'e ELLE kopyalaniyor; uyusmazlik aksi halde ancak URETIMDE,
// "sonuc bulunamadi" ya da "400 variables_needed_to_start" olarak ortaya cikar.
//
// Testlerin cogu DAVRANIS kosturur: gercek `scalex_runner.sh` sahte bir `oc` ile
// calistirilir ve ciktisi portalin GERCEK ayristiricisindan (`result.cjs`) gecirilir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const result = require('../../scalex/result.cjs');

const PKG = path.join(__dirname, '..', 'scalex_file');
const APP = path.join(PKG, 'scalex_app');
const RUNNER = path.join(APP, 'files', 'scalex_runner.sh');
const read = (p) => fs.readFileSync(p, 'utf8');

const LAUNCH = read(path.join(__dirname, '..', '..', 'scalex', 'launch.cjs'));
const SCALEX_INDEX = read(path.join(__dirname, '..', '..', 'scalex', 'index.cjs'));

// ── SURVEY ↔ PORTAL EXTRA_VARS ──────────────────────────────────────────────

function survey(name) {
  return JSON.parse(read(path.join(PKG, 'awx', name)));
}

// Portalin `buildRunExtraVars` ile gonderdigi anahtarlar (H1 bekcisi ayni bloku
// kilitliyor; burada okuyoruz ki iki test birbirinden BAGIMSIZ kalsin).
function portalRunKeys() {
  const i = LAUNCH.indexOf('return {', LAUNCH.indexOf('async function buildRunExtraVars'));
  const block = LAUNCH.slice(i, LAUNCH.indexOf('\n}', i));
  const keys = new Set([...block.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]));
  // Kosullu gonderilenler yayilma (`...`) icinde oldugu icin girintileri farkli.
  for (const m of block.matchAll(/\{\s*([a-z_]+):/g)) keys.add(m[1]);
  return keys;
}

test('S1 HICBIR survey sorusu zorunlu DEGIL (zorunlu soru portalin launch\'ini 400 ile duserir)', () => {
  // AWX, `survey_enabled: true` iken API launch'inda zorunlu survey sorularini
  // dogrular ve eksik olan icin `400 variables_needed_to_start` doner. Uretimdeki
  // eski survey'de 14 sorunun 13'u zorunluydu ve uygulama alani `oc_app` adiyla
  // tanimliydi — portal `oc_app` GONDERMIYOR. Yani o survey aynen acilsaydi
  // portalin HER launch'i reddedilirdi.
  for (const f of ['scalex_run.survey.json', 'scalex_discovery.survey.json']) {
    for (const q of survey(f).spec) {
      assert.equal(q.required, false,
        `${f}: "${q.variable}" zorunlu — portalin API launch'i 400 alir`);
    }
  }
});

test('S2 survey degisken adlari portalin GONDERDIGI adlarla birebir', () => {
  const portal = portalRunKeys();
  const vars = survey('scalex_run.survey.json').spec.map((q) => q.variable);

  // `oc_app` TUZAGI: uretimdeki survey uygulama alanini bu adla tanimliyordu,
  // portal ise `target_app_names` gonderiyor.
  assert.ok(!vars.includes('oc_app'),
    'survey hala `oc_app` kullaniyor — portal `target_app_names` gonderiyor');
  assert.ok(vars.includes('target_app_names'), 'survey `target_app_names` sorusunu tasimali');

  // Survey'deki her degisken portalin gonderdigi bir anahtar olmali; olmayan bir ad
  // elle calistirmada playbook'un okumadigi bir alan yaratirdi.
  const bilinmeyen = vars.filter((v) => !portal.has(v));
  assert.deepEqual(bilinmeyen, [],
    `survey'de portalin gondermedigi degisken(ler) var: ${bilinmeyen.join(', ')}`);
});

test('S3 portalin SKALER anahtarlarinin hepsi survey\'de (elle calistirma bozulmasin)', () => {
  // Dict/list tasiyanlar survey'e KONULAMAZ (AWX survey tipleri skaler); onlar
  // "Prompt on launch > Variables" ile gelir. Gerisi survey'de olmali, yoksa
  // AWX arayuzunden elle calistiran kisi o alani hic giremez.
  const YAPISAL = new Set(['scalex_clusters_override', 'scalex_target_clusters']);
  const vars = new Set(survey('scalex_run.survey.json').spec.map((q) => q.variable));
  const eksik = [...portalRunKeys()].filter((k) => !YAPISAL.has(k) && !vars.has(k));
  assert.deepEqual(eksik.sort(), [],
    `portal gonderiyor ama survey'de yok: ${eksik.join(', ')}`);
});

test('S4 kosullu alanlarin VARSAYILANI YOK (AWX gonderilmeyen alana varsayilan enjekte eder)', () => {
  // `target_replicas`, `hpa_pin`, `mail_cc` portal tarafindan YALNIZCA belirli
  // durumlarda gonderilir. Bir varsayilan tanimlanirsa AWX onu diger tum
  // calistirmalara da enjekte eder: or. `hpa_pin: true` varsayilani, kullanici
  // hic istemedigi halde HER islemde HPA'ya dokunulmasi demek olurdu.
  const spec = Object.fromEntries(survey('scalex_run.survey.json').spec.map((q) => [q.variable, q]));
  for (const v of ['target_replicas', 'hpa_pin', 'mail_cc']) {
    assert.ok(spec[v], `${v} survey'de yok`);
    assert.equal(spec[v].default, '', `${v} varsayilani "${spec[v].default}" — bos olmali`);
  }
});

// KATALOGDAN beslenen alanlar: degerleri `ocp_cluster_index` tablosundan, yani ADMIN
// EKRANINDAN gelir. Bunlar coktan secmeli OLAMAZ — AWX secim uyeligini dogrular ve
// katalogda yeni bir deger tanimlandiginda survey guncellenene kadar portalin HER
// launch'i 400 ile reddedilir. 2026-09-01'de tam olarak bu yasandi: `digital_assets_wyden`,
// `digital_assets_metaco` ve `ark-ai` gercek tenant'lardi ama survey listesinde yoklardi.
const KATALOGDAN_GELEN = ['target_cluster_name', 'target_platform', 'target_environment'];

test('S5 katalogdan beslenen alanlar SERBEST METIN (coktan secmeli liste bayatlar)', () => {
  for (const f of ['scalex_run.survey.json', 'scalex_discovery.survey.json']) {
    for (const v of KATALOGDAN_GELEN) {
      const q = survey(f).spec.find((x) => x.variable === v);
      assert.ok(q, `${f}: ${v} yok`);
      assert.equal(q.type, 'text',
        `${f}: ${v} coktan secmeli — katalogda yeni bir deger tanimlandiginda portal 400 alir`);
    }
  }
});

test('S5b playbook da sabit platform/ortam beyaz listesi TASIMAMALI', () => {
  // Ikinci bir dogruluk kaynagi. Gercek dogrulama katalog uyeligiyle yapilir
  // (02_select_targets.yml); sabit liste yalnizca bayatlar ve isi dusurur.
  for (const f of ['tasks/01_prepare.yml', 'tasks/discovery/01_prepare.yml']) {
    const src = read(path.join(APP, f));
    assert.doesNotMatch(src, /oc_platform in \[/,
      `${f}: sabit platform beyaz listesi geri gelmis`);
    assert.doesNotMatch(src, /oc_environment in \[/,
      `${f}: sabit ortam beyaz listesi geri gelmis`);
    // Bicim kontrolu KALMALI — deger `oc` komut satirina gidiyor.
    assert.match(src, /oc_platform is match/, `${f}: platform bicim kontrolu kaybolmus`);
    assert.match(src, /oc_environment is match/, `${f}: ortam bicim kontrolu kaybolmus`);
  }
  // Katalog uyeligi gercekten dogrulaniyor mu?
  const sel = read(path.join(APP, 'tasks', '02_select_targets.yml'));
  assert.match(sel, /platform \| default\(''\) == oc_platform/, 'katalog platform kontrolu yok');
  assert.match(sel, /oc_environment in \(scalex_clusters\[item\]\.environments/, 'katalog ortam kontrolu yok');
});

test('S7 `integer` survey sorusuna portal STRING gondermemeli', () => {
  // AWX survey tipini DOGRULAR: `integer` bir soruya string gonderildiginde launch
  // `400: Value 2 for 'target_replicas' expected to be an integer.` ile reddedilir —
  // yani `Olcekle` islemi hic calismiyordu (2026-09-01 uretim tespiti).
  const intVars = survey('scalex_run.survey.json').spec
    .filter((q) => q.type === 'integer').map((q) => q.variable);
  assert.ok(intVars.includes('target_replicas'), 'target_replicas artik integer degil — test kendi olctugu seyi kaybetti');

  const i = LAUNCH.indexOf('return {', LAUNCH.indexOf('async function buildRunExtraVars'));
  const block = LAUNCH.slice(i, LAUNCH.indexOf('\n}', i));
  for (const v of intVars) {
    assert.doesNotMatch(block, new RegExp(`${v}:\\s*String\\(`),
      `${v} String() ile gonderiliyor ama survey tipi integer — AWX launch'i 400 ile duserir`);
    assert.match(block, new RegExp(`${v}:\\s*Number\\(`),
      `${v} sayi olarak gonderilmiyor`);
  }
});

test('S6 kesif survey\'i portalin `/discover` anahtarlariyla uyumlu', () => {
  const vars = new Set(survey('scalex_discovery.survey.json').spec.map((q) => q.variable));
  const i = SCALEX_INDEX.indexOf('const extraVars = {');
  const block = SCALEX_INDEX.slice(i, SCALEX_INDEX.indexOf('};', i));
  const YAPISAL = new Set(['scalex_clusters_override', 'scalex_target_clusters']);
  for (const k of [...block.matchAll(/([a-z_]+):/g)].map((m) => m[1])) {
    if (YAPISAL.has(k) || k === 'hosts' || k === 'meta' || k === 'env' || k === 'tenant' || k === 'clusters') continue;
    assert.ok(vars.has(k), `kesif survey'inde eksik: ${k}`);
  }
});

// ── PLAYBOOK ↔ PORTAL ARTIFACT SOZLESMESI ───────────────────────────────────

test('P1 iki playbook da `set_stats` ile SOZLESMEDEKI anahtari yayinliyor', () => {
  const run = read(path.join(APP, 'tasks', '25_publish_result.yml'));
  const disc = read(path.join(APP, 'tasks', 'discovery', '25_publish_result.yml'));
  assert.match(run, /set_stats/, 'mutasyon sonucu set_stats ile yayinlanmiyor');
  assert.match(run, /scalex_result:/, 'anahtar `scalex_result` degil — portal sonucu OKUYAMAZ');
  assert.match(run, /per_host: false/, 'set_stats tek yazardan yayinlanmali');
  assert.match(disc, /scalex_discovery_result:/, 'kesif anahtari `scalex_discovery_result` degil');
  assert.match(disc, /per_host: false/, 'kesif set_stats tek yazardan yayinlanmali');
});

test('P2 portalin OKUDUGU her ust seviye alan yayinlaniyor', () => {
  // `result.cjs` bu alanlari okuyor; biri yayinlanmazsa ekranda sessizce bos/0
  // gorunur — is yesil donse bile kullanici yanlis bilgiye bakar.
  const run = read(path.join(APP, 'tasks', '25_publish_result.yml'));
  for (const f of ['overall_status', 'stage', 'mode', 'action', 'namespace', 'platform',
    'environment', 'catalog_source', 'cluster_mode', 'clusters', 'apps', 'target_replicas',
    'strict_blocked', 'counts', 'targets', 'targets_truncated', 'targets_total',
    'rows', 'rows_truncated', 'rows_total', 'validation_error', 'failed_task', 'job_id']) {
    assert.match(run, new RegExp(`^\\s+${f}:`, 'm'), `scalex_result.${f} yayinlanmiyor`);
  }
  for (const c of ['planned', 'ok', 'warn', 'fail', 'precheck_fail', 'verify_ok',
    'verify_fail', 'blocked', 'hpa_seen']) {
    assert.match(run, new RegExp(`^\\s+${c}:`, 'm'), `scalex_result.counts.${c} yayinlanmiyor`);
  }

  const disc = read(path.join(APP, 'tasks', 'discovery', '25_publish_result.yml'));
  for (const f of ['overall_status', 'mode', 'namespace', 'platform', 'environment',
    'catalog_source', 'clusters', 'failed_clusters', 'counts', 'items']) {
    assert.match(disc, new RegExp(`^\\s+${f}:`, 'm'), `scalex_discovery_result.${f} yayinlanmiyor`);
  }
});

test('P3 girdi dogrulamasi dustugunde de sonuc yayinlaniyor (rescue yolu)', () => {
  // Eskiden `01_prepare.yml`deki bir assert dustugunde playbook `set_stats`a HIC
  // ulasmiyordu ve portal "sonuc bulunamadi" diyordu — kullanici neyin yanlis
  // oldugunu yalnizca AWX arayuzunden ogrenebiliyordu.
  for (const [pb, tasks] of [['main.yml', '26_publish_validation.yml'],
    ['discovery.yml', 'discovery/26_publish_validation.yml']]) {
    const src = read(path.join(APP, pb));
    assert.match(src, /rescue:/, `${pb}: rescue dali yok`);
    assert.match(src, new RegExp(tasks.replace('/', '\\/')), `${pb}: dogrulama yayini cagrilmiyor`);
  }
  const v = read(path.join(APP, 'tasks', '26_publish_validation.yml'));
  assert.match(v, /stage: "validation"/, 'validation asamasi bildirilmiyor');
  assert.match(v, /validation_error:/, 'hata metni yayinlanmiyor');
  assert.match(v, /failed_task:/, 'dusen gorev adi yayinlanmiyor');
});

test('P4 katalogda PORTAL kazaniyor, dosya yedek — ve hangisi oldugu raporlaniyor', () => {
  for (const p of [path.join(APP, 'tasks', '01_prepare.yml'),
    path.join(APP, 'tasks', 'discovery', '01_prepare.yml')]) {
    const src = read(p);
    assert.match(src, /scalex_clusters_override/,
      `${p}: portalin gonderdigi katalog HIC okunmuyor — is her zaman dosyaya duser`);
    assert.match(src, /catalog_source:/,
      `${p}: hangi katalogun kullanildigi raporlanmiyor (portal bunu uyari icin okuyor)`);
  }
});

test('P4b HPA sabitleme TEK kaynaktan okunur ve varsayilani KAPALI', () => {
  // Ayni karar icin iki kaynak (ham `hpa_pin` + normalize `hpa_pin_effective`)
  // tutmak, birinin degisip digerinin sessizce eskimesi demekti.
  const phase = read(path.join(APP, 'tasks', '10_run_phase.yml'));
  assert.match(phase, /HPA_PIN: "\{\{ hpa_pin_effective/,
    'runner ham `hpa_pin` okuyor — 01_prepare.yml\'in normalize ettigi deger kullanilmali');
  const prep = read(path.join(APP, 'tasks', '01_prepare.yml'));
  assert.match(prep, /hpa_pin_effective: "\{\{ hpa_pin \| default\(false\)/,
    'hpa_pin varsayilani KAPALI olmali — HPA\'ya dokunmak bu otomasyonun ilkesinin tersi');

  // Betik tarafi da AYRICA uygular (AWX\'ten elle calistirmada portal yok).
  const runner = read(RUNNER);
  assert.match(runner, /HPA_PIN="\$\{HPA_PIN:-false\}"/, 'betikte varsayilan kapali degil');
  assert.match(runner, /\[ "\$ACTION" != "stop" \] \|\| return 1/,
    '`stop` isleminde HPA sabitleme engellenmiyor');
});

test('P5 durum kaydi yeni onekle yazilir ama ESKI onek OKUNMAYA devam eder', () => {
  const src = read(RUNNER);
  assert.match(src, /STATE_CM_PREFIX="scalex-state-"/, 'yeni onek tanimli degil');
  assert.match(src, /STATE_CM_PREFIX_LEGACY="chaos-scale-state-"/,
    'eski onek okunmuyor — bugun durdurulmus uygulamalar GERI ALINAMAZ hale gelir');
});

// ── DAVRANIS: GERCEK BETIK, SAHTE `oc`, GERCEK AYRISTIRICI ──────────────────

// Betigin kullandigi `oc` alt kumesini taklit eden sahte istemci. Kesif fazi
// hicbir mutasyon yapmadigi icin bu tumuyle guvenli.
const OC_STUB = `#!/bin/bash
case "$1 $2" in "version --client") echo "Client Version: 4.14.0"; exit 0 ;; esac
case "$1" in
  login|project) exit 0 ;;
  auth) echo yes; exit 0 ;;
  get)
    case "$2" in
      hpa) printf 'odeme-api\\n'; exit 0 ;;
      pdb) printf 'odeme-pdb   1   N/A   0   3d\\n'; exit 0 ;;
      deploy|deployment|deployments.apps)
        printf 'odeme-api|3|3|3|registry.gar/odeme:1.4.2|odeme-prod-app|\\n'
        printf 'batch-worker|0|0|0|registry.gar/batch:2.0||argo cd\\n'
        exit 0 ;;
      cm)
        if [ "$3" != "-n" ]; then
          if [ "$3" = "scalex-state-odeme-api" ]; then
            case "\${7:-}" in
              "jsonpath={.data.phase}") echo "scaled_down" ;;
              "jsonpath={.data.previous_replicas}") echo "3" ;;
            esac
            exit 0
          fi
          exit 1
        fi
        printf 'scalex-state-odeme-api|odeme-api|deploy|3|scaled_down|2026-09-01T08:00:00Z|Hakan Isci|31337\\n'
        printf 'chaos-scale-state-batch-worker|||2|scaled_down|2026-08-20T10:00:00Z|onur|29001\\n'
        printf 'alakasiz-cm|||||||\\n'
        exit 0 ;;
      *) exit 1 ;;
    esac ;;
esac
exit 1
`;

// Betikteki API erisilebilirlik kontrolu curl kullaniyor.
const CURL_STUB = '#!/bin/bash\nexit 0\n';

let _stubDir = null;
function stubDir() {
  if (_stubDir) return _stubDir;
  _stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-ocstub-'));
  fs.writeFileSync(path.join(_stubDir, 'oc'), OC_STUB, { mode: 0o755 });
  fs.writeFileSync(path.join(_stubDir, 'curl'), CURL_STUB, { mode: 0o755 });
  return _stubDir;
}

// Betigi calistirip, AWX'in yapacagi gibi satirlari toplar ve
// `discovery/25_publish_result.yml`in yaptigi ayristirmanin AYNISINI uygular.
function runDiscovery(mode, apps = '') {
  const dir = stubDir();
  const out = execFileSync('bash', [RUNNER], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      SCALEX_PHASE: 'discover', DISCOVERY_MODE: mode,
      CLUSTER: 'gbocplab2', JUMP_SERVER: 'gbjump1',
      API_URL: 'https://api.lab:6443', OCP_USERNAME: 'uxmid', OCP_PASSWORD: 'x',
      OCP_OC_PATHS: path.join(dir, 'oc'),
      NS: 'odeme-lab', APP_RAW: apps, ACTION: '', TLS_VERIFY: 'false', JOB_ID: '999',
    },
  });
  const items = out.split('\n')
    .filter((l) => /^[^;]*;[^;]*;[^;]*;[^;]*;[^;]*;[^;]*;.*$/.test(l))
    .map((l) => {
      const p = l.split(';');
      return { cluster: p[0], app: p[2], kind: p[3], step: p[4], status: p[5], detail: p.slice(6).join(';') };
    });
  return items;
}

test('D1 kesif `workloads` ciktisi portalin ayristiricisindan GECIYOR', () => {
  const items = runDiscovery('workloads');
  const parsed = result.extractDiscoveryResult({
    scalex_discovery_result: {
      overall_status: 'ok', mode: 'workloads', namespace: 'odeme-lab',
      platform: 'ark', environment: 'lab', catalog_source: 'portal',
      clusters: ['gbocplab2'], failed_clusters: [], counts: { ok: items.length, warn: 0, fail: 0 },
      items,
    },
  });

  const odeme = parsed.workloads.find((w) => w.name === 'odeme-api');
  assert.ok(odeme, 'odeme-api workload listesine girmedi');
  assert.equal(odeme.kind, 'Deployment');
  assert.equal(odeme.specReplicas, 3);
  assert.equal(odeme.readyReplicas, 3);
  assert.equal(odeme.hasHpa, true, 'HPA rozeti okunamadi');
  assert.equal(odeme.image, 'registry.gar/odeme:1.4.2', 'imaj `:` ve `/` yuzunden bozuldu');
  assert.equal(odeme.gitops, 'argocd:odeme-prod-app', 'ArgoCD rozeti okunamadi');
  assert.equal(odeme.previousReplicas, 3, 'durum kaydindan onceki replica okunamadi');
  assert.equal(odeme.restorable, true, 'geri alinabilirlik yanlis hesaplandi');

  const batch = parsed.workloads.find((w) => w.name === 'batch-worker');
  // Bosluk `_` ile degistirilir: `detail` ayraci bosluk oldugu icin sart.
  assert.equal(batch.gitops, 'managed_by:argo_cd', 'bosluklu etiket degeri temizlenmemis');
  assert.equal(batch.restorable, false, 'durum kaydi olmayan uygulama geri alinabilir gorunuyor');

  // PDB namespace duzeyinde bir UYARI olarak gelmeli.
  assert.ok(parsed.pdbWarning, 'PDB uyarisi portalda gorunmuyor');
  assert.match(parsed.pdbWarning, /PDB_COUNT=1/);
});

test('D2 kesif `state` ciktisi ESKI ONEKLI kaydi da tasiyor', () => {
  const items = runDiscovery('state');
  const parsed = result.extractDiscoveryResult({
    scalex_discovery_result: {
      overall_status: 'ok', mode: 'state', namespace: 'odeme-lab',
      clusters: ['gbocplab2'], failed_clusters: [], counts: {}, items,
    },
  });

  const yeni = parsed.states.find((s) => s.appName === 'odeme-api');
  assert.ok(yeni, 'yeni onekli durum kaydi okunamadi');
  assert.equal(yeni.legacy, false);
  assert.equal(yeni.previousReplicas, 3);
  assert.equal(yeni.createdBy, 'Hakan_Isci', 'bosluklu `created_by` temizlenmemis — detail ayristirmasi bozulur');
  assert.equal(yeni.jobId, '31337');

  // ESKI ONEK: bugun durdurulmus uygulamalar. Gorunmezse GERI ALINAMAZLAR.
  const eski = parsed.states.find((s) => s.appName === 'batch-worker');
  assert.ok(eski, 'eski onekli (chaos-scale-state-) kayit kayboldu — geri alma yolu kapanir');
  assert.equal(eski.legacy, true, 'eski kayit `legacy` rozeti tasimiyor');
  assert.equal(eski.previousReplicas, 2);

  // Onekle ilgisi olmayan ConfigMap'ler listeye SIZMAMALI.
  assert.ok(!parsed.states.some((s) => s.appName === 'alakasiz-cm'),
    'namespace\'teki alakasiz ConfigMap durum kaydi sanildi');
});

test('D3 `detail` degerlerinde BOSLUK yok (ayristirici bosluga gore boluyor)', () => {
  for (const mode of ['workloads', 'state']) {
    for (const it of runDiscovery(mode)) {
      if (!['WORKLOAD', 'STATE'].includes(it.step)) continue;
      for (const part of it.detail.split(' ')) {
        assert.ok(part.includes('='), `${mode}/${it.step}: "${part}" bir anahtar=deger cifti degil`);
        const [, ...rest] = part.split('=');
        assert.ok(rest.join('=').length > 0, `${mode}/${it.step}: bos deger — "-" yazilmali`);
      }
    }
  }
});

test('D4 keşif HICBIR MUTASYON komutu calistirmiyor', () => {
  // Sahte `oc` mutasyon fiillerini REDDEDIYOR olsaydi bile, betigin onlari HIC
  // denememesi gerekir. Kayit tutan bir sahte istemciyle dogruluyoruz.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-ocaudit-'));
  const logFile = path.join(dir, 'calls.log');
  fs.writeFileSync(path.join(dir, 'oc'),
    OC_STUB.replace('case "$1" in\n  login|project)',
      `printf '%s\\n' "$*" >> ${logFile}\ncase "$1" in\n  login|project)`),
    { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'curl'), CURL_STUB, { mode: 0o755 });

  execFileSync('bash', [RUNNER], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${dir}:${process.env.PATH}`,
      SCALEX_PHASE: 'discover', DISCOVERY_MODE: 'workloads',
      CLUSTER: 'c', JUMP_SERVER: 'j', API_URL: 'https://api.lab:6443',
      OCP_USERNAME: 'u', OCP_PASSWORD: 'p', OCP_OC_PATHS: path.join(dir, 'oc'),
      NS: 'odeme-lab', APP_RAW: '', ACTION: '', TLS_VERIFY: 'false', JOB_ID: '1',
    },
  });

  const calls = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n') : [];
  assert.ok(calls.length > 1, 'sahte istemci hic cagrilmadi — test kendi olctugu seyi kaybetti');
  for (const c of calls) {
    assert.ok(!/^(patch|delete|create|apply|scale|replace|edit)\b/.test(c.trim()),
      `kesif MUTASYON komutu calistirdi: ${c}`);
  }
});


test('P6 HPA sayaci yalnizca GERCEKTEN HPA bulunan hedefleri sayar', () => {
  // Onceki hali `;HPA;INFO;` gecen HER satiri sayiyordu; "No HPA found" da INFO.
  // Sonuc: HPA'si OLMAYAN bir uygulamada ekran "1 hedefte HPA goruldu" yaziyordu
  // (2026-09-01 uretim tespiti) — ekran kullaniciya YALAN soyluyordu.
  const rep = read(path.join(APP, 'tasks', '20_build_report.yml'));
  assert.match(rep, /hpa_info_count:[^\n]*HPA_PRESENT/,
    'HPA sayaci ayirt edici belirteci kullanmiyor — "No HPA found" satiri da sayiliyor');

  // Betik gercekten o belirteci basiyor mu? (Sozlesmenin iki ucu.)
  const runner = read(RUNNER);
  assert.match(runner, /"HPA" "INFO" "HPA_PRESENT/, 'betik HPA_PRESENT belirtecini basmiyor');
  assert.match(runner, /"HPA" "INFO" "No HPA found/, 'betikte "HPA yok" satiri kaybolmus');
});

test('P7 bos CC bir ALICI olarak gonderilmez', () => {
  // `cc: ""` verildiginde community.general.mail bos dizgiyi bir alici sanip SMTP'ye
  // yolluyor, sunucu `501 #5.1.1 bad address` donuyor ve modul bunu "en az bir aliciya
  // gonderilemedi" sayarak rescue'ya dusuyor: CC bos olan HER calistirmada RAPOR HIC
  // GITMIYORDU (2026-09-01 uretim tespiti).
  const mail = read(path.join(APP, 'tasks', '30_send_mail.yml'));
  assert.match(mail, /cc:[^\n]*else omit/,
    'bos CC `omit` ile kaldirilmiyor — rapor maili hic gitmez');
});

test('P8 rapor ScaleX kimligini tasiyor (eski "Chaos Scale" kalmamis)', () => {
  for (const f of ['tasks/20_build_report.yml', 'tasks/30_send_mail.yml']) {
    const src = read(path.join(APP, f));
    assert.doesNotMatch(src, /Chaos Scale|CHAOS-SCALE/i, `${f}: eski urun adi duruyor`);
  }
});
