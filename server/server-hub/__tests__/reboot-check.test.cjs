// server/server-hub/__tests__/reboot-check.test.cjs — RC1..RC5 (2026-10-08).
//
// Reboot Kontrolu: "once" goruntusu Portal'da saklanir ve "sonra" job'ina Portal verir; sunucu
// SORUNSUZ ancak son goruntu OLCULDU ve once ile farki yoksa. Duzeltme JVM/web baslatir ve durdurur;
// onaysiz baslamaz.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const http = require('node:http');

const { sonraDegerlendir, onceGirdisi, kayitDurumu, SONRA_ACIK } = require('../reboot-check.cjs');

test('RC1 sorunsuz yalniz: son goruntu olculdu VE fark yok', () => {
  const d = sonraDegerlendir({
    A: { once_var: true, son_olculdu: true, son_fark: [], islemler: ['SONUC|baslat|JBOSS8_JVM|x|OK|ok'] },
    B: { once_var: true, son_olculdu: true, son_fark: ['FARK|DOWN|JBOSS8_JVM|y|d'], islemler: ['SONUC|baslat|JBOSS8_JVM|y|FAIL|hata'] },
    C: { once_var: true, son_olculdu: false, son_fark: [] },
    D: { sonuc_yok: true },
    E: { once_var: false, son_olculdu: true, son_fark: [] },
  }, ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.equal(d.A.durum, 'sorunsuz');
  assert.deepEqual([d.B.durum, d.B.kalan, d.B.hatali], ['sorunlu', 1, 1]);
  for (const h of ['C', 'D', 'E', 'F']) assert.equal(d[h].durum, 'olculemedi', `${h} olculemedigi halde sorunsuz/sorunlu sayildi`);
});

test('RC2 "sonra" girdisi yalniz goruntusu ALINAN ve yeni bicimde (BOOT satirli) sunuculari tasir', () => {
  const g = onceGirdisi({
    A: { goruntu_ok: true, goruntu: ['BOOT|b||', 'URUN|JBOSS8||'] },
    B: { goruntu_ok: false, goruntu: ['BOOT|b||'] },
    C: { goruntu_ok: true, goruntu: [] },
    D: { sonuc_yok: true },
    E: { goruntu_ok: true, goruntu: ['JBOSS8_JVM|x|1|1|was|d'] },
  });
  assert.deepEqual(Object.keys(g), ['A']);
});

// --- uc testi: sahte db + sahte launch
function sahteDb(satir) {
  const yaz = [];
  const p = require.resolve('../../db/index.cjs');
  const eski = require.cache[p];
  const m = new Module(p, null);
  m.loaded = true;
  m.exports = {
    query: async (sql, params) => {
      const t = String(sql).replace(/\s+/g, ' ');
      if (/^SELECT \* FROM reboot_checks WHERE id/.test(t.trim())) return { rows: satir ? [satir] : [] };
      yaz.push({ sql: t, params });
      return { rows: [{ id: 7 }] };
    },
  };
  require.cache[p] = m;
  return { yaz, geri: () => { if (eski) require.cache[p] = eski; else delete require.cache[p]; } };
}
async function istek(router, yol, govde) {
  const app = express();
  app.use(express.json());
  app.use((req, _r, n) => { req.session = { user: { username: 'onur', role: 'Admin' } }; n(); });
  app.use('/x', router);
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/x${yol}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(govde) });
    return { status: res.status, body: await res.json() };
  } finally { srv.close(); }
}
function routerKur(launchlar) {
  const r = express.Router();
  delete require.cache[require.resolve('../reboot-check.cjs')];
  require('../reboot-check.cjs').mount(r, {
    HOST_RE: /^[A-Za-z0-9][A-Za-z0-9-]{1,62}$/,
    launch: async (_req, key, _ad, ev) => { launchlar.push({ key, ev }); return { jobId: 55, awxServerId: 1 }; },
  });
  return r;
}

test('RC3 reboot oncesi: target_hosts + rc_faz=once; kayit acilir', async () => {
  const d = sahteDb(null);
  try {
    const l = [];
    const r = await istek(routerKur(l), '/reboot-check', { hosts: ['gbjbop18', 'GBJBOP18', 'gbjboap18'] });
    assert.equal(r.status, 200);
    assert.deepEqual(l[0], { key: 'reboot_check', ev: { rc_faz: 'once', target_hosts: 'GBJBOP18,GBJBOAP18' } });
    assert.ok(d.yaz.some((y) => /INSERT INTO reboot_checks/.test(y.sql)));
    const bos = await istek(routerKur(l), '/reboot-check', { hosts: [] });
    assert.equal(bos.status, 400);
  } finally { d.geri(); }
});

