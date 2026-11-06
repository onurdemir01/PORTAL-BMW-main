// server/ansible/__tests__/ear-envanter-playbook.test.cjs — ear_envanter.yml sozlesmesi ve gercek kosu.
//
// EP1 basliktaki extra_vars listesi playbook'ta kullanilanlarla AYNI (belgelenmemis girdi yok)
// EP2 hedefte TEK gorev: `raw`, dzdo + was, kesin `timeout`, `no_log`, heredoc ACIK METIN (base64 yok)
// EP3 yapisal: tarama play'inde yalniz raw + set_fact + GBLABT02'ye (throttle 6, no_log) copy;
//     hedefe dosya yazan / betik kopyalayan gorev yok; girdi dogrulamasi + add_host; set_stats + fail
// EP4 raw komutu kabukta: python yoksa @@EAR_PYTHON_YOK@@; varsa paket isaretleri (heredoc saglam)
// EP5 GERCEK ansible-playbook: yerel hedefler, ulasilamayan host ULASILAMADI, /sw dosyalari,
//     set_stats ozeti; hedef agaci DEGISMEZ
// EP6 LIMIT KIPI (AWX'ten elle, hedefler yok): sunucular Limit'ten, cikti awx-<is>/raw, FQDN envanter
//     adi kisa BUYUK harf olur, set_stats kaynak AWX
// EP7 Limit BOS ve hedefler yok: is ilk play'de durur, hicbir sey taranmaz / yazilmaz; Limit var ama
//     awx_job_id yok (AWX disi): acik mesajla durur
// EP8 TUZAK: Portal kipi + dolu Limit -> localhost play'leri atlanir, is hicbir sey yapmadan biter
//     (Portal bu yuzden Limit alani dolu sablonla baslatmaz; davranis degisirse bu test haber verir)
// EP9 FAZ 2 GERCEK ansible-playbook (ear_deployment_kontrol=true): deployment blogu ayni dosyada tarama
//     paketinden SONRA; alim ikisini de okur; set_stats ozeti degismez; kapaliyken blok YOK
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pythonBul, ansiblePythonu } = require('./fixtures/python-bul.cjs');

