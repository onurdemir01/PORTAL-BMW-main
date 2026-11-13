// server/ansible/__tests__/nginx-loadtest-nginxsiz.test.cjs - Yuk Testi tek hedef modeli (2026-11-13): her dbo.Inventory
// DEV/TEST/QA makinesi hedef ya da yuk makinesi olabilir; nginx hedefte OLCULEREK bulunur (NA10).
//
// NEDEN: kullanici karari "hedef ile yuk makinesinin ne oldugunun teknik onemi yok". Ortam kapisi Portal'da (dbo.Inventory);
// playbook ad kuralini artik aramaz ama EDU / uretim adi / hedef != yuk / IP yerel kanitini birakmaz. Nginx olmayan
// hedefte sunucu ayari ve log ayrisimi YAPILMAZ, yalniz genel CPU olculur. Bu test o satirlari kilitler:
//   (a) Play 1: yt_extra_load_hosts / yt_cpu_target_extra_hosts yok; ilk assert'te yuk_hedef_host / yuk_yuk_host icin
//       yt_re_nonprod_adi eslemesi YOK, ikisi icin de EDU + yt_re_prod_adi reddi VAR, hedef != yuk; yt_re_prod_adi
//       Portal envOfHost'un PROD kalibiyla ayni ('^(GBRVP|GBNG[WX]A?P)').
//   (b) Play 2: nginx tespiti (on_kontrol.sh nginx) kopya kapisindan SONRA, sunucu ayari blogundan ONCE; sunucu ayari
//       blogunun when'inde yt_hedef_nginx == '1'; kosuda belirsiz ('-') ve "ayar istendi ama nginx yok" fail'leri;
//       on kontrolde ayar istendi ama nginx yoksa yt_hz_sonuc FAIL (Play 10 engeli).
//   (c) Play 2 kosu: ip_yerel kosu kapisi IKI kaydedici baslatmasindan da ONCE; genel kaydedici ROL=hedef,
//       SONUC=yt_dizin (Play 5 <dizin>/R<id>'yi toplar), ayni kaydedici.pid / kaydedici.out, when '0'; nginx kaydedicisi
//       when '1'; kosu kopya listesinde yuk_cpu_kaydedici.sh.
//   (d) Play 4: cmdline kaniti yt_kaydedici_betik ile, ozet deseni genelde hedefcpu_*.txt.
//   (e) Play 10: on_kontrol ve kosu bolumlerinde hedef_nginx; kosu.hedef_kaydedici; /web_log engeli yalniz hedef_nginx
//       true iken; belirsiz engel metni.
//   (f) bash varsa: on_kontrol.sh nginx dort durumu (master x nginx -T) -> 1 / - / - / 0; hedef kipinin satir sirasi
//       degismedi.
//   (g) bash varsa: yuk_cpu_kaydedici.sh varsayilan (ROL=yuk) yukcpu_ (eski adlar, anahtarlar, duyuru yok); ROL=hedef
//       hedefcpu_ + rol=hedef + duyuru; gecersiz ROL / BOSTA_BAS rc 2, dosya yazilmaz.
// Jinja davranisi Ansible deposundaki bekcide; burada metin. NGINX_LOADTEST_AYNA: mutasyon kopyasi dizini.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BASH, posixYol, kabukPath } = require('./fixtures/kabuk.cjs');

const DIR = process.env.NGINX_LOADTEST_AYNA || path.join(__dirname, '..', 'bmw_portal', 'nginx_loadtest');
const oku = (rel) => fs.readFileSync(path.join(DIR, ...rel.split('/')), 'utf8');

function playlar() {
  const p = oku('nginx_loadtest.yml')
    .split(/\n(?=- name: )/)
    .filter((x) => /^ {2}hosts: /m.test(x));
  assert.equal(p.length, 10, 'play sayisi (test yanlis yere bakiyor olmasin)');
  return p;
}

