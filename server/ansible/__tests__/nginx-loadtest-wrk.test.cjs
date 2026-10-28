// server/ansible/__tests__/nginx-loadtest-wrk.test.cjs - Yuk Testi tur 3 (wrk motoru, serbest hedef) metin kurallari.
//
// NEDEN: wrk ve Lua yorumlayicisi CI'da yok; yuk_wrk.lua hic kosmadan, wrk_kos.sh ise yalniz Ansible deposundaki bekcide
// (sahte wrk ile) sinanir. Bu test aynadaki dosyalarin METNINDEN, davranisi tasiyan satirlari kilitler (NA6):
//   (a) yuk_wrk.lua ust duzeyi: sutun 0'da yalniz '--', 'local ', 'function ', 'end', 'do', '}' ya da bos; tek 'do'
//       blogu dosyanin SON blogu (yukleme isareti: betik sonuna kadar yuklendi kaniti); setup/init/delay/request/
//       response/done tanimli. wrk betik yukleme hatasini yalniz stderr'e yazar ve VARSAYILAN istekle yuke devam eder.
//   (b) Lua OZET_ANAHTARLARI = wrk_kos.sh OZET_ANAHTARLARI (21; ozet dosyasinin satir sirasi).
//   (c) wrk_kos.sh KOLONLAR = yuk_k6.js KOLONLAR (istemci CSV semasi iki motorda ayni; Portal okuyucusu tek).
//   (d) Lua AE_DEGER = yuk_k6.js AE_DEGER.
//   (e) User-Agent '<UA_ONEK>/<TUR>/<FAZ>/<DENEME>'; 'close' yalniz KIP == 'yeni' kosulunda; response() ilk 429 ya da
//       >= 500'de wrk.thread:stop(); done() yuzdelikleri latency:percentile ile; wrk_kos.sh awk'i us -> ms (/ 1000).
//   (f) durdur.sh wrk adayi ([w]rk + ' -s <kosu_dizini>/yuk_wrk.lua') ve wrk_kos.sh.
//   (g) playbook: hedef add_host yalniz sunucu hedefte; wrk -> yuk_sni '0' maddesi; groups['yuk_hedef'] YOK; her
//       when / failed_when / changed_when degerinde ve her assert.that maddesinde parantez derinligi 0'da ' if ' YOK
//       (eski Ansible kosul yolu '{% if <ifade> %}' TemplateSyntaxError verir; '( ile baslar ) ile biter' yetmez).
//   (h) Lua sayaclari ayri GLOBAL sayilar ('durum = {' yok); ':get(' yalniz done() icinde, sayac adi dongu degiskeniyle
//       (tablo degerli thread:get is parcacigi yiginini bozar); SAYACLAR 7 ad.
//   (i) delay(): her donus GECIKME_MS ya da GECIKME_MS + math.random(0, GECIKME_MS - 1) (alt sinir D, ust 2D - 1:
//       ortalama tavan kaniti), jitter yalniz is parcacigi sayaciyla (ILK_KALAN = BAGLANTI / IS_PARCACIGI, init'te;
//       wrk baglantilari birlikte acar, sabit bekleme fazlari kumeli kalir); GECIKME_MS = math.ceil(BAGLANTI * 1000 /
//       TAVAN); init IS_PARCACIGI'ni ortamdan 1..16 ve BAGLANTI'yi bolen deger olarak dogrular; wrk_kos.sh wrk ortamina
//       TAVAN_RPS ve IS_PARCACIGI verir (-t ayni degisken); playbook async argv'sinde "TAVAN_RPS={{ yuk_tavan_rps }}".
//       Jitter is parcacigina ozgu (2026-10-28 AV1): init'te birebir '  math.randomseed(os.time() + (tonumber(id) or 0) *
//       7919)', dosyada baska randomseed yok, setup'ta '  thread:set('id', #threads)' (wrk is parcaciklarinin init()'i
//       ayni saniyede kosar; tohum id terimini kaybederse hepsi AYNI jitter dizisini uretir ve kumelenme geri gelir).
//   (j) /etc/portal_yuktesti/serbest_aglar LITERAL (extra_vars ile yonlendirilemez) tam bir stat ve bir slurp gorevinde;
//       izin blogu Play 3'te on kontrol ve yuk kosusu bloklarindan ONCE.
//   (k) Play 2 kosu blogunda kosu kapisi (on_kontrol.sh hedef + 'kosu kapisi' fail'i) TEK shell'den (kaydedici) ONCE.
//   (l) 3. assert (is gecerlilik suresi): yuk_son_epoch ve now().timestamp().
//   (m) izin blogu ret nedeni: 'gecersiz girdi' yalniz yazdirilabilir ASCII (regex_replace('[^ -~]', '?'); BOM / UTF-8
//       disi bayt set_stats'a vekil karakter tasimasin), girdisi en cok 40 karakter (truncate(40, true, '...', 0)) ve www
//       uid'i olculmemisse RED (is match(yt_re_uid)); dosya metni b64decode'dan hemen sonra temizlenir
//       (regex_replace(yt_re_yazdirilamaz, '?'), yt_re_yazdirilamaz '[^\s!-~]': AWX is olayinda tek vekil kalmaz,
//       trim'in sildigi bosluklar kalir).
// Davranis Ansible deposundaki check_nginx_loadtest_job.py'de (L5-L7, L11). NGINX_LOADTEST_AYNA: mutasyon kopyasi dizini.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = process.env.NGINX_LOADTEST_AYNA || path.join(__dirname, '..', 'bmw_portal', 'nginx_loadtest');
const oku = (rel) => fs.readFileSync(path.join(DIR, ...rel.split('/')), 'utf8');

