// server/crypto-hub/__tests__/node-sozlesme.test.cjs - Indexer / Node sozlesme bekcileri (2026-11-02).
//
// CHN9  prod acilisi IKI anahtar: shared NODE_PROD_ACIK == tenants.yml node_degisikligi_acik: true
// CHN10 vars/nodes.yml eski gruplari sozlesme 2.3 tablosuyla birebir; tek sir SIDECAR_AUTH_VALUE;
//       node listesi YOK (crypto_hub_nodes, vars/node_sirlari.yml); '#' satiri ve CRLF yok
// CHN12 yeni deger dogrulamasi Portal == Python (desen kaynak metinleri, eslesme kipi, ortak
//       test vektorleri tests/deger_vektorleri.json gercek Portal fonksiyonlariyla)
// CHN13 runner poller kancasi: launchOncesi === 'crypto_hub_node' performSsLaunch'tan ONCE
// N15   DB: tablo (sifreli yeni_deger_secret, eski node kolonlari yok) + goc + filtreli tekil
//       indeks AYRI blokta + yetki ogesi; tam yedek maskesi; /crypto-access 'node' sekmesi
// N12b  /ops node islemlerini tanimaz (normalizeOps)
//
// Ansible deposu: CRYPTO_HUB_ANSIBLE_ROOT (yoksa bu makinedeki varsayilan). Depo yoksa capraz
// karsilastirmalar ATLANIR; depo VAR ama dosya yoksa bekci KIRMIZI (A tarafi eksik teslim).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const KOK = path.join(__dirname, '..', '..', '..');
const ANSIBLE =
  process.env.CRYPTO_HUB_ANSIBLE_ROOT ||
  path.join('C:', 'Users', 'demir', 'Downloads', 'Compressed', 'gar_bmt_ansible_scripts');
const CH = path.join(ANSIBLE, 'bmw_automation_folder', 'crypto_hub');
const ansibleVar = () => fs.existsSync(path.join(CH, 'crypto_hub_ops.yml'));
const oku = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const N = require('../../../shared/cryptoHubNodes.cjs');
const { CRYPTO_TENANTS } = require('../../../shared/cryptoHubTenants.cjs');

// Sozlesme 2.3 (bagimsiz kopya: nodes.yml bu tablodan SAPARSA kirmizi).
const ESKI = [
  ['eski:solana-mainnet', 'solana-mainnet', 'eski-solana-mainnet', { rpc: ['SOLRPC', 'url'], ws: ['SOLWSRPC', 'url'] }],
  ['eski:btc-mainnet', 'nbxplorer-mainnet', 'eski-nbxplorer-mainnet', { p2p: ['NBXPLORER_BTCNODEENDPOINT', 'hostport'], rpc: ['NBXPLORER_BTCRPCURL', 'url'] }],
  ['eski:ltc-mainnet', 'nbxplorer-mainnet', 'eski-nbxplorer-mainnet', { p2p: ['NBXPLORER_LTCNODEENDPOINT', 'hostport'], rpc: ['NBXPLORER_LTCRPCURL', 'url'] }],
  ['eski:btc-testnet', 'nbxplorer-testnet', 'eski-nbxplorer-testnet', { p2p: ['NBXPLORER_BTCNODEENDPOINT', 'hostport'], rpc: ['NBXPLORER_BTCRPCURL', 'url'] }],
  ['eski:ethereum-mainnet', 'ethereum-mainnet', 'eski-ethereum-mainnet', { rpc: ['ETH_INDEXER_NODE_URI', 'url'] }],
  ['eski:ethereum-testnet-sepolia', 'ethereum-testnet-sepolia', 'eski-ethereum-testnet-sepolia', { rpc: ['ETH_INDEXER_NODE_URI', 'url'] }],
  ['eski:avalanche-c-chain-mainnet', 'avalanche-c-chain-mainnet', 'eski-avalanche-c-chain-mainnet', { rpc: ['ETH_INDEXER_NODE_URI', 'url'] }],
  ['eski:polygon-mainnet', 'polygon-mainnet', 'eski-polygon-mainnet', { rpc: ['ETH_INDEXER_NODE_URI', 'url'] }],
  ['eski:cardano-mainnet', 'cardano-mainnet', 'eski-cardano-mainnet', { ogmios: ['OGMIOS', 'url'] }],
  ['eski:xrpl-mainnet', 'xrpl-mainnet', 'eski-xrpl-mainnet', { rpc: ['XRP_INDEXER_SERVER_URI', 'url'] }],
  ['eski:polkadot-assethub', 'substrate-polkadot-assethub', 'eski-substrate-polkadot-assethub', { url: ['SIDECAR_URL', 'url'], auth: ['SIDECAR_AUTH_VALUE', 'sir'] }],
];

