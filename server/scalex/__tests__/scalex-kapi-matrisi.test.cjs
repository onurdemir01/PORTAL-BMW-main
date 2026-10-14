// server/scalex/__tests__/scalex-kapi-matrisi.test.cjs
//
// ScaleX ONAY KAPILARI — DAVRANIS MATRISI (2026-10-14).
//
// URETIM OLAYI (2026-10-13, bes istek): kullanici prod'da DOGRU bir OCO numarasi girdi,
// sunucu OCO'yu gecirdi ve ARDINDAN `503 smart_not_configured` dondu. Ters-proxy 5xx
// govdesini degistirdigi icin ekran "portal yeniden baslatiliyor, tekrar deneyin" yazdi.
// SMART ScaleX icin hic tanimlanmamisti; tanimlansaydi da bilet acilamazdi (metadata
// dizi olarak uretiliyordu).
//
// Bu dosya KAYNAK METNINE bakmaz. Istegi gercek yonlendiriciden gecirir (bkz.
// fixtures/scalex-sim.cjs) ve su degismezleri OLCER:
//   (1) gereken kapilar gecmeden AWX'te is BASLAMAZ
//   (2) SMART gerekli + hazir degil -> ne baslatma, ne zamanlama, ne OCO sorgusu
//   (3) her ret 4xx'tir ve mesaj tasir (5xx govdesi kullaniciya ulasmiyor)
//   (4) baslayan / onay bekleyen / zamanlanan her is `scalex_operations`ta
//   (5) `/preview`in soyledigi = `/run`in yaptigi
//   (6) SMART'siz gecen her prod degisikligi denetimde
//
// BEKLENEN SONUC asagidaki `beklenen()` ile uretilir: uygulamadan BAGIMSIZ, duz bir karar
// tablosu. Uygulama degisir de tablo ile ayrisirsa hangi hucrenin ayristigi adiyla yazilir.
'use strict';

// Ornek yazma bayragi. Adi BILEREK `SCALEX_` ile baslamiyor: o onek urun ayarlarina ayrili —
// simulator yuklenirken hepsini siler ve devreye alma on kontrolu (preflight PF6) her
// birini `.env.example`da arar. Bir test bayragi orada yer almamali.
const ORNEK_YAZ = process.env.KAPI_ORNEK_YAZ === '1';

const sim = require('./fixtures/scalex-sim.cjs');
const test = require('node:test');
const assert = require('node:assert');

test.before(() => sim.baslat());
test.after(() => sim.durdur());
test.beforeEach(() => sim.sifirla());

const OCO_NO = '1234567';

// ── KARAR TABLOSU ────────────────────────────────────────────────────────────
function beklenen(s) {
  if (s.mode !== 'apply' || s.env !== 'prod') return { sonuc: 'baslar', smart: 'yok' };
  let smart;
  if (s.kip === 'oco_only') smart = 'kapali';
  else if (s.kim === 'yonetici-atlar') smart = 'atla';
  else if (s.smart === 'hazir') smart = 'hazir';
  else smart = 'eksik';
  if (smart === 'eksik') return { sonuc: 'engel', smart };
  if (s.action !== 'restore') {
    if (s.oco === 'numarasiz') return { sonuc: 'oco_iste', smart };
    if (s.oco === 'yok' || s.oco === 'servis_hatasi') return { sonuc: 'oco_iste', smart };
    if (s.oco === 'tarihsiz') return { sonuc: 'oco_ret', smart };
    if (s.oco === 'gecti') return { sonuc: 'oco_gecti', smart };
    if (s.oco === 'once') {
      const zamanlanabilir = smart === 'kapali' || smart === 'atla';
      return {
        sonuc: s.eylem === 'schedule' && zamanlanabilir ? 'zamanlandi' : 'ertelendi',
        smart,
      };
    }
  }
  return { sonuc: smart === 'hazir' ? 'onay' : 'baslar', smart };
}

const SMART_DURUMU = {
  kapali: 'disabled_by_admin',
  atla: 'admin_skip',
  hazir: 'ready',
  eksik: 'not_configured',
  yok: 'not_applicable',
};

function kur(s) {
  sim.sifirla();
  sim.smartKipi(s.kip === 'oco_only' ? 'oco_only' : s.kip === 'required' ? 'required' : undefined);
  if (s.smart === 'hazir' || s.smart === 'baglantisiz')
    sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR } };
  if (s.smart === 'akissiz')
    sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR, flowKey: '' } };
  if (s.smart === 'baglantisiz') sim.ayar.smartBaglanti = false;
  if (s.kim === 'ayse') sim.ayar.kullanici = sim.KULLANICILAR.ayse;
  if (s.kim === 'ayse-tercihli') {
    // Tercih anahtari yalniz Admin icin anlamli; siradan kullanicida dolu olsa da ATLANMAZ.
    sim.ayar.kullanici = sim.KULLANICILAR.ayse;
    sim.adminAtlasin('ayse');
  }
  if (s.kim === 'yonetici') sim.ayar.kullanici = sim.KULLANICILAR.yonetici;
  if (s.kim === 'yonetici-atlar') {
    sim.ayar.kullanici = sim.KULLANICILAR.yonetici;
    sim.adminAtlasin('yonetici');
  }
  if (s.oco !== 'numarasiz') sim.ayar.oco = s.oco;
  return {
    env: s.env,
    action: s.action,
    executionMode: s.mode,
    ...(s.action === 'scale' ? { targetReplicas: 2 } : {}),
    ...(s.action === 'restore' ? { reason: 'INC-42 geri alma' } : {}),
    ...(s.oco !== 'numarasiz' ? { ocoNumber: OCO_NO } : {}),
    ...(s.eylem === 'schedule' ? { ocoAction: 'schedule' } : {}),
  };
}

const etiket = (s) =>
  `${s.env}/${s.action}/${s.mode} kip=${s.kip} smart=${s.smart} kim=${s.kim} oco=${s.oco} eylem=${s.eylem}`;

function* hucreler() {
  const KIP = ['varsayilan', 'oco_only'];
  const SMART = ['yok', 'hazir', 'akissiz', 'baglantisiz'];
  const KIM = ['ayse', 'ayse-tercihli', 'yonetici', 'yonetici-atlar'];
  const OCO = ['numarasiz', 'yok', 'servis_hatasi', 'tarihsiz', 'gecti', 'once', 'icinde'];
  // prod + apply: TAM carpim (kapilarin calistigi tek bolge).
  for (const action of ['stop', 'scale', 'restore']) {
    for (const kip of KIP)
      for (const smart of SMART)
        for (const kim of KIM) {
          // Geri almada OCO sorulmaz; OCO boyutu sonucu degistirmez -> iki ornek yeter.
          const ocolar = action === 'restore' ? ['numarasiz', 'gecti'] : OCO;
          for (const oco of ocolar)
            for (const eylem of ['-', 'schedule']) {
              yield { env: 'prod', action, mode: 'apply', kip, smart, kim, oco, eylem };
            }
        }
  }
  // Kapilarin DEVREDE OLMADIGI bolge: hicbir ayar bir isi durdurmamali, hicbir dis
  // sisteme gidilmemeli.
  for (const [env, mode] of [
    ['prod', 'dry_run'],
    ['test', 'apply'],
    ['test', 'dry_run'],
  ]) {
    for (const action of ['stop', 'scale', 'restore'])
      for (const kip of KIP)
        for (const smart of ['yok', 'hazir']) {
          for (const kim of ['ayse', 'yonetici-atlar']) {
            yield { env, action, mode, kip, smart, kim, oco: 'numarasiz', eylem: '-' };
          }
        }
  }
}

