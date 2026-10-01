// server/ansible/__tests__/logx-legacy-run-as.test.cjs — LogX Legacy HANGI KULLANICIYLA OKUR?
//
// URETIM OLAYI (2026-10-01): LogX Legacy transferi
//   ESJBOT02:/vhosting8/ESOUTBOUNDWS-T.ear/logs/SystemOut.log
// icin "Arsivlenecek mevcut ve okunabilir bir dosya bulunamadi." dedi. Dosya ORADAYDI.
//
// SEBEP arsivleme play'indeki `become: false` idi: gorevler BAGLANAN kullaniciyla (uxmid)
// kostu. JBoss loglari `was` kullanicisinin ve 640; dizin listelenebildigi icin KESIF
// dosyayi buluyor, transferin `stat`'i ise `readable: false` donuyor. Satir elenince ortaya
// cikan belirti "dosya yok" — yani YANILTICI. Dogrusu "BIZ OKUYAMADIK".
//
// KULLANICI KURALI (dogrudan talimat): "JBoss komutlarinin tamami WAS user ile calismali.
// HTTP serverlar, Red Hat Apache, IBM Apache, Nginx bunlarin tamami da www user ile."
// Legacy akisi YALNIZCA /vhosting ve /vhosting8 altini tarar; ikisi de JBoss -> `was`.
//
// BU BEKCININ OLCUTU: kaynak sunucuda kosan her play yetki yukseltir ve `was` varsayilanini
// kullanir; localhost play'leri yukseltmez (AWX execution node'unda `was` yok, orada
// dzdo denemek isi bosa dusurur). Ayrica taranan kokler JBoss'ta KALIR - oraya bir HTTP
// sunucusu yolu (nginx/apache) eklenirse `was` varsayimi sessizce yanlis olur.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'bmw_portal', 'logx', 'legacy');
const DOSYALAR = ['logx_legacy_transfer.yml', 'logx_legacy_discovery.yml'];
const metin = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n');

/**
 * Playbook metnini play'lere boler.
 *
 * YAML ayristiricisi YOK (depoda bagimlilik olarak bulunmuyor, obur Ansible bekcileri de
 * metin uzerinden calisir). Play basi = satir basindaki `- name:`; play basligi = o play'in
 * ILK gorevine kadar olan kisim, yani iki bosluk girintili anahtarlar. Gorev listesi
 * (`  tasks:`) baslayinca basliktan cikilir; boylece gorev icindeki `become:` satirlari
 * play basligi sanilmaz.
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
      const m = bas.match(new RegExp(`^ {2}${k}:\s*(.*)$`, 'm'));
      return m ? m[1].trim() : null;
    };
    out.push({
      ad,
      hosts: al('hosts'),
      connection: al('connection'),
      become: al('become'),
      becomeUser: al('become_user'),
      becomeMethod: al('become_method'),
    });
  }
  return out;
}

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
      `${f}: kaynak sunucuda kosan play bulunamadi - ayristirici bozuk olabilir`,
    );
    assert.ok(ps.some(yerel), `${f}: localhost play'i bulunamadi`);
  }
});

test('kaynak sunucuda kosan play\u2019ler dzdo ile was kullanicisina gecer', () => {
  for (const f of DOSYALAR) {
    for (const p of playler(metin(f))) {
      if (yerel(p)) continue;
      assert.equal(
        p.become,
        'true',
        `${f}: "${p.ad}" become:${p.become} - JBoss loglari baglanan kullaniciyla OKUNAMAZ, ` +
          'belirti de "dosya yok" diye gorunur (2026-10-01 ESJBOT02 olayi)',
      );
      assert.ok(
        /was/.test(String(p.becomeUser || '')),
        `${f}: "${p.ad}" become_user='${p.becomeUser}' - kullanici kurali: JBoss -> was`,
      );
      assert.equal(
        p.becomeMethod,
        'dzdo',
        `${f}: "${p.ad}" become_method='${p.becomeMethod}' - sudo degil, dzdo`,
      );
    }
  }
});

test('yerel play\u2019ler yetki yukseltmez', () => {
  // Dogrulama/birlestirme play'leri AWX execution node'unda kosar; orada `was` yok.
  // Oraya become vermek isi, hicbir log dosyasina dokunmadan yetki hatasina dusurur.
  for (const f of DOSYALAR) {
    for (const p of playler(metin(f))) {
      if (!yerel(p)) continue;
      assert.notEqual(
        p.become,
        'true',
        `${f}: "${p.ad}" yerel play ama become:true - AWX node'unda was kullanicisi yok`,
      );
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

test('taranan kokler JBoss\u2019ta kalir (was varsayimini kiran yol eklenmemis)', () => {
  // `was` varsayimi legacy akisinin YALNIZCA JBoss altini taramasina dayanir. Buraya bir
  // HTTP sunucusu yolu eklenirse (nginx/apache -> www) ayni dosya yine okunamaz, belirti
  // yine "dosya yok" olur. O yuzden kok listesi KAPIDAN gecer.
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
  // Olayin ikinci yarisi mesajin kendisiydi: dosya oradayken "bulunamadi" yaziyordu ve
  // kullaniciya nereye bakacagini soylemiyordu. Artik dosya basina sebep, denenen yollar
  // ve hangi kullaniciyla denendigi mesajda.
  const t = metin('logx_legacy_transfer.yml');
  const i = t.indexOf('Arsivlenecek mevcut ve okunabilir');
  assert.ok(i > 0, 'hata mesaji bulunamadi');
  const blok = t.slice(i, i + 600);
  assert.match(blok, /per_file_status/, 'dosya basina sebep mesaja girmiyor');
  assert.match(blok, /host_selected_files/, 'denenen yollar mesaja girmiyor');
  assert.match(blok, /kullanicisiyla denendi/, 'hangi kullaniciyla denendigi yazmiyor');
});
