#!/usr/bin/env node
// scripts/ui-tarama/tarama.mjs — portalin sayfalarini GERCEK tarayicida tarar ve raporlar.
//
// Kullanim:   npm run ui:tarama                     (tum sayfalar, iki durum, uc gorunum)
//             npm run ui:tarama -- --sayfa /telnet  (tek sayfa)
//             npm run ui:tarama -- --cikti /tmp/x   (rapor ve ekran goruntuleri oraya)
//             npm run ui:tarama -- --kati           (bulgu varsa cikis kodu 1)
//
// Ne yapar:  Vite gelistirme sunucusunu ve headless Chrome'u baslatir; her sayfayi
//            "her API bos doner" ve "her API 500 doner" durumlarinda, acik/koyu temada acar.
//            Olctukleri: sayfa coktu mu, yatay tasma, 3:1 altinda kontrast, etiketsiz girdi,
//            adsiz dugme, ekrana basilan ham JSON, konsol hatasi. Sihirbazlarda ilk adimi da
//            tiklar (liste API'si dusunce coken adimlar ancak boyle gorunur); Admin'de her
//            sekmeyi gezer.
//
// Ne YAPMAZ: arka uca baglanmaz (yanitlar sahte), CI'da kosmaz, depoya yazmaz.
// Gerekenler: Node 22+, Chrome/Chromium (CHROME_BIN ile yol verilebilir).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sekme, DENETIM, sleep } from './lib.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (ad, varsayilan = null) => {
  const i = process.argv.indexOf(ad);
  return i < 0 ? varsayilan : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true;
};
const VITE_PORT = Number(process.env.UI_TARAMA_VITE_PORT || 5199);
const CDP_PORT = Number(process.env.UI_TARAMA_CDP_PORT || 9333);
const TABAN = `http://127.0.0.1:${VITE_PORT}`;
const CIKTI = path.resolve(String(arg('--cikti', path.join(os.tmpdir(), 'ui-tarama'))));
const KATI = arg('--kati') === true;
const TEK = arg('--sayfa');

// Kapsam: sahibi baska ekipler olan agaclar (nginx-console, server-hub, crypto-hub) burada
// yok; `--sayfa /server-hub` ile yine de taranabilir.
const SAYFALAR = ['/dashboard', '/envanter', '/denetim', '/duty-roster', '/oco-takvimi', '/performance', '/ai-analyst', '/self-service', '/logx', '/scalex', '/filex', '/telnet', '/opsx', '/ansible', '/admin', '/403'];
// Sayfa acildiktan sonra tiklanacak ilk adimlar (her biri ayri bir taramadir).
const ADIMLAR = {
  '/telnet': ['text=Legacy', 'text=Openshift'],
  '/logx': ['text=Legacy', 'text=OpenShift'],
};
const GORUNUMLER = [
  ['light', 1440, 900],
  ['dark', 1440, 900],
  ['light', 1024, 768],
];