test('KM1 karar matrisi: her hucrede alti degismez', async (t) => {
  sim.konsoluSustur(t);
  const sayac = {};
  let n = 0;
  for (const s of hucreler()) {
    const ad = etiket(s);
    const b = beklenen(s);
    const govde = kur(s);
    n++;
    sayac[b.sonuc] = (sayac[b.sonuc] || 0) + 1;

    // ── ONIZLEME: yan etkisiz ve kararin TAMAMINI soyler ──────────────────────
    const on = await sim.onizle(govde);
    assert.equal(on.status, 200, `${ad}: onizleme ${on.status} ${on.metin}`);
    const p = on.json.gatePolicy;
    assert.equal(
      sim.kayit.ocoSorgulari.length +
        sim.baslatmalar().length +
        sim.kayit.islemler.length +
        sim.kayit.smartTalepleri.length,
      0,
      `${ad}: onizleme yan etki uretti`,
    );
    assert.equal(p.smartStatus, SMART_DURUMU[b.smart], `${ad}: smartStatus`);
    assert.equal(
      p.smart,
      b.smart === 'hazir' || b.smart === 'eksik' ? 'require' : 'skip',
      `${ad}: policy.smart`,
    );
    const prodApply = s.env === 'prod' && s.mode === 'apply';
    assert.equal(
      p.oco,
      !prodApply ? 'skip' : s.action === 'restore' ? 'warn' : 'require',
      `${ad}: policy.oco`,
    );
    assert.equal(
      !!p.blocked,
      b.sonuc === 'engel',
      `${ad}: onizleme engeli bastan soylemiyor / fazladan soyluyor`,
    );
    assert.equal(
      p.schedulable === true,
      p.oco === 'require' && (b.smart === 'kapali' || b.smart === 'atla'),
      `${ad}: schedulable`,
    );
    assert.equal(
      p.smartGateDisabled === true,
      b.smart === 'kapali',
      `${ad}: kapali SMART kapisi gorunur olmali`,
    );

    // ── CALISTIRMA ────────────────────────────────────────────────────────────
    const r = await sim.calistir(govde);
    const j = r.json || {};
    const basladi = sim.baslatmalar().length;

    // (1) gereken kapilar gecmeden is baslamaz
    assert.equal(
      basladi,
      b.sonuc === 'baslar' ? 1 : 0,
      `${ad}: AWX baslatma sayisi (${r.status} ${r.metin.slice(0, 200)})`,
    );

    // (3) her ret 4xx + mesaj
    if (['engel', 'oco_iste', 'oco_ret', 'oco_gecti'].includes(b.sonuc)) {
      assert.ok(
        r.status >= 400 && r.status < 500,
        `${ad}: ret ${r.status} — 5xx govdesi kullaniciya ULASMAZ`,
      );
      assert.ok(typeof j.message === 'string' && j.message.length > 20, `${ad}: ret mesajsiz`);
      assert.equal(j.ok, false, ad);
    } else {
      assert.equal(r.status, 200, `${ad}: ${r.metin.slice(0, 300)}`);
      assert.equal(j.ok, true, ad);
    }

    // (2) SMART gerekli + hazir degil
    if (b.sonuc === 'engel') {
      assert.equal(r.status, 409, ad);
      assert.equal(j.code, 'smart_not_configured', ad);
      assert.deepEqual(j.gates, { oco: 'not_checked', smart: 'not_configured' }, ad);
      assert.equal(sim.kayit.ocoSorgulari.length, 0, `${ad}: engelli istekte OCO servisi SORULDU`);
      assert.equal(sim.kayit.ocoKayitlari.length, 0, `${ad}: engelli istek ZAMANLANDI`);
      assert.equal(sim.kayit.smartTalepleri.length, 0, ad);
      // (5) ekranin gordugu metin ile reddin metni AYNI
      assert.equal(j.message, p.blocked.message, `${ad}: onizleme ve ret farkli metin soyluyor`);
      assert.ok(Array.isArray(j.missing) && j.missing.length > 0, `${ad}: eksik listesi bos`);
      assert.deepEqual(j.missing, p.smartMissing, ad);
    }

    // (5) OCO yalniz politikanin "gerekli" dedigi ve engelin olmadigi yerde sorulur
    const ocoSoruldu = sim.kayit.ocoSorgulari.length > 0;
    assert.equal(
      ocoSoruldu,
      p.oco === 'require' && !p.blocked && s.oco !== 'numarasiz',
      `${ad}: OCO sorgusu`,
    );
    if (b.sonuc === 'oco_iste') assert.equal(j.ocoRequired, true, ad);
    if (b.sonuc === 'oco_gecti') assert.equal(j.ocoExpired, true, ad);
    if (b.sonuc === 'ertelendi') {
      assert.equal(j.ocoDeferred, true, ad);
      assert.equal(
        j.schedulable,
        p.schedulable,
        `${ad}: ekran "zamanla" diye sorabilir mi — onizlemeyle ayni olmali`,
      );
      assert.equal(sim.kayit.ocoKayitlari.length, 0, `${ad}: ertelenen istek kayit acti`);
    }

    // (4) portal kaydi
    const satirlar = sim.kayit.islemler;
    if (b.sonuc === 'baslar') {
      assert.equal(satirlar.length, 1, `${ad}: islem satiri`);
      assert.equal(satirlar[0].status, 'RUNNING', ad);
      assert.equal(satirlar[0].request_key, `${j.serverId}:${j.jobId}`, ad);
      assert.equal(sim.kayit.smartTalepleri.length, 0, `${ad}: is basladi AMA bilet de acildi`);
    } else if (b.sonuc === 'onay') {
      assert.equal(j.pendingApproval, true, ad);
      assert.equal(satirlar.length, 1, `${ad}: onay bekleyen is kayitsiz`);
      assert.equal(satirlar[0].status, 'PENDING_APPROVAL', ad);
      assert.equal(satirlar[0].request_key, `smart:${j.ticketId}`, ad);
      assert.equal(sim.kayit.smartTalepleri.length, 1, ad);
    } else if (b.sonuc === 'zamanlandi') {
      assert.equal(j.ocoScheduled, true, ad);
      assert.equal(satirlar.length, 1, `${ad}: zamanlanan is kayitsiz`);
      assert.equal(satirlar[0].status, 'SCHEDULED', ad);
      assert.equal(satirlar[0].request_key, `oco:${j.scheduleId}`, ad);
      const kayit = sim.ocoKaydi(j.scheduleId);
      assert.equal(kayit.status, 'SCHEDULED', ad);
      // Zamanlanan plan pencere saatinde ONAY ISTEMEMELI ve bilet ACMAMALI: karar simdi verildi.
      assert.deepEqual(
        kayit.pendingLaunch.overrides.smartApproval,
        {},
        `${ad}: zamanlanan plan SMART ayari tasiyor`,
      );
      assert.equal(sim.kayit.smartTalepleri.length, 0, ad);
    } else {
      assert.equal(satirlar.length, 0, `${ad}: is baslamadi ama satir yazildi`);
    }

    // (6) SMART'siz gecen prod degisikligi denetimde — ve YALNIZ o
    const ilerledi = b.sonuc === 'baslar' || b.sonuc === 'zamanlandi';
    assert.equal(
      sim.denetimde('scalex_smart_gate_disabled').length,
      ilerledi && b.smart === 'kapali' ? 1 : 0,
      `${ad}: kapali kapi izi`,
    );
    const atlama = sim.denetimde('smart_onayi_admin_atladi');
    assert.equal(atlama.length, ilerledi && b.smart === 'atla' ? 1 : 0, `${ad}: admin atlama izi`);
    if (atlama.length) assert.equal(atlama[0].detail.yer, 'scalex', ad);

    assert.deepEqual(sim.kayit.taninmayanSql, [], `${ad}: taninmayan SQL`);
  }
  // Matris BOS ya da tek sonuclu kosarsa hicbir sey olcmus olmaz.
  assert.ok(n > 900, `matris kuculmus: ${n} hucre`);
  for (const sonuc of [
    'baslar',
    'engel',
    'oco_iste',
    'oco_ret',
    'oco_gecti',
    'ertelendi',
    'zamanlandi',
    'onay',
  ]) {
    assert.ok(
      sayac[sonuc] > 0,
      `matriste "${sonuc}" sonucu hic uretilmedi: ${JSON.stringify(sayac)}`,
    );
  }
});

// ── URETIM OLAYININ YENIDEN URETIMI ──────────────────────────────────────────
test('KM2 uretim olayi: prod + gecerli OCO + SMART tanimsiz -> 409, OCO sorulmaz, onizleme bastan soyler', async (t) => {
  sim.konsoluSustur(t);
  const on = await sim.onizle();
  assert.equal(
    on.json.gatePolicy.blocked.code,
    'smart_not_configured',
    'onizleme engeli soylemiyor',
  );
  assert.match(
    on.json.gatePolicy.blocked.message,
    /Admin > ScaleX Yönetimi > Onay kapıları/,
    'yol tarifi yok',
  );
  assert.match(
    on.json.gatePolicy.blocked.message,
    /Önce kontrol et/,
    'kullanilabilir secenek soylenmiyor',
  );

  const r = await sim.calistir({ ocoNumber: OCO_NO });
  assert.equal(r.status, 409, 'eski hali 503 idi; proxy govdeyi yutuyordu');
  assert.equal(r.json.code, 'smart_not_configured');
  assert.equal(
    sim.kayit.ocoSorgulari.length,
    0,
    'OCO servisi BOSUNA soruldu — is zaten baslayamazdi',
  );
  assert.equal(sim.baslatmalar().length, 0);
  // Ret denetimde: bes kez deneyen kullanici bes iz birakir.
  const iz = sim.denetimde('scalex_gate_decision');
  assert.equal(iz.length, 1);
  assert.equal(iz[0].result, 'fail');
  assert.equal(iz[0].detail.outcome, 'blocked');

  // ENGEL HER SEYDEN ONCE: gerekcesiz bir geri alma "gerekce yazin" diye OYALANMAZ (yazsa da
  // baslamayacak) ve kilit almaz.
  sim.sifirla();
  sim.durdurulmusEkle();
  const geri = await sim.calistir({ action: 'restore' });
  assert.equal(geri.status, 409, `engelli istek once baska bir sey istedi: ${geri.metin}`);
  assert.equal(geri.json.code, 'smart_not_configured');
  assert.equal(
    [...sim.kayit.ayna.values()][0].phase,
    'scaled_down',
    'engelli istek geri alma kilidi aldi',
  );

  // Cikis yolu 1: on kontrol (dry_run) her zaman calisir.
  sim.sifirla();
  const kuru = await sim.calistir({ executionMode: 'dry_run' });
  assert.equal(kuru.status, 200, kuru.metin);
  assert.equal(sim.baslatmalar().length, 1);

  // Cikis yolu 2: admin anahtari "yalniz OCO".
  sim.sifirla();
  sim.smartKipi('oco_only');
  const acik = await sim.calistir({ ocoNumber: OCO_NO });
  assert.equal(acik.status, 200, acik.metin);
  assert.equal(sim.baslatmalar().length, 1);
  assert.equal(sim.kayit.ocoSorgulari.length, 1, 'OCO kapisi SMART kapaliyken de calismali');
  assert.equal(
    sim.denetimde('scalex_smart_gate_disabled').length,
    1,
    'kapali kapidan gecen is iz birakmadi',
  );
});

