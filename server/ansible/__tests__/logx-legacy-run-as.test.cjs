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
    const ad = (satirlar[0].match(/^- name:\s*"?(.*?)"?\s*$/) || [, satirlar[0]])[1];
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

test('was’in gecici ZIP’i /tmp’de DEGIL, ise ozel dizinde ve her durumda temizlenir', () => {
  // /tmp bu hostlarda dump'lar icin kucuk (opsx_legacy_dump 2026-08-12) ve tahmin edilebilir
  // sabit bir /tmp yolu hem cakisir hem de iptal/hata durumunda arkasinda 0644 log kopyasi
  // birakir. Emsal: opsx_legacy_dump -> /vhosting(8)/dumpdir.
  const t = metin('logx_legacy_transfer.yml');
  const m = t.match(/^ {4}was_tmp_dir: >-\n([\s\S]*?)\n {4}was_tmp_archive:/m);
  assert.ok(m, 'was_tmp_dir tanimi bulunamadi');
  assert.ok(!/\/tmp\b/.test(m[1]), 'was_tmp_dir /tmp altinda');
  assert.match(m[1], /dumpdir/, 'was_tmp_dir log dosya sisteminde (dumpdir) degil');
  assert.match(m[1], /archive_name/, 'was_tmp_dir ise ozel degil (archive_name icermiyor)');
  const always = t.split(/^ {6}always:$/m)[1];
  assert.ok(always, 'arsivleme blogunda always: yok - hata/iptalde gecici ZIP kalir');
  const temiz = always.split(/^- name:/m)[0];
  assert.match(temiz, /path: "\{\{ was_tmp_dir \}\}"/, 'always gecici dizini silmiyor');
  assert.match(temiz, /state: absent/, 'always gecici dizini silmiyor');
  assert.ok(wasIle(temiz), 'gecici dizin was ile silinmiyor (sahibi was)');
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