test('RC4 reboot sonrasi ONAYSIZ baslamaz', async () => {
  const d = sahteDb({ id: 7, status: 'once_hazir', hosts_json: '["A"]', once_json: JSON.stringify({ sunucular: { A: { goruntu_ok: true, goruntu: ['BOOT|b||'] } } }) });
  try {
    const l = [];
    const r = await istek(routerKur(l), '/reboot-check/7/sonra', {});
    assert.equal(r.status, 400);
    assert.equal(l.length, 0, 'onaysiz is baslatildi');
  } finally { d.geri(); }
});

test('RC5 reboot sonrasi: "once" goruntusu Portal\'dan rc_once ile gider; goruntusu olmayan sunucu hedeflenmez', async () => {
  const once = { sunucular: { A: { goruntu_ok: true, goruntu: ['BOOT|b||', 'JVM|JBOSS8|app|x'] }, B: { goruntu_ok: false, goruntu: [] } } };
  const d = sahteDb({ id: 7, status: 'once_hazir', hosts_json: '["A","B"]', once_json: JSON.stringify(once) });
  try {
    const l = [];
    const r = await istek(routerKur(l), '/reboot-check/7/sonra', { onay: true });
    assert.equal(r.status, 200);
    assert.deepEqual(l[0].ev, { rc_faz: 'sonra', target_hosts: 'A', rc_once: { A: ['BOOT|b||', 'JVM|JBOSS8|app|x'] } });
    assert.deepEqual(r.body.disarida, ['B']);
    const durum = await istek(routerKur(l), '/reboot-check/7/sonra', { onay: true });
    assert.equal(durum.status, 200);
  } finally { d.geri(); }
});

test('RC6 once job bitince sonuc kayda yazilir: goruntu alinan varsa once_hazir, hic yoksa once_hata', async () => {
  const sahte = (yol, exp) => {
    const p = require.resolve(yol); const eski = require.cache[p];
    const m = new Module(p, null); m.loaded = true; m.exports = exp; require.cache[p] = m;
    return () => { if (eski) require.cache[p] = eski; else delete require.cache[p]; };
  };
  for (const [sunucular, beklenen] of [
    [{ A: { goruntu_ok: true, goruntu: ['BOOT|b||'] } }, 'once_hazir'],
    [{ A: { goruntu_ok: false, goruntu: [] } }, 'once_hata'],
    [{ A: { goruntu_ok: true, goruntu: ['JBOSS8_JVM|x|1|1|was|d'] } }, 'once_hata'],
  ]) {
    const d = sahteDb({ id: 7, status: 'once_kosuyor', hosts_json: '["A"]', once_job_id: 55, once_server_id: 1 });
    const g1 = sahte('../../ansible/runner.cjs', { getJobStatusOnServer: async () => ({ status: 'successful', artifacts: {} }) });
    const g2 = sahte('../../opsx/index.cjs', { extractStatsKey: () => ({ faz: 'once', sunucular }) });
    try {
      const r = express.Router();
      delete require.cache[require.resolve('../reboot-check.cjs')];
      require('../reboot-check.cjs').mount(r, { HOST_RE: /.*/, launch: async () => ({}) });
      const app = express(); app.use('/x', r);
      const srv = http.createServer(app); await new Promise((ok) => srv.listen(0, ok));
      try { await fetch(`http://127.0.0.1:${srv.address().port}/x/reboot-check/7`); } finally { srv.close(); }
      const upd = d.yaz.find((y) => /^UPDATE reboot_checks SET status/.test(y.sql.trim()));
      assert.ok(upd, 'kayit guncellenmedi');
      assert.equal(upd.params[0], beklenen);
    } finally { g2(); g1(); d.geri(); }
  }
});