const DIR = path.join(__dirname, '..', 'bmw_portal', 'ear_envanter');
const PLAYBOOK = path.join(DIR, 'ear_envanter.yml');
const METIN = fs.readFileSync(PLAYBOOK, 'utf8');
const KOD = METIN.split('\n')
  .filter((s) => !/^\s*#/.test(s))
  .join('\n');

const PYY = pythonBul();
const HAS_ANSIBLE = spawnSync('ansible-playbook', ['--version'], { stdio: 'ignore' }).status === 0;

function yamlOku() {
  const r = spawnSync(
    PYY.komut,
    [
      ...PYY.on,
      '-c',
      'import json, sys, yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))',
    ],
    { input: METIN },
  );
  assert.equal(r.status, 0, String(r.stderr));
  return JSON.parse(String(r.stdout));
}

test('EP1 basliktaki extra_vars listesi kullanilanlarla ayni', () => {
  const baslik = METIN.split('\n').filter((s) => s.startsWith('#'));
  const belgeli = new Set(
    baslik
      .map((s) => s.match(/^#\s{3}([a-z_]+):/))
      .filter(Boolean)
      .map((m) => m[1]),
  );
  for (const s of baslik) for (const m of s.matchAll(/\/ (ear_[a-z_]+):/g)) belgeli.add(m[1]);
  const kullanilan = new Set([...KOD.matchAll(/\b(hedefler|ear_[a-z_]+)\b/g)].map((m) => m[1]));
  // Playbook'un kendi ic adlari ve yol parcalari (girdi degil):
  for (const ic of [
    'ear_envanter',
    'ear_tara',
    'ear_hedefler',
    'ear_tarama',
    'ear_ozet',
    'ear_sonuclar',
    'ear_okuyan',
    'ear_cikti_dosyasi',
    'ear_envanter_result',
    'ear_yazici_host',
    'ear_parti_siniri',
    'ear_alt_dizin',
    'ear_host_adi',
    'ear_toplanan',
    'ear_deployment',
  ])
    kullanilan.delete(ic);
  const belgesiz = [...kullanilan].filter((v) => !belgeli.has(v));
  assert.deepEqual(belgesiz, [], `baslikta belgelenmemis girdi: ${belgesiz.join(', ')}`);
  const kullanilmayan = [...belgeli].filter((v) => v !== 'requester' && !kullanilan.has(v));
  assert.deepEqual(kullanilmayan, [], `belgelenip kullanilmayan: ${kullanilmayan.join(', ')}`);
});

test('EP2 hedefte tek raw: dzdo + was, kesin timeout, no_log, heredoc acik metin (base64 yok)', () => {
  assert.ok(!/b64|base64/i.test(KOD), 'playbook base64 ile kod calistirmamali');
  assert.match(KOD, /ansible\.builtin\.raw: \|\n/);
  assert.match(
    KOD,
    /"\$P" -B - <<'EAR_TARA_SON'\n/,
    'heredoc sinirlayicisi TIRNAKLI olmali (kabuk genisletmesi yok)',
  );
  assert.match(
    KOD,
    /\{\{ lookup\('ansible\.builtin\.file', 'files\/ear_tara\.py'\) \}\}\n\s*EAR_TARA_SON\n/,
  );
  assert.match(KOD, /for c in python3 \/usr\/libexec\/platform-python;/);
  assert.match(KOD, /PYTHONIOENCODING=utf-8:surrogateescape/);
  assert.match(KOD, /become_method: dzdo/);
  assert.match(KOD, /ear_okuma_kullanicisi \| default\('was'\)/);
  assert.match(KOD, /timeout: "\{\{ ear_zaman_asimi \| default\(600\) \| int \}\}"/);
  assert.ok(
    !/\bnamespace\b/.test(KOD),
    "Jinja'nin kendi adi `namespace` degisken olarak kullanilmaz",
  );
});

test(
  "EP3 yapisal: tarama play'i yalniz raw + set_fact + GBLABT02 copy; girdi dogrulama, add_host, set_stats",
  { skip: !PYY && 'PyYAML bulunamadi' },
  () => {
    const plays = yamlOku();
    assert.equal(plays.length, 4);
    const [hazirlik, limitHazirlik, tarama, toplayici] = plays;
    assert.equal(hazirlik.hosts, 'localhost');
    // Limit dolu iken localhost play'i atlanir; hedefler'siz buraya gelmek Limit'in bos oldugu demek.
    const secim = hazirlik.tasks[0];
    assert.ok(secim['ansible.builtin.fail'], 'ilk gorev sunucu secimi (Limit bos) olmali');
    assert.equal(secim.when, 'hedefler is not defined');
    assert.equal(limitHazirlik.hosts, "{{ 'localhost' if hedefler is defined else 'all' }}");
    for (const g of limitHazirlik.tasks) {
      assert.equal(g.run_once, true, `${g.name}: Limit kipinde tek kez`);
      assert.equal(g.when, 'hedefler is not defined', `${g.name}: Portal kipinde atlanmali`);
    }
    const assertGorev = hazirlik.tasks.find((t) => t['ansible.builtin.assert']);
    assert.ok(assertGorev, 'girdi dogrulamasi yok');
    assert.ok(
      assertGorev['ansible.builtin.assert'].that.some((k) =>
        k.includes("select('match', '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$')"),
      ),
      'host adi dogrulanmiyor',
    );
    assert.ok(
      hazirlik.tasks.some((t) => t['ansible.builtin.add_host']),
      "add_host yok (AWX limit'e guvenilmez)",
    );

    assert.equal(tarama.hosts, "{{ 'ear_hedefler' if hedefler is defined else 'all' }}");
    assert.equal(tarama.ignore_unreachable, true);
    const modul = (t) => Object.keys(t).find((k) => k.startsWith('ansible.builtin.'));
    // TUZAK 3: tek block + rescue; tum hostlar dusse de toplayici play'e ulasilir.
    assert.equal(tarama.tasks.length, 1, "tarama play'i tek block olmali");
    const blok = tarama.tasks[0];
    assert.deepEqual(blok.block.map(modul), [
      'ansible.builtin.raw',
      'ansible.builtin.set_fact',
      'ansible.builtin.raw',
      'ansible.builtin.copy',
    ]);
    assert.deepEqual(
      blok.rescue.map(modul),
      ['ansible.builtin.set_fact'],
      'rescue yalniz durum yazar',
    );
    assert.match(blok.rescue[0]['ansible.builtin.set_fact'].ear_ozet.durum, /YAZILAMADI/);
    const [raw, , dep, copy] = blok.block;
    for (const g of [raw, dep]) {
      assert.equal(g.no_log, true, `${g.name}: no_log`);
      assert.equal(g.failed_when, false, `${g.name}: failed_when`);
      assert.equal(g.changed_when, false, `${g.name}: changed_when`);
      assert.ok(g.timeout, `${g.name}: kesin zaman asimi yok`);
      assert.equal(g.become_method, 'dzdo', `${g.name}: dzdo`);
    }
    // FAZ 2 varsayilan KAPALI ve yalniz paket alindiysa; cikti ayni dosyaya tarama paketinden SONRA.
    assert.deepEqual(dep.when, ['ear_deployment_kontrol | default(false) | bool', 'ear_ozet.paket | bool']);
    assert.match(dep['ansible.builtin.raw'], /bash -s <<'EAR_DEPLOYMENT_SON'\n/, 'heredoc tirnakli olmali');
    assert.match(dep['ansible.builtin.raw'], /\{\{ lookup\('ansible\.builtin\.file', 'files\/deployment_oku\.sh'\) \}\}\nEAR_DEPLOYMENT_SON/);
    assert.equal(copy['ansible.builtin.copy'].content, "{{ ear_tarama.stdout }}{{ ear_deployment.stdout | default('') }}");
    assert.match(
      String(copy.delegate_to),
      /GBLABT02/,
      "/sw'ye yazma hedefte degil GBLABT02'de olmali",
    );
    assert.equal(copy.throttle, 6, 'sshd MaxSessions: en cok 6 eszamanli');
    assert.equal(copy.no_log, true);

    assert.equal(toplayici.hosts, "{{ 'localhost' if hedefler is defined else 'all' }}");
    for (const g of toplayici.tasks) assert.equal(g.run_once, true, `${g.name}: run_once yok`);
    const stats = toplayici.tasks.find((t) => t['ansible.builtin.set_stats'])[
      'ansible.builtin.set_stats'
    ].data.ear_envanter_result;
    for (const k of [
      'kosu_no',
      'parti_no',
      'kip',
      'playbook_surum',
      'kaynak',
      'awx_job_id',
      'limit',
      'beklenen',
      'sonuc_alinan',
      'hostlar',
    ])
      assert.ok(k in stats, `set_stats alani yok: ${k}`);
    assert.ok(
      toplayici.tasks.some((t) => t['ansible.builtin.fail'] && /length\) == 0/.test(t.when)),
      'hic sonuc yoksa is basarisiz olmali',
    );
  },
);

/** raw komutunu Jinja'siz kabuk metnine cevirir (Ansible'in uretecegi metin). */
function kabukKomutu(kokler) {
  // Girintiden bagimsiz: YAML literal blogu en kucuk ortak girinti kadar sola alinir (Ansible da boyle gorur).
  const satirlar = KOD.split('ansible.builtin.raw: |\n')[1].split('\n');
  const govde = satirlar.slice(
    0,
    satirlar.findIndex((s) => /^\s+register: ear_tarama/.test(s)),
  );
  const girinti = Math.min(...govde.filter((s) => s.trim()).map((s) => s.match(/^ */)[0].length));
  return (
    govde
      .map((s) => s.slice(girinti))
      .join('\n')
      // Fonksiyonla degistir: betikteki `$'` gibi diziler String.replace desenidir.
      .replace("{{ lookup('ansible.builtin.file', 'files/ear_tara.py') }}", () =>
        fs.readFileSync(path.join(DIR, 'files', 'ear_tara.py'), 'utf8').replace(/\n$/, ''),
      )
      .replace(/EAR_KOKLER=\{\{[^}]*\}\}/, `EAR_KOKLER='${kokler}'`)
      .replace(/\{\{ ear_kip[^}]*\}\}/, 'OZET')
      .replace(/\{\{ ([a-z_]+) \| default\((\d+)\) \| int \}\}/g, '$2')
  );
}

