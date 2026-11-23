// server/ansible/__tests__/nginx-loadtest-nginxsiz.test.js - Yuk Testi tek hedef modeli (2026-11-13): her dbo.Inventory
// DEV/TEST/QA makinesi hedef ya da yuk makinesi olabilir; nginx hedefte OLCULEREK bulunur (NA10).
//
// NEDEN: kullanici karari "hedef ile yuk makinesinin ne oldugunun teknik onemi yok". Ortam kapisi Portal'da (dbo.Inventory);
// playbook ad kuralini artik aramaz ama EDU / uretim adi / hedef != yuk / IP yerel kanitini birakmaz. Nginx olmayan
// hedefte sunucu ayari ve log ayrisimi YAPILMAZ, yalniz genel CPU olculur. Bu test o satirlari kilitler:
//   (a) Play 1: yt_extra_load_hosts / yt_cpu_target_extra_hosts yok; ilk assert'te yuk_hedef_host / yuk_yuk_host icin
//       yt_re_nonprod_adi eslemesi YOK, ikisi icin de EDU + yt_re_prod_adi reddi VAR, hedef != yuk; yt_re_prod_adi
//       Portal envOfHost'un PROD kalibiyla ayni ('^([A-Z]{2}RVP|[A-Z]{2}NG[WX]A?P)'; onek bagimsiz, K17).
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
//   (h) bash varsa: nginx kurulu ama durmus (pid dosyasi yok / olu / Apache'ye denk gelen bayat pid) -> 0; canli pid
//       (hidepid) ve bozuk pid -> belirsiz; pid yonergesi nginx -T ciktisindan, goreli yol prefix'e gore.
//   (i) bash varsa: apache_surec / apache_var (httpd, apache2, IHS, turler; benzer adlar sayilmaz; hidepid '-');
//       nginx_var'i degistirmez. (e) on_kontrol.hedef_apache yalniz on kontrol bolumunde.
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

const DIR =
  process.env.NGINX_LOADTEST_AYNA ||
  path.join(__dirname, '..', 'playbooks', 'bmw_portal', 'nginx_loadtest');
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
  assert.match(
    p1,
    /^ {4}yt_re_prod_adi: '\^\(\[A-Z\]\{2\}RVP\|\[A-Z\]\{2\}NG\[WX\]A\?P\)'$/m,
    'uretim adi kalibi (Portal envOfHost PROD)',
  );
  const ilk = gorevler(p1).find((x) =>
    x.includes('Operation, run id, target type, target and load host'),
  );
  assert.ok(ilk, 'ilk assert bulunamadi');
  assert.ok(
    !/(yuk_hedef_host|yuk_yuk_host)[^\n]*yt_re_nonprod_adi/.test(ilk),
    'hedef / yuk makinesi icin ad kurali ARANMAZ',
  );
  const s = ilk.split('\n').map((x) => x.trim());
  const var_ = (m) => assert.ok(s.includes(m), `ilk assert satiri yok: ${m}`);
  var_(
    "- (((yuk_hedef_host | string) not in yt_edu_hostlari) if ((yuk_hedef_turu | default('sunucu') | string) == 'sunucu') else true)",
  );
  var_(
    "- ((not ((yuk_hedef_host | string) is match(yt_re_prod_adi))) if ((yuk_hedef_turu | default('sunucu') | string) == 'sunucu') else true)",
  );
  var_('- (yuk_yuk_host | string) not in yt_edu_hostlari');
  var_('- not ((yuk_yuk_host | string) is match(yt_re_prod_adi))');
  var_("- (yuk_hedef_host | default('') | string) != (yuk_yuk_host | string)");
  var_("- (yuk_yuk_host | default('') | string) is match(yt_re_host)");
});