// Lua: 'function <ad>(' satirindan sutun 0'daki ilk 'end' satirina kadar.
function luaGovde(lua, ad) {
  const s = lua.split('\n');
  const bas = s.findIndex((x) => x.startsWith(`function ${ad}(`));
  if (bas < 0) return '';
  const son = s.findIndex((x, i) => i > bas && x === 'end');
  return s.slice(bas, son < 0 ? s.length : son + 1).join('\n');
}

// Kabuk: '<ad>() {' satirindan sutun 0'daki ilk '}' satirina kadar.
function kabukGovde(sh, ad) {
  const s = sh.split('\n');
  const bas = s.findIndex((x) => x.startsWith(`${ad}() {`));
  if (bas < 0) return '';
  const son = s.findIndex((x, i) => i > bas && x === '}');
  return s.slice(bas, son < 0 ? s.length : son + 1).join('\n');
}

const tirnakliListe = (metin) => [...metin.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);

test('NA6 (a)-(e), (h), (i) yuk_wrk.lua ust duzeyi, sabitler, basliklar, durma, sayaclar, tavan', () => {
  const lua = oku('files/yuk_wrk.lua');
  const wk = oku('files/wrk_kos.sh');
  const k6 = oku('files/yuk_k6.js');
  const satirlar = lua.split('\n');

  // (a)
  const kotu = satirlar.filter(
    (s) => s !== '' && !/^\s/.test(s) && !/^(--|local |function )/.test(s) && !['end', 'do', '}'].includes(s),
  );
  assert.deepEqual(kotu, [], 'yuk_wrk.lua ust duzeyinde yalniz tanim olmali (calisan ust duzey kod yukleme hatasinda sessizce atlanir)');
  const dolar = satirlar.map((s, i) => (s === 'do' ? i : -1)).filter((i) => i >= 0);
  assert.equal(dolar.length, 1, 'tek do ... end yukleme isareti blogu');
  assert.deepEqual(
    satirlar.slice(dolar[0] + 1).filter((s) => s !== '' && !/^\s/.test(s)),
    ['end'],
    'do blogu dosyanin SON blogu olmali (isaret ancak betik sonuna kadar yuklendiyse yazilir)',
  );
  assert.match(satirlar.slice(dolar[0]).join('\n'), /os\.getenv\('LUA_YUKLEME_ISARETI'\)/, 'son blok yukleme isaretini yazar');
  for (const f of ['setup', 'init', 'delay', 'request', 'response', 'done']) {
    assert.match(lua, new RegExp(`^function ${f}\\(`, 'm'), `function ${f}( tanimli olmali`);
  }

  // (b)
  const luaOzet = tirnakliListe((lua.match(/^local OZET_ANAHTARLARI = \{([^}]*)\}$/m) || [])[1] || '');
  const shOzet = ((wk.match(/^OZET_ANAHTARLARI="([^"]*)"$/m) || [])[1] || '').split(' ');
  assert.equal(shOzet.length, 21, 'wrk_kos.sh OZET_ANAHTARLARI 21 anahtar');
  assert.deepEqual(luaOzet, shOzet, 'Lua OZET_ANAHTARLARI = wrk_kos.sh OZET_ANAHTARLARI (ozet dosyasi satir sirasi)');

  // (c)
  const k6Kolon = tirnakliListe((k6.match(/const KOLONLAR = \[([^\]]*)\]/) || [])[1] || '');
  const shKolon = ((wk.match(/^KOLONLAR="([^"]*)"$/m) || [])[1] || '').split(',');
  assert.equal(k6Kolon.length, 30, 'yuk_k6.js KOLONLAR okunamadi');
  assert.deepEqual(shKolon, k6Kolon, 'wrk_kos.sh KOLONLAR = yuk_k6.js KOLONLAR');

  // (d)
  const aeLua = Object.fromEntries(
    [...((lua.match(/^local AE_DEGER = \{([^}]*)\}$/m) || [])[1] || '').matchAll(/(\w+) = '([^']*)'/g)].map((m) => [m[1], m[2]]),
  );
  const aeK6 = Object.fromEntries(
    [...((k6.match(/const AE_DEGER = \{([^}]*)\}/) || [])[1] || '').matchAll(/(\w+): '([^']*)'/g)].map((m) => [m[1], m[2]]),
  );
  assert.equal(Object.keys(aeK6).length, 3, 'yuk_k6.js AE_DEGER okunamadi');
  assert.deepEqual(aeLua, aeK6, 'Lua AE_DEGER = yuk_k6.js AE_DEGER');

  // (e)
  assert.ok(lua.includes("UA_ONEK .. '/' .. TUR .. '/' .. FAZ .. '/' .. DENEME"), 'User-Agent <UA_ONEK>/<TUR>/<FAZ>/<DENEME>');
  const close = satirlar.filter((s) => s.includes("'close'"));
  assert.ok(close.length >= 1, "Connection 'close' (yeni kip) yok");
  assert.deepEqual(
    close.filter((s) => !/\bif KIP == 'yeni' then\b/.test(s)),
    [],
    "'close' yalniz KIP == 'yeni' kosulunda (ka kipinde baglanti yeniden kullanilir)",
  );
  const response = luaGovde(lua, 'response');
  assert.match(response, /wrk\.thread:stop\(\)/, "response() 429 / 5xx'te is parcacigini durdurmali");
  const durma = response.split('\n').filter((s) => /^\s*if .*\bDURDU\b/.test(s));
  assert.equal(durma.length, 1, 'tek durma kosulu');
  assert.ok(
    /status == 429/.test(durma[0]) && /status >= 500/.test(durma[0]),
    `durma kosulunda hem 429 hem >= 500 olmali: ${durma[0]}`,
  );
  const done = luaGovde(lua, 'done');
  for (const p of [50, 95, 99]) assert.ok(done.includes(`latency:percentile(${p})`), `done() p${p}: latency:percentile`);
  const yaz = kabukGovde(wk, 'yaz_istemci');
  for (const p of ['p50', 'p95', 'p99']) {
    assert.ok(yaz.includes(`NUM["${p}"] = ov["${p}_us"] / 1000`), `wrk_kos.sh awk'i ${p}_us -> ms (/ 1000)`);
  }

  // (h)
  assert.ok(!/\bdurum = \{/.test(lua), "sayaclar tablo degil ayri global sayilar ('durum = {' YOK)");
  assert.deepEqual(
    tirnakliListe((lua.match(/^local SAYACLAR = \{([^}]*)\}$/m) || [])[1] || ''),
    ['s1xx', 's2xx', 's3xx', 's429', 's4xx', 's5xx', 'sdiger'],
    'SAYACLAR 7 ad',
  );
  assert.match(luaGovde(lua, 'init'), /^\s+s1xx, s2xx, s3xx, s429, s4xx, s5xx, sdiger = 0, 0, 0, 0, 0, 0, 0$/m, 'sayaclar init()te global 0');
  const getler = [...lua.matchAll(/:get\(([^)]*)\)/g)];
  assert.ok(getler.length >= 1, 'done() thread:get ile okumali');
  assert.deepEqual(
    getler.filter((m) => !done.includes(m[0]) || m[1] !== 'ad'),
    [],
    "':get(' yalniz done() icinde ve sayac adi dongu degiskeniyle (ad)",
  );
  assert.match(done, /for _, ad in ipairs\(SAYACLAR\) do\n\s+local v = t:get\(ad\)/, 'her is parcacigi ve her SAYACLAR adi icin t:get(ad)');

  // (i)
  const JITTER = 'GECIKME_MS + math.random(0, GECIKME_MS - 1)';
  const delayGovde = luaGovde(lua, 'delay');
  assert.deepEqual(
    [...delayGovde.matchAll(/^\s*return\b(.*)$/gm)].map((m) => m[1].trim()).sort(),
    ['GECIKME_MS', JITTER],
    'delay() her donusu GECIKME_MS ya da GECIKME_MS + math.random(0, GECIKME_MS - 1) (her bekleme >= D: ortalama tavan kaniti)',
  );
  assert.deepEqual(
    delayGovde.split('\n').map((s) => s.trim()).filter(Boolean),
    ['function delay()', 'if ILK_KALAN > 0 then', 'ILK_KALAN = ILK_KALAN - 1', `return ${JITTER}`, 'end', 'return GECIKME_MS', 'end'],
    'delay(): jitter yalniz is parcacigi sayaciyla (ilk BAGLANTI / IS_PARCACIGI cagri), sonra tam GECIKME_MS',
  );
  const init = luaGovde(lua, 'init');
  assert.match(init, /GECIKME_MS = math\.ceil\(BAGLANTI \* 1000 \/ TAVAN\)/, 'bekleme ceil(BAGLANTI * 1000 / TAVAN)');
  assert.deepEqual(
    [...lua.matchAll(/^\s*GECIKME_MS\s*=(?!=)\s*(.*)$/gm)].map((m) => m[1]),
    ['math.ceil(BAGLANTI * 1000 / TAVAN)'],
    'GECIKME_MS yalniz init()te atanir (delay() onu kucultemez)',
  );
  const sira = [
    "  BAGLANTI = tonumber(ortam('BAGLANTI', '^[1-9][0-9]*$'))",
    "  IS_PARCACIGI = tonumber(ortam('IS_PARCACIGI', '^[1-9][0-9]*$'))",
    "  if IS_PARCACIGI > 16 or BAGLANTI % IS_PARCACIGI ~= 0 then error('yuk_wrk.lua: ",
    '  ILK_KALAN = BAGLANTI / IS_PARCACIGI',
  ].map((s) => init.indexOf(s));
  assert.ok(
    sira.every((i) => i >= 0) && sira.every((i, k) => k === 0 || i > sira[k - 1]),
    `init(): IS_PARCACIGI ortamdan, 1..16 ve BAGLANTI'yi tam bolen deger olarak dogrulanir; sayac ILK_KALAN = BAGLANTI / IS_PARCACIGI ondan SONRA: ${sira}`,
  );
  const TOHUM = '  math.randomseed(os.time() + (tonumber(id) or 0) * 7919)';
  assert.ok(
    init.split('\n').includes(TOHUM),
    `init() is parcacigina ozgu tohumu birebir tasimali (${TOHUM.trim()}): tohum id terimini kaybederse is parcaciklari ayni jitter dizisini uretir`,
  );
  assert.equal((lua.match(/randomseed/g) || []).length, 1, 'dosyada tek randomseed (ikinci tohum is parcacigi terimini ezer)');
  assert.ok(
    luaGovde(lua, 'setup').split('\n').includes("  thread:set('id', #threads)"),
    "setup() her is parcacigina thread:set('id', #threads) vermeli (tohumun id terimi; yoksa id nil, tohum herkes icin os.time())",
  );
  const wc = kabukGovde(wk, 'wrk_cagir');
  const wrkOrtami = wc.slice(wc.indexOf('env -u LUA_YUKLEME_ISARETI'), wc.indexOf('"$WRK" -t'));
  assert.match(wrkOrtami, /\bTAVAN_RPS="\$TAVAN_RPS"/, "wrk_cagir wrk ortamina TAVAN_RPS vermeli");
  assert.match(wrkOrtami, /(^|\s)IS_PARCACIGI="\$IS_PARCACIGI"(\s|$)/, 'wrk_cagir wrk ortamina IS_PARCACIGI vermeli (Lua init dogrular; jitter sayaci N / T)');
  assert.match(wc, /"\$WRK" -t "\$IS_PARCACIGI" -c "\$N"/, 'wrk -t IS_PARCACIGI (ortamdaki deger ile ayni)');
  assert.match(wc, /-s "\$BETIK_M" "\$HEDEF\/"/, 'wrk argv sirasi: -s <kosu_dizini>/yuk_wrk.lua "$HEDEF/" (durdur.sh deseni)');
});