test('EP4 raw komutu kabukta: python yoksa PYTHON_YOK; varsa paket (heredoc saglam)', () => {
  const kok = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ear-ep4-')));
  fs.mkdirSync(path.join(kok, 'vhosting', 'A.ear', 'A.war', 'WEB-INF'), { recursive: true });
  const komut = kabukKomutu(path.join(kok, 'vhosting'));
  assert.ok(!komut.includes('{{') && !komut.includes('{%'), 'cevrilmemis Jinja kaldi');
  const var_ = spawnSync('/bin/sh', ['-c', komut], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.equal(var_.status, 0, var_.stderr);
  assert.match(var_.stdout, /@@EAR_ENVANTER_BASLA@@[\s\S]+@@EAR_ENVANTER_BITTI@@/);
  if (!fs.existsSync('/usr/libexec/platform-python')) {
    const yok = spawnSync('/bin/sh', ['-c', komut], {
      encoding: 'utf8',
      env: { PATH: '/var/empty' },
    });
    assert.match(yok.stdout, /@@EAR_PYTHON_YOK@@/);
  }
});

function goruntu(kok) {
  const out = {};
  const gez = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const st = fs.lstatSync(p, { bigint: true });
      out[path.relative(kok, p)] = [
        st.mode,
        st.size,
        st.mtimeNs,
        st.ino,
        st.ctimeNs,
        e.isFile() ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : '',
      ]
        .map(String)
        .join('|');
      if (e.isDirectory()) gez(p);
    }
  };
  gez(kok);
  return out;
}

