// server/scalex/__tests__/caps-refresh.test.cjs
//
// YETENEK ONBELLEGI ARKA PLANDA TAZELENIR — kesif onu BEKLEMEZ.
//
// Kesif (paket v21) ekstra CRD'leri artik enumere etmiyor; onbellegi dolduran
// tek yol bu modul ve Admin > Tara. Burada korunan uc sey:
//   1. dogru cluster'lar tazelenir (eksik/bayat evet, taze hayir),
//   2. tetik TEKILDIR ve SOGUR — kirik bir cluster her kesifte yeni AWX isi acmaz,
//   3. sonuc KIMSE yoklamasa da yazilir (Admin > Tara'nin yillardir kayip sonucu).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const cr = require('../caps-refresh.cjs');

const GUN = 24 * 60 * 60 * 1000;
const SIMDI = Date.parse('2026-09-30T12:00:00Z');

function sahteDeps({ kayitlar = [], statusler = null, launchHata = null } = {}) {
  const kayit = { launch: [], save: [], getStatus: 0 };
  const sirali = statusler || [{ finished: true, artifacts: {} }];
  let t = SIMDI;
  const deps = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    list: async () => kayitlar,
    launch: async (clusters) => {
      kayit.launch.push(clusters);
      if (launchHata) throw new Error(launchHata);
      return { serverId: 1, jobId: 100 + kayit.launch.length };
    },
    getStatus: async () => {
      const s = sirali[Math.min(kayit.getStatus, sirali.length - 1)];
      kayit.getStatus += 1;
      return s;
    },
    parse: (a) => a,
    save: async (rec) => {
      kayit.save.push(rec);
    },
  };
  return { deps, kayit };
}

// ── CR1: HANGI CLUSTER'LAR TAZELENIR ────────────────────────────────────────
//
// KORLUK PANZEHIRI: "hepsini dondur" de, "hicbirini dondurme" de bir kosulu
// saglar. Uc hal ayni testte: eksik (evet), taze (HAYIR), bayat (evet).
test('CR1 eksik ve bayat cluster tazelenir, taze olan TAZELENMEZ', () => {
  const kayitlar = [
    { clusterName: 'TAZE', fetchedAt: new Date(SIMDI - 1 * GUN).toISOString() },
    {
      clusterName: 'bayat',
      fetchedAt: new Date(SIMDI - (cr.TAZELEME_GUN + 1) * GUN).toISOString(),
    },
  ];
  const sonuc = cr.tazelenecekler(kayitlar, ['taze', 'bayat', 'yok'], SIMDI);
  assert.deepEqual(sonuc.sort(), ['bayat', 'yok']);
});

// ── CR2: TETIK TEKIL VE SOGUR ────────────────────────────────────────────────
test('CR2 yalnizca eksik cluster icin BIR is; soguma icinde ikinci kesif is ACMAZ', async () => {
  cr._sifirla();
  const kayitlar = [{ clusterName: 'c1', fetchedAt: new Date(SIMDI).toISOString() }];
  const { deps, kayit } = sahteDeps({ kayitlar });
  const r1 = await cr.arkaPlandaTazele({ env: 'qa', tenant: 'ark', clusters: ['c1', 'c2'], deps });
  assert.equal(r1.launched, true);
  assert.deepEqual(
    kayit.launch,
    [['c2']],
    'taze cluster da taranmaya gonderilmis ya da eksik olan gonderilmemis',
  );

  // Is bitti ama sonuc c2'yi YAZMADI (ornegin okunamadi). Kayit hala eksik —
  // soguma olmasaydi her kesif yeni bir AWX isi acardi.
  const r2 = await cr.arkaPlandaTazele({ env: 'qa', tenant: 'ark', clusters: ['c1', 'c2'], deps });
  assert.equal(r2.launched, false, 'soguma icinde ayni cluster icin ikinci is acildi');
  assert.equal(kayit.launch.length, 1);
});

test('CR2b ayni anda gelen iki kesif AYNI cluster icin iki is ACMAZ', async () => {
  cr._sifirla();
  const { deps, kayit } = sahteDeps({
    statusler: [{ finished: false }, { finished: true, artifacts: {} }],
  });
  await Promise.all([
    cr.arkaPlandaTazele({ env: 'qa', tenant: 'ark', clusters: ['c9'], deps }),
    cr.arkaPlandaTazele({ env: 'qa', tenant: 'ark', clusters: ['c9'], deps }),
  ]);
  assert.equal(kayit.launch.length, 1, 'es zamanli kesifler ayni cluster icin iki is acti');
});

