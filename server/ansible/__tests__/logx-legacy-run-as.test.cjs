// server/ansible/__tests__/logx-legacy-run-as.test.cjs — LogX Legacy HANGI KULLANICIYLA OKUR, HANGISIYLE YAZAR?
//
// URETIM OLAYI 1 (2026-10-01): LogX Legacy transferi
//   ESJBOT02:/vhosting8/ESOUTBOUNDWS-T.ear/logs/SystemOut.log
// icin "Arsivlenecek mevcut ve okunabilir bir dosya bulunamadi." dedi. Dosya ORADAYDI.
// Arsivleme baglanan kullaniciyla (uxmid) kosuyordu; JBoss loglari `was`in ve 640. Kesif
// dosyayi listeliyor, transferin `stat`'i `readable: false` donuyor -> belirti "dosya yok".
//
// ILK DUZELTME (play'in TAMAMI was) YANLISTI: yazma da `was`a gecti. Staging
// (/sw/BMW_PORTAL/logs/legacy) ve fallback (/tmp/logx-v2-fallback) dizinleri baglanan
// kullanicinin; `was` oraya yazamayabilir, Portal'in fetch-back'i ise `was`in 0750 dizinini
// okuyamaz. DOGRUSU YETKI BOLMEK: loglari OKUMA `was` ile (stat + gecici ZIP), staging/
// fallback'e YAZMA eskisi gibi baglanan kullaniciyla (copy remote_src).
//
// URETIM OLAYI 2 (job 3368084): mesaj olmayan bir alani (`reason`) okuyordu; Ansible
// argumanlari once render ettigi icin gorev her kosuda dustu.
//
// GIZLI HATA: gorevler `failed_when: false` ile kayit ediliyordu ama karar `sonuc.failed`a
// bakiyordu. Ansible `failed_when: false` iken `failed` alanini HER ZAMAN false yazar:
// staging yazimi dusse bile fallback HIC devreye girmezdi. `.failed`i okunan gorev
// `ignore_errors: true` kullanir (alan korunur).
//
// KULLANICI KURALI (dogrudan talimat): "JBoss komutlarinin tamami WAS user ile calismali.
// HTTP serverlar, Red Hat Apache, IBM Apache, Nginx bunlarin tamami da www user ile."
// Legacy akisi YALNIZCA /vhosting ve /vhosting8 altini tarar; ikisi de JBoss -> `was`.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'bmw_portal', 'logx', 'legacy');
const DOSYALAR = ['logx_legacy_transfer.yml', 'logx_legacy_discovery.yml'];
const metin = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
const WAS = /^\s+become_user: "\{\{ logx_legacy_user \| default\('was'\) \}\}"$/m;

/**
 * Playbook metnini play'lere boler.
 *
 * YAML ayristiricisi YOK (depoda bagimlilik olarak bulunmuyor, obur Ansible bekcileri de
 * metin uzerinden calisir). Play basi = satir basindaki `- name:`; play basligi = o play'in
 * ILK gorevine kadar olan kisim, yani iki bosluk girintili anahtarlar.
 */
function playler(src) {
  const out = [];
  const parcalar = src.split(/^(?=- name:)/m).slice(1);
  for (const p of parcalar) {
    const satirlar = p.split('\n');
    const ad = (satirlar[0].match(/^- name:\s*"?(.*?)"?\s*$/) || [null, satirlar[0]])[1];
    const basSatirlari = [];
    for (const s of satirlar.slice(1)) {
      if (/^- /.test(s)) break;
      if (/^ {2}(tasks|pre_tasks|roles|handlers|post_tasks):/.test(s)) break;
      if (/^ {2}\S/.test(s)) basSatirlari.push(s);
    }
    const bas = basSatirlari.join('\n');
    const al = (k) => {
      const m = bas.match(new RegExp('^ {2}' + k + ':\\s*(.*)$', 'm'));
      return m ? m[1].trim() : null;
    };
    out.push({
      ad,
      metin: p,
      hosts: al('hosts'),
      connection: al('connection'),
      become: al('become'),
      becomeUser: al('become_user'),
      becomeMethod: al('become_method'),
    });
  }
  return out;
}

