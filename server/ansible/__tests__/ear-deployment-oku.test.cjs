// server/ansible/__tests__/ear-deployment-oku.test.cjs — Uygulama Envanteri FAZ 2: deployment_oku.sh.
//
// Kullanici: "JVM ayakta ancak deployment'i incelesin" (komut: read-children-resources(child-type=
// deployment,include-runtime=true,recursive=false); JBoss 7 host=master + $HOSTNAME, JBoss 8
// host=primary + $HOSTNAME:9998). Betik GERCEK bash'te, sahte `ps` ve sahte jboss-cli ile kosar.
//   DO1 calisan JVM'ler ps'teki -D[Server:ad]'dan; nesil kurulum yolundan; CLI argumanlari BIREBIR
//       (controller, host, komut); alternatif jboss/bin yolu; cikti alim.deploymentCoz ile okunur
//   DO2 olculemeyen durumlar ayri: CLI_YOK, HATA (rc + mesaj), ZAMAN_ASIMI (timeout 124), BUTCE_DOLDU,
//       GECERSIZ_AD (CLI'ya verilmez); tekrarlanan surec bir kez
//   DO3 kaynak: yalniz okuma islemi (read-children-resources), dosyaya yazan yonlendirme / komut yok,
//       Jinja isareti yok, bash -n temiz
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const alim = require('../../server-hub/ear-envanter-alim.cjs');

const BETIK = path.join(
  __dirname,
  '..',
  'bmw_portal',
  'ear_envanter',
  'files',
  'deployment_oku.sh',
);
const KAYNAK = fs.readFileSync(BETIK, 'utf8');
const TIMEOUT_VAR =
  spawnSync('bash', ['-c', 'command -v timeout'], { stdio: 'ignore' }).status === 0;
const SKIP = TIMEOUT_VAR ? false : 'timeout (coreutils) yok';

const DMR = `{
    "outcome" => "success",
    "result" => {
        "ODEME.ear" => {
            "content" => [{"hash" => bytes {
                0x1a, 0x2b
            }}],
            "enabled" => true,
            "enabled-time" => 1762412345000L,
            "name" => "ODEME.ear",
            "owner" => undefined,
            "runtime-name" => "ODEME.ear",
            "status" => "OK",
            "subdeployment" => {"odeme.war" => undefined},
            "subsystem" => undefined
        },
        "ESKI.ear" => {
            "enabled" => false,
            "name" => "ESKI.ear",
            "runtime-name" => "ESKI.ear",
            "status" => "FAILED"
        }
    }
}`;

function ortam({ psSatirlari, cli7 = 'bin', cli8 = 'jboss/bin', sure, zaman } = {}) {
  const kok = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ear-dep-')));
  const bin = path.join(kok, 'yol');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'ps'),
    `#!/bin/bash\ncat <<'PS_SON'\n${psSatirlari.join('\n')}\nPS_SON\n`,
    { mode: 0o755 },
  );
  const kayit = path.join(kok, 'cli.kayit');
  const sahteCli = `#!/bin/bash
printf 'ARG %s\\n' "$@" >> "$KAYIT"
case "$*" in
  *server=YAVAS:*) sleep 5 ;;
  *server=HATALI:*) echo "Failed to connect to the controller: WFLYPRT0053"; exit 1 ;;
  *server=APPJVM:*) cat <<'DMR_SON'
${DMR}
DMR_SON
  ;;
  *) echo '{"outcome" => "success", "result" => {}}' ;;
esac
`;
  const kurulum7 = path.join(kok, 'usr', 'jboss', 'AppServer');
  const kurulum8 = path.join(kok, 'usr', 'jboss8', 'AppServer');
  if (cli7) {
    fs.mkdirSync(path.join(kurulum7, cli7), { recursive: true });
    fs.writeFileSync(path.join(kurulum7, cli7, 'jboss-cli.sh'), sahteCli, { mode: 0o755 });
  }
  if (cli8) {
    fs.mkdirSync(path.join(kurulum8, cli8), { recursive: true });
    fs.writeFileSync(path.join(kurulum8, cli8, 'jboss-cli8.sh'), sahteCli, { mode: 0o755 });
  }
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    KAYIT: kayit,
    EAR_JBOSS: `${kurulum7}:${kurulum8}`,
    LC_ALL: 'C',
    ...(sure != null ? { EAR_DEP_SURE: String(sure) } : {}),
    ...(zaman != null ? { EAR_DEP_ZAMAN: String(zaman) } : {}),
  };
  return { kok, kayit, env, kurulum7, kurulum8 };
}

