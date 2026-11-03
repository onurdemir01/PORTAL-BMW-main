// server/ansible/__tests__/nginx-loadtest-h2.test.cjs - Yuk Testi HTTP/2 protokol secimi (h2 sozlesmesi 3.x), aynadaki
// playbook ve betiklerin METIN kurallari + bash varsa kucuk davranis denemeleri (NA9).
//
// NEDEN: protokol secimi bes katmandan gecer (Portal -> playbook kapisi -> argv -> kos.sh/wrk_kos.sh/on_kontrol.sh ->
// yuk_k6.js). Tam davranis Ansible deposundaki bekcide (check_nginx_loadtest_job.py L5/L6/L7); CI'da kosabilen kisim:
//   (a) girdi kapisi: uc kural (yuk_protokol | default('h1') in [h1, h2]; wrk yalniz h1; h2 yalniz kip ka) TEK assert'te,
//       fail_msg 'protokol h1|h2 (h2 yalniz k6 ve kip ka)'. default('h1'): eski Portal (degisken yok) bugunku gibi h1.
//   (b) argv: kosu gorevinde AE'den, yollar gorevinde UA_ONEK'ten HEMEN sonra TAM "PROTOKOL={{ yuk_protokol | default('h1') }}".
//   (c) set_stats: on_kontrol'de 6 yeni alan (alpn_kaynak 'curl'|'openssl'|none), iki ALPN engeli YALNIZ h2'de
//       ('is sameas false' / 'is none'; kaynak openssl ise openssl metni), curl_h2 false tek basina engel DEGIL, kok
//       'protokol' yankisi normal ve yedek sonucta.
//   (d) kos.sh: kosulsuz GODEBUG http2client=0 YOK; miras http2client= girdileri suzulur, yalniz h1'de eklenir; k6'ya
//       -e PROTOKOL; DUR karari http2 kolonundan DEGIL protokol / protokol_uyumsuz'dan.
//   (e) on_kontrol.sh: h2'de --http2; curl h2'siz ise red YOK: yollar h1 gibi bayraksiz, ALPN OZET'ten sonra TEK
//       'openssl s_client -alpn h2,http/1.1' (SNI=1 -servername, SNI=0 -noservername; el sikisma yoksa '-');
//       curl yolunda alpn_h2 = h2 == yanitli (yanitli 0 -> '-'). Davranis Ansible bekcisinde (L7 sahte openssl).
//   (f) wrk_kos.sh: PROTOKOL yalniz h1 (wrk cagrisindan ONCE hata), istemci dosyasinda protokol "h1" (metin) ve
//       protokol_uyumsuz 0 (sayi).
//   (g) bash varsa: wrk_kos.sh PROTOKOL=h2 rc 2; kos.sh PROTOKOL=h2 KIP=yeni rc 2; kos.sh --kuru h2 planinda protokol=h2.
// NGINX_LOADTEST_AYNA: mutasyon kopyasi dizini (verilmezse depodaki ayna).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BASH, posixYol } = require('./fixtures/kabuk.cjs');

const DIR = process.env.NGINX_LOADTEST_AYNA || path.join(__dirname, '..', 'bmw_portal', 'nginx_loadtest');
const oku = (rel) => fs.readFileSync(path.join(DIR, ...rel.split('/')), 'utf8');
const ARGV = `- "PROTOKOL={{ yuk_protokol | default('h1') }}"`;

test('NA9 (a) girdi kapisi: uc protokol kurali tek assert, default h1, fail_msg', () => {
  const yml = oku('nginx_loadtest.yml');
  const kurallar = [
    "- (yuk_protokol | default('h1') | string) in ['h1', 'h2']",
    "- (((yuk_protokol | default('h1') | string) == 'h1') if ((yuk_motor | default('') | string) == 'wrk') else true)",
    "- (((yuk_kip | default('') | string) == 'ka') if ((yuk_protokol | default('h1') | string) == 'h2') else true)",
  ];
  const blok = yml.split('- name: --- [Task] Kosu parametreleri (on kontrol ve kosu) ---')[1] || '';
  const assertGovde = blok.split('quiet: true')[0];
  for (const k of kurallar) {
    assert.equal(yml.split(k).length - 1, 1, `kural playbook'ta TEK kez: ${k}`);
    assert.ok(assertGovde.includes(k), `kural 'Kosu parametreleri' assert'inde: ${k}`);
  }
  assert.match(assertGovde, /fail_msg: "[^"\n]*protokol h1\|h2 \(h2 yalniz k6 ve kip ka\)[^"\n]*"/);
  const yalin = [...yml.matchAll(/yuk_protokol(?! \| default\('h1'\))/g)];
  assert.deepEqual(yalin.map((m) => yml.slice(m.index, m.index + 40)), [], "her yuk_protokol | default('h1') ile (eski Portal)");
});