/** Bir play'in gorevleri: her `- name:` satiri (girintili) yeni bir gorev baslatir. */
const gorevler = (playMetni) =>
  playMetni
    .split('\n')
    .slice(1)
    .join('\n')
    .split(/^(?=\s+- name:)/m)
    .filter((g) => /^\s+- name:/.test(g));

const wasIle = (g) =>
  /^\s+become: true$/m.test(g) && WAS.test(g) && /^\s+become_method: dzdo$/m.test(g);
const yukseltir = (g) => /^\s+become: true$/m.test(g);

/** Yerel (AWX execution node) play mi? */
const yerel = (p) => p.connection === 'local' || /localhost/.test(String(p.hosts || ''));

test('bekci bulmaca: her playbookta en az bir kaynak ve bir yerel play goruluyor', () => {
  // Ayristirici sessizce bosa duserse (ornegin bicim degisirse) obur testler de bos
  // kumede gezinip YESIL kalirdi. Once ayristiricinin kendisi olculur.
  for (const f of DOSYALAR) {
    const ps = playler(metin(f));
    assert.ok(ps.length >= 2, `${f}: play ayristirilamadi (${ps.length})`);
    assert.ok(
      ps.some((p) => !yerel(p)),
      `${f}: kaynak sunucuda kosan play bulunamadi`,
    );
    assert.ok(ps.some(yerel), `${f}: localhost play'i bulunamadi`);
  }
});

test('kesif: kaynak sunucuda kosan play dzdo ile was kullanicisina gecer', () => {
  // Kesif yalniz OKUR (find/stat); yazdigi bir sey yok. Play duzeyinde was dogrudur.
  for (const p of playler(metin('logx_legacy_discovery.yml'))) {
    if (yerel(p)) continue;
    assert.equal(
      p.become,
      'true',
      `"${p.ad}" become:${p.become} - JBoss dizinleri uxmid ile okunamaz`,
    );
    assert.ok(/was/.test(String(p.becomeUser || '')), `"${p.ad}" become_user='${p.becomeUser}'`);
    assert.equal(p.becomeMethod, 'dzdo', `"${p.ad}" become_method='${p.becomeMethod}'`);
  }
});

test('transfer: loglari OKUYAN gorevler was ile, YAZAN gorevler baglanan kullaniciyla', () => {
  const ps = playler(metin('logx_legacy_transfer.yml')).filter((p) => !yerel(p));
  assert.ok(ps.length >= 2, 'transfer kaynak play’leri bulunamadi');
  const tum = [];
  for (const p of ps) {
    // PLAY DUZEYINDE yukseltme YOK: yukseltilmis bir play'de staging/fallback yazimi da
    // was'a gecer (ilk duzeltmenin hatasi).
    assert.notEqual(
      p.become,
      'true',
      `"${p.ad}" play duzeyinde become:true - yazma da was'a gecer`,
    );
    tum.push(...gorevler(p.metin));
  }
  const okuyanlar = tum.filter(
    (g) =>
      (/ansible\.builtin\.stat:/.test(g) && /path: "\{\{ item\.path \}\}"/.test(g)) ||
      (/community\.general\.archive:/.test(g) && /path: "\{\{ valid_source_paths \}\}"/.test(g)),
  );
  assert.ok(okuyanlar.length >= 2, `kaynak logu okuyan gorev bulunamadi (${okuyanlar.length})`);
  for (const g of okuyanlar)
    assert.ok(wasIle(g), `log okuyan gorev was ile kosmuyor: ${g.trim().split('\n')[0]}`);

  const YAZMA = [
    'dest: "{{ staging_archive_path }}"',
    'dest: "{{ fallback_archive_path }}"',
    'dest: "{{ host_part_path }}"',
    'path: "{{ fallback_dir }}"',
    'path: "{{ parts_dir }}"',
  ];
  for (const hedef of YAZMA) {
    const yazanlar = tum.filter((g) => g.includes(hedef));
    assert.ok(yazanlar.length > 0, `yazma gorevi bulunamadi: ${hedef}`);
    for (const g of yazanlar)
      assert.ok(
        !yukseltir(g),
        `staging/fallback'e yazan gorev was'a geciyor (${hedef}): ${g.trim().split('\n')[0]}`,
      );
  }
});

