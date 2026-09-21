// server/ansible/__tests__/job-stdout-artimli.test.cjs
//
// AWX STDOUT'U HER YOKLAMADA BASTAN INDIRILMESIN (P2-2).
//
// Uretim olcumu: `GET /jobs/N/output` 98 yavas istek, ORTALAMA 20,8 sn (en
// fazla 35,8 sn). Istemci ise stdout akarken 1,5 saniyede bir yokluyor
// (`JobTrackerContext` RUN_MS). Yani 20 saniye suren bir indirme 1,5 saniyede
// bir yeniden baslatiliyordu; `ss/job-status` uretimde 2.446 yavas istek
// uretti ve ayni tamponlar `fetchAwxPlainText`teki OOM notunun "BIRIKIM"
// dedigi baskiyi olusturuyordu.
//
// EN KRITIK BEKCI JS3'TUR: AWX `start_line`i YOK SAYARSA tam metin doner ve
// naif bir birlestirme ciktiyi SESSIZCE IKIYE KATLARDI. Bindirme dogrulamasi
// olmadan bu iyilestirme bir veri bozulmasi kaynagi olurdu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER_SRC = fs.readFileSync(path.join(ROOT, 'server/ansible/runner.cjs'), 'utf8');
const onbellek = require('../job-stdout-cache.cjs');

/**
 * AWX'in `/stdout/?format=txt&start_line=N` semantigini taklit eden sunucu.
 * `indirilenBayt`: iyilestirmenin GERCEKTEN calistigini OLCEREK kanitlamak icin.
 */
function sahteAwx() {
  const durum = { satirlar: [], indirilenBayt: 0, istekler: [], startLineDesteksiz: false };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const sl = Number(u.searchParams.get('start_line') || 0);
    durum.istekler.push(sl);
    const govde = durum.startLineDesteksiz
      ? durum.satirlar.join('\n')                 // parametreyi YOK SAYAR
      : durum.satirlar.slice(sl).join('\n');
    durum.indirilenBayt += Buffer.byteLength(govde, 'utf8');
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(govde);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, durum, port: srv.address().port })));
}

/**
 * GERCEK `getJobOutputOnServer` govdesi kaynaktan cikarilir (kopyasi degil) ve
 * ag disindaki bagimliliklari enjekte edilir. Fail-closed: desen degisirse test
 * duser, sessizce bos dilim uretmez.
 */
function gercekGetJobOutput(port) {
  const k = RUNNER_SRC.indexOf('const JOB_OUTPUT_MAX_BYTES');
  const i = RUNNER_SRC.indexOf('function fetchAwxPlainText');
  const j = RUNNER_SRC.indexOf('function isAwxStdoutTooLarge');
  const g = RUNNER_SRC.indexOf('async function getJobOutputOnServer');
  const gs = RUNNER_SRC.indexOf('\n}', RUNNER_SRC.indexOf('return { output, artimliKullanildi: false };', g));
  assert.ok(k > 0 && i > k && j > i && g > j && gs > g, 'kaynak cikarimi bozuldu — desen degismis');

  const govde =
    `${RUNNER_SRC.slice(k, i)}\n` +
    `${RUNNER_SRC.slice(i, j)}\n` +
    `${RUNNER_SRC.slice(j, RUNNER_SRC.indexOf('\n}', j) + 2)}\n` +
    `${RUNNER_SRC.slice(g, gs + 2)}\n` +
    'return { getJobOutputOnServer };';

  return new Function(
    'http', 'https', 'URL', 'stdoutCache',
    'getServerById', 'getTokenForServer', 'mapApiPath', 'collectJobEventsStdout', 'awxRequestToServer', 'console',
    govde,
  )(
    http, require('node:https'), URL, onbellek,
    () => ({ id: 1, url: `http://127.0.0.1:${port}` }),
    async () => 'tok',
    (_s, p) => p,
    async () => '',
    async () => ({}),
    { warn() {} },
  ).getJobOutputOnServer;
}

// ── Saf birlestirme ─────────────────────────────────────────────────────────