test('NA10 (b) Play 2: nginx tespiti kopya kapisindan sonra, sunucu ayarindan once; ayar yalniz nginx 1', () => {
  const p2 = playlar()[1];
  const kopya = p2.indexOf('- name: --- [Task] Kopya dogrulanamadiysa DUR ---');
  const tespit = p2.indexOf(
    '- name: --- [Task] Detect nginx on the target (on_kontrol.sh nginx; read only) ---',
  );
  const ayar = p2.indexOf(
    '- name: --- [Task] Sunucu ayari (on kontrol ve kosu oncesi; kaydedici baslamadan ONCE) ---',
  );
  const kaydedici = p2.indexOf('- name: --- [Task] CPU kaydedici (hedef) ---');
  assert.ok(
    kopya > 0 && tespit > kopya && ayar > tespit && kaydedici > ayar,
    'sira: kopya kapisi -> nginx tespiti -> sunucu ayari -> kaydedici',
  );
  const g = gorevler(p2);
  const t = g.find((x) => x.includes('Detect nginx on the target'));
  assert.ok(
    t.includes('- "{{ yt_dizin }}/on_kontrol.sh"\n                  - nginx\n'),
    'on_kontrol.sh nginx kipi',
  );
  assert.ok(
    t.includes('register: yt_ng_run') && t.includes('failed_when: false'),
    'kayit ve failed_when false',
  );
  const sonuc = g.find((x) => x.includes('Nginx detection result'));
  assert.ok(
    sonuc.includes(
      "yt_hedef_nginx: \"{{ ((yt_ng_run.stdout_lines | default([]) | select('match', '^nginx_var\\t')",
    ),
    'yt_hedef_nginx nginx_var satirindan',
  );
  assert.ok(
    sonuc.includes("default('nginx_var\\t-')"),
    'satir yoksa belirsiz (-), nginx ya da yok sayilmaz',
  );
  const ayarBlok = g.find((x) => x.includes('Sunucu ayari (on kontrol ve kosu oncesi'));
  assert.ok(
    ayarBlok.includes(
      "when: (yuk_islem in ['on_kontrol', 'kosu']) and ((yuk_srv_ayar | default('0') | string) == '1') and ((yt_hedef_nginx | default('-')) == '1')",
    ),
    'sunucu ayari yalniz nginx tespit edilen hedefte',
  );
  const gerek = g.find((x) => x.includes('Server settings need nginx'));
  assert.ok(
    gerek.includes("'SONUC', 'FAIL'") &&
      gerek.includes(
        "when: ((yuk_srv_ayar | default('0') | string) == '1') and (yt_hedef_nginx != '1')",
      ),
    'on kontrolde ayar + nginx yok -> yt_hz_sonuc FAIL',
  );
  const belirsiz = g.find((x) => x.includes('Stop: nginx state unclear (kosu)'));
  assert.ok(
    belirsiz.includes('ansible.builtin.fail:') &&
      belirsiz.includes("when: (yuk_islem == 'kosu') and (yt_hedef_nginx not in ['0', '1'])"),
    'kosuda belirsiz -> fail',
  );
  const srvYok = g.find((x) =>
    x.includes('Stop: server settings requested but nginx not detected (kosu)'),
  );
  assert.ok(
    srvYok.includes('ansible.builtin.fail:') &&
      srvYok.includes(
        "when: (yuk_islem == 'kosu') and ((yuk_srv_ayar | default('0') | string) == '1') and (yt_hedef_nginx != '1')",
      ),
    'kosuda ayar istendi ama nginx yok -> fail',
  );
});

test('NA10 (c) Play 2 kosu: ip_yerel kapisi iki kaydedicinin de ONCESINDE; genel kaydedici ROL=hedef', () => {
  const p2 = playlar()[1];
  const g = gorevler(p2);
  const kopya = g.find((x) => x.includes('- name: --- [Task] Betikler kosu dizinine ---'));
  assert.ok(
    kopya.includes("['cpu_kaydedici.sh', 'on_kontrol.sh', 'yuk_cpu_kaydedici.sh']"),
    'kosu kopya listesinde genel kaydedici',
  );
  const kapi = p2.indexOf("when: yt_kosu_ip_yerel != '1'");
  const belirsiz = p2.indexOf('Stop: nginx state unclear (kosu)');
  const nginxK = g.find((x) =>
    x.includes('Kaydedici ayrik baslatilir (setsid nohup timeout; pid dosyasi)'),
  );
  const genelK = g.find((x) => x.includes('Generic host CPU recorder started detached'));
  assert.ok(nginxK && genelK, 'iki kaydedici baslatmasi');
  assert.ok(
    kapi > 0 &&
      belirsiz > 0 &&
      p2.indexOf(nginxK) > kapi &&
      p2.indexOf(genelK) > kapi &&
      p2.indexOf(nginxK) > belirsiz,
    'ip_yerel kapisi ve belirsiz fail iki baslatmadan da ONCE',
  );
  assert.ok(
    nginxK.includes("/cpu_kaydedici.sh') | quote }}") &&
      nginxK.includes("when: yt_hedef_nginx == '1'"),
    'nginx kaydedicisi yalniz 1',
  );
  assert.ok(
    genelK.includes("/yuk_cpu_kaydedici.sh') | quote }}") &&
      genelK.includes("when: yt_hedef_nginx == '0'"),
    'genel kaydedici yalniz 0',
  );
  for (const parca of [
    'env ROL=hedef ',
    'SONUC={{ yt_dizin | quote }}',
    'BOSTA_BAS={{ yuk_bosta_bas_sn | int }}',
    'HEDEF_IP={{ yuk_hedef_ip | quote }}',
    "R{{ yuk_run_id | int }} > {{ (yt_dizin ~ '/kaydedici.out') | quote }}",
    "echo $! > {{ (yt_dizin ~ '/kaydedici.pid') | quote }}",
  ]) {
    assert.ok(genelK.includes(parca), `genel kaydedici: ${parca}`);
  }
  const secim = g.find((x) => x.includes('Recorder script by nginx detection'));
  assert.ok(
    secim &&
      p2.indexOf(secim) > kapi &&
      secim.includes("'cpu_kaydedici.sh' if (yt_hedef_nginx == '1') else 'yuk_cpu_kaydedici.sh'"),
    'yt_kaydedici_betik secimi',
  );
});