test('NA9 (b) argv: kosu (AE sonrasi) ve yollar (UA_ONEK sonrasi) gorevlerinde TAM PROTOKOL', () => {
  const yml = oku('nginx_loadtest.yml');
  const s = yml.split('\n').map((x) => x.trim());
  const yerler = s.map((x, i) => (x === ARGV ? i : -1)).filter((i) => i >= 0);
  assert.equal(yerler.length, 2, `iki gorevde tam ${ARGV}: ${yerler}`);
  const onceki = yerler.map((i) => s[i - 1]).sort();
  assert.deepEqual(onceki, ['- "AE={{ yuk_ae }}"', '- "UA_ONEK={{ yuk_ua_onek }}"'].sort());
  const yollar = yerler.find((i) => s[i - 1] === '- "UA_ONEK={{ yuk_ua_onek }}"');
  assert.equal(s[yollar + 2], '- "{{ yt_dizin }}/on_kontrol.sh"', 'UA_ONEK + PROTOKOL yollar gorevinde (on_kontrol.sh)');
  assert.ok(s.includes('- name: --- [Task] Senaryodaki her tekil yol icin TEK istek (h1 ya da h2; cerezsiz, vekilsiz) ---'));
});

test('NA9 (c) set_stats: on_kontrol 5 alan, ALPN engelleri yalniz h2, kok protokol yankisi (yedek sonucta da)', () => {
  const yml = oku('nginx_loadtest.yml');
  for (const a of ['protokol', 'curl_h2', 'alpn_h2', 'alpn_kaynak', 'yollar_yanitli', 'yollar_h2']) {
    assert.match(yml, new RegExp(`^ {18}'${a}': `, 'm'), `yt_s_onk '${a}'`);
  }
  assert.match(yml, /'alpn_h2': \(\(\{'1': true, '0': false\}\)\[\(\(hostvars\[yuk_yuk_host\]\.yt_yk \| default\(\{\}\)\)\.alpn_h2 \| default\('-'\)\)\] \| default\(none\)\)/);
  const kay = "((hostvars[yuk_yuk_host].yt_yk | default({})).alpn_kaynak | default(''))";
  assert.ok(yml.includes(`'alpn_kaynak': (${kay} if (${kay} in ['curl', 'openssl']) else none),`), "alpn_kaynak yalniz 'curl' | 'openssl' metni, digeri none");
  const h2 = "((yuk_protokol | default('h1') | string) == 'h2')";
  const oss = "(yt_s_onk.alpn_kaynak == 'openssl')";
  assert.ok(
    yml.includes(`' yol h2)']) if (${h2} and (yt_s_onk.alpn_h2 is sameas false)) else [])`),
    'ALPN engeli yalniz h2 ve alpn_h2 TAM false iken',
  );
  assert.ok(
    yml.includes(
      `+ ((['HTTP/2: hedef bu Host icin ALPN ile h2 sunmuyor (openssl ile olculdu; curl h2 desteklemiyor, yollar HTTP/1.1 ile denendi)'] if ${oss} else [`,
    ),
    'openssl kaynakli ALPN engeli sayisiz metinle (yollar_h2 none)',
  );
  assert.ok(
    yml.includes(
      `+ ((['HTTP/2 olculemedi (curl h2 desteklemiyor, openssl ile ALPN olculemedi)'] if ${oss} else ['HTTP/2 olculemedi (curl h2 desteklemiyor ya da yanitli yol yok)']) if (${h2} and (yt_s_onk.alpn_h2 is none)) else [])`,
    ),
    'olculemedi engeli yalniz h2 ve alpn_h2 null iken (kaynak openssl ise openssl metni)',
  );
  assert.ok(!/curl_h2 is sameas false|not yt_s_onk\.curl_h2/.test(yml), 'curl_h2 false TEK BASINA playbook engeli DEGIL');
  // Bicimden bagimsiz: curl_h2 playbook'ta YALNIZ yt_s_onk anahtari olarak gecer ('== false', 'is false', '| bool'
  // gibi her kullanim ikinci bir gecis olur ve burada patlar).
  const curlGecisleri = yml.split('\n').filter((s) => s.includes('curl_h2'));
  assert.equal(curlGecisleri.length, 1, `curl_h2 playbook'ta yalniz yt_s_onk anahtari olmali: ${curlGecisleri.join(' | ')}`);
  assert.equal((curlGecisleri[0].match(/curl_h2/g) || []).length, 2, 'curl_h2 satirinda yalniz anahtar + yt_yk.curl_h2 okuma');
  assert.match(curlGecisleri[0], /^\s*'curl_h2': \(\(\{'1': true, '0': false\}\)\[\(\(hostvars\[yuk_yuk_host\]\.yt_yk \| default\(\{\}\)\)\.curl_h2 \| default\('-'\)\)\] \| default\(none\)\),$/);
  assert.ok(yml.includes("['HTTP/2: hedef bu Host icin ALPN ile h2 sunmuyor (' ~ (yt_s_onk.yollar_h2 | string) ~ '/' ~ (yt_s_onk.yollar_yanitli | string)"));
  const yanki =
    "'protokol': ((yuk_protokol | default('h1') | string) if ((yuk_protokol | default('h1') | string) in ['h1', 'h2']) else none),";
  assert.equal(yml.split(yanki).length - 1, 2, 'kok protokol yankisi sonuc sozlesmesinde ve rescue yedek sonucunda');
  assert.match(yml, /'surum': 2,/, 'surum 2 kalir');
});