test(
  'EP5 GERCEK ansible-playbook: dosyalar, set_stats ozeti, ULASILAMADI; hedef agaci degismez',
  { skip: !HAS_ANSIBLE && 'ansible-playbook yok' },
  () => {
    const kok = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ear-ep5-')));
    const a = path.join(kok, 'hostA', 'vhosting8', 'APP.ear', 'APP.war', 'WEB-INF');
    fs.mkdirSync(path.join(a, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(a, 'web.xml'), '<web-app/>');
    fs.writeFileSync(path.join(a, 'lib', 'spring-boot-4.0.8.jar'), 'x');
    fs.mkdirSync(path.join(kok, 'hostB'), { recursive: true });
    const once = goruntu(path.join(kok, 'hostA'));
    const py = ansiblePythonu() || 'python3';
    const inv = path.join(kok, 'envanter.ini');
    fs.writeFileSync(
      inv,
      [
        `localhost ansible_connection=local ansible_python_interpreter=${py}`,
        `GBLABT02 ansible_connection=local ansible_python_interpreter=${py}`,
        `HOSTA ansible_connection=local ear_kokler=${kok}/hostA/vhosting:${kok}/hostA/vhosting8`,
        `HOSTB ansible_connection=local ear_kokler=${kok}/hostB/vhosting:${kok}/hostB/vhosting8`,
        "HOSTX ansible_host=192.0.2.1 ansible_connection=ssh ansible_ssh_common_args='-o ConnectTimeout=2'",
        '',
      ].join('\n'),
    );
    const cikti = path.join(kok, 'sw', 'ear_envanter');
    const ev = {
      hedefler: ['hosta', 'hostb', 'hostx'],
      ear_kip: 'TAM',
      ear_kosu_no: 5,
      ear_parti_no: 2,
      ear_okuma_kullanicisi: '',
      ear_dizin: cikti,
    };
    const r = spawnSync('ansible-playbook', ['-i', inv, PLAYBOOK, '-e', JSON.stringify(ev)], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ANSIBLE_SHOW_CUSTOM_STATS: 'True',
        ANSIBLE_HOST_KEY_CHECKING: 'False',
        ANSIBLE_STDOUT_CALLBACK: 'default',
        ANSIBLE_NOCOLOR: '1',
      },
      timeout: 120000,
    });
    assert.equal(
      r.status,
      0,
      `ansible-playbook kod ${r.status}\n${r.stdout.slice(-1500)}\n${r.stderr.slice(-800)}`,
    );
    const run = r.stdout.split('\n').find((s) => s.includes('RUN: {'));
    assert.ok(run, 'CUSTOM STATS satiri yok');
    const ozet = JSON.parse(run.slice(run.indexOf('{'))).ear_envanter_result;
    assert.equal(Number(ozet.beklenen), 3);
    assert.equal(Number(ozet.sonuc_alinan), 2);
    assert.equal(Number(ozet.playbook_surum), 2);
    assert.equal(ozet.kaynak, 'PORTAL');
    const durum = Object.fromEntries(ozet.hostlar.map((h) => [h.host, h.durum]));
    assert.deepEqual(durum, { HOSTA: 'SONUC', HOSTB: 'SONUC', HOSTX: 'ULASILAMADI' });
    const ham = fs.readFileSync(path.join(cikti, 'kosu-5', 'raw', 'HOSTA.out'), 'utf8');
    const kod = ham
      .slice(ham.indexOf('@@EAR_ENVANTER_BASLA@@') + 22, ham.indexOf('@@EAR_ENVANTER_BITTI@@'))
      .replace(/\s+/g, '');
    const yuk = JSON.parse(zlib.inflateSync(Buffer.from(kod, 'base64')).toString('utf8'));
    assert.equal(yuk.kip, 'TAM');
    assert.equal(yuk.uygulamalar[0].ad, 'APP.ear');
    assert.ok(
      !fs.existsSync(path.join(cikti, 'kosu-5', 'raw', 'HOSTX.out')),
      'ulasilamayan host icin dosya yazilmamali',
    );
    const yukB = fs.readFileSync(path.join(cikti, 'kosu-5', 'raw', 'HOSTB.out'), 'utf8');
    assert.match(
      yukB,
      /@@EAR_ENVANTER_BITTI@@/,
      'kok yok sonucu da paket olarak gelmeli (KOK_YOK)',
    );
    const sonra = goruntu(path.join(kok, 'hostA'));
    assert.deepEqual(sonra, once, 'ansible kosusu hedef agacta bir sey degistirdi');
    assert.ok(
      !r.stdout.includes('spring-boot-4.0.8'),
      'tarama ciktisi AWX olay akisina sizdi (no_log)',
    );
  },
);

