// server/oco/__tests__/smart-first-scheduling.test.cjs — "ONAY ÖNCE, ZAMANLAMA SONRA" (2026-09-22).
//
// Kullanici: "OCO 23:00'te, personel 15:00'te giriyor. Bugun Smart bileti 23:00'te aciliyor ve
// personelin gece gelip onaylamasi gerekiyor — bu sacma. Onay mesai icinde alinsin, is onaydan
// sonra OCO penceresine zamanlansin; pencere o an aciksa hemen calissin, kapandiysa (OCO araligi
// izin veriyorsa) ertesi gune."
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { nextRunAt } = require('../window.cjs');

const D = (s) => new Date(s);

test('OS1 OCO 18:00, giris/onay 15:00 -> is 18:00 penceresine ZAMANLANIR', () => {
  const r = nextRunAt({ windowStart: D('2026-09-22T18:00:00'), windowEnd: D('2026-09-22T20:00:00'), now: D('2026-09-22T15:00:00') });
  assert.equal(r.mode, 'schedule');
  assert.equal(r.runAt.toISOString(), D('2026-09-22T18:00:00').toISOString());
  assert.match(r.reason, /18:00/);
});

test('OS2 OCO 23:00, giris/onay 15:00 -> is 23:00 penceresine ZAMANLANIR', () => {
  const r = nextRunAt({ windowStart: D('2026-09-22T23:00:00'), windowEnd: D('2026-09-23T01:00:00'), now: D('2026-09-22T15:00:00') });
  assert.equal(r.mode, 'schedule');
  assert.equal(r.runAt.getHours(), 23);
});

test('OS3 OCO 23:00, onay 23:30 ve pencere ACIK -> is HEMEN calisir', () => {
  const r = nextRunAt({ windowStart: D('2026-09-22T23:00:00'), windowEnd: D('2026-09-23T01:00:00'), now: D('2026-09-22T23:30:00') });
  assert.equal(r.mode, 'now');
  assert.match(r.reason, /hemen/);
});

test('OS4 OCO araligi cok gunluyse gec gelen onayda is HEMEN calisir (pencere hala acik)', () => {
  // Kesinti araligi 22.09 23:00 - 24.09 06:00; onay 23.09 09:00'da geldi -> pencere ACIK
  const r = nextRunAt({ windowStart: D('2026-09-22T23:00:00'), windowEnd: D('2026-09-24T06:00:00'), now: D('2026-09-23T09:00:00') });
  assert.equal(r.mode, 'now', 'OCO araligi surdugu surece is calisir');
});

test('OS5 pencere tamamen gecti -> calistirilamaz (yeni OCO gerekir)', () => {
  const r = nextRunAt({ windowStart: D('2026-09-22T23:00:00'), windowEnd: D('2026-09-23T01:00:00'), now: D('2026-09-24T09:00:00') });
  assert.equal(r.mode, 'none');
  assert.match(r.reason, /yeni bir OCO/i);
});

test('OS6 pencerenin son saniyesinde gelen onay kacmasin (grace)', () => {
  const r = nextRunAt({ windowStart: D('2026-09-22T23:00:00'), windowEnd: D('2026-09-23T01:00:00'), now: D('2026-09-23T01:00:30') });
  assert.equal(r.mode, 'now');
});