test('NA10 (d) Play 4: kaydedici kaniti ve ozet deseni secilen betige gore', () => {
  const p4 = playlar()[3];
  assert.ok(
    p4.includes(
      "((yt_dizin ~ '/' ~ (yt_kaydedici_betik | default('cpu_kaydedici.sh'))) in (yt_kcmd.content | b64decode))",
    ),
    'cmdline kaniti yt_kaydedici_betik',
  );
  assert.ok(
    !p4.includes("(yt_dizin ~ '/cpu_kaydedici.sh') in"),
    'sabit cpu_kaydedici.sh kaniti kalmadi',
  );
  assert.ok(
    p4.includes(
      "patterns: \"{{ 'bilgi_*.txt' if ((yt_kaydedici_betik | default('cpu_kaydedici.sh')) == 'cpu_kaydedici.sh') else 'hedefcpu_*.txt' }}\"",
    ),
    'ozet deseni',
  );
});

test('NA10 (e) Play 10: hedef_nginx alanlari, log engeli yalniz nginx true, belirsiz engel', () => {
  const p = playlar();
  const son = p[p.length - 1];
  const onk = gorevler(son).find((x) => x.includes('- name: --- [Task] On kontrol bolumu ---'));
  const kosu = gorevler(son).find((x) => x.includes('- name: --- [Task] Kosu bolumu ---'));
  const eng = gorevler(son).find((x) => x.includes('- name: --- [Task] On kontrol engelleri'));
  const esle =
    "'hedef_nginx': ((({'1': true, '0': false})[hostvars[yuk_hedef_host].yt_hedef_nginx | default('-')] | default(none)) if (yt8_tur == 'sunucu') else none),";
  assert.ok(
    onk.includes(esle) && onk.includes("'hedef_nproc': "),
    'on_kontrol.hedef_nginx / hedef_nproc',
  );
  // 2026-11-17 Apache bilgisi: yalniz on_kontrol bolumunde; kosu bolumunde YOK (karara girmez).
  assert.ok(
    onk.includes(
      "'hedef_apache': ((({'1': true, '0': false})[hostvars[yuk_hedef_host].yt_hedef_apache | default('-')] | default(none)) if (yt8_tur == 'sunucu') else none),",
    ),
    'on_kontrol.hedef_apache',
  );
  assert.ok(!kosu.includes('hedef_apache'), 'kosu bolumunde hedef_apache olmamali');
  assert.ok(kosu.includes(esle), 'kosu.hedef_nginx');
  assert.ok(
    kosu.includes(
      "'hedef_kaydedici': ((({'cpu_kaydedici.sh': 'nginx', 'yuk_cpu_kaydedici.sh': 'genel'})",
    ),
    'kosu.hedef_kaydedici',
  );
  assert.ok(
    eng.includes(
      "(['log dizini /web_log okunamiyor'] if ((yt8_tur == 'sunucu') and (yt_s_onk.hedef_nginx is sameas true) and not yt_s_onk.log_dizini_okunur) else [])",
    ),
    '/web_log engeli yalniz nginx hedefte',
  );
  assert.ok(
    eng.includes("'hedef: nginx durumu belirlenemedi (nginx_T '") &&
      eng.includes(
        '(yt_s_onk.hedef_nginx is none) and (hostvars[yuk_hedef_host].yt_hedef_nginx is defined)',
      ),
    'belirsiz engel (tespit kostuysa)',
  );
});

