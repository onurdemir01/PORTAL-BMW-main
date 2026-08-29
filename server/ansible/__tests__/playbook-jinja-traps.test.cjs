// server/ansible/__tests__/playbook-jinja-traps.test.cjs — TUM playbook'lari tarayan
// bekci. Bu repoda uretimi kirmis tuzaklar tek tek kod incelemesiyle degil, MEKANIK
// olarak yakalanmali: ayni hata en az iki kez tekrarlandi.
//
// TUZAK 1 · KATLAMALI SKALER + `{% set %}`
//   `logx_ocp_namespace_discovery.yml` yorumu bunu ZATEN belgeliyordu:
//   "deger uretimde `'      failed'` olarak yayinlanmisti".
//   YAML katlamali skalerde (`>-`) satir sonlari BOSLUGA doner ve `{% set %}` etiketleri
//   arasindaki bosluklar CIKTIYA SIZAR. `| trim` yalniz IFADENIN SONUCUNU kirpar,
//   etiketlerden gelen bu bosluklari DEGIL. Portal `"failed"` bekler, `"      failed"`
//   gorur, eslesmez ve durum SESSIZCE yanlis yorumlanir.
//   Buna ragmen ayni hata `ocp_pod_source_extract.yml`de aynen tekrarlanmisti.
//
// TUZAK 3 · "NO MORE HOSTS LEFT" — SONUC SOZLESMESI HIC YAYINLANMAZ
//   Ansible bir play'deki TUM host'lar duserse calistirmayi bitirir ve SONRAKI
//   PLAY'LERI ATLAR. `set_stats`'in TEK yazari ayri bir toplayici play ise sonuc
//   sozlesmesi HIC yayinlanmaz ve portal "yapilandirilmis sonuc gelmedi" deyip ham
//   log gosterir.
//   URETIMDE YASANDI (Telnet, gbocpcicd2): vault parolasi cozulemedi -> assert dustu
//   -> tek bastion oldugu icin ayakta host kalmadi -> toplayici play atlandi.
//   Bu tuzak LogX'te ZATEN belgelenmisti (logx_ocp_discover_fetch.yml) ve Telnet'te
//   AYNEN tekrarlandi — bu yuzden artik mekanik olarak yakalaniyor.
//
// TUZAK 2 · `no_log` ALTINDA KAYBOLAN SEBEP — uretimde iki kez yasandi (job 3218662,
//   3218799): login gorevi `no_log: true` oldugu icin hata "censored" gorunuyor, sebep
//   HICBIR YERDE yazmiyordu. Kural: parola tasiyan gorev AYRI olmali.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'playbooks');
const FILES = fs.readdirSync(DIR).filter((f) => /\.(yml|yaml)$/.test(f));

function read(f) {
  return fs.readFileSync(path.join(DIR, f), 'utf8');
}

// Yorum satirlari haric: aciklamalar tuzagi ANLATMAK icin ondan alinti yapiyor.
function codeOnly(src) {
  return src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}

test('playbook dizini bos degil (test yanlis yere bakiyor olmasin)', () => {
  assert.ok(FILES.length >= 15, `beklenenden az playbook bulundu: ${FILES.length}`);
});