test('KM3 SMART kipi: taninmayan/bos deger kapiyi INDIRMEZ (varsayilan gerekli)', async (t) => {
  sim.konsoluSustur(t);
  for (const deger of ['', 'OCO_ONLY ', 'kapali', 'false', '0', 'oco-only']) {
    sim.sifirla();
    sim.smartKipi(deger);
    const r = await sim.calistir({ ocoNumber: OCO_NO });
    // 'OCO_ONLY ' bilerek listede: bosluk/buyuk harf toleransi varsa ACIK sayilir, yoksa kapali.
    const kip = sim.scalex && require('../config.cjs').smartMode();
    if (kip.value === 'oco_only') {
      assert.equal(deger.trim().toLowerCase(), 'oco_only', `"${deger}" yalniz OCO sayildi`);
      assert.equal(r.status, 200);
    } else {
      assert.equal(r.status, 409, `"${deger}" kapiyi indirdi: ${r.metin}`);
      assert.equal(sim.baslatmalar().length, 0, `"${deger}" ile is basladi`);
    }
  }
});

// ── SMART BILETI ─────────────────────────────────────────────────────────────
test('KM4 SMART bileti: metadata NESNE, anahtarlar admin sablonundan, scalex degiskenleri dolu', async (t) => {
  sim.konsoluSustur(t);
  sim.ayar.ozellestirme = {
    smartApproval: {
      ...sim.SMART_HAZIR,
      integrationKey: 'RFF-OZEL',
      metadataFields: [
        'Baslik: {{ scalex.ozet }}',
        'Isteyen: {{ username }} <{{ email }}>',
        'Ortam: {{ scalex.ortam }} / {{ scalex.tenant }}',
        'Hedef: {{ scalex.namespace }} @ {{ scalex.clusterlar }} — {{ scalex.uygulamalar }}',
        'Islem: {{ scalex.islem }} ({{ scalex.hedefSayisi }} hedef)',
        'OCO: {{ scalex.oco }}',
      ].join('\n'),
    },
  };
  const r = await sim.calistir({
    ocoNumber: OCO_NO,
    clusters: ['c1', 'c2'],
    apps: ['api', 'worker'],
  });
  assert.equal(r.status, 200, r.metin);
  assert.equal(r.json.pendingApproval, true);
  assert.equal(sim.baslatmalar().length, 0, 'onay beklenirken is basladi');

  const [talep] = sim.kayit.smartTalepleri;
  assert.equal(talep.flowKey, 'SCALEX_AKIS');
  assert.equal(talep.logonName, 'ayse');
  assert.equal(talep.integrationKey, 'RFF-OZEL');
  const alan = Object.fromEntries(talep.metadatas.map((m) => [m.key, m.value]));
  // ESKI HATA: metadata dizi uretiliyordu -> anahtarlar "0", "1", "2".
  assert.deepEqual(
    Object.keys(alan),
    ['Baslik', 'Isteyen', 'Ortam', 'Hedef', 'Islem', 'OCO'],
    'anahtarlar admin sablonundan gelmiyor',
  );
  assert.equal(alan.Isteyen, 'ayse <ayse@ornek.test>');
  assert.equal(alan.Ortam, 'prod / t1');
  assert.match(alan.Hedef, /^odeme @ c1, c2 — api, worker$/);
  assert.match(alan.Islem, /\(4 hedef\)$/);
  assert.equal(alan.OCO, OCO_NO);
  for (const [k, v] of Object.entries(alan))
    assert.ok(v && !/undefined|\[object/.test(v), `${k} bos/bozuk: ${v}`);

  // Bilet, onay gelince isi BASLATACAK paketi tasir: gercek sablon kimligi ve degiskenler.
  const [bilet] = sim.kayit.biletler;
  assert.equal(bilet.awxServerId, 1);
  assert.equal(bilet.awxTemplateId, 4711);
  assert.equal(bilet.pendingLaunch.extraVars.target_namespace, 'odeme');
  assert.equal(bilet.pendingLaunch.extraVars.oco_number, OCO_NO);
  assert.ok(
    bilet.pendingLaunch.ocoWindowEndIso,
    'bilet OCO penceresinin sonunu tasimiyor — onay pencere kapandiktan sonra gelirse is calisirdi',
  );
  // Iki cluster -> iki satir, ikisi de ayni bilete bagli.
  assert.deepEqual(
    sim.kayit.islemler.map((x) => [x.cluster_name, x.status, x.smart_ticket_id]),
    [
      ['c1', 'PENDING_APPROVAL', bilet.id],
      ['c2', 'PENDING_APPROVAL', bilet.id],
    ],
  );
});

test('KM5 SMART bileti acilamazsa: 4xx + asil kod govdede, is BASLAMAZ, satir YAZILMAZ', async (t) => {
  sim.konsoluSustur(t);
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR } };
  sim.ayar.smartHatasi = Object.assign(new Error('Smart 400 Invalid Request'), { status: 502 });
  const r = await sim.calistir({ ocoNumber: OCO_NO });
  assert.equal(r.status, 409, `5xx kullaniciya ulasmaz: ${r.status}`);
  assert.equal(r.json.upstreamStatus, 502);
  assert.match(r.json.message, /Smart talebi açılamadı: Smart 400 Invalid Request/);
  assert.equal(sim.baslatmalar().length, 0);
  assert.equal(sim.kayit.islemler.length, 0);

  // Sablonda OLMAYAN bir degisken: bilet acilmaz, sebep adiyla soylenir.
  sim.sifirla();
  sim.ayar.ozellestirme = {
    smartApproval: { ...sim.SMART_HAZIR, metadataFields: 'Baslik: {{ scalex.olmayanAlan }}' },
  };
  const r2 = await sim.calistir({ ocoNumber: OCO_NO });
  assert.ok(r2.status >= 400 && r2.status < 500, `${r2.status} ${r2.metin}`);
  assert.match(r2.json.message, /olmayanAlan/, 'hangi degiskenin eksik oldugu soylenmiyor');
  assert.equal(sim.kayit.smartTalepleri.length, 0, 'bozuk sablonla bilet ACILDI');
  assert.equal(sim.baslatmalar().length, 0);
});

test('KM6 admin tercihi okunamazsa ATLAMA YOK; kapi iki kez farkli karar verirse is BASLAMAZ', async (t) => {
  sim.konsoluSustur(t);
  sim.ayar.kullanici = sim.KULLANICILAR.yonetici;
  sim.adminAtlasin('yonetici');
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR } };
  sim.ayar.tercihHatasi = new Error('DB yok');
  const r = await sim.calistir({ ocoNumber: OCO_NO });
  assert.equal(r.json.pendingApproval, true, 'tercih okunamadi ama onay atlandi (fail-open)');
  assert.equal(sim.baslatmalar().length, 0);

  // YARIS: politika "SMART gerekli" dedikten SONRA tercih acilirsa ortak kapi bilet
  // acmadan gecer. ScaleX bu tutarsizligi ISE CEVIRMEZ.
  sim.sifirla();
  sim.ayar.kullanici = sim.KULLANICILAR.yonetici;
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR } };
  let okuma = 0;
  Object.defineProperty(sim.ayar, 'tercihler', {
    get() {
      okuma++;
      return okuma === 1 ? {} : { yonetici: { [sim.ATLA_ANAHTARI]: '1' } };
    },
  });
  const r2 = await sim.calistir({ ocoNumber: OCO_NO });
  assert.equal(okuma, 2, 'kurgu calismadi: tercih iki kez okunmali');
  assert.equal(r2.status, 409, r2.metin);
  assert.equal(r2.json.code, 'gate_inconsistent');
  assert.equal(
    sim.baslatmalar().length,
    0,
    'SMART gerekli dendi, bilet acilmadi, is yine de BASLADI',
  );
  assert.equal(sim.kayit.islemler.length, 0);
});