test('CHN9 prod acilisi iki anahtar: NODE_PROD_ACIK == tenants.yml node_degisikligi_acik: true', (t) => {
  for (const k of N.NODE_PROD_ACIK) {
    const tn = CRYPTO_TENANTS.find((x) => x.key === k);
    assert.ok(tn && tn.app === 'metaco' && tn.production, `${k} prod Metaco kiracisi degil`);
  }
  const p = path.join(CH, 'vars', 'tenants.yml');
  if (!fs.existsSync(p)) return t.skip('Ansible deposu bu makinede yok');
  const liste = tenantBloklari(oku(p));
  assert.ok(liste.length > 0, 'tenants.yml kiraci listesi okunamadi');
  const acik = [];
  for (const tn of CRYPTO_TENANTS.filter((x) => x.app === 'metaco')) {
    const y = liste.find((x) => x && x.key === tn.key);
    assert.ok(y, `${tn.key} tenants.yml'de yok`);
    assert.ok('node_degisikligi_acik' in y, `${tn.key}: node_degisikligi_acik alani yok`);
    assert.equal(typeof y.node_degisikligi_acik, 'boolean', `${tn.key}: alan bool degil`);
    if (y.node_degisikligi_acik === true) acik.push(tn.key);
  }
  for (const y of liste.filter((x) => x && x.node_degisikligi_acik === true)) {
    assert.ok(CRYPTO_TENANTS.find((x) => x.key === y.key && x.app === 'metaco'), `${y.key} Metaco degil ama acik`);
  }
  // Kume BIREBIR: test kiracisinda `true` da sapmadir (faz 1'de hepsi false; anahtar yalniz
  // prod acilisinin ikinci yeri, sozlesme 6.5 / 10).
  assert.deepEqual(acik.sort(), [...N.NODE_PROD_ACIK].sort(), 'prod acilisi iki yerde ayni degil');
});

