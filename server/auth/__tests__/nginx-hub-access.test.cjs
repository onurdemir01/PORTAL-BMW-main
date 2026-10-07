// server/auth/__tests__/nginx-hub-access.test.cjs — Nginx Hub sekme bazlı erişim (2026-09-23).
//
// Kullanıcı: "Nginx Hub'a da istediğim kullanıcıları sokmak istiyorum ama yine sadece
// istediğim sayfaları görsünler — CIS, SPA, API Envanteri, Envanter, Audit gibi."
//
// Model Denetim ile aynıdır (kullanıcı kararı, 2026-09-23): sayfa da sekmeler de VARSAYILAN
// KAPALI; erişim Admin > "Nginx Hub Erişimi" panelinden sayfa + seçilen sekmeler olarak verilir.
// Varsayılan bir tur ÖNCE 1'di; kapatırken sayfaya zaten erişimi olanlar boş ekran görmesin
// diye tek seferlik migration onlara tüm sekmeleri açar — o migration da burada kilitlidir.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', '..', p), 'utf8');

// GORUNURLUK ELEMANLARI ile RENDER EDILEN SEKMELER AYRISTI (2026-10-08).
//
// 'spa' ve 'spadiscovery' tek sekmede birlesti (NginxSpaBirlesik). Ama `tab:nginx:spa`
// GORUNURLUK ANAHTARI OLARAK YASIYOR: mevcut yetki satirlari ona bagli ve birlesik
// sayfa onu "Kapsam & Tasima" ALT SEKMESI icin okuyor. Seed'den silmek, o yetkiye sahip
// kullanicilarin erisimini sessizce kaldirirdi.
//
// Bu yuzden `TABS` (seed/yetki) ile `RENDER_TABS` (ekranda sekme olarak cizilen) AYRI.
// Ikisini birlestirmek, 'spa' icin var olmayan bir render blogu aramak demekti.
const TABS = [
  'dashboard',
  'instances',
  'config',
  'changes',
  'certs',
  'orphans',
  'drift',
  'cis',
  'spa',
  'api',
  'envanter',
  'audit',
];

// Ekranda SEKME olarak cizilenler: 'spa' artik bir sekme DEGIL (birlesik sayfanin alt
// bolumu). Render kapisi bu liste uzerinden olculur.
const RENDER_TABS = TABS.filter((t) => t !== 'spa');

// SEED ve EKRAN listeleri KAYNAKTAN TURETILIR (2026-10-08). Yukaridaki `TABS` elle
// yazilmis bir KOPYAYDI ve 'spadiscovery' / 'ratelimit' / 'rvpsecim' ONDA HIC YOKTU -
// yani bu bekci uc sekmenin yetki kapisini HIC denetlemiyordu ve kimse farketmedi.
// Kopya yerine kaynak okunur; liste bir daha sessizce ayrisamaz.
/** NGINX_TAB_KEYS dizisinin govdesi — YORUM SATIRLARI ATILMIS halde.
 *
 *  Yorumlardaki Turkce kesme isaretleri (`cjs'de`, `seed'liydi`) `'...'` deseniyle
 *  eslesip ayiklamayi KAYDIRIYORDU: 2026-10-08'de listeye bir aciklama eklendiginde
 *  bekci anahtarlarin yarisini "yok" sandi. Yorum satirlari once silinir. */