test('NA9 (d) kos.sh: GODEBUG yalniz h1, miras http2client suzulur, -e PROTOKOL, DUR protokol kolonlarindan', () => {
  const k = oku('files/kos.sh');
  assert.ok(!k.includes('export GODEBUG="${GODEBUG:+$GODEBUG,}http2client=0"'), 'kosulsuz GODEBUG http2client=0 kalmamali');
  assert.ok(k.includes('case "$g" in ""|http2client=*) ;; *) GD="${GD:+$GD,}$g" ;; esac'), 'miras http2client= girdileri silinir');
  assert.ok(k.includes('[ "$PROTOKOL" = h1 ] && GD="${GD:+$GD,}http2client=0"'), 'http2client=0 yalniz h1');
  assert.ok(k.includes('if [ -n "$GD" ]; then export GODEBUG="$GD"; else unset GODEBUG; fi'));
  assert.ok(k.includes('-e PROTOKOL="$PROTOKOL" "$BETIK_M" &'), "k6'ya -e PROTOKOL");
  assert.ok(k.includes('[ "$PROTOKOL" = h2 ] && [ "$KIP" != ka ]; then hata "PROTOKOL=h2 yalniz KIP=ka ile"'));
  assert.ok(!/kolon "\$CSV" http2\)/.test(k), 'DUR icin http2 kolonu OKUNMAZ (h2 kosusunda her yanitta dolu)');
  assert.ok(k.includes('pr="$(kolon "$CSV" protokol)"; pu="$(kolon "$CSV" protokol_uyumsuz)"'));
  const sira = ['elif [ "$pr" != "$PROTOKOL" ]; then', 'elif [ "${pu:-0}" != 0 ]; then', 'elif [ "$rc" != 0 ]; then'].map((x) => k.indexOf(x));
  assert.ok(sira.every((x, i) => x > 0 && (i === 0 || x > sira[i - 1])), `DUR sirasi 429 -> protokol -> uyumsuz -> rc: ${sira}`);
});

test('NA9 (e) on_kontrol.sh: h2 --http2, curl h2siz red YOK (yollar h1, ALPN openssl), alpn_h2 hesabi', () => {
  const o = oku('files/on_kontrol.sh');
  assert.ok(o.includes('[ -n "$HTTP_SURUM" ] && a+=("$HTTP_SURUM")'));
  const h2 = o.indexOf('if [ "$PROTOKOL" = h2 ]; then\n    printf \'curl_h2\\t%d\\n\' "$ch2"');
  const xargs = o.indexOf('| xargs -0 -n 1 -P "$PARALEL" bash "$0" _tek');
  assert.ok(h2 > 0 && xargs > h2, 'curl_h2 satiri isteklerden (xargs) ONCE');
  assert.ok(!o.includes('red "curl HTTP/2 desteklemiyor'), 'curl h2siz artik red DEGIL');
  assert.ok(
    o.includes('[ "$ch2" = 1 ] && HTTP_SURUM=--http2\n  elif [ "$ch2" = 1 ]; then\n    HTTP_SURUM=--http1.1\n  fi'),
    'h2 + curl h2li --http2, curl h2siz bayraksiz (h1 yolu), h1 bugunku --http1.1',
  );
  assert.ok(o.includes('(ny == 0 ? "-" : (n2 == ny ? "1" : "0"))'), 'alpn_h2 (curl): yanitli 0 -> -, hepsi h2 -> 1, aksi 0');
  assert.ok(o.includes('$1 == "YOL" && $3 != "-" { ny++; if ($3 ~ /^HTTP\\/2/) n2++ }'));
  const ozet = o.indexOf('END { printf "OZET\\t');
  const curlYol = o.indexOf('if [ "$PROTOKOL" = h2 ] && [ "$ch2" = 1 ]; then', ozet);
  const osslYol = o.indexOf('elif [ "$PROTOKOL" = h2 ]; then', curlYol);
  assert.ok(ozet > 0 && curlYol > ozet && osslYol > curlYol, 'alpn satirlari OZET sonrasi: curl yolu, sonra openssl yolu');
  assert.equal(o.indexOf("printf 'alpn_kaynak\\tcurl\\n'", curlYol) > curlYol && o.indexOf("printf 'alpn_kaynak\\tcurl\\n'", curlYol) < osslYol, true, 'curl yolunda alpn_kaynak curl');
  assert.ok(o.includes("printf 'yollar_h2\\t-\\nalpn_h2\\t%s\\nalpn_kaynak\\topenssl\\n' \"$(alpn_openssl)\""), "openssl yolunda yollar_h2 '-', alpn_kaynak openssl");
  assert.ok(o.includes('local a=(s_client -connect "$HEDEF_IP:443" -alpn h2,http/1.1)'), 'openssl TEK baglanti, k6 gibi h2,http/1.1 sunar');
  assert.ok(o.includes('if [ "$SNI" = 1 ]; then a+=(-servername "$HOST_BASLIGI"); else a+=(-noservername); fi'), 'SNI=1 -servername, SNI=0 -noservername');
  assert.ok(o.includes('timeout -k 2 "$ZAMAN" openssl ${a[@]+"${a[@]}"} < /dev/null > "$d/alpn" 2>&1'), 'timeout, stdin /dev/null, cikti yalniz gecici dosyada');
  assert.ok(o.includes('END { if (!y) print "-"; else if (p == "h2") print 1; else if (p != "" || n) print 0; else print "-" }'), 'el sikisma yoksa -, h2 -> 1, h2 disi / ALPN yok -> 0');
});