// Gorev parcalari: her '- name:' satirindan bir sonraki '- name:' satirina kadar.
function gorevler(play) {
  const s = play.split('\n');
  const bas = s.map((x, i) => (/^\s*- name: /.test(x) ? i : -1)).filter((i) => i >= 0);
  return bas.map((b, k) => s.slice(b, k + 1 < bas.length ? bas[k + 1] : s.length).join('\n'));
}

test('NA10 (a) Play 1: ad kurali ve ek liste yok; EDU + uretim adi reddi, hedef != yuk', () => {
  const yml = oku('nginx_loadtest.yml');
  for (const ad of ['yt_extra_load_hosts', 'yt_cpu_target_extra_hosts', 'yuk_hedef_cpu_host']) {
    assert.ok(!yml.includes(ad), `${ad} kalkti (tek hedef modeli)`);
  }
  const p1 = playlar()[0];
  assert.match(p1, /^ {4}yt_re_prod_adi: '\^\(GBRVP\|GBNG\[WX\]A\?P\)'$/m, 'uretim adi kalibi (Portal envOfHost PROD)');
  const ilk = gorevler(p1).find((x) => x.includes('Operation, run id, target type, target and load host'));
  assert.ok(ilk, 'ilk assert bulunamadi');
  assert.ok(!/(yuk_hedef_host|yuk_yuk_host)[^\n]*yt_re_nonprod_adi/.test(ilk), 'hedef / yuk makinesi icin ad kurali ARANMAZ');
  const s = ilk.split('\n').map((x) => x.trim());
  const var_ = (m) => assert.ok(s.includes(m), `ilk assert satiri yok: ${m}`);
  var_("- (((yuk_hedef_host | string) not in yt_edu_hostlari) if ((yuk_hedef_turu | default('sunucu') | string) == 'sunucu') else true)");
  var_("- ((not ((yuk_hedef_host | string) is match(yt_re_prod_adi))) if ((yuk_hedef_turu | default('sunucu') | string) == 'sunucu') else true)");
  var_('- (yuk_yuk_host | string) not in yt_edu_hostlari');
  var_('- not ((yuk_yuk_host | string) is match(yt_re_prod_adi))');
  var_("- (yuk_hedef_host | default('') | string) != (yuk_yuk_host | string)");
  var_("- (yuk_yuk_host | default('') | string) is match(yt_re_host)");
});

test('NA10 (b) Play 2: nginx tespiti kopya kapisindan sonra, sunucu ayarindan once; ayar yalniz nginx 1', () => {
  const p2 = playlar()[1];
  const kopya = p2.indexOf('- name: --- [Task] Kopya dogrulanamadiysa DUR ---');
  const tespit = p2.indexOf('- name: --- [Task] Detect nginx on the target (on_kontrol.sh nginx; read only) ---');
  const ayar = p2.indexOf('- name: --- [Task] Sunucu ayari (on kontrol ve kosu oncesi; kaydedici baslamadan ONCE) ---');
  const kaydedici = p2.indexOf('- name: --- [Task] CPU kaydedici (hedef) ---');
  assert.ok(kopya > 0 && tespit > kopya && ayar > tespit && kaydedici > ayar, 'sira: kopya kapisi -> nginx tespiti -> sunucu ayari -> kaydedici');
  const g = gorevler(p2);
  const t = g.find((x) => x.includes('Detect nginx on the target'));
  assert.ok(t.includes('- "{{ yt_dizin }}/on_kontrol.sh"\n                  - nginx\n'), 'on_kontrol.sh nginx kipi');
  assert.ok(t.includes('register: yt_ng_run') && t.includes('failed_when: false'), 'kayit ve failed_when false');
  const sonuc = g.find((x) => x.includes('Nginx detection result'));
  assert.ok(sonuc.includes("yt_hedef_nginx: \"{{ ((yt_ng_run.stdout_lines | default([]) | select('match', '^nginx_var\\t')"), 'yt_hedef_nginx nginx_var satirindan');
  assert.ok(sonuc.includes("default('nginx_var\\t-')"), 'satir yoksa belirsiz (-), nginx ya da yok sayilmaz');
  const ayarBlok = g.find((x) => x.includes('Sunucu ayari (on kontrol ve kosu oncesi'));
  assert.ok(
    ayarBlok.includes("when: (yuk_islem in ['on_kontrol', 'kosu']) and ((yuk_srv_ayar | default('0') | string) == '1') and ((yt_hedef_nginx | default('-')) == '1')"),
    'sunucu ayari yalniz nginx tespit edilen hedefte',
  );
  const gerek = g.find((x) => x.includes('Server settings need nginx'));
  assert.ok(gerek.includes("'SONUC', 'FAIL'") && gerek.includes("when: ((yuk_srv_ayar | default('0') | string) == '1') and (yt_hedef_nginx != '1')"), 'on kontrolde ayar + nginx yok -> yt_hz_sonuc FAIL');
  const belirsiz = g.find((x) => x.includes('Stop: nginx state unclear (kosu)'));
  assert.ok(belirsiz.includes('ansible.builtin.fail:') && belirsiz.includes("when: (yuk_islem == 'kosu') and (yt_hedef_nginx not in ['0', '1'])"), 'kosuda belirsiz -> fail');
  const srvYok = g.find((x) => x.includes('Stop: server settings requested but nginx not detected (kosu)'));
  assert.ok(
    srvYok.includes('ansible.builtin.fail:') && srvYok.includes("when: (yuk_islem == 'kosu') and ((yuk_srv_ayar | default('0') | string) == '1') and (yt_hedef_nginx != '1')"),
    'kosuda ayar istendi ama nginx yok -> fail',
  );
});

