// server/ansible/__tests__/scalex-live-probe.test.cjs
// `state` KESFINDE CANLI REPLICA YOKLAMASI — GERCEK BETIK, SAHTE `oc`.
//
// `discover_state` yalnizca durum ConfigMap'lerini listeliyordu. Portal "ConfigMap
// yok" gordugunde "biri elle geri almis OLABILIR" diye TAHMIN yuruttuyordu; oysa
// uygulama ayakta da olabilir (sorun yok), 0'da da (geri alma bilgisi kayip).
// Ayirt etmek icin canli replica sart.
//
// EN KRITIK KONTROL LP3: yoklama listesi ConfigMap LISTELEMESINI SUZMEMELI. Suzseydi
// cluster'da durdurulmus ama portalda kaydi olmayan uygulamalar (`unknown_to_portal`)
// gorunmez olur ve sapma tespitinin YARISI sessizce kaybolurdu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(ROOT, 'server/ansible/bmw_portal/scalex/scalex_app/files/scalex_runner.sh');

/**
 * `discover_state`i SAHTE bir `oc` ile calistirir ve hem uretilen satirlari hem de
 * `oc` cagri sayisini doner. Betigin tamami oturum acma ister; buraya yalnizca
 * kesif fonksiyonlari ve bagimliliklari `awk` ile cikarilip `eval` edilir —
 * olculen sey GERCEK kod olur, kopyasi degil.
 */
function discoverState({ configMaps = [], workloads = {}, probeApps = [], appRaw = '' }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-lp-'));
  try {
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    const calls = path.join(tmp, 'calls');
    fs.writeFileSync(calls, '');
    // `configMaps`: her satir `ad|app|kind|prev|phase|created_at|created_by|job`
    fs.writeFileSync(path.join(tmp, 'cms'), configMaps.join('\n') + (configMaps.length ? '\n' : ''));
    // `probeApps`: her satir bir uygulama adi. DOSYADAN okunuyor cunku bash cift
    // tirnak icinde `\n` YORUMLAMAZ — liste tek satira yapisip yoklama hic kosmazdi.
    fs.writeFileSync(
      path.join(tmp, 'probe'),
      probeApps.join('\n') + (probeApps.length ? '\n' : ''),
    );
    // `workloads`: { app: 'spec|status|ready' } — yoksa tip bulunamaz.
    fs.writeFileSync(
      path.join(tmp, 'wl'),
      Object.entries(workloads).map(([a, v]) => `${a}\t${v}`).join('\n') + '\n',
    );
    fs.writeFileSync(
      path.join(bin, 'oc'),
      [
        '#!/bin/sh',
        'echo "$@" >> "$OC_CALLS"',
        'case "$*" in',
        '  *"auth can-i"*) echo yes ;;',
        '  *"get cm"*) cat "$OC_CMS" ;;',
        // Tek kaynak sorgusu: uygulama `wl` icinde varsa replica uclusu, yoksa bos.
        // `wl` dosyasi: her satir `app<TAB>spec|status|ready`. Uygulama adi `oc get
        // <res> <app> -n ...` icinde 3. konumda.
        '  *jsonpath*)',
        '    app=$3',
        '    v=$(awk -v a="$app" -F"\t" \'$1==a{print $2}\' "$OC_WL")',
        '    [ -n "$v" ] && printf %s "$v"',
        '    ;;',
        '  *) echo "" ;;',
        'esac',
        'exit 0',
      ].join('\n'),
      { mode: 0o755 },
    );
    const harness = path.join(tmp, 'h.sh');
    fs.writeFileSync(
      harness,
      [
        '#!/bin/bash',
        'NS=ns1; CLUSTER=c1; JUMP_SERVER=j1',
        'STATE_CM_PREFIX="scalex-state-"; STATE_CM_PREFIX_LEGACY="chaos-scale-state-"',
        `APPS_TEXT="${appRaw}"`,
        'LIVE_PROBE_TEXT="$(cat "$OC_PROBE")"',
        "log() { printf '%s;%s;%s;%s;%s;%s;%s\\n' \"$1\" \"$2\" \"$3\" \"$4\" \"$5\" \"$6\" \"$7\"; }",
        'oc_get_jsonpath() { oc get "$1" "$2" -n "$NS" -o "jsonpath=$3" 2>/dev/null || true; }',
        'disc_val() { printf %s "${1:--}" | tr " " "_"; }',
        'kind_to_display() { printf %s "$1"; }',
        // detect_workload: `wl` icinde varsa Deployment say.
        'detect_workload() { if awk -v a="$1" -F"\\t" \'$1==a{f=1} END{exit !f}\' "$OC_WL"; then DETECTED_KIND=Deployment; DETECTED_RESOURCE=deploy; return 0; fi; return 1; }',
        `eval "$(awk '/^disc_app_wanted\\(\\)/,/^}$/' "$1")"`,
        `eval "$(awk '/^RV_DESIRED=0; RV_CURRENT=0; RV_READY=0/,/^}$/' "$1" | head -20)"`,
        `eval "$(awk '/^discover_live_probe\\(\\)/,/^}$/' "$1")"`,
        `eval "$(awk '/^discover_state\\(\\)/,/^}$/' "$1")"`,
        'discover_state',
      ].join('\n'),
      { mode: 0o755 },
    );
    const r = spawnSync('bash', [harness, RUNNER], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        OC_CALLS: calls,
        OC_CMS: path.join(tmp, 'cms'),
        OC_WL: path.join(tmp, 'wl'),
        OC_PROBE: path.join(tmp, 'probe'),
      },
    });
    const ocCalls = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean);
    return { out: r.stdout || '', err: r.stderr || '', ocCalls };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const CM = 'scalex-state-app1|app1|Deployment|2|scaled_down|2026-09-17|uxmid|1';