// ── ISTISNA KURALI (skipWhen) ────────────────────────────────────────────────
test('KM7 SMART istisna kurali: gorunur, denetimli, yalniz sunucunun urettigi alanlarla eslesir', async (t) => {
  sim.konsoluSustur(t);
  const kurali = (skipWhen) => {
    sim.sifirla();
    sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR, skipWhen } };
  };

  // "Geri almada onay isteme": geri alma bilet ACMADAN baslar, ekran bunu soyler, iz kalir.
  kurali('action: restore');
  const on = await sim.onizle({ action: 'restore', reason: 'INC-7' });
  assert.equal(on.json.gatePolicy.smartStatus, 'skipped_by_rule');
  assert.deepEqual(on.json.gatePolicy.smartSkipRule, { field: 'action', value: 'restore' });
  const r = await sim.calistir({ action: 'restore', reason: 'INC-7' });
  assert.equal(r.status, 200, r.metin);
  assert.equal(sim.baslatmalar().length, 1);
  assert.equal(sim.kayit.smartTalepleri.length, 0);
  const iz = sim.denetimde('scalex_smart_skipped_by_rule');
  assert.equal(iz.length, 1, 'kuralla atlanan onay iz birakmadi');
  assert.deepEqual(iz[0].detail.rule, { field: 'action', value: 'restore' });

  // Ayni kural durdurmayi ETKILEMEZ.
  kurali('action: restore');
  const dur = await sim.calistir({ ocoNumber: OCO_NO });
  assert.equal(dur.json.pendingApproval, true, 'kural durdurmayi da onaysiz birakti');
  assert.equal(sim.baslatmalar().length, 0);

  // ISTEMCI ALANI KURALI TETIKLEYEMEZ: kapi degiskenleri sunucuda uretilir.
  kurali('op_selection: read\nhedef: serbest');
  const sizma = await sim.calistir({
    ocoNumber: OCO_NO,
    op_selection: 'read',
    hedef: 'serbest',
    extraVars: { op_selection: 'read' },
    gateVars: { op_selection: 'read' },
  });
  assert.equal(sizma.json.pendingApproval, true, 'istemcinin gonderdigi alan onayi ATLATTI');
  assert.equal(sim.baslatmalar().length, 0);

  // SMART kapali (enabled:false) iken kural SORULMAZ: "hazir degil" engeli surer.
  sim.sifirla();
  sim.ayar.ozellestirme = {
    smartApproval: { ...sim.SMART_HAZIR, enabled: false, skipWhen: 'action: stop' },
  };
  const kapali = await sim.calistir({ ocoNumber: OCO_NO });
  assert.equal(kapali.status, 409);
  assert.equal(kapali.json.code, 'smart_not_configured');

  // Kuralla atlanan is ZAMANLANABILIR (SMART devrede degil) ve plan onay tasimaz.
  kurali('action: stop');
  sim.ayar.oco = 'once';
  const zam = await sim.calistir({ ocoNumber: OCO_NO, ocoAction: 'schedule' });
  assert.equal(zam.json.ocoScheduled, true, zam.metin);
  assert.deepEqual(sim.ocoKaydi(zam.json.scheduleId).pendingLaunch.overrides.smartApproval, {});
  assert.equal(sim.denetimde('scalex_smart_skipped_by_rule').length, 1);
});

// ── OCO AYARI ────────────────────────────────────────────────────────────────
test('KM8 OCO ayari: ortam listesi, kapali kapi izi, ayar okunamazsa kapi ACIK kalir', async (t) => {
  sim.konsoluSustur(t);
  // Liste: prod disi ortamda da istenir; SMART orada yok -> zamanlanabilir.
  sim.ayar.ozellestirme = { ocoCheck: { enabled: true, environments: ['prod', 'test'] } };
  const on = await sim.onizle({ env: 'test' });
  assert.equal(on.json.gatePolicy.oco, 'require');
  assert.equal(on.json.gatePolicy.schedulable, true);
  const numarasiz = await sim.calistir({ env: 'test' });
  assert.equal(numarasiz.status, 400);
  assert.equal(numarasiz.json.ocoRequired, true, 'ekran numara ister, sunucu sormaz — ayrisma');
  assert.equal(sim.baslatmalar().length, 0);
  const gecer = await sim.calistir({ env: 'test', ocoNumber: OCO_NO });
  assert.equal(gecer.status, 200, gecer.metin);
  assert.equal(sim.baslatmalar().length, 1);

  // Admin kapatti: prod'da da sorulmaz AMA gorunur ve denetimde.
  sim.sifirla();
  sim.smartKipi('oco_only');
  sim.ayar.ozellestirme = { ocoCheck: { enabled: false } };
  const on2 = await sim.onizle();
  assert.equal(on2.json.gatePolicy.oco, 'skip');
  assert.equal(on2.json.gatePolicy.ocoGateDisabled, true, 'kapali OCO kapisi ekranda gorunmuyor');
  const r2 = await sim.calistir();
  assert.equal(r2.status, 200, r2.metin);
  assert.equal(sim.kayit.ocoSorgulari.length, 0);
  // IKI kapi da kapaliyken prod'da calisan is IKI iz birakir.
  assert.equal(sim.denetimde('scalex_smart_gate_disabled').length, 1);
  assert.equal(
    sim.denetimde('scalex_oco_gate_disabled').length,
    1,
    'OCO kapisi kapaliyken gecen prod isi iz birakmadi',
  );

  // OCO kapali + SMART hazir: bilet acilir; onay gelince is OCO SORULMADAN calisacagi
  // icin iz bilet acilirken yazilir. Reddedilen istek (SMART hazir degil) iz birakmaz.
  sim.sifirla();
  sim.ayar.ozellestirme = { ocoCheck: { enabled: false }, smartApproval: { ...sim.SMART_HAZIR } };
  assert.equal((await sim.calistir()).json.pendingApproval, true);
  assert.equal(sim.denetimde('scalex_oco_gate_disabled').length, 1);
  sim.sifirla();
  sim.ayar.ozellestirme = { ocoCheck: { enabled: false } };
  assert.equal((await sim.calistir()).status, 409);
  assert.equal(
    sim.denetimde('scalex_oco_gate_disabled').length,
    0,
    'baslamayan is "kapali kapidan gecti" diye izlendi',
  );

  // Bos liste "hicbir ortam" demektir; liste YOKLUGU "prod" demektir.
  sim.sifirla();
  sim.smartKipi('oco_only');
  sim.ayar.ozellestirme = { ocoCheck: { enabled: true, environments: [] } };
  assert.equal((await sim.onizle()).json.gatePolicy.oco, 'skip');
  sim.ayar.ozellestirme = { ocoCheck: { enabled: true } };
  assert.equal((await sim.onizle()).json.gatePolicy.oco, 'require');
});

test('KM9 ScaleX sablonu cozulemezse: onizleme soyler, calistirma 409 + yol tarifi (5xx degil)', async (t) => {
  sim.konsoluSustur(t);
  sim.ayar.sablonlar.scalex_run = { keyName: 'scalex_run', enabled: true, awxTemplateId: null };
  const on = await sim.onizle();
  assert.equal(on.status, 200);
  assert.equal(on.json.configError.code, 'scalex_not_configured');
  assert.match(on.json.configError.message, /Template ID girilmemiş/);

  // Uc bolgede de ayni ret: SMART gerekli, yalniz OCO, kapisiz (prod disi).
  for (const [ad, hazirla, govde] of [
    ['smart-gerekli', () => {}, { ocoNumber: OCO_NO }],
    ['yalniz-oco', () => sim.smartKipi('oco_only'), { ocoNumber: OCO_NO }],
    ['prod-disi', () => {}, { env: 'test' }],
    ['on-kontrol', () => {}, { executionMode: 'dry_run' }],
  ]) {
    sim.sifirla();
    sim.ayar.sablonlar.scalex_run = { keyName: 'scalex_run', enabled: true, awxTemplateId: null };
    hazirla();
    const r = await sim.calistir(govde);
    assert.equal(r.status, 409, `${ad}: ${r.status} ${r.metin}`);
    assert.equal(r.json.code, 'scalex_not_configured', ad);
    assert.equal(r.json.upstreamStatus, 501, ad);
    assert.match(r.json.message, /Admin > Playbook Kayıtları/, `${ad}: yol tarifi yok`);
    assert.equal(sim.baslatmalar().length, 0, ad);
    assert.equal(sim.kayit.ocoSorgulari.length, 0, `${ad}: baslayamayacak is icin OCO soruldu`);
  }
});

// ── HIZ: BASLATMA BASINA AWX CAGRISI ─────────────────────────────────────────
test('KM10 baslatma basina AWX cagrisi: eski yol liste+anket+baslatma, yeni yol soguk 3 / sicak 1', async (t) => {
  sim.konsoluSustur(t);
  const say = () => sim.kayit.awxIstekleri.length;
  const yollar = () =>
    sim.kayit.awxIstekleri.map((r) => `${r.method} ${r.yol.replace(/\d+/g, 'N')}`);

  // ESKI YOL (hala baska modullerin kullandigi fonksiyonlar): butun sablon listesi sayfa
  // sayfa + anket tanimi + baslatma.
  const tpl = sim.soguk();
  const ev = { target_namespace: 'odeme' };
  await sim.onkontrol.assertTemplateAcceptsExtraVars(1, tpl, ev, { label: 'eski' });
  await sim.runner.launchJobOnServer(1, tpl, ev, '', sim.KULLANICILAR.ayse);
  const eski = say();
  assert.equal(eski, sim.ayar.awx.listeSayfasi + 2, `eski yol: ${yollar().join(' | ')}`);

  // YENI YOL, soguk: tek sablon + anket + baslatma.
  sim.sifirla();
  sim.soguk();
  const ilk = await sim.calistir({ executionMode: 'dry_run' });
  assert.equal(ilk.status, 200, ilk.metin);
  assert.deepEqual(yollar(), [
    'GET /api/vN/job_templates/N/',
    'GET /api/vN/job_templates/N/survey_spec/',
    'POST /api/vN/job_templates/N/launch/',
  ]);

  // YENI YOL, sicak: YALNIZ baslatma.
  const once = say();
  const ikinci = await sim.calistir({ executionMode: 'dry_run' });
  assert.equal(ikinci.status, 200, ikinci.metin);
  assert.equal(
    say() - once,
    1,
    `sicak baslatma ${say() - once} AWX cagrisi yapti: ${yollar().slice(once).join(' | ')}`,
  );
  assert.ok(eski > 1, 'karsilastirma anlamsiz');

  // BELLEK ISTEYENE: ayni sablonu bellek ISTEMEDEN baslatan baska bir modul anket
  // tanimini yine AWX'ten okur (davranisi degismedi).
  const isinmis = sim.ayar.sablonlar.scalex_run.awxTemplateId;
  const onceDiger = say();
  await sim.runner.launchJobOnServer(1, isinmis, ev, '', sim.KULLANICILAR.ayse);
  assert.deepEqual(
    yollar().slice(onceDiger),
    ['GET /api/vN/job_templates/N/survey_spec/', 'POST /api/vN/job_templates/N/launch/'],
    'anket bellegi, istemeyen cagiranda da kullanildi',
  );

  // SURE (cagri basina 120 ms'lik bir AWX ile): sicak baslatma tek turun suresine yakin.
  sim.ayar.awx.gecikmeMs = 120;
  const t0 = Date.now();
  await sim.calistir({ executionMode: 'dry_run' });
  const sicakMs = Date.now() - t0;
  sim.soguk();
  sim.ayar.awx.gecikmeMs = 120;
  const t1 = Date.now();
  await sim.onkontrol.assertTemplateAcceptsExtraVars(
    1,
    sim.ayar.sablonlar.scalex_run.awxTemplateId,
    ev,
    { label: 'eski' },
  );
  await sim.runner.launchJobOnServer(
    1,
    sim.ayar.sablonlar.scalex_run.awxTemplateId,
    ev,
    '',
    sim.KULLANICILAR.ayse,
  );
  const eskiMs = Date.now() - t1;
  t.diagnostic(
    `baslatma: eski yol ${eski} AWX cagrisi / ${eskiMs} ms, yeni yol sicak 1 cagri / ${sicakMs} ms (cagri basina 120 ms)`,
  );
  assert.ok(sicakMs < eskiMs / 2, `sicak baslatma hizlanmamis: ${sicakMs} ms vs ${eskiMs} ms`);
});