test('RC7 is SURERKEN AWX anlik durumu ve faz baslangici doner; okunamazsa "okunamadi" (bitti SAYILMAZ)', async () => {
  // Kullanici (2026-10-09): "'Suruyor' kelimesi isin gercekten calisip calismadigini anlamaya yetmiyor"
  const sahte = (yol, exp) => {
    const p = require.resolve(yol); const eski = require.cache[p];
    const m = new Module(p, null); m.loaded = true; m.exports = exp; require.cache[p] = m;
    return () => { if (eski) require.cache[p] = eski; else delete require.cache[p]; };
  };
  for (const [runner, beklenen] of [
    [{ getJobStatusOnServer: async () => ({ status: 'running' }) }, 'running'],
    [{ getJobStatusOnServer: async () => { throw new Error('AWX yok'); } }, 'okunamadi'],
  ]) {
    const d = sahteDb({ id: 7, status: 'sonra_kosuyor', hosts_json: '["A"]', sonra_job_id: 55, sonra_server_id: 1, updated_at: '2026-10-09T08:00:00Z' });
    const g1 = sahte('../../ansible/runner.cjs', runner);
    try {
      const r = express.Router();
      delete require.cache[require.resolve('../reboot-check.cjs')];
      require('../reboot-check.cjs').mount(r, { HOST_RE: /.*/, launch: async () => ({}) });
      const app = express(); app.use('/x', r);
      const srv = http.createServer(app); await new Promise((ok) => srv.listen(0, ok));
      let body;
      try { body = await (await fetch(`http://127.0.0.1:${srv.address().port}/x/reboot-check/7`)).json(); } finally { srv.close(); }
      assert.equal(body.kayit.durum, 'sonra_kosuyor');
      assert.equal(body.kayit.awxDurum, beklenen);
      assert.equal(body.kayit.fazBasladi, '2026-10-09T08:00:00Z');
      assert.ok(!d.yaz.some((y) => /^UPDATE reboot_checks SET status/.test(y.sql.trim())), 'surerken kayit sonuclandirildi');
    } finally { g1(); d.geri(); }
  }
});

test('RC8 KONTROL GEREKLI: once bos ya da "dokunulmadi" denen oge simdi calisiyorsa fark yok diye SORUNSUZ denmez', () => {
  // Uretim 2026-11-14: once goruntusunde urun yoktu, her sey "dokunulmadi" yazildi ve sunucu "Sorunsuz" cikti.
  const son = ['BOOT|b2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x'];
  const d = sonraDegerlendir({
    BOS: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: son, plan: ['BILGI|BOS|||bos'] },
    BOS2: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: son, plan: [] },
    NEW: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: son, plan: ['BILGI|NEW|JBOSS8||reboot oncesi calismiyordu, simdi calisiyor - dokunulmadi', 'BILGI|NEW|JBOSS8|appA|reboot oncesi JBOSS8 hic calismiyordu - JVMlerine dokunulmadi'] },
    KAPALI: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: ['BOOT|b2||'], plan: ['BILGI|NEW|IHS||reboot oncesi calismiyordu, simdi calisiyor - dokunulmadi'] },
    TAMAM: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: son, plan: ['ISLEM|was|baslat|JBOSS8|appA|x'] },
    SORUN: { once_var: true, son_olculdu: true, son_fark: ['FARK|DOWN|JVM|JBOSS8|appB|x'], son_goruntu: son, plan: ['BILGI|BOS|||bos'] },
  }, ['BOS', 'BOS2', 'NEW', 'KAPALI', 'TAMAM', 'SORUN'], { BOS2: ['BOOT|b1||'], TAMAM: ['BOOT|b1||', 'URUN|JBOSS8||', 'JVM|JBOSS8|appA|x'] });
  assert.equal(d.BOS.durum, 'kontrol');
  assert.equal(d.BOS2.durum, 'kontrol', 'once satirlarinda izlenen satir yokken sorunsuz denildi');
  assert.match(d.BOS2.sebep, /izlenen ürün\/JVM yoktu/);
  assert.equal(d.NEW.durum, 'kontrol');
  assert.match(d.NEW.neden[0], /2 öğe şimdi çalışıyor.*JBOSS8, JBOSS8\/appA/);
  assert.equal(d.KAPALI.durum, 'sorunsuz', 'dokunulmayan ama simdi KAPALI oge kontrol sayildi');
  assert.equal(d.TAMAM.durum, 'sorunsuz');
  assert.equal(d.SORUN.durum, 'sorunlu', "fark kalan sunucu kontrol'e dusuruldu");
  assert.equal(kayitDurumu([d.TAMAM, d.BOS], true), 'kontrol');
  assert.equal(kayitDurumu([d.TAMAM, d.BOS, d.SORUN], true), 'sorunlu');
  assert.equal(kayitDurumu([d.TAMAM], true), 'tamam');
  assert.equal(kayitDurumu([d.TAMAM, { durum: 'olculemedi' }, d.BOS], true), 'sorunlu', 'olculemeyen varken kontrol denildi');
  assert.equal(kayitDurumu([], false), 'sonra_hata');
  assert.ok(SONRA_ACIK.includes('kontrol'), "'kontrol' kaydinda sonra yeniden kosturulamiyor");
  // onceGirdisi bos once goruntusunu yine tasir (kontrol 'sonra'da yapilir; hedeften DUSURULMEZ)
  assert.deepEqual(onceGirdisi({ A: { goruntu_ok: true, goruntu: ['BOOT|b||'] } }), { A: ['BOOT|b||'] });
});

