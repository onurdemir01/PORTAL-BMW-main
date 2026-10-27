// src/components/nginx_console/__tests__/yuk-testi-erisim.test.cjs — Nginx Hub "Yük Testi" sekme kaydi bekcisi
// (2026-10-27, RVP-9 / RVP-10 deseni).
//
// Sekme bes yerde birden kayitli olmali; biri eksikse ya herkese acilir (canSee kayitsiz anahtarda ACIK doner) ya
// da Admin ekranindan hic yetkilendirilemez. YTE-6: HAR dosyasi tarayicidan CIKMAZ - sunucuya giden govdede
// dosya metni / adi yok, ayristirici ag cagrisi yapmaz.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KOK = path.join(__dirname, '..', '..', '..', '..');
const oku = (...p) => fs.readFileSync(path.join(KOK, ...p), 'utf8');
const NGINX = ['src', 'components', 'nginx_console'];
/** `bas` ile baslayan blogu `son`a kadar keser (bulunamazsa bekci KIRMIZI). */
function blok(metin, bas, son, ad) {
  const i = metin.indexOf(bas);
  assert.ok(i >= 0, `${ad}: '${bas}' bulunamadi`);
  const j = metin.indexOf(son, i + bas.length);
  assert.ok(j > i, `${ad}: blok sonu '${son}' bulunamadi`);
  return metin.slice(i, j);
}

test('YTE-1 sayfa: Tab birlesimi, TABS, HUB_TABS, kaynak notu ve gorunurluk kapisi', () => {
  const page = oku(...NGINX, 'NginxConsolePage.tsx');
  const tabTipi = page.split('\n').find((s) => s.startsWith('type Tab = '));
  assert.ok(tabTipi && tabTipi.includes("'yuktesti'"), 'Tab birlesiminde yuktesti yok');
  const tabs = page.split('\n').find((s) => s.startsWith('const TABS: readonly Tab[] = ['));
  assert.ok(tabs && tabs.includes("'yuktesti'"), 'TABS dizisinde yuktesti yok (?tab=yuktesti baglantisi Dashboard\'a duser)');
  assert.ok(blok(page, 'const HUB_TABS = [', '] as const;', 'HUB_TABS').includes("{ id: 'yuktesti', label: 'Yük Testi', icon: "), 'HUB_TABS kaydi yok');
  assert.ok(
    page.includes("{tab === 'yuktesti' && canSee('tab:nginx:yuktesti') && <YukTestiTab isAdmin={isAdmin} />}"),
    'sekme icerigi gorunurluk kapisindan gecmiyor ya da isAdmin verilmiyor',
  );
  assert.ok(blok(page, 'const SOURCE_OF: Record<Tab, SourceKey> = {', '};', 'SOURCE_OF').includes("yuktesti: 'yuktesti'"), 'SOURCE_OF kaydi yok ya da baska kaynaga bagli');
  assert.ok(page.includes("import { YukTestiTab } from './YukTestiTab';"), 'YukTestiTab ice aktarilmiyor');
});

test('YTE-2 sunucu: NGINX_TAB_KEYS ve DB seed (varsayilan KAPALI, ebeveyn NginxConsole)', () => {
  const vis = oku('server', 'auth', 'visibility-routes.cjs');
  assert.ok(blok(vis, 'const NGINX_TAB_KEYS = [', '];', 'NGINX_TAB_KEYS').includes("'yuktesti'"), "NGINX_TAB_KEYS'te yok - Admin ekranindan YETKILENDIRILEMEZ");
  const db = oku('server', 'db', 'mssql-setup.cjs');
  const j = db.indexOf("element_key: 'tab:nginx:yuktesti',");
  assert.ok(j > 0, 'DB seed kaydi yok');
  const kayit = db.slice(j, j + 300);
  assert.ok(kayit.includes("parent_key: 'NginxConsole'"), 'seed parent yanlis');
  assert.ok(kayit.includes('default_visible: 0'), 'seed varsayilani ACIK');
  assert.ok(blok(db, 'const NGINX_TAB_KEYS_SEED = [', '];', 'NGINX_TAB_KEYS_SEED').includes("'yuktesti'"), "NGINX_TAB_KEYS_SEED'te yok");
});

test('YTE-3 kaynak notu: kendi kaynak anahtari; var olan bir AWX isini sahiplenmez', () => {
  const note = oku(...NGINX, 'SourceNote.tsx');
  const tip = note.split('\n').find((s) => s.startsWith('export type SourceKey = '));
  assert.ok(tip && tip.includes("'yuktesti'"), 'SourceKey birlesiminde yuktesti yok');
  const kaynaklar = blok(note, 'const SOURCES: Record<SourceKey', '\n};', 'SOURCES');
  const yuk = blok(kaynaklar, 'yuktesti: {', '},', 'yuktesti kaynagi');
  // Diger kaynaklarin is adlari (nginx_console_fetch, nginx_audit, nginx_cis, ...) bu notta GECMEZ.
  const digerIsler = [...kaynaklar.replace(yuk, '').matchAll(/job: '([^']+)'/g)]
    .flatMap((m) => m[1].split(/[^a-z_]+/))
    .filter((x) => /^[a-z]+_[a-z_]+$/.test(x));
  assert.ok(digerIsler.length >= 6, `diger kaynaklarin is adlari okunamadi: ${digerIsler.join(',')}`);
  for (const ad of digerIsler) assert.ok(!yuk.includes(ad), `yuktesti notu var olan '${ad}' isini sahipleniyor`);
  assert.match(yuk, /job: '[^']*nginx_loadtest/, 'notta yuk testi playbook\'u yazmiyor');
  assert.match(yuk, /Zamanlanmış tarama yok/, 'notta verinin zamanlanmis taramadan gelmedigi yazmiyor');
});