test('TUZAK 1: katlamali skalerde `{% set %}` bosluk denetimi ZORUNLU', () => {
  const offenders = [];
  for (const f of FILES) {
    const code = codeOnly(read(f));
    // Katlamali skaler (`>-` ya da `>`) ile baslayan ve icinde `{% set %}` gecen bloklar.
    const re = /:\s*>-?\s*\n((?:[ \t]+.*\n)+)/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const block = m[1];
      if (!/\{%-?\s*set\s/.test(block)) continue;
      // Her `{% set %}` etiketi HEM acilista HEM kapanista bosluk denetimli olmali.
      for (const tag of block.match(/\{%-?[\s\S]*?-?%\}/g) || []) {
        if (!/^\{%-/.test(tag) || !/-%\}$/.test(tag)) {
          offenders.push(`${f}: ${tag.replace(/\s+/g, ' ').slice(0, 70)}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [],
    'katlamali skalerde bosluk denetimsiz Jinja etiketi — deger basinda bosluklarla yayinlanir:\n' + offenders.join('\n'));
});

test('TUZAK 2: parola tasiyan gorevde `no_log` var', () => {
  // `oc login --password=...` iceren her gorev no_log tasimali. no_log'u KALDIRMAK
  // cluster parolalarini AWX job ciktisina dokerdi — bu, kullanicinin acik kuralidir.
  const offenders = [];
  for (const f of FILES) {
    const src = read(f);
    if (!/--password=/.test(src)) continue;
    // Gorev bloklarini kabaca ayir; parola gecen blokta no_log aranir.
    const tasks = src.split(/\n(?=\s*-\s+name:)/);
    for (const t of tasks) {
      if (/--password=/.test(t) && !/no_log:\s*true/.test(t)) {
        offenders.push(`${f}: ${(t.match(/name:\s*"?([^"\n]+)/) || [])[1] || '?'}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'parola AWX ciktisina sizabilir:\n' + offenders.join('\n'));
});

test('TUZAK 2b: `no_log` gorevi mumkun oldugunca DAR — sonuc ayri gorevde okunuyor', () => {
  // Uretimde iki kez yasandi: tek bir buyuk `no_log` gorevi hem parolayi hem HATA
  // SEBEBINI gizledi. Kural: parola tasiyan playbook, `rc`/`stderr`'i AYRI bir gorevde
  // sanitize edip basmali.
  for (const f of FILES) {
    const src = read(f);
    if (!/--password=/.test(src)) continue;
    assert.match(src, /(register:\s*login_results|sanitized|stderr)/i,
      `${f}: parola tasiyan login var ama sonucu sanitize edip basan bir gorev yok — hata "censored" kalir`);
  }
});

test('vault parolalari yalnizca DEGISKEN ADI uzerinden cozuluyor', () => {
  // Repo kurali: parola DB'ye/extra_vars'a ASLA yazilmaz; portal yalnizca vault
  // degiskeninin ADINI tasir, playbook `lookup('vars', <ad>)` ile cozer.
  for (const f of FILES) {
    const src = read(f);
    if (!/credential_key/.test(src)) continue;
    assert.match(src, /lookup\('vars',\s*item\.credential_key/,
      `${f}: credential_key kullaniliyor ama lookup('vars', ...) ile cozulmuyor`);
  }
});

test('tum playbook dosyalari gecerli YAML', () => {
  // Bu repodaki tuzaklarin cogu YAML GECERLIYKEN patladi — bu test onlari yakalamaz,
  // ama bozuk girinti gibi kaba hatalari erken yakalar.
  for (const f of FILES) {
    const src = read(f);
    assert.ok(src.trim().length > 0, `${f} bos`);
    assert.ok(!src.includes('\t'), `${f} SEKME karakteri iceriyor — YAML sekmeyi kabul etmez`);
  }
});

// ── TUZAK 3 ────────────────────────────────────────────────────────────────
// Yapisal on kosul: playbook'un SON play'i `set_stats` yaziyor ve ondan ONCE
// host play'leri var. Boyle bir playbook'ta host play'leri `rescue` VE
// `ignore_unreachable` tasimak ZORUNDA.
function parsePlays(src) {
  // Kaba ama yeterli: kolon-0 "- " ile baslayan her blok bir play.
  const plays = [];
  let cur = null;
  for (const line of src.split('\n')) {
    if (/^- /.test(line)) { cur = { lines: [line] }; plays.push(cur); }
    else if (cur) cur.lines.push(line);
  }
  return plays.map((p) => {
    const text = p.lines.join('\n');
    const hosts = (text.match(/^  hosts:\s*(.+)$/m) || [])[1] || '';
    return {
      text,
      hosts: hosts.trim(),
      isLocal: /^localhost$/.test(hosts.trim()),
      hasSetStats: /ansible\.builtin\.set_stats:/.test(text),
      hasRescue: /^\s+rescue:/m.test(text),
      hasIgnoreUnreachable: /^\s*ignore_unreachable:\s*true/m.test(text),
    };
  });
}

// Play'in KENDI `vars:` blogunda tanimlanan adlar (`vars_files` DEGIL — o dosya
// tum play'lerde ayri ayri okunur ve tasima sorunu yaratmaz).
function playVarNames(play) {
  const m = play.text.match(/^  vars:\n((?:(?:[ \t]+.*)?\n)*?)(?=^  \S|^- |\Z)/m);
  if (!m) return [];
  return [...m[1].matchAll(/^    ([A-Za-z_][A-Za-z0-9_]*):/gm)].map((x) => x[1]);
}

test('TUZAK 3: ayri toplayici play varsa, oncesindeki host play\'leri rescue + ignore_unreachable tasir', () => {
  const offenders = [];
  for (const f of FILES) {
    const plays = parsePlays(read(f));
    const aggIdx = plays.findIndex((p) => p.isLocal && p.hasSetStats);
    if (aggIdx < 1) continue;                       // ayri toplayici yok -> tuzak yok
    if (FAIL_GUARD_EXEMPT.has(f)) continue;
    for (let i = 0; i < aggIdx; i++) {
      const p = plays[i];
      if (p.isLocal || !p.hosts) continue;          // hazirlik play'leri host calistirmaz
      if (!p.hasRescue) offenders.push(`${f} play#${i} (hosts: ${p.hosts.slice(0, 30)}): rescue YOK`);
      if (!p.hasIgnoreUnreachable) offenders.push(`${f} play#${i}: ignore_unreachable YOK`);
    }
  }
  assert.deepEqual(offenders, [],
    'bu play\'ler duserse toplayici play ATLANIR ve sonuc sozlesmesi HIC yayinlanmaz:\n' + offenders.join('\n'));
});

// BILINCLI ISTISNALAR — gerekceleriyle. Bunlar "unutuldu" degil, KARAR:
//   * logx_ocp_* : ZATEN rescue + ignore_unreachable tasiyorlar ve uretimde
//     sorunsuz calisiyorlar. Portal bu akislarda `overall_status`i okuyup hatayi
//     kendi gosteriyor; AWX is durumunu degistirmek CALISAN uc akisi yeniden
//     dogrulamayi gerektirir — ayri ve daha riskli bir karar.
//   * nginx_config_migration.yml : portal bu playbook'u HIC calistirmiyor (kod
//     tabaninda tek referans yok), yani "sonuc yayinlanmadi" hicbir ekrani
//     etkilemiyor. Ayrica ic ice `block` yapisi var; otomatik sarma denendi ve
//     gorevleri BOZDU (16 gorev 3'e dustu), geri alindi. Elle ve dikkatli bir
//     calisma gerektiriyor.
const FAIL_GUARD_EXEMPT = new Set([
  'logx_ocp_app_discovery.yml', 'logx_ocp_discover_fetch.yml', 'logx_ocp_namespace_discovery.yml',
  'nginx_config_migration.yml',
]);

test('TUZAK 3: toplayici play, hicbir sonuc yoksa isi BASARISIZ yapar', () => {
  // `rescue` eklemek tek basina isi "successful" yapardi — hicbir sey calismadigi
  // halde portal yesil gosterirdi; mevcut durumdan DAHA KOTU olurdu.
  const offenders = [];
  for (const f of FILES) {
    if (FAIL_GUARD_EXEMPT.has(f)) continue;
    const plays = parsePlays(read(f));
    const agg = plays.find((p) => p.isLocal && p.hasSetStats);
    if (!agg) continue;
    const idx = plays.indexOf(agg);
    if (idx < 1) continue;                          // ayri toplayici degil
    // Basarisizlik mekanizmasi `fail` VEYA `assert` olabilir — ikisi de isi kirmizi
    // yapar. ASIL KURAL SIRA: once `set_stats` (artifact yayinlansin), SONRA
    // basarisizlik. Ters sirada olursa is dogru sekilde kirmizi doner ama sonuc
    // sozlesmesi HIC yayinlanmaz ve portal ham log gostermek zorunda kalir —
    // logx_legacy_transfer.yml'de tam olarak bu vardi.
    const ssIdx = agg.text.indexOf('ansible.builtin.set_stats:');
    const failIdx = Math.min(
      ...['ansible.builtin.fail:', 'ansible.builtin.assert:']
        .map((k) => { const i = agg.text.indexOf(k); return i < 0 ? Infinity : i; })
    );
    if (!Number.isFinite(failIdx)) offenders.push(`${f}: basarisizlik mekanizmasi yok`);
    else if (failIdx < ssIdx) offenders.push(`${f}: basarisizlik set_stats'ten ONCE — sonuc yayinlanmaz`);
  }
  assert.deepEqual(offenders, [],
    'toplayici play sonuc yokken `fail` etmiyor — AWX isi yesil gorunur:\n' + offenders.join('\n'));
});

test('TUZAK 3 bekcisi KOR DEGIL: sentetik ihlali yakalar', () => {
  const bad = [
    '- name: "host play"',
    '  hosts: workers',
    '  tasks:',
    '    - name: "x"',
    '      ansible.builtin.debug: { msg: "x" }',
    '',
    '- name: "toplayici"',
    '  hosts: localhost',
    '  tasks:',
    '    - ansible.builtin.set_stats:',
    '        data: { r: 1 }',
  ].join('\n');
  const plays = parsePlays(bad);
  const aggIdx = plays.findIndex((p) => p.isLocal && p.hasSetStats);
  assert.equal(aggIdx, 1, 'toplayici play tespit edilemedi');
  assert.equal(plays[0].hasRescue, false);
  assert.equal(plays[0].hasIgnoreUnreachable, false);
});

// ── TUZAK 4: play `vars:` PLAY'LER ARASINDA TASINMAZ ─────────────────────────
// 2026-08-28'de tam olarak bu yapildi: toplayici play'e eklenen `blocked_targets`
// ifadesi `ns_list`e basvuruyordu — ama `ns_list` bir ONCEKI play'in `vars:`
// blogunda tanimliydi. Sonuc: DUZELTMENIN KENDISI, duzeltmeye calistigi hata
// yolunda "'ns_list' is undefined" ile patlardi. YAML gecerliydi, testler yesildi.
//
// Bir degiskenin sonraki play'de gorunur olmasinin UC mesru yolu var:
//   1. extra_vars / vars_files  → her play'de gorunur (bu bekci gormez, sorun degil)
//   2. `set_fact`               → host fact'i olarak kalici
//   3. `add_host: ... <var>:`   → dinamik envanterdeki host'a host var olarak yazilir
// Bunlarin disinda, onceki play'in `vars:` bloguna basvurmak SESSIZ tanimsizliktir.
//
// ISTISNA — nginx_config_migration.yml: play#5 `source_host`a basvuruyor, deger
// play#1 `vars:`inda. Playbook basligi bunu bir extra_var olarak belgeliyor
// (satir ~40), yani AWX'ten gelirse calisir; gelmezse play#5'te tanimsiz kalir.
// Bu playbook'u PORTAL HIC CALISTIRMIYOR (kod tabaninda tek referans yok) ve bu
// tur duzeltmeler icin dokunulmamasi gereken calisan bir yapisi var — bilincli
// olarak kapsam disi birakildi, kullaniciya ayrica bildirildi.
const CROSS_PLAY_VARS_EXEMPT = new Set(['nginx_config_migration.yml']);

test('TUZAK 4: bir play, onceki play’in `vars:` blogundaki degiskene basvurmuyor', () => {
  const offenders = [];
  for (const f of FILES) {
    if (CROSS_PLAY_VARS_EXEMPT.has(f)) continue;
    const plays = parsePlays(codeOnly(read(f)));
    if (plays.length < 2) continue;

    const definedIn = new Map(); // degisken adi -> ilk tanimlandigi play indeksi
    plays.forEach((play, i) => {
      const text = play.text;
      for (const [name, j] of definedIn) {
        if (j >= i) continue;
        if (!new RegExp(`(?<![\\w.])${name}(?![\\w])`).test(text)) continue;
        // Mesru tasima yollari: set_fact, add_host host var'i, ya da bu play'in kendi vars'i
        const carried = plays.slice(0, i).some((prev) => {
          const t = prev.text;
          return new RegExp(`set_fact:[\\s\\S]*?^\\s+${name}:`, 'm').test(t)
              || new RegExp(`add_host:[\\s\\S]*?^\\s+${name}:`, 'm').test(t);
        });
        if (!carried && !playVarNames(play).includes(name)) {
          offenders.push(`${f} play#${i + 1} → "${name}" (play#${j + 1} vars'inda, tasinmamis)`);
        }
      }
      for (const name of playVarNames(play)) if (!definedIn.has(name)) definedIn.set(name, i);
    });
  }
  assert.deepEqual(offenders, [],
    `play vars'i sonraki play'e TASINMAZ — bu basvurular calisma aninda tanimsiz olur:\n${offenders.join('\n')}`);
});

test('TUZAK 4 bekcisi KOR DEGIL: sentetik ihlali yakalar', () => {
  const bad = [
    '- name: birinci',
    '  hosts: localhost',
    '  vars:',
    '    benim_degiskenim: "abc"',
    '  tasks:',
    '    - name: bir sey',
    '      ansible.builtin.debug: { msg: "{{ benim_degiskenim }}" }',
    '',
    '- name: ikinci',
    '  hosts: localhost',
    '  tasks:',
    '    - name: baska sey',
    '      ansible.builtin.debug: { msg: "{{ benim_degiskenim }}" }',
  ].join('\n');
  const plays = parsePlays(bad);
  assert.equal(plays.length, 2, 'sentetik ornek iki play olarak ayrismali');
  assert.deepEqual(playVarNames(plays[0]), ['benim_degiskenim']);
  assert.ok(/(?<![\w.])benim_degiskenim(?![\w])/.test(plays[1].text),
    'bekcinin arama deseni ikinci play’deki basvuruyu gormeli');
});
