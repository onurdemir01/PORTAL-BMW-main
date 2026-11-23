// server/app-hub/__tests__/app-hub-filo.test.js - Application Hub saatlik filo taramasi (2026-11-18).
//
// Kilitler:
//   AF1  betik (-A yolu): tek login + yalniz `oc get`; JVM env maskeli, JVM disi env yok; CRD yoksa NOTE; END; kubeconfig silinir
//   AF2  betik: -A yasaksa namespace basina geri duser; sistem namespace'i atlanir; okunamayan namespace NSFAIL
//   AF3  betik: login hatasi ERR + rc != 0, END kaydi YOK (Portal "tamamlanmadi" der, satir silmez)
//   AF4  betik kaynagi: oc yalniz login/get; "$OC_BIN" yalniz OC() sarmalayicisinda; maske desenleri iki betikte birebir
//        ve awk'a -v ile DEGIL ENVIRON ile gider (-v `java\.` kacisini yutup beyaz listeyi gevsetiyordu)
//   AF5  playbook: # yok, \" yok, parola gorevleri no_log, ciktiyi yazan gorev no_log, set_stats fail oncesi, temizlik always'ta
//        fail-closed, gorev adlari Ingilizce (Turkce harf yok), paths.cjs'te kayitli
//   AF6  ayristirici: pod sahibi (Deployment / Rollout hash, DC, StatefulSet), Job pod'u uygulama sayilmaz, HPA baglanir,
//        pod sayisi tum pod'lardan, okunamayan namespace'te pod sayisi null (0 DEGIL), ikinci maske katmani
//   AF7  dosya: gecerli / bitis isareti yok / bozuk icerik ayrimi
//   AF8  DB farki: yeni eklenir, degismeyenin yalniz zamani, degisen guncellenir, gorulmeyen silinir; okunamayan namespace /
//        tur kapsaminda SILINMEZ
//   AF9  birlestirme: (cluster, namespace) basina daha yeni okuma kazanir, kaynak etiketi dogru
//   AF10 zamanlayici: dilim anahtari / aralik siniri; sablon yoksa kosu acilmaz; CAS bos donerse AWX cagrilmaz; basarida
//        fan-out + run/dizin/yazici gider; baslatma hatasi HATA yazar
//   AF11 alim: biten is -> ALINIYOR kilidi -> /sw dosyasi -> onbellek -> BITTI; baska kosunun sonucu HATA
//   AF12 canli.cjs: "<no value><no value>" bos sayilir
//   AF13 review (2026-11-18): bitmis / deployer pod sayilmaz; buyuk govde satiri SILMEZ; basarisiz yeni okuma gecerliyi
//        gizlemez; tarama zamani (AWX baslangici) yazilir; takilan / okunamayan is tavanda kapanir, iptal edilir,
//        is gecmisi kapanir; alim tavani; kayit anahtari playbook korumasi
//   AF14 canli okuma pod ozeti: pod listesi okunamadiysa sayi yok; 200 ustunde gercek toplam END'den
//   AF15 betik: tarama butcesi (slot SONRASI baslar) bitince kalan turler KINDFAIL, satir silinmez
//   AF16 kosu dizini: sondaki egik cizgiler dongu ile atilir (regex geri izlemesi yok, Sonar S8786)
//   AF17 betik slot dizini (2026-11-22, PR-R): yok / symlink / baskasina yazilabilir dizin REDDEDILIR (tahmin edilebilir
//        /tmp yolunda baska yerel kullanici slot.N -> <kurban dosya> koyup `exec 9>` ile sifirlatabiliyordu); flock
//        varken symlink slot dosyasi acilmaz (hedef bozulmaz)
//   AF17c betik parola dosyasi: okunur ve HEMEN silinir; kosu dizini disinda / symlink / baska yol reddedilir (login yok)
//   AF18 alim: giris kapisi dusunce (results bos + error) kosu HATA'si sebebi tasir ("sonuc yayinlanmadi" degil)
//   AF19 alim: bastionda gecici dosya kaldiysa (cleanup_errors) kosu BITTI ama hata alaninda gorunur
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const DIZIN = path.join(ROOT, 'server', 'ansible', 'playbooks', 'bmw_portal', 'app_hub');
const BETIK = path.join(DIZIN, 'files', 'app_hub_fleet.sh');
const TEK_BETIK = path.join(DIZIN, 'files', 'app_hub_ocp.sh');
const PLAYBOOK = path.join(DIZIN, 'app_hub_fleet.yml');
const T = '\t';

function sahte(yol, exp) {
  const m = new Module(yol, null);
  m.loaded = true;
  m.exports = exp;
  require.cache[yol] = m;
}

const bashVar =
  spawnSync('bash', ['-c', 'command -v awk timeout gzip base64 xargs >/dev/null && echo ok'], {
    encoding: 'utf8',
  }).stdout.trim() === 'ok';
const ux = (p) => p.replace(/\\/g, '/');

