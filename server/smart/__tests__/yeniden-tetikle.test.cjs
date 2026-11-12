// server/smart/__tests__/yeniden-tetikle.test.cjs - zaman asimina dusmus talebi admin yeniden
// tetikler (2026-11-11). Kurallar server/smart/yeniden-tetikle.cjs basinda.
//   YT1 yalniz TIMEOUT; baslatma paketi yoksa / Crypto Hub biletiyse reddedilir
//   YT2 Smart: reddedildi ve okunamadi ENGEL (fail-closed); onayli / bekliyor gecer
//   YT3 gerekce zorunlu; OCO'lu talepte mod zorunlu; pencere disi ayri onay kutusu ister;
//       eski OCO numarasi yeniden girilemez; OCO'suz talep 'dogrudan'
//   YT4 yeni OCO degiskenleri kaynak nesneye dokunmaz
//   YT5 rota SIRASI (statik): Smart engeli ve OCO penceresi SAHIPLENMEDEN once; sahiplenme
//       AWX cagrisindan once; rota requireAdmin ile korunur
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const rt = require('../yeniden-tetikle.cjs');

const ocoTalep = (o = {}) => ({
  id: 329,
  status: 'TIMEOUT',
  externalTicketId: '23817089',
  pendingLaunch: {
    detail: { id: 876 },
    extraVars: { action: 'create', oco_number: '23737284', env: 'prod' },
    ocoWindowStartIso: '2026-11-10T20:00:00.000Z',
    ocoWindowEndIso: '2026-11-10T23:00:00.000Z',
  },
  ...o,
});
const duzTalep = () => ({ id: 5, status: 'TIMEOUT', pendingLaunch: { detail: { id: 1 }, extraVars: { a: '1' } } });
const NOT = 'onayci izinde, ekip lideri onay verdi';

test('YT1 uygunluk', () => {
  assert.equal(rt.uygunluk(null).status, 404);
  for (const s of ['PENDING', 'LAUNCHING', 'LAUNCHED', 'REJECTED', 'CANCELLED', 'ERROR', 'SCHEDULED']) {
    const u = rt.uygunluk(ocoTalep({ status: s }));
    assert.equal(u.ok, false, s);
    assert.equal(u.status, 409);
  }
  assert.equal(rt.uygunluk(ocoTalep()).ok, true);
  assert.equal(rt.uygunluk(ocoTalep({ pendingLaunch: null })).ok, false);
  assert.equal(rt.uygunluk(ocoTalep({ pendingLaunch: { extraVars: {} } })).ok, false);
  const crypto = ocoTalep();
  crypto.pendingLaunch.launchOncesi = 'crypto_hub_node';
  assert.equal(rt.uygunluk(crypto).ok, false);
});

test('YT2 Smart karari (fail-closed)', () => {
  const k = (status) => rt.smartKarari({ status });
  assert.equal(k({ rejected: true, statusCode: '2000' }).durum, 'reddedildi');
  assert.equal(k({ statusCode: '2000' }).engel, true, 'bayrak olmasa da 2000 red');
  for (const ad of ['_CANCEL_', 'İptal Edildi', 'IPTAL', 'Reddedildi', 'Rejected']) {
    assert.equal(k({ statusCode: '777', stateName: ad }).engel, true, ad);
  }
  const ok = rt.smartKarari({ hata: 'ECONNRESET' });
  assert.equal(ok.engel, true);
  assert.equal(ok.durum, 'okunamadi');
  assert.match(ok.message, /ECONNRESET/);
  assert.equal(k({ stateName: 'Çalışıyor' }).engel, true, 'bos kod engel');
  assert.equal(k({ statusCode: '  ' }).durum, 'okunamadi');
  assert.equal(k({ completed: true, statusCode: '1000' }).durum, 'onayli');
  assert.equal(k({ completed: true, statusCode: '1000' }).engel, false);
  assert.equal(k({ statusCode: '50', stateName: 'Onay Bekliyor' }).durum, 'bekliyor');
  const bil = k({ statusCode: '300', stateName: 'Çalışıyor' });
  assert.equal(bil.durum, 'bilinmiyor');
  assert.equal(bil.engel, false);
  assert.equal(bil.statusCode, '300');
  assert.match(bil.message, /kod 300.*Çalışıyor/);
  // Ad icinde 'red' gecen ama red olmayan durum (Kredi, Registered) engellenmez.
  assert.equal(k({ statusCode: '300', stateName: 'Kredi Onayi' }).engel, false);
  assert.equal(k({ statusCode: '300', stateName: 'Registered' }).engel, false);
  // Reddedildi bayragi tamamlandi bayragindan once gelir.
  assert.equal(k({ completed: true, rejected: true, statusCode: '1000' }).engel, true);
});

