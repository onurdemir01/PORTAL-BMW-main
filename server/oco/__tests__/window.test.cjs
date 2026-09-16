// server/oco/__tests__/window.test.cjs — OCO kesinti penceresi kurali ve production
// tespiti. Ikisi de SAF fonksiyon oldugu icin ag/DB olmadan birebir test edilebilir.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { evaluateWindow, parseOcoDate, extractPlannedInterruption } = require('../window.cjs');
const { isProductionRequest } = require('../prod-detect.cjs');

const at = (s) => parseOcoDate(s);

test('parseOcoDate: dd.MM.yyyy HH:mm:ss ayristirilir', () => {
  const d = parseOcoDate('25.08.2026 22:00:00');
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 7);      // Agustos
  assert.strictEqual(d.getDate(), 25);
  assert.strictEqual(d.getHours(), 22);
});

test('parseOcoDate: GUN/AY karismaz (13. ay yok, 25. gun var)', () => {
  // "05.08" -> 5 Agustos olmali, 8 Mayis DEGIL.
  const d = parseOcoDate('05.08.2026 10:00:00');
  assert.strictEqual(d.getMonth(), 7);
  assert.strictEqual(d.getDate(), 5);
});

test('parseOcoDate: gecersiz gun KAYDIRILMAZ, null doner', () => {
  // JS'te new Date(2026,1,31) 3 Mart'a kayar - sessizce baska bir gune oturmamali.
  assert.strictEqual(parseOcoDate('31.02.2026 10:00:00'), null);
  assert.strictEqual(parseOcoDate('bos'), null);
  assert.strictEqual(parseOcoDate(null), null);
});

test('esit tarihler: pencere 2 SAAT olur', () => {
  const w = evaluateWindow({
    startDate: '25.08.2026 22:00:00', endDate: '25.08.2026 22:00:00',
    now: at('25.08.2026 21:00:00'),
  });
  assert.strictEqual(w.ok, true);
  assert.strictEqual(w.equal, true);
  assert.strictEqual(w.windowEndText, '26.08.2026 00:00:00');
  assert.strictEqual(w.phase, 'before');
  assert.strictEqual(w.canSchedule, true);
  assert.strictEqual(w.canRunNow, false);
});

test('esit tarihler: 2 saatin ICINDE hemen calistirilabilir', () => {
  for (const nowStr of ['25.08.2026 22:00:00', '25.08.2026 23:59:59', '26.08.2026 00:00:00']) {
    const w = evaluateWindow({
      startDate: '25.08.2026 22:00:00', endDate: '25.08.2026 22:00:00', now: at(nowStr),
    });
    assert.strictEqual(w.phase, 'inside', nowStr);
    assert.strictEqual(w.canRunNow, true, nowStr);
  }
});

test('esit tarihler: 2 saati ASARSA kacirilmis sayilir', () => {
  const w = evaluateWindow({
    startDate: '25.08.2026 22:00:00', endDate: '25.08.2026 22:00:00',
    now: at('26.08.2026 00:00:01'),
  });
  assert.strictEqual(w.phase, 'expired');
  assert.strictEqual(w.canRunNow, false);
  assert.strictEqual(w.canSchedule, false);
  assert.match(w.message, /kaçırdınız/);
});

test('farkli tarihler: verilen ARALIK baz alinir, 2 saat kurali UYGULANMAZ', () => {
  const args = { startDate: '25.08.2026 22:00:00', endDate: '26.08.2026 02:00:00' };
  const inside = evaluateWindow({ ...args, now: at('26.08.2026 01:30:00') });
  assert.strictEqual(inside.equal, false);
  assert.strictEqual(inside.windowEndText, '26.08.2026 02:00:00');
  assert.strictEqual(inside.phase, 'inside');   // 2 saat kurali olsaydi 00:00'da bitecekti

  const after = evaluateWindow({ ...args, now: at('26.08.2026 02:00:01') });
  assert.strictEqual(after.phase, 'expired');
});

test('bitis okunamazsa baslangica ESIT sayilir (sinirsiz izin YOK)', () => {
  const w = evaluateWindow({
    startDate: '25.08.2026 22:00:00', endDate: null, now: at('26.08.2026 00:00:01'),
  });
  assert.strictEqual(w.equal, true);
  assert.strictEqual(w.phase, 'expired');
});

test('bozuk aralik (bitis < baslangic) reddedilir', () => {
  const w = evaluateWindow({
    startDate: '25.08.2026 22:00:00', endDate: '25.08.2026 20:00:00', now: at('25.08.2026 21:00:00'),
  });
  assert.strictEqual(w.ok, false);
  assert.strictEqual(w.reason, 'INVALID_RANGE');
});

test('baslangic okunamazsa hata doner (izin verilmez)', () => {
  const w = evaluateWindow({ startDate: 'yok', endDate: 'yok' });
  assert.strictEqual(w.ok, false);
  assert.strictEqual(w.reason, 'PARSE');
});