test('NA10 (c) Play 2 kosu: ip_yerel kapisi iki kaydedicinin de ONCESINDE; genel kaydedici ROL=hedef', () => {
  const p2 = playlar()[1];
  const g = gorevler(p2);
  const kopya = g.find((x) => x.includes('- name: --- [Task] Betikler kosu dizinine ---'));
  assert.ok(kopya.includes("['cpu_kaydedici.sh', 'on_kontrol.sh', 'yuk_cpu_kaydedici.sh']"), 'kosu kopya listesinde genel kaydedici');
  const kapi = p2.indexOf("when: yt_kosu_ip_yerel != '1'");
  const belirsiz = p2.indexOf('Stop: nginx state unclear (kosu)');
  const nginxK = g.find((x) => x.includes('Kaydedici ayrik baslatilir (setsid nohup timeout; pid dosyasi)'));
  const genelK = g.find((x) => x.includes('Generic host CPU recorder started detached'));
  assert.ok(nginxK && genelK, 'iki kaydedici baslatmasi');
  assert.ok(kapi > 0 && belirsiz > 0 && p2.indexOf(nginxK) > kapi && p2.indexOf(genelK) > kapi && p2.indexOf(nginxK) > belirsiz, 'ip_yerel kapisi ve belirsiz fail iki baslatmadan da ONCE');
  assert.ok(nginxK.includes("/cpu_kaydedici.sh') | quote }}") && nginxK.includes("when: yt_hedef_nginx == '1'"), 'nginx kaydedicisi yalniz 1');
  assert.ok(genelK.includes("/yuk_cpu_kaydedici.sh') | quote }}") && genelK.includes("when: yt_hedef_nginx == '0'"), 'genel kaydedici yalniz 0');
  for (const parca of ['env ROL=hedef ', 'SONUC={{ yt_dizin | quote }}', 'BOSTA_BAS={{ yuk_bosta_bas_sn | int }}', "HEDEF_IP={{ yuk_hedef_ip | quote }}", "R{{ yuk_run_id | int }} > {{ (yt_dizin ~ '/kaydedici.out') | quote }}", "echo $! > {{ (yt_dizin ~ '/kaydedici.pid') | quote }}"]) {
    assert.ok(genelK.includes(parca), `genel kaydedici: ${parca}`);
  }
  const secim = g.find((x) => x.includes('Recorder script by nginx detection'));
  assert.ok(secim && p2.indexOf(secim) > kapi && secim.includes("'cpu_kaydedici.sh' if (yt_hedef_nginx == '1') else 'yuk_cpu_kaydedici.sh'"), 'yt_kaydedici_betik secimi');
});

