// server/ansible/__tests__/ocp-permissions.test.cjs — OCP YETKI BELGESI GUNCEL MI?
//
// NEDEN VAR: `docs/OCP-YETKILERI.yaml`, platform ekibinden `uxmid` icin yetki
// talep ederken kullanilan TEK kaynaktir. Playbook'a yeni bir `oc` komutu ekleyip
// belgeyi guncellemeyi unutmak, eksikligi URETIME tasir: is yarida kalir ve
// belirti neredeyse her zaman YANILTICIDIR —
//
//   pods/log yoksa   -> arsiv URETILIR ama dosyalar BOS ("basarili" gorunur)
//   hpa patch yoksa  -> ScaleX durdurur, HPA saniyeler icinde GERI OLCEKLER
//   projects yoksa   -> "namespace bulunamadi" (yetki hatasi DEGIL gibi gorunur)
//
// Talep-onay dongusu gunler surdugu icin bedeli kullanici oder. Bu yuzden
// "belgeyi guncelleyin" bir RICA degil, KAPIDIR: bu bekci playbook'lari tarar ve
// belgede YAZMAYAN bir `oc` alt komutu bulursa kirmiziya doner.
//
// OLCUT BELGENIN BICIMI DEGIL ICERIGI: yalnizca "her alt komut belgede geciyor mu"
// sorulur. Belgenin duzeni serbestce degistirilebilir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { AWX_TREE, LOCAL_PLAYBOOKS } = require('../paths.cjs');
const ROOT = path.join(__dirname, '..', '..', '..');
const DOC = path.join(ROOT, 'docs', 'OCP-YETKILERI.yaml');

/** Playbook agaclarindaki TUM dosyalar (YAML + shell + jinja). */
function scanFiles() {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      // ScaleX'in is mantigi bir SHELL BETIGINDE yasiyor (scalex_runner.sh) —
      // yalnizca .yml taramak `oc patch`/`oc create`/`oc auth can-i` komutlarinin
      // TAMAMINI kacirirdi. Bu bekcinin ilk taslaginda tam olarak bu oldu.
      else if (/\.(yml|yaml|sh|j2)$/.test(e.name)) out.push(f);
    }
  };
  walk(AWX_TREE);
  walk(LOCAL_PLAYBOOKS);
  // Ansible deposuna elden tasinan dosyalar da AWX'te kosar.
  walk(path.join(ROOT, 'transfer'));
  return out.sort();
}

