// server/ansible/__tests__/nginx-loadtest-arac.test.cjs - Yuk Testi tur 4 (yuk araclari /sw'den, kosu basina kopya)
// playbook ve betik METIN kurallari (NA8).
//
// NEDEN: araclar kipi (Play 8 indirme + derleme, Play 9 /sw yayini) ve kosu kiplerinin arac kopyasi (Play 3, Play 7)
// davranisi Ansible deposundaki check_nginx_loadtest_job.py'de (L1-L7, L13) sahte modullerle sinanir; o bekci CI'da
// yok. Bu test aynadaki dosyalarin METNINDEN, guvenligi tasiyan satirlari kilitler:
//   (a) 'environment:' TAM 3 gorevde, hepsi Play 8'in get_url gorevleri, degeri birebir "{{ yt_proxy_ortam }}" (vekil
//       YALNIZ indirmede; derleme ve /sw yayini vekilsiz) ve play duzeyinde environment yok.
//   (b) 'validate_certs' hicbir yerde false / no degil; uc get_url'de 'validate_certs: true' (TLS dogrulamasi kapatilmaz).
//   (c) Play 3 arac kopyasi: copy 'remote_src: true', src "{{ yuk_arac_dizin }}/{{ yuk_motor }}", dest
//       "{{ yt_dizin }}/arac/..." ve mode '0700'; kopyanin stat'i 'checksum_algorithm: sha256'; beklenen ozet YALNIZ
//       Portal degeri (yuk_k6_sha256 / yuk_wrk_sha256); yuk_k6_yolu / yuk_wrk_yolu yalniz Play 1'de (arac assert'i).
//   (d) Play 3 ve Play 8'de /tmp ile baslayan dest / path / tmp_dest / chdir / src degeri ve argv ogesi yok (/tmp
//       noexec); Play 8'in get_url'lerinde tmp_dest var.
//   (e) Play 7 always: "{{ yt_dizin }}/arac" + 'state: absent' (kosu dizini korunsa da arac kopyasi silinir).
//   (f) Play 9: 'mv -T --' argv'si, ikili copy'leri mode '0644' (/sw'den calistirilamaz), SHA256SUMS ve manifest.json.
//   (g) files/arac_hazirla.sh: curl / wget / -march / WITH_OPENSSL / vekil atamasi YOK; 'unset ... http_proxy',
//       '--no-same-owner', 'VER="${WRK_SURUM}"', 'objdump -T', 'ldd' var.
//   (h) 10 play ve TEK set_stats son play'de.
//   (i) D1: iki arsiv ozeti ZORUNLU (Play 1, bos kabul yok); Play 8 get_url checksum'lari Portal'in sabit ozeti, diskteki
//       arsiv ozeti derlemeden ONCE yeniden denetlenir.
//   (j) eski kopya suprumesi yalniz <rakam>/arac (Play 3) ve arac_<id> (Play 8); bu kosu / is haric.
//   (k) Play 9 <kok>/araclar yalniz yoksa 0755; Play 10 temizlik erisilemezligi, yt_p7_bitti ve kalan dizin.
// NGINX_LOADTEST_AYNA: mutasyon kopyasi dizini (verilmezse depodaki ayna).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = process.env.NGINX_LOADTEST_AYNA || path.join(__dirname, '..', 'bmw_portal', 'nginx_loadtest');
const oku = (rel) => fs.readFileSync(path.join(DIR, ...rel.split('/')), 'utf8');

function playlar() {
  return oku('nginx_loadtest.yml')
    .split(/\n(?=- name: )/)
    .filter((p) => /^ {2}hosts: /m.test(p));
}

// Gorev parcalari: her '- name:' satirindan bir sonraki '- name:' satirina kadar (blok gorevinin parcasi ilk cocuga dek).
function gorevler(play) {
  const s = play.split('\n');
  const bas = s.map((x, i) => (/^\s*- name: /.test(x) ? i : -1)).filter((i) => i >= 0);
  return bas.map((b, k) => s.slice(b, k + 1 < bas.length ? bas[k + 1] : s.length).join('\n'));
}

const modulu = (g) => (/^\s+ansible\.builtin\.([a-z_]+):/m.exec(g) || [])[1] || null;

