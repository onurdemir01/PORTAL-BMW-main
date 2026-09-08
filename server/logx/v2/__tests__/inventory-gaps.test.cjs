// server/logx/v2/__tests__/inventory-gaps.test.cjs — ENVANTER BOSLUKLARI.
//
// NEDEN VAR: elle girilen (envanterde olmayan) adlar denetim kaydina yaziliyor ve
// ORADA KALIYORDU. Hangi adlarin HALA envantere girmedigini kimse bilmiyordu; ayni
// adi her hafta yeniden yazan bir kullanici sessizce yeniden yazmaya devam ediyordu.
//
// EN KRITIK KURAL UC HALDIR (IG2). Envanter okunamadiginda bir adi "hala yok" diye
// isaretlemek, BILINMEZLIGI SUCLAMA olarak yazmaktir: ekranda kirmizi bir "eksik"
// rozeti gorup envantere el ile kayit acan biri, ZATEN VAR OLAN bir kaydi ikinci kez
// olusturabilirdi. Bu, bu depoda tekrar eden bir hata sinifi (bkz. null vs [] karari,
// yetki kapilarinda fail-closed).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gaps = require('../inventory-gaps.cjs');
const ROOT = path.join(__dirname, '..', '..', '..', '..');

test('IG1 denetim `detail` ayristiricisi IKI bicimi de cozuyor', () => {
  // Bicim `server/logx/v2/index.cjs` tarafindan YAZILIR ve sabittir.
  assert.deepEqual(gaps.parseManualDetail('v2_legacy_manual_app', 'app=ODEME jobId=12'), {
    app: 'ODEME',
    hosts: [],
  });
  assert.deepEqual(
    gaps.parseManualDetail('v2_legacy_manual_host', 'app=ODEME hosts=GBA01,GBA02 jobId=12'),
    { app: 'ODEME', hosts: ['GBA01', 'GBA02'] },
  );
  // Tek sunucu da liste olarak cozulmeli.
  assert.deepEqual(gaps.parseManualDetail('v2_legacy_manual_host', 'app=X hosts=GBA01 jobId=1'), {
    app: 'X',
    hosts: ['GBA01'],
  });
  // Cozulemeyen satir SESSIZCE ATLANIR — uydurma bir ad uretmekten iyidir.
  assert.equal(gaps.parseManualDetail('v2_legacy_manual_host', 'jobId=12'), null);
  assert.equal(gaps.parseManualDetail('v2_legacy_manual_host', 'app=X jobId=12'), null);
});

test('IG2 envanter OKUNAMAZSA sonuc "hala_yok" DEGIL "kontrol_edilemedi"', async () => {
  const patlayan = {
    searchApps: async () => {
      throw new Error('DB kapali');
    },
    resolveHostsForApp: async () => {
      throw new Error('DB kapali');
    },
  };
  assert.equal(
    await gaps.resolveStatus({ kind: 'app', name: 'ODEME', app: 'ODEME' }, patlayan),
    'kontrol_edilemedi',
  );
  assert.equal(
    await gaps.resolveStatus({ kind: 'host', name: 'GBA01', app: 'ODEME' }, patlayan),
    'kontrol_edilemedi',
  );

  // SNAPSHOT DA BIR CEVAP DEGIL: `fallbackMode` envanterin SON BILINEN halidir.
  // Ondan "hala yok" sonucu cikarmak, bayat veriyi kanit saymaktir.
  const snapshot = {
    searchApps: async () => ({ apps: [], fallbackMode: true }),
    resolveHostsForApp: async () => [],
  };
  assert.equal(
    await gaps.resolveStatus({ kind: 'app', name: 'ODEME', app: 'ODEME' }, snapshot),
    'kontrol_edilemedi',
  );
});

test('IG3 envanter OKUNDUYSA iki hal de dogru ayirt ediliyor', async () => {
  const canli = {
    searchApps: async (q) => ({ apps: q === 'VAR' ? ['VAR'] : [], fallbackMode: false }),
    resolveHostsForApp: async (app) => (app === 'VARAPP' ? ['GBA01'] : []),
  };
  assert.equal(
    await gaps.resolveStatus({ kind: 'app', name: 'VAR', app: 'VAR' }, canli),
    'envantere_girdi',
  );
  assert.equal(
    await gaps.resolveStatus({ kind: 'app', name: 'YOK', app: 'YOK' }, canli),
    'hala_yok',
  );
  assert.equal(
    await gaps.resolveStatus({ kind: 'host', name: 'GBA01', app: 'VARAPP' }, canli),
    'envantere_girdi',
  );
  assert.equal(
    await gaps.resolveStatus({ kind: 'host', name: 'GBA09', app: 'VARAPP' }, canli),
    'hala_yok',
  );
});