test('LP1 yoklama listesindeki her uygulama icin bir `LIVE` satiri basiliyor', () => {
  const r = discoverState({
    configMaps: [CM],
    workloads: { app1: '1|1|1', app2: '3|3|2' },
    probeApps: ['app1', 'app2'],
  });
  assert.match(r.out, /app1;Deployment;LIVE;OK;spec=1 status=1 ready=1/, 'app1 LIVE satiri yok');
  assert.match(r.out, /app2;Deployment;LIVE;OK;spec=3 status=3 ready=2/, 'app2 LIVE satiri yok');
});

test('LP2 namespace`te OLMAYAN uygulama `workload_absent` ile raporlaniyor', () => {
  // "Bakamadim" ile "yok" karistirilmamali — ikincisi de bir CEVAP.
  const r = discoverState({ configMaps: [CM], workloads: {}, probeApps: ['silinmis-app'] });
  assert.match(r.out, /silinmis-app;-;LIVE;INFO;workload_absent=yes/, 'yok olan uygulama raporlanmadi');
});

// LP3 — EN KRITIK. Yoklama listesi ConfigMap LISTELEMESINI SUZMEMELI.
test('LP3 yoklama listesi ConfigMap listelemesini SUZMUYOR', () => {
  const r = discoverState({
    configMaps: [CM, 'scalex-state-yabanci|yabanci|Deployment|4|scaled_down|-|baskasi|2'],
    workloads: { app1: '0|0|0' },
    probeApps: ['app1'], // yabanci BU LISTEDE YOK
  });
  assert.match(
    r.out,
    /yabanci;Deployment;STATE;OK/,
    'portalda kaydi olmayan durdurma GORUNMEZ oldu — sapma tespitinin yarisi kayip',
  );
});

test('LP4 yoklama listesi BOSSA hic `LIVE` satiri basilmiyor (ek `oc` maliyeti yok)', () => {
  const r = discoverState({ configMaps: [CM], workloads: { app1: '1|1|1' }, probeApps: [] });
  assert.doesNotMatch(r.out, /;LIVE;/, 'liste bos ama yoklama kosmus');
  // ConfigMap listeleme + `can-i` disinda ek cagri OLMAMALI.
  assert.ok(
    r.ocCalls.filter((c) => c.startsWith('get deploy ')).length === 0,
    `bos listede ${r.ocCalls.length} oc cagrisi yapildi`,
  );
});

test('LP5 yoklama uygulamasi basina TEK `oc get` (replica uclusu tek jsonpath)', () => {
  const r = discoverState({
    configMaps: [], workloads: { app1: '1|1|1', app2: '2|2|2' }, probeApps: ['app1', 'app2'],
  });
  const probe = r.ocCalls.filter((c) => c.startsWith('get deploy '));
  assert.equal(probe.length, 2, `iki uygulama icin ${probe.length} jsonpath cagrisi yapildi`);
});

// LP6 — SOZLESME: portal degiskeni playbook uzerinden betige ULASIYOR mu. Betik
// dogru yazilip degisken hic gecirilmezse yoklama HIC kosmaz ve hicbir sey patlamaz.
test('LP6 `scalex_live_probe_apps` playbook`tan betige gecuriliyor', () => {
  const task = fs.readFileSync(
    path.join(ROOT, 'server/ansible/bmw_portal/scalex/scalex_app/tasks/discovery/10_discover.yml'),
    'utf8',
  );
  assert.match(
    task,
    /SCALEX_LIVE_PROBE_APPS:\s*"\{\{ scalex_live_probe_apps \| default\(''\) \}\}"/,
    'playbook degiskeni betige gecirmiyor — yoklama HIC kosmaz',
  );
  const index = fs.readFileSync(path.join(ROOT, 'server/scalex/index.cjs'), 'utf8');
  assert.match(index, /scalex_live_probe_apps: wanted\.join\(','\)/, 'portal listeyi gondermiyor');
});