// ── CR2c: SOGUMADAN UZUN SUREN IS ────────────────────────────────────────────
//
// MUTASYON TURUNDA EKLENDI: "ucan is" kontrolu silindiginde CR2/CR2b YESIL
// kaliyordu — ikisinde de soguma suresi ayni isi goruyordu. `_ucan`in asil isi
// soguma DOLDUKTAN sonra: is AWX kuyrugunda 10 dakikadan uzun beklediginde
// ikinci bir kesif ayni cluster icin IKINCI bir is acmamali.
test('CR2c soguma dolsa da is SURERKEN ayni cluster icin ikinci is ACILMAZ', async () => {
  cr._sifirla();
  const { deps, kayit } = sahteDeps({ statusler: [{ finished: false }] });
  let ikinci = null;
  const esikSorgu = Math.ceil(cr.SOGUMA_MS / cr.YOKLAMA_MS) + 2;
  const asilDurum = deps.getStatus;
  deps.getStatus = async (s, j) => {
    // Izleyici YOKLAMA_MS adimlariyla zamani ilerletiyor; soguma dolduktan
    // sonra ikinci bir kesif gelir, ardindan ilk is biter.
    if (kayit.getStatus === esikSorgu) {
      ikinci = cr.arkaPlandaTazele({ env: 'qa', tenant: 'ark', clusters: ['uzun'], deps });
    }
    if (kayit.getStatus > esikSorgu) {
      kayit.getStatus += 1;
      return { finished: true, artifacts: {} };
    }
    return asilDurum(s, j);
  };
  await cr.arkaPlandaTazele({ env: 'qa', tenant: 'ark', clusters: ['uzun'], deps });
  await ikinci;
  assert.ok(ikinci, 'senaryo kurulamadi: ikinci kesif hic tetiklenmedi');
  assert.equal(kayit.launch.length, 1, 'is surerken ayni cluster icin ikinci AWX isi acildi');
});

// ── CR3: SONUC KIMSE YOKLAMASA DA YAZILIR ────────────────────────────────────
test('CR3 izleyici is bitene kadar sorar ve YALNIZCA ozeti gelen cluster`i yazar', async () => {
  const parsed = {
    environment: 'qa',
    platform: 'ark',
    capabilities: [
      { cluster: 'c1', scanned: true, kinds: ['kafkas.kafka.strimzi.io'], resourcesReadable: true },
      // OZET SATIRI YOK: tarama yarim kaldi. Bos listeyi "CRD yok" diye yazmak
      // gercek tipleri silerdi.
      { cluster: 'c2', scanned: false, kinds: [], resourcesReadable: true },
    ],
  };
  const { deps, kayit } = sahteDeps({
    statusler: [{ finished: false }, { finished: false }, { finished: true, artifacts: parsed }],
  });
  const r = await cr.izleVeKaydet({ serverId: 1, jobId: 7, scannedBy: 'u', deps });
  assert.equal(r.finished, true);
  assert.equal(kayit.getStatus, 3, 'is bitmeden vazgecilmis ya da bitince sormaya devam edilmis');
  assert.deepEqual(
    kayit.save.map((s) => s.clusterName),
    ['c1'],
    'ozeti gelmeyen cluster yazildi (bos liste gercek tipleri siler) ya da tamamlanan yazilmadi',
  );
  assert.equal(kayit.save[0].awxJobId, 7);
  assert.equal(kayit.save[0].env, 'qa');
});

test('CR3b bitmeyen is AZAMI sure sonunda birakilir (sonsuz dongu yok)', async () => {
  const { deps, kayit } = sahteDeps({ statusler: [{ finished: false }] });
  const r = await cr.izleVeKaydet({ serverId: 1, jobId: 8, scannedBy: 'u', deps });
  assert.equal(r.finished, false);
  assert.equal(kayit.save.length, 0);
  // Sure YOKLAMA_MS adimlariyla ilerliyor: sorulan sayi tavani asmamali.
  assert.ok(
    kayit.getStatus <= cr.AZAMI_IZLEME_MS / cr.YOKLAMA_MS + 1,
    `izleyici ${kayit.getStatus} kez sordu`,
  );
});

// ── CR4: HATA KESFI DUSURMEZ ─────────────────────────────────────────────────
test('CR4 baslatma hatasi reddedilmis promise DONDURMEZ', async () => {
  cr._sifirla();
  const { deps } = sahteDeps({ launchHata: 'AWX 503' });
  const r = await cr.arkaPlandaTazele({ env: 'qa', tenant: 'ark', clusters: ['cx'], deps });
  assert.equal(r.launched, false);
  assert.match(r.error, /503/);
});

// ── CR5: KESIF YOLUNA BAGLI (METIN BEKCISI) ──────────────────────────────────
//
// METIN BEKCISI OLDUGU ACIKCA YAZILI: davranisi CR1-CR4 kanitliyor; bu yalnizca
// kablolamayi — `/discover`in fonksiyonlari CAGIRDIGINI, kullanicinin isinden
// SONRA cagirdigini ve SONUCU BEKLEMEDIGINI — kilitliyor.
test('CR5 `/discover` arka plan tazelemeyi kullanici isinden SONRA ve BEKLEMEDEN baslatiyor', () => {
  const ix = fs
    .readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8')
    .replace(/\r\n/g, '\n');
  const bas = ix.indexOf("'/discover',");
  const govde = ix.slice(bas, ix.indexOf('\n  );\n', bas));
  const iIs = govde.indexOf('const job = await launchOnAwx(');
  const iTaze = govde.indexOf('.arkaPlandaTazele(');
  assert.ok(
    iIs > 0 && iTaze > iIs,
    'arka plan taramasi kullanicinin isinden ONCE ya da hic baslatilmiyor',
  );
  assert.doesNotMatch(
    govde.slice(iTaze - 40, iTaze),
    /await\s+capsRefresh\s*$/,
    'arka plan taramasi BEKLENIYOR — kesif onun suresi kadar gecikir',
  );
  assert.match(
    govde,
    /mode === 'capabilities'[\s\S]{0,80}\.izleVeKaydet\(/,
    'Admin > Tara sonucu sunucuda izlenmiyor',
  );
});