test('JS1 birlestir: bindirme tutarsa metin dogru uzar', () => {
  // 3 satirlik onbellek → capa satiri index 1 ('b'), yani parca 'b' ile baslar.
  const r = onbellek.birlestir('a\nb\nc', 'b\nc\nd\ne');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'a\nb\nc\nd\ne');
  assert.equal(r.lines, 5);
});

test('JS2 birlestir: yeni satir yoksa metin AYNEN kalir', () => {
  const r = onbellek.birlestir('a\nb\nc', 'b\nc');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'a\nb\nc');
  assert.equal(r.lines, 3);
});

test('JS2b YARIM SON SATIR: is hala yaziyorken bindirme TUTAR ve satir tamamlanir', () => {
  // Onbellekte son satir yarim: AWX o satiri henuz bitirmemisti.
  // Tek satirlik bindirmede karsilastirma yarim satira duser, TUTMAZ ve
  // iyilestirme her yoklamada tam cekime duserek sessizce ise yaramaz olurdu.
  const r = onbellek.birlestir('a\nb\nTASK [yar', 'b\nTASK [yarim tamamlandi]\nc');
  assert.equal(r.ok, true, 'yarim son satir bindirmeyi dusurdu — kazanc sifira inerdi');
  assert.equal(r.text, 'a\nb\nTASK [yarim tamamlandi]\nc');
});

test('JS3 birlestir: BINDIRME TUTMAZSA reddeder (cikti IKIYE KATLANMAZ)', () => {
  // AWX `start_line`i yok saydi ve TUM metni dondu.
  const r = onbellek.birlestir('a\nb\nc', 'a\nb\nc\nd');
  assert.equal(r.ok, false, 'tum metin onbellegin UZERINE eklenseydi cikti bozulurdu');
});

test('JS4 onbellek: FIFO tahliye en ESKIYI atar, DOKUNULANI korur', () => {
  onbellek._sifirla();
  for (let i = 0; i < onbellek.MAX_ENTRIES; i++) onbellek.yaz(1, i, 'x', 1);
  onbellek.al(1, 0);                       // en eskiye DOKUN → tazelenmeli
  onbellek.yaz(1, 9999, 'x', 1);           // tavani as
  assert.ok(onbellek.al(1, 0), 'dokunulan satir tahliye edildi — Map.set sirayi tazelemez');
  assert.equal(onbellek.al(1, 1), null, 'en eski satir atilmadi');
  assert.ok(onbellek._durum().boyut <= onbellek.MAX_ENTRIES);
});

test('JS5 onbellek: bayt tavani asilirsa satir SILINIR (kirpilmaz)', () => {
  onbellek._sifirla();
  onbellek.yaz(1, 1, 'kisa', 1);
  const buyuk = 'y'.repeat(onbellek.MAX_BYTES_PER_JOB + 1);
  assert.equal(onbellek.yaz(1, 1, buyuk, 2), false);
  assert.equal(onbellek.al(1, 1), null, 'kirpilmis metnin uzerine artim eklemek ciktiyi bozardi');
});

// ── Gercek kod yolu ─────────────────────────────────────────────────────────

test('JS6 DIFERANSIYEL: 20 artimli yoklama, metin TAM CEKIMLE birebir ayni', async () => {
  onbellek._sifirla();
  const { srv, durum, port } = await sahteAwx();
  const getir = gercekGetJobOutput(port);
  try {
    let beklenen = '';
    for (let tur = 0; tur < 20; tur++) {
      for (let n = 0; n < 10; n++) durum.satirlar.push(`TASK [adim ${tur}-${n}] ${'*'.repeat(120)}`);
      beklenen = durum.satirlar.join('\n');
      const { output } = await getir(1, 7, { artimli: true });
      assert.equal(output, beklenen, `tur ${tur}: artimli metin tam cekimden SAPTI`);
    }
  } finally {
    srv.close();
  }
});

test('JS7 OLCUM: artimli yol tam cekimin cok altinda bayt indirir', async () => {
  const kur = async (artimli) => {
    onbellek._sifirla();
    const { srv, durum, port } = await sahteAwx();
    const getir = gercekGetJobOutput(port);
    try {
      for (let tur = 0; tur < 20; tur++) {
        for (let n = 0; n < 10; n++) durum.satirlar.push(`TASK [adim ${tur}-${n}] ${'*'.repeat(120)}`);
        await getir(1, 7, { artimli });
      }
      return durum.indirilenBayt;
    } finally {
      srv.close();
    }
  };
  const tam = await kur(false);
  const art = await kur(true);
  assert.ok(art * 3 < tam, `artimli ${art} bayt, tam ${tam} bayt — kazanc yok`);
});