const bashVar = spawnSync(BASH, ['-c', 'echo ok'], { encoding: 'utf8' }).stdout === 'ok\n';

test(
  'NA10 (f) bash: on_kontrol.sh nginx uc durum; hedef kipinin satir sirasi degismedi',
  { skip: bashVar ? false : 'bash yok' },
  () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nlngx_'));
    try {
      const bin = path.join(d, 'bin');
      fs.mkdirSync(bin);
      fs.mkdirSync(path.join(d, 'proc', '7'), { recursive: true });
      fs.writeFileSync(path.join(bin, 'dzdo'), '#!/bin/bash\nexit 1\n', { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'ngok'), '#!/bin/bash\necho "server_name a.b.c;"\n', {
        mode: 0o755,
      });
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
          env: {
            ...process.env,
            PATH: kabukPath(bin),
            PROC_ROOT: posixYol(path.join(d, 'proc')),
            NGINX_BIN: posixYol(path.join(bin, ngbin)),
            ...ek,
          },
        });
      const deger = (out, k) => (new RegExp(`^${k}\\t(.*)$`, 'm').exec(out) || [])[1];
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
          r.stdout
            .split('\n')
            .filter(Boolean)
            .map((x) => x.split('\t')[0]),
          [
            'nginx_bin',
            'nginx_T',
            'master_sayisi',
            'nginx_pid',
            'nginx_var',
            'apache_surec',
            'apache_var',
            'nproc',
            'SONUC',
          ],
          `nginx kipi satirlari (${etiket})`,
        );
        assert.equal(deger(r.stdout, 'nginx_var'), beklenen, `nginx_var (${etiket})`);
        assert.equal(deger(r.stdout, 'nginx_T'), tok, `nginx_T (${etiket})`);
        assert.equal(deger(r.stdout, 'master_sayisi'), m ? '1' : '0', `master_sayisi (${etiket})`);
        assert.equal(
          deger(r.stdout, 'nginx_bin'),
          ng === 'yok' ? '0' : '1',
          `nginx_bin (${etiket})`,
        );
        assert.match(deger(r.stdout, 'nproc'), /^([0-9]+|-)$/);
        assert.match(r.stdout, /^SONUC\tOK\tnginx olculdu$/m);
      }
      master(true);
      const h = kos('hedef', 'ngok', {
        HEDEF_IP: '10.9.9.9',
        HOST_BASLIGI: 'a.b.c',
        LOGDIR: posixYol(d),
        UST: posixYol(d),
      });
      assert.equal(h.status, 0, h.stderr);
      assert.deepEqual(
        h.stdout
          .split('\n')
          .filter(Boolean)
          .map((x) => x.split('\t')[0]),
        [
          'ip_yerel',
          'nginx_T',
          'server_name_var',
          'log_format_ua',
          'statik_direktif',
          'master_sayisi',
          'web_log_df',
          'log_dizini_okunur',
          'hazirlik_yedek',
          'SONUC',
        ],
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
  },
);