test('NA8 (a) vekil ortami YALNIZ Play 8 get_url gorevlerinde, TAM 3 kez, degeri "{{ yt_proxy_ortam }}"', () => {
  const p = playlar();
  assert.equal(p.length, 10, 'play sayisi (test yanlis yere bakiyor olmasin)');
  const yml = oku('nginx_loadtest.yml');
  const env = yml.split('\n').filter((x) => /^\s*environment:/.test(x));
  assert.equal(env.length, 3, `environment satiri TAM 3 olmali: ${env.join(' | ')}`);
  assert.ok(env.every((x) => x.trim() === 'environment: "{{ yt_proxy_ortam }}"'), `environment degeri birebir "{{ yt_proxy_ortam }}": ${env.join(' | ')}`);
  const p8 = gorevler(p[7]).filter((g) => /^\s+environment:/m.test(g));
  assert.equal(p8.length, 3, "uc environment'in UCU de Play 8'de");
  assert.ok(p8.every((g) => modulu(g) === 'get_url'), `environment yalniz get_url gorevlerinde: ${p8.map(modulu).join(',')}`);
  assert.ok(p.every((x) => !/^ {2}environment:/m.test(x)), 'play duzeyinde environment yok');
  assert.match(p[7], /^ {4}yt_proxy_ortam: "\{\{ \(\{'http_proxy': yuk_proxy, 'https_proxy': yuk_proxy, 'HTTP_PROXY': yuk_proxy, 'HTTPS_PROXY': yuk_proxy\}\) if \(\(yuk_proxy \| default\(''\) \| string \| length\) > 0\) else \{\} \}\}"$/m,
    'Play 8 yt_proxy_ortam: dolu vekilde dort ad, bos vekilde {}');
  // http(s)_proxy metni yalniz yt_proxy_ortam tanimi ve derleme argv'sinin '-u' ogelerinde
  const vekil = yml.split('\n').filter((x) => /https?_proxy/i.test(x));
  assert.deepEqual(
    vekil.filter((x) => !/^ {4}yt_proxy_ortam: /.test(x) && !/^\s+- (https?_proxy|HTTPS?_PROXY)$/.test(x)),
    [],
    'http(s)_proxy yalniz Play 8 yt_proxy_ortam ve derleme argv -u ogelerinde',
  );
  const derleme = gorevler(p[7]).filter((g) => g.includes('arac_hazirla.sh"\n') && modulu(g) === 'command');
  assert.equal(derleme.length, 1, 'TEK derleme komutu');
  for (const ad of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY']) {
    assert.match(derleme[0], new RegExp(`- -u\\n\\s+- ${ad}\\n`), `derleme argv'si env -u ${ad}`);
  }
});

test('NA8 (b) TLS dogrulamasi kapatilmaz: validate_certs false/no yok, uc get_url true', () => {
  const yml = oku('nginx_loadtest.yml');
  assert.ok(!/^\s*validate_certs:\s*(false|no|False|'false'|'no')\s*$/m.test(yml), 'validate_certs false/no YASAK');
  const gu = gorevler(playlar()[7]).filter((g) => modulu(g) === 'get_url');
  assert.equal(gu.length, 3, "Play 8'de TAM 3 get_url");
  assert.ok(gu.every((g) => /^\s+validate_certs: true$/m.test(g)), 'her get_url validate_certs: true');
});