test('KM11 "Prompt on launch" kapali: soguk bellekte is BASLAMAZ; bayat bellekte AWX soyler, is IPTAL edilir', async (t) => {
  sim.konsoluSustur(t);
  // Soguk: on kontrol yakalar, baslatma istegi HIC gitmez.
  sim.soguk();
  sim.ayar.awx.promptAcik = false;
  const r = await sim.calistir({ executionMode: 'dry_run' });
  assert.equal(r.status, 409, r.metin);
  assert.equal(r.json.code, 'awx_prompt_on_launch_disabled');
  assert.equal(sim.baslatmalar().length, 0);
  // "Kapali" karari HATIRLANMAZ: admin kutuyu isaretleyince sonraki deneme gecer.
  sim.ayar.awx.promptAcik = true;
  assert.equal((await sim.calistir({ executionMode: 'dry_run' })).status, 200);

  // Bayat bellek: karar "acik" diye hatirlaniyor, admin o arada kapatti. AWX degiskenleri
  // yutar ve `ignored_fields` ile SOYLER -> is iptal edilir, kayit yazilmaz, bellek silinir.
  sim.kayit.awxIstekleri.length = 0;
  sim.kayit.islemler.length = 0;
  sim.ayar.awx.promptAcik = false;
  const r2 = await sim.calistir({ executionMode: 'dry_run' });
  assert.equal(r2.status, 409, r2.metin);
  assert.equal(r2.json.code, 'awx_prompt_on_launch_disabled');
  assert.equal(sim.baslatmalar().length, 1, 'bellek sicakti: baslatma gitmis olmali');
  assert.equal(sim.iptaller().length, 1, 'yanlis girdiyle kosan is IPTAL EDILMEDI');
  assert.equal(sim.kayit.islemler.length, 0, 'iptal edilen is icin RUNNING satiri yazildi');
  // Bellek silindi: bir sonraki deneme sablonu YENIDEN okur ve baslatmadan reddeder.
  sim.kayit.awxIstekleri.length = 0;
  const r3 = await sim.calistir({ executionMode: 'dry_run' });
  assert.equal(r3.status, 409);
  assert.equal(sim.baslatmalar().length, 0, 'bellek silinmemis: yine baslatma denendi');
});

test('KM12 AWX baslatmada yanit vermezse: 424 awx_unreachable (5xx degil), geri alma kilidi BIRAKILIR', async (t) => {
  sim.konsoluSustur(t);
  sim.smartKipi('oco_only');
  const hedef = sim.durdurulmusEkle();
  sim.ayar.awx.baslatmaDurumu = 503;
  const r = await sim.calistir({ action: 'restore', reason: 'INC-9' });
  assert.equal(r.status, 424, `${r.status} ${r.metin}`);
  assert.equal(r.json.code, 'awx_unreachable');
  assert.equal(r.json.upstreamStatus, 503);
  assert.ok(r.json.message, 'mesaj yok');
  assert.equal(sim.kayit.islemler.length, 0);
  assert.equal(
    [...sim.kayit.ayna.values()][0].phase,
    'scaled_down',
    'kilit asili kaldi: kullanici bir daha geri alamaz',
  );

  // AWX donunce ayni hedef geri alinabilir; ikinci istek cakisma olarak reddedilir.
  sim.ayar.awx.baslatmaDurumu = 0;
  const r2 = await sim.calistir({ action: 'restore', reason: 'INC-9' });
  assert.equal(r2.status, 200, r2.metin);
  assert.equal([...sim.kayit.ayna.values()][0].phase, 'restoring');
  const r3 = await sim.calistir({ action: 'restore', reason: 'INC-9' });
  assert.equal(r3.status, 409);
  assert.equal(r3.json.code, 'restore_in_progress');
  assert.equal(hedef.appName, 'api');
});

// ── SONUC CIKTIYI BEKLEMEZ ───────────────────────────────────────────────────
test('KM13 bitmis isin sonucu tam ciktiyi beklemez; tam metin yalniz ?cikti=tam ile, bir kez', async (t) => {
  sim.konsoluSustur(t);
  sim.smartKipi('oco_only');
  const r = await sim.calistir({ ocoNumber: OCO_NO });
  const { serverId, jobId } = r.json;
  const durum = (ek = '') => sim.istek('GET', `/api/scalex/run/${serverId}/${jobId}/status${ek}`);

  // Is kosarken ilk yoklama ciktiyi alir (bellek isinir).
  const kosuyor = await durum();
  assert.equal(kosuyor.json.finished, false);
  assert.equal(kosuyor.json.outputFinal, false);

  sim.isiBitir(jobId, {
    targets: [{ cluster: 'c1', app: 'api', kind: 'Deployment', status: 'OK', verified: true }],
  });
  sim.ayar.awx.ciktiGecikmeMs = 600;
  const tamOnce = sim.tamCiktiOkumalari().length;
  const t0 = Date.now();
  const bitti = await durum();
  const ms = Date.now() - t0;
  assert.equal(bitti.json.finished, true);
  assert.equal(bitti.json.result.overallStatus, 'OK', 'sonuc gelmedi');
  assert.equal(bitti.json.outputFinal, false, 'artimli metin "son metin" diye isaretlenmis');
  assert.equal(sim.tamCiktiOkumalari().length, tamOnce, 'sonuc icin ciktinin TAMAMI indirildi');
  assert.ok(ms < 500, `sonuc tam ciktiyi bekledi: ${ms} ms`);
  assert.match(bitti.json.output, /PLAY RECAP/, 'artimli cikti son satirlari tasimiyor');

  // Sonuclandirma BEKLENIR: yanit geldiginde ayna ve kayit guncel.
  assert.equal(sim.islemler('FINISHED').length, 1);
  assert.equal(
    sim.kayit.ayna.size,
    1,
    'durdurulan uygulama aynaya dusmedi (Geri Al kisayolu cikmaz)',
  );

  const tam = await durum('?cikti=tam');
  assert.equal(tam.json.outputFinal, true);
  assert.equal(
    sim.tamCiktiOkumalari().length,
    tamOnce + 1,
    'tam metin tam olarak BIR kez cekilmeli',
  );
  assert.match(tam.json.output, /PLAY RECAP/);
  assert.deepEqual(tam.json.result, bitti.json.result, 'iki cagri farkli sonuc dondu');
});