test('YT3 istek dogrulama', () => {
  const t = ocoTalep();
  assert.equal(rt.istekDogrula({ mode: 'pencereDisi', outsideWindowConfirm: true }, t).ok, false, 'gerekce yok');
  assert.equal(rt.istekDogrula({ note: 'kisa', mode: 'pencereDisi', outsideWindowConfirm: true }, t).ok, false);
  assert.equal(rt.istekDogrula({ note: 'x'.repeat(1001), mode: 'pencereDisi', outsideWindowConfirm: true }, t).ok, false);
  assert.equal(rt.istekDogrula({ note: NOT }, t).ok, false, 'OCO talebinde mod zorunlu');
  assert.equal(rt.istekDogrula({ note: NOT, mode: 'pencereDisi' }, t).ok, false, 'onay kutusu yok');
  assert.equal(rt.istekDogrula({ note: NOT, mode: 'pencereDisi', outsideWindowConfirm: 'true' }, t).ok, false, 'yalniz true');
  const pd = rt.istekDogrula({ note: `  ${NOT}  `, mode: 'pencereDisi', outsideWindowConfirm: true }, t);
  assert.deepEqual(pd, { ok: true, mod: 'pencereDisi', not: NOT, ocoNumber: '' });
  assert.equal(rt.istekDogrula({ note: NOT, mode: 'oco', ocoNumber: '' }, t).ok, false);
  assert.equal(rt.istekDogrula({ note: NOT, mode: 'oco', ocoNumber: '12a45' }, t).ok, false);
  assert.equal(rt.istekDogrula({ note: NOT, mode: 'oco', ocoNumber: '23737284' }, t).ok, false, 'eski OCO');
  assert.deepEqual(rt.istekDogrula({ note: NOT, mode: 'oco', ocoNumber: ' 23800001 ' }, t), { ok: true, mod: 'oco', not: NOT, ocoNumber: '23800001' });
  assert.equal(rt.istekDogrula({ note: NOT, mode: 'baska' }, t).ok, false);
  // OCO'suz talep: mod ne gelirse gelsin 'dogrudan'.
  assert.equal(rt.istekDogrula({ note: NOT, mode: 'pencereDisi' }, duzTalep()).mod, 'dogrudan');
  assert.equal(rt.ocoKapsamli(duzTalep()), false);
  // Yalniz oco_number tasiyan (pencere alani olmayan) talep de OCO'lu sayilir.
  assert.equal(rt.ocoKapsamli({ pendingLaunch: { extraVars: { oco_number: '1234' } } }), true);
  assert.equal(rt.ocoKapsamli({ pendingLaunch: { ocoRecordId: 9, extraVars: {} } }), true);
});

test('YT4 yeni OCO degiskenleri kaynagi degistirmez', () => {
  const kaynak = { a: '1', oco_number: '1' };
  const yeni = rt.yeniOcoDegiskenleri(kaynak, '999999', { windowStartText: 'S', windowEndText: 'E' });
  assert.deepEqual(yeni, { a: '1', oco_number: '999999', oco_window_start: 'S', oco_window_end: 'E' });
  assert.deepEqual(kaynak, { a: '1', oco_number: '1' });
  const m = rt.sonucMetni({ admin: 'onur', mod: 'pencereDisi', smartDurum: 'bekliyor', not: NOT });
  assert.match(m, /admin onur/);
  assert.match(m, /DIŞINDA/);
  assert.match(m, /atlandı/);
  assert.match(rt.sonucMetni({ admin: 'o', mod: 'oco', ocoNumber: '42424', smartDurum: 'onayli', not: NOT, zamanlandi: '12.11.2026 23:00' }), /42424.*zamanlandı.*onaylamıştı/);
});

test('YT5 rota sirasi ve yetki (statik)', () => {
  const kod = fs.readFileSync(path.join(__dirname, '../../ansible/runner.cjs'), 'utf8');
  const bas = kod.indexOf("app.post('/api/ansible/ss/smart-ticket/:id/retrigger'");
  assert.ok(bas > 0, 'rota yok');
  const govde = kod.slice(bas, kod.indexOf('app.get(', bas + 10));
  assert.match(govde.slice(0, 200), /requireAuth, requireAdmin/);
  assert.match(kod, /app\.get\('\/api\/ansible\/ss\/smart-ticket\/:id\/retrigger-check', requireAuth, requireAdmin/);
  const i = (s) => {
    const n = govde.indexOf(s);
    assert.ok(n > 0, `bulunamadi: ${s}`);
    return n;
  };
  const engel = i('if (smart.engel)');
  const gecmis = i("pencere.phase === 'expired'");
  const claim = i('claimTimeoutForRetrigger(');
  const zamanla = i('createOcoAwxSchedule(');
  const launch = i('performSsLaunch(');
  assert.ok(engel < claim && gecmis < claim, 'Smart engeli ve gecmis pencere sahiplenmeden ONCE');
  assert.ok(i('retriggerScalexBagliMi(') < claim, 'ScaleX bileti sahiplenmeden ONCE reddedilir');
  assert.ok(i("sonuc: 'LAUNCHED'") < i("status: 'LAUNCHED', smartStateName"), 'basari denetimi bilet yaziminden ONCE');
  assert.ok(i("sonuc: 'SCHEDULED'") < i("status: 'SCHEDULED', smartStateName"), 'zamanlama denetimi bilet yaziminden ONCE');
  assert.equal((govde.match(/markRetriggered\(ocoRecordId/g) || []).length, 2, 'OCO kaydi iki dalda da (zamanla + hemen) guncellenir');
  assert.match(govde, /createAwxScheduled\(/);
  assert.ok(claim < zamanla && claim < launch, 'sahiplenme AWX cagrisindan ONCE');
  assert.ok(govde.indexOf('basladi = true', launch) > launch, 'launch sonrasi basladi bayragi');
  assert.ok(govde.indexOf('basladi = true', zamanla) > zamanla, 'zamanlama sonrasi basladi bayragi');
  assert.ok(govde.indexOf('if (basladi)') < govde.indexOf("status: 'ERROR'"), 'is basladiysa ERROR yazilmaz');
});
