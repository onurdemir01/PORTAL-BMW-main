// server/ansible/__tests__/nginx-loadtest-ayna.test.cjs - Nginx Hub Yuk Testi playbook aynasi ve kaydi.
//
// NEDEN: server/ansible/bmw_portal/nginx_loadtest/ AWX'in kosturdugu Ansible deposundaki
// bmw_portal/nginx_loadtest/ ile BAYT BAYT ayni olmali. nginx_console aynasi bir kez sessizce ayristi:
// Portal testleri AWX'in kosturmadigi bir dosyayi dogruluyordu. Ansible deposu CI'da yok, bu yuzden
// iki katman var:
//   NA1 aynadaki dosya kumesi ve her dosyanin sha256'si asagidaki SABIT listeyle ayni. Ayna bilerek
//       degistirildiyse liste de guncellenir VE ayni baytlar Ansible deposuna gider (zip ile).
//   NA2 NGINX_LOADTEST_ANSIBLE_DEPO=<Ansible deposu koku> verilirse iki kopya bayt bayt ayni
//       (opsx-was OW12 / logx X05 deseni); verilmezse ATLANIR (CI).
//   NA3 kayit: paths.cjs PLAYBOOKS.nginxLoadtest ve BEKLENEN_PLAYBOOK.nginx_loadtest_run; baska
//       playbook kosturan sablon 409 awx_template_playbook_mismatch ile reddedilir.
//   NA4 metin kurallari (Ansible deposundaki check_nginx_loadtest_job.py'nin CI'da kosabilen kismi):
//       LF, playbook'ta '#' satiri / ansible.builtin.script / strategy / poll: 0 yok, andigi her
//       files/<x> aynada var, set_stats nginx_loadtest_result son fail'den ONCE ve kosulsuz.
//   NA5 2026-10-27 inceleme kurallarinin CI'da kosabilen metin kismi (bekcinin L2/L5/L7'si): delegate_to
//       iceren play ignore_unreachable ve her delegate gorevinin HEMEN ardinda '<kayit> is unreachable'
//       fail'i (donguluyse ogeler de); localhost play'lerinde fail_msg DISINDA hicbir yerde (ifade, gorev adi,
//       msg, vars) ciplak yuk_islem / yuk_hedef_turu / yuk_motor yok; kaydedici KILL (-k) > Play 4 beklemesi
//       >= 290 sn; kaydedici hazir deseni (wait_for gibi cok satirli) /proc yarisi satirini hata saymaz;
//       senaryo yolunda ';' yasak; kaydedici yalniz kendi ADIM'inin satirini sayar; (7) Play 2 ve Play 3'un ilk
//       gorevi getent register edilir ve HEMEN ardindan '<kayit> is unreachable' fail'i 'erisilemedi (ssh): ...' der
//       (ignore_unreachable altinda erisilemeyen hostta getent yok sayilir; yoksa sonraki gorev tanimsiz getent_passwd
//       ile duser ve operator 'undefined variable' gorur; 2026-10-28).
//   NA7 Portal ile playbook'un ortak yuzeyi: dogrula.cjs EKSTRA_ANAHTARLAR = aynadaki README'nin
//       '| `yuk_*` |' tablo satirlari (30 degisken; bekcinin L3'u README = playbook kapisi der).
// Davranis (girdi kapisi, sonuc derlemesi, betikler) Ansible deposundaki bekcide; k6 mantigi
// nginx-loadtest-k6.test.cjs'te; wrk / Lua / playbook metin kurallari (NA6) nginx-loadtest-wrk.test.cjs'te.
// NGINX_LOADTEST_AYNA: mutasyon kopyasi dizini (verilmezse depodaki ayna).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { PLAYBOOKS, abs } = require('../paths.cjs');

const AYNA = path.join(__dirname, '..', 'bmw_portal', 'nginx_loadtest');
const DIR = process.env.NGINX_LOADTEST_AYNA || AYNA;