// ── ZAMANLANAN IS: IZ VE GERI ALINABILIRLIK ──────────────────────────────────
test('KM14 zamanlanan is: pencere saatinde baslayinca portal isi tanir, sonucu aynaya yazar', async (t) => {
  sim.konsoluSustur(t);
  sim.smartKipi('oco_only');
  sim.ayar.oco = 'once';
  const z = await sim.calistir({
    ocoNumber: OCO_NO,
    ocoAction: 'schedule',
    clusters: ['c1', 'c2'],
  });
  assert.equal(z.json.ocoScheduled, true, z.metin);
  assert.equal(sim.baslatmalar().length, 0, 'zamanlanan is HEMEN basladi');
  assert.deepEqual(
    sim.kayit.islemler.map((x) => [x.cluster_name, x.status]),
    [
      ['c1', 'SCHEDULED'],
      ['c2', 'SCHEDULED'],
    ],
  );
  const anahtar = `oco:${z.json.scheduleId}`;
  const cfg = { batchSize: 20, staleHours: 24 };

  // Pencere acilmadan: uzlastirici bekler.
  assert.deepEqual(await sim.reconciler.adoptScheduledLaunches(cfg), {
    scheduledAdopted: 0,
    scheduledClosed: 0,
  });

  // Zamanlayici isi baslatti (oco/poller): portal bunu uzlastiricinin BIR SONRAKI TURUNDA
  // ogrenir. `tick()` cagrilir (yardimci fonksiyon degil): devralma turun PARCASI olmali —
  // fonksiyon yazilip tura baglanmasaydi onu kimse cagirmazdi.
  const jobId = sim.awxIsiAc();
  sim.zamanlananiBaslat(z.json.scheduleId, jobId);
  const tur = await sim.reconciler.tick();
  assert.equal(tur.scheduledAdopted, 1, `tur zamanlanan isi devralmadi: ${JSON.stringify(tur)}`);
  assert.equal(tur.finalized, 0, 'kosan is sonuclandirildi');
  assert.deepEqual(
    sim.kayit.islemler.map((x) => [x.status, x.request_key, x.awx_job_id]),
    [
      ['RUNNING', `1:${jobId}`, jobId],
      ['RUNNING', `1:${jobId}`, jobId],
    ],
  );
  assert.equal(
    sim.kayit.islemler.some((x) => x.request_key === anahtar),
    false,
  );
  const iz = sim.denetimde('scalex_schedule_adopted');
  assert.equal(iz.length, 1);
  assert.equal(iz[0].username, 'ayse', 'is zamanlayana degil sisteme atfedildi');

  // Is bitti: mevcut sonuclandirma yolu aynayi yazar -> "Su an durdurulmus" + Geri Al.
  sim.isiBitir(jobId, {
    targets: [
      { cluster: 'c1', app: 'api', kind: 'Deployment', status: 'OK', verified: true },
      { cluster: 'c2', app: 'api', kind: 'Deployment', status: 'OK', verified: true },
    ],
  });
  // Kimse durum ekranina bakmasa da (sekme kapandi) bir sonraki tur sonucu isler.
  const tur2 = await sim.reconciler.tick();
  assert.equal(tur2.finalized, 1, JSON.stringify(tur2));
  assert.equal(sim.islemler('FINISHED').length, 2);
  assert.deepEqual(
    [...sim.kayit.ayna.values()].map((a) => `${a.clusterName}/${a.appName}`).sort(),
    ['c1/api', 'c2/api'],
  );
  assert.deepEqual(sim.kayit.taninmayanSql, []);
});

test('KM15 zamanlama iptali / suresi gecmesi: islem satirlari KAPANIR, yaniltici iptal REDDEDILIR', async (t) => {
  sim.konsoluSustur(t);
  const zamanla = async () => {
    sim.sifirla();
    sim.smartKipi('oco_only');
    sim.ayar.oco = 'once';
    const z = await sim.calistir({ ocoNumber: OCO_NO, ocoAction: 'schedule' });
    assert.equal(z.json.ocoScheduled, true, z.metin);
    return z.json.scheduleId;
  };
  const iptal = (id) =>
    sim.istek('POST', `/api/scalex/oco-schedules/${id}/cancel`, { note: 'vazgecildi' });

  // Sahibi iptal eder: kayit VE islem satiri ayni anda kapanir.
  let id = await zamanla();
  let r = await iptal(id);
  assert.equal(r.status, 200, r.metin);
  assert.equal(sim.ocoKaydi(id).status, 'CANCELLED');
  assert.equal(sim.ocoKaydi(id).cancelledBy, 'ayse');
  assert.deepEqual(
    sim.kayit.islemler.map((x) => x.status),
    ['CANCELLED'],
    'iptalden sonra is gecmisi hala "zamanlandi" diyor',
  );
  assert.equal(sim.denetimde('scalex_oco_schedule_cancelled').length, 1);
  // Ikinci iptal sessizce "tamam" demez.
  assert.equal((await iptal(id)).status, 409);

  // Baska ekipten biri iptal EDEMEZ ve deneme iz birakir.
  id = await zamanla();
  sim.ayar.kullanici = sim.KULLANICILAR.bora;
  r = await iptal(id);
  assert.equal(r.status, 403);
  assert.equal(sim.ocoKaydi(id).status, 'SCHEDULED');
  assert.equal(sim.denetimde('scalex_oco_schedule_forbidden').length, 1);

  // AWX zamanlayicisinda / SMART onayinda bekleyen kayit buradan iptal EDILEMEZ:
  // portal kaydini kapatmak isi durdurmaz, ekran yalan soylemis olur.
  for (const durum of ['AWX_SCHEDULED', 'PENDING_APPROVAL']) {
    id = await zamanla();
    sim.ocoKaydi(id).status = durum;
    r = await iptal(id);
    assert.equal(r.status, 409, `${durum}: ${r.metin}`);
    assert.equal(r.json.code, 'schedule_needs_admin_cancel', durum);
    assert.equal(sim.ocoKaydi(id).status, durum, `${durum}: kayit yine de iptal edildi`);
    assert.match(r.json.message, /Admin > Zamanlanmış İşler/, durum);
  }

  // Suresi gecen / tetiklenemeyen kayit: uzlastirici satiri FAILED kapatir ve iz birakir.
  const cfg = { batchSize: 20, staleHours: 24 };
  for (const [durum, beklenenSatir] of [
    ['EXPIRED', 'FAILED'],
    ['FAILED', 'FAILED'],
    ['CANCELLED', 'CANCELLED'],
  ]) {
    id = await zamanla();
    sim.ocoKaydi(id).status = durum;
    assert.deepEqual(
      await sim.reconciler.adoptScheduledLaunches(cfg),
      { scheduledAdopted: 0, scheduledClosed: 1 },
      durum,
    );
    assert.deepEqual(
      sim.kayit.islemler.map((x) => x.status),
      [beklenenSatir],
      durum,
    );
    assert.ok(sim.kayit.islemler[0].error_message, `${durum}: sebep yazilmadi`);
    assert.equal(
      sim.denetimde('scalex_schedule_closed').length,
      durum === 'CANCELLED' ? 0 : 1,
      durum,
    );
  }
  assert.deepEqual(sim.kayit.taninmayanSql, []);
});

// ── TOPLU GERI ALMA ──────────────────────────────────────────────────────────
test('KM16 toplu geri alma tekil geri alma ile AYNI kapidan gecer', async (t) => {
  sim.konsoluSustur(t);
  const kurgu = () => {
    sim.durdurulmusEkle({ namespace: 'odeme', appName: 'api' });
    sim.durdurulmusEkle({ namespace: 'kredi', appName: 'worker' });
  };
  const topluGeriAl = () =>
    sim.istek('POST', '/api/scalex/restore-all', { env: 'prod', tenant: 't1', reason: 'INC-11' });

  // SMART gerekli + tanimsiz: tek bir ret, hicbir grup baslamaz, kilit asili kalmaz.
  kurgu();
  let r = await topluGeriAl();
  assert.equal(r.status, 409, r.metin);
  assert.equal(r.json.code, 'smart_not_configured');
  assert.equal(sim.baslatmalar().length, 0);
  assert.ok(
    [...sim.kayit.ayna.values()].every((a) => a.phase === 'scaled_down'),
    'reddedilen toplu geri alma kilit birakti',
  );

  // Yalniz OCO: geri almada OCO sorulmaz; her grup baslar, her biri iz birakir.
  sim.sifirla();
  sim.smartKipi('oco_only');
  kurgu();
  r = await topluGeriAl();
  assert.equal(r.status, 200, r.metin);
  assert.equal(r.json.launched.length, 2);
  assert.equal(sim.baslatmalar().length, 2);
  assert.equal(sim.islemler('RUNNING').length, 2);
  assert.equal(sim.denetimde('scalex_smart_gate_disabled').length, 2);
  assert.equal(sim.kayit.ocoSorgulari.length, 0);

  // SMART hazir: her grup icin bilet, is baslamaz, kilit TUTULUR (onay beklerken ikinci
  // bir geri alma baslatilamaz).
  sim.sifirla();
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR } };
  kurgu();
  r = await topluGeriAl();
  assert.equal(r.status, 200, r.metin);
  assert.equal(r.json.pendingApproval.length, 2);
  assert.equal(sim.baslatmalar().length, 0);
  assert.equal(sim.islemler('PENDING_APPROVAL').length, 2);
  assert.ok([...sim.kayit.ayna.values()].every((a) => a.phase === 'restoring'));

  // Istisna kurali namespace'e bakabilir: politika GRUP BASINA cozulur.
  sim.sifirla();
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR, skipWhen: 'namespace: kredi' } };
  kurgu();
  r = await topluGeriAl();
  assert.equal(r.status, 200, r.metin);
  assert.deepEqual(
    r.json.launched.map((g) => g.namespace),
    ['kredi'],
    'kuralin kapsadigi grup baslamadi',
  );
  assert.deepEqual(
    r.json.pendingApproval.map((g) => g.namespace),
    ['odeme'],
    'kuralin kapsamadigi grup onaysiz gecti',
  );
  assert.equal(sim.denetimde('scalex_smart_skipped_by_rule').length, 1);
});