test('OS7 akis sozlesmesi: bilet TALEP ANINDA acilir, onay sonrasi AWX schedule kurulur, bilet SCHEDULED kapanir', () => {
  const gates = fs.readFileSync(path.join(__dirname, '..', '..', 'ansible', 'change-gates.cjs'), 'utf8');
  assert.ok(/if \(smartAlsoRequired\) \{[\s\S]{0,400}openSmartTicket\(/.test(gates), 'OCO before + Smart -> bilet hemen acilmali');
  assert.ok(/ocoWindowStartIso/.test(gates) && /ocoWindowEndIso/.test(gates), 'pencere bilete gomulmeli');
  assert.ok(/smartFirst: true/.test(gates), 'istemciye smartFirst bildirilmeli');
  assert.ok(/markPendingApproval\(rec\.id/.test(gates), 'OCO kaydi onay bekliyor olarak isaretlenmeli');

  const runner = fs.readFileSync(path.join(__dirname, '..', '..', 'ansible', 'runner.cjs'), 'utf8');
  const cb = runner.slice(runner.indexOf('startPoller(async (ticket)'), runner.indexOf('launchOrRequestApproval'));
  assert.ok(/nextRunAt\(/.test(cb), 'onay geldiginde pencere yeniden degerlendirilmeli');
  assert.ok(/createOcoAwxSchedule\(/.test(cb), 'pencere ileride ise AWX schedule kurulmali');
  assert.ok(/markAwxScheduledAfterApproval\(/.test(cb), 'OCO kaydi zamanlandi olarak guncellenmeli');
  assert.ok(/plan\.mode === 'none'/.test(cb) && /throw new Error\(plan\.reason\)/.test(cb), 'pencere gectiyse is TETIKLENMEMELI');

  const poller = fs.readFileSync(path.join(__dirname, '..', '..', 'smart', 'poller.cjs'), 'utf8');
  assert.ok(/outcome\.scheduled/.test(poller) && /status: 'SCHEDULED'/.test(poller), 'zamanlanan is LAUNCHED sayilmamali');
  assert.ok(/ocoWindowEndIso/.test(poller), 'OCO biletinde sure siniri pencere sonuna kadar uzamali');

  const page = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'SelfServicePage.tsx'), 'utf8');
  assert.ok(/r\.smartFirst/.test(page) && /kesinti saatini beklemenize gerek yok/.test(page), 'kullaniciya akis anlatilmali');
});

// Kullanici (2026-09-22, ekran goruntusu ile): "Smart kaydi tetiklendi ama ekrana hangi
// kaydin acildigini gostermiyor. Birde su ekranda bembeyaz bos alan gozukuyor. Bu tarz
// UI/UX sorunu yasamak istemiyorum." + "Iptal'e basmanin bir anlami yok, sayfa surekli
// ayni kaliyor." + "Bazi job'larda ayni ekranda Ansible ciktisi aktigini unutma."
test('OS8 OCO sonuc paneli: mesaj TEKRARLANMAZ, Smart kayit no gorunur, bos kutu kalmaz', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'SelfServicePage.tsx'), 'utf8');

  // 1) Ayni cumle hem sari baslikta hem yesil kutuda ciziliyordu.
  assert.ok(/ocoState\.phase !== 'done' && \(/.test(page), "'done' asamasinda sari baslik cizilmemeli");
  const doneCard = page.slice(page.indexOf('data-testid="oco-done"'), page.indexOf('data-testid="oco-done"') + 4000);
  assert.ok(!/\{ocoState\.message\}\s*<\/div>/.test(doneCard), 'sonuc kutusu tek satir mesaj kutusu olmamali');

  // 2) Acilan Smart kaydinin numarasi EKRANDA.
  assert.ok(/data-testid="oco-smart-no"/.test(page), 'Smart kayit no alani olmali');
  assert.ok(/Smart Kayıt No/.test(doneCard) && /externalTicketId/.test(doneCard), 'kayit no sonuc kartinda gosterilmeli');
  assert.ok(/title=\{ocoState\.done\.externalTicketId\}/.test(doneCard), 'kisalan numara title ile tam gorunmeli');

  // 3) Bilet paneli: ekranda karsiligi olmayan durum BOS KUTU birakmasin.
  assert.ok(/RENDERED_TICKET_STATES/.test(page), 'bilinmeyen bilet durumu icin yedek gosterim olmali');
  assert.ok(/pendingTicket\.status === 'SCHEDULED'/.test(page), 'SCHEDULED durumunun ekran karsiligi olmali');

  // 4) OCO sonucu, bilet paneliyle BIRLIKTE gorunur (ikisi de ayni ekranda).
  assert.ok(/!pendingTicket \|\| ocoState\.phase === 'done'/.test(page), 'sonuc karti bilet acikken de gorunmeli');

  // 5) Inline formda "Iptal" yerine ne yaptigini soyleyen dugme.
  assert.ok(/Formu Temizle/.test(page) && /Yeni Talep/.test(page), 'inline dugme yaptigi isi soylemeli');
  assert.ok(/disabled=\{jobStreaming \|\| \(!resultView && !formDirty\)\}/.test(page), 'bos formda ve is akarken pasif olmali');
  assert.ok(/data-testid="ss-form-reset-note"/.test(page), 'sifirlama gorunur bir bildirim birakmali');

  // 6) Ansible ciktisi ayni ekranda akarken form sifirlanamaz.
  assert.ok(/const JOB_FINISHED = /.test(page) && /jobStreaming/.test(page), 'canli cikti korunmali');
});