test('JS8 AWX start_line`i YOK SAYARSA cikti BOZULMAZ (tam cekime duser)', async () => {
  onbellek._sifirla();
  const { srv, durum, port } = await sahteAwx();
  durum.startLineDesteksiz = true; // proxy/surum farki
  const getir = gercekGetJobOutput(port);
  try {
    for (let tur = 0; tur < 5; tur++) {
      durum.satirlar.push(`satir ${tur}`);
      const { output } = await getir(1, 7, { artimli: true });
      assert.equal(output, durum.satirlar.join('\n'), `tur ${tur}: cikti bozuldu`);
    }
  } finally {
    srv.close();
  }
});

test('JS9 `artimli` VARSAYILAN KAPALI — parametresiz cagri start_line GONDERMEZ', async () => {
  onbellek._sifirla();
  const { srv, durum, port } = await sahteAwx();
  const getir = gercekGetJobOutput(port);
  try {
    durum.satirlar.push('a', 'b');
    await getir(1, 7);
    await getir(1, 7);
    assert.deepEqual(durum.istekler, [0, 0], 'parametresiz cagri bugunku davranisi degistirdi');
    assert.equal(onbellek._durum().boyut, 0, 'artimli kapaliyken onbellege yazilmamali');
  } finally {
    srv.close();
  }
});

// ── Yapisal: rota artimliyi DOGRU baglamis mi ───────────────────────────────

test('JS10 ss/job-status: TERMINAL durumda TAM cekim yapilir (arsiv otoritesi)', () => {
  const kod = RUNNER_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const i = kod.indexOf("app.get('/api/ansible/ss/job-status/");
  assert.ok(i > 0, 'rota bulunamadi');
  const dilim = kod.slice(i, kod.indexOf('displayOutput', i));
  assert.ok(dilim.length > 0, 'dilim bos');
  assert.match(dilim, /artimli:\s*!bittiMi/, 'artimli, terminal durumdan bagimsiz veriliyor');
  assert.match(dilim, /stdoutCache\.sil\(/, 'is bitince onbellek satiri birakilmiyor');
  assert.doesNotMatch(dilim, /if\s*\(\s*(false|0|null|undefined)\s*\)/, 'olu dal');
});

test('JS11 arsivlenen metin ARTIMLARDAN turemez — arsiv terminal cekimden gelir', () => {
  const kod = RUNNER_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const i = kod.indexOf("app.get('/api/ansible/ss/job-status/");
  const arsiv = kod.indexOf('INSERT INTO ansible_job_output', i);
  const cekim = kod.indexOf('getJobOutputOnServer', i);
  assert.ok(cekim > 0 && arsiv > cekim, 'arsiv yazimi cekimden once — siralama bozuldu');
  // Cekim `bittiMi` HESAPLANDIKTAN sonra olmali, yoksa terminal ayrimi yapilamaz.
  assert.ok(kod.indexOf('const bittiMi', i) < cekim, 'bittiMi cekimden SONRA hesaplaniyor');
});

test('JS12 event yedeginden gelen metin ONBELLEGE KONMAZ (farkli satir bolumlemesi)', () => {
  const kod = RUNNER_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const g = kod.indexOf('async function getJobOutputOnServer');
  const dilim = kod.slice(g, kod.indexOf('\n}', kod.indexOf('return { output, artimliKullanildi: false };', g)));
  const ev = dilim.indexOf('collectJobEventsStdout');
  assert.ok(ev > 0, 'event yedegi bulunamadi');
  const sonrasi = dilim.slice(ev);
  assert.match(sonrasi, /return \{ output, artimliKullanildi: false \};/, 'event yolu erken donmuyor');
  assert.ok(
    sonrasi.indexOf('return') < sonrasi.indexOf('stdoutCache.yaz'),
    'event metni onbellege yaziliyor — sonraki artim bindirmesi tutmaz',
  );
});