test('NA6 (f) durdur.sh wrk adayi ve wrk_kos.sh', () => {
  const dur = oku('files/durdur.sh');
  assert.ok(
    dur.includes('if ($2 ~ /(^|\\/)[w]rk[^\\/]*$/ && index($0, " -s " ENVIRON["D"] "yuk_wrk.lua") > 0) { print p "\\twrk"; next }'),
    'durdur.sh: [w]rk deseni ve -s <kosu_dizini>/yuk_wrk.lua',
  );
  assert.ok(dur.includes('$3 == ENVIRON["D"] "wrk_kos.sh"'), 'durdur.sh bash betik listesinde wrk_kos.sh');
});

// Kosul metinleri: when / failed_when / changed_when degeri (tek satir ya da '>-' blogu, tam metin) ve her assert.that maddesi.
function kosulMetinleri(yml) {
  const s = yml.split('\n');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const m = /^(\s*)(when|failed_when|changed_when): (.*)$/.exec(s[i]);
    if (m) {
      if (['>-', '>', '|', '|-'].includes(m[3])) {
        const parca = [];
        for (let j = i + 1; j < s.length && (s[j].trim() === '' || s[j].search(/\S/) > m[1].length); j++) parca.push(s[j].trim());
        out.push({ anahtar: m[2], metin: parca.join(' ') });
      } else if (!/^(true|false)$/.test(m[3])) {
        out.push({ anahtar: m[2], metin: m[3] });
      }
      continue;
    }
    const t = /^(\s*)that:$/.exec(s[i]);
    if (t) {
      for (let j = i + 1; j < s.length && /^\s*- /.test(s[j]) && s[j].search(/\S/) > t[1].length; j++) {
        out.push({ anahtar: 'that', metin: s[j].replace(/^\s*- /, '') });
      }
    }
  }
  return out;
}