function chromeYolu() {
  const adaylar = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const bulunan = adaylar.find((p) => p && fs.existsSync(p));
  if (!bulunan) throw new Error('Chrome bulunamadi. CHROME_BIN ile yolunu verin.');
  return bulunan;
}
async function hazirOlana(url, sn = 60) {
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
function kapat() {
  for (const s of surecler) {
    try {
      s.kill('SIGTERM');
    } catch {
      /* zaten kapali */
    }
  }
}
process.on('exit', kapat);
process.on('SIGINT', () => process.exit(130));

fs.rmSync(CIKTI, { recursive: true, force: true });
fs.mkdirSync(CIKTI, { recursive: true });
const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-tarama-profil-'));

console.log(`[ui-tarama] Vite ${TABAN} ve headless Chrome baslatiliyor...`);
surecler.push(spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort'], { cwd: KOK, stdio: 'ignore' }));
surecler.push(spawn(chromeYolu(), ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profil}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' }));
await hazirOlana(TABAN + '/');
await hazirOlana(`http://127.0.0.1:${CDP_PORT}/json/version`);

const sonuclar = [];
async function olc(t, kayit, dosyaAdi) {
  const d = JSON.parse(await t.eval(DENETIM));
  await t.shot(path.join(CIKTI, dosyaAdi + '.png'));
  // Konsol hatalari OLCUM BASINA sayilir: ayni sekmede ardisik olcum yapilirken (Admin
  // sekmeleri) onceki olcumun hatasi sonrakilere de yazilmasin.
  const yeni = t.konsol.splice(0, t.konsol.length);
  sonuclar.push({ ...kayit, konsol: [...new Set(yeni)].slice(0, 6), ...d });
}
const ad = (s) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');

const sayfalar = typeof TEK === 'string' ? [TEK] : SAYFALAR;
for (const mod of ['bos', 'hata']) {
  for (const yol of sayfalar) {
    for (const [tema, w, h] of GORUNUMLER) {
      const t = await sekme(CDP_PORT, TABAN);
      try {
        await t.ac(yol, { tema, w, h, mod });
        await olc(t, { mod, yol, adim: '', tema, w }, `${mod}-${ad(yol)}-${tema}-${w}`);
      } catch (e) {
        sonuclar.push({ mod, yol, adim: '', tema, w, aracHatasi: e.message });
      }
      await t.kapat();
    }
    // Ilk adimlar: yalnizca acik tema / genis ekranda (amac cokme ve hata metni).
    for (const adim of ADIMLAR[yol] || []) {
      const t = await sekme(CDP_PORT, TABAN);
      try {
        await t.ac(yol, { mod });
        if (await t.tikla(adim)) await olc(t, { mod, yol, adim, tema: 'light', w: 1440 }, `${mod}-${ad(yol)}-${ad(adim)}`);
      } catch (e) {
        sonuclar.push({ mod, yol, adim, tema: 'light', w: 1440, aracHatasi: e.message });
      }
      await t.kapat();
    }
    // Admin: her sekme.
    if (yol === '/admin') {
      const t = await sekme(CDP_PORT, TABAN);
      try {
        await t.ac(yol, { mod, tema: mod === 'bos' ? 'dark' : 'light' });
        const sekmeler = await t.eval(`[...document.querySelectorAll('nav[aria-label="Admin bölümleri"] button')].map((b) => b.textContent.trim())`);
        for (const s of sekmeler) {
          if (!(await t.tikla('text=' + s))) continue;
          await olc(t, { mod, yol, adim: s, tema: mod === 'bos' ? 'dark' : 'light', w: 1440 }, `${mod}-admin-${ad(s)}`);
        }
      } catch (e) {
        sonuclar.push({ mod, yol, adim: 'sekmeler', tema: '-', w: 0, aracHatasi: e.message });
      }
      await t.kapat();
    }
  }
}

fs.writeFileSync(path.join(CIKTI, 'rapor.json'), JSON.stringify(sonuclar, null, 1));

// ── ozet ──────────────────────────────────────────────────────────────────────────────────
const say = { cokme: 0, tasma: 0, kontrast: 0, etiketsiz: 0, adsiz: 0, hamJson: 0, konsol: 0, arac: 0 };
const satirlar = [];
for (const r of sonuclar) {
  const yer = `${r.mod.padEnd(4)} ${(r.yol + (r.adim ? ' > ' + r.adim : '')).padEnd(38)} ${String(r.tema).padEnd(5)} ${String(r.w).padEnd(4)}`;
  if (r.aracHatasi) {
    say.arac++;
    satirlar.push(`${yer}  ARAC HATASI: ${r.aracHatasi.slice(0, 80)}`);
    continue;
  }
  const bulgu = [];
  if (r.cokme) (say.cokme++, bulgu.push('COKME'));
  if (r.tasmaX > 0) (say.tasma++, bulgu.push(`tasma ${r.tasmaX}px`));
  if (r.kontrast.length) ((say.kontrast += r.kontrast.length), bulgu.push(`kontrast<3: ${r.kontrast.map((k) => k.o).join(',')}`));
  if (r.etiketsizGirdi.length) ((say.etiketsiz += r.etiketsizGirdi.length), bulgu.push(`etiketsiz girdi ${r.etiketsizGirdi.length}`));
  if (r.adsizDugme.length) ((say.adsiz += r.adsizDugme.length), bulgu.push(`adsiz dugme ${r.adsizDugme.length}`));
  if (r.hamJson) (say.hamJson++, bulgu.push('ham JSON'));
  if (r.konsol.length) ((say.konsol += r.konsol.length), bulgu.push(`konsol ${r.konsol.length}`));
  if (bulgu.length) satirlar.push(`${yer}  ${bulgu.join(' | ')}`);
}
console.log(`\n[ui-tarama] ${sonuclar.length} olcum. Bulgu olan satirlar:\n` + (satirlar.join('\n') || '  (bulgu yok)'));
console.log(
  `\n[ui-tarama] OZET  cokme=${say.cokme}  tasma=${say.tasma}  kontrast<3=${say.kontrast}  etiketsiz girdi=${say.etiketsiz}  ` +
    `adsiz dugme=${say.adsiz}  ham JSON=${say.hamJson}  konsol hatasi=${say.konsol}  arac hatasi=${say.arac}`,
);
console.log(`[ui-tarama] Ayrinti: ${path.join(CIKTI, 'rapor.json')}  (ekran goruntuleri ayni dizinde)`);

kapat();
// Chrome kapanirken profil dizinine yazmaya devam edebilir; silinemezse arac DUSMEZ.
try {
  fs.rmSync(profil, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
} catch {
  /* gecici dizin isletim sistemine kalir */
}
const bulguVar = say.cokme + say.tasma + say.kontrast + say.hamJson > 0;
process.exit(KATI && bulguVar ? 1 : 0);