test('YTE-4 Admin > Nginx Hub Erişimi etiketi', () => {
  const t = oku('src', 'components', 'admin', 'tabs', 'NginxAccessTab.tsx');
  assert.ok(blok(t, 'const TAB_LABELS: Record<string, string> = {', '};', 'TAB_LABELS').includes("yuktesti: 'Yük Testi',"), 'TAB_LABELS kaydi yok (panelde ham anahtar gorunur)');
});

test('YTE-5 Admin olmayan icin is baslatan / silen dugme cizilmez', () => {
  const tab = oku(...NGINX, 'YukTestiTab.tsx');
  assert.ok(tab.includes("{ id: 'yeni', ad: 'Yeni koşu', ikon: PlayCircleIcon, yalnizAdmin: true }"), "'Yeni koşu' yalniz Admin isaretli degil");
  assert.ok(tab.includes("{etkin === 'yeni' && isAdmin && <YeniKosu"), "'Yeni koşu' govdesi isAdmin kapisindan gecmiyor");
  const ayr = oku(...NGINX, 'yukTesti', 'KosuAyrinti.tsx');
  // Durdur / "Kalan süreçleri durdur" ve "Sonucu yeniden oku" (2026-10-27) ayni Admin kapisindan; baska yerde cizilmez.
  assert.ok(ayr.includes('{isAdmin && (aktif || kalanDurdur) && ('), 'Durdur dugmesi isAdmin kapisindan gecmiyor');
  assert.ok(ayr.includes('{isAdmin && yenidenOku && ('), "'Sonucu yeniden oku' dugmesi isAdmin kapisindan gecmiyor");
  assert.equal(ayr.split('onClick={() => setDurdurSor(true)}').length - 1, 1, 'Durdur penceresini acan ikinci (kapisiz) bir dugme var');
  assert.equal(ayr.split('onClick={() => void yenidenOkut()}').length - 1, 1, "'Sonucu yeniden oku' ucunu cagiran ikinci (kapisiz) bir dugme var");
  assert.ok(ayr.includes("...(isAdmin ? ['cikti' as const] : []),"), 'İş çıktısı sekmesi (Admin ucu /durum) herkese aciliyor');
  const sen = oku(...NGINX, 'yukTesti', 'Senaryolar.tsx');
  assert.ok(sen.includes('{isAdmin && yeniAcik && <YeniSenaryo'), 'Yeni senaryo paneli isAdmin kapisindan gecmiyor');
  assert.ok(sen.includes('{isAdmin && <button type="button" onClick={() => setSilinecek(s)}'), 'Sil dugmesi isAdmin kapisindan gecmiyor');
});

test('YTE-6 HAR tarayicidan cikmaz: sunucuya yalniz yol satirlari, ayristirici ag kullanmaz', () => {
  const har = oku(...NGINX, 'yukTesti', 'harSenaryo.ts');
  for (const kotu of ['fetch(', 'XMLHttpRequest', 'navigator.sendBeacon', "from '@/api"]) assert.ok(!har.includes(kotu), `harSenaryo.ts ag kullaniyor: ${kotu}`);
  const api = oku('src', 'api', 'nginxLoadtestApi.ts');
  for (const kotu of ['FormData', 'multipart', 'Blob(']) assert.ok(!api.includes(kotu), `API dosya yukluyor: ${kotu}`);
  const sen = oku(...NGINX, 'yukTesti', 'Senaryolar.tsx');
  // kaydet(): OZET hazirligi + POST govdesi (yanit denetimine kadar).
  const govde = blok(sen, 'async function kaydet() {', 'if (!r.ok) { setKayitHata(', 'kaydet()');
  assert.ok(govde.includes('nginxLoadtestApi.senaryoKaydet({'), 'kaydet() senaryoKaydet cagirmiyor (blok yanlis yerde)');
  for (const kotu of ['metin', 'dosya', '.ad,', 'ozetMetni']) assert.ok(!govde.includes(kotu), `senaryo govdesinde HAR izi: ${kotu}`);
  assert.ok(govde.includes('satirlar: satirlar.map((s) => ({ agirlik: s.agirlik, har: s.har, tur: s.tur, boyut: s.boyut, yol: s.yol }))'), 'satirlar alan alan secilmiyor');
  assert.ok(govde.includes('gonderilecekOzet(harSonuc.r.ozet)'), 'OZET dosya adlarindan arindirilmadan gidiyor');
});