// Yorum satirlari elenir: aciklamalarda "oc login patladi" gibi cumleler geciyor
// ve bunlari komut saymak bekciyi gurultuye bogar.
const codeLines = (src) => src.split('\n').filter((l) => !/^\s*(#|\/\/)/.test(l));

/**
 * Bir satirdaki `oc <alt-komut>` cagrisini bulur.
 * `{{ oc_bin }}`, `{{ oc_binary }}` ve duz `oc` yazimlarini kapsar.
 */
function ocSubcommand(line) {
  const m = line.match(
    /(?:"?\{\{\s*oc_b\w+\s*\}\}"?|(?:^|[\s;&|(`$"])oc)\s+(?:-n\s+\S+\s+)?([a-z][a-z0-9-]*)/,
  );
  return m ? m[1] : null;
}

// Komut OLMAYAN eslesmeler. Her biri BILEREK burada; liste kisa tutulur ki
// gercek bir komut yanlislikla susturulmasin.
const KOMUT_DEGIL = new Set([
  'binary', // "oc binary bulunamadi" (gorev adi)
  'paths', // "Probe candidate oc paths" (gorev adi)
  'client', // "oc client ... " (mesaj)
  'bin', // degisken adi
]);

test('OP1 belge VAR ve talep icin gereken bolumleri tasiyor', () => {
  assert.ok(fs.existsSync(DOC), 'docs/OCP-YETKILERI.yaml YOK');
  const doc = fs.readFileSync(DOC, 'utf8');
  for (const bolum of [
    'komutlar:',
    'talep_edilecek_roller:',
    'eksiklik_belirtileri:',
    'degisiklik_gunlugu:',
  ]) {
    assert.match(doc, new RegExp(`^${bolum}`, 'm'), `belgede "${bolum}" bolumu yok`);
  }
  // GUNCELLEME ZORUNLULUGU belgenin KENDISINDE yazili olmali; bekciyi gorup
  // belgeyi acan kisi kurali orada bulmali.
  assert.match(doc, /GUNCELLEME ZORUNLUDUR/, 'belge kendi guncelleme kuralini yazmiyor');
});

test("OP2 playbook'lardaki HER `oc` alt komutu belgede yazili", () => {
  const doc = fs.readFileSync(DOC, 'utf8');
  const files = scanFiles();

  // Toplayici yanlis dizine bakarsa bekci bos kumeyle sessizce yesil kalmasin.
  assert.ok(files.length >= 30, `yalnizca ${files.length} dosya tarandi — toplayici bozuk`);

  const bulunan = new Map(); // alt komut -> ilk goruldugu yer
  for (const f of files) {
    codeLines(fs.readFileSync(f, 'utf8')).forEach((l, i) => {
      const sub = ocSubcommand(l);
      if (!sub || KOMUT_DEGIL.has(sub)) return;
      if (!bulunan.has(sub)) bulunan.set(sub, `${path.relative(ROOT, f)}:${i + 1}`);
    });
  }

  // ScaleX shell betigi taranmazsa bu komutlar HIC gorunmez — alt sinir olarak
  // birkac tanesi acikca beklenir (bkz. scanFiles notu).
  for (const beklenen of ['patch', 'logs', 'exec', 'login', 'get']) {
    assert.ok(bulunan.has(beklenen), `"oc ${beklenen}" hic bulunamadi — toplayici bozuk`);
  }

  const eksik = [...bulunan.entries()].filter(([sub]) => !new RegExp(`\\b${sub}\\b`).test(doc));
  assert.deepEqual(
    eksik.map(([sub, yer]) => `oc ${sub}  (${yer})`),
    [],
    "Playbook'ta kullanilan ama docs/OCP-YETKILERI.yaml'da BELGELENMEMIS komut(lar):\n" +
      eksik.map(([sub, yer]) => `  oc ${sub}  -> ${yer}`).join('\n') +
      '\n\nBu belge platform ekibinden yetki isterken kullanilan TEK kaynaktir.\n' +
      'Eksik birakilan bir komut, yetki talebine GIRMEZ ve uretimde cogu zaman\n' +
      'YANILTICI bir belirtiyle ortaya cikar (bos arsiv, geri olceklenen uygulama,\n' +
      '"namespace bulunamadi"). Komutu `komutlar:` altina ekleyin; yetki\n' +
      'GENISLIYORSA `degisiklik_gunlugu:`na da satir yazin.',
  );
});

test('OP3 belgede TANIMLI ama artik KULLANILMAYAN komut yok (belge sismesin)', () => {
  // Ters yon: kaldirilan bir komut belgede kalirsa gereksiz yetki talep edilir.
  // Bu bir UYARIDIR, sertlik derecesi dusuk tutuldu: `login`/`logout`/`version`
  // gibi her zaman gecerli olanlar ve bilesik basliklar disarida birakilir.
  const doc = fs.readFileSync(DOC, 'utf8');
  const belgelenen = [...doc.matchAll(/^\s*-\s+alt_komut:\s*"?([a-z][a-z0-9 -]*?)"?\s*$/gm)]
    .map((m) => m[1].trim())
    .filter((s) => !s.includes(' ') && !s.includes('/'));

  assert.ok(belgelenen.length >= 10, `belgede yalnizca ${belgelenen.length} alt komut var`);

  const files = scanFiles();
  const kullanilan = new Set();
  for (const f of files) {
    for (const l of codeLines(fs.readFileSync(f, 'utf8'))) {
      const sub = ocSubcommand(l);
      if (sub) kullanilan.add(sub);
    }
  }
  // Kimlik/tani komutlari her kurulumda gecerli; kullanimdan dusse de belgede kalir.
  const HER_ZAMAN = new Set(['login', 'logout', 'version', 'whoami', 'project']);
  const olu = belgelenen.filter((s) => !kullanilan.has(s) && !HER_ZAMAN.has(s));
  assert.deepEqual(
    olu,
    [],
    "Belgede duran ama hicbir playbook'ta KULLANILMAYAN komut(lar): " +
      olu.join(', ') +
      '\nGereksiz yetki talep edilmesine yol acar; belgeden cikarin.',
  );
});