const sahteModul = (yol, exp) => {
  const p = require.resolve(yol); const eski = require.cache[p];
  const m = new Module(p, null); m.loaded = true; m.exports = exp; require.cache[p] = m;
  return () => { if (eski) require.cache[p] = eski; else delete require.cache[p]; };
};
async function ilerletKos(satir, sonuc) {
  const d = sahteDb(satir);
  const g1 = sahteModul('../../ansible/runner.cjs', { getJobStatusOnServer: async () => ({ status: 'successful', artifacts: {} }) });
  const g2 = sahteModul('../../opsx/index.cjs', { extractStatsKey: () => sonuc });
  try {
    const r = express.Router();
    delete require.cache[require.resolve('../reboot-check.cjs')];
    require('../reboot-check.cjs').mount(r, { HOST_RE: /.*/, launch: async () => ({}) });
    const app = express(); app.use('/x', r);
    const srv = http.createServer(app); await new Promise((ok) => srv.listen(0, ok));
    try { await fetch(`http://127.0.0.1:${srv.address().port}/x/reboot-check/7`); } finally { srv.close(); }
    return d.yaz.find((y) => /^UPDATE reboot_checks SET status/.test(y.sql.trim()));
  } finally { g2(); g1(); d.geri(); }
}

test('RC9 once bitince bos once goruntulu sunucular ozet.once.once_bos listesinde; kayit yine once_hazir', async () => {
  const sunucular = { A: { goruntu_ok: true, goruntu: ['BOOT|b||'] }, B: { goruntu_ok: true, goruntu: ['BOOT|b||', 'URUN|NGINX||'] } };
  const upd = await ilerletKos({ id: 7, status: 'once_kosuyor', hosts_json: '["A","B"]', once_job_id: 55, once_server_id: 1 }, { faz: 'once', sunucular });
  assert.equal(upd.params[0], 'once_hazir');
  assert.deepEqual(JSON.parse(upd.params[2]).once.once_bos, ['A']);
});

test("RC10 sonra bitince: kontrol nedeni olan + sorunsuz -> kayit 'kontrol'; once satirlari once_json'dan gelir", async () => {
  const once = { sunucular: { A: { goruntu_ok: true, goruntu: ['BOOT|b||'] }, B: { goruntu_ok: true, goruntu: ['BOOT|b||', 'URUN|NGINX||'] } } };
  const son = ['BOOT|c||', 'URUN|NGINX||'];
  const sunucular = { A: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: son, plan: [] }, B: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: son, plan: [] } };
  const upd = await ilerletKos({ id: 7, status: 'sonra_kosuyor', hosts_json: '["A","B"]', sonra_job_id: 55, sonra_server_id: 1, once_json: JSON.stringify(once), sonra_hedef_json: '["A","B"]' }, { faz: 'sonra', sunucular });
  assert.equal(upd.params[0], 'kontrol');
  const oz = JSON.parse(upd.params[2]).sonra;
  assert.deepEqual([oz.sorunsuz, oz.kontrol, oz.toplam, oz.sunucu.A.durum, oz.sunucu.B.durum], [1, 1, 2, 'kontrol', 'sorunsuz']);
});

test("RC11 'kontrol' kaydinda reboot sonrasi kontrol yeniden kosturulabilir", async () => {
  const once = { sunucular: { A: { goruntu_ok: true, goruntu: ['BOOT|b||', 'URUN|NGINX||'] } } };
  const d = sahteDb({ id: 7, status: 'kontrol', hosts_json: '["A"]', once_json: JSON.stringify(once) });
  try {
    const l = [];
    const r = await istek(routerKur(l), '/reboot-check/7/sonra', { onay: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(l.length, 1);
  } finally { d.geri(); }
});

test('RC12 kontrol nedeni once <-> son goruntuden: plandan SONRA kalkan yeni urun de "kontrol" yapar; once urunun yeni JVM\'i Portal kalaninda', () => {
  // Inceleme 2026-11-14 (B1): NGINX urun planindan sonra kalkti, plan BILGI satiri yok -> Portal "sorunsuz", rapor "Uyari" diyordu.
  const once = ['BOOT|b1||', 'SURUM|2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|app1|x'];
  const son = [...once.filter((l) => !l.startsWith('BOOT')), 'BOOT|b2||', 'URUN|NGINX||', 'URUN|WAS||', 'JVM|WAS|s1|profil=p'];
  const d = sonraDegerlendir({ A: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: son, plan: [] } }, ['A'], { A: once });
  assert.equal(d.A.durum, 'kontrol');
  assert.match(d.A.neden.join(' '), /3 öğe şimdi çalışıyor.*NGINX, WAS, WAS\/s1/);
  const yeniJvm = sonraDegerlendir({ A: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: [...once, 'JVM|JBOSS8|app9|x'], plan: [] } }, ['A'], { A: once });
  assert.deepEqual([yeniJvm.A.durum, yeniJvm.A.kalan], ['sorunlu', 1], 'once calisan urunun fazladan JVM\'i betik kalaninda yoksa gozden kacti');
});