function anahtarBloku(src) {
  const m = src.match(/const NGINX_TAB_KEYS = \[([\s\S]*?)\];/);
  assert.ok(m, 'NGINX_TAB_KEYS okunamadi (ad degismis olabilir)');
  return m[1]
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

function seedKeys() {
  const blk = anahtarBloku(read('server/auth/visibility-routes.cjs'));
  return [...blk.matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
function uiTabs() {
  const src = read('src/components/nginx_console/NginxConsolePage.tsx');
  const m = src.match(/const TABS: readonly Tab\[\] = \[([\s\S]*?)\];/);
  assert.ok(m, 'NginxConsolePage TABS okunamadi');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('NH-A1 seed: her sekme element olarak kayıtlı, parent NginxConsole, varsayılan KAPALI', () => {
  const src = read('server/db/mssql-setup.cjs');
  for (const t of TABS) {
    const i = src.indexOf(`element_key: 'tab:nginx:${t}',`);
    assert.ok(i > 0, `tab:nginx:${t} seed yok`);
    const blk = src.slice(i, i + 300);
    assert.ok(blk.includes("parent_key: 'NginxConsole'"), `tab:nginx:${t} parent yanlış`);
    assert.ok(
      blk.includes('default_visible: 0'),
      `tab:nginx:${t} varsayılanı AÇIK — sayfayı gören herkes tüm sekmeleri görür`,
    );
  }
  assert.ok(src.includes("element_key: 'admintab:nginxaccess'"), 'admin sekmesi seed yok');
  // Kapatma turunda mevcut erisim sahipleri bos ekranda kalmasin: tek seferlik migration.
  assert.ok(
    src.includes('migration:nginx-hub-tabs-default-closed-2026-09-23'),
    'kapatma migration isareti yok',
  );
  assert.ok(
    /WHERE element_key = 'NginxConsole' AND allow = 1 AND principal_type IN \('user', 'group'\)/.test(
      src,
    ),
    'migration mevcut erisim sahiplerini bulmuyor',
  );
  assert.ok(
    read('src/config/elements.ts').includes(
      "{ id: 'admintab:nginxaccess', label: 'Nginx Hub Erişimi' }",
    ),
    'elements.ts admintab kaydı yok',
  );
});

test('NH-A2 panel uçları: sayfaya + seçilen sekmelere allow yazılır (seçilmeyene kural yok)', () => {
  const routes = read('server/auth/visibility-routes.cjs');
  // TIRNAK TURU IDDIANIN KONUSU DEGIL: bicimlendirici (prettier) cift tirnagi tek
  // tirnaga cevirince bu bekci YANLIS SEBEPLE kirmiziya donuyordu. Iddia ayni:
  // uc VAR ve requireAdmin ile korunuyor.
  for (const m of ['get', 'put', 'delete']) {
    assert.match(
      routes,
      new RegExp(`router\\.${m}\\(['"]\\/nginx-access['"], requireAdmin`),
      `uç yok ya da admin kapısız: ${m} /nginx-access`,
    );
  }
  // Tirnak turu degisebilir (prettier).
  const i = routes.search(/router\.put\(['"]\/nginx-access['"]/);
  // BOSLUKLARI NORMALLE: prettier ucl_u ifadeyi satirlara boluyor; iddia bicim degil,
  // "secilmeyen sekmeye kural YAZILMAZ" kurali.
  const blk = routes.slice(i, i + 2500).replace(/\s+/g, ' ');
  assert.ok(
    blk.includes("const allow = key === 'NginxConsole' ? true : want.includes(tab);"),
    'seçim kuralı yok',
  );
  // Parantez istege bagli: prettier disaridaki parantezleri kaldiriyor.
  assert.match(
    blk,
    /\(?key === 'NginxConsole' \|\| allow\)? \? \[\{ principalType: pt, principalId: pid, allow: true \}\] : \[\]/,
    'seçilmeyen sekmeye kural yazılmamalı (varsayılan kapalı)',
  );
  // DILIM KAPANIS `];`E KADAR. Once SABIT 400 karakterdi; listeye bir yorum eklenince
  // sonraki girdiler pencerenin DISINA tasiyor ve test "sekme listede yok" diye
  // dusuyordu (2026-10-08). Bekci, kaynaktaki bicimlendirmeye degil YAPIYA bakmali.
  const tabKeysBlk = anahtarBloku(routes);
  for (const t of TABS)
    assert.ok(
      new RegExp(`'${t}'`).test(tabKeysBlk),
      `NGINX_TAB_KEYS içinde ${t} yok`,
    );

  // GELEN SEKME LISTESI BEYAZ LISTEYE SUZULMELI. Suzgec olmadan govdede gonderilen
  // herhangi bir dizge element anahtari gibi islenir ve ona allow kurali yazilir -
  // yani panel, kendi listesinde olmayan ogelere yetki verebilir hale gelir.
  // (Mutasyon testinde bu suzgeci kaldirmak HICBIR bekciyi dusurmuyordu, 2026-10-08.)
  assert.match(
    routes,
    /\.filter\(\(t\) =>\s*NGINX_TAB_KEYS\.includes\(t\),?\s*\)/,
    'panel ucu gelen sekme listesini NGINX_TAB_KEYS ile süzmüyor',
  );
  // 'all' de AYNI listeye genisler: beyaz listeyi atlayan bir kisayol olmamali.
  assert.match(
    routes,
    /tabs === 'all'\s*\?\s*NGINX_TAB_KEYS/,
    "'all' seçimi NGINX_TAB_KEYS dışına genişliyor",
  );
});

test('NH-A3 sunucu kapıları: uçlar sayfa + sekme kapısından geçer', () => {
  const con = read('server/nginx-console/index.cjs');
  assert.ok(con.includes("requireVisiblePrefix('NginxConsole')"), 'sayfa kapısı yok');
  assert.ok(con.includes("requireVisible('tab:nginx:' + hit[1])"), 'sekme kapısı yok');
  for (const t of ['config', 'certs', 'changes', 'orphans', 'drift']) {
    assert.ok(new RegExp(`'${t}'\\]`).test(con), `yol eşlemesinde ${t} yok`);
  }
  // /hosts BİLEREK sayfa kapısında: dashboard/instances/config aynı listeyi okur.
  assert.ok(!/\^\\\/hosts/.test(con), '/hosts bir sekmeye bağlanmış — diğer sekmeler kırılır');

  const cis = read('server/nginx-cis/index.cjs');
  assert.ok(cis.includes("requireVisible('tab:nginx:cis')"), 'CIS uçları sekme kapısında değil');

  const den = read('server/audit/denetim.cjs');
  assert.ok(
    den.includes("requireVisible('tab:nginx:' + nx[1])"),
    'denetim nginx yolları sekme kapısında değil',
  );
  for (const t of ['spa', 'api', 'envanter', 'audit']) {
    assert.ok(new RegExp(`'${t}'\\]`).test(den), `denetim yol eşlemesinde ${t} yok`);
  }
});

test('NH-A4 istemci: sekmeler canSee ile süzülür, içerik de kapalı, boş durumda mesaj', () => {
  const page = read('src/components/nginx_console/NginxConsolePage.tsx');
  assert.ok(
    page.includes('HUB_TABS.filter((x) => canSee(`tab:nginx:${x.id}`))'),
    'üst sekme grubu süzülmüyor',
  );
  // DENETIM GRUBU (2026-10-08 birlesmesinden sonra): 'spa' ve 'spadiscovery' tek sekmede
  // birlesti ve giris IKI anahtardan BIRIYLE acilir. Suzgec artik tek satir degil, ama
  // YETKIYE DAYANMA sarti aynen durur; asagida hem suzgecin hem icerigin iki anahtari da
  // adiyla andigi olculur. Suzgeci tamamen kaldiran bir degisiklik buradan GECEMEZ.
  assert.ok(
    /HUB_AUDIT_TABS\.filter\(\(x\) =>[\s\S]{0,260}canSee\(`tab:nginx:\$\{x\.id\}`\)/.test(page),
    'denetim sekme grubu canSee ile süzülmüyor',
  );
  assert.ok(
    /HUB_AUDIT_TABS\.filter\(\(x\) =>[\s\S]{0,260}canSee\('tab:nginx:spadiscovery'\)[\s\S]{0,80}canSee\('tab:nginx:spa'\)/.test(page),
    'birleşik sekme iki görünürlük anahtarından birini okumuyor',
  );
  // İçerik de kapalı olmalı: görünmeyen sekmenin bileşeni render EDİLMEMELİ.
  for (const t of RENDER_TABS) {
    if (t === 'spadiscovery') {
      // Birlesik sayfa: iki anahtardan biri yeterli, ama HICBIRI yoksa render EDILMEZ.
      assert.ok(
        page.includes("{tab === 'spadiscovery' && (canSee('tab:nginx:spadiscovery') || canSee('tab:nginx:spa'))"),
        'birleşik sayfa içeriği koşulsuz render ediliyor',
      );
      // Alt sekmeler de AYRI AYRI yetkiye bagli olmali: yalniz bir anahtara sahip
      // kullaniciya otekinin icerigi acilmamali.
      assert.ok(
        /kesifGorunur=\{canSee\('tab:nginx:spadiscovery'\)\}/.test(page)
          && /kapsamGorunur=\{canSee\('tab:nginx:spa'\)\}/.test(page),
        'alt sekmeler ayrı görünürlük anahtarına bağlı değil',
      );
      continue;
    }
    assert.ok(
      page.includes(`{tab === '${t}' && canSee('tab:nginx:${t}')`),
      `${t} içeriği koşulsuz render ediliyor`,
    );
  }
  // ESKI BAGLANTI: ?tab=spa sessizce Dashboard'a DUSMEMELI.
  assert.ok(/raw === 'spa'\) return 'spadiscovery'/.test(page), 'eski ?tab=spa bağlantısı yönlendirilmiyor');
  assert.ok(page.includes('Bu sayfada size açık bir bölüm yok'), 'boş durum mesajı yok');
  assert.ok(
    /if \(visibleIds\.length && !visibleIds\.includes\(tab\)\) setTab\(visibleIds\[0\]\)/.test(
      page,
    ),
    'kapalı sekmede kalınca ilk görünür sekmeye geçilmiyor',
  );

  const admin = read('src/components/admin/AdminPage.tsx');
  assert.ok(
    admin.includes("{ id: 'nginxaccess', label: 'Nginx Hub Erişimi'") &&
      admin.includes("{activeTab === 'nginxaccess' && <NginxAccessTab />}"),
    'admin sekmesi bağlı değil',
  );
  const tab = read('src/components/admin/tabs/NginxAccessTab.tsx');
  assert.ok(
    tab.includes('nginxAccessApi') && tab.includes('TabAccessPanel'),
    'panel/API bağlı değil',
  );
  // Kullanıcının saydığı sekmeler etiketli olmalı (ekranda anlaşılır adlar).
  for (const s of ['CIS', 'SPA', 'API Envanteri', 'Envanter', 'Audit']) {
    assert.ok(tab.includes(s), `etiket eksik: ${s}`);
  }
});

// NH-A5: SEED ile EKRAN listesi ORTUSMELI ve her sekmenin yetki kapisi OLMALI.
//
// Bu test, elle yazilmis `TABS` kopyasinin uc sekmeyi denetlemedigi ortaya cikinca
// yazildi (2026-10-08). Iki yonlu olculur, cunku iki yonun bedeli AYRI:
//   * Ekranda olup seed'de olmayan sekme -> admin panelinden yetki VERILEMEZ; `canSee`
//     bilinmeyen oge icin ne donerse o olur, yani kapi BELIRSIZ.
//   * Seed'de olup ekranda olmayan anahtar -> ya olu yetki ya da (bizim durumumuzda)
//     bilincli bir ALT SEKME anahtari. Bilincli olanlar burada ADIYLA yazilir.
const SEKME_OLMAYAN_ANAHTARLAR = new Set([
  // 'spa': 2026-10-08'de 'spadiscovery' ile birlesti. Sekme DEGIL ama yetki anahtari
  // olarak YASIYOR - birlesik sayfanin "Kapsam & Tasima" alt sekmesini aciyor.
  'spa',
]);

test('NH-A5 seed ile ekran sekme listesi ortusur; her sekmenin yetki kapisi var', () => {
  const seed = seedKeys();
  const ui = uiTabs();
  const page = read('src/components/nginx_console/NginxConsolePage.tsx');

  const seedDisi = ui.filter((t) => !seed.includes(t));
  assert.deepEqual(
    seedDisi,
    [],
    `ekranda olup seed'de OLMAYAN sekme(ler): ${seedDisi.join(', ')} — admin panelinden yetki verilemez, kapi belirsiz`,
  );

  const ekranDisi = seed.filter((k) => !ui.includes(k) && !SEKME_OLMAYAN_ANAHTARLAR.has(k));
  assert.deepEqual(
    ekranDisi,
    [],
    `seed'de olup ekranda sekme OLMAYAN anahtar(lar): ${ekranDisi.join(', ')} — olu yetki mi, bilincli alt sekme mi? SEKME_OLMAYAN_ANAHTARLAR'a yazin`,
  );

  // Her EKRAN sekmesinin render kapisi yetkiye bagli olmali.
  for (const t of ui) {
    const tekAnahtar = page.includes(`{tab === '${t}' && canSee('tab:nginx:${t}')`);
    const birlesik =
      t === 'spadiscovery' &&
      page.includes("{tab === 'spadiscovery' && (canSee('tab:nginx:spadiscovery') || canSee('tab:nginx:spa'))");
    assert.ok(tekAnahtar || birlesik, `${t} icerigi yetki kapisi OLMADAN render ediliyor`);
  }

  // Birlesik sayfanin ALT SEKMELERI de ayri ayri yetkiye bagli olmali.
  assert.match(page, /kesifGorunur=\{canSee\('tab:nginx:spadiscovery'\)\}/, 'Kesif alt sekmesi yetkisiz');
  assert.match(page, /kapsamGorunur=\{canSee\('tab:nginx:spa'\)\}/, 'Kapsam alt sekmesi yetkisiz');
});
