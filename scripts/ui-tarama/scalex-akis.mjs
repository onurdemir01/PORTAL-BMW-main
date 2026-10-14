#!/usr/bin/env node
// scripts/ui-tarama/scalex-akis.mjs — ScaleX sihirbazini GERCEK tarayicida, VERIYLE DOLU gezer.
//
// `tarama.mjs` her sayfayi "her API bos" ve "her API 500" durumlarinda acar; sihirbazin
// ICINE giremez (liste bos oldugu icin ikinci adima gecilemez). Bu betik ScaleX'e gercekci
// yanitlar verir ve bir kullanicinin yolunu yurur: kapsam -> namespace -> uygulamalar ->
// islem ve onay -> calistir. Her adimda olculenler: sayfa yuksekligi, o adima kadar tik
// sayisi, kontrast / tasma / etiketsiz girdi / adsiz dugme (lib.mjs DENETIM), konsol hatasi.
//
// Onay kapisi yanitlari UYDURMA DEGIL: `src/components/scalex/__tests__/fixtures/
// kapi-yanitlari.json` sunucu simulatorunden uretilen gercek govdelerdir.
//
// Kullanim:   node scripts/ui-tarama/scalex-akis.mjs                  (uc kurgu, iki tema)
//             node scripts/ui-tarama/scalex-akis.mjs --cikti /tmp/x
//             node scripts/ui-tarama/scalex-akis.mjs --eski           (2026-10-13 oncesi akis:
//                                                                      Islem ve Onizleme ayri adim)
//             UI_TARAMA_KOK=<baska calisma agaci> ...                  (o agacin ekranini olcer)
// Arka uca baglanmaz, depoya yazmaz, CI'da kosmaz. Gerekenler: Node 22+, Chrome/Chromium.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sekme, DENETIM, sleep } from './lib.mjs';

const BURASI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KOK = path.resolve(process.env.UI_TARAMA_KOK || BURASI);
const arg = (ad, varsayilan = null) => {
  const i = process.argv.indexOf(ad);
  return i < 0 ? varsayilan : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true;
};
const VITE_PORT = Number(process.env.UI_TARAMA_VITE_PORT || 5198);
const CDP_PORT = Number(process.env.UI_TARAMA_CDP_PORT || 9334);
const TABAN = `http://127.0.0.1:${VITE_PORT}`;
const CIKTI = path.resolve(String(arg('--cikti', path.join(os.tmpdir(), 'ui-tarama-scalex'))));
const ESKI = arg('--eski') === true;

// Ornekler HER ZAMAN bu depodan okunur (olculen agac eski olsa da sunucu yanitlari ayni kaynak).
const ORNEK = JSON.parse(
  fs.readFileSync(path.join(BURASI, 'src/components/scalex/__tests__/fixtures/kapi-yanitlari.json'), 'utf8'),
);

const simdi = new Date().toISOString();
const satir = (cluster, name, ek = {}) => ({
  cluster, name, kind: 'Deployment', resource: 'deployments', specReplicas: 3, statusReplicas: 3, readyReplicas: 3,
  hasHpa: false, image: `registry.ornek.test/${name}:1.4.2`, statePhase: null, previousReplicas: null, restorable: false,
  gitops: null, source: 'discovery', scalable: true, ...ek,
});
const ORTAK = {
  '/api/scalex/config': { ok: true, verificationTimeout: { default: 300, min: 30, max: 3600, failMultiplier: 2 }, maxTargets: 200, prodConfirmThreshold: 5, maxAuditGroups: 12, problems: [], sources: {} },
  '/api/scalex/clusters': { ok: true, tree: { prod: { t1: ['c1', 'c2'] }, test: { t1: ['ct1'] } } },
  '/api/scalex/namespaces': { ok: true, items: ['odeme', 'kredi', 'kart'], counts: { odeme: 2 }, sources: {}, clusters: {}, cached: true, fetchedAt: simdi, stale: false, source: 'inventory', hiddenCount: 0, unreadable: [] },
  '/api/scalex/apps': { ok: true, items: [{ name: 'api', kind: 'Deployment' }, { name: 'worker', kind: 'Deployment' }, { name: 'batch', kind: 'Deployment' }], clusters: {}, sources: {}, cached: true, fetchedAt: simdi, stale: false, scannedAt: simdi },
  // Durum ucu baslatma ucundan ONCE: `includes` ilk eslesmeyi alir.
  '/api/scalex/discover/': {
    ok: true, status: 'successful', finished: true, failed: false,
    result: {
      overallStatus: 'OK', mode: 'workloads', namespace: 'odeme', clusters: ['c1'], failedClusters: [], counts: { ok: 3, warn: 0, fail: 0 }, problems: [], pdbWarning: null,
      workloads: [satir('c1', 'api'), satir('c1', 'worker', { hasHpa: true }), satir('c1', 'batch', { specReplicas: 0, statusReplicas: 0, readyReplicas: 0 })],
      kindReports: [{ kind: 'sts', display: 'StatefulSet', resource: 'statefulsets.apps', verb: 'list', reason: 'no_permission', cluster: 'c1' }],
      packageVersion: '24', expectedPackageVersion: '24',
    },
  },
  '/api/scalex/discover': { ok: true, serverId: 1, jobId: 9001, status: 'pending' },
  '/api/scalex/stopped': {
    ok: true, hiddenCount: 0,
    items: [{ id: 3, env: 'prod', tenant: 't1', clusterName: 'c2', namespace: 'kredi', appName: 'rapor', workloadKind: 'Deployment', previousReplicas: 2, phase: 'scaled_down', stoppedBy: 'ayse', stoppedAt: simdi, lastSeenAt: simdi, driftStatus: 'in_sync' }],
  },
  '/api/scalex/oco-schedules': {
    ok: true, scope: 'own',
    // Sunucunun 2026-10-14'ten beri gonderdigi bicim: ham paket (`pendingLaunch`) YOK,
    // kapsam sunucuda uretilir (server/scalex/index.cjs `zamanlamaGorunumu`).
    items: [{
      id: 5, status: 'SCHEDULED', ocoNumber: '7654321', ocoSubject: 'Planli calisma', username: 'tarama', runAt: simdi,
      kapsam: { env: 'prod', tenant: 't1', clusters: ['c1'], namespace: 'odeme', apps: ['api'], action: 'stop', executionMode: 'apply', targetReplicas: null },
    }],
  },
  '/api/scalex/run/': ORNEK.bitenIs.tamCikti,
};
const kurguYanitlari = (ad) => ({
  '/api/scalex/preview': ORNEK.kurgular[ad].onizleme,
  '/api/scalex/run': { __status: ORNEK.kurgular[ad].calistirma.status, body: ORNEK.kurgular[ad].calistirma.govde },
});