function sahteOcKur({ yasak = false, loginHata = false, bozukNs = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apphub-filo-oc-'));
  const oc = path.join(dir, 'oc');
  const obj = (ns) =>
    [
      [
        'OBJ',
        ns,
        'Deployment',
        'api',
        '3',
        '3',
        '3',
        '3',
        'RollingUpdate',
        '',
        '2026-01-01T00:00:00Z',
      ].join(T),
      ['CONT', ns, 'Deployment', 'api', 'app', 'reg/x:1', '500m', '1Gi', '1', '2Gi'].join(T),
      [
        'ENVRAW',
        ns,
        'Deployment',
        'api',
        'app',
        'JAVA_OPTS',
        'deger',
        '-Xmx1g -Ddb.password=gizli1 -Djavahost=gizli2 -Duser.timezone=UTC',
      ].join(T),
      ['ENVRAW', ns, 'Deployment', 'api', 'app', 'DB_PASSWORD', 'deger', 'cokgizli'].join(T),
      ['ENVRAW', ns, 'Deployment', 'api', 'app', 'JAVA_TOOL_OPTIONS', 'ref', 'secret:jto'].join(T),
      '',
    ].join('\n');
  fs.writeFileSync(
    path.join(dir, 'obj-musteri.txt'),
    obj('musteri') +
      ['OBJ', 'openshift-x', 'Deployment', 'sys', '1', '1', '1', '1', '', '', 'x'].join(T) +
      '\n',
  );
  fs.writeFileSync(path.join(dir, 'obj-odeme.txt'), obj('odeme'));
  fs.writeFileSync(
    path.join(dir, 'pods.txt'),
    [
      'PODRAW',
      'musteri',
      'ReplicaSet',
      'api-5d4f',
      '5d4f',
      '-',
      '-',
      'api-5d4f-abc',
      'Running',
      'w1',
      'RCRC',
      '1,2,',
      '2026-11-08T08:00:00Z',
    ].join(T) + '\n',
  );
  fs.writeFileSync(path.join(dir, 'calls.txt'), '');
  fs.writeFileSync(
    oc,
    [
      '#!/bin/bash',
      `D="${ux(dir)}"`,
      'echo "$1 $2 $3 $4" >> "$D/calls.txt"',
      'case "$1" in',
      `  login) printf '%s' "$KUBECONFIG" > "$D/kubeconfig-yolu"; : > "$KUBECONFIG"; ${loginHata ? 'echo "Login failed (401 Unauthorized)" >&2; exit 1' : 'exit 0'} ;;`,
      '  get)',
      '    case "$2" in',
      `      deployment) if [ "$3" = "-A" ]; then ${yasak ? 'echo "Error from server (Forbidden)" >&2; exit 1' : 'cat "$D/obj-musteri.txt"'}; else [ "$4" = "${bozukNs}" ] && { echo boom >&2; exit 1; }; cat "$D/obj-$4.txt" 2>/dev/null; fi ;;`,
      '      rollouts.argoproj.io) echo "error: the server doesn\'t have a resource type \\"rollouts\\"" >&2; exit 1 ;;',
      '      pods) cat "$D/pods.txt" ;;',
      '      projects) printf "musteri\\nodeme\\nopenshift-monitoring\\n" ;;',
      '      *) : ;;',
      '    esac ;;',
      '  *) echo "beklenmeyen: $*" >&2; exit 9 ;;',
      'esac',
      '',
    ].join('\n'),
  );
  fs.chmodSync(oc, 0o700);
  return { dir, oc };
}

// Parola STDIN'den gelir (2026-11-22: Ansible `environment:` uzak komut satirina ve -vvv ciktisina yaziyordu);
// KUBECONFIG betigin kendi 0700 is dizinindedir (/tmp/app-hub-fleet-w.<is>.XXXXXXXX), cagiranin verdigi yol yok sayilir.
function betikKos(secenek = {}, ekEnv = {}) {
  const { dir, oc } = sahteOcKur(secenek);
  const is = `af${process.pid}`;
  const tuzak = `/tmp/app-hub-fleet-test-${process.pid}-${Math.random().toString(16).slice(2)}.kubeconfig`;
  try {
    const r = spawnSync('bash', [ux(BETIK)], {
      encoding: 'utf8',
      input: 'parola-x\n',
      env: {
        ...process.env,
        OC_BIN: ux(oc),
        OCP_URL: 'https://api.x:6443',
        OCP_USER: 'u',
        CLUSTER: 'c1',
        FLEET_JOB: is,
        KUBECONFIG: tuzak,
        ...ekEnv,
      },
    });
    assert.equal(fs.existsSync(tuzak), false, 'cagiranin KUBECONFIG yolu kullanildi');
    const yolDosyasi = path.join(dir, 'kubeconfig-yolu');
    const kubeconfig = fs.existsSync(yolDosyasi) ? fs.readFileSync(yolDosyasi, 'utf8') : null;
    if (kubeconfig != null) {
      assert.match(
        kubeconfig,
        new RegExp(`^/tmp/app-hub-fleet-w\\.${is}\\.[A-Za-z0-9]+/kubeconfig$`),
        'kubeconfig betigin ozel is dizininde degil',
      );
      assert.equal(
        fs.existsSync(path.dirname(kubeconfig)),
        false,
        'is dizini (kubeconfig) silinmedi',
      );
    }
    const satirlar = r.stdout.split('\n');
    const i = satirlar.indexOf('@@APPHUB_FLEET_BEGIN@@');
    const kayit =
      i >= 0 ? zlib.gunzipSync(Buffer.from(satirlar[i + 1], 'base64')).toString('utf8') : '';
    return { ...r, kayit, kubeconfig, calls: fs.readFileSync(path.join(dir, 'calls.txt'), 'utf8') };
  } finally {
    fs.rmSync(tuzak, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test(
  'AF1 betik -A yolu: tek login, yalniz get, maske, CRD yoksa NOTE, END',
  { skip: !bashVar && 'bash/awk/gzip yok' },
  () => {
    const r = betikKos();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^APPHUB_FLEET_SUMMARY\t1\t1\t0\t\d+$/m);
    assert.match(r.kayit, /^OBJ\tmusteri\tDeployment\tapi\t3\t3/m);
    assert.ok(!/openshift-x/.test(r.kayit), 'sistem namespace atlanmadi');
    const env = r.kayit.split('\n').filter((l) => l.startsWith('ENV\t'));
    assert.equal(env.length, 2, env.join(' | '));
    const jo = env.find((l) => l.split('\t')[5] === 'JAVA_OPTS');
    assert.match(jo, /-Xmx1g -Ddb\.password=\*\*\* -Djavahost=\*\*\* -Duser\.timezone=UTC$/);
    assert.equal(env.find((l) => l.split('\t')[5] === 'JAVA_TOOL_OPTIONS').split('\t')[6], 'ref');
    for (const sir of ['gizli1', 'gizli2', 'cokgizli', 'parola-x'])
      assert.ok(!r.stdout.includes(sir) && !r.kayit.includes(sir), `sir sizdi: ${sir}`);
    assert.match(
      r.kayit,
      /^POD\tmusteri\tReplicaSet\tapi-5d4f\t5d4f\t-\t-\tapi-5d4f-abc\tRunning\tw1\t2\/2\t3\t/m,
    );
    assert.match(r.kayit, /^NOTE\trollouts\.argoproj\.io is not defined on this cluster$/m);
    assert.ok(!/^(ERR|KINDFAIL)\t/m.test(r.kayit), r.kayit);
    assert.match(r.kayit, /^END\t1\t1$/m);
    const alt = new Set(
      r.calls
        .trim()
        .split('\n')
        .map((l) => l.split(' ')[0]),
    );
    assert.deepEqual([...alt].sort(), ['get', 'login']);
    assert.equal(
      r.calls.split('\n').filter((l) => l.startsWith('login')).length,
      1,
      'cluster basina tek login degil',
    );
    assert.match(
      r.calls,
      /^login --server=https:\/\/api\.x:6443 --username=u --password=parola-x$/m,
    );
    assert.ok(r.kubeconfig, 'oc login KUBECONFIG gormedi');
  },
);

test(
  'AF2 betik: -A yasaksa namespace basina; sistem ns atlanir; okunamayan ns NSFAIL',
  { skip: !bashVar && 'bash/awk/gzip yok' },
  () => {
    const r = betikKos({ yasak: true, bozukNs: 'odeme' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.kayit, /^OBJ\tmusteri\tDeployment\tapi/m);
    assert.match(r.kayit, /^NSFAIL\tdeployment\todeme$/m);
    assert.ok(!/deployment -n openshift-monitoring/.test(r.calls), 'sistem namespace okundu');
    assert.ok(/get deployment -n musteri/.test(r.calls), r.calls);
    assert.match(r.kayit, /^END\t1\t1$/m);
  },
);

test(
  'AF3 betik: login hatasi ERR, rc != 0, END kaydi yok',
  { skip: !bashVar && 'bash/awk/gzip yok' },
  () => {
    const r = betikKos({ loginHata: true });
    assert.notEqual(r.status, 0);
    assert.match(r.kayit, /^ERR\toc login failed: Login failed/m);
    assert.ok(!/^END\t/m.test(r.kayit), 'login hatasinda END yazildi');
    assert.ok(!r.calls.includes('get '), 'login hatasindan sonra get cagrildi');
  },
);

test('AF4 betik kaynagi: yalniz login/get, tek OC() sarmalayicisi, maske desenleri birebir ve ENVIRON ile', () => {
  const s = fs.readFileSync(BETIK, 'utf8');
  const tek = fs.readFileSync(TEK_BETIK, 'utf8');
  const cagrilar = [...s.matchAll(/\bOC\s+([a-z-]+)/g)].map((m) => m[1]);
  assert.ok(cagrilar.length >= 4);
  for (const c of cagrilar) assert.ok(['login', 'get'].includes(c), `yazan oc alt komutu: ${c}`);
  const dogrudan = s.split('\n').filter((l) => !/^\s*#/.test(l) && l.includes('"$OC_BIN"'));
  assert.equal(dogrudan.length, 1, dogrudan.join(' | '));
  assert.match(dogrudan[0], /^OC\(\) \{ timeout /);
  for (const ad of ['SAFE_PREFIX', 'SECRET_RE', 'JVM_ENV_RE']) {
    const satir = (m) => m.split('\n').find((l) => l.startsWith(`${ad}=`));
    assert.ok(satir(s), `${ad} yok`);
    assert.equal(satir(s), satir(tek), `${ad} iki betikte farkli`);
  }
  for (const m of [s, tek]) {
    assert.ok(
      !/awk[^\n]*-v (safe|sec|jvm)=/.test(m),
      'maske deseni awk -v ile gidiyor (kacis yutulur)',
    );
    assert.match(m, /ENVIRON\["MASK_SAFE"\]/);
  }
  assert.ok(!s.split('\n').some((l) => /[\r]/.test(l)), 'CRLF');
});

test('AF5 playbook: yorum yok, no_log, set_stats fail oncesi, always temizligi, Ingilizce adlar, kayitli', () => {
  const s = fs.readFileSync(PLAYBOOK, 'utf8');
  assert.ok(!s.split('\n').some((l) => /^\s*#/.test(l)), '# yorum satiri var');
  assert.ok(!s.includes('\\"'), 'Jinja icinde kacisli tirnak');
  assert.ok(!s.includes('\r'), 'CRLF');
  const bloklar = s.split(/\n\s*- name: /);
  for (const b of bloklar) {
    if (/resolved_password:|OCP_PASS:/.test(b))
      assert.match(b, /no_log: true/, `no_log eksik: ${b.slice(0, 60)}`);
  }
  const yaz = bloklar.find((b) => b.startsWith('"Write each scan to the shared directory"'));
  assert.ok(yaz && /no_log: true/.test(yaz), 'tarama ciktisini yazan gorev no_log degil');
  // Sonuc dongusunun her ogesi async_status sonucunu (tum tarama yuku) tasir: no_log yoksa AWX olaylarina gider.
  const sonuc = bloklar.find((b) => b.startsWith('"Results of this bastion"'));
  assert.ok(
    sonuc && /no_log: true/.test(sonuc),
    'tarama sonucunu dolasan gorev no_log degil (yuk AWX olayina gider)',
  );
  assert.ok(
    /async_status:[\s\S]{0,200}mode: cleanup/.test(s),
    'poll:0 async dosyalari bastionda birikiyor',
  );
  // Play duzeyinde connection: local, delegate_to'yu da yerel kostururdu (/sw dizini AWX konteynerinde acilirdi).
  const ilkPlay = s.split('\n- name: ')[1] || '';
  assert.match(ilkPlay, /Create the output directory on the writer host/, 'ilk play bulunamadi');
  assert.ok(
    !/^\s*connection: local/m.test(ilkPlay),
    'yazici sunucuya delege edilen play connection: local',
  );
  const iStats = s.indexOf('ansible.builtin.set_stats');
  const iFail = s.lastIndexOf('ansible.builtin.fail:');
  assert.ok(iStats > 0 && iFail > iStats, 'set_stats fail oncesinde degil');
  const tarama = s
    .split('- name: "Scan"')[1]
    .split('- name: "Application Hub fleet - collect and publish"')[0];
  const always = tarama.split('\n      always:\n');
  assert.equal(always.length, 2, 'temizlik always sinirinda degil');
  assert.match(always[1], /Remove work directories \(they hold the kubeconfig\)/);
  assert.match(always[1], /Remove the script and the slot directory/);
  assert.match(always[1], /fleet_cleanup_error:[\s\S]*fleet_work_after\.files/);
  // Temizlikte assert YOK: tek bastionda dusen assert tum partiyi dusurur, toplayici play kosmaz (sonuc kaybolur).
  assert.ok(
    !/ansible\.builtin\.assert/.test(always[1]),
    'always icinde assert (sonuc yayinlanmaz)',
  );
  // 2026-11-22 (PR-R): parola uzak komut satirina / -vvv ciktisina ve async is dosyasina gitmez; kosu dizini
  // tahmin edilemez; yazma hatasi "yazildi" sayilmaz. Davranis: server/ansible/__tests__/app-hub-filo-gercek-kosum.test.js.
  assert.ok(!/OCP_PASS:/.test(s), 'parola environment ile gidiyor (uzak komut satirinda gorunur)');
  const baslat = bloklar.find((b) => b.startsWith('"Start one scan per cluster"'));
  assert.ok(
    baslat && !/\bstdin:/.test(baslat),
    'async goreve stdin: (2.16 async is dosyasina duz yazar)',
  );
  assert.match(baslat, /FLEET_PASS_FILE: "\{\{ fleet_slot_dir \}\}\/p\.\{\{ item \}\}"/);
  const parolaDosyasi = bloklar.find((b) => b.startsWith('"One-shot password file per cluster'));
  assert.ok(
    parolaDosyasi && /no_log: true/.test(parolaDosyasi) && /mode: "0600"/.test(parolaDosyasi),
  );
  assert.ok(!/\/tmp\/app-hub-fleet-slots-\{\{/.test(s), 'slot dizini tahmin edilebilir yolda');
  assert.ok(!/KUBECONFIG:/.test(s), 'kubeconfig yolu playbook tarafindan /tmp altinda veriliyor');
  assert.ok(yaz && /ignore_errors: true/.test(yaz) && !/failed_when: false/.test(yaz), yaz);
  assert.match(s, /\(write_row is not unreachable\) and \(write_row is succeeded\)/);
  for (const ad of s.matchAll(/- name: "([^"]+)"/g))
    assert.ok(!/[çğıöşüÇĞİÖŞÜ]/.test(ad[1]), `Turkce gorev adi: ${ad[1]}`);
  assert.match(
    fs.readFileSync(path.join(ROOT, 'server', 'ansible', 'paths.cjs'), 'utf8'),
    /appHubFleet: 'app_hub\/app_hub_fleet\.yml'/,
  );
});

// ── Ayristirici ve DB ────────────────────────────────────────────────────────────
const dbDurum = { satirlar: [], sorgular: [], sonId: 0, yanit: null };
function filoDb(sql, p) {
  const t = String(sql);
  if (t.startsWith('SELECT id, namespace, uygulama, ozet_sha FROM app_hub_ocp_filo')) {
    return { rows: dbDurum.satirlar.filter((r) => r.cluster === p[0]) };
  }
  if (t.trim().startsWith('INSERT INTO app_hub_ocp_filo ')) {
    for (let i = 0; i < p.length; i += 12) {
      dbDurum.satirlar.push({
        id: ++dbDurum.sonId,
        cluster: p[i],
        namespace: p[i + 1],
        uygulama: p[i + 2],
        sonuc_json: p[i + 3],
        ozet_sha: p[i + 4],
        pod_toplam: p[i + 8],
        kosu_id: p[i + 10],
        alinma: p[i + 11],
        degisti: 'yeni',
      });
    }
    return { rows: [], rowCount: p.length / 12 };
  }
  if (t.trim().startsWith('UPDATE app_hub_ocp_filo SET sonuc_json')) {
    const r = dbDurum.satirlar.find((x) => x.id === p[8]);
    Object.assign(r, {
      sonuc_json: p[0],
      ozet_sha: p[1],
      pod_toplam: p[5],
      kosu_id: p[7],
      alinma: p[9],
      degisti: 'guncel',
    });
    return { rows: [], rowCount: 1 };
  }
  if (t.startsWith('UPDATE app_hub_ocp_filo SET alinma')) {
    for (const id of p.slice(2))
      Object.assign(
        dbDurum.satirlar.find((x) => x.id === id),
        { kosu_id: p[0], alinma: p[1] },
      );
    return { rows: [], rowCount: p.length - 2 };
  }
  if (t.startsWith('DELETE FROM app_hub_ocp_filo WHERE id IN')) {
    dbDurum.satirlar = dbDurum.satirlar.filter((x) => !p.includes(x.id));
    return { rows: [], rowCount: p.length };
  }
  return null;
}
sahte(require.resolve('../../db/index.cjs'), {
  query: async (sql, p = []) => {
    dbDurum.sorgular.push({ sql: String(sql), p });
    const f = filoDb(sql, p);
    if (f) return f;
    if (dbDurum.yanit) {
      const y = dbDurum.yanit(String(sql), p);
      if (y) return y;
    }
    return { rows: [], rowCount: 0 };
  },
});

const F = require('../filo.cjs');
const C = require('../canli.cjs');

const kayitlar = (ekler = []) => [
  [
    'OBJ',
    'ns1',
    'Deployment',
    'api',
    '3',
    '2',
    '3',
    '2',
    'RollingUpdate',
    '',
    '2026-01-01T00:00:00Z',
  ].join(T),
  ['CONT', 'ns1', 'Deployment', 'api', 'app', 'reg/api:1', '500m', '1Gi', '1', '2Gi'].join(T),
  ['ENV', 'ns1', 'Deployment', 'api', 'app', 'JAVA_OPTS', 'deger', '-Xmx1g -Dsecret.key=acik'].join(
    T,
  ),
  ['OBJ', 'ns1', 'Rollout', 'web', '2', '2', '2', '2', 'canary/bluegreen', '', 'x'].join(T),
  ['OBJ', 'ns2', 'DeploymentConfig', 'eski', '1', '1', '1', '1', 'Rolling', '', 'x'].join(T),
  ['OBJ', 'ns2', 'StatefulSet', 'db', '2', '2', '2', '2', '', '', 'x'].join(T),
  [
    'POD',
    'ns1',
    'ReplicaSet',
    'api-7c9d',
    '7c9d',
    '-',
    '-',
    'api-7c9d-a',
    'Running',
    'w1',
    '1/1',
    '0',
    't',
  ].join(T),
  [
    'POD',
    'ns1',
    'ReplicaSet',
    'api-7c9d',
    '7c9d',
    '-',
    '-',
    'api-7c9d-b',
    'Running',
    'w2',
    '1/1',
    '4',
    't',
  ].join(T),
  [
    'POD',
    'ns1',
    'ReplicaSet',
    'api-7c9d',
    '7c9d',
    '-',
    '-',
    'api-7c9d-c',
    'Pending',
    '-',
    '0/1',
    '0',
    '-',
  ].join(T),
  [
    'POD',
    'ns1',
    'ReplicaSet',
    'web-6f6f',
    '-',
    '6f6f',
    '-',
    'web-6f6f-a',
    'Running',
    'w1',
    '1/1',
    '0',
    't',
  ].join(T),
  [
    'POD',
    'ns2',
    'ReplicationController',
    'eski-12',
    '-',
    '-',
    'eski',
    'eski-12-x',
    'Running',
    'w3',
    '1/1',
    '0',
    't',
  ].join(T),
  ['POD', 'ns2', 'StatefulSet', 'db', '-', '-', '-', 'db-0', 'Running', 'w3', '1/1', '0', 't'].join(
    T,
  ),
  ['POD', 'ns1', 'Job', 'goc-1', '-', '-', '-', 'goc-1-z', 'Succeeded', 'w1', '0/1', '0', 't'].join(
    T,
  ),
  ['HPA', 'ns1', 'api-hpa', 'Deployment', 'api', '2', '6', '3'].join(T),
  ...ekler,
  'END\t4\t7',
];

test('AF6 ayristirici: pod sahibi, Job pod sayilmaz, HPA, pod sayisi, okunamayan ns null, ikinci maske', () => {
  assert.equal(F.podSahibi('ReplicaSet', 'api-7c9d', '7c9d', '-', '-'), 'api');
  assert.equal(F.podSahibi('ReplicaSet', 'web-6f6f', '-', '6f6f', '-'), 'web');
  assert.equal(F.podSahibi('ReplicationController', 'eski-12', '-', '-', 'eski'), 'eski');
  assert.equal(
    F.podSahibi('ReplicationController', 'eski-12', '-', '-', '-'),
    null,
    'deployer / hook pod uygulamaya sayildi',
  );
  assert.equal(F.podSahibi('StatefulSet', 'db', '-', '-', '-'), 'db');
  assert.equal(F.podSahibi('Job', 'goc-1', '-', '-', '-'), null);
  const k = F.kumele(kayitlar());
  assert.equal(k.bitti, true);
  assert.deepEqual([...k.gruplar.keys()].sort(), ['ns1|api', 'ns1|web', 'ns2|db', 'ns2|eski']);
  const api = F.grupGovdesi(k.gruplar.get('ns1|api'), k);
  assert.deepEqual(api.podOzet, {
    toplam: 3,
    hazir: 2,
    bitmis: 0,
    listelenen: 3,
    okunamadi: false,
  });
  assert.equal(api.nesneler[0].tur, 'Deployment');
  assert.equal(api.nesneler[0].containerlar[0].limit.bellek, '2Gi');
  assert.equal(
    api.nesneler[0].containerlar[0].jvmEnv[0].deger,
    '-Xmx1g -Dsecret.key=***',
    'ikinci maske katmani yok',
  );
  assert.deepEqual(
    api.hpa.map((h) => [h.ad, h.min, h.max, h.guncel]),
    [['api-hpa', 2, 6, 3]],
  );
  assert.deepEqual(api.nodelar, [
    { ad: 'w1', pod: 1 },
    { ad: 'w2', pod: 1 },
  ]);
  assert.equal(F.grupGovdesi(k.gruplar.get('ns1|web'), k).nesneler[0].tur, 'Argo Rollout');
  assert.equal(F.grupGovdesi(k.gruplar.get('ns1|web'), k).podOzet.toplam, 1);
  assert.equal(F.grupGovdesi(k.gruplar.get('ns2|eski'), k).podOzet.toplam, 1);
  assert.equal(F.grupGovdesi(k.gruplar.get('ns2|db'), k).podOzet.toplam, 1);
  const k2 = F.kumele(kayitlar(['NSFAIL\tpods\tns2']));
  const db = F.grupGovdesi(k2.gruplar.get('ns2|db'), k2);
  assert.equal(db.podOzet.toplam, null, 'okunamayan namespace pod sayisi 0/sayi yazildi');
  assert.equal(db.podOzet.okunamadi, true);
  const k3 = F.kumele(kayitlar(['KINDFAIL\tpods']));
  assert.equal(F.grupGovdesi(k3.gruplar.get('ns1|api'), k3).podOzet.toplam, null);
  const cok = Array.from({ length: 250 }, (_, i) =>
    [
      'POD',
      'ns1',
      'ReplicaSet',
      'api-7c9d',
      '7c9d',
      '-',
      '-',
      `p${i}`,
      'Running',
      'w1',
      '1/1',
      '0',
      't',
    ].join(T),
  );
  const k4 = F.kumele(kayitlar(cok));
  const g4 = F.grupGovdesi(k4.gruplar.get('ns1|api'), k4);
  assert.equal(g4.podOzet.toplam, 253);
  assert.equal(g4.podlar.length, 200);
  assert.equal(
    g4.nodelar.find((n) => n.ad === 'w1').pod,
    251,
    'node dagilimi kisaltilmis listeden',
  );
});

const paketle = (satirlar, ozet = 'APPHUB_FLEET_SUMMARY\t4\t7\t0\t3') =>
  Buffer.from(
    `${ozet}\n@@APPHUB_FLEET_BEGIN@@\n${zlib.gzipSync(Buffer.from(satirlar.join('\n'))).toString('base64')}\n@@APPHUB_FLEET_END@@\n`,
  );

test('AF7 dosya: gecerli / bitis yok / bozuk icerik', () => {
  const ok = F.dosyaCoz(paketle(kayitlar()));
  assert.equal(ok.hata, undefined);
  assert.deepEqual(ok.ozet, { nesne: 4, pod: 7, hata: 0, sn: 3 });
  assert.ok(ok.satirlar.includes('END\t4\t7'));
  assert.match(
    F.dosyaCoz(Buffer.from('APPHUB_FLEET_SUMMARY\t0\t0\t1\t0\n@@APPHUB_FLEET_BEGIN@@\nabc')).hata,
    /bitis isareti yok/,
  );
  assert.match(
    F.dosyaCoz(Buffer.from('@@APPHUB_FLEET_BEGIN@@\nbu-gzip-degil\n@@APPHUB_FLEET_END@@')).hata,
    /cozulemedi/,
  );
  assert.equal(F.dosyaAdi('ark/c 1'), 'ark_c_1.out');
});

test('AF8 DB farki: ekle / ayni / guncelle / sil; okunamayan kapsam silinmez', async () => {
  dbDurum.satirlar = [];
  const ilk = await F.clusterYaz('c1', F.kumele(kayitlar()), 1);
  assert.deepEqual([ilk.eklenen, ilk.guncellenen, ilk.silinen, ilk.ayni], [4, 0, 0, 0]);
  const api = dbDurum.satirlar.find((r) => r.uygulama === 'api');
  assert.equal(api.pod_toplam, 3);
  // Degisiklik izi CHAR(40) sutununa sigar ve sha256'dan gelir (sha1 degil).
  for (const r of dbDurum.satirlar)
    assert.equal(
      r.ozet_sha,
      require('node:crypto').createHash('sha256').update(r.sonuc_json).digest('hex').slice(0, 40),
    );
  const ikinci = await F.clusterYaz('c1', F.kumele(kayitlar()), 2);
  assert.deepEqual([ikinci.eklenen, ikinci.guncellenen, ikinci.silinen, ikinci.ayni], [0, 0, 0, 4]);
  assert.ok(
    dbDurum.satirlar.every((r) => r.kosu_id === 2),
    'degismeyenin zamani/kosusu tazelenmedi',
  );
  const degisen = kayitlar().filter((l) => !l.includes('api-7c9d-c'));
  const u = await F.clusterYaz('c1', F.kumele(degisen), 3);
  assert.equal(u.guncellenen, 1);
  assert.equal(dbDurum.satirlar.find((r) => r.uygulama === 'api').pod_toplam, 2);
  const ns2Yok = kayitlar().filter((l) => !/^(OBJ|POD)\tns2\t/.test(l));
  const korunan = await F.clusterYaz(
    'c1',
    F.kumele([...ns2Yok.slice(0, -1), 'NSFAIL\tdeployment\tns2', 'END\t2\t4']),
    4,
  );
  assert.equal(korunan.silinen, 0, 'okunamayan namespace satirlari silindi');
  assert.equal(korunan.korunan, 2);
  const turYok = await F.clusterYaz(
    'c1',
    F.kumele([...ns2Yok.slice(0, -1), 'KINDFAIL\tstatefulset', 'END\t2\t4']),
    5,
  );
  assert.equal(turYok.silinen, 0, 'okunamayan tur varken satir silindi');
  const sil = await F.clusterYaz('c1', F.kumele(ns2Yok), 6);
  assert.equal(sil.silinen, 2);
  assert.deepEqual(dbDurum.satirlar.map((r) => r.uygulama).sort(), ['api', 'web']);
  const baska = await F.clusterYaz('c2', F.kumele(kayitlar()), 6);
  assert.equal(baska.eklenen, 4, 'cluster ayrimi yok');
});

test('AF9 birlestirme: daha yeni okuma kazanir, kaynak etiketi', () => {
  const canli = [{ cluster: 'C1', namespace: 'ns1', alinma: '2026-11-18T10:00:00.000Z', ok: true }];
  const saatlik = [
    {
      cluster: 'c1',
      namespace: 'NS1',
      alinma: '2026-11-18T09:00:00.000Z',
      kaynak: 'saatlik',
      ok: true,
    },
    {
      cluster: 'c2',
      namespace: 'ns1',
      alinma: '2026-11-18T09:00:00.000Z',
      kaynak: 'saatlik',
      ok: true,
    },
  ];
  const b = F.birlestir(canli, saatlik);
  assert.equal(b.length, 2);
  assert.equal(b.find((r) => r.cluster === 'C1').kaynak, 'canli');
  assert.equal(b.find((r) => r.cluster === 'c2').kaynak, 'saatlik');
  saatlik[0].alinma = '2026-11-18T11:00:00.000Z';
  assert.equal(
    F.birlestir(canli, saatlik).find(
      (r) => r.namespace.toLowerCase() === 'ns1' && r.cluster.toLowerCase() === 'c1',
    ).kaynak,
    'saatlik',
  );
});

// ── Zamanlayici ──────────────────────────────────────────────────────────────────
const reg = { satir: null };
const runnerDurum = {
  baslatilan: [],
  iptal: [],
  hata: null,
  durumHata: null,
  durum: { status: 'successful', artifacts: {} },
};
sahte(require.resolve('../../ansible/playbook-registry.cjs'), {
  getByKey: async () => reg.satir,
  getEffectiveTemplateId: (r) => r.templateId,
});
sahte(require.resolve('../../ansible/runner.cjs'), {
  launchJobOnServer: async (s, t, ev, limit, kim) => {
    if (runnerDurum.hata) throw runnerDurum.hata;
    runnerDurum.baslatilan.push({ s, t, ev, limit, kim });
    return { jobId: 777, status: 'pending' };
  },
  getJobStatusOnServer: async () => {
    if (runnerDurum.durumHata) throw runnerDurum.durumHata;
    return runnerDurum.durum;
  },
  cancelJobOnServer: async (s, j) => {
    runnerDurum.iptal.push([s, j]);
  },
});
const preflight = [];
sahte(require.resolve('../../ansible/template-preflight.cjs'), {
  assertRegistryTemplate: async (_s, _t, key) => {
    preflight.push(key);
  },
});
sahte(require.resolve('../../logx/v2/admin.cjs'), {
  resolveTerminalHosts: async (_e, _t, adlar) => ({
    hosts: Object.fromEntries(adlar.filter((a) => a !== 'yok1').map((a) => [a, 'bastion1'])),
    missing: adlar.filter((a) => a === 'yok1'),
  }),
  resolveClusterMeta: async () => ({}),
});
sahte(require.resolve('../../logx/v2/ocp-runtime-config.cjs'), {
  getConfig: async () => ({ defaultOcpUsername: 'uxuser' }),
});

const P = require('../filo-poller.cjs');

test('AF10 zamanlayici: dilim, aralik, sablon yok, CAS bos, basari fan-out, hata yazimi', async () => {
  assert.equal(
    P.dilimAnahtari(Date.UTC(2026, 10, 18, 10, 59), 60),
    P.dilimAnahtari(Date.UTC(2026, 10, 18, 10, 0), 60),
  );
  assert.notEqual(
    P.dilimAnahtari(Date.UTC(2026, 10, 18, 11, 0), 60),
    P.dilimAnahtari(Date.UTC(2026, 10, 18, 10, 59), 60),
  );
  assert.equal(P.ayar({ APP_HUB_FILO_ARALIK_DK: '5' }).aralikDk, 30);
  assert.equal(P.ayar({ APP_HUB_FILO_ARALIK_DK: 'x' }).aralikDk, 60);
  assert.equal(P.ayar({ APP_HUB_FILO_YAZICI: 'yazici01' }).yazici, 'YAZICI01');
  assert.equal(P.ayar({ APP_HUB_FILO_KAPALI: '1' }).kapali, true);

  const onceki = { ...process.env };
  process.env.APP_HUB_FILO_YAZICI = 'yazici01';
  process.env.APP_HUB_FILO_DIR = '/sw/test/app_hub_ocp';
  try {
    reg.satir = null;
    dbDurum.sorgular = [];
    assert.equal(await P.zamanla(), null);
    assert.ok(
      !dbDurum.sorgular.some((q) => q.sql.includes('INSERT INTO app_hub_ocp_filo_kosu')),
      'sablon yokken kosu acildi',
    );

    reg.satir = { templateId: 55, awxServerId: 2 };
    dbDurum.yanit = (sql) =>
      sql.includes('INSERT INTO app_hub_ocp_filo_kosu') ? { rows: [{ id: null }] } : null;
    runnerDurum.baslatilan = [];
    assert.equal(await P.zamanla(), null);
    assert.equal(runnerDurum.baslatilan.length, 0, 'CAS bos dondugu halde AWX baslatildi');

    dbDurum.yanit = (sql) => {
      if (sql.includes('INSERT INTO app_hub_ocp_filo_kosu')) return { rows: [{ id: 41 }] };
      if (sql.includes('FROM ocp_cluster_index')) {
        return {
          rows: [
            { env: 'PROD', tenant: 'ark', cluster_name: 'c1' },
            { env: 'PROD', tenant: 'ark', cluster_name: 'c2' },
            { env: 'PROD', tenant: 'ark', cluster_name: 'yok1' },
          ],
        };
      }
      return null;
    };
    dbDurum.sorgular = [];
    assert.equal(await P.zamanla(), 41);
    assert.equal(runnerDurum.baslatilan.length, 1);
    const b = runnerDurum.baslatilan[0];
    assert.equal(b.s, 2);
    assert.equal(b.t, 55);
    assert.equal(b.limit, '');
    assert.equal(b.ev.app_hub_fleet_run, 41);
    assert.equal(b.ev.app_hub_fleet_dir, '/sw/test/app_hub_ocp');
    assert.equal(b.ev.app_hub_fleet_writer, 'YAZICI01');
    assert.deepEqual(
      b.ev.ocp_clusters.map((c) => c.cluster_name),
      ['c1', 'c2'],
    );
    assert.deepEqual(b.ev.terminal_hosts, ['bastion1']);
    assert.equal(b.ev.ocp_username, 'uxuser');
    const calisiyor = dbDurum.sorgular.find((q) =>
      q.sql.includes("durum = 'CALISIYOR', awx_job_id"),
    );
    assert.deepEqual(calisiyor.p, [777, 2, 41]);
    assert.deepEqual(
      preflight.slice(-1),
      ['app_hub_ocp_filo'],
      'kayit anahtari playbook korumasi cagrilmadi',
    );

    runnerDurum.hata = Object.assign(new Error('AWX 503'), { status: 503 });
    dbDurum.sorgular = [];
    assert.equal(await P.zamanla(), 41);
    const hata = dbDurum.sorgular.find((q) => q.sql.includes("durum = 'HATA'"));
    assert.ok(hata, 'baslatma hatasi yazilmadi');
    assert.match(hata.p[0], /AWX 503/);
    assert.equal(hata.p[2], 'BASLATILIYOR');
  } finally {
    runnerDurum.hata = null;
    dbDurum.yanit = null;
    reg.satir = null;
    process.env = onceki;
  }
});

test('AF11 alim: biten is -> ALINIYOR -> dosya -> onbellek -> BITTI; baska kosu HATA', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'apphub-filo-'));
  const dizin = path.join(kok, 'a', 'b', 'c');
  const onceki = { ...process.env };
  process.env.APP_HUB_FILO_DIR = ux(dizin);
  try {
    fs.mkdirSync(path.join(dizin, 'run-9', 'raw'), { recursive: true });
    fs.writeFileSync(path.join(dizin, 'run-9', 'raw', 'c1.out'), paketle(kayitlar()));
    dbDurum.satirlar = [];
    runnerDurum.durum = {
      status: 'successful',
      started: '2026-11-18T10:00:00.000Z',
      artifacts: {
        app_hub_fleet_result: {
          run: '9',
          overall_status: 'partial',
          results: [
            { cluster: 'c1', ok: true, written: true },
            { cluster: 'c2', ok: false, written: false, error: 'Bastion did not report' },
          ],
        },
      },
    };
    dbDurum.yanit = (sql) => {
      if (sql.includes('FROM app_hub_ocp_filo_kosu WHERE durum IN'))
        return {
          rows: [
            {
              id: 9,
              durum: 'CALISIYOR',
              awx_server_id: 2,
              awx_job_id: 777,
              yas: 100,
              alim_yas: null,
            },
          ],
        };
      if (sql.includes("SET durum = 'ALINIYOR'")) return { rows: [], rowCount: 1 };
      return null;
    };
    dbDurum.sorgular = [];
    await P.ilerlet();
    const bitti = dbDurum.sorgular.find((q) => q.sql.includes("SET durum = 'BITTI'"));
    assert.ok(bitti, 'kosu BITTI yazilmadi');
    const ozet = JSON.parse(bitti.p[0]);
    assert.deepEqual(
      ozet.clusterlar.map((c) => [c.cluster, c.ok]),
      [
        ['c1', true],
        ['c2', false],
      ],
    );
    assert.equal(ozet.clusterlar[1].hata, 'Bastion did not report');
    assert.equal(bitti.p[1], null);
    assert.equal(dbDurum.satirlar.length, 4, 'onbellege yazilmadi');
    assert.ok(
      dbDurum.satirlar.every(
        (r) => r.alinma instanceof Date && r.alinma.toISOString() === '2026-11-18T10:00:00.000Z',
      ),
      'alinma tarama zamani (AWX baslangici) degil',
    );
    const gecmis = dbDurum.sorgular.find((q) => q.sql.includes('UPDATE ansible_job_history'));
    assert.deepEqual(gecmis && gecmis.p, ['successful', 777, 2], 'is gecmisi kapatilmadi');

    runnerDurum.durum.artifacts.app_hub_fleet_result.run = '8';
    dbDurum.sorgular = [];
    await P.ilerlet();
    const hata = dbDurum.sorgular.find((q) => q.sql.includes("durum = 'HATA'"));
    assert.ok(hata && /başka bir koşuya/.test(hata.p[0]), 'baska kosunun sonucu alindi');
    assert.equal(hata.p[2], 'ALINIYOR');

    dbDurum.yanit = (sql) =>
      sql.includes('FROM app_hub_ocp_filo_kosu WHERE durum IN')
        ? { rows: [{ id: 9, durum: 'CALISIYOR', awx_server_id: 2, awx_job_id: 777, yas: 100 }] }
        : null;
    dbDurum.sorgular = [];
    runnerDurum.durum = { status: 'running', artifacts: {} };
    await P.ilerlet();
    assert.ok(
      !dbDurum.sorgular.some((q) => q.sql.includes("SET durum = 'ALINIYOR'")),
      'bitmemis is alindi',
    );
  } finally {
    dbDurum.yanit = null;
    process.env = onceki;
    fs.rmSync(kok, { recursive: true, force: true });
  }
});

test('AF12 canli.cjs: <no value> isareti bos sayilir', () => {
  const c = C.satirlariCoz([
    [
      'OBJ',
      'Deployment',
      'a',
      '1',
      '1',
      '1',
      '1',
      'RollingUpdate',
      '<no value><no value>',
      'x',
    ].join(T),
    'END\t1\t0',
  ]);
  assert.equal(c.nesneler[0].gitops, null);
  const d = C.satirlariCoz([
    ['OBJ', 'Deployment', 'a', '1', '1', '1', '1', '', 'argo-app<no value>', 'x'].join(T),
    'END\t1\t0',
  ]);
  assert.equal(d.nesneler[0].gitops, 'argo-app');
});

test('AF13 review: bitmis pod, buyuk govde, basarisiz yeni okuma, zamanlayici tavanlari', async () => {
  const ek = [
    [
      'POD',
      'ns1',
      'ReplicaSet',
      'api-7c9d',
      '7c9d',
      '-',
      '-',
      'api-7c9d-ev',
      'Failed',
      'w1',
      '0/1',
      '0',
      't',
    ].join(T),
    [
      'POD',
      'ns2',
      'ReplicationController',
      'eski-12',
      '-',
      '-',
      '-',
      'eski-12-deploy',
      'Succeeded',
      'w3',
      '0/1',
      '0',
      't',
    ].join(T),
  ];
  const k = F.kumele(kayitlar(ek));
  const api = F.grupGovdesi(k.gruplar.get('ns1|api'), k);
  assert.equal(api.podOzet.toplam, 3, 'Evicted (Failed) pod sayildi');
  assert.equal(api.podOzet.bitmis, 1);
  assert.equal(
    F.grupGovdesi(k.gruplar.get('ns2|eski'), k).podOzet.toplam,
    1,
    'DC deployer pod sayildi',
  );

  // Buyuk govde: once pod listesi, sonra JVM ayrintisi atilir; o da yetmezse satir SILINMEZ.
  const buyukEnv = kayitlar([
    [
      'ENV',
      'ns1',
      'Deployment',
      'api',
      'app',
      'JAVA_TOOL_OPTIONS',
      'deger',
      `-Xmx1g ${'-Xss1m '.repeat(160000)}`,
    ].join(T),
  ]);
  const g = F.grupGovdesi(F.kumele(buyukEnv).gruplar.get('ns1|api'), F.kumele(buyukEnv));
  const j = JSON.parse(F.govdeJson(g));
  assert.deepEqual(j.nesneler[0].containerlar[0].jvmEnv, []);
  assert.equal(j.podOzet.toplam, 3);
  dbDurum.satirlar = [];
  await F.clusterYaz('c9', F.kumele(kayitlar()), 1);
  const dev = kayitlar().map((l) =>
    l.startsWith('CONT\tns1\tDeployment\tapi') ? l.replace('reg/api:1', 'x'.repeat(950000)) : l,
  );
  const r = await F.clusterYaz('c9', F.kumele(dev), 2);
  assert.equal(r.buyuk, 1);
  assert.equal(r.silinen, 0, 'saklanamayan buyuk govde satiri sildi');
  assert.ok(dbDurum.satirlar.some((x) => x.cluster === 'c9' && x.uygulama === 'api'));

  // Daha yeni ama basarisiz canli okuma gecerli saatlik veriyi gizlemez.
  const b = F.birlestir(
    [
      {
        cluster: 'c1',
        namespace: 'ns1',
        alinma: '2026-11-18T11:00:00.000Z',
        ok: false,
        hata: 'bastion zaman asimi',
      },
    ],
    [
      {
        cluster: 'c1',
        namespace: 'ns1',
        alinma: '2026-11-18T10:00:00.000Z',
        ok: true,
        kaynak: 'saatlik',
      },
    ],
  );
  assert.equal(b[0].kaynak, 'saatlik');
  assert.equal(b[0].sonOkumaHatasi, 'bastion zaman asimi');

  // Zamanlayici: AWX okunamiyor (kisa) -> bekler; tavani asinca HATA. Takilan is iptal + gecmis kapanir. Alim tavani.
  const satir = (o) => ({
    id: 5,
    durum: 'CALISIYOR',
    awx_server_id: 2,
    awx_job_id: 900,
    yas: 100,
    ...o,
  });
  try {
    runnerDurum.durumHata = new Error('404 Not Found');
    dbDurum.yanit = (sql) =>
      sql.includes('FROM app_hub_ocp_filo_kosu WHERE durum IN') ? { rows: [satir()] } : null;
    dbDurum.sorgular = [];
    await P.ilerlet();
    assert.ok(
      !dbDurum.sorgular.some((q) => q.sql.includes("durum = 'HATA'")),
      'kisa AWX kesintisinde kosu kapatildi',
    );
    dbDurum.yanit = (sql) =>
      sql.includes('FROM app_hub_ocp_filo_kosu WHERE durum IN')
        ? { rows: [satir({ yas: 5 * 3600 })] }
        : null;
    dbDurum.sorgular = [];
    await P.ilerlet();
    assert.ok(
      dbDurum.sorgular.some((q) => q.sql.includes("durum = 'HATA'") && q.p[2] === 'CALISIYOR'),
      'okunamayan is tavanda kapanmadi',
    );

    runnerDurum.durumHata = null;
    runnerDurum.durum = { status: 'running', artifacts: {} };
    runnerDurum.iptal = [];
    dbDurum.sorgular = [];
    await P.ilerlet();
    assert.deepEqual(runnerDurum.iptal, [[2, 900]], 'takilan is iptal edilmedi');
    assert.ok(dbDurum.sorgular.some((q) => q.sql.includes("durum = 'HATA'")));
    assert.ok(
      dbDurum.sorgular.some(
        (q) => q.sql.includes('UPDATE ansible_job_history') && q.p[0] === 'canceled',
      ),
    );

    dbDurum.yanit = (sql) =>
      sql.includes('FROM app_hub_ocp_filo_kosu WHERE durum IN')
        ? { rows: [satir({ durum: 'ALINIYOR', yas: 7 * 3600, alim_yas: 60 })] }
        : null;
    dbDurum.sorgular = [];
    await P.ilerlet();
    assert.ok(
      dbDurum.sorgular.some((q) => q.sql.includes("durum = 'HATA'") && q.p[2] === 'ALINIYOR'),
      'alim tavani yok',
    );
  } finally {
    runnerDurum.durumHata = null;
    dbDurum.yanit = null;
  }
});

test('AF14 canli okuma pod ozeti: okunamadi null, 200 ustu END sayisi', () => {
  const pod = (ad, faz = 'Running', hazir = '1/1') =>
    ['POD', ad, faz, 'w1', hazir, '0', 't'].join(T);
  const obj = ['OBJ', 'Deployment', 'a', '3', '3', '3', '3', '', '', 'x'].join(T);
  const coz = (lines, ok = true) =>
    C.sonucuCoz({ results: [{ cluster: 'c1', namespace: 'n', ok, lines }] }).hedefler[0];
  const hata = coz([obj, 'ERR\tpod listesi okunamadi: Forbidden', 'END\t1\t0']);
  assert.equal(hata.podOzet.okunamadi, true);
  assert.equal(hata.podOzet.toplam, null, 'okunamayan pod listesi 0 sayildi');
  const cok = coz([obj, ...Array.from({ length: 200 }, (_, i) => pod(`p${i}`)), 'END\t1\t350']);
  assert.equal(cok.podOzet.toplam, 350, 'liste tavani gercek toplam sanildi');
  assert.equal(cok.podOzet.listelenen, 200);
  const az = coz([
    obj,
    pod('a'),
    pod('b', 'Running', '0/1'),
    pod('c', 'Failed', '0/1'),
    'END\t1\t3',
  ]);
  assert.deepEqual([az.podOzet.toplam, az.podOzet.hazir, az.podOzet.bitmis], [2, 1, 1]);
});

test(
  'AF15 betik: tarama butcesi bitince kalan turler KINDFAIL',
  { skip: !bashVar && 'bash/awk/gzip yok' },
  () => {
    const r = betikKos({}, { FLEET_SCAN_BUDGET: '-1' });
    assert.equal(r.status, 0, r.stderr);
    for (const t of ['deployment', 'pods', 'hpa'])
      assert.match(r.kayit, new RegExp(`^KINDFAIL\\t${t.replace('.', '\\.')}$`, 'm'));
    assert.match(r.kayit, /^ERR\tdeployment was not read: scan budget/m);
    assert.ok(!r.calls.includes('get deployment'), 'butce bittigi halde okuma yapildi');
    const k = F.kumele(r.kayit.split('\n'));
    assert.equal(F.korunur(k, 'musteri'), true, 'butce bitince satirlar silinebilir');
  },
);

test('AF16 kosu dizini: sondaki egik cizgiler atilir; goreli, .. ve sig dizin 422', () => {
  const onceki = process.env.APP_HUB_FILO_DIR;
  const dene = (v) => {
    if (v === undefined) delete process.env.APP_HUB_FILO_DIR;
    else process.env.APP_HUB_FILO_DIR = v;
    return F.filoDizini();
  };
  try {
    assert.equal(dene(undefined), '/sw/BMW_PORTAL/app_hub_ocp');
    assert.equal(dene(' /sw/a/b/// '), '/sw/a/b');
    assert.equal(dene('/sw/a/b'), '/sw/a/b');
    // Cok sayida egik cizgi (sonda olmayan) hizli ve dogru: geri izleme yok.
    const uzun = `/sw/a/b${'/'.repeat(50000)}x`;
    assert.equal(dene(uzun), uzun);
    for (const kotu of ['sw/a/b', '/sw/../b/c', '/sw/a', '/', '///'])
      assert.throws(
        () => dene(kotu),
        (e) => e.status === 422 && /APP_HUB_FILO_DIR gecersiz/.test(e.message),
        kotu,
      );
  } finally {
    if (onceki === undefined) delete process.env.APP_HUB_FILO_DIR;
    else process.env.APP_HUB_FILO_DIR = onceki;
  }
});

const flockVar = spawnSync('flock', ['--version'], { stdio: 'ignore' }).status === 0;

test(
  'AF17 betik slot dizini: yok / symlink / baskasina yazilabilir reddedilir',
  { skip: !bashVar && 'bash/awk/gzip yok' },
  () => {
    const kok = fs.mkdtempSync('/tmp/app-hub-fleet-slots-af17.');
    const hedef = fs.mkdtempSync(path.join(os.tmpdir(), 'af17-hedef-'));
    const bag = `${kok}-bag`;
    try {
      fs.chmodSync(kok, 0o700);
      const ret = (dizin) => {
        const r = betikKos({}, { FLEET_SLOT_DIR: dizin });
        assert.equal(r.status, 2, `${dizin}: ${r.stdout}`);
        assert.match(r.stdout, /^ERR\tunsafe slot directory/m, dizin);
        assert.ok(!/^login /m.test(r.calls), `${dizin}: guvensiz slot dizininde login yapildi`);
      };
      ret(`${kok}-yok`);
      fs.symlinkSync(hedef, bag);
      ret(bag);
      fs.chmodSync(kok, 0o777);
      ret(kok);
      fs.chmodSync(kok, 0o720);
      ret(kok);
      fs.chmodSync(kok, 0o700);
      const r = betikKos({}, { FLEET_SLOT_DIR: kok });
      assert.equal(r.status, 0, r.stdout);
      assert.match(r.kayit, /^END\t1\t1$/m);
    } finally {
      fs.rmSync(bag, { force: true });
      fs.rmSync(kok, { recursive: true, force: true });
      fs.rmSync(hedef, { recursive: true, force: true });
    }
  },
);

test(
  'AF17b betik slot dosyasi symlink ise acilmaz; hedef bozulmaz',
  { skip: (!bashVar && 'bash/awk/gzip yok') || (!flockVar && 'flock yok') },
  () => {
    const kok = fs.mkdtempSync('/tmp/app-hub-fleet-slots-af17b.');
    const kurban = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'af17b-')), 'onemli');
    try {
      fs.chmodSync(kok, 0o700);
      fs.writeFileSync(kurban, 'silinmemeli');
      fs.symlinkSync(kurban, path.join(kok, 'slot.0'));
      const r = betikKos({}, { FLEET_SLOT_DIR: kok, FLEET_SLOTS: '2' });
      assert.equal(r.status, 0, r.stdout);
      assert.equal(
        fs.readFileSync(kurban, 'utf8'),
        'silinmemeli',
        'slot.0 symlink hedefi sifirlandi',
      );
      assert.ok(fs.existsSync(path.join(kok, 'slot.1')), 'ikinci slot kullanilmadi');
    } finally {
      fs.rmSync(kok, { recursive: true, force: true });
      fs.rmSync(path.dirname(kurban), { recursive: true, force: true });
    }
  },
);

test('AF18 alim: giris kapisi dusunce kosu HATA sebebi tasir', async () => {
  runnerDurum.durum = {
    status: 'failed',
    artifacts: {
      app_hub_fleet_result: {
        run: '',
        dir: '',
        overall_status: 'failed',
        error: 'Required variables are missing or invalid: terminal_hosts=0',
        results: [],
      },
    },
  };
  dbDurum.yanit = (sql) => {
    if (sql.includes('FROM app_hub_ocp_filo_kosu WHERE durum IN'))
      return {
        rows: [
          {
            id: 9,
            durum: 'CALISIYOR',
            awx_server_id: 2,
            awx_job_id: 778,
            yas: 100,
            alim_yas: null,
          },
        ],
      };
    if (sql.includes("SET durum = 'ALINIYOR'")) return { rows: [], rowCount: 1 };
    return null;
  };
  dbDurum.sorgular = [];
  try {
    await P.ilerlet();
    const hata = dbDurum.sorgular.find((q) => q.sql.includes("durum = 'HATA'"));
    assert.ok(hata, 'kosu HATA yazilmadi');
    assert.match(hata.p[0], /^Tarama başlamadı \(giriş kapısı\): Required variables are missing/);
    assert.ok(!/başka bir koşuya/.test(hata.p[0]), 'kapi hatasi kosu uyusmazligi sanildi');
    assert.ok(
      !dbDurum.sorgular.some((q) => q.sql.includes("SET durum = 'BITTI'")),
      'kapi hatasi BITTI yazdi',
    );
  } finally {
    dbDurum.yanit = null;
  }
});

test(
  'AF17c betik parola dosyasi: okunur, silinir; disaridaki / symlink reddedilir',
  { skip: !bashVar && 'bash/awk/gzip yok' },
  () => {
    const kok = fs.mkdtempSync('/tmp/app-hub-fleet-slots-af17c.');
    const disari = fs.mkdtempSync(path.join(os.tmpdir(), 'af17c-'));
    try {
      fs.chmodSync(kok, 0o700);
      const pf = path.join(kok, 'p.c1');
      fs.writeFileSync(pf, 'dosyadan-parola', { mode: 0o600 });
      const r = betikKos({}, { FLEET_SLOT_DIR: kok, FLEET_PASS_FILE: pf });
      assert.equal(r.status, 0, r.stdout);
      assert.match(
        r.calls,
        /^login --server=https:\/\/api\.x:6443 --username=u --password=dosyadan-parola$/m,
      );
      assert.equal(fs.existsSync(pf), false, 'parola dosyasi okunduktan sonra silinmedi');
      const ret = (yol, ad) => {
        const x = betikKos({}, { FLEET_SLOT_DIR: kok, FLEET_PASS_FILE: yol });
        assert.equal(x.status, 2, `${ad}: ${x.stdout}`);
        assert.match(x.stdout, /^ERR\tinvalid password file$/m, ad);
        assert.ok(!/^login /m.test(x.calls), `${ad}: gecersiz parola dosyasiyla login yapildi`);
      };
      const dis = path.join(disari, 'p.c1');
      fs.writeFileSync(dis, 'x', { mode: 0o600 });
      ret(dis, 'kosu dizini disinda');
      fs.symlinkSync(dis, path.join(kok, 'p.bag'));
      ret(path.join(kok, 'p.bag'), 'symlink');
      ret(path.join(kok, 'p.yok'), 'yok');
      assert.equal(fs.readFileSync(dis, 'utf8'), 'x', 'reddedilen dosya silindi');
    } finally {
      fs.rmSync(kok, { recursive: true, force: true });
      fs.rmSync(disari, { recursive: true, force: true });
    }
  },
);

test('AF19 alim: bastionda kalan gecici dosya kosu hata alaninda gorunur', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'apphub-filo-'));
  const dizin = path.join(kok, 'a', 'b', 'c');
  const onceki = { ...process.env };
  process.env.APP_HUB_FILO_DIR = ux(dizin);
  try {
    fs.mkdirSync(path.join(dizin, 'run-9', 'raw'), { recursive: true });
    fs.writeFileSync(path.join(dizin, 'run-9', 'raw', 'c1.out'), paketle(kayitlar()));
    dbDurum.satirlar = [];
    runnerDurum.durum = {
      status: 'failed',
      started: '2026-11-18T10:00:00.000Z',
      artifacts: {
        app_hub_fleet_result: {
          run: '9',
          overall_status: 'ok',
          results: [{ cluster: 'c1', ok: true, written: true }],
          cleanup_errors: [
            'bast1: temporary credential, script or run files could not be removed: /tmp/x',
          ],
        },
      },
    };
    dbDurum.yanit = (sql) => {
      if (sql.includes('FROM app_hub_ocp_filo_kosu WHERE durum IN'))
        return {
          rows: [
            {
              id: 9,
              durum: 'CALISIYOR',
              awx_server_id: 2,
              awx_job_id: 779,
              yas: 100,
              alim_yas: null,
            },
          ],
        };
      if (sql.includes("SET durum = 'ALINIYOR'")) return { rows: [], rowCount: 1 };
      return null;
    };
    dbDurum.sorgular = [];
    await P.ilerlet();
    const bitti = dbDurum.sorgular.find((q) => q.sql.includes("SET durum = 'BITTI'"));
    assert.ok(bitti, 'kosu BITTI yazilmadi (tarama sonucu kayboldu)');
    assert.equal(JSON.parse(bitti.p[0]).clusterlar[0].ok, true);
    assert.match(String(bitti.p[1]), /^Bastion'da geçici dosya kaldı: bast1: temporary credential/);
  } finally {
    dbDurum.yanit = null;
    process.env = onceki;
    fs.rmSync(kok, { recursive: true, force: true });
  }
});