// Dize sabitleri ve parantez / koseli / kume icindeki her karakter 'x': yalniz derinlik 0 metni kalir.
function sifirDerinlik(metin) {
  let d = 0;
  let q = null;
  let out = '';
  for (const c of metin) {
    if (q) {
      out += 'x';
      if (c === q) q = null;
    } else if (c === "'" || c === '"') {
      q = c;
      out += 'x';
    } else if ('([{'.includes(c)) {
      d++;
      out += 'x';
    } else if (')]}'.includes(c)) {
      d--;
      out += 'x';
    } else out += d === 0 ? c : 'x';
  }
  return out;
}

test('NA6 (g) playbook: hedef add_host sunucu kosullu, wrk sni 0, groups[yuk_hedef] yok, kosullarda derinlik 0 if yok', () => {
  const yml = oku('nginx_loadtest.yml');
  assert.match(
    yml,
    /ansible\.builtin\.add_host:\n\s+name: "\{\{ yuk_hedef_host \}\}"\n\s+groups: yuk_hedef\n\s+changed_when: false\n\s+when: \(yuk_hedef_turu \| default\('sunucu'\) \| string\) == 'sunucu'\n/,
    'hedef add_host yalniz sunucu hedefte (serbestte hedef host yok, Play 2 / 4 atlanir)',
  );
  assert.ok(
    yml.includes("- (((yuk_sni | string) == '0') if ((yuk_motor | default('') | string) == 'wrk') else true)\n"),
    "wrk -> yuk_sni '0' maddesi",
  );
  assert.ok(!yml.includes("groups['yuk_hedef']"), "groups['yuk_hedef'] serbestte StrictUndefined ile patlar (Play 5 rescue)");
  const kosullar = kosulMetinleri(yml);
  assert.ok(kosullar.filter((k) => k.anahtar === 'that').length >= 60, 'assert maddeleri okunamadi (test yanlis yere bakiyor)');
  assert.ok(kosullar.some((k) => k.anahtar === 'when' && k.metin.includes('yt_ip_sayi')), ">- blogu when'leri okunamadi");
  const tuzak = kosullar.filter((k) => /(?:^|\s)if\s/.test(sifirDerinlik(k.metin)));
  assert.deepEqual(
    tuzak.map((k) => `${k.anahtar}: ${k.metin.slice(0, 120)}`),
    [],
    "parantez derinligi 0'da ' if ' (eski Ansible kosul yolunda TemplateSyntaxError; ((x) if (y) else (z)) yazin)",
  );
});