test('NA10 (d) Play 4: kaydedici kaniti ve ozet deseni secilen betige gore', () => {
  const p4 = playlar()[3];
  assert.ok(p4.includes("((yt_dizin ~ '/' ~ (yt_kaydedici_betik | default('cpu_kaydedici.sh'))) in (yt_kcmd.content | b64decode))"), 'cmdline kaniti yt_kaydedici_betik');
  assert.ok(!p4.includes("(yt_dizin ~ '/cpu_kaydedici.sh') in"), 'sabit cpu_kaydedici.sh kaniti kalmadi');
  assert.ok(p4.includes("patterns: \"{{ 'bilgi_*.txt' if ((yt_kaydedici_betik | default('cpu_kaydedici.sh')) == 'cpu_kaydedici.sh') else 'hedefcpu_*.txt' }}\""), 'ozet deseni');
});

test('NA10 (e) Play 10: hedef_nginx alanlari, log engeli yalniz nginx true, belirsiz engel', () => {
  const p = playlar();
  const son = p[p.length - 1];
  const onk = gorevler(son).find((x) => x.includes('- name: --- [Task] On kontrol bolumu ---'));
  const kosu = gorevler(son).find((x) => x.includes('- name: --- [Task] Kosu bolumu ---'));
  const eng = gorevler(son).find((x) => x.includes('- name: --- [Task] On kontrol engelleri'));
  const esle = "'hedef_nginx': ((({'1': true, '0': false})[hostvars[yuk_hedef_host].yt_hedef_nginx | default('-')] | default(none)) if (yt8_tur == 'sunucu') else none),";
  assert.ok(onk.includes(esle) && onk.includes("'hedef_nproc': "), 'on_kontrol.hedef_nginx / hedef_nproc');
  assert.ok(kosu.includes(esle), 'kosu.hedef_nginx');
  assert.ok(kosu.includes("'hedef_kaydedici': ((({'cpu_kaydedici.sh': 'nginx', 'yuk_cpu_kaydedici.sh': 'genel'})"), 'kosu.hedef_kaydedici');
  assert.ok(eng.includes("(['log dizini /web_log okunamiyor'] if ((yt8_tur == 'sunucu') and (yt_s_onk.hedef_nginx is sameas true) and not yt_s_onk.log_dizini_okunur) else [])"), '/web_log engeli yalniz nginx hedefte');
  assert.ok(eng.includes("'hedef: nginx durumu belirlenemedi (nginx_T '") && eng.includes('(yt_s_onk.hedef_nginx is none) and (hostvars[yuk_hedef_host].yt_hedef_nginx is defined)'), 'belirsiz engel (tespit kostuysa)');
});

const bashVar = spawnSync(BASH, ['-c', 'echo ok'], { encoding: 'utf8' }).stdout === 'ok\n';