test('NA8 (c) Play 3 arac kopyasi: remote_src, Portal sha256, 0700; eski yol degiskenleri yalniz Play 1', () => {
  const p = playlar();
  const p3 = gorevler(p[2]);
  const kopya = p3.filter((g) => modulu(g) === 'copy' && /^\s+remote_src: true$/m.test(g));
  assert.equal(kopya.length, 1, "Play 3'te TEK remote_src copy (arac kopyasi)");
  assert.match(kopya[0], /^\s+src: "\{\{ yuk_arac_dizin \}\}\/\{\{ yuk_motor \}\}"$/m, 'src <yuk_arac_dizin>/<motor>');
  assert.match(kopya[0], /^\s+dest: "\{\{ yt_dizin \}\}\/arac\//m, 'dest <kosu dizini>/arac/...');
  assert.match(kopya[0], /^\s+mode: '0700'$/m, "kopya mode '0700'");
  const st = p3.filter((g) => modulu(g) === 'stat' && g.includes('path: "{{ yt_dizin }}/arac/{{ yuk_motor }}"'));
  assert.ok(st.length === 1 && /^\s+checksum_algorithm: sha256$/m.test(st[0]) && /^\s+get_checksum: true$/m.test(st[0]), 'arac kopyasinin stat i sha256');
  assert.ok(
    p[2].includes('yt_arac_beklenen: "{{ yuk_k6_sha256 if (yuk_motor == \'k6\') else yuk_wrk_sha256 }}"'),
    'beklenen ozet YALNIZ Portal degeri (yuk_k6_sha256 / yuk_wrk_sha256), motora gore',
  );
  assert.match(p[2], /- "K6=\{\{ yt_dizin \}\}\/arac\/k6"\n\s+- "WRK=\{\{ yt_dizin \}\}\/arac\/wrk"\n/, 'kosu betigine K6 / WRK kopya yolu');
  assert.ok(gorevler(p[2]).some((g) => /^\s+state: absent$/m.test(g) && g.includes('path: "{{ yt_dizin }}/arac/{{ yuk_motor }}"') && /when: not \(yt_arac\.dogrulandi \| bool\)/.test(g)),
    'dogrulanmamis kopya silinir');
  for (const ad of ['yuk_k6_yolu', 'yuk_wrk_yolu']) {
    const disinda = p.slice(1).filter((x) => new RegExp(`\\b${ad}\\b`).test(x));
    assert.equal(disinda.length, 0, `${ad} yalniz Play 1'de (arac assert'i)`);
  }
});

test('NA8 (d) Play 3 ve Play 8de /tmp ile baslayan deger yok; get_url tmp_dest var', () => {
  const p = playlar();
  for (const i of [2, 7]) {
    const kotu = p[i]
      .split('\n')
      .filter((x) => /^\s+(dest|path|tmp_dest|chdir|src): ["']?\/tmp/.test(x) || /^\s+- ["']?\/tmp/.test(x));
    assert.deepEqual(kotu, [], `play#${i + 1}: /tmp (noexec) ile baslayan deger`);
  }
  const gu = gorevler(p[7]).filter((g) => modulu(g) === 'get_url');
  assert.ok(gu.length === 3 && gu.every((g) => /^\s+tmp_dest: "\{\{ yt_a_dizin \}\}\/indir"$/m.test(g)), 'get_url tmp_dest derleme dizini');
});

test('NA8 (e) Play 7 always: arac kopyasi her yolda silinir', () => {
  const p7 = playlar()[6];
  const always = p7.slice(p7.indexOf('\n      always:\n'));
  assert.ok(p7.includes('\n      always:\n'), "Play 7 always bolumu");
  const g = gorevler(always).filter((x) => x.includes('path: "{{ yt_dizin }}/arac"'));
  assert.ok(g.length === 1 && /^\s+state: absent$/m.test(g[0]) && /^\s+ignore_errors: true$/m.test(g[0]) && !/failed_when/.test(g[0]) && !/yt_dizin_sil/.test(g[0]),
    "always'te '{{ yt_dizin }}/arac' state absent, ignore_errors (failed_when degil), yt_dizin_sil kosulu YOK");
});

test('NA8 (f) Play 9: mv -T --, ikililer 0644, SHA256SUMS ve manifest.json', () => {
  const p9 = playlar()[8];
  assert.match(p9, /argv:\n\s+- mv\n\s+- -T\n\s+- --\n\s+- "\{\{ yt_arac_yarim \}\}"\n\s+- "\{\{ yt_arac_sw \}\}"\n/, "argv ['mv', '-T', '--', yarim, son]");
  const g = gorevler(p9);
  const ikili = g.filter((x) => modulu(x) === 'copy' && x.includes('src: "{{ yt_actl_dizin }}/{{ item }}"'));
  assert.ok(ikili.length === 1 && /^\s+mode: '0644'$/m.test(ikili[0]) && /dest: "\{\{ yt_arac_yarim \}\}\/\{\{ item \}\}"/.test(ikili[0]), "ikili copy'leri yarim dizine mode '0644'");
  assert.ok(g.some((x) => /dest: "\{\{ yt_arac_yarim \}\}\/SHA256SUMS"/.test(x) && /mode: '0644'/.test(x)), 'SHA256SUMS yarim dizinde');
  assert.ok(g.some((x) => /dest: "\{\{ yt_arac_yarim \}\}\/manifest\.json"/.test(x) && x.includes('{{ yt_arac_manifest | to_nice_json }}')), 'manifest.json yarim dizinde');
  const geri = g.filter((x) => x.includes('{{ yt_arac_sw }}/{{ item }}') && modulu(x) === 'stat');
  assert.equal(geri.length, 1, '/sw geri okumasi');
  assert.ok(/arac dizini zaten var/.test(p9), 'hedef dizin varsa DUR');
});

test('NA8 (g) arac_hazirla.sh metin kurallari', () => {
  const sh = oku('files/arac_hazirla.sh');
  for (const [r, ad] of [[/\bcurl\b/, 'curl'], [/\bwget\b/, 'wget'], [/-march/, '-march'], [/WITH_OPENSSL/, 'WITH_OPENSSL'], [/\b(https?|all|no)_proxy=/i, 'vekil atamasi']]) {
    assert.ok(!r.test(sh), `arac_hazirla.sh: ${ad} YASAK`);
  }
  assert.ok(sh.split('\n').some((x) => /^unset /.test(x) && ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY'].every((a) => x.split(/\s+/).includes(a))),
    'unset ... http_proxy https_proxy HTTP_PROXY HTTPS_PROXY');
  for (const k of ['--no-same-owner', '--no-same-permissions', 'VER="${WRK_SURUM}"', 'objdump -T', 'ldd ']) {
    assert.ok(sh.includes(k), `arac_hazirla.sh: ${k}`);
  }
  assert.ok(!sh.includes('\r'), 'LF');
});

// Tur 4 D1 (ilk kullanimda guven YOK): iki arsiv ozeti Portal env'inde SABIT ve playbook her ikisini de acmadan,
// derlemeden, calistirmadan once dogrular.
test('NA8 (i) arsiv ozetleri sabit: Play 1 bos ozeti reddeder, Play 8 checksum sabit degerle ve derlemeden once yeniden denetler', () => {
  const p = playlar();
  const p1 = gorevler(p[0]);
  const ozet = p1.filter((g) => modulu(g) === 'assert' && g.includes("when: (yuk_islem | default('') | string) == 'araclar'") && g.includes('yuk_k6_arsiv_sha256'));
  assert.equal(ozet.length, 1, 'Play 1de TEK araclar arsiv ozeti assert i');
  assert.match(ozet[0], /^\s+- \(yuk_k6_arsiv_sha256 \| default\(''\) \| string\) is match\(yt_re_sha256\)$/m, 'k6 arsiv ozeti ZORUNLU 64 hex');
  assert.match(ozet[0], /^\s+- \(yuk_wrk_kaynak_sha256 \| default\(''\) \| string\) is match\(yt_re_sha256\)$/m, 'wrk kaynak ozeti ZORUNLU 64 hex');
  assert.ok(!/== ''\) or \(\(yuk_(k6_arsiv|wrk_kaynak)_sha256/.test(oku('nginx_loadtest.yml')), "bos ozet ('') kabul eden kural YOK");
  assert.match(ozet[0], /NGINX_LOADTEST_K6_ARSIV_SHA256 ve NGINX_LOADTEST_WRK_KAYNAK_SHA256/, 'ret iletisi iki env adini soyler');
  const p8 = gorevler(p[7]);
  const gu = p8.filter((g) => modulu(g) === 'get_url');
  assert.match(gu[1], /^\s+checksum: "sha256:\{\{ yuk_k6_arsiv_sha256 \}\}"$/m, 'k6 arsivi Portal sabit ozetiyle');
  assert.match(gu[2], /^\s+checksum: "sha256:\{\{ yuk_wrk_kaynak_sha256 \}\}"$/m, 'wrk kaynagi Portal sabit ozetiyle (omit YOK)');
  assert.ok(!/\bomit\b/.test(p[7]), "Play 8'de omit yok (checksum kosulsuz)");
  const denetim = p8.findIndex((g) => modulu(g) === 'assert' && g.includes('(yt_a_arsiv.k6 | string) == (yuk_k6_arsiv_sha256 | string)')
    && g.includes('(yt_a_arsiv.wrk | string) == (yuk_wrk_kaynak_sha256 | string)'));
  const derleme = p8.findIndex((g) => modulu(g) === 'command' && g.includes('arac_hazirla.sh"\n'));
  assert.ok(denetim > 0 && derleme > denetim, `diskteki arsiv ozeti denetimi derlemeden ONCE (denetim ${denetim}, derleme ${derleme})`);
});

test('NA8 (j) eski arac kopyalari suprumesi yalniz <id>/arac ve arac_<id>; bu kosu / is haric', () => {
  const p = playlar();
  const p3 = gorevler(p[2]);
  const sil3 = p3.filter((g) => modulu(g) === 'file' && g.includes('yt_y_eski_arac.files'));
  assert.equal(sil3.length, 1, 'Play 3 suprume silmesi');
  assert.ok(sil3[0].includes("select('match', '^' ~ (yt_ust | regex_escape) ~ yt_re_eski_arac)") && sil3[0].includes("reject('equalto', yt_dizin ~ '/arac')"),
    'Play 3: yalniz <yt_ust>/<rakam>/arac, bu kosunun arac/i haric');
  assert.match(p[2], /^ {4}yt_re_eski_arac: '\/\[0-9\]\{1,10\}\/arac\\Z'$/m, 'yt_re_eski_arac yalniz <rakam>/arac');
  const bul3 = p3.filter((g) => modulu(g) === 'find' && g.includes('yt_re_arac_adi'));
  assert.ok(bul3.length === 1 && /^\s+age: 1d$/m.test(bul3[0]) && /^\s+depth: 2$/m.test(bul3[0]), 'Play 3 find: 1 gunden eski, derinlik 2');
  const p8 = gorevler(p[7]);
  const sil8 = p8.filter((g) => modulu(g) === 'file' && g.includes('yt_a_eski.files'));
  assert.ok(sil8.length === 1 && sil8[0].includes("reject('equalto', yt_a_dizin)"), 'Play 8: bu isin derleme dizini haric');
});

test('NA8 (k) Play 9 araclar dizini yalniz yoksa 0755; Play 10 temizlik erisilemezligini ve kalan dizini yazar', () => {
  const p = playlar();
  const kok = gorevler(p[8]).filter((g) => modulu(g) === 'file' && g.includes('path: "{{ yuk_cikti_kok }}/araclar"'));
  assert.ok(kok.length === 1 && /^\s+mode: '0755'$/m.test(kok[0]) && /when: not \(yt_a_sw_r_kstat\.stat\.exists/.test(kok[0]),
    "araclar dizini: mode '0755' ve YALNIZ yoksa");
  const p10 = p[9];
  assert.ok(p10.includes("if (((hostvars[yuk_yuk_host].yt_d_arac_sil | default({})) is failed) or ((hostvars[yuk_yuk_host].yt_d_arac_sil | default({})) is unreachable)) else []"),
    'arac silme: basarisiz YA DA erisilemez ise temizlik hatasi');
  assert.ok(p10.includes("(hostvars[yuk_yuk_host].yt_d_dizin_sil | default({})) is unreachable"), 'kosu dizini silme erisilemezligi okunur');
  assert.ok(p10.includes('hostvars[yuk_yuk_host].yt_p7_bitti is not defined'), 'yt_p7_bitti Play 10da okunur');
  assert.ok(p10.includes('kosu dizini silinmedi (durdurma tamamlanmadi; elle silin): '), 'durdurma tamamlanmadiysa kalan dizin notu');
  assert.ok(gorevler(p[6]).some((g) => g.includes('path: "{{ yt_dizin }}"') && /^\s+register: yt_d_dizin_sil$/m.test(g)), 'Play 7 kosu dizini silmesi register');
});

test('NA8 (h) 10 play ve TEK set_stats son playde', () => {
  const p = playlar();
  assert.deepEqual(
    p.map((x) => (/^ {2}hosts: (.+)$/m.exec(x) || [])[1]),
    ['localhost', 'yuk_hedef', 'yuk_makine', 'yuk_hedef', 'yuk_hedef:yuk_makine', 'localhost', 'yuk_hedef:yuk_makine', 'yuk_derleme', 'localhost', 'localhost'],
  );
  assert.equal((oku('nginx_loadtest.yml').match(/ansible\.builtin\.set_stats:/g) || []).length, 1, 'TEK set_stats');
  assert.ok(p[9].includes('ansible.builtin.set_stats:'), 'set_stats son playde');
});