// NA10 (h) KULLANICI OLAYI (2026-11-17): "bir sunucumda hem Nginx hem Apache var ... nginx kapali oldugu icin on kontrol
// patlamis". nginx KURULU (nginx -T ok) ama DURMUS (master yok) hedef eskiden '-' (belirlenemedi -> Portal engeli) idi.
// Artik pid dosyasi ayirir: yok / olu (bayat) -> 0 (nginx'siz hedef olculur); canli (hidepid: /proc gizli, kill -0
// gizlemez) ya da okunamayan -> '-' (engel kalir).
test(
  'NA10 (h) bash: nginx kurulu ama durmus -> 0; canli pid ya da okunamayan pid -> belirsiz',
  { skip: bashVar ? false : 'bash yok' },
  async (t) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nlpid_'));
    let uyuyan = null;
    try {
      const bin = path.join(d, 'bin');
      const onek = path.join(d, 'ng');
      fs.mkdirSync(bin);
      fs.mkdirSync(path.join(d, 'proc', '4242'), { recursive: true });
      // pid 1 gorunur: /proc baskasinin sureclerini gosteriyor (hidepid yok). Hidepid dali asagida ayrica.
      fs.mkdirSync(path.join(d, 'proc', '1'), { recursive: true });
      fs.writeFileSync(path.join(d, 'proc', '1', 'cmdline'), '/sbin/init\0');
      fs.mkdirSync(path.join(onek, 'logs'), { recursive: true });
      fs.mkdirSync(path.join(onek, 'run'), { recursive: true });
      fs.writeFileSync(path.join(bin, 'dzdo'), '#!/bin/bash\nexit 1\n', { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'ngok'), '#!/bin/bash\necho "server_name a.b.c;"\n', {
        mode: 0o755,
      });
      // pid yonergesi: yorumdaki satir sayilmaz, goreli yol prefix'e gore, tirnak atilir.
      fs.writeFileSync(
        path.join(bin, 'ngpid'),
        '#!/bin/bash\necho "# eski; pid logs/yorum.pid;"\necho "user www; pid \\"run/ng.pid\\";"\necho "server_name a.b.c;"\n',
        { mode: 0o755 },
      );
      // /proc'ta gorunen ama nginx OLMAYAN surec (bayat pid dosyasi baska bir surece denk gelmis: Apache).
      fs.writeFileSync(path.join(d, 'proc', '4242', 'cmdline'), '/usr/sbin/httpd\0-k\0start\0');
      const kos = (ngbin) =>
        spawnSync(BASH, [posixYol(path.join(DIR, 'files', 'on_kontrol.sh')), 'nginx'], {
          cwd: d,
          encoding: 'utf8',
          timeout: 30000,
          env: {
            ...process.env,
            PATH: kabukPath(bin),
            PROC_ROOT: posixYol(path.join(d, 'proc')),
            NGINX_PREFIX: posixYol(onek),
            NGINX_BIN: posixYol(path.join(bin, ngbin)),
          },
        });
      const deger = (out, k) => (new RegExp(`^${k}\\t(.*)$`, 'm').exec(out) || [])[1];
      const pidYaz = (rel, icerik) => fs.writeFileSync(path.join(onek, ...rel.split('/')), icerik);
      const pidSil = () => {
        for (const rel of ['logs/nginx.pid', 'run/ng.pid'])
          fs.rmSync(path.join(onek, ...rel.split('/')), { force: true });
      };
      const bak = (etiket, ngbin, pidBeklenen, varBeklenen) => {
        const r = kos(ngbin);
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(
          r.stdout
            .split('\n')
            .filter(Boolean)
            .map((x) => x.split('\t')[0]),
          [
            'nginx_bin',
            'nginx_T',
            'master_sayisi',
            'nginx_pid',
            'nginx_var',
            'apache_surec',
            'apache_var',
            'nproc',
            'SONUC',
          ],
          `satirlar (${etiket})`,
        );
        assert.equal(deger(r.stdout, 'master_sayisi'), '0', `master (${etiket})`);
        assert.equal(deger(r.stdout, 'nginx_T'), 'ok', `nginx_T (${etiket})`);
        assert.equal(deger(r.stdout, 'nginx_pid'), pidBeklenen, `nginx_pid (${etiket})`);
        assert.equal(deger(r.stdout, 'nginx_var'), varBeklenen, `nginx_var (${etiket})`);
        // /proc'taki 4242 Apache (httpd): bilgi satiri onu sayar, nginx kararina girmez.
        assert.equal(deger(r.stdout, 'apache_var'), '1', `apache_var (${etiket})`);
      };

      // KULLANICI OLAYI: varsayilan pid yolu (<prefix>/logs/nginx.pid) yok, dizin aranabilir -> durmus.
      pidSil();
      bak('pid dosyasi yok', 'ngok', 'yok', '0');
      // Bayat pid: surec yok.
      pidYaz('logs/nginx.pid', '999999999\n');
      bak('olu pid', 'ngok', 'olu', '0');
      // Bayat pid baska bir surece (Apache) denk gelmis: /proc'ta gorunuyor, nginx master degil.
      pidYaz('logs/nginx.pid', '4242\n');
      bak('pid Apache sureci', 'ngok', 'olu', '0');
      // Icerik sayi degil -> olculemedi, engel kalir.
      pidYaz('logs/nginx.pid', 'bozuk\n');
      bak('bozuk pid', 'ngok', '-', '-');
      pidSil();
      // pid yonergesi: goreli yol prefix/run/ng.pid; yorumdaki logs/yorum.pid ve varsayilan logs/nginx.pid okunmaz.
      pidYaz('logs/yorum.pid', '999999999\n');
      pidYaz('logs/nginx.pid', 'bozuk\n');
      bak('pid yonergesi, dosya yok', 'ngpid', 'yok', '0');
      pidSil();
      fs.rmSync(path.join(onek, 'logs', 'yorum.pid'), { force: true });

      // HIDEPID (2026-11-23, PR-R): pid 1 gorunmuyorsa master 0 kanit degil: calisan nginx pid dosyasini -T'de
      // gorunmeyen bir yola yaziyor olabilir. 'yok' / 'olu' pid -> belirsiz (eskiden 0: nginx'siz olculurdu).
      fs.rmSync(path.join(d, 'proc', '1'), { recursive: true, force: true });
      bak('hidepid, pid dosyasi yok', 'ngok', 'yok', '-');
      pidYaz('logs/nginx.pid', '999999999\n');
      bak('hidepid, olu pid', 'ngok', 'olu', '-');
      pidSil();
      // hidepid=1 (noaccess): pid 1 GORUNUR ama cmdline okunamaz -> yine belirsiz.
      if (!(typeof process.getuid === 'function' && process.getuid() === 0)) {
        fs.mkdirSync(path.join(d, 'proc', '1'), { recursive: true });
        fs.writeFileSync(path.join(d, 'proc', '1', 'cmdline'), '/sbin/init\0');
        fs.chmodSync(path.join(d, 'proc', '1', 'cmdline'), 0);
        bak('hidepid=1, pid dosyasi yok', 'ngok', 'yok', '-');
        fs.chmodSync(path.join(d, 'proc', '1', 'cmdline'), 0o644);
        fs.rmSync(path.join(d, 'proc', '1'), { recursive: true, force: true });
      }
      fs.mkdirSync(path.join(d, 'proc', '1'), { recursive: true });
      fs.writeFileSync(path.join(d, 'proc', '1', 'cmdline'), '/sbin/init\0');

      // CANLI surec /proc'ta GORUNMEZ (hidepid): kill -0 onu bulur -> belirsiz (nginx calisiyor olabilir), engel kalir.
      const pidDosyasi = path.join(onek, 'run', 'uyuyan.pid');
      uyuyan = require('node:child_process').spawn(
        BASH,
        ['-c', `echo $$ > '${posixYol(pidDosyasi)}'; exec sleep 30`],
        {
          stdio: 'ignore',
        },
      );
      for (
        let i = 0;
        i < 100 && !(fs.existsSync(pidDosyasi) && fs.readFileSync(pidDosyasi, 'utf8').trim());
        i++
      )
        await new Promise((r) => setTimeout(r, 50));
      const canliPid = fs.readFileSync(pidDosyasi, 'utf8').trim();
      assert.match(canliPid, /^[0-9]+$/);
      pidYaz('run/ng.pid', `${canliPid}\n`);
      bak('canli pid, /proc gizli', 'ngpid', 'canli', '-');

      // BASKA KULLANICININ canli sureci (hidepid altindaki gercek durum): kill -0 "Operation not permitted" der -> canli.
      // Yalniz bunu uretebilen ortamda kosar (Linux, root olmayan kullanici); CI boyle. Digerinde bilerek ATLANDIGI yazilir.
      const eperm = spawnSync(BASH, ['-c', 'kill -0 1'], { encoding: 'utf8' });
      if (eperm.status !== 0 && /not permitted/.test(eperm.stderr)) {
        // Gercek hidepid: pid 1 /proc'ta gorunmez, kill -0 EPERM der.
        fs.rmSync(path.join(d, 'proc', '1'), { recursive: true, force: true });
        pidYaz('run/ng.pid', '1\n');
        bak('baska kullanicinin canli sureci', 'ngpid', 'canli', '-');
      } else {
        t.diagnostic(
          'kill -0 1 EPERM uretmiyor (root ya da Windows): baska-kullanici dali bu ortamda sinanmadi',
        );
      }
    } finally {
      if (uyuyan) uyuyan.kill();
      fs.rmSync(d, { recursive: true, force: true });
    }
  },
);