test('CHN10 nodes.yml eski gruplari sozlesme 2.3 ile birebir; tek sir SIDECAR_AUTH_VALUE; node listesi yok; # ve CRLF yok', (t) => {
  if (!ansibleVar()) return t.skip('Ansible deposu bu makinede yok');
  const p = path.join(CH, 'vars', 'nodes.yml');
  assert.ok(fs.existsSync(p), 'vars/nodes.yml yok (A teslimi eksik)');
  // Kullanici karari 2026-11-03: node listesi (katalog) ve sir dosyasi TAMAMEN kalkti.
  assert.ok(!fs.existsSync(path.join(CH, 'vars', 'node_sirlari.yml')), 'vars/node_sirlari.yml hala var');
  assert.ok(!/^crypto_hub_nodes\s*:/m.test(oku(p)), 'nodes.yml crypto_hub_nodes anahtarini tasiyor');
  const ops = oku(CH, 'crypto_hub_ops.yml');
  for (const kalinti of ['crypto_hub_node_id', 'node_sirlari', 'node_katalog', 'NODE_KATALOG']) {
    assert.ok(!ops.includes(kalinti), `crypto_hub_ops.yml '${kalinti}' iceriyor`);
  }
  for (const f of [p, path.join(CH, 'crypto_hub_ops.yml'), path.join(CH, 'vars', 'tenants.yml')]) {
    const ham = fs.readFileSync(f, 'utf8');
    assert.ok(!ham.includes('\r'), `${path.basename(f)} CRLF iceriyor`);
    if (f === p) {
      assert.ok(!/^\s*#/m.test(ham), `${path.basename(f)} icinde # satiri var (README'ye)`);
    }
  }
  const doc = nodesYml(oku(p));
  const eski = doc.crypto_hub_node_eski_gruplar;
  assert.ok(Array.isArray(eski));
  assert.equal(eski.length, ESKI.length, 'eski grup sayisi farkli');
  const sirEnvler = [];
  for (const [grup, ek, kilit, roller] of ESKI) {
    const g = eski.find((x) => x.grup === grup);
    assert.ok(g, `${grup} nodes.yml'de yok`);
    assert.equal(g.ek, ek, `${grup} ek`);
    assert.equal(g.kilit, kilit, `${grup} kilit`);
    assert.ok(N.GRUP_RE.test(g.grup));
    const r = Object.fromEntries(g.roller.map((x) => [x.rol, [x.envler.join(','), x.bicim]]));
    assert.deepEqual(r, Object.fromEntries(Object.entries(roller)), `${grup} rol/env/bicim`);
  }
  for (const g of eski) for (const r of g.roller) if (r.bicim === 'sir') sirEnvler.push(...r.envler);
  assert.deepEqual([...new Set(sirEnvler)], ['SIDECAR_AUTH_VALUE'], 'sir rolu yalniz SIDECAR_AUTH_VALUE olmali');
  // PS-1: uis kurali kullanicinin OLCTUGU haritayla birebir (uis_env_haritasi.md, 2026-11-02):
  // adapter/api NODE_ADDR, indexer NODE_URI_<ZA> yoksa NODE_ADDR, processor node env'i YOK.
  assert.ok(!/crypto_hub_node_aileler/.test(oku(p)), 'eski aile modeli (ETH_INDEXER_NODE_URI/SOLRPC) geri geldi');
  assert.deepEqual(doc.crypto_hub_node_uis_kurali, {
    rol: 'rpc',
    bicim: 'url',
    bilesenler: { adapter: ['NODE_ADDR'], api: ['NODE_ADDR'], indexer: ['NODE_URI_{ZA}', 'NODE_ADDR'], processor: [] },
  });
  for (const liste of Object.values(doc.crypto_hub_node_uis_kurali.bilesenler)) {
    for (const e of liste) assert.ok(!N.YASAK_ENV_RE.test(e.replace('{ZA}', 'X')), `uis kurali yasak ad: ${e}`);
  }
  for (const g of eski) for (const r of g.roller) for (const e of r.envler) assert.ok(!N.YASAK_ENV_RE.test(e), `${g.grup}: yasak ad ${e}`);
});

test('CHN12 yeni deger dogrulamasi Portal == Python: desenler, eslesme kipi, sabitler, ortak vektorler', (t) => {
  if (!ansibleVar()) return t.skip('Ansible deposu bu makinede yok');
  const py = path.join(CH, 'files', 'crypto_hub_node.py');
  const vek = path.join(CH, 'tests', 'deger_vektorleri.json');
  assert.ok(fs.existsSync(py), 'files/crypto_hub_node.py yok (A teslimi eksik)');
  assert.ok(fs.existsSync(vek), 'tests/deger_vektorleri.json yok (A teslimi eksik)');
  const src = oku(py);
  // Her desen TEK tanim, tek satir, r"..." kaynak metni Portal DESEN ile karakter karakter ayni.
  const AD = { ascii: 'ASCII_RE', yasak: 'YASAK_RE', url: 'URL_RE', hostport: 'HOSTPORT_RE', sir: 'SIR_RE' };
  for (const [k, ad] of Object.entries(AD)) {
    const tanim = [...src.matchAll(new RegExp(`^${ad} = re\\.compile\\(r"([^"]*)"\\)$`, 'gm'))];
    assert.equal(tanim.length, 1, `${ad} betikte tek satirlik tek tanim degil`);
    assert.equal(tanim[0][1], N.DESEN[k], `${ad} kaynak metni Portal DESEN.${k} ile farkli`);
    assert.equal(new RegExp(`^${ad}\\s*=`, 'm').test(src.replace(tanim[0][0], '')), false, `${ad} iki kez tanimli`);
  }
  assert.match(src, new RegExp(`^DEGER_EN_COK = ${N.DEGER_EN_COK}$`, 'm'), 'DEGER_EN_COK farkli');
  assert.ok(src.split('\n').includes(`BOS_MASKE = "${N.BOS_MASKE}"`), 'BOS_MASKE farkli');
  // Eslesme kipi: Python `$` sondaki \n'den once de eslesir -> fullmatch; yasak search.
  for (const ad of ['ASCII_RE', 'URL_RE', 'HOSTPORT_RE', 'SIR_RE']) {
    assert.ok(src.includes(`${ad}.fullmatch(`), `${ad}.fullmatch kullanilmiyor`);
    assert.ok(!new RegExp(`${ad}\\.(match|search)\\(`).test(src), `${ad} match/search ile kullaniliyor (\\n kacagi)`);
  }
  assert.ok(src.includes('YASAK_RE.search('), 'YASAK_RE.search kullanilmiyor');
  const kod = /^NODESUM_KODLARI = \(([^)]*)\)/m.exec(src);
  assert.ok(kod, 'NODESUM_KODLARI bulunamadi');
  assert.ok(!/BAYAT_KATALOG/.test(kod[1]), 'NODESUM_KODLARI BAYAT_KATALOG tasiyor');
  // Ortak vektorler: Portal'in GERCEK fonksiyonlariyla birebir.
  const ham = oku(vek);
  assert.ok(!ham.includes('\r'), 'deger_vektorleri.json CRLF');
  const liste = JSON.parse(ham);
  assert.ok(Array.isArray(liste) && liste.length >= 36, `vektor sayisi az (${liste && liste.length})`);
  const nedenler = new Set();
  for (const v of liste) {
    const deger = v.uzunluk ? v.deger + 'a'.repeat(v.uzunluk - v.deger.length) : v.deger;
    const etiket = `${JSON.stringify(v.deger).slice(0, 60)} / ${v.bicim}`;
    assert.equal(N.degerDogrula(deger, v.bicim), v.neden, `neden: ${etiket}`);
    if (v.neden === null) assert.equal(N.maskele(deger, v.bicim), v.maske, `maske: ${etiket}`);
    else assert.equal(v.maske, undefined, `${etiket}: hatali satirda maske`);
    nedenler.add(v.neden);
  }
  for (const n of [null, 'bicim', 'karakter', 'uzun', 'yasak', 'url', 'hostport', 'sir']) {
    assert.ok(nedenler.has(n), `vektorlerde ${n} nedeni yok`);
  }
});