// Ayna degistiginde: dosyalari Ansible deposuyla ESLE, sonra bu listeyi guncelle (sha256sum).
const BEKLENEN = {
  'README.md': '9314418eea65c3928bde0735c7d6da65f12679c2ee559d31409ffa52502537c5',
  'files/cpu_kaydedici.sh': 'd9c5bff9ab329d2d48b1bc0383b9c13fcf907e5bda1840ae9a5ceb8bf7495ac8',
  'files/durdur.sh': 'd555cfc5731771f57711bccccbcc78f73c094f4f3a954c9430164ef4c61380e4',
  'files/kos.sh': 'c3574b1109369c002cf4d56141557bb1fbf74d5ad78f2d38dfb9167834d2fa5b',
  'files/on_kontrol.sh': '8b7f448d081b8fa22ecd9e0709b970379523e750a5850a25866127fec6ee9753',
  'files/wrk_kos.sh': '0e2ed64448ab7b11f4ca52798051fa15ce92f112b2794811b660e99f7697df8f',
  'files/yuk_k6.js': '7e8bee8da1af1e4a1b164dd732d45f9cf42cdff6d1b19948d9b6bed211e14967',
  'files/yuk_wrk.lua': '2a44afc388007721690e9cce4b736ed0175f128bf6ef1a44b59588f93605e16b',
  'nginx_loadtest.yml': '879645abdc18b35834a977796754355feb712781beceff687a92a6b82d15da9d',
};

function tumDosyalar(kok) {
  const out = [];
  const gez = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) gez(p);
      else out.push(p);
    }
  };
  gez(kok);
  // Ayrac platformdan bagimsiz: anahtarlar her zaman '/' ile.
  return out.map((p) => path.relative(kok, p).split(path.sep).join('/')).sort();
}

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const oku = (rel) => fs.readFileSync(path.join(DIR, ...rel.split('/')), 'utf8');

test('NA1 ayna dosya kumesi ve sha256 degerleri sabit listeyle ayni', () => {
  assert.deepEqual(tumDosyalar(DIR), Object.keys(BEKLENEN).sort(), 'aynada eksik/fazla dosya');
  const farkli = Object.entries(BEKLENEN)
    .filter(([rel, h]) => sha256(path.join(DIR, ...rel.split('/'))) !== h)
    .map(([rel]) => rel);
  assert.deepEqual(
    farkli,
    [],
    'ayna degismis: once Ansible deposundaki bmw_portal/nginx_loadtest ile esleyin, sonra BEKLENEN listesini ' +
      'guncelleyin (AWX ayni baytlari kosturmali)',
  );
});

const ANSIBLE_DEPO = process.env.NGINX_LOADTEST_ANSIBLE_DEPO || '';
test(
  'NA2 Portal ve Ansible deposundaki nginx_loadtest/** BAYT BAYT ayni',
  {
    skip: ANSIBLE_DEPO
      ? false
      : 'NGINX_LOADTEST_ANSIBLE_DEPO tanimli degil - yayinda iki depo icin elle (README "Bekciler")',
  },
  () => {
    const karsi = path.join(ANSIBLE_DEPO, 'bmw_portal', 'nginx_loadtest');
    const a = tumDosyalar(DIR);
    assert.deepEqual(a, tumDosyalar(karsi), 'dosya kumeleri farkli');
    for (const rel of a) {
      const parca = rel.split('/');
      assert.ok(
        fs.readFileSync(path.join(DIR, ...parca)).equals(fs.readFileSync(path.join(karsi, ...parca))),
        `${rel} iki depoda farkli`,
      );
    }
  },
);

function preflightYukle(sablonlar) {
  const runnerPath = require.resolve('../runner.cjs');
  const prePath = require.resolve('../template-preflight.cjs');
  const saved = require.cache[runnerPath];
  require.cache[runnerPath] = new Module(runnerPath, null);
  require.cache[runnerPath].exports = {
    getServers: () => [{ id: 1 }],
    listTemplatesForServer: async () => sablonlar,
  };
  require.cache[runnerPath].loaded = true;
  delete require.cache[prePath];
  const m = require('../template-preflight.cjs');
  return {
    m,
    restore: () => {
      if (saved) require.cache[runnerPath] = saved;
      else delete require.cache[runnerPath];
      delete require.cache[prePath];
    },
  };
}

test('NA3 kayit: PLAYBOOKS.nginxLoadtest aynadaki playbook, BEKLENEN_PLAYBOOK yanlis sablonu reddeder', async () => {
  assert.equal(PLAYBOOKS.nginxLoadtest, 'nginx_loadtest/nginx_loadtest.yml');
  // Kayit depodaki aynayi gosterir (NGINX_LOADTEST_AYNA mutasyon kopyasi kaydi degistirmez).
  assert.equal(path.resolve(abs(PLAYBOOKS.nginxLoadtest)), path.resolve(path.join(AYNA, 'nginx_loadtest.yml')));
  const T = (id, playbook) => ({ id, name: `tpl${id}`, playbook, ask_variables: true });
  let y = preflightYukle([T(7, 'bmw_portal/nginx_loadtest/nginx_loadtest.yml')]);
  try {
    assert.equal(y.m.BEKLENEN_PLAYBOOK.nginx_loadtest_run, 'nginx_loadtest.yml');
    await y.m.assertRegistryPlaybook(1, 7, 'nginx_loadtest_run');
  } finally {
    y.restore();
  }
  y = preflightYukle([T(8, 'bmw_portal/nginx_console/nginx_console_push.yml')]);
  try {
    await assert.rejects(
      () => y.m.assertRegistryPlaybook(1, 8, 'nginx_loadtest_run'),
      (e) => e.status === 409 && e.code === 'awx_template_playbook_mismatch' && /nginx_loadtest\.yml/.test(e.message),
    );
  } finally {
    y.restore();
  }
});

