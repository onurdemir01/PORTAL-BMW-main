// src/__tests__/admin-tutarlilik.test.cjs
//
// ADMIN VE SAYFA İÇERİĞİ TUTARLILIĞI (2026-10-02, kullanıcı: "admin ekranındaki ve diğer
// sayfalardaki içeriklerin güncel tutarlı olduğuna emin ol, eskiler silinsin").
//
//   AD1 sekme kaydı ÜÇ yerde (AdminPage, elements.ts, seed) birebir aynı — iki yönde ve
//       etiketlerle. S3 (scalex-validation) yalnızca "AdminPage'teki her sekme diğer
//       ikisinde var mı"ya bakıyordu; TERS yön kör kaldı: kaldırılan iki sekme
//       (Test Senaryoları / Akış Testleri) elements/seed'de durdu ve Sayfa Erişimi var
//       olmayan sekmeleri listeledi. Etiketler de ayrışmıştı ("Logo" / "Marka").
//   AD2 LogX Yönetimi ayrı sekme; OCP Yapılandırma yalnızca ORTAK OCP ayarlarını taşır.
//   AD3 var olmayan ekranlara yönlendiren eski metinler geri gelmez.
//   AD4 kaldırılan Linkler sayfasının artıkları geri gelmez (Dashboard 403 alıyordu).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const oku = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const kodOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
    .join('\n');

function sayfaSekmeleri() {
  const page = oku('src/components/admin/AdminPage.tsx');
  return new Map(
    [...page.matchAll(/\{\s*id:\s*["']([a-z0-9]+)["']\s*,\s*label:\s*["']([^"']+)["']/g)].map(
      (m) => [m[1], m[2]],
    ),
  );
}
function elementSekmeleri() {
  const e = oku('src/config/elements.ts');
  const blok = e.slice(
    e.indexOf('export const ADMIN_TABS'),
    e.indexOf('];', e.indexOf('export const ADMIN_TABS')),
  );
  return new Map(
    [...blok.matchAll(/id:\s*'admintab:([a-z0-9]+)',\s*label:\s*'([^']+)'/g)].map((m) => [
      m[1],
      m[2],
    ]),
  );
}
function seedSekmeleri() {
  const s = oku('server/db/mssql-setup.cjs');
  return new Map(
    [
      ...s.matchAll(
        /element_key:\s*'admintab:([a-z0-9]+)',\s*element_type:\s*'admin_tab',\s*parent_key:\s*'Admin',\s*label:\s*'([^']+)'/g,
      ),
    ].map((m) => [m[1], m[2]]),
  );
}

test('AD1 admin sekmeleri uc yerde BIREBIR ayni (iki yonde + etiketler)', () => {
  const sayfa = sayfaSekmeleri();
  const el = elementSekmeleri();
  const seed = seedSekmeleri();
  assert.ok(sayfa.size >= 10, `sekme listesi okunamadi (${sayfa.size})`);
  assert.deepEqual(
    [...el.keys()].sort(),
    [...sayfa.keys()].sort(),
    'elements.ts ADMIN_TABS ayrisiyor',
  );
  assert.deepEqual(
    [...seed.keys()].sort(),
    [...sayfa.keys()].sort(),
    'seed admintab satirlari ayrisiyor',
  );
  for (const [id, label] of sayfa) {
    assert.equal(el.get(id), label, `elements.ts etiketi farkli: ${id}`);
    assert.equal(seed.get(id), label, `seed etiketi farkli: ${id}`);
  }
  // Kaldirilan/tasinan sekmelerin ESKI kurulumlardaki ogeleri temizleniyor.
  const s = kodOnly(oku('server/db/mssql-setup.cjs'));
  for (const k of ['admintab:testscenarios', 'admintab:flowtests', 'admintab:inventorygaps']) {
    assert.match(s, new RegExp(`'${k}'`), `${k} temizlik listesinde yok`);
  }
  assert.match(s, /await removeRetiredAdminTabs\(pool\);/, 'temizlik cagrilmiyor');
});