test('extractPlannedInterruption: gercek OCO cevabindan alanlari cikarir', () => {
  const payload = {
    GetChangeOrderByWfInstanceIdResult: {
      Result: {
        OcoWfInstanceId: 22502813,
        PlannedInterruption: {
          InterruptionEndDate: '25.08.2026 22:00:00',
          InterruptionStartDate: '25.08.2026 22:00:00',
        },
      },
      ResultCode: 1000,
    },
  };
  const pi = extractPlannedInterruption(payload);
  assert.strictEqual(pi.startDate, '25.08.2026 22:00:00');
  assert.strictEqual(pi.endDate, '25.08.2026 22:00:00');
});

test('extractPlannedInterruption: Result yoksa null', () => {
  assert.strictEqual(extractPlannedInterruption({ GetChangeOrderByWfInstanceIdResult: { Result: null } }), null);
  assert.strictEqual(extractPlannedInterruption({}), null);
});

test('production tespiti: env/ortam x prod/production, harf duyarsiz', () => {
  for (const ev of [{ env: 'prod' }, { env: 'production' }, { ortam: 'prod' }, { ortam: 'production' },
                    { ENV: 'PROD' }, { Ortam: 'Production' }, { env: '  prod  ' }]) {
    assert.strictEqual(isProductionRequest(ev), true, JSON.stringify(ev));
  }
});

test('production tespiti: baska deger/alan PRODUCTION SAYILMAZ', () => {
  for (const ev of [{ env: 'test' }, { env: 'qa' }, { env: 'preprod' }, { environment: 'prod' },
                    { ortamx: 'prod' }, {}, null]) {
    assert.strictEqual(isProductionRequest(ev), false, JSON.stringify(ev));
  }
});

// ── PlannedStartDate / PlannedEndDate (WCF tarihi), 2026-09-16 ───────────────────────
// Bazi OCO'larda PlannedInterruption YOK; kayit "/Date(1789605000000+0300)/" biciminde
// PlannedStartDate/PlannedEndDate tasiyor. Parantez icindeki sayi epoch MILISANIYE;
// "+0300" bilgi amacli (hesaba katilmaz).
test('parseOcoDate: WCF "/Date(ms+0300)/" bicimi epoch milisaniyeden okunur', () => {
  const d = parseOcoDate('/Date(1789605000000+0300)/');
  assert.ok(d instanceof Date);
  assert.equal(d.getTime(), 1789605000000);
  assert.equal(parseOcoDate('/Date(1789605000000)/').getTime(), 1789605000000, 'dilimsiz bicim de okunur');
  assert.equal(parseOcoDate('/Date(abc)/'), null);
  // dilim eki hesaba KATILMAZ: +0300 ile -0500 ayni ani verir
  assert.equal(parseOcoDate('/Date(1789605000000-0500)/').getTime(), 1789605000000);
});

test('extractPlannedInterruption: PlannedStartDate/PlannedEndDate ONCELIKLI, PlannedInterruption yedek', () => {
  const planned = {
    GetChangeOrderByWfInstanceIdResult: {
      Result: {
        PlannedStartDate: '/Date(1789605000000+0300)/',
        PlannedEndDate: '/Date(1789614000000+0300)/',
        // ikisi birden varsa Planned* kazanir
        PlannedInterruption: { InterruptionStartDate: '01.01.2020 00:00:00', InterruptionEndDate: '01.01.2020 00:00:00' },
      },
    },
  };
  const a = extractPlannedInterruption(planned);
  assert.equal(a.source, 'planned');
  assert.equal(a.startDate, '/Date(1789605000000+0300)/');
  const w = evaluateWindow({ startDate: a.startDate, endDate: a.endDate, now: new Date(1789605000000 + 60000) });
  assert.equal(w.ok, true);
  assert.equal(w.phase, 'inside');
  assert.equal(w.equal, false, 'baslangic != bitis: verilen aralik (2.5 saat), 2 saat kurali uygulanmaz');
  assert.equal(w.windowEnd.getTime(), 1789614000000);

  const legacy = {
    GetChangeOrderByWfInstanceIdResult: {
      Result: { PlannedInterruption: { InterruptionStartDate: '25.08.2026 22:00:00', InterruptionEndDate: '25.08.2026 22:00:00' } },
    },
  };
  const b = extractPlannedInterruption(legacy);
  assert.equal(b.source, 'interruption');
  assert.equal(b.startDate, '25.08.2026 22:00:00');

  // Planned* bos dizgeyse yedege duser; hicbiri yoksa null
  const empty = { GetChangeOrderByWfInstanceIdResult: { Result: { PlannedStartDate: '', PlannedInterruption: { InterruptionStartDate: '25.08.2026 22:00:00' } } } };
  assert.equal(extractPlannedInterruption(empty).source, 'interruption');
  assert.equal(extractPlannedInterruption({ GetChangeOrderByWfInstanceIdResult: { Result: { Subject: 'x' } } }), null);
});