// NA10 (i) APACHE BILGISI (2026-11-17, kullanici: "Apache bilgisini de on kontrole ekle"): /proc'ta komut adi httpd /
// apache2 (IHS dahil, httpd.worker gibi turler) sayilir; benzer adlar (myhttpd, httpdx) SAYILMAZ; hic yoksa pid 1
// gorunuyorsa 0, gorunmuyorsa (hidepid) '-'. YALNIZ BILGI: nginx_var bu satirlardan ETKILENMEZ.
test(
  'NA10 (i) bash: apache_surec / apache_var; nginx kararindan bagimsiz',
  { skip: bashVar ? false : 'bash yok' },
  () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nlapc_'));
    try {
      const bin = path.join(d, 'bin');
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, 'dzdo'), '#!/bin/bash\nexit 1\n', { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'ngfail'), '#!/bin/bash\nexit 1\n', { mode: 0o755 });
      const surec = (pid, cmd) => {
        fs.mkdirSync(path.join(d, 'proc', String(pid)), { recursive: true });
        fs.writeFileSync(path.join(d, 'proc', String(pid), 'cmdline'), cmd);
      };
      const temizle = () => fs.rmSync(path.join(d, 'proc'), { recursive: true, force: true });
      const kos = () =>
        spawnSync(BASH, [posixYol(path.join(DIR, 'files', 'on_kontrol.sh')), 'nginx'], {
          cwd: d,
          encoding: 'utf8',
          timeout: 30000,
          env: {
            ...process.env,
            PATH: kabukPath(bin),
            PROC_ROOT: posixYol(path.join(d, 'proc')),
            NGINX_BIN: posixYol(path.join(bin, 'ngfail')),
          },
        });
      const deger = (out, k) => (new RegExp(`^${k}\\t(.*)$`, 'm').exec(out) || [])[1];
      const bak = (etiket, sayi, deg, ngVar = '0') => {
        const r = kos();
        assert.equal(r.status, 0, r.stderr);
        assert.equal(deger(r.stdout, 'apache_surec'), sayi, `apache_surec (${etiket})`);
        assert.equal(deger(r.stdout, 'apache_var'), deg, `apache_var (${etiket})`);
        // Bilgi nginx kararini degistirmez: master yok + nginx -T fail -> 0, Apache olsa da olmasa da. Hidepid'de
        // master 0 kanit degil (2026-11-23) -> '-'; bu da Apache'den degil /proc gorunurlugunden gelir.
        assert.equal(deger(r.stdout, 'nginx_var'), ngVar, `nginx_var (${etiket})`);
      };

      temizle();
      surec(1, '/usr/lib/systemd/systemd\0');
      surec(100, '/usr/sbin/httpd\0-DFOREGROUND\0');
      surec(101, '/usr/sbin/httpd.worker\0');
      surec(102, '/usr/sbin/apache2\0-k\0start\0');
      surec(103, '/opt/IBM/HTTPServer/bin/httpd\0-d\0/opt/IBM/HTTPServer\0');
      surec(104, '/usr/local/bin/myhttpd\0');
      surec(105, 'httpdx\0');
      surec(106, '');
      bak('dort Apache/IHS, iki benzer ad, bos cmdline', '4', '1');

      temizle();
      surec(1, '/usr/lib/systemd/systemd\0');
      surec(200, '/usr/sbin/sshd\0');
      bak('Apache yok, /proc acik', '0', '0');

      temizle();
      surec(300, '/bin/bash\0');
      bak('Apache yok, pid 1 gorunmuyor (hidepid)', '0', '-', '-');
      surec(301, '/usr/sbin/httpd\0');
      bak('Apache var, pid 1 gorunmuyor (hidepid)', '1', '1', '-');
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  },
);