test('karari .failed alanina bakan gorev failed_when: false KULLANMAZ', () => {
  // Ansible `failed_when: false` iken kayittaki `failed`i HER ZAMAN false yazar; karar ona
  // bakiyorsa hata yolu (fallback) asla devreye girmez.
  for (const f of DOSYALAR) {
    const t = metin(f);
    for (const p of playler(t))
      for (const g of gorevler(p.metin)) {
        const r = g.match(/^\s+register: (\w+)$/m);
        if (!r || !/^\s+failed_when: false$/m.test(g)) continue;
        assert.ok(
          !new RegExp('\\b' + r[1] + '\\.failed\\b').test(t),
          `${f}: '${r[1]}' failed_when:false ile kaydediliyor ama ${r[1]}.failed okunuyor - ` +
            'hata yolu asla calismaz (ignore_errors: true kullan)',
        );
      }
  }
});

test('was’a gecen gorevi olan her kaynak play pipelining kullanir', () => {
  // Ayricaliksiz -> ayricaliksiz (uxmid -> was) gecisinde pipelining kapaliyken Ansible modul
  // gecici dosyasinin iznini setfacl/chown/chmod +a ile acmaya calisir; hicbiri tutmazsa
  // "Failed to set permissions on the temporary files" ile DUSER ve failed_when bunu yutmaz.
  // Ayni hata job 3339002'de 130 sunucuda yasandi; server_hub/crypto_hub emsali pipelining.
  for (const f of DOSYALAR)
    for (const p of playler(metin(f))) {
      if (yerel(p)) continue;
      const wasVar = p.become === 'true' || gorevler(p.metin).some(wasIle);
      if (!wasVar) continue;
      assert.match(
        p.metin,
        /^ {4}ansible_pipelining: true$/m,
        `${f}: "${p.ad}" was'a geciyor ama pipelining kapali`,
      );
    }
});

// ── GECICI ALAN (2026-10-13) ───────────────────────────────────────────────────────────────
//
// Okuma kullanicisinin ZIP'i yazdigi ara dizin eskiden TEK ve sabitti: /vhosting(8)/dumpdir.
// Sahada bir sunucuda o dizin DOSYAYA donustu; log alinamadi ve sebep ekrana cikmadi.
// Artik sirali bir aday listesi var (`logx_legacy_tmp_bases`); karar mantigi
// logx-legacy-olculemedi X11'de render edilerek, gercek davranis logx-legacy-gercek-kosum
// LG6-LG12'de sinanir. Buradakiler YAPI kurallari: kim acar, hangi kiple, kim siler.

/** Kaynak sunucuda kosan play'lerin butun gorevleri. */
const kaynakGorevleri = () =>
  playler(metin('logx_legacy_transfer.yml'))
    .filter((p) => !yerel(p))
    .flatMap((p) => gorevler(p.metin));

test('gecici alan: ise ozel dizin SECILEN adaydan turer; sabit dizinler yalniz aday listesinde', () => {
  const t = metin('logx_legacy_transfer.yml');
  const m = t.match(/^ {4}was_tmp_dir: (.*)$/m);
  assert.ok(m, 'was_tmp_dir tanimi bulunamadi');
  assert.match(m[1], /was_tmp_aday/, 'was_tmp_dir secilen adaydan turemiyor');
  assert.match(m[1], /archive_name/, 'was_tmp_dir ise ozel degil (archive_name icermiyor)');
  // Teslim dizini paylasimli: ayni iste iki sunucu ayni dizini kullanirsa birinin temizligi
  // otekinin ZIP'ini siler.
  assert.match(m[1], /inventory_hostname/, 'was_tmp_dir sunucuya ozel degil');
  const liste = t.match(/^ {4}logx_legacy_tmp_bases:\n((?: {6,}\S.*\n)+)/m);
  assert.ok(liste, 'logx_legacy_tmp_bases listesi bulunamadi');
  assert.ok(liste[1].split('\n').filter((l) => /^\s+- dir:/.test(l)).length >= 2, 'tek aday var');
  // Listenin DISINDA sabit bir gecici dizin gecmez: eski bagimlilik baska bir gorevde geri gelmesin.
  const disinda = t.replace(liste[0], '');
  for (const sabit of [/dumpdir/, /logx-tmp/, /\/tmp\b/, /\/vhosting/])
    assert.ok(!sabit.test(disinda), `aday listesi disinda sabit dizin: ${sabit}`);
  // /tmp kucuktur: YALNIZ bos alan butcesiyle aday olabilir.
  assert.match(liste[1], /- dir: \/tmp\n {8}yuzde: \d+\n/, '/tmp butcesiz aday');
});