// ── ADMIN DURUM KARTI ────────────────────────────────────────────────────────
test('KM17 admin durum karti: yalniz Admin; kip, eksikler, bilet onizlemesi, siradan kullanicinin karari', async (t) => {
  sim.konsoluSustur(t);
  const kart = () => sim.istek('GET', '/api/scalex/admin/gate-status');
  assert.equal((await kart()).status, 403, 'siradan kullanici onay ayarlarini okudu');

  sim.ayar.kullanici = sim.KULLANICILAR.yonetici;
  let r = await kart();
  assert.equal(r.status, 200, r.metin);
  assert.equal(r.json.smartMode, 'required');
  assert.equal(r.json.smartModeSource, 'default');
  assert.equal(r.json.policy.smartStatus, 'not_configured');
  assert.equal(r.json.smart.missing.length, 3);
  assert.deepEqual(r.json.template, { serverId: 1, templateId: 4711 });
  assert.equal(r.json.adminSkipSelf, false);
  assert.ok(r.json.ornekBaglam.ozet, 'sablon yardimi icin ornek baglam yok');

  // Admin'in KENDI atlamasi karti yaniltmaz: kart siradan kullanicinin kararini gosterir.
  sim.adminAtlasin('yonetici');
  sim.ayar.ozellestirme = {
    smartApproval: { ...sim.SMART_HAZIR, skipWhen: 'action: restore\nbozuk satir' },
  };
  r = await kart();
  assert.equal(
    r.json.policy.smartStatus,
    'ready',
    'kart admin_skip gosteriyor: kullanicilarin durumu gizlendi',
  );
  assert.equal(r.json.adminSkipSelf, true);
  assert.deepEqual(r.json.smart.missing, []);
  assert.deepEqual(r.json.smart.onizleme, {
    Talep: r.json.ornekBaglam.ozet,
    TalepEden: 'yonetici',
    Ortam: 'prod',
  });
  assert.deepEqual(r.json.smart.skipRules, [{ field: 'action', values: ['restore'] }]);
  assert.deepEqual(
    r.json.smart.skipRulesInvalid,
    ['bozuk satir'],
    'gecersiz kural satiri gizlendi',
  );

  // Bozuk sablon: kart hatayi adiyla soyler, 500 vermez.
  sim.ayar.ozellestirme = {
    smartApproval: { ...sim.SMART_HAZIR, metadataFields: 'A: {{ scalex.yok }}' },
  };
  r = await kart();
  assert.equal(r.status, 200);
  assert.equal(r.json.smart.onizleme, null);
  assert.match(r.json.smart.onizlemeHatasi, /yok/);

  sim.smartKipi('oco_only');
  r = await kart();
  assert.equal(r.json.smartMode, 'oco_only');
  assert.equal(r.json.policy.smartStatus, 'disabled_by_admin');
  assert.equal(r.json.policy.schedulable, true);
});

test('KM18 SMART kurali anahtari: yalniz Admin, yalniz iki deger, ANINDA gecerli, onceki/yeni degerle denetimde', async (t) => {
  sim.konsoluSustur(t);
  const yaz = (mode) => sim.istek('PUT', '/api/scalex/admin/smart-mode', { mode });

  // Siradan kullanici kapiyi indiremez.
  assert.equal((await yaz('oco_only')).status, 403);
  assert.equal(sim.kayit.ayarYazimlari.length, 0);
  assert.equal(
    (await sim.calistir({ ocoNumber: OCO_NO })).status,
    409,
    'yetkisiz istek kipi degistirdi',
  );

  sim.ayar.kullanici = sim.KULLANICILAR.yonetici;
  for (const yanlis of ['', 'kapali', 'OCO-ONLY', 'false']) {
    const r = await yaz(yanlis);
    assert.equal(r.status, 400, `"${yanlis}" kabul edildi`);
    assert.ok(r.json.message);
  }
  assert.equal(sim.kayit.ayarYazimlari.length, 0, "gecersiz deger DB'ye yazildi");
  assert.equal(sim.denetimde('scalex_smart_mode_changed').length, 0);

  // Kapat: tek istek, restart yok — bir sonraki calistirma SMART'siz gecer.
  let r = await yaz('oco_only');
  assert.equal(r.status, 200, r.metin);
  assert.deepEqual([r.json.smartMode, r.json.onceki], ['oco_only', 'required']);
  assert.deepEqual(sim.kayit.ayarYazimlari, [
    { key: 'SCALEX_PROD_SMART_MODE', value: 'oco_only', by: 'yonetici' },
  ]);
  let iz = sim.denetimde('scalex_smart_mode_changed');
  assert.equal(iz.length, 1);
  assert.deepEqual(iz[0].detail, { onceki: 'required', yeni: 'oco_only' });
  assert.equal(iz[0].result, 'warn', 'kapatma denetimde siradan bir kayit gibi gorunuyor');
  assert.equal(iz[0].username, 'yonetici');

  sim.ayar.kullanici = sim.KULLANICILAR.ayse;
  assert.equal((await sim.onizle()).json.gatePolicy.smartStatus, 'disabled_by_admin');
  assert.equal(
    (await sim.calistir({ ocoNumber: OCO_NO })).status,
    200,
    'anahtar kaydedildi ama etki etmedi',
  );
  assert.equal(sim.baslatmalar().length, 1);

  // Geri ac: ayni yoldan, ayni anda.
  sim.ayar.kullanici = sim.KULLANICILAR.yonetici;
  r = await yaz('required');
  assert.deepEqual([r.json.smartMode, r.json.onceki], ['required', 'oco_only']);
  iz = sim.denetimde('scalex_smart_mode_changed');
  assert.equal(iz[1].result, 'ok');
  sim.ayar.kullanici = sim.KULLANICILAR.ayse;
  assert.equal(
    (await sim.calistir({ ocoNumber: OCO_NO })).status,
    409,
    'geri acilan kapi islemiyor',
  );
  assert.deepEqual(sim.kayit.taninmayanSql, []);
});

// ── EKRAN TESTLERININ GIRDISI: GERCEK SUNUCU YANITLARI ───────────────────────
//
// Ekran testleri (src/components/scalex/__tests__/ScaleXKapilar.test.tsx) sunucunun
// yanitlarini ELLE yazsaydi, sunucu bir alani yeniden adlandirdiginda ekran testleri
// yesil kalir ve ekran uretimde bozulurdu (bu ekranda tam olarak bu yasandi: `/run`
// `pendingApproval` donuyor, ekran onu "is numarasi donmedi" diye okuyordu).
//
// Asagidaki her kurgu simulatorden GERCEK `/preview` ve `/run` govdesini alir; degisken
// alanlar (is/bilet/kayit numarasi, tarih) sabitlenir ve sonuc depodaki ornek dosyasiyla
// KARSILASTIRILIR. Sunucu yaniti degisirse bu test kirmizi olur ve ornek bilerek
// yeniden uretilir:   KAPI_ORNEK_YAZ=1 node --test <bu dosya>
const fs = require('node:fs');
const path = require('node:path');
const ORNEK_DOSYASI = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'components',
  'scalex',
  '__tests__',
  'fixtures',
  'kapi-yanitlari.json',
);

const TARIH = /\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}(:\d{2})?/g;
function sabitle(v) {
  if (Array.isArray(v)) return v.map(sabitle);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, d] of Object.entries(v)) {
      if (k === 'jobId' && typeof d === 'number') o[k] = 9001;
      else if (k === 'ticketId' || k === 'scheduleId') o[k] = 1;
      else if (k === 'externalTicketId') o[k] = 'SMT-1';
      else o[k] = sabitle(d);
    }
    return o;
  }
  return typeof v === 'string' ? v.replace(TARIH, '14.10.2026 22:00:00') : v;
}

const SMART = () => ({ smartApproval: { ...sim.SMART_HAZIR } });
const KURGULAR = {
  engel_smart_tanimsiz: { govde: { ocoNumber: OCO_NO } },
  oco_numarasi_gerekli: { hazirla: () => sim.smartKipi('oco_only'), govde: {} },
  oco_bulunamadi: {
    hazirla: () => {
      sim.smartKipi('oco_only');
      sim.ayar.oco = 'yok';
    },
    govde: { ocoNumber: OCO_NO },
  },
  oco_penceresi_gecti: {
    hazirla: () => {
      sim.smartKipi('oco_only');
      sim.ayar.oco = 'gecti';
    },
    govde: { ocoNumber: OCO_NO },
  },
  ertelendi_zamanlanabilir: {
    hazirla: () => {
      sim.smartKipi('oco_only');
      sim.ayar.oco = 'once';
    },
    govde: { ocoNumber: OCO_NO },
  },
  ertelendi_zamanlanamaz: {
    hazirla: () => {
      sim.ayar.ozellestirme = SMART();
      sim.ayar.oco = 'once';
    },
    govde: { ocoNumber: OCO_NO },
  },
  zamanlandi: {
    hazirla: () => {
      sim.smartKipi('oco_only');
      sim.ayar.oco = 'once';
    },
    govde: { ocoNumber: OCO_NO, ocoAction: 'schedule' },
  },
  onay_bekliyor: {
    hazirla: () => {
      sim.ayar.ozellestirme = SMART();
    },
    govde: { ocoNumber: OCO_NO },
  },
  basladi_smart_kapali: { hazirla: () => sim.smartKipi('oco_only'), govde: { ocoNumber: OCO_NO } },
  basladi_admin_atladi: {
    hazirla: () => {
      sim.ayar.kullanici = sim.KULLANICILAR.yonetici;
      sim.adminAtlasin('yonetici');
      sim.ayar.ozellestirme = SMART();
    },
    govde: { ocoNumber: OCO_NO },
  },
  basladi_istisna_kurali: {
    hazirla: () => {
      sim.ayar.ozellestirme = {
        smartApproval: { ...sim.SMART_HAZIR, skipWhen: 'action: restore' },
      };
    },
    govde: { action: 'restore', reason: 'INC-7' },
  },
  basladi_on_kontrol: { govde: { executionMode: 'dry_run' } },
  basladi_test_ortami: { govde: { env: 'test' } },
  gerekce_gerekli: { hazirla: () => sim.smartKipi('oco_only'), govde: { action: 'restore' } },
  sablon_tanimsiz: {
    hazirla: () => {
      sim.ayar.sablonlar.scalex_run = { keyName: 'scalex_run', enabled: true, awxTemplateId: null };
    },
    govde: { ocoNumber: OCO_NO },
  },
  // Ayni durumun ON KONTROL hali: politika hicbir kapi istemez (OCO yok, SMART yok) ama is
  // yine baslayamaz. Ekran testinde "Calistir" dugmesini kapatan TEK sey engelin kendisidir.
  sablon_tanimsiz_on_kontrol: {
    hazirla: () => {
      sim.ayar.sablonlar.scalex_run = { keyName: 'scalex_run', enabled: true, awxTemplateId: null };
    },
    govde: { executionMode: 'dry_run' },
  },
  awx_yanit_vermiyor: {
    hazirla: () => {
      sim.smartKipi('oco_only');
      sim.ayar.awx.baslatmaDurumu = 503;
    },
    govde: { ocoNumber: OCO_NO },
  },
  smart_talebi_acilamadi: {
    hazirla: () => {
      sim.ayar.ozellestirme = SMART();
      sim.ayar.smartHatasi = Object.assign(new Error('Smart 400 Invalid Request'), { status: 502 });
    },
    govde: { ocoNumber: OCO_NO },
  },
  oco_kapisi_kapali: {
    hazirla: () => {
      sim.smartKipi('oco_only');
      sim.ayar.ozellestirme = { ocoCheck: { enabled: false } };
    },
    govde: {},
  },
};