test('NA9 (f) wrk_kos.sh: yalniz h1, istemci dosyasinda protokol h1 / protokol_uyumsuz 0', () => {
  const w = oku('files/wrk_kos.sh');
  const hata = w.indexOf('[ "$PROTOKOL" = h1 ] || hata "wrk yalniz HTTP/1.1 konusur (PROTOKOL=$PROTOKOL)"');
  assert.ok(hata > 0 && hata < w.indexOf('"$WRK" -v'), 'PROTOKOL denetimi wrk cagrisindan ONCE');
  assert.ok(w.includes('NUM["http2"] = 0; STR["protokol"] = "h1"; NUM["protokol_uyumsuz"] = 0'));
  assert.match(w, /^KOLONLAR="[^"]*,deneme,protokol,protokol_uyumsuz"$/m);
  assert.match(w, /^JSON_ANAHTARLARI="[^"]* p95_config protokol protokol_uyumsuz"$/m);
});

const bashVar = spawnSync(BASH, ['-c', 'echo ok'], { encoding: 'utf8' }).stdout === 'ok\n';
test('NA9 (g) bash: wrk_kos.sh PROTOKOL=h2 rc 2; kos.sh h2 + yeni rc 2; kos.sh --kuru h2 plani', { skip: bashVar ? false : 'bash yok' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nlh2_'));
  try {
    fs.mkdirSync(path.join(d, 'senaryo'));
    fs.writeFileSync(path.join(d, 'senaryo', 'K.tsv'), '1\t1\thtml\tkucuk\t/app-v1/\n');
    const kos = (betik, ortam, ...arg) =>
      spawnSync(BASH, [posixYol(path.join(DIR, 'files', betik)), 'R1', 'K', ...arg], {
        cwd: d,
        encoding: 'utf8',
        env: { ...process.env, HEDEF: 'https://10.1.2.3', HOST_BASLIGI: 'vhost.test.local', TAVAN_RPS: '450', SENARYO_DIZIN: './senaryo', SONUC: './sonuc', ...ortam },
      });
    let r = kos('wrk_kos.sh', { PROTOKOL: 'h2', WRK: '/yok/wrk' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /HATA: wrk yalniz HTTP\/1\.1 konusur \(PROTOKOL=h2\)/);
    r = kos('wrk_kos.sh', { PROTOKOL: 'h1' }, '--kuru');
    assert.equal(r.status, 0, `wrk h1 --kuru: ${r.stderr}`);
    r = kos('kos.sh', { PROTOKOL: 'h2', KIP: 'yeni', K6: '/yok/k6' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /PROTOKOL=h2 yalniz KIP=ka ile/);
    r = kos('kos.sh', { PROTOKOL: 'h3' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /PROTOKOL h1 ya da h2 olmali/);
    r = kos('kos.sh', { PROTOKOL: 'h2', KIP: 'ka', HIZLAR: '100' }, '--kuru');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^== kos\.sh {2}adim=R1 senaryo=K \(1 satir\) kip=ka ae=br protokol=h2 hizlar=\[100\] tekrar=2$/m);
    r = kos('kos.sh', { HIZLAR: '100', PROTOKOL: '' }, '--kuru');
    assert.match(r.stdout, / protokol=h1 /, 'PROTOKOL yoksa h1');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