test('NA4 metin kurallari: LF, yorum/script/strategy/poll 0 yok, betikler var, set_stats fail oncesi', () => {
  for (const rel of Object.keys(BEKLENEN)) {
    assert.ok(!oku(rel).includes('\r'), `${rel} CRLF iceriyor`);
  }
  const yml = oku('nginx_loadtest.yml');
  assert.deepEqual(
    yml.split('\n').filter((l) => /^\s*#/.test(l)),
    [],
    "playbook'ta '#' satiri (aciklama README'ye)",
  );
  assert.ok(!/ansible\.builtin\.script\b|^\s*script:/m.test(yml), 'ansible.builtin.script yasak (kopya kapisi)');
  assert.ok(!/^\s*strategy:/m.test(yml), 'strategy yok (linear)');
  assert.ok(!/^\s*poll:\s*0\s*$/m.test(yml) && !/async_status/.test(yml), 'poll: 0 / async_status yok');
  assert.ok(!/^\s*limit:/m.test(yml) && !/LIMIT_MUAF=/.test(yml), 'limit / LIMIT_MUAF degeri yok');
  assert.ok(!yml.includes('\\"'), '\\" yok (Ansible {{ }} icinde patlar)');
  const anilan = new Set([...yml.matchAll(/files\/([A-Za-z0-9_.]+)/g)].map((m) => m[1]));
  for (const ad of ['kos.sh', 'yuk_k6.js', 'cpu_kaydedici.sh', 'on_kontrol.sh', 'wrk_kos.sh', 'yuk_wrk.lua']) {
    assert.ok(yml.includes(`'${ad}'`), `${ad} playbook'ta anilmiyor`);
    anilan.add(ad);
  }
  for (const ad of anilan) assert.ok(BEKLENEN[`files/${ad}`], `playbook'un andigi files/${ad} aynada yok`);
  const sonPlay = yml.slice(yml.lastIndexOf('\n- name:'));
  const ss = sonPlay.indexOf('ansible.builtin.set_stats:');
  const fail = sonPlay.lastIndexOf('ansible.builtin.fail:');
  assert.ok(ss > 0 && fail > ss, "son play'de set_stats, fail'den ONCE olmali");
  assert.equal((yml.match(/ansible\.builtin\.set_stats:/g) || []).length, 1, 'TEK set_stats yazari');
  assert.match(sonPlay, /nginx_loadtest_result: "\{\{ yt_sonuc \}\}"\n\s+per_host: false\n\s+aggregate: false/);
  const ssGorev = sonPlay.slice(sonPlay.lastIndexOf('- name:', ss), fail);
  assert.ok(!/\n\s+when:/.test(ssGorev.slice(0, ssGorev.indexOf('Sonuc ozeti'))), 'set_stats KOSULSUZ olmali');
});

// Ayni girintideki bir sonraki '- name:' satirinin indeksi (yoksa satir sayisi).
function sonrakiGorev(satirlar, bas, girinti) {
  let i = bas;
  while (i < satirlar.length && satirlar[i].indexOf('- name: ') !== girinti) i++;
  return i;
}

test('NA5 S8: delegate/unreachable, korumali yuk_islem, kaydedici KILL/bekleme, hazir deseni, ";" yasagi, ADIM suzgeci, getent erisilemezlik', () => {
  const yml = oku('nginx_loadtest.yml');
  const playlar = yml.split(/\n(?=- name: )/).filter((p) => /^ {2}hosts: /m.test(p));
  assert.equal(playlar.length, 8, 'play sayisi (test yanlis yere bakiyor olmasin)');

  // (1) GBLABT02 erisilemezse localhost play'den DUSMEMELI ve kopya 'tamam' sayilmamali.
  const delegeli = playlar.filter((p) => /^\s+delegate_to: /m.test(p));
  assert.ok(delegeli.length >= 1, 'delegate_to iceren play yok (test yanlis yere bakiyor)');
  for (const p of delegeli) {
    assert.match(p, /^ {2}ignore_unreachable: true$/m, 'delegate_to iceren play ignore_unreachable: true tasimali');
    const satirlar = p.split('\n');
    satirlar.forEach((s, i) => {
      if (!/^\s+delegate_to: /.test(s)) return;
      let b = i;
      while (b > 0 && !/^\s*- name: /.test(satirlar[b])) b--;
      const girinti = satirlar[b].indexOf('- name: ');
      const e = sonrakiGorev(satirlar, i + 1, girinti);
      const gorev = satirlar.slice(b, e).join('\n');
      const kayit = (gorev.match(/^\s+register: (\w+)$/m) || [])[1];
      assert.ok(kayit, `delegate gorevi register edilmeli: ${satirlar[b].trim()}`);
      const sonraki = satirlar.slice(e, sonrakiGorev(satirlar, e + 1, girinti)).join('\n');
      const kosul = (sonraki.match(/^\s+when: (.+)$/m) || [])[1] || '';
      assert.ok(
        /ansible\.builtin\.fail:/.test(sonraki) && kosul.includes(`${kayit} is unreachable`),
        `delegate gorevinden (${kayit}) HEMEN sonra 'when: ${kayit} is unreachable' fail'i gelmeli: ${kosul}`,
      );
      // Ansible dongu sonucuna ust duzey 'unreachable' yazmaz (yalniz ogelere): ogeler de denetlenmeli.
      if (/^\s+loop: /m.test(gorev)) {
        assert.ok(
          kosul.includes(`${kayit}.results`) && kosul.includes("selectattr('unreachable')"),
          `donguluyse ogeler de denetlenmeli: ${kosul}`,
        );
      }
    });
  }

  // (2) extra_var'siz kosuda localhost play'leri patlamamali: islem / hedef turu / motor adi fail_msg DISINDA
  // hicbir yerde (Jinja, gorev adi, msg, vars) ciplak gecmez (fail_msg duz metindir; Portal'a giden ret metni).
  for (const p of playlar.filter((x) => /^ {2}hosts: localhost$/m.test(x))) {
    const metin = p
      .split('\n')
      .filter((s) => !/^\s+fail_msg: /.test(s))
      .join('\n');
    const ciplak = [...metin.matchAll(/\b(yuk_islem|yuk_hedef_turu|yuk_motor)\b(?!\s*\|\s*default\()/g)].map((m) =>
      metin.slice(Math.max(0, m.index - 30), m.index + 30),
    );
    assert.deepEqual(ciplak, [], `localhost play'inde korumasiz yuk_islem / yuk_hedef_turu / yuk_motor: ${p.split('\n')[0]}`);
  }

  // (3) kaydedici: TERM timeout'a gider; '-k K' bitir'i keser. Play 4 W sn bekler: W >= 290 ve K > W.
  const k = Number((yml.match(/setsid nohup timeout -k ([0-9]+) /) || [])[1]);
  const w = Number(
    (yml.match(/Kaydedici bitene dek beklenir[^\n]*\n\s+ansible\.builtin\.wait_for:\n(?:\s+\w+: [^\n]*\n)*?\s+timeout: ([0-9]+)\n/) ||
      [])[1],
  );
  assert.ok(w >= 290 && k > w, `kaydedici: Play 4 bekleme ${w} sn (>= 290) ve Play 2 'timeout -k ${k}' (> bekleme) olmali`);

  // (4) hazir deseni: wait_for re.MULTILINE ile TUM dosyada ilk eslesmeyi alir (Python (?P<ad> -> JS (?<ad>).
  const desen = (yml.match(/^\s+search_regex: '([^']+)'$/m) || [])[1];
  assert.ok(desen, 'kaydedici bekleme deseni (search_regex) bulunamadi');
  const rx = new RegExp(desen.replace(/\(\?P</g, '(?<'), 'm');
  const grup = (s) => {
    const m = rx.exec(s);
    return m ? Object.keys(m.groups).filter((g) => m.groups[g] !== undefined) : null;
  };
  const BAS = '== cpu_kaydedici: adim=R17 host=gbngxt33 master=100 worker=2 nproc=4 clk_tck=100\n';
  const YUKU = '>>> 14:00:00 bos ornek tamam: YUKU SIMDI BASLATIN (yuk makinesinde ./kos.sh R17 ...)\n';
  const YARIS = '/home/www/.portal_yuktesti/17/cpu_kaydedici.sh: line 48: /proc/123/cmdline: No such file or directory\n';
  assert.deepEqual(grup(BAS + YARIS + YUKU), ['hazir'], '/proc yarisi satiri (betik hata satiri degil) kaydediciyi bozmamali');
  assert.deepEqual(grup(YARIS + BAS + YUKU), ['hazir'], '/proc yarisi YUKU oncesinde de hata sayilmamali');
  assert.deepEqual(grup('HATA: nginx master bulunamadi\n'), ['hata']);
  assert.deepEqual(grup('/bin/sh: line 1: setsid: command not found\n'), ['hata']);
  assert.deepEqual(grup("nohup: failed to run command 'timeout': No such file or directory\n"), ['hata']);
  assert.equal(grup(BAS), null, 'YUKU ve hata yokken eslesme olmamali');

  // (5) senaryo yolunda ';' yasak (;jsessionid: oturum bilgisi senaryoya giremez).
  const kotu = (yml.match(/^\s+yt_re_kotu_yol: '([^']*)'$/m) || [])[1] || '';
  assert.ok(kotu.split('|').includes(';'), `yt_re_kotu_yol ';' alternatifini icermeli: ${kotu}`);

  // (6) kaydedici yalniz kendi ADIM'inin satirini sayar (baska kosunun yetim k6'si 'diger').
  const kayd = oku('files/cpu_kaydedici.sh');
  assert.match(kayd, /\| awk [^\n]*-v ADIM="\$ADIM" '/, "log_cikar awk'ina -v ADIM verilmeli");
  assert.ok(
    kayd.includes('index($0, " user-agent=" UA "/" ADIM "_")') && kayd.includes('index($0, "\\"" UA "/" ADIM "_")'),
    'iki test satiri esiginde de <UA_ONEK>/<ADIM>_ aranmali',
  );

  // (7) Play 2 (hedef) ve Play 3 (yuk makinesi): blogun ilk gorevi getent (become: false, register) ve HEMEN ardindan
  // 'when: <kayit> is unreachable' fail'i; ileti trim + yazdirilabilir ASCII (play vars '[^ -~]') + en cok 160 karakter.
  for (const [i, ad] of [[1, 'hedef'], [2, 'yuk makinesi']]) {
    const p = playlar[i];
    const m =
      /\n {6}block:\n {8}- name: --- \[Task\] www ev dizini ---\n {10}become: false\n {10}ansible\.builtin\.getent:\n {12}database: passwd\n {12}key: www\n {10}register: (\w+)\n\n {8}- name: [^\n]+\n {10}ansible\.builtin\.fail:\n {12}msg: "([^\n]*)"\n {10}when: (\w+) is unreachable\n/.exec(
        p,
      );
    assert.ok(
      m &&
        m[3] === m[1] &&
        m[2] ===
          `erisilemedi (ssh): {{ ${m[1]}.msg | default('baglanti hatasi') | string | trim | regex_replace(yt_re_ascii_disi, '?') | truncate(160, true, '...', 0) }}`,
      `${ad} play'i: ilk gorev getent register edilip HEMEN ardindan 'when: <kayit> is unreachable' fail'i ('erisilemedi (ssh): ...') gelmeli: ${m ? m[0] : 'yok'}`,
    );
    assert.match(p, /^ {4}yt_re_ascii_disi: '\[\^ -~\]'$/m, `${ad} play vars: yt_re_ascii_disi '[^ -~]' (erisilemezlik iletisi yazdirilabilir ASCII)`);
  }
});

test('NA7 Portal EKSTRA_ANAHTARLAR = aynadaki README degisken tablosu (30 yuk_* satiri)', () => {
  // Ortak yuzey (sozlesme 3. bolum): Portal'in gonderdigi anahtarlar ile playbook'un kapisinin denetledigi anahtarlar.
  // Ansible bekcisi (L3) README tablosunu playbook'a, bu test Portal'a baglar; ikisi birlikte uc yuzu esitler.
  const tablo = new Set([...oku('README.md').matchAll(/^\|\s*`(yuk_[a-z0-9_]+)`\s*\|/gm)].map((m) => m[1]));
  assert.equal(tablo.size, 30, `README degisken tablosu 30 satir olmali: ${[...tablo].join(',')}`);
  const { EKSTRA_ANAHTARLAR } = require('../../nginx-loadtest/dogrula.cjs');
  const portal = new Set(EKSTRA_ANAHTARLAR);
  assert.equal(portal.size, EKSTRA_ANAHTARLAR.length, 'EKSTRA_ANAHTARLAR tekrar iceriyor');
  assert.deepEqual(
    [...portal].sort(),
    [...tablo].sort(),
    'Portal EKSTRA_ANAHTARLAR README / playbook sozlesmesiyle ayni degil (eksik/fazla anahtar son kapida red ya da yok sayilir)',
  );
});