test('gecici dizin: okuma kullanicisi 0711, baglanan kullanici 0733; baska kip ve baska acan yok', () => {
  const t = metin('logx_legacy_transfer.yml');
  const acan = kaynakGorevleri().filter(
    (g) => /path: "\{\{ was_tmp_dir \}\}"/.test(g) && /state: directory/.test(g),
  );
  // Iki deneme x iki olasi sahip.
  assert.equal(acan.length, 4, `gecici dizin acan gorev sayisi ${acan.length}`);
  for (const g of acan) {
    const ad = g.trim().split('\n')[0];
    const kip = (g.match(/^\s+mode: "(\d+)"$/m) || [])[1];
    if (yukseltir(g)) {
      assert.ok(wasIle(g), `${ad}: yukseltiyor ama okuma kullanicisina degil`);
      // 0711: baglanan kullanici icinden gecip ZIP'i kopyalar, kimse listeleyemez.
      assert.equal(kip, '0711', ad);
      assert.match(
        g,
        /olusturan \| default\(''\)\) == 'was'/,
        `${ad}: kosulu sahibine bagli degil`,
      );
    } else {
      // 0733: okuma kullanicisi icine yazar ama listeleyemez. YALNIZ okuma kullanicisinin
      // teslim dizinine yazamadigi durumda acilir.
      assert.equal(kip, '0733', ad);
      assert.match(g, /olusturan \| default\(''\)\) == 'baglanan'/, `${ad}: 0733 kosulsuz`);
    }
    // Karar `.failed` alanina bakar: failed_when: false onu HEP false yazardi.
    assert.match(g, /^\s+ignore_errors: true$/m, `${ad}: hata yolu kapali`);
  }
  assert.equal((t.match(/0733/g) || []).length, 2, '0733 beklenmeyen bir yerde');
});

test('gecici dizin HER durumda SAHIBIYLE temizlenir (always: iki gorev)', () => {
  const t = metin('logx_legacy_transfer.yml');
  const always = t.split(/^ {6}always:$/m)[1];
  assert.ok(always, 'arsivleme blogunda always: yok - hata/iptalde gecici ZIP kalir');
  const temizlik = always
    .split(/^- name:/m)[0]
    .split(/^(?=\s+- name:)/m)
    .filter((g) => /path: "\{\{ was_tmp_dir \}\}"/.test(g));
  assert.equal(temizlik.length, 2, `always temizlik gorevi ${temizlik.length}`);
  for (const g of temizlik) {
    assert.match(g, /state: absent/, 'always gecici dizini silmiyor');
    assert.match(g, /^\s+failed_when: false$/m, 'temizlik hatasi isi dusurur');
  }
  const [was, baglanan] = [temizlik.find(wasIle), temizlik.find((g) => !yukseltir(g))];
  assert.ok(was, 'okuma kullanicisinin actigi dizin onunla silinmiyor (sahibi o)');
  assert.match(was, /olusturan \| default\(''\)\) == 'was'/);
  assert.ok(baglanan, 'baglanan kullanicinin actigi dizin icin temizlik yok');
  assert.match(baglanan, /olusturan \| default\(''\)\) == 'baglanan'/);
});