// Kurgu -> calistirdiktan sonra ekranda beklenen metin.
const KURGULAR = [
  ['engel_smart_tanimsiz', null],
  ['onay_bekliyor', 'SMART kaydı açıldı'],
  ['basladi_smart_kapali', 'AWX Job'],
];

function chromeYolu() {
  const adaylar = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const bulunan = adaylar.find((p) => p && fs.existsSync(p));
  if (!bulunan) throw new Error('Chrome bulunamadi. CHROME_BIN ile yolunu verin.');
  return bulunan;
}
async function hazirOlana(url, sn = 90) {
  for (let i = 0; i < sn * 2; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`hazir olmadi: ${url}`);
}
const surecler = [];
const kapat = () => surecler.forEach((s) => { try { s.kill('SIGTERM'); } catch { /* zaten kapali */ } });
process.on('exit', kapat);
process.on('SIGINT', () => process.exit(130));

fs.rmSync(CIKTI, { recursive: true, force: true });
fs.mkdirSync(CIKTI, { recursive: true });
const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-tarama-profil-'));
console.log(`[scalex-akis] ${ESKI ? 'ESKI' : 'YENI'} akis; agac: ${KOK}`);
surecler.push(spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort'], { cwd: KOK, stdio: 'ignore' }));
surecler.push(spawn(chromeYolu(), ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profil}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' }));
await hazirOlana(TABAN + '/');
await hazirOlana(`http://127.0.0.1:${CDP_PORT}/json/version`);

const olcumler = [];
const hatalar = [];

async function akis(kurgu, beklenen, tema) {
  const t = await sekme(CDP_PORT, TABAN);
  let tik = 0;
  const etiket = `${kurgu}-${tema}`;
  const tikla = async (sel, zorunlu = true) => {
    const oldu = await t.tikla(sel);
    if (oldu) tik++;
    else if (zorunlu) throw new Error(`tiklanamadi: ${sel}`);
    return oldu;
  };
  const yaz = (secici, deger) =>
    t.eval(`(() => { const e = document.querySelector(${JSON.stringify(secici)}); if (!e) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(deger)});
      e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const olc = async (adim) => {
    const d = JSON.parse(await t.eval(DENETIM));
    const yukseklik = await t.eval('document.documentElement.scrollHeight');
    // Sihirbaz kartinin yuksekligi: alt paneller haric, adimin KENDI kalabaligi.
    const kart = await t.eval(`(() => { const k = document.querySelector('.card.animate-slide-up'); return k ? Math.round(k.getBoundingClientRect().height) : 0; })()`);
    await t.shot(path.join(CIKTI, `${etiket}-${adim}.png`));
    const konsol = [...new Set(t.konsol.splice(0, t.konsol.length))];
    olcumler.push({ kurgu, tema, adim, tik, yukseklik, kart, konsol, cokme: d.cokme, tasmaX: d.tasmaX, kontrast: d.kontrast, etiketsizGirdi: d.etiketsizGirdi, adsizDugme: d.adsizDugme, hamJson: d.hamJson });
    return d;
  };
  try {
    await t.ac('/scalex', { tema, mod: 'bos', ozel: { ...kurguYanitlari(kurgu), ...ORTAK }, bekle: 3200 });
    await olc('1-kapsam');
    await tikla('text=prod');
    await tikla('text=t1');
    await tikla('text=c1');
    await tikla('text=Devam');
    await olc('2-namespace');
    await tikla('text=odeme');
    await tikla('text=Devam');
    await sleep(1200); // katalog
    await olc('3-uygulamalar-katalog');
    await tikla('text=api');
    await tikla('text=Kontrol et');
    await sleep(2800); // secilenlerin canli durumu (kesif isi + yoklama)
    await olc('3-uygulamalar-canli');
    await tikla('text=Devam');
    await olc('4-islem-bos');
    await tikla('text=Replica sayısını 0 yapar');
    await tikla('text=Değişiklik gerçekten yapılır');
    if (ESKI) {
      await olc('4-islem-secili');
      await tikla('text=Önizle');
    }
    await sleep(1200);
    const d = await olc('5-onay');
    const metin = await t.eval('document.body.innerText');
    if (!ESKI && kurgu === 'engel_smart_tanimsiz') {
      if (!/Bu işlem şu an başlatılamaz/.test(metin)) hatalar.push(`${etiket}: engel kutusu gorunmuyor`);
      if (await t.eval(`!!document.querySelector('#scalex-oco')`)) hatalar.push(`${etiket}: engelliyken OCO numarasi isteniyor`);
    }
    if (d.cokme) hatalar.push(`${etiket}: sayfa coktu`);
    if (beklenen) {
      if (!(await yaz('#scalex-oco', '1234567'))) throw new Error('OCO alani yok');
      await sleep(300);
      await tikla('text=Çalıştır');
      await sleep(1500);
      await olc('6-sonuc');
      const son = await t.eval('document.body.innerText');
      if (!son.includes(beklenen)) hatalar.push(`${etiket}: sonuc ekraninda "${beklenen}" yok`);
      if (/İşlem başlatılmadı/.test(son)) hatalar.push(`${etiket}: "Islem baslatilmadi" yaziyor`);
    }
    // ALT PANELLER (2026-10-14): Admin'de zamanlama paneli sayfanin TAMAMINI dusurmustu.
    // Ikisi de acilir; zamanlanan kaydin NE oldugu yazmali, hicbiri "cizilemedi" dememeli.
    // Sonda yeniden kapatilir: acik/kapali tercihi profilde kalir, sonraki kurgularin
    // sayfa yuksekligi olcumleri degismesin.
    await tikla('text=Zamanlanmış işlemler');
    await tikla('text=Şu an durdurulmuş');
    await sleep(700);
    await olc('7-paneller');
    const panel = await t.eval('document.body.innerText');
    if (!/Durdur · c1 \/ odeme · 1 uygulama/.test(panel)) hatalar.push(`${etiket}: zamanlanan kaydin kapsami yazmiyor`);
    if (/Bu panel çizilemedi/.test(panel)) hatalar.push(`${etiket}: bir alt panel cizilemedi`);
    if (!/rapor/.test(panel)) hatalar.push(`${etiket}: durdurulmus uygulama listede yok`);
    await tikla('text=Zamanlanmış işlemler');
    await tikla('text=Şu an durdurulmuş');
  } catch (e) {
    hatalar.push(`${etiket}: ${e.message}`);
    await t.shot(path.join(CIKTI, `${etiket}-HATA.png`)).catch(() => {});
  }
  await t.kapat();
}

for (const [kurgu, beklenen] of KURGULAR) {
  for (const tema of ['light', 'dark']) await akis(kurgu, beklenen, tema);
}

fs.writeFileSync(path.join(CIKTI, 'rapor.json'), JSON.stringify({ eski: ESKI, olcumler, hatalar }, null, 1));
console.log('\n[scalex-akis] kurgu / tema / adim                          tik  sayfa   kart  bulgu');
for (const o of olcumler) {
  const bulgu = [
    o.tasmaX > 0 ? `tasma ${o.tasmaX}px` : '',
    o.kontrast.length ? `kontrast<3: ${o.kontrast.map((k) => `${k.o} ${k.e.slice(0, 60)}`).join(' ; ')}` : '',
    o.etiketsizGirdi.length ? `etiketsiz girdi ${o.etiketsizGirdi.length}` : '',
    o.adsizDugme.length ? `adsiz dugme ${o.adsizDugme.length}` : '',
    o.hamJson ? 'ham JSON' : '',
    o.konsol.length ? `konsol: ${o.konsol.join(' | ').slice(0, 160)}` : '',
  ].filter(Boolean).join(' | ');
  console.log(`  ${`${o.kurgu} ${o.tema} ${o.adim}`.padEnd(52)} ${String(o.tik).padStart(3)} ${String(o.yukseklik).padStart(6)} ${String(o.kart).padStart(6)}  ${bulgu}`);
}
console.log(`\n[scalex-akis] ${olcumler.length} olcum, ${hatalar.length} akis hatasi${hatalar.length ? ':\n  ' + hatalar.join('\n  ') : ''}`);
console.log(`[scalex-akis] Ayrinti ve ekran goruntuleri: ${CIKTI}`);

kapat();
try {
  fs.rmSync(profil, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
} catch {
  /* gecici dizin isletim sistemine kalir */
}
process.exit(hatalar.length ? 1 : 0);