test('AD2 LogX Yonetimi ayri sekme; OCP Yapilandirma yalnizca ortak OCP ayarlari', () => {
  const page = kodOnly(oku('src/components/admin/AdminPage.tsx'));
  assert.match(
    page,
    /\{activeTab === "logx" && <LogXAdminTab \/>\}|\{activeTab === 'logx' && <LogXAdminTab \/>\}/,
  );
  assert.match(
    page,
    /ids: \['playbooks', 'ansible', 'logxv2', 'logx', 'scalex'\]/,
    'Otomasyon grubunda degil',
  );
  const logx = kodOnly(oku('src/components/admin/tabs/LogXAdminTab.tsx'));
  for (const b of [
    'LogXErisim',
    'PlaybookReadinessPanel',
    'RequestsSection',
    'MaskRulesSection',
    'EnvSuffixSection',
    'InventoryGapsTab',
  ]) {
    assert.match(logx, new RegExp(`<${b} />`), `LogX Yonetimi'nde ${b} yok`);
  }
  const ocp = kodOnly(oku('src/components/admin/tabs/LogXv2AdminTab.tsx'));
  const alt = [...ocp.matchAll(/\{ id: '([a-z]+)', label:/g)].map((m) => m[1]);
  assert.deepEqual(
    alt,
    ['clusters', 'vaultkeys', 'terminals', 'ocpruntime'],
    'OCP Yapilandirma alt sekmeleri',
  );
  assert.doesNotMatch(
    ocp,
    /LogXErisim|MaskRulesSection|RequestsSection|PlaybookReadinessPanel/,
    'LogX`e ozgu bolum OCP Yapilandirma`da kalmis',
  );
});

// Var olmayan ekranlara yonlendiren metinler. ISTISNALAR ACIK: server/opsx ve
// src/components/opsx proje kurali geregi SALT OKUNUR (raporlandi, degistirilmedi);
// testler bu metinleri ARADIGI icin haric; arsiv belgeleri tarihseldir.
const ESKI_METINLER = [
  'LogX Yapılandırma',
  'LogX Yapilandirma',
  'LogX v2 Yapılandırma',
  'Ansible Info > OCP',
  "Ansible Info'dan",
  'Self Servis Özelleştirmeleri',
  'ekibiniz bu kaynağı kısıtlamış olabilir',
  'LogX v2 > Erişim',
];
const ISTISNA =
  /^(server\/opsx\/|src\/components\/opsx\/|docs\/archive\/|actions\.md$)|__tests__\//;

test('AD3 eski ekran adlari kaynakta ve belgelerde geri gelmiyor', () => {
  const dosyalar = execFileSync(
    'git',
    ['ls-files', 'src', 'server', 'docs', 'scripts', 'README.md'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  )
    .split('\n')
    .filter((f) => f && !ISTISNA.test(f) && /\.(cjs|js|ts|tsx|md|ya?ml)$/.test(f));
  const bulunan = [];
  for (const f of dosyalar) {
    let s;
    try {
      s = oku(f);
    } catch {
      continue;
    }
    for (const m of ESKI_METINLER) if (s.includes(m)) bulunan.push(`${f}: "${m}"`);
  }
  assert.deepEqual(bulunan, [], `eski ekran adlari:\n${bulunan.join('\n')}`);
});

test('AD4 Linkler artiklari yok (Dashboard /api/links cagirmiyor)', () => {
  const dash = kodOnly(oku('src/components/DashboardPage.tsx'));
  assert.doesNotMatch(
    dash,
    /linksApi|\/api\/links|Favori bağlantılar/,
    'Dashboard hala Linkler verisini cekiyor (403)',
  );
  const palet = kodOnly(oku('src/components/common/CommandPalette.tsx'));
  assert.doesNotMatch(palet, /"Linkler"/, 'komut paletinde Linkler var');
  for (const f of ['src/components/ImportantLinksPage.tsx', 'src/api/linksApi.ts']) {
    assert.ok(!fs.existsSync(path.join(ROOT, f)), `${f} geri gelmis`);
  }
});