test('IG4 toplama: ayni ad tekrarlarinda sayac/ilk-son gorulme dogru', () => {
  const rows = [
    {
      username: 'a',
      action: 'v2_legacy_manual_app',
      detail: 'app=ODEME jobId=1',
      created_at: '2026-09-01T10:00:00Z',
    },
    {
      username: 'b',
      action: 'v2_legacy_manual_app',
      detail: 'app=odeme jobId=2',
      created_at: '2026-09-05T10:00:00Z',
    },
    {
      username: 'a',
      action: 'v2_legacy_manual_host',
      detail: 'app=ODEME hosts=GBA01,GBA02 jobId=3',
      created_at: '2026-09-03T10:00:00Z',
    },
  ];
  const out = gaps.aggregate(rows);
  const app = out.find((r) => r.kind === 'app');
  assert.equal(app.name, 'ODEME');
  assert.equal(app.count, 2, 'buyuk/kucuk harf ayni ad sayilmali');
  assert.equal(app.userCount, 2);
  assert.equal(app.firstSeen, '2026-09-01T10:00:00.000Z');
  assert.equal(app.lastSeen, '2026-09-05T10:00:00.000Z');

  const hosts = out
    .filter((r) => r.kind === 'host')
    .map((r) => r.name)
    .sort();
  assert.deepEqual(hosts, ['GBA01', 'GBA02'], 'coklu sunucu listesi tek tek ayrilmali');
});

test('IG5 uc ADMIN-ONLY', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/logx/v2/index.cjs'), 'utf8');
  const i = src.indexOf("'/admin/inventory-gaps'");
  assert.ok(i > 0, 'uc tanimlanmamis');
  // Route tanimindan SONRAKI kisa pencerede requireAdmin olmali. Pencere degil YAPI
  // olculur: `router.get(` cagrisinin argumanlari paren esleyerek okunur.
  const callStart = src.lastIndexOf('router.get(', i);
  assert.ok(callStart >= 0, 'router.get cagrisi bulunamadi');
  let depth = 0;
  let end = -1;
  for (let k = src.indexOf('(', callStart); k < src.length; k++) {
    if (src[k] === '(') depth++;
    else if (src[k] === ')' && --depth === 0) {
      end = k;
      break;
    }
  }
  const args = src.slice(callStart, end);
  assert.match(
    args,
    /requireAdmin/,
    'envanter bosluklari ucu ADMIN-ONLY degil — elle girilen adlar ve onlari giren ' +
      'kullanicilar herkese acilir',
  );
});

test('IG6 ekran uc hali AYRI AYRI gosteriyor (bilinmezlik eksiklik gibi sunulmuyor)', () => {
  const ui = fs.readFileSync(
    path.join(ROOT, 'src/components/admin/tabs/InventoryGapsTab.tsx'),
    'utf8',
  );
  for (const s of ['hala_yok', 'envantere_girdi', 'kontrol_edilemedi']) {
    assert.match(ui, new RegExp(s), `${s} hali ekranda ele alinmamis`);
  }
  // "kontrol edilemedi" ayri bir metinle ANLATILMALI; sessizce kirmiziya boyanmamali.
  const flat = ui.replace(/\s+/g, ' ');
  assert.match(
    flat,
    /eksik olmayabilir/i,
    'ekran "kontrol edilemedi"nin bir EKSIKLIK OLMADIGINI soylemiyor',
  );
  // SAYACLAR SUZGECTEN BAGIMSIZ OLMALI: suzgec acikken "3 eksik" yazmasi, suzgecin
  // gizlediklerini yok saymak olurdu.
  //
  // OLCUT BICIM DEGIL: ilk hali prettier'in urettigi TEK SATIRLIK govdeyi birebir
  // esliyordu; dosyaya dokunan ilk bicimlendirme bekciyi kirardi. Artik `sayac`
  // hesabinin GOVDESI cikarilip hangi listeden turetildigi olculuyor.
  const k = ui.indexOf('const sayac = useMemo(');
  assert.ok(k > 0, 'sayac hesabi bulunamadi');
  let depth = 0;
  let end = -1;
  for (let x = ui.indexOf('(', k); x < ui.length; x++) {
    if (ui[x] === '(') depth++;
    else if (ui[x] === ')' && --depth === 0) {
      end = x;
      break;
    }
  }
  const sayacBody = ui.slice(k, end);
  assert.match(sayacBody, /\brows\b/, 'sayac ham listeden turetilmiyor');
  assert.doesNotMatch(
    sayacBody,
    /\bgorunen\b/,
    'sayaclar SUZGECLENMIS listeden turetiliyor — suzgec acikken yanlis sayi gosterir',
  );
});
