// server/logx/v2/__tests__/admin-ekranlari.test.cjs
//
// YAZILMIS AMA HIC CAGRILMAYAN UCLAR — UC TANE.
//
// Uculerinin de sunucu tarafi tamdi: tablo, CRUD, dogrulama, hatta grup
// grant'larinda `restrictions.cjs` mantigi ve mask kurallarinda her mutasyondan
// sonra `masker.reloadMaskRules()`. Eksik olan TEK sey ekrandi.
//
// Sunucudaki not, grup grant'lari icin durumu birebir anlatiyordu:
// *"yetki bir AD grubuna verilebiliyor GIBI gorunuyor, ama portal uzerinden
// verilmesinin bir yolu YOKTU — ozellik bastan sona olu kodu."* Route'lar
// sonradan eklendi, ON YUZ yarisi hala oluydu.
//
// BU TUR SUNUCUYA DOKUNMAZ (bekci AE7).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const oku = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const kodOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function dilim(src, bas, son) {
  const i = src.indexOf(bas);
  assert.ok(i >= 0, `dilim baslangici yok: ${bas}`);
  const j = src.indexOf(son, i + bas.length);
  assert.ok(j > i, `dilim sonu yok: ${son}`);
  return src.slice(i, j);
}

const TAB = () => kodOnly(oku('src/components/admin/tabs/LogXv2AdminTab.tsx'));
const API = () => kodOnly(oku('src/api/logxV2Api.ts'));

test('AE1 grup grant`lari EKRANDAN verilebiliyor ve silinebiliyor', () => {
  const api = API();
  assert.match(api, /addGroupGrant:/, 'istemci sarmalayicisi yok');
  assert.match(api, /removeGroupGrant:/, 'istemci sarmalayicisi yok');
  const t = TAB();
  assert.match(t, /logxV2Api\.admin\.addGroupGrant\(/, 'ekran grup grant EKLEYEMIYOR');
  assert.match(t, /logxV2Api\.admin\.removeGroupGrant\(/, 'ekran grup grant SILEMIYOR');
  assert.match(t, /r\.groupGrants/, 'mevcut grup grant`lari listelenmiyor');
});

test('AE2 grup DN`i GOVDEDE gider, yol parametresinde DEGIL', () => {
  // Bir AD DN'i virgul, esittir ve bosluk icerir; URL'e komak hem kacis
  // sorunlari cikarir hem de grup adlarini erisim loglarina yazardi.
  const api = API();
  const d = dilim(api, 'removeGroupGrant:', 'listMaskRules:');
  assert.match(d, /\{\s*groupDn\s*\}/, 'DN govdede gonderilmiyor');
  assert.doesNotMatch(
    d,
    /group-grants\/\$\{/,
    'DN yol parametresine konulmus — kacis sorunu + erisim loglarinda grup adi',
  );
});

test('AE3 maskeleme kurallari CRUD`u ekrana bagli', () => {
  const api = API();
  for (const m of ['listMaskRules:', 'createMaskRule:', 'updateMaskRule:', 'deleteMaskRule:']) {
    assert.ok(api.includes(m), `${m} istemcide yok`);
  }
  const t = TAB();
  assert.match(t, /MaskRulesSection/, 'maskeleme bolumu yok');
  assert.match(t, /subTab === 'maskrules'/, 'maskeleme alt sekmesi render edilmiyor');
});

test('AE4 maskelemenin GERCEK KAPSAMI ekranda soyleniyor (yanlis guvence yok)', () => {
  // Kurallar bugun YALNIZCA AI analiz yolunda uygulaniyor; indirilen arsive
  // uygulanmiyor. Bunu yazmazsak admin "maskeleme var" sanip yanlis bir
  // guvence hisseder — bu depoda en pahali hata sinifi.
  const ham = oku('src/components/admin/tabs/LogXv2AdminTab.tsx');
  const d = dilim(ham, 'const MaskRulesSection', 'const SURUYOR');
  assert.match(d, /yalnızca AI analiz yolunda/i, 'maskelemenin sinirli kapsami soylenmiyor');
  assert.match(d, /uygulanmıyor/i, 'indirilen arsive uygulanmadigi soylenmiyor');

  // Ve iddia DOGRU olmali: teslim yolu gercekten maskelemiyor.
  const dl = kodOnly(oku('server/logx/v2/downloads.cjs'));
  assert.doesNotMatch(dl, /maskLines/, 'teslim yolu artik maskeliyor — ekrandaki uyari YANLIS oldu');
});

test('AE5 istek izleme ekrani uca bagli', () => {
  const t = TAB();
  assert.match(t, /logxV2Api\.admin\.listRequests\(/, 'istek izleme ucu hala cagrilmiyor');
  assert.match(t, /subTab === 'requests'/, 'istek izleme alt sekmesi render edilmiyor');
  assert.match(t, /TableEmptyRow/, 'bos durum ortak bilesenle anlatilmiyor');
});

test('AE6 OCO zamanlama paneli NE zamanlandigini gosterir', () => {
  const ham = oku('src/components/scalex/OcoSchedulePanel.tsx');
  const k = kodOnly(ham);
  assert.match(k, /kapsamCoz/, 'zamanlanan isin kapsami hic cozulmuyor');
  assert.match(k, /pendingLaunch\?\.detail/, 'kapsam kaynagi okunmuyor');
  // BOS LISTEDE SESSIZ KALMAMALI.
  assert.doesNotMatch(
    k,
    /if \(!items\.length && !error\) return null;/,
    'bos listede panel hic cizilmiyor — "zamanlanmis isim var miydi" cevapsiz kalir',
  );
  // Bozuk JSON panelin tamamini dusurmemeli.
  const d = dilim(k, 'function kapsamCoz', 'const DURUM_ETIKET');
  assert.match(d, /catch/, 'bozuk detail panelin tamamini dusurur');
});

test('AE7 SUNUCUYA DOKUNULMADI', () => {
  const s = kodOnly(oku('server/logx/v2/index.cjs'));
  // Uc route da yerinde ve requireAdmin ile korunuyor.
  for (const yol of ['/admin/mask-rules', '/admin/requests', '/admin/restrictions/:id/group-grants']) {
    assert.ok(s.includes(`'${yol}'`), `${yol} kaybolmus`);
  }
  const mask = dilim(s, "'/admin/mask-rules',", 'asyncRoute');
  assert.match(mask, /requireAdmin/, 'mask-rules admin kapisini kaybetmis');
});