test('KM19 ekran testlerinin ornek yanitlari GERCEK sunucu yanitlariyla ayni', async (t) => {
  sim.konsoluSustur(t);
  const kurgular = {};
  for (const [ad, k] of Object.entries(KURGULAR)) {
    sim.sifirla();
    if (k.hazirla) k.hazirla();
    const on = await sim.onizle(k.govde);
    const ca = await sim.calistir(k.govde);
    assert.equal(on.status, 200, `${ad}: onizleme ${on.metin}`);
    kurgular[ad] = {
      onizleme: sabitle(on.json),
      calistirma: { status: ca.status, govde: sabitle(ca.json) },
    };
  }

  // BITEN IS: durum ucunun iki yaniti (varsayilan = artimli cikti, `?cikti=tam` = son metin).
  sim.sifirla();
  sim.smartKipi('oco_only');
  const is = (await sim.calistir({ ocoNumber: OCO_NO })).json;
  await sim.istek('GET', `/api/scalex/run/${is.serverId}/${is.jobId}/status`);
  sim.isiBitir(is.jobId, {
    targets: [
      {
        cluster: 'c1',
        app: 'api',
        kind: 'Deployment',
        status: 'OK',
        verified: true,
        detail: 'replicas 3 -> 0',
      },
    ],
  });
  const bitenIs = {
    yoklama: sabitle(
      (await sim.istek('GET', `/api/scalex/run/${is.serverId}/${is.jobId}/status`)).json,
    ),
    tamCikti: sabitle(
      (await sim.istek('GET', `/api/scalex/run/${is.serverId}/${is.jobId}/status?cikti=tam`)).json,
    ),
  };

  // ADMIN DURUM KARTI: uc durum.
  const kart = {};
  for (const [ad, hazirla] of [
    ['tanimsiz', () => {}],
    [
      'hazir',
      () => {
        sim.ayar.ozellestirme = {
          smartApproval: { ...sim.SMART_HAZIR, skipWhen: 'action: restore\nbozuk satir' },
        };
      },
    ],
    ['kapali', () => sim.smartKipi('oco_only')],
  ]) {
    sim.sifirla();
    sim.ayar.kullanici = sim.KULLANICILAR.yonetici;
    hazirla();
    kart[ad] = sabitle((await sim.istek('GET', '/api/scalex/admin/gate-status')).json);
  }
  const uretilen = { kurgular, bitenIs, kart };
  if (ORNEK_YAZ) {
    fs.mkdirSync(path.dirname(ORNEK_DOSYASI), { recursive: true });
    fs.writeFileSync(ORNEK_DOSYASI, `${JSON.stringify(uretilen, null, 2)}\n`);
    t.diagnostic(`ornekler yeniden yazildi: ${Object.keys(kurgular).length} kurgu`);
    return;
  }
  assert.ok(fs.existsSync(ORNEK_DOSYASI), 'ornek dosyasi yok: KAPI_ORNEK_YAZ=1 ile uretin');
  const depodaki = JSON.parse(fs.readFileSync(ORNEK_DOSYASI, 'utf8'));
  assert.deepEqual(
    Object.keys(depodaki.kurgular).sort(),
    Object.keys(kurgular).sort(),
    'kurgu listesi ornek dosyasiyla ayrismis',
  );
  for (const ad of Object.keys(kurgular)) {
    assert.deepEqual(
      depodaki.kurgular[ad],
      kurgular[ad],
      `${ad}: sunucu yaniti ornekten ayrildi — ekran testleri bayat girdiyle kosuyor`,
    );
  }
  assert.deepEqual(depodaki.bitenIs, bitenIs, 'biten isin durum yaniti ornekten ayrildi');
  assert.deepEqual(depodaki.kart, kart, 'admin durum karti yaniti ornekten ayrildi');
  // Ornekler yalniz BEKLENEN bicimleri tasimali: biten isin sonucu dolu, tam cikti isaretli.
  assert.equal(bitenIs.yoklama.outputFinal, false);
  assert.equal(bitenIs.tamCikti.outputFinal, true);
  assert.equal(bitenIs.yoklama.result.overallStatus, 'OK');
});

test('KM20 SMART onayi geldikten sonra: is devralinir, sonucu aynaya yazilir; reddedilen bilet satiri kapatir', async (t) => {
  sim.konsoluSustur(t);
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR } };
  const r = await sim.calistir({ ocoNumber: OCO_NO });
  assert.equal(r.json.pendingApproval, true, r.metin);
  // Onay beklerken tur hicbir seye dokunmaz.
  let tur = await sim.reconciler.tick();
  assert.deepEqual([tur.adopted, tur.cancelled, tur.finalized], [0, 0, 0]);
  assert.equal(sim.islemler('PENDING_APPROVAL').length, 1);

  // Onay geldi, onay zamanlayicisi isi baslatti; is hemen bitti.
  const jobId = sim.awxIsiAc();
  sim.biletiOnayla(r.json.ticketId, jobId);
  sim.isiBitir(jobId, {
    targets: [{ cluster: 'c1', app: 'api', kind: 'Deployment', status: 'OK', verified: true }],
  });
  tur = await sim.reconciler.tick();
  // AYNI turda devralinir ve sonuclandirilir.
  assert.deepEqual([tur.adopted, tur.finalized], [1, 1], JSON.stringify(tur));
  assert.deepEqual(
    sim.kayit.islemler.map((x) => [x.status, x.request_key, x.approval_state]),
    [['FINISHED', `1:${jobId}`, 'APPROVED']],
  );
  assert.equal(sim.kayit.ayna.size, 1, 'onayli durdurma aynaya dusmedi — Geri Al kisayolu cikmaz');
  assert.equal(sim.denetimde('scalex_approval_adopted')[0].username, 'ayse');

  // Reddedilen bilet: satir kapanir, is hic baslamaz.
  sim.sifirla();
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR } };
  const r2 = await sim.calistir({ ocoNumber: OCO_NO });
  sim.biletiReddet(r2.json.ticketId);
  tur = await sim.reconciler.tick();
  assert.equal(tur.cancelled, 1);
  assert.deepEqual(
    sim.kayit.islemler.map((x) => [x.status, x.approval_state]),
    [['CANCELLED', 'REJECTED']],
  );
  assert.equal(sim.baslatmalar().length, 0);
  assert.deepEqual(sim.kayit.taninmayanSql, []);
});

test('KM21 onay beklerken tutulan geri alma kilidi: bilet cozulene kadar durur, reddedilince birakilir', async (t) => {
  sim.konsoluSustur(t);
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR } };
  sim.durdurulmusEkle();
  const r = await sim.calistir({ action: 'restore', reason: 'INC-3' });
  assert.equal(r.json.pendingApproval, true, r.metin);
  const satir = () => [...sim.kayit.ayna.values()][0];
  assert.equal(
    satir().phase,
    'restoring',
    'onay beklerken kilit tutulmuyor — ikinci bir geri alma baslatilabilir',
  );
  // Ayni hedef icin ikinci istek: cakisma.
  assert.equal(
    (await sim.calistir({ action: 'restore', reason: 'INC-3' })).json.code,
    'restore_in_progress',
  );
  // Tur: bilet hala bekliyor -> kilit YETIM DEGIL, birakilmaz.
  let tur = await sim.reconciler.tick();
  assert.equal(tur.releasedLocks, 0, 'onay bekleyen isin kilidi yetim sayildi');
  assert.equal(satir().phase, 'restoring');
  // Bilet reddedildi: satir kapanir; kilit bir sonraki turda birakilir.
  sim.biletiReddet(r.json.ticketId);
  tur = await sim.reconciler.tick();
  assert.equal(tur.cancelled, 1);
  tur = await sim.reconciler.tick();
  assert.equal(
    satir().phase,
    'scaled_down',
    'reddedilen onayin kilidi asili kaldi: kullanici bir daha geri alamaz',
  );
  assert.deepEqual(sim.kayit.taninmayanSql, []);
});