/**
 * EP6-EP8 icin: yerel envanter (HOSTA dolu, HOSTB kok yok, hostc FQDN, HOSTX ulasilamaz).
 * `localhostYok`: AWX envanteri gibi localhost satiri YOK (Ansible ortuk localhost kullanir).
 */
function limitOrtami(onEk, { localhostYok = false } = {}) {
  const kok = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), onEk)));
  const a = path.join(kok, 'hostA', 'vhosting8', 'APP.ear', 'APP.war', 'WEB-INF');
  fs.mkdirSync(path.join(a, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(a, 'web.xml'), '<web-app/>');
  fs.mkdirSync(path.join(kok, 'hostB'), { recursive: true });
  const py = ansiblePythonu() || 'python3';
  const inv = path.join(kok, 'envanter.ini');
  const kokler = (h) => `ear_kokler=${kok}/${h}/vhosting:${kok}/${h}/vhosting8`;
  fs.writeFileSync(
    inv,
    [
      localhostYok ? '' : `localhost ansible_connection=local ansible_python_interpreter=${py}`,
      `GBLABT02 ansible_connection=local ansible_python_interpreter=${py}`,
      `HOSTA ansible_connection=local ${kokler('hostA')}`,
      `HOSTB ansible_connection=local ${kokler('hostB')}`,
      `hostc.ornek.local ansible_connection=local ${kokler('hostA')}`,
      `HOSTD ansible_connection=local ${kokler('hostA')}`,
      "HOSTX ansible_host=192.0.2.1 ansible_connection=ssh ansible_ssh_common_args='-o ConnectTimeout=2'",
      '',
    ].join('\n'),
  );
  return { kok, inv, cikti: path.join(kok, 'sw', 'ear_envanter') };
}