test('RC13 eski surum once (SURUM yok) + yeni son: JBoss sahte fark uretmez, nedeni "eski betik surumu" ile kontrol', () => {
  const once = ['BOOT|b1||', 'URUN|JBOSS7||', 'JVM|JBOSS7|app1|jboss_home=/vhosting8/jboss/AppServer'];
  const son = ['BOOT|b2||', 'SURUM|2||', 'URUN|JBOSS8||', 'JVM|JBOSS8|app1|jboss_home=/vhosting8/jboss/AppServer'];
  for (const plan of [['BILGI|ESKI|||eski'], []]) {
    const d = sonraDegerlendir({ A: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: son, plan } }, ['A'], { A: once });
    assert.deepEqual([d.A.durum, d.A.kalan], ['kontrol', 0], JSON.stringify(d.A));
    assert.match(d.A.sebep, /eski betik sürümüyle/);
  }
});

test('RC14 sonuclanmis eski kayit ayrintisi acilinca yeni kuralla yeniden degerlendirilir ve kayda yazilir', async () => {
  // Inceleme 2026-11-14 (B4): eski once'ta yalniz JVM satiri vardi, eski betik "dokunulmadi" dedi; rozet "Sorunsuz", tablo kirmizi.
  const once = { sunucular: { A: { goruntu_ok: true, goruntu: ['BOOT|b1||', 'JVM|JBOSS8|app1|x'] } } };
  const sonra = { sunucular: { A: { once_var: true, son_olculdu: true, son_fark: [], son_goruntu: ['BOOT|b2||'], plan: ['BILGI|DOWN|JBOSS8|app1|reboot oncesi JBOSS8 hic calismiyordu - JVMlerine dokunulmadi'] } } };
  const eskiOzet = { sonra: { sorunsuz: 1, kontrol: 0, toplam: 1, job: 'successful', sunucu: { A: { durum: 'sorunsuz', kalan: 0, islem: 0, hatali: 0 } } } };
  const kos = async (satir) => {
    const d = sahteDb(satir);
    try {
      const r = express.Router();
      delete require.cache[require.resolve('../reboot-check.cjs')];
      require('../reboot-check.cjs').mount(r, { HOST_RE: /.*/, launch: async () => ({}) });
      const app = express(); app.use('/x', r);
      const srv = http.createServer(app); await new Promise((ok) => srv.listen(0, ok));
      let body;
      try { body = await (await fetch(`http://127.0.0.1:${srv.address().port}/x/reboot-check/7`)).json(); } finally { srv.close(); }
      return { body, upd: d.yaz.find((y) => /^UPDATE reboot_checks SET status/.test(y.sql.trim())) };
    } finally { d.geri(); }
  };
  const satir = { id: 7, status: 'tamam', hosts_json: '["A"]', once_json: JSON.stringify(once), sonra_json: JSON.stringify(sonra), sonra_hedef_json: '["A"]', ozet_json: JSON.stringify(eskiOzet) };
  const { body, upd } = await kos(satir);
  assert.equal(body.kayit.durum, 'sorunlu');
  assert.equal(body.kayit.ozet.sonra.sunucu.A.kalan, 2);
  assert.ok(upd, 'yeniden hesaplanan durum kayda yazilmadi');
  assert.deepEqual([upd.params[0], upd.params[3]], ['sorunlu', 'tamam']);
  // tutarli kayit: yazim yok
  const ikinci = await kos({ ...satir, status: 'sorunlu', ozet_json: JSON.stringify({ sonra: body.kayit.ozet.sonra }) });
  assert.equal(ikinci.upd, undefined, 'degismeyen kayit yeniden yazildi');
});