test("CHN13 runner poller kancasi: launchOncesi === 'crypto_hub_node' performSsLaunch'tan once, launchExtraVars ile", () => {
  const src = oku(KOK, 'server', 'ansible', 'runner.cjs');
  const bas = src.indexOf("require('../smart/poller.cjs').startPoller(async (ticket) =>");
  assert.ok(bas > 0, 'poller geri cagrisi bulunamadi (bekci kor)');
  const son = src.indexOf("console.warn('[Smart] poller baslatilamadi:'", bas);
  assert.ok(son > bas);
  const dilim = src.slice(bas, son);
  const kanca = dilim.indexOf("ticket.pendingLaunch.launchOncesi === 'crypto_hub_node'");
  const ekle = dilim.indexOf('launchOncesiDegerEkle(');
  const oco = dilim.indexOf('if (ocoWindowStartIso && ocoWindowEndIso)');
  const launch = dilim.lastIndexOf('performSsLaunch(');
  assert.ok(kanca > 0, 'kanca kosulu yok');
  assert.ok(ekle > kanca, 'launchOncesiDegerEkle kancadan sonra cagrilmiyor');
  assert.ok(oco > ekle, 'kanca OCO dalindan ONCE olmali (OCO ile birlikte reddedilir)');
  assert.ok(launch > ekle, 'kanca performSsLaunch tan once degil');
  assert.match(dilim.slice(launch, launch + 400), /extraVars: launchExtraVars,/, 'launch kancanin extra_vars ini kullanmiyor');
  assert.match(dilim, /OCO penceresiyle baslatilamaz/);
  assert.match(dilim, /nodeMod\.gizliTemizle\(e\.message, gizliler\)/, 'launch hatasi gizliTemizle den gecmiyor');
  // AWX 4xx log satiri da gizlileri bilsin (awxRequestToServer opts.gizliler, JO12).
  assert.match(dilim.slice(launch, launch + 500), /\n\s*gizliler,\n/, 'kanca gizlileri performSsLaunch a vermiyor');
  const psBas = src.indexOf('async function performSsLaunch(');
  const ps = src.slice(psBas, src.indexOf('const jobId = data.id;', psBas));
  assert.match(ps, /\/launch\/`,\s*payload,\s*gizliler\.length \? \{ gizliler \} : null,/, 'performSsLaunch gizlileri AWX istegine vermiyor');
  // Kanca YALNIZ bir yerde (genel eklenti mekanizmasi yok).
  assert.equal(src.split('launchOncesiDegerEkle(').length - 1, 1);
});

test('CHN11 kaynak sozlugu + yasak adlar betik ile Portal arasinda birebir (PS-3 sozlesme acigi)', (t) => {
  // Portal grupAnalizi bilinmeyen kaynagi olculemedi sayar: betik yeni bir kaynak turu basarsa
  // ve Portal tanimazsa grup SESSIZCE "olculemedi" olur (envFrom olayi). Iki liste ayni olmali.
  const NODE_SRC = oku(KOK, 'server', 'crypto-hub', 'node.cjs');
  assert.match(NODE_SRC, /const BILINEN_KAYNAK = N\.NODE_KAYNAKLARI;/);
  assert.match(NODE_SRC, /const REFERANS_KAYNAK = N\.REFERANS_KAYNAKLARI;/);
  assert.ok(N.NODE_KAYNAKLARI.includes('envFrom') && N.REFERANS_KAYNAKLARI.includes('envFrom'));
  assert.ok(N.NODE_KAYNAKLARI.includes('belirsiz') && !N.REFERANS_KAYNAKLARI.includes('belirsiz'));
  const py = path.join(CH, 'files', 'crypto_hub_node.py');
  if (!fs.existsSync(py)) return t.skip('Ansible deposu bu makinede yok');
  const src = oku(py);
  const demet = (ad) => {
    const m = new RegExp(`^${ad} = \\(([^)]*)\\)`, 'm').exec(src);
    assert.ok(m, `${ad} betikte bulunamadi`);
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  };
  assert.deepEqual(demet('KAYNAKLAR'), [...N.NODE_KAYNAKLARI], 'kaynak sozlugu betik/Portal farkli');
  assert.deepEqual(demet('REFERANS_KAYNAKLAR'), [...N.REFERANS_KAYNAKLARI], 'referans kumesi betik/Portal farkli');
  const y = /^YASAK_ENV_RE = re\.compile\(r"([^"]+)", re\.I\)/m.exec(src);
  assert.ok(y, 'YASAK_ENV_RE betikte bulunamadi');
  assert.equal(y[1], N.YASAK_ENV_RE.source, 'yasak ad deseni betik/Portal farkli');
  assert.equal(N.YASAK_ENV_RE.flags, 'i');
  // Betigin bastigi her kaynak literali sozlukte olmali.
  for (const m of src.matchAll(/satir\["kaynak"\] = "([A-Za-z]+)"/g)) {
    assert.ok(N.NODE_KAYNAKLARI.includes(m[1]), `betik sozluk disi kaynak basiyor: ${m[1]}`);
  }
});

// ── Kucuk YAML okuyucu (bu dosyalarin bicimi icin) ───────────────────────────────────
// `yaml` paketi package.json'da BILDIRILMEMIS (yalniz baska paketin istege bagli bagimliligi:
// DEP1). Burada yalniz bu dosyalarin kullandigi bicim okunur; tanimadigi rol satiri SESSIZ
// atlanmaz, sayim tutmazsa bekci kirmizi olur.
function bolum(text, ad) {
  const m = new RegExp(`^${ad}:[ \\t]*(.*)$`, 'm').exec(text);
  if (!m) return null;
  const kalan = text.slice(m.index + m[0].length);
  const son = kalan.search(/^\S/m);
  return { satirIci: m[1].trim(), govde: son < 0 ? kalan : kalan.slice(0, son) };
}

function tenantBloklari(text) {
  const b = bolum(text, 'crypto_hub_tenants');
  if (!b) return [];
  return b.govde
    .split(/^\s*-\s*key:\s*/m)
    .slice(1)
    .map((blok) => {
      const o = { key: blok.split(/\s/)[0] };
      const m = /^\s*node_degisikligi_acik:[ \t]*(\S*)[ \t]*$/m.exec(blok);
      if (m) o.node_degisikligi_acik = m[1] === 'true' ? true : m[1] === 'false' ? false : m[1];
      return o;
    });
}

const skaler = (blok, k) => {
  const m = new RegExp(`^\\s*${k}:[ \\t]*(.*)$`, 'm').exec(blok);
  return m ? m[1].trim().replace(/^"(.*)"$/, '$1') : undefined;
};

function rolSatirlari(blok, ad) {
  const tire = (blok.match(/^\s*-\s/gm) || []).length;
  const roller = [
    ...blok.matchAll(
      /^\s*-\s*\{\s*rol:\s*([a-z0-9_]+)\s*,\s*envler:\s*\[([^\]]*)\]\s*,\s*bicim:\s*([a-z]+)\s*\}\s*$/gm,
    ),
  ].map((m) => ({
    rol: m[1],
    envler: m[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    bicim: m[3],
  }));
  assert.equal(roller.length, tire, `${ad}: rol satirlari beklenen {rol, envler, bicim} bicminde degil`);
  return roller;
}

function ogeler(govde, ilk) {
  return govde
    .split(new RegExp(`^\\s*-\\s*${ilk}:[ \\t]*`, 'm'))
    .slice(1)
    .map((blok) => ({ ilk: blok.split('\n')[0].trim().replace(/^"(.*)"$/, '$1'), blok }));
}

function nodesYml(text) {
  const out = {};
  const e = bolum(text, 'crypto_hub_node_eski_gruplar');
  out.crypto_hub_node_eski_gruplar = e
    ? ogeler(e.govde, 'grup').map(({ ilk, blok }) => ({
        grup: ilk,
        ek: skaler(blok, 'ek'),
        kilit: skaler(blok, 'kilit'),
        baslik: skaler(blok, 'baslik'),
        roller: rolSatirlari(blok, ilk),
      }))
    : null;
  const u = bolum(text, 'crypto_hub_node_uis_kurali');
  if (u) {
    const b = u.govde.slice(u.govde.search(/^ {2}bilesenler:\s*$/m));
    const satir = [...b.matchAll(/^ {4}([a-z]+):[ \t]*(.*)$/gm)];
    const bilesenler = {};
    for (const m of satir) {
      const liste = /^\[(.*)\]\s*$/.exec(m[2].trim());
      assert.ok(liste, `uis kurali ${m[1]}: [..] bicminde degil`);
      bilesenler[m[1]] = liste[1]
        .split(',')
        .map((s) => s.trim().replace(/^"(.*)"$/, '$1'))
        .filter(Boolean);
    }
    out.crypto_hub_node_uis_kurali = { rol: skaler(u.govde, 'rol'), bicim: skaler(u.govde, 'bicim'), bilesenler };
  } else out.crypto_hub_node_uis_kurali = null;
  return out;
}

const SEED = oku(KOK, 'server', 'db', 'mssql-setup.cjs');

test('N15 DB: tablo, filtreli tekil indeks ayri blokta, genel indeksler, yetki ogesi', () => {
  const i = SEED.indexOf("name: 'crypto_hub_node_changes'");
  assert.ok(i > 0, 'tablo tanimi yok');
  const tablo = SEED.slice(i, SEED.indexOf(')`,', i));
  for (const kol of ['tenant_key', 'kilit', 'plan_sha', 'durum', 'smart_ticket_id', 'external_ticket_id', 'awx_job_id', 'sonuc_json', 'es_talep_id', 'kapandi_at']) {
    assert.match(tablo, new RegExp(`\\b${kol}\\b`), `kolon yok: ${kol}`);
  }
  // Deger YALNIZ sifreli kolonda; eski node listesi kolonlari yeni kurulumda yok.
  assert.match(tablo, /^\s*yeni_deger_secret\s+NVARCHAR\(MAX\)\s+NULL,$/m);
  assert.ok(!/yeni_node_(id|ad)/.test(tablo), 'yeni kurulumda eski node kolonlari var');
  const digerleri = tablo.replace(/^\s*yeni_deger_secret\s+NVARCHAR\(MAX\)\s+NULL,$/m, '');
  assert.ok(!/\bdeger\b|node_url|secret/i.test(digerleri), 'tabloda deger tasiyabilecek baska kolon');
  // Var olan tablo: kolon goc listesinde; eski yeni_node_id nullable (INSERT artik yazmiyor).
  assert.match(SEED, /table: 'crypto_hub_node_changes',\s*col: 'yeni_deger_secret',\s*sql: 'ALTER TABLE crypto_hub_node_changes ADD yeni_deger_secret NVARCHAR\(MAX\) NULL'/);
  assert.match(SEED, /COLUMN_NAME='yeni_node_id' AND IS_NULLABLE='NO'[^`]*ALTER TABLE crypto_hub_node_changes ALTER COLUMN yeni_node_id NVARCHAR\(64\) NULL/);
  assert.ok(!/DROP COLUMN yeni_node/.test(SEED), 'yikici goc (kolon dusurme)');
  // Tam yedek kolon adina gore maskeler: sifreli deger yedege de cikmaz.
  const { SECRET_COLUMN_RE } = require('../../db/full-backup.cjs');
  assert.ok(SECRET_COLUMN_RE.test('yeni_deger_secret'), 'tam yedek yeni_deger_secret i maskelemiyor');
  assert.ok(SECRET_COLUMN_RE.test('pending_launch_json'));
  assert.ok(!/--/.test(tablo), '.cjs icindeki SQL de -- yorumu');
  const ux = SEED.indexOf('CREATE UNIQUE INDEX UX_chnc_acik');
  assert.ok(ux > 0, 'filtreli tekil indeks yok');
  assert.match(
    SEED.slice(ux, ux + 200),
    /CREATE UNIQUE INDEX UX_chnc_acik ON crypto_hub_node_changes \(tenant_key, kilit\) WHERE kapandi_at IS NULL/,
  );
  // AYRI try blogu: genel dongu yalniz CREATE INDEX uretir.
  const dongu = SEED.indexOf('for (const { name, table, cols } of indexes)');
  assert.ok(dongu > 0 && ux > dongu, 'tekil indeks genel dongunun disinda/sonrasinda olmali');
  const blok = SEED.slice(SEED.lastIndexOf('try {', ux), ux);
  assert.match(blok, /sys\.indexes WHERE name = 'UX_chnc_acik'/, 'indeks varligi kontrol edilmiyor');
  assert.match(SEED, /name: 'IX_chnc_ticket', table: 'crypto_hub_node_changes', cols: 'smart_ticket_id'/);
  assert.match(SEED, /name: 'IX_chnc_tenant', table: 'crypto_hub_node_changes', cols: 'tenant_key, created_at DESC'/);
  const o = SEED.indexOf("element_key: 'cryptohub:node:degistir'");
  assert.ok(o > 0, 'yetki ogesi seed edilmiyor');
  const ob = SEED.slice(o, o + 400);
  assert.match(ob, /parent_key: 'CryptoHub'/);
  assert.match(ob, /default_visible: 0/);
  assert.ok(!/strict/.test(ob), 'oge SIKI yapilmis (2026-10-01: yoneticiler muaf)');
  // Ayni sozluk: runtime kapisi indeksi has_filter + is_unique ile dogrular.
  const NODE_SRC = oku(KOK, 'server', 'crypto-hub', 'node.cjs');
  assert.match(NODE_SRC, /name = 'UX_chnc_acik' AND is_unique = 1 AND has_filter = 1/);
});

test('N12b /ops node islemlerini tanimaz (Smart kapali test yolu da yalniz /node-change uzerinden)', () => {
  const { normalizeOps, OPS, NODE_OPS } = require('../index.cjs');
  for (const a of Object.keys(NODE_OPS)) {
    assert.equal(OPS[a], undefined);
    assert.throws(() => normalizeOps({ action: a, targets: ['deployment/x'] }), /Bilinmeyen işlem/);
  }
  assert.deepEqual(Object.keys(NODE_OPS).sort(), ['node_change', 'node_env_get']);
  assert.equal(NODE_OPS.node_change.writes, true);
  assert.equal(NODE_OPS.node_env_get.writes, false);
});

test('N15b /crypto-access: node sekmesi tek basina verilir, sayfa kurali yazilir, GET geri okur', async () => {
  const kurallar = [];
  const sahte = {
    [require.resolve('../../auth/elements.cjs')]: {
      listRules: async () => kurallar.map((r) => ({ ...r })),
      setElementRules: async (key, list) => {
        for (let i = kurallar.length - 1; i >= 0; i -= 1) if (kurallar[i].elementKey === key) kurallar.splice(i, 1);
        for (const r of list) kurallar.push({ elementKey: key, ...r });
      },
    },
    [require.resolve('../../auth/visibility.cjs')]: { bumpVersion() {} },
    [require.resolve('../../audit/index.cjs')]: { auditMutations: () => (_q, _s, n) => n() },
  };
  const once = new Map();
  for (const [p, e] of Object.entries(sahte)) {
    once.set(p, require.cache[p]);
    require.cache[p] = { id: p, filename: p, loaded: true, exports: e };
  }
  const vr = require.resolve('../../auth/visibility-routes.cjs');
  const vrOnce = require.cache[vr];
  delete require.cache[vr];
  const { initVisibilityRoutes } = require(vr);
  const app = express();
  const gec = (_q, _s, n) => n();
  initVisibilityRoutes(app, { requireAuth: gec, requireAdmin: gec });
  const srv = await new Promise((r) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s));
  });
  const istek = (method, url, body) =>
    new Promise((resolve, reject) => {
      const veri = body ? JSON.stringify(body) : null;
      const q = http.request(
        { host: '127.0.0.1', port: srv.address().port, path: url, method, headers: { 'content-type': 'application/json' } },
        (res) => {
          let s = '';
          res.on('data', (c) => (s += c));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(s || '{}') }));
        },
      );
      q.on('error', reject);
      if (veri) q.write(veri);
      q.end();
    });
  try {
    let r = await istek('PUT', '/api/visibility/crypto-access', { principalType: 'email', principalId: 'Ali@X.test', tabs: ['node'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const anahtarlar = kurallar.map((k) => k.elementKey).sort();
    assert.deepEqual(anahtarlar, ['CryptoHub', 'cryptohub:node:degistir'], 'secilmeyen uygulamaya kural yazildi ya da sayfa kurali yok');
    r = await istek('GET', '/api/visibility/crypto-access');
    assert.deepEqual(r.body.tabs, ['metaco', 'wyden', 'node']);
    assert.deepEqual(r.body.grants[0].tabs, ['node']);
    assert.equal(r.body.grants[0].page, true);
    r = await istek('PUT', '/api/visibility/crypto-access', { principalType: 'email', principalId: 'ali@x.test', tabs: ['metaco', 'node', 'kotu'] });
    assert.equal(r.status, 200);
    assert.deepEqual(kurallar.map((k) => k.elementKey).sort(), ['CryptoHub', 'cryptohub:app:metaco', 'cryptohub:node:degistir']);
    r = await istek('DELETE', '/api/visibility/crypto-access?principalType=email&principalId=ali@x.test');
    assert.equal(r.status, 200);
    assert.deepEqual(kurallar, [], 'silmede node kurali kaldi');
  } finally {
    await new Promise((r) => srv.close(r));
    for (const [p, e] of once) {
      if (e) require.cache[p] = e;
      else delete require.cache[p];
    }
    if (vrOnce) require.cache[vr] = vrOnce;
    else delete require.cache[vr];
  }
});

test('N16 node uclari index.cjs router\'inda kimlik + gorunurluk kapisinin ARKASINDA baglanir', () => {
  // node.cjs kapiyi import etmez (route-auth-order RO1b onu bu yuzden incelemez): koruma,
  // uclarin index.cjs'teki router.use(requireAuth) ve requireVisible('CryptoHub') SONRASI
  // baglanmasina dayanir. Sira bozulursa /nodes ve /node-change kimliksiz kalirdi.
  const idx = oku(KOK, 'server', 'crypto-hub', 'index.cjs');
  const auth = idx.indexOf('router.use(requireAuth);');
  const gor = idx.indexOf("router.use(requireVisible('CryptoHub'));");
  const node = idx.indexOf("require('./node.cjs').initCryptoHubNode(router");
  assert.ok(auth > 0, 'index.cjs router.use(requireAuth) yok');
  assert.ok(gor > auth, "requireVisible('CryptoHub') kimlik kapisindan sonra degil");
  assert.ok(node > gor, 'node uclari kapilardan ONCE baglaniyor');
  const nodeSrc = oku(KOK, 'server', 'crypto-hub', 'node.cjs');
  assert.ok(!/express\.Router\(|\bapp\.(get|post|use)\(/.test(nodeSrc), 'node.cjs kendi router/app baglantisini kuruyor');
});

test('N20 dogrudan yol sozlesmesi: yalniz kopru, gecmisIcin yok; smart-config uclari kapilardan sonra', () => {
  const src = oku(KOK, 'server', 'crypto-hub', 'node.cjs');
  const bas = src.indexOf('async function dogrudanBaslat(');
  const son = src.indexOf('// ── Launch oncesi kanca');
  assert.ok(bas > 0 && son > bas, 'dogrudanBaslat bulunamadi');
  const govde = src.slice(bas, son);
  assert.match(govde, /performSsLaunchOnServer\(/);
  assert.doesNotMatch(govde.replace(/^\s*\/\/.*$/gm, ''), /launchJobOnServer|gecmisIcin/, 'degeri gizlemeyen yol kullanildi');
  assert.match(govde, /yutmaKorumasi: true/);
  const index = oku(KOK, 'server', 'crypto-hub', 'index.cjs');
  const auth = index.indexOf('router.use(requireAuth)');
  const gor = index.indexOf("requireVisible('CryptoHub')");
  const ayar = index.indexOf('initCryptoHubSmartAyar(router');
  assert.ok(auth > 0 && gor > auth && ayar > gor, 'smart-config uclari kapilardan once baglaniyor');
  // Fallback requireAuth'a baglanmamali: her oturumlu kullanici ayari degistirirdi.
  assert.match(index, /typeof authMod\.requireAdmin === 'function'[\s\S]{0,120}res\.status\(403\)/);
});

test('N21 runner koprusu poller ile ayni govdeye baglanir', () => {
  const src = oku(KOK, 'server', 'ansible', 'runner.cjs');
  assert.match(src, /_ssLaunch = performSsLaunch;/);
  assert.match(src, /async function performSsLaunchOnServer\(serverId, templateId, args\)/);
  assert.match(src, /code: 'ss_launch_hazir_degil'/);
  assert.match(src, /code: 'awx_prompt_on_launch_disabled', jobId, iptalEdildi/);
});