function oynat(inv, ek, ev) {
  return spawnSync('ansible-playbook', ['-i', inv, PLAYBOOK, ...ek, '-e', JSON.stringify(ev)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ANSIBLE_SHOW_CUSTOM_STATS: 'True',
      ANSIBLE_HOST_KEY_CHECKING: 'False',
      ANSIBLE_STDOUT_CALLBACK: 'default',
      ANSIBLE_NOCOLOR: '1',
    },
    timeout: 120000,
  });
}

function ozetOku(r) {
  const run = r.stdout.split('\n').find((s) => s.includes('RUN: {'));
  return run ? JSON.parse(run.slice(run.indexOf('{'))).ear_envanter_result : null;
}

test(
  'EP6 Limit kipi: sunucular Limit alanindan, cikti awx-<is>, FQDN kisa ad, kaynak AWX',
  { skip: !HAS_ANSIBLE && 'ansible-playbook yok' },
  () => {
    const { inv, cikti } = limitOrtami('ear-ep6-', { localhostYok: true });
    const r = oynat(inv, ['-l', 'HOSTA,HOSTB,hostc.ornek.local,HOSTX'], {
      awx_job_id: 777,
      ear_kip: 'OZET',
      ear_okuma_kullanicisi: '',
      ear_dizin: cikti,
    });
    assert.equal(r.status, 0, `kod ${r.status}\n${r.stdout.slice(-1500)}\n${r.stderr.slice(-800)}`);
    const ozet = ozetOku(r);
    assert.ok(ozet, 'CUSTOM STATS satiri yok');
    assert.equal(ozet.kaynak, 'AWX');
    assert.equal(Number(ozet.awx_job_id), 777);
    assert.equal(Number(ozet.kosu_no), 0);
    assert.equal(Number(ozet.playbook_surum), 2);
    assert.equal(ozet.limit, 'HOSTA,HOSTB,hostc.ornek.local,HOSTX');
    assert.equal(Number(ozet.beklenen), 4, 'beklenen = Limit\'teki host sayisi');
    assert.equal(Number(ozet.sonuc_alinan), 3);
    const durum = Object.fromEntries(ozet.hostlar.map((h) => [h.host, h.durum]));
    assert.deepEqual(durum, { HOSTA: 'SONUC', HOSTB: 'SONUC', HOSTC: 'SONUC', HOSTX: 'ULASILAMADI' });
    const raw = path.join(cikti, 'awx-777', 'raw');
    assert.deepEqual(fs.readdirSync(raw).sort(), ['HOSTA.out', 'HOSTB.out', 'HOSTC.out']);
    assert.ok(!fs.existsSync(path.join(raw, 'HOSTD.out')), "Limit disindaki host taranmamali");
    assert.ok(!fs.existsSync(path.join(cikti, 'kosu-0')), 'Limit kipinde kosu-<n> dizini acilmaz');
  },
);