test('NA6 (j)-(m) izin dosyasi literal ve sirasi, Play 2 kosu kapisi, is gecerlilik suresi, ASCII ret nedeni ve uid', () => {
  const yml = oku('nginx_loadtest.yml');
  const playlar = yml.split(/\n(?=- name: )/).filter((p) => /^ {2}hosts: /m.test(p));
  assert.equal(playlar.length, 8, 'play sayisi (test yanlis yere bakiyor olmasin)');

  // (j)
  const IZIN = '/etc/portal_yuktesti/serbest_aglar';
  assert.equal(
    [...yml.matchAll(/ansible\.builtin\.stat:\n\s+path: \/etc\/portal_yuktesti\/serbest_aglar\n/g)].length,
    1,
    'izin dosyasi TAM bir stat gorevinde literal yol',
  );
  assert.equal(
    [...yml.matchAll(/ansible\.builtin\.slurp:\n\s+src: \/etc\/portal_yuktesti\/serbest_aglar\n/g)].length,
    1,
    'izin dosyasi TAM bir slurp gorevinde literal yol',
  );
  const yolSatirlari = yml.split('\n').filter((s) => /^\s+(path|src): /.test(s) && s.includes('portal_yuktesti/serbest_aglar'));
  assert.deepEqual(
    yolSatirlari.filter((s) => s.includes('{{')),
    [],
    `${IZIN} yol degerlerinde {{ }} yok (extra_vars ile yonlendirilemesin)`,
  );
  const p3 = playlar[2];
  const izin = p3.indexOf('- name: --- [Task] Serbest hedef izin listesi');
  const onk = p3.indexOf('- name: --- [Task] On kontrol (yuk makinesi) ---');
  const kosu = p3.indexOf('- name: --- [Task] Yuk kosusu');
  assert.ok(izin > 0 && onk > izin && kosu > izin, 'izin blogu Play 3te on kontrol ve yuk kosusu bloklarindan ONCE');

  // (k)
  const p2 = playlar[1];
  const blok = p2.indexOf('- name: --- [Task] CPU kaydedici (hedef) ---');
  const kapi = p2.indexOf('Kosu kapisi: hedef IP hedefte hala yerel mi', blok);
  const hedefKomutu = p2.indexOf('- "{{ yt_dizin }}/on_kontrol.sh"\n                  - hedef\n', kapi);
  const fail = p2.indexOf('msg: "kosu kapisi: hedef IP', kapi);
  const shell = p2.indexOf('ansible.builtin.shell:');
  assert.equal(p2.split('ansible.builtin.shell:').length - 1, 1, 'Play 2de TEK shell (kaydedici baslatma)');
  assert.ok(
    blok > 0 && kapi > blok && hedefKomutu > kapi && fail > hedefKomutu && shell > fail,
    'Play 2 kosu blogunda on_kontrol.sh hedef komutu ve kosu kapisi fail i TEK shell den ONCE',
  );
  assert.match(p2.slice(fail - 300, fail + 300), /when: yt_kosu_ip_yerel != '1'/, "kosu kapisi ip_yerel '1' degilse duser");

  // (l)
  const gecerlilik = yml.slice(yml.indexOf('Is gecerlilik suresi'), yml.indexOf('fail_msg', yml.indexOf('Is gecerlilik suresi')));
  assert.ok(
    gecerlilik.includes("- (yuk_son_epoch | default('') | string) is match(yt_re_epoch)") &&
      gecerlilik.includes('- (yuk_son_epoch | int) >= (now().timestamp() | int)') &&
      gecerlilik.includes('- (yuk_son_epoch | int) <= ((now().timestamp() | int) + 1800)'),
    '3. assert: yuk_son_epoch ve now().timestamp() (Relaunch 15 dk sonra reddedilir)',
  );
  assert.match(
    playlar[2],
    /- "TAVAN_RPS=\{\{ yuk_tavan_rps \}\}"\n/,
    'playbook async argv sinde "TAVAN_RPS={{ yuk_tavan_rps }}"',
  );

  // (m)
  const neden = p3.slice(p3.indexOf('yt_ag_neden: >-'), p3.indexOf('- name: --- [Task] Serbest izin sonucu'));
  assert.ok(
    neden.includes("('gecersiz girdi: ' ~ (yt_ag_gecersiz | first | regex_replace('[^ -~]', '?') | truncate(40, true, '...', 0)))"),
    "ret nedeni 'gecersiz girdi: <girdi>' yalniz yazdirilabilir ASCII (regex_replace('[^ -~]', '?') truncate'ten ONCE) ve girdi en cok 40 " +
      "karakter (truncate(40, true, '...', 0): Jinja varsayilani 45'e kadar kesmez, daha uzunu kelime sinirinda keser)",
  );
  assert.ok(
    p3.includes(
      "yt_ag_metin: \"{{ (yt_ag_raw.content | b64decode | regex_replace(yt_re_yazdirilamaz, '?')) if (yt_ag_raw.content is defined) else '' }}\"",
    ) && /^ {4}yt_re_yazdirilamaz: '\[\^\\s!-~\]'$/m.test(p3),
    "izin dosyasi metni b64decode'dan hemen sonra temizlenir (regex_replace(yt_re_yazdirilamaz, '?'), yt_re_yazdirilamaz '[^\\s!-~]'): " +
      'AWX is olayinda (set_fact sonucu) tek vekil kalmaz, trim in sildigi bosluklar kalir (davranis ayni)',
  );
  assert.ok(
    neden.includes("if not (((yt_y_id.stdout | default('-') | trim) is match(yt_re_uid)) and (yt_ag_dstat.stat.isdir | default(false))") &&
      !neden.includes("yt_y_id.stdout | default('')") &&
      /^ {4}yt_re_uid: '\^\[0-9\]\+\\Z'$/m.test(p3),
    "izin blogu www uid'i olculmemisse (bos / tanimsiz / sayi degil) RED: is match(yt_re_uid), default('-')",
  );
});