function kos(o) {
  const r = spawnSync('bash', ['-s'], {
    input: KAYNAK,
    env: o.env,
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(r.status, 0, `betik kod ${r.status}: ${r.stderr}`);
  return r.stdout;
}
const hostAdi = String(
  spawnSync('bash', ['-c', 'printf %s "$HOSTNAME"'], { encoding: 'utf8' }).stdout,
);
const jvmler = (out) =>
  Object.fromEntries(
    alim.deploymentCoz(Buffer.from(out)).jvmler.map((j) => [`${j.nesil}|${j.ad}`, j]),
  );
const ps7 = (ad) =>
  `/usr/bin/java -D[Server:${ad}] -Djboss.home.dir=/usr/jboss/AppServer -server org.jboss.as.server`;
const ps8 = (ad) =>
  `/usr/bin/java -D[Server:${ad}] -Djboss.home.dir=/usr/jboss8/AppServer -server org.jboss.as.server`;

test(
  'DO1 calisan JVM -> CLI argumanlari birebir; nesil yoldan; cikti okunur',
  { skip: SKIP },
  () => {
    const o = ortam({
      psSatirlari: [
        ps7('APPJVM'),
        ps8('APP8'),
        ps7('APPJVM'), // ayni surec iki satir (thread / sarmalayici)
        '/usr/bin/java -D[Host Controller] -Djboss.home.dir=/usr/jboss/AppServer',
        'grep -- -D\\[Server:',
        '/usr/sbin/sshd -D',
      ],
    });
    const out = kos(o);
    assert.match(out, /^@@EAR_DEPLOYMENT_BASLA@@\nsurum=1\n/);
    assert.match(out, /@@EAR_DEPLOYMENT_BITTI@@\n$/);
    const argumanlar = fs.readFileSync(o.kayit, 'utf8').trim().split('\n');
    assert.deepEqual(argumanlar, [
      'ARG -c',
      `ARG --controller=${hostAdi}`,
      'ARG --command=/host=master/server=APPJVM:read-children-resources(child-type=deployment,include-runtime=true,recursive=false)',
      'ARG -c',
      `ARG --controller=${hostAdi}:9998`,
      'ARG --command=/host=primary/server=APP8:read-children-resources(child-type=deployment,include-runtime=true,recursive=false)',
    ]);
    const j = jvmler(out);
    assert.deepEqual(
      Object.keys(j).sort(),
      ['7|APPJVM', '8|APP8'],
      'host controller / grep / tekrar JVM sayilmamali',
    );
    assert.equal(j['7|APPJVM'].durum, 'OK');
    assert.deepEqual(j['7|APPJVM'].deploymentlar, [
      { ad: 'ODEME.ear', calisma_adi: 'ODEME.ear', etkin: true, durum: 'OK' },
      { ad: 'ESKI.ear', calisma_adi: 'ESKI.ear', etkin: false, durum: 'FAILED' },
    ]);
    assert.deepEqual(
      [j['8|APP8'].durum, j['8|APP8'].deploymentlar],
      ['OK', []],
      'bos sonuc = deployment yok (olculmus)',
    );
  },
);

test(
  'DO2 olculemeyen durumlar: CLI_YOK, HATA, ZAMAN_ASIMI, BUTCE_DOLDU, GECERSIZ_AD',
  { skip: SKIP },
  () => {
    const o = ortam({
      psSatirlari: [ps7('HATALI'), ps7('YAVAS'), ps8('SEKIZ'), ps7('kotu;ad'), ps7('$(id)')],
      cli8: null,
      zaman: 1,
    });
    const out = kos(o);
    const j = jvmler(out);
    assert.deepEqual([j['7|HATALI'].durum, j['7|HATALI'].rc], ['HATA', 1]);
    assert.match(j['7|HATALI'].hata, /Failed to connect/);
    assert.deepEqual([j['7|YAVAS'].durum, j['7|YAVAS'].rc], ['ZAMAN_ASIMI', 124]);
    assert.equal(j['8|SEKIZ'].durum, 'CLI_YOK');
    assert.equal(j['7|-'].durum, 'GECERSIZ_AD');
    const kayit = fs.readFileSync(o.kayit, 'utf8');
    assert.ok(
      !kayit.includes('kotu') && !kayit.includes('$(id)') && !kayit.includes('uid='),
      'gecersiz ad CLIya verildi',
    );
    // Butce: 0 sn -> hicbir CLI cagrilmaz.
    const b = ortam({ psSatirlari: [ps7('APPJVM'), ps8('APP8')], sure: 0 });
    const jb = jvmler(kos(b));
    assert.deepEqual([jb['7|APPJVM'].durum, jb['8|APP8'].durum], ['BUTCE_DOLDU', 'BUTCE_DOLDU']);
    assert.ok(!fs.existsSync(b.kayit), 'butce dolunca CLI cagrildi');
    // Hic JBoss sureci yoksa yalniz isaretler (olculmus, bos).
    const bos = ortam({ psSatirlari: ['/usr/sbin/sshd -D'] });
    assert.deepEqual(alim.deploymentCoz(Buffer.from(kos(bos))), {
      surum: 1,
      kesik: false,
      jvmler: [],
    });
  },
);

test('DO3 kaynak: yalniz okuma islemi; dosyaya yazan komut / yonlendirme yok; Jinja isareti yok; bash -n', () => {
  const kod = KAYNAK.split('\n')
    .filter((s) => !/^\s*#/.test(s))
    .join('\n');
  const islemler = [...kod.matchAll(/--command="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(islemler, [
    '/host=$hst/server=$ad:read-children-resources(child-type=deployment,include-runtime=true,recursive=false)',
  ]);
  for (const kotu of [
    ':deploy',
    ':undeploy',
    ':remove',
    ':write-attribute',
    ':stop',
    ':start',
    ':reload',
    ':shutdown',
    ':add',
    ':kill',
  ])
    assert.ok(!kod.includes(kotu), `yazan CLI islemi: ${kotu}`);
  for (const kotu of [
    /\brm\b/,
    /\bmv\b/,
    /\bcp\b/,
    /\btee\b/,
    /\bchmod\b/,
    /\bchown\b/,
    /\bkill\b/,
    /\bmkdir\b/,
    /\btouch\b/,
    /\bdzdo\b/,
    /\bsudo\b/,
  ])
    assert.ok(!kotu.test(kod), `yazan / yetki degistiren komut: ${kotu}`);
  // Yonlendirme yalniz /dev/null'a ya da 2>&1.
  for (const m of kod.matchAll(/(\d?)>(>?)\s*(\S+)/g))
    assert.ok(m[3] === '/dev/null' || m[3].startsWith('&1'), `dosyaya yonlendirme: ${m[0]}`);
  for (const kotu of ['{{', '{%', '{#'])
    assert.ok(!KAYNAK.includes(kotu), `Jinja isareti: ${kotu}`);
  const r = spawnSync('bash', ['-n'], { input: KAYNAK });
  assert.equal(r.status, 0, String(r.stderr));
});