test('NA10 (f) bash: on_kontrol.sh nginx uc durum; hedef kipinin satir sirasi degismedi', { skip: bashVar ? false : 'bash yok' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nlngx_'));
  try {
    const bin = path.join(d, 'bin');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(d, 'proc', '7'), { recursive: true });
    fs.writeFileSync(path.join(bin, 'dzdo'), '#!/bin/bash\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'ngok'), '#!/bin/bash\necho "server_name a.b.c;"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'ngfail'), '#!/bin/bash\nexit 1\n', { mode: 0o755 });
    const master = (var_) => {
      const f = path.join(d, 'proc', '7', 'cmdline');
      if (var_) fs.writeFileSync(f, 'nginx: master process /usr/nginx/sbin/nginx\0');
      else fs.rmSync(f, { force: true });
    };
    const kos = (kip, ngbin, ek = {}) =>
      spawnSync(BASH, [posixYol(path.join(DIR, 'files', 'on_kontrol.sh')), kip], {
        cwd: d,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, PATH: kabukPath(bin), PROC_ROOT: posixYol(path.join(d, 'proc')), NGINX_BIN: posixYol(path.join(bin, ngbin)), ...ek },
      });
    const deger = (out, k) => ((new RegExp(`^${k}\\t(.*)$`, 'm').exec(out) || [])[1]);
    for (const [m, ng, beklenen, tok] of [
      [true, 'ngok', '1', 'ok'],
      [true, 'ngfail', '-', 'fail'],
      [false, 'ngok', '-', 'ok'],
      [false, 'yok', '0', 'fail'],
    ]) {
      master(m);
      const r = kos('nginx', ng);
      assert.equal(r.status, 0, r.stderr);
      const etiket = `master ${m ? 1 : 0}, ${ng}`;
      assert.deepEqual(
        r.stdout.split('\n').filter(Boolean).map((x) => x.split('\t')[0]),
        ['nginx_bin', 'nginx_T', 'master_sayisi', 'nginx_var', 'nproc', 'SONUC'],
        `nginx kipi satirlari (${etiket})`,
      );
      assert.equal(deger(r.stdout, 'nginx_var'), beklenen, `nginx_var (${etiket})`);
      assert.equal(deger(r.stdout, 'nginx_T'), tok, `nginx_T (${etiket})`);
      assert.equal(deger(r.stdout, 'master_sayisi'), m ? '1' : '0', `master_sayisi (${etiket})`);
      assert.equal(deger(r.stdout, 'nginx_bin'), ng === 'yok' ? '0' : '1', `nginx_bin (${etiket})`);
      assert.match(deger(r.stdout, 'nproc'), /^([0-9]+|-)$/);
      assert.match(r.stdout, /^SONUC\tOK\tnginx olculdu$/m);
    }
    master(true);
    const h = kos('hedef', 'ngok', { HEDEF_IP: '10.9.9.9', HOST_BASLIGI: 'a.b.c', LOGDIR: posixYol(d), UST: posixYol(d) });
    assert.equal(h.status, 0, h.stderr);
    assert.deepEqual(
      h.stdout.split('\n').filter(Boolean).map((x) => x.split('\t')[0]),
      ['ip_yerel', 'nginx_T', 'server_name_var', 'log_format_ua', 'statik_direktif', 'master_sayisi', 'web_log_df', 'log_dizini_okunur', 'hazirlik_yedek', 'SONUC'],
      'hedef kipi satir sirasi (Portal ve Ansible bekcisi buna dayanir)',
    );
    assert.equal(deger(h.stdout, 'server_name_var'), '1');
    assert.equal(deger(h.stdout, 'master_sayisi'), '1');
    const u = kos('bilinmeyen', 'ngok');
    assert.equal(u.status, 2);
    assert.match(u.stdout, /^SONUC\tFAIL\tkullanim: on_kontrol.sh hedef\|nginx\|yollar$/m);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function sahteProc(d) {
  fs.mkdirSync(path.join(d, 'proc', 'net'), { recursive: true });
  fs.writeFileSync(path.join(d, 'proc', 'stat'), 'cpu  100 2 30 400 5 0 1 0 0 0\ncpu0 1 1 1 1\n');
  fs.writeFileSync(path.join(d, 'proc', 'meminfo'), 'MemTotal: 1000 kB\nMemFree: 1 kB\nMemAvailable: 500 kB\n');
  fs.writeFileSync(path.join(d, 'proc', 'net', 'dev'), 'Inter-|   Receive\n face |bytes\n    lo: 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16\n  eth0: 100 2 0 0 0 0 0 0 200 3 0 0 0 0 0 0\n');
}

test('NA10 (g) bash: yuk_cpu_kaydedici.sh ROL=yuk (varsayilan) / ROL=hedef / gecersiz', { skip: bashVar ? false : 'bash yok' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nlhcpu_'));
  try {
    sahteProc(d);
    const kos = (sonuc, ortam) =>
      spawnSync(BASH, [posixYol(path.join(DIR, 'files', 'yuk_cpu_kaydedici.sh')), 'R5'], {
        cwd: d,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, ROL: '', BOSTA_BAS: '', PROC_ROOT: './proc', SONUC: `./${sonuc}`, SURE: '1', HEDEF_IP: '10.1.2.3', ...ortam },
      });
    const dosyalar = (s) => fs.readdirSync(path.join(d, s, 'R5')).sort();
    const metin = (s, onek, uz) => {
      const ad = dosyalar(s).find((x) => x.startsWith(onek) && x.endsWith(uz));
      return ad ? fs.readFileSync(path.join(d, s, 'R5', ad), 'utf8') : '';
    };
    let r = kos('yuk', {});
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(dosyalar('yuk').map((x) => x.replace(/_R5_.*\./, '_R5_H.')), ['ag_R5_H.csv', 'ag_R5_H.txt', 'yukcpu_R5_H.csv', 'yukcpu_R5_H.txt']);
    assert.ok(!r.stdout.includes('YUKU SIMDI BASLATIN'), 'varsayilan (ROL=yuk, BOSTA_BAS=0): duyuru satiri YOK (cikti eskisiyle ayni)');
    assert.match(metin('yuk', 'ag_', '.txt'), /^rol=yuk$/m);
    assert.deepEqual(
      metin('yuk', 'yukcpu_', '.txt').split('\n').filter(Boolean).map((x) => x.split('=')[0]),
      ['surum', 'adim', 'host', 'nproc', 'clk_tck', 'bas_epoch', 'bit_epoch', 'ornek_sayisi'],
      'yukcpu_*.txt anahtarlari degismedi',
    );
    const BASLIK = 'epoch,cpu_user,cpu_nice,cpu_system,cpu_idle,cpu_iowait,cpu_irq,cpu_softirq,cpu_steal,mem_total_kb,mem_available_kb,arac_rss_kb';
    assert.equal(metin('yuk', 'yukcpu_', '.csv').split('\n')[0], BASLIK);

    r = kos('hed', { ROL: 'hedef', BOSTA_BAS: '0' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(dosyalar('hed').map((x) => x.replace(/_R5_.*\./, '_R5_H.')), ['ag_R5_H.csv', 'ag_R5_H.txt', 'hedefcpu_R5_H.csv', 'hedefcpu_R5_H.txt']);
    assert.match(r.stdout, /^>>> [0-9:]{8} bos ornek tamam: YUKU SIMDI BASLATIN \(rol=hedef adim=R5\)$/m, 'ROL=hedef: playbook un bekledigi satir');
    const csv = metin('hed', 'hedefcpu_', '.csv').split('\n');
    assert.equal(csv[0], BASLIK, 'hedefcpu_*.csv basligi yukcpu_ ile ayni (Portal ayni okuyucu)');
    assert.ok(csv.slice(1).filter(Boolean).every((x) => x.endsWith(',')), 'hedefte arac_rss_kb bos (arac aranmaz)');
    const txt = metin('hed', 'hedefcpu_', '.txt');
    assert.match(txt, /^rol=hedef$/m);
    assert.match(txt, /^bosta_bas=0$/m);
    assert.match(metin('hed', 'ag_', '.txt'), /^rol=hedef$/m);

    for (const [ortam, ileti] of [[{ ROL: 'sunucu' }, /HATA: ROL yuk ya da hedef olmali/], [{ BOSTA_BAS: 'x' }, /HATA: BOSTA_BAS tam sayi/]]) {
      r = kos('kotu', ortam);
      assert.equal(r.status, 2, JSON.stringify(ortam));
      assert.match(r.stderr, ileti);
    }
    assert.ok(!fs.existsSync(path.join(d, 'kotu')), 'gecersiz girdide hicbir dosya yazilmaz');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