test(
  'EP7 Limit bos ve hedefler yok: is ilk play\'de durur, hicbir sey taranmaz',
  { skip: !HAS_ANSIBLE && 'ansible-playbook yok' },
  () => {
    const { inv, cikti } = limitOrtami('ear-ep7-');
    const r = oynat(inv, [], { awx_job_id: 778, ear_okuma_kullanicisi: '', ear_dizin: cikti });
    assert.notEqual(r.status, 0, 'Limit bosken is basarili bitmemeli');
    assert.match(r.stdout, /Sunucu secilmedi: AWX'te Limit alanina/);
    assert.equal(ozetOku(r), null, 'set_stats yayinlanmamali');
    assert.ok(!fs.existsSync(cikti), "hicbir sey /sw'ye yazilmamali");
    assert.ok(!/TASK \[--- \[Task\] Tara/.test(r.stdout), 'tarama gorevi calismamali');

    // AWX disinda Limit ile kosulup is numarasi verilmezse: acik mesajla durur, dizin acilmaz.
    const r2 = oynat(inv, ['-l', 'HOSTA'], { ear_okuma_kullanicisi: '', ear_dizin: cikti });
    assert.notEqual(r2.status, 0, 'awx_job_id yokken is basarili bitmemeli');
    assert.match(r2.stdout, /Gecersiz girdi \(Limit kipi\): awx_job_id/);
    assert.ok(!fs.existsSync(cikti), "awx_job_id yokken /sw'de dizin acilmamali");
  },
);

test(
  'EP8 TUZAK: Portal kipi + dolu Limit -> localhost play\'leri atlanir, is hicbir sey yapmadan biter',
  { skip: !HAS_ANSIBLE && 'ansible-playbook yok' },
  () => {
    // AWX envanterinde localhost satiri yoktur: ortuk localhost `all` ile de eslesmez.
    const { inv, cikti } = limitOrtami('ear-ep8-', { localhostYok: true });
    for (const limit of ['all', 'HOSTA']) {
      const r = oynat(inv, ['-l', limit], {
        hedefler: ['HOSTA'],
        ear_kosu_no: 9,
        ear_parti_no: 1,
        ear_okuma_kullanicisi: '',
        ear_dizin: cikti,
      });
      // Bu davranis Portal'in Limit dolu sablonu reddetmesinin SEBEBI: is "basarili" ama bos.
      assert.equal(r.status, 0, `${limit}: ${r.stdout.slice(-800)}`);
      assert.equal(ozetOku(r), null, `${limit}: set_stats yayinlandi`);
      assert.ok(!fs.existsSync(cikti), `${limit}: /sw'ye yazildi`);
    }
  },
);

test(
  'EP9 Faz 2: ear_deployment_kontrol=true -> deployment blogu ayni dosyada, paketten sonra; alim okur',
  { skip: !HAS_ANSIBLE && 'ansible-playbook yok' },
  () => {
    const alim = require('../../server-hub/ear-envanter-alim.cjs');
    const { inv, cikti } = limitOrtami('ear-ep9-');
    const ev = {
      hedefler: ['hosta', 'hostb'],
      ear_kip: 'OZET',
      ear_kosu_no: 9,
      ear_parti_no: 1,
      ear_okuma_kullanicisi: '',
      ear_dizin: cikti,
      ear_deployment_kontrol: true,
      ear_dep_sure: 30,
    };
    const r = oynat(inv, [], ev);
    assert.equal(r.status, 0, `ansible-playbook kod ${r.status}\n${r.stdout.slice(-1500)}\n${r.stderr.slice(-800)}`);
    const ozet = ozetOku(r);
    assert.equal(Number(ozet.sonuc_alinan), 2);
    const buf = fs.readFileSync(path.join(cikti, 'kosu-9', 'raw', 'HOSTA.out'));
    const p = buf.indexOf('@@EAR_ENVANTER_BITTI@@');
    const d = buf.indexOf('@@EAR_DEPLOYMENT_BASLA@@');
    assert.ok(p > 0 && d > p, 'deployment blogu tarama paketinden SONRA olmali');
    assert.deepEqual(
      alim.paketCoz(buf).uygulamalar.map((u) => u.ad),
      ['APP.ear'],
      'tarama paketi deployment blogundan etkilenmeden okunmali',
    );
    const dep = alim.deploymentCoz(buf);
    assert.equal(dep.surum, 1);
    assert.equal(dep.kesik, false, 'blok BITTI ile kapanmali');
    // Kapali (varsayilan): blok yok.
    const r2 = oynat(inv, [], { ...ev, ear_kosu_no: 10, ear_deployment_kontrol: false });
    assert.equal(r2.status, 0);
    const buf2 = fs.readFileSync(path.join(cikti, 'kosu-10', 'raw', 'HOSTA.out'));
    assert.equal(alim.deploymentCoz(buf2), null, 'kapaliyken deployment blogu yazildi');
  },
);