function sahteProc(d) {
  fs.mkdirSync(path.join(d, 'proc', 'net'), { recursive: true });
  fs.writeFileSync(path.join(d, 'proc', 'stat'), 'cpu  100 2 30 400 5 0 1 0 0 0\ncpu0 1 1 1 1\n');
  fs.writeFileSync(
    path.join(d, 'proc', 'meminfo'),
    'MemTotal: 1000 kB\nMemFree: 1 kB\nMemAvailable: 500 kB\n',
  );
  fs.writeFileSync(
    path.join(d, 'proc', 'net', 'dev'),
    'Inter-|   Receive\n face |bytes\n    lo: 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16\n  eth0: 100 2 0 0 0 0 0 0 200 3 0 0 0 0 0 0\n',
  );
}

test(
  'NA10 (g) bash: yuk_cpu_kaydedici.sh ROL=yuk (varsayilan) / ROL=hedef / gecersiz',
  { skip: bashVar ? false : 'bash yok' },
  () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nlhcpu_'));
    try {
      sahteProc(d);
      const kos = (sonuc, ortam) =>
        spawnSync(BASH, [posixYol(path.join(DIR, 'files', 'yuk_cpu_kaydedici.sh')), 'R5'], {
          cwd: d,
          encoding: 'utf8',
          timeout: 30000,
          env: {
            ...process.env,
            ROL: '',
            BOSTA_BAS: '',
            PROC_ROOT: './proc',
            SONUC: `./${sonuc}`,
            SURE: '1',
            HEDEF_IP: '10.1.2.3',
            ...ortam,
          },
        });
      const dosyalar = (s) => fs.readdirSync(path.join(d, s, 'R5')).sort();
      const metin = (s, onek, uz) => {
        const ad = dosyalar(s).find((x) => x.startsWith(onek) && x.endsWith(uz));
        return ad ? fs.readFileSync(path.join(d, s, 'R5', ad), 'utf8') : '';
      };
      let r = kos('yuk', {});
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(
        dosyalar('yuk').map((x) => x.replace(/_R5_.*\./, '_R5_H.')),
        ['ag_R5_H.csv', 'ag_R5_H.txt', 'yukcpu_R5_H.csv', 'yukcpu_R5_H.txt'],
      );
      assert.ok(
        !r.stdout.includes('YUKU SIMDI BASLATIN'),
        'varsayilan (ROL=yuk, BOSTA_BAS=0): duyuru satiri YOK (cikti eskisiyle ayni)',
      );
      assert.match(metin('yuk', 'ag_', '.txt'), /^rol=yuk$/m);
      assert.deepEqual(
        metin('yuk', 'yukcpu_', '.txt')
          .split('\n')
          .filter(Boolean)
          .map((x) => x.split('=')[0]),
        ['surum', 'adim', 'host', 'nproc', 'clk_tck', 'bas_epoch', 'bit_epoch', 'ornek_sayisi'],
        'yukcpu_*.txt anahtarlari degismedi',
      );
      const BASLIK =
        'epoch,cpu_user,cpu_nice,cpu_system,cpu_idle,cpu_iowait,cpu_irq,cpu_softirq,cpu_steal,mem_total_kb,mem_available_kb,arac_rss_kb';
      assert.equal(metin('yuk', 'yukcpu_', '.csv').split('\n')[0], BASLIK);

      r = kos('hed', { ROL: 'hedef', BOSTA_BAS: '0' });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(
        dosyalar('hed').map((x) => x.replace(/_R5_.*\./, '_R5_H.')),
        ['ag_R5_H.csv', 'ag_R5_H.txt', 'hedefcpu_R5_H.csv', 'hedefcpu_R5_H.txt'],
      );
      assert.match(
        r.stdout,
        /^>>> [0-9:]{8} bos ornek tamam: YUKU SIMDI BASLATIN \(rol=hedef adim=R5\)$/m,
        'ROL=hedef: playbook un bekledigi satir',
      );
      const csv = metin('hed', 'hedefcpu_', '.csv').split('\n');
      assert.equal(csv[0], BASLIK, 'hedefcpu_*.csv basligi yukcpu_ ile ayni (Portal ayni okuyucu)');
      assert.ok(
        csv
          .slice(1)
          .filter(Boolean)
          .every((x) => x.endsWith(',')),
        'hedefte arac_rss_kb bos (arac aranmaz)',
      );
      const txt = metin('hed', 'hedefcpu_', '.txt');
      assert.match(txt, /^rol=hedef$/m);
      assert.match(txt, /^bosta_bas=0$/m);
      assert.match(metin('hed', 'ag_', '.txt'), /^rol=hedef$/m);

      for (const [ortam, ileti] of [
        [{ ROL: 'sunucu' }, /HATA: ROL yuk ya da hedef olmali/],
        [{ BOSTA_BAS: 'x' }, /HATA: BOSTA_BAS tam sayi/],
      ]) {
        r = kos('kotu', ortam);
        assert.equal(r.status, 2, JSON.stringify(ortam));
        assert.match(r.stderr, ileti);
      }
      assert.ok(!fs.existsSync(path.join(d, 'kotu')), 'gecersiz girdide hicbir dosya yazilmaz');
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  },
);