// ── YORUMLAYICI YOKLAMASI: TEK `raw` ISTISNASI (2026-10-22) ─────────────────────────────────────────
// Hakan Isci, e3faefa / 895aa4f (2026-10-21; README "Legacy Python interpreter uyumlulugu"): bazi
// legacy JBoss sunucularinda Ansible platform-python 3.6'yi seciyor ve Python isteyen moduller (find,
// stat, archive) MODULE FAILURE veriyor; ayni sunucuda python3.11 var. Uygun yorumlayiciyi bulan gorev
// Python ISTEMEMELI - yani `raw` burada ZORUNLU (command / stat de Python ister). Bu bekci eskiden her
// `raw`u yasakliyordu ve uretimdeki bu duzeltmeyle kirmiziya dondu.
// Yasagin NIYETI korunur: kabuga dis girdi YERLESMEZ ve yan etki YOK. Tek istisna:
//   - yalniz kaynak play'in pre_tasks'inda, TEK `raw` gorevi (baska yerde raw / shell / script yok);
//   - metni SABIT: Jinja ({{ }} / {% %}) yok - envanter / dosya adi kabuga giremez;
//   - salt okur: yonlendirme yalniz 2>/dev/null; yazan / yetki yukselten komut yok;
//   - changed_when false, failed_when false (yoklama dusse de normal yorumlayici kesfi surer), kendi
//     become'u yok; ardindaki set_fact YALNIZ ansible_python_interpreter'i, cikti varsa, yoklamadan kurar.
const YAZAN_KOMUT = /(^|[\s;|&(`$])(rm|mv|cp|tee|chmod|chown|chgrp|mkdir|rmdir|touch|ln|dd|truncate|install|dzdo|sudo|su|kill|pkill|curl|wget|scp|rsync|crontab|systemctl|yum|dnf|rpm|pip3?|sh|bash|ksh|zsh|eval|exec|source)(\s|$)|sed\s+-i/;
// Python -c metninde yazan / calistiran / ice aktaran her sey yasak (surum olcumu yalniz sys ister).
const PY_YAZAN = /\b(open|exec|eval|compile|__import__|importlib|subprocess|shutil|socket|pathlib|write\w*|unlink|remove|rename|replace|mkdir|makedirs|chmod|chown|system|popen|spawn\w*|fork)\b|\bos\b/;
// Modul ANAHTARI olarak (kisa ad ve ansible.legacy dahil): metin aramasi "- raw:" / "shell:" kisa adlarini kacirirdi.
const modulAnahtari = (ad) => new RegExp('^( +)(?:- +)?(?:ansible\\.(?:builtin|legacy)\\.)?' + ad + ':(.*)$', 'gm');
function yorumlayiciYoklamasi(f) {
  const t = metin(f);
  for (const yasak of ['shell', 'script'])
    assert.equal([...t.matchAll(modulAnahtari(yasak))].length, 0, f + ': ' + yasak + ' modulu');
  const rawAnahtar = [...t.matchAll(modulAnahtari('raw'))];
  assert.equal(rawAnahtar.length, 1, f + ': raw gorevi ' + rawAnahtar.length + ' (yalniz yorumlayici yoklamasi olabilir)');
  const kaynak = playler(t).filter((p) => [...p.metin.matchAll(modulAnahtari('raw'))].length > 0);
  assert.equal(kaynak.length, 1, f + ': raw tasiyan play ' + kaynak.length);
  assert.ok(!yerel(kaynak[0]), f + ': yoklama yerel play' + "'de - kaynak sunucunun yorumlayicisini olcmez");
  const pre = (kaynak[0].metin.match(/^ {2}pre_tasks:\n([\s\S]*?)^ {2}tasks:$/m) || [])[1];
  assert.ok(pre, f + ': raw pre_tasks disinda');
  const g = gorevler('-\n' + pre);
  const rawlar = g.filter((x) => [...x.matchAll(modulAnahtari('raw'))].length > 0);
  assert.equal(rawlar.length, 1, f + ": pre_tasks'ta raw gorevi " + rawlar.length);
  const raw = rawlar[0];
  // GOVDE GIRINTIYLE okunur: blok skalerin icine yazilmis girintili bir "register:" satiri govdeyi
  // erken bitirip ardindaki satirlari denetimden kaciramaz (bagimsiz inceleme 2026-10-22).
  const satirlar = raw.split('\n');
  const mi = satirlar.findIndex((l) => /^( +)(?:ansible\.(?:builtin|legacy)\.)?raw:/.test(l));
  const mm = satirlar[mi].match(/^( +)(?:ansible\.(?:builtin|legacy)\.)?raw:\s*(.*)$/);
  assert.match(mm[2], /^\|[-+]?\s*$/, f + ': raw metni blok skaler (| ya da |-) degil - beklenen bicim "ansible.builtin.raw: |"; katlanmis (>) skaler kabuk satirlarini birlestirir');
  const ind = mm[1].length;
  const govdeSatir = [];
  for (const l of satirlar.slice(mi + 1)) {
    if (l.trim() !== '' && l.length - l.trimStart().length <= ind) break;
    govdeSatir.push(l);
  }
  const govde = govdeSatir.join('\n');
  assert.ok(/python/.test(govde), f + ': raw govdesi okunamadi (beklenen: "ansible.builtin.raw: |" blok skaleri)');
  assert.ok(!/\{\{|\{%|\{#/.test(govde), f + ': raw metnine Jinja yerlesiyor - dis girdi kabuga girer');
  // Python -c metni ayri denetlenir (orada > / >= karsilastirmadir); kabuk kopyasindan cikarilir.
  const pyDeseni = /("\$py"|\$py|python[0-9.]*)\s+-c\s+'([^']*)'/g;
  for (const m of govde.matchAll(pyDeseni))
    assert.ok(!PY_YAZAN.test(m[2]), f + ': yoklamanin Python metni yazan / calistiran kod iceriyor: ' + (m[2].match(PY_YAZAN) || [''])[0]);
  const kabuk = govde.replace(pyDeseni, '$1 -c ' + "''");
  const yonlendirmesiz = kabuk.replace(/[0-9]?>\s*\/dev\/null(?![\w./-])/g, '').replace(/[0-9]?>&[0-9]-?/g, '');
  assert.ok(!/>/.test(yonlendirmesiz), f + ': raw icinde dosyaya yonlendirme var (yalniz >/dev/null ve 2>&1 bicimleri serbest)');
  assert.ok(!YAZAN_KOMUT.test(kabuk), f + ': raw icinde yazan / yetki yukselten / ic kabuk acan komut: ' + (kabuk.match(YAZAN_KOMUT) || [''])[0].trim());
  assert.ok(!/\bfind\b[^\n]*\s-(delete|exec|execdir|ok|okdir|fprint\w*|fls)\b/.test(kabuk), f + ': raw icindeki find yazan / calistiran eylem kullaniyor');
  const anahtar = (k) => new RegExp('^ {' + ind + '}' + k + ':\\s*(.*)$', 'm');
  assert.equal((raw.match(anahtar('register')) || [])[1], 'logx_python_probe', f + ': yoklama kaydi');
  assert.equal((raw.match(anahtar('changed_when')) || [])[1], 'false', f + ': yoklama degisiklik raporluyor');
  assert.equal((raw.match(anahtar('failed_when')) || [])[1], 'false', f + ': yoklama dusunce is duser');
  assert.ok(!new RegExp('^ {' + ind + '}become(_user|_method)?:', 'm').test(raw), f + ": yoklamanin kendi become'u var");
  const sf = g.filter((x) => /ansible\.builtin\.set_fact:/.test(x));
  assert.equal(sf.length, 1, f + ': pre_tasks set_fact sayisi ' + sf.length);
  assert.match(sf[0], /set_fact:\n\s+ansible_python_interpreter: "\{\{ logx_python_probe\.stdout_lines /, f + ': set_fact yalniz yorumlayiciyi yoklamadan kurmuyor');
  const sfGirinti = (sf[0].match(/^( +)ansible\.builtin\.set_fact:$/m) || ['', ''])[1].length + 2;
  const sfAnahtar = [...sf[0].matchAll(new RegExp('^ {' + sfGirinti + '}([A-Za-z_]+):', 'gm'))].map((m) => m[1]);
  assert.deepEqual(sfAnahtar, ['ansible_python_interpreter'], f + ': set_fact yorumlayici disinda degisken kuruyor (' + sfAnahtar + ')');
  assert.match(sf[0], /^\s+when: \(logx_python_probe\.stdout_lines \| default\(\[\]\) \| length\) > 0$/m, f + ': yoklama bos donunce de yorumlayici degisiyor');
  assert.equal(g.length, 2, f + ": pre_tasks'ta yoklama disinda gorev (" + g.length + ')');
}

test('yorumlayici yoklamasi: tek, sabit metinli, salt okur `raw` (kesif ve transfer)', () => {
  for (const f of DOSYALAR) yorumlayiciYoklamasi(f);
});

test('gecici alan on kontrolu YAN ETKISIZ: yalniz stat ve argv`li df; kabuk yok', () => {
  const t = metin('logx_legacy_transfer.yml');
  // `raw` yalniz pre_tasks'taki yorumlayici yoklamasinda (yukaridaki bekci); gecici alan olcumu kabuksuz.
  for (const yasak of ['shell', 'script'])
    assert.equal([...t.matchAll(modulAnahtari(yasak))].length, 0, `transfer playbook'unda ${yasak} modulu`);
  assert.equal([...t.replace(/^ {2}pre_tasks:\n[\s\S]*?(?=^ {2}tasks:$)/gm, '').matchAll(modulAnahtari('raw'))].length, 0, 'transfer gorevlerinde (pre_tasks disi) raw');
  const tum = kaynakGorevleri();
  const komut = tum.filter((g) => /ansible\.builtin\.command:/.test(g));
  assert.equal(komut.length, 1, 'tek komut gorevi beklenir (bos alan olcumu)');
  // argv: aday yolu bir kabuk dizesine YERLESMEZ.
  assert.match(
    komut[0],
    /argv:\n\s+- df\n\s+- "-Pk"\n\s+- "\{\{ logx_legacy_tmp_bases\[item\]\.dir \}\}"\n/,
  );
  assert.ok(!yukseltir(komut[0]), 'df icin kullanici gecisi gereksiz');
  const olcen = tum.filter((g) => /register: tmp_aday_\w+$/m.test(g));
  assert.equal(olcen.length, 4, `olcum gorevi ${olcen.length}`);
  for (const g of olcen) {
    const ad = g.trim().split('\n')[0];
    assert.match(g, /ansible\.builtin\.(stat|command):/, `${ad}: olcum stat/df degil`);
    assert.match(g, /^\s+changed_when: false$/m, ad);
    // Olculemeyen aday isi DUSURMEZ; "uygun degil" diye degerlendirilir.
    assert.match(g, /^\s+failed_when: false$/m, ad);
  }
});

test('gecici ZIP`i okuyan kopyalar arsiv HAZIR degilken kosmaz', () => {
  // Eskiden kosul `was_archive_result`e bakiyordu; dizin acilamayinca arsiv gorevi ATLANIYOR,
  // "atlandi" ile "dustu" ayni yere dusup sebep kayboluyordu. Tek olgu: was_arsiv_hazir.
  const kopyalar = kaynakGorevleri().filter((g) => /src: "\{\{ was_tmp_archive \}\}"/.test(g));
  assert.equal(kopyalar.length, 3, `gecici ZIP'i kopyalayan gorev sayisi ${kopyalar.length}`);
  for (const g of kopyalar)
    assert.match(
      g,
      /^\s+- was_arsiv_hazir \| bool$/m,
      `${g.trim().split('\n')[0]}: arsiv yokken kopyalamaya calisir`,
    );
});

test('was’a gecis/modul hatasi "Dosya bulunamadi" diye GORUNMEZ', () => {
  // stat sonucunda `stat` hic yoksa (dzdo reddi, modul hatasi) eskiden
  // `item.stat.exists | default(false)` false donup "Dosya bulunamadi" yaziyordu: duzeltilen
  // yaniltici belirtinin ta kendisi. Sebep (msg/module_stderr) mesaja tasinir.
  const t = metin('logx_legacy_transfer.yml');
  const i = t.indexOf("'error': (");
  assert.ok(i > 0, 'per_file_status hata ifadesi bulunamadi');
  const blok = t.slice(i, t.indexOf("'Dosya bulunamadi'", i));
  assert.match(blok, /item\.stat is not defined/, 'stat sonucu yokken ayri sebep uretilmiyor');
  assert.match(blok, /module_stderr/, 'gecis hatasinin sebebi (module_stderr) mesaja girmiyor');
});

test('yerel play’ler yetki yukseltmez', () => {
  // Dogrulama/birlestirme play'leri AWX execution node'unda kosar; orada `was` yok.
  for (const f of DOSYALAR) {
    for (const p of playler(metin(f))) {
      if (!yerel(p)) continue;
      assert.notEqual(p.become, 'true', `${f}: "${p.ad}" yerel play ama become:true`);
    }
  }
});

test('kullanici degisken, ama VARSAYILAN was', () => {
  // Sabit kodlanirsa ileride bir sunucuda baska bir hesap gerektiginde playbook kopyalanir;
  // varsayilan `was` olmazsa da uretim olayi geri gelir.
  const t = metin('logx_legacy_transfer.yml');
  const n = (t.match(/logx_legacy_user \| default\('was'\)/g) || []).length;
  assert.ok(n >= 2, `transfer playbookunda was varsayilani ${n} yerde - en az 2 bekleniyor`);
});

test('taranan kokler JBoss’ta kalir (was varsayimini kiran yol eklenmemis)', () => {
  // `was` varsayimi legacy akisinin YALNIZCA JBoss altini taramasina dayanir. Buraya bir
  // HTTP sunucusu yolu eklenirse (nginx/apache -> www) ayni dosya yine okunamaz.
  const t = metin('logx_legacy_discovery.yml');
  const m = t.match(/^ {4}legacy_log_roots:\n((?: {6}- \S+\n)+)/m);
  assert.ok(m, 'legacy_log_roots listesi bulunamadi');
  const kokler = m[1]
    .trim()
    .split('\n')
    .map((s) => s.replace(/^\s*-\s*/, '').trim());
  assert.deepEqual(
    kokler,
    ['/vhosting', '/vhosting8'],
    `kok listesi degismis (${kokler.join(', ')}) - JBoss disi bir yol eklendiyse o yol ` +
      'www kullanicisini gerektirir; become_user secimi yola gore ayrilmali',
  );
});

test('"dosya bulunamadi" hatasi SEBEBI tasir', () => {
  const t = metin('logx_legacy_transfer.yml');
  const i = t.indexOf('Arsivlenecek mevcut ve okunabilir');
  assert.ok(i > 0, 'hata mesaji bulunamadi');
  const blok = t.slice(i, i + 600);
  assert.match(blok, /per_file_status/, 'dosya basina sebep mesaja girmiyor');
  assert.match(blok, /host_selected_files/, 'denenen yollar mesaja girmiyor');
  assert.match(blok, /kullanicisiyla denendi/, 'hangi kullaniciyla denendigi yazmiyor');
});

test('mesajin okudugu alanlar per_file_status kaydinda GERCEKTEN var', () => {
  // URETIM (job 3368084): mesaj `map(attribute='reason')` okuyordu, kayitta alan `error`.
  // Yalniz adin VARLIGINA bakan test bunu goremedi; okunan her alan, set_fact'in kurdugu
  // sozluk anahtarlariyla karsilastirilir.
  const t = metin('logx_legacy_transfer.yml');
  const kur = t.indexOf('per_file_status: >-');
  assert.ok(kur > 0, 'per_file_status set_fact bulunamadi');
  const sozluk = t.slice(kur, t.indexOf('loop:', kur));
  const anahtarlar = new Set([...sozluk.matchAll(/'(\w+)':/g)].map((m) => m[1]));
  assert.ok(anahtarlar.has('path'), `anahtarlar ayristirilamadi: ${[...anahtarlar]}`);
  const okunan = [...t.matchAll(/per_file_status[^}\n]*?map\(attribute='(\w+)'\)/g)].map(
    (m) => m[1],
  );
  assert.ok(okunan.length > 0, 'per_file_status uzerinde alan okuyan ifade bulunamadi');
  for (const a of okunan)
    assert.ok(
      anahtarlar.has(a),
      `per_file_status kaydinda '${a}' alani yok (var olanlar: ${[...anahtarlar]})`,
    );
});
