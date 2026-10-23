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
  // Pencere saati: GERCEK OCO zamanlayicisi isi GERCEK ortak yoldan AWX'e gonderir.
  await sim.penceredeTur(z.json.scheduleId);
  const zk = sim.ocoKaydi(z.json.scheduleId);
  assert.equal(zk.status, 'LAUNCHED', `pencere saatinde is baslamadi: ${zk.errorMessage}`);
  assert.equal(sim.baslatmalar().length, 1);
  const jobId = zk.awxJobId;
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
  // KAPI OZETI (2026-10-14): kapsam adimi ve toplu geri alma kutusu bunu okur.
  const ozet = {};
  for (const [ad, hazirla] of [
    ['gerekli_tanimsiz', () => {}],
    ['gerekli_hazir', () => (sim.ayar.ozellestirme = SMART())],
    ['yalniz_oco', () => sim.smartKipi('oco_only')],
    [
      'yonetici_atlar',
      () => {
        sim.ayar.ozellestirme = SMART();
        sim.ayar.kullanici = sim.KULLANICILAR.yonetici;
        sim.adminAtlasin('yonetici');
      },
    ],
    [
      'istisna_namespace',
      () => (sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR, skipWhen: 'namespace: odeme' } }),
    ],
    [
      'oco_kapali_yalniz_oco',
      () => {
        sim.smartKipi('oco_only');
        sim.ayar.ozellestirme = { ocoCheck: { enabled: false } };
      },
    ],
  ]) {
    sim.sifirla();
    hazirla();
    ozet[ad] = sabitle((await sim.istek('GET', '/api/scalex/gate-summary?env=prod&tenant=t1&clusters=c1')).json);
  }
  sim.sifirla();
  sim.ayar.ozellestirme = { ocoCheck: { enabled: true, environments: ['prod', 'test'] } };
  ozet.prod_disi_oco_listesinde = sabitle(
    (await sim.istek('GET', '/api/scalex/gate-summary?env=test&tenant=t1&clusters=c1')).json,
  );
  sim.sifirla();
  ozet.prod_disi = sabitle((await sim.istek('GET', '/api/scalex/gate-summary?env=test&tenant=t1&clusters=c1')).json);

  const uretilen = { kurgular, bitenIs, kart, ozet };
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
  assert.deepEqual(depodaki.ozet, ozet, 'kapi ozeti yaniti ornekten ayrildi');
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

  // Onay geldi: onay dongusunun GERCEK baslatma fonksiyonu (runner) isi AWX'e gonderir;
  // bileti "LAUNCHED" yapmak donguye ait defter isidir ve taklit edilir. Is hemen bitti.
  const bilet = sim.kayit.biletler.find((b) => b.id === Number(r.json.ticketId));
  const baslayan = await sim.onayBaslaticisi(bilet);
  assert.ok(baslayan && baslayan.jobId, `onaydan sonra is baslamadi: ${JSON.stringify(baslayan)}`);
  assert.equal(sim.baslatmalar().length, 1);
  const onayliIs = sim.kayit.isler.get(Number(baslayan.jobId));
  assert.deepEqual(onayliIs.yutulan, []);
  assert.equal(onayliIs.ev.execution_mode, 'apply');
  assert.equal(onayliIs.ev.requester_username, 'ayse', 'onayli is onaylayana/sisteme atfedildi');
  const jobId = baslayan.jobId;
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

// 2026-10-14 URETIM OLAYI: uc Admin'e listeyi `{ items, total }` NESNESI olarak veriyordu
// (`ocoStore.listAll`in donusu). Admin hicbir zamanlanmis kaydi goremedi; sayac eklenince
// ScaleX ekrani "l.map is not a function" ile coktu. Sahte depo GERCEK depoyla ayni
// bicimi doner, yani bu test ucun kendisini olcer.
test('KM22 zamanlanmis islemler listesi: her rolde DIZI; Admin herkesinkini, kullanici kendi grubununkini gorur', async (t) => {
  sim.konsoluSustur(t);
  sim.smartKipi('oco_only');
  sim.ayar.oco = 'once';
  const z = await sim.calistir({ ocoNumber: OCO_NO, ocoAction: 'schedule' });
  assert.equal(z.json.ocoScheduled, true, z.metin);

  const liste = async (kim) => {
    sim.ayar.kullanici = sim.KULLANICILAR[kim];
    const r = await sim.istek('GET', '/api/scalex/oco-schedules');
    assert.equal(r.status, 200, r.metin);
    assert.ok(Array.isArray(r.json.items), `${kim}: items dizi degil: ${r.metin.slice(0, 200)}`);
    return r.json;
  };
  // ORTAK TABLO: ayni kullanicinin bir Self Service zamanlamasi da var; ham paketinde
  // anketin parola alani duruyor.
  const PAROLA = 'Gizli-Parola-7731';
  sim.kayit.ocoKayitlari.push({
    id: 99001,
    username: 'ayse',
    awxServerId: 1,
    awxTemplateId: 31,
    ocoNumber: OCO_NO,
    ocoSubject: 'nginx',
    runAt: new Date(Date.now() + 3600 * 1000),
    windowEnd: new Date(Date.now() + 7200 * 1000),
    status: 'SCHEDULED',
    pendingLaunch: {
      templateName: 'Nginx Reverse Proxy Operations',
      detail: { id: 31, name: 'Nginx Reverse Proxy Operations' },
      extraVars: { action: 'reload', tbmwans_pwd: PAROLA },
    },
    ownerGroups: ['ekip-a'],
    cancelledBy: null,
    errorMessage: null,
    createdAt: new Date(),
  });

  const admin = await liste('yonetici');
  assert.equal(admin.scope, 'all');
  assert.deepEqual(admin.items.map((x) => x.id), [z.json.scheduleId], 'Admin baskasinin kaydini gormedi / ScaleX disi kayit listelendi');
  const ayse = await liste('ayse');
  assert.deepEqual(ayse.items.map((x) => x.id), [z.json.scheduleId], 'ScaleX panelinde Self Service kaydi');
  assert.deepEqual((await liste('bora')).items, [], 'baska ekibin kaydi gorundu');

  // HAM PAKET GITMEZ: ne `pendingLaunch` ne degiskenler (parola dahil).
  for (const kim of ['yonetici', 'ayse']) {
    sim.ayar.kullanici = sim.KULLANICILAR[kim];
    const ham = (await sim.istek('GET', '/api/scalex/oco-schedules')).metin;
    assert.ok(!ham.includes('pendingLaunch'), `${kim}: ham paket yanita sizdi`);
    assert.ok(!ham.includes(PAROLA), `${kim}: parola yanita sizdi`);
    assert.ok(!ham.includes('extraVars'), `${kim}: degiskenler yanita sizdi`);
  }
  // "Ne zamanlandi": kapsam sunucuda degiskenlerden cikarilir.
  assert.deepEqual(ayse.items[0].kapsam, {
    env: 'prod',
    tenant: 't1',
    clusters: ['c1'],
    namespace: 'odeme',
    apps: ['api'],
    action: 'stop',
    executionMode: 'apply',
    targetReplicas: null,
  });

  // Baska modulun kaydi ScaleX'ten iptal edilemez / guncellenemez (varligi da soylenmez).
  sim.ayar.kullanici = sim.KULLANICILAR.ayse;
  const ssIptal = await sim.istek('POST', '/api/scalex/oco-schedules/99001/cancel', {});
  assert.equal(ssIptal.status, 404, ssIptal.metin);
  const ssGuncel = await sim.istek('POST', '/api/scalex/oco-schedules/99001/update', { ocoNumber: '7654321' });
  assert.equal(ssGuncel.status, 404, ssGuncel.metin);
  assert.equal(sim.ocoKaydi(99001).status, 'SCHEDULED');
  // ScaleX kaydinin iptal yaniti da ham paketi tasimaz.
  const iptal = await sim.istek('POST', `/api/scalex/oco-schedules/${z.json.scheduleId}/cancel`, {});
  assert.equal(iptal.status, 200, iptal.metin);
  assert.ok(!iptal.metin.includes('pendingLaunch'), 'iptal yaniti ham paketi tasiyor');
  assert.equal(iptal.json.record.kapsam.namespace, 'odeme');
});

// ── PENCERE SAATINDEKI BASLATMA (2026-10-14) ─────────────────────────────────
// Prod'da SMART kurali "yalniz OCO"ya alininca "pencere acilinca otomatik baslat" ilk kez
// acildi. O saatte isi ScaleX DEGIL ortak OCO zamanlayicisi baslatir; bu yol prod'da
// ScaleX icin hic kosmamisti ve duzenek onu TAKLIT ediyordu.
test('KM23 zamanlanan is pencere saatinde ANLIK isle AYNI degiskenlerle baslar; prompt kapaliysa zamanlanmaz; AWX dusse kayit asili kalmaz', async (t) => {
  sim.konsoluSustur(t);
  sim.smartKipi('oco_only');
  const pencereDisi = (ev) => {
    const kopya = { ...ev };
    delete kopya.oco_window_start;
    delete kopya.oco_window_end;
    return kopya;
  };

  // 1) Anlik baslatma (pencere icinde): AWX'e giden degiskenler.
  sim.ayar.oco = 'icinde';
  const a = await sim.calistir({ ocoNumber: OCO_NO });
  assert.equal(a.status, 200, a.metin);
  const anlik = sim.kayit.isler.get(Number(a.json.jobId)).ev;

  // 2) Ayni istek zamanlanir; pencere saatinde gercek zamanlayici baslatir.
  sim.ayar.oco = 'once';
  const z = await sim.calistir({ ocoNumber: OCO_NO, ocoAction: 'schedule' });
  assert.equal(z.json.ocoScheduled, true, z.metin);
  const once = sim.baslatmalar().length;
  await sim.penceredeTur(z.json.scheduleId);
  const kayit = sim.ocoKaydi(z.json.scheduleId);
  assert.equal(kayit.status, 'LAUNCHED', kayit.errorMessage || '');
  assert.equal(sim.baslatmalar().length, once + 1, 'pencere saatinde AWX baslatmasi gitmedi');
  const zIs = sim.kayit.isler.get(Number(kayit.awxJobId));
  assert.equal(zIs.tplId, sim.ayar.sablonlar.scalex_run.awxTemplateId);
  assert.deepEqual(zIs.yutulan, [], 'AWX zamanlanan isin degiskenlerini yok saydi');
  assert.deepEqual(
    pencereDisi(zIs.ev),
    pencereDisi(anlik),
    'zamanlanan is anlik isten FARKLI degiskenlerle basladi',
  );
  assert.equal(zIs.ev.execution_mode, 'apply');
  assert.equal(zIs.ev.oco_number, OCO_NO);
  assert.equal(zIs.ev.requester_username, 'ayse', 'is zamanlayana atfedilmedi');
  assert.equal(zIs.ev.requester_is_fallback, false);
  assert.deepEqual(sim.kayit.smartTalepleri, [], '"yalniz OCO" iken pencere saatinde SMART bileti acildi');
  assert.ok(
    sim.kayit.isGecmisi.some((r) => r.kaynak === 'ortak' && Number(r.job_id) === Number(kayit.awxJobId)),
    'pencere saatinde baslayan is gecmise yazilmadi',
  );
  assert.equal((await sim.reconciler.tick()).scheduledAdopted, 1);

  // 3) "Prompt on launch" KAPALI: zamanlama HIC acilmaz (anlik baslatmanin reddiyle ayni
  // kod), OCO sorulmaz, satir yazilmaz.
  sim.sifirla();
  sim.smartKipi('oco_only');
  sim.ayar.oco = 'once';
  sim.soguk();
  sim.ayar.awx.promptAcik = false;
  const p = await sim.calistir({ ocoNumber: OCO_NO, ocoAction: 'schedule' });
  assert.equal(p.status, 409, p.metin);
  assert.equal(p.json.code, 'awx_prompt_on_launch_disabled');
  assert.deepEqual(sim.kayit.ocoKayitlari, [], 'prompt kapaliyken zamanlama acildi');
  assert.deepEqual(sim.kayit.islemler, []);
  assert.deepEqual(sim.kayit.ocoSorgulari, [], 'reddedilecek istek icin OCO soruldu');
  // Kullanici yalniz "sonra" derse (zamanlama istemedi) on kontrol gerekmez: pencere disi.
  const sonra = await sim.calistir({ ocoNumber: OCO_NO });
  assert.equal(sonra.json.ocoDeferred, true, sonra.metin);
  assert.equal(sim.baslatmalar().length, 0);

  // 4) Pencere saatinde AWX yanit vermiyor: kayit FAILED, islem satirlari kapanir.
  sim.sifirla();
  sim.smartKipi('oco_only');
  sim.ayar.oco = 'once';
  const f = await sim.calistir({ ocoNumber: OCO_NO, ocoAction: 'schedule' });
  assert.equal(f.json.ocoScheduled, true, f.metin);
  sim.ayar.awx.baslatmaDurumu = 503;
  await sim.penceredeTur(f.json.scheduleId);
  assert.equal(sim.ocoKaydi(f.json.scheduleId).status, 'FAILED');
  // Tekrar denenmez (ayni isi iki kez baslatma riski): ikinci tur bir sey yapmaz.
  sim.ayar.awx.baslatmaDurumu = 0;
  await sim.penceredeTur(f.json.scheduleId);
  assert.equal(sim.baslatmalar().length, 1, 'basarisiz zamanlama yeniden denendi');
  const kapat = await sim.reconciler.tick();
  assert.equal(kapat.scheduledClosed, 1, JSON.stringify(kapat));
  assert.deepEqual(sim.islemler('SCHEDULED'), [], 'basarisiz zamanlamanin satiri asili kaldi');
  assert.deepEqual(sim.kayit.taninmayanSql, []);
});

// SMART DEVREDEYKEN de is ertelenir: bilet acilir, onaydan sonra isi ortak yol baslatir ve
// "Prompt on launch" on kontrolu hicbir anda kosmazdi (KM23'teki zamanlama acigiyla ayni sinif).
test('KM24 SMART devredeyken "Prompt on launch" kapaliysa bilet ACILMAZ; aciksa onay beklenir', async (t) => {
  sim.konsoluSustur(t);
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR } };
  sim.soguk();
  sim.ayar.awx.promptAcik = false;
  const r = await sim.calistir({ ocoNumber: OCO_NO });
  assert.equal(r.status, 409, r.metin);
  assert.equal(r.json.code, 'awx_prompt_on_launch_disabled');
  assert.deepEqual(sim.kayit.smartTalepleri, [], 'ayar kapaliyken SMART talebi acildi');
  assert.deepEqual(sim.kayit.biletler, []);
  assert.deepEqual(sim.kayit.ocoSorgulari, [], 'reddedilecek istek icin OCO soruldu');
  assert.deepEqual(sim.kayit.islemler, []);
  assert.equal(sim.baslatmalar().length, 0);

  // Ayar acilinca ayni istek onaya gider ("kapali" karari hatirlanmaz).
  sim.ayar.awx.promptAcik = true;
  const r2 = await sim.calistir({ ocoNumber: OCO_NO });
  assert.equal(r2.json.pendingApproval, true, r2.metin);
  assert.equal(sim.kayit.smartTalepleri.length, 1);
  assert.equal(sim.baslatmalar().length, 0);
});

// ISTEKTEN SONRA AYAR KAPATILIRSA (2026-10-14): istek aninda denetim gecti (KM23/KM24), ama
// pencere saatine ya da onaya kadar biri AWX'te "Prompt on launch"u kapatti. Ortak baslatma
// yolu bunu artik is basladigi anda gorur ve isi IPTAL eder — YALNIZ bayrak tasiyan plan
// icin (ScaleX). Bayraksiz plan (Self Service) AYNEN baslar.
test('KM25 ertelenen baslatmada AWX degisken yutarsa is IPTAL edilir; bayraksiz plan (Self Service) degismez', async (t) => {
  sim.konsoluSustur(t);

  // 1) Zamanlanan is: plan bayragi tasir; pencere saatinde AWX yutar -> iptal, kayit kapanir.
  sim.smartKipi('oco_only');
  sim.ayar.oco = 'once';
  const z = await sim.calistir({ ocoNumber: OCO_NO, ocoAction: 'schedule' });
  assert.equal(z.json.ocoScheduled, true, z.metin);
  assert.equal(sim.ocoKaydi(z.json.scheduleId).pendingLaunch.yutmaKorumasi, true);
  sim.ayar.awx.promptAcik = false;
  await sim.penceredeTur(z.json.scheduleId);
  const k = sim.ocoKaydi(z.json.scheduleId);
  assert.equal(k.status, 'FAILED', 'yutulan degiskenle baslayan is BASARILI sayildi');
  assert.match(k.errorMessage, /Prompt on launch/);
  assert.equal(sim.baslatmalar().length, 1);
  assert.equal(sim.iptaller().length, 1, 'yanlis girdiyle kosan is IPTAL EDILMEDI');
  assert.equal(sim.denetimde('ansible_launch_ignored_vars_cancelled').length, 1);
  const tur = await sim.reconciler.tick();
  assert.equal(tur.scheduledClosed, 1, JSON.stringify(tur));
  assert.deepEqual(sim.islemler('RUNNING'), []);
  assert.deepEqual(sim.islemler('SCHEDULED'), []);

  // 2) SMART onayi sonrasi: bilet bayragi tasir; onay geldiginde AWX yutar -> iptal.
  sim.sifirla();
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR } };
  const r = await sim.calistir({ ocoNumber: OCO_NO });
  assert.equal(r.json.pendingApproval, true, r.metin);
  const bilet = sim.kayit.biletler.find((b) => b.id === Number(r.json.ticketId));
  assert.equal(bilet.pendingLaunch.yutmaKorumasi, true);
  sim.ayar.awx.promptAcik = false;
  await assert.rejects(() => sim.onayBaslaticisi(bilet), (e) => e.code === 'awx_prompt_on_launch_disabled');
  assert.equal(sim.iptaller().length, 1);

  // 3) Bayraksiz plan (Self Service kaydi): ayni durumda is AYNEN baslar, iptal yok.
  sim.sifirla();
  sim.ayar.awx.promptAcik = false;
  const simdi = Date.now();
  sim.kayit.ocoKayitlari.push({
    id: 99101,
    username: 'ayse',
    awxServerId: 1,
    awxTemplateId: 31,
    ocoNumber: OCO_NO,
    runAt: new Date(simdi - 60 * 1000),
    windowEnd: new Date(simdi + 3600 * 1000),
    status: 'SCHEDULED',
    pendingLaunch: {
      detail: {},
      extraVars: { ozel_alan: 'x' },
      resolvedLaunchOptions: {},
      specFields: [],
      overrides: {},
      username: 'ayse',
      templateName: 'Self Service Ornek',
    },
  });
  await sim.penceredeTur(99101);
  assert.equal(sim.ocoKaydi(99101).status, 'LAUNCHED', 'bayraksiz plan davranisi DEGISTI');
  assert.equal(sim.iptaller().length, 0);
  assert.deepEqual(sim.denetimde('ansible_launch_ignored_vars_cancelled'), []);
});

test('KM26 kapi ozeti (kapsam adimi) = onizleme karari; admin ayari degisince ANINDA degisir', async (t) => {
  // Kullanici (2026-10-14): "admin ekraninda yalniz OCO dedim ama prod secince yine SMART
  // acilacak yaziyor". Ilk adimdaki uyari sabitti. Olcut: ozet, ayni secimle `/preview`in
  // karariyla BIREBIR ayni ve admin anahtarini/ayarlarini ANINDA izliyor.
  sim.konsoluSustur(t);
  const ozetAl = async (env) => {
    const r = await sim.istek('GET', `/api/scalex/gate-summary?env=${env}&tenant=t1&clusters=c1`);
    assert.equal(r.status, 200, r.metin);
    return r.json;
  };
  let hucre = 0;
  for (const kip of ['varsayilan', 'oco_only'])
    for (const smart of ['yok', 'hazir', 'akissiz'])
      for (const kim of ['ayse', 'yonetici-atlar'])
        for (const env of ['prod', 'test']) {
          const s = { env, action: 'stop', mode: 'apply', kip, smart, kim, oco: 'numarasiz', eylem: '-' };
          kur(s);
          const oz = await ozetAl(env);
          for (const action of ['stop', 'scale', 'restore']) {
            const govde = kur({ ...s, action });
            const on = await sim.onizle(govde);
            assert.equal(on.status, 200, on.metin);
            const beklenenPolitika = on.json.gatePolicy;
            const ozetteki = action === 'restore' ? oz.restore : oz.change;
            assert.deepEqual(ozetteki, beklenenPolitika, `${etiket({ ...s, action })}: ozet onizlemeden ayrisiyor`);
            hucre++;
          }
          // Beklenen SMART durumu karar tablosuyla da tutarli (prod + apply).
          const b = beklenen(s);
          assert.equal(oz.change.smartStatus, SMART_DURUMU[b.smart], `${etiket(s)}: smartStatus`);
        }
  assert.equal(hucre, 72);

  // ADMIN ANAHTARI ANINDA: ayni oturumda gerekli -> yalniz OCO -> gerekli.
  sim.sifirla();
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR } };
  assert.equal((await ozetAl('prod')).change.smartStatus, 'ready');
  sim.smartKipi('oco_only');
  const ocoKipinde = await ozetAl('prod');
  assert.equal(ocoKipinde.change.smartStatus, 'disabled_by_admin', 'yalniz OCO ozete yansimadi');
  assert.equal(ocoKipinde.change.oco, 'require');
  sim.smartKipi('required');
  assert.equal((await ozetAl('prod')).change.smartStatus, 'ready');

  // OCO ORTAM LISTESI: prod disi bir ortam listeye eklenince orada da OCO istenir.
  sim.sifirla();
  assert.equal((await ozetAl('test')).change.oco, 'skip');
  sim.ayar.ozellestirme = { ocoCheck: { enabled: true, environments: ['prod', 'test'] } };
  assert.equal((await ozetAl('test')).change.oco, 'require', 'OCO ortam listesi ozete yansimadi');
  // Admin karti ayni listeyi gosterir (kural kutusu artik "prod disi OCO istemez" demiyor).
  sim.ayar.kullanici = sim.KULLANICILAR.yonetici;
  const kartListeli = (await sim.istek('GET', '/api/scalex/admin/gate-status')).json;
  assert.deepEqual(kartListeli.oco, { enabled: true, environments: ['prod', 'test'] });
  sim.ayar.ozellestirme = { ocoCheck: { enabled: false } };
  assert.deepEqual((await sim.istek('GET', '/api/scalex/admin/gate-status')).json.oco, { enabled: false, environments: null });
  sim.ayar.kullanici = sim.KULLANICILAR.ayse;

  // SECIME BAGLI KURAL: namespace/islem kurali varsa ekran "kesin karar onizlemede" der;
  // tenant kurali secimden ONCE de dogru hesaplanir (bayrak yok).
  sim.sifirla();
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR, skipWhen: 'namespace: odeme' } };
  assert.equal((await ozetAl('prod')).secimeBagliKural, true);
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR, skipWhen: 'tenant: t1' } };
  const tenantKurali = await ozetAl('prod');
  assert.equal(tenantKurali.secimeBagliKural, false);
  assert.equal(tenantKurali.change.smartStatus, 'skipped_by_rule');

  // GIRDI: env zorunlu; AWX'e / OCO servisine / SMART'a gidilmez.
  const bos = await sim.istek('GET', '/api/scalex/gate-summary');
  assert.equal(bos.status, 400);
  sim.sifirla();
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR } };
  const once = [sim.kayit.awxIstekleri.length, sim.kayit.ocoSorgulari.length, sim.kayit.smartTalepleri.length];
  await ozetAl('prod');
  assert.deepEqual(
    [sim.kayit.awxIstekleri.length, sim.kayit.ocoSorgulari.length, sim.kayit.smartTalepleri.length],
    once,
    'ozet bir dis sisteme gitti (AWX / OCO / SMART)',
  );
});

test('KM27 is gecmisi UNKNOWN esigini AYARDAN soyler (ekran "24 saat" diye sabit yazmaz)', async (t) => {
  sim.konsoluSustur(t);
  sim.sifirla();
  const eski = process.env.SCALEX_RECONCILE_STALE_HOURS;
  try {
    delete process.env.SCALEX_RECONCILE_STALE_HOURS;
    const varsayilan = await sim.istek('GET', '/api/scalex/history');
    assert.equal(varsayilan.status, 200, varsayilan.metin);
    assert.ok(Array.isArray(varsayilan.json.items));
    assert.equal(varsayilan.json.unknownAfterHours, 24);
    process.env.SCALEX_RECONCILE_STALE_HOURS = '6';
    assert.equal((await sim.istek('GET', '/api/scalex/history')).json.unknownAfterHours, 6, 'ayar ANINDA yansimadi');
  } finally {
    if (eski === undefined) delete process.env.SCALEX_RECONCILE_STALE_HOURS;
    else process.env.SCALEX_RECONCILE_STALE_HOURS = eski;
  }
});

// ── KM28 SONUC KONTROLU ESIGI, HEDEF TAVANI, YAZILI ONAY ESIGI AYARDAN ──────────
// Islem adimi kapatmada "su sure gecilirse basarisiz sayilir" cumlesini `x 2` diye
// KENDISI hesapliyordu; admin `SCALEX_VERIFY_FAIL_MULTIPLIER`i degistirince AWX'e giden
// `verify_fail_seconds` baska, ekran baska bir sure soyluyordu. Hedef tavani ve yazili
// onay esigi ise ekrana hic gelmiyordu ("sinirin uzerinde" deniyor, sinir yazmiyordu).
// Olcut: onizlemenin sayilari = calistirmanin AWX'e gonderdigi degerler; ayar degisince
// AYNI istekte degisir.
test('KM28 onizleme sonuc kontrolu esigini, hedef tavanini ve yazili onay esigini AYARDAN verir; calistirma ayni esigi AWX e gonderir', async (t) => {
  sim.konsoluSustur(t);
  sim.sifirla();
  const ANAHTARLAR = ['SCALEX_VERIFY_FAIL_MULTIPLIER', 'SCALEX_MAX_TARGETS', 'SCALEX_PROD_CONFIRM_THRESHOLD'];
  const eski = Object.fromEntries(ANAHTARLAR.map((k) => [k, process.env[k]]));
  try {
    for (const k of ANAHTARLAR) delete process.env[k];
    const fabrika = await sim.onizle({ verificationTimeout: '300' });
    assert.equal(fabrika.status, 200, fabrika.metin);
    assert.deepEqual(fabrika.json.verification, { warnSeconds: 300, failSeconds: 600 });
    assert.equal(fabrika.json.blastRadius.maxTargets, 200);
    assert.equal(fabrika.json.blastRadius.writtenConfirmThreshold, 5);
    // Butce verilmezse sunucu varsayilani: esik onun uzerinden.
    assert.deepEqual((await sim.onizle()).json.verification, { warnSeconds: 300, failSeconds: 600 });

    process.env.SCALEX_VERIFY_FAIL_MULTIPLIER = '3';
    process.env.SCALEX_MAX_TARGETS = '40';
    process.env.SCALEX_PROD_CONFIRM_THRESHOLD = '7';
    const on = await sim.onizle({ verificationTimeout: '240' });
    assert.equal(on.status, 200, on.metin);
    assert.deepEqual(on.json.verification, { warnSeconds: 240, failSeconds: 720 }, 'carpan ANINDA yansimadi');
    assert.equal(on.json.blastRadius.maxTargets, 40, 'hedef tavani ayardan gelmiyor');
    assert.equal(on.json.blastRadius.writtenConfirmThreshold, 7, 'yazili onay esigi ayardan gelmiyor');

    // Calistirma AYNI esigi AWX'e gonderir.
    sim.smartKipi('oco_only');
    sim.ayar.oco = 'icinde';
    const c = await sim.calistir({ verificationTimeout: '240', ocoNumber: OCO_NO });
    assert.equal(c.status, 200, c.metin);
    const ev = sim.kayit.isler.get(Number(c.json.jobId)).ev;
    assert.equal(Number(ev.verify_warn_seconds), on.json.verification.warnSeconds);
    assert.equal(Number(ev.verify_fail_seconds), on.json.verification.failSeconds, 'onizleme ile calistirma ayrisiyor');
  } finally {
    for (const k of ANAHTARLAR) {
      if (eski[k] === undefined) delete process.env[k];
      else process.env[k] = eski[k];
    }
  }
});

// ── KM29 KESIF GIRDI SINIRLARI SUNUCUDA ─────────────────────────────────────────
// `namespaces` sinirsizdi (yalniz ekran 60'ta duruyordu) ve ek namespace'lerin bicimi
// yalniz playbook'ta denetleniyordu: her biri cluster basina bir yetki sorgusu, sonunda
// girdi dogrulamasinda dusen bir AWX isi. Olcut: asan / bicimsiz istek 400 alir, HICBIR
// yetki sorgusu ve AWX cagrisi yapilmaz; tavan admin ayaridir ve /config ayni degeri verir.
test('KM29 kesif namespace tavani ve bicimi sunucuda: asan istek DB ye ve AWX e gitmeden 400', async (t) => {
  sim.konsoluSustur(t);
  sim.sifirla();
  const eski = process.env.SCALEX_MAX_AUDIT_NAMESPACES;
  const kesif = (namespaces, ek = {}) =>
    sim.istek('POST', '/api/scalex/discover', {
      env: 'prod',
      tenant: 't1',
      namespace: namespaces[0],
      namespaces,
      clusters: ['c1', 'c2'],
      mode: 'state',
      ...ek,
    });
  const dokunulmadi = (neden) => {
    assert.deepEqual(sim.kayit.yetkiSorgulari, [], `${neden}: yetki sorgusu yapildi`);
    assert.deepEqual(sim.kayit.awxIstekleri, [], `${neden}: AWX'e gidildi`);
  };
  try {
    delete process.env.SCALEX_MAX_AUDIT_NAMESPACES;
    assert.equal((await sim.istek('GET', '/api/scalex/config')).json.maxAuditNamespaces, 60);

    const cok = Array.from({ length: 61 }, (_, i) => `ns-${i}`);
    const r1 = await kesif(cok);
    assert.equal(r1.status, 400, r1.metin);
    assert.equal(r1.json.code, 'scalex_too_many_namespaces');
    assert.match(r1.json.message, /en fazla 60 namespace/);
    dokunulmadi('fabrika tavani');

    // Admin ayari ANINDA.
    process.env.SCALEX_MAX_AUDIT_NAMESPACES = '2';
    assert.equal((await sim.istek('GET', '/api/scalex/config')).json.maxAuditNamespaces, 2);
    const r2 = await kesif(['odeme', 'kredi', 'ns-x']);
    assert.equal(r2.status, 400, r2.metin);
    assert.match(r2.json.message, /en fazla 2 namespace/);
    dokunulmadi('admin tavani');

    // Bicimsiz EK namespace (ilki gecerli): eskiden AWX isi baslayip playbook'ta duserdi.
    const r3 = await kesif(['odeme', 'Kotu_Ad']);
    assert.equal(r3.status, 400, r3.metin);
    assert.match(r3.json.message, /Geçersiz namespace: Kotu_Ad/);
    dokunulmadi('bicimsiz ek namespace');

    // Uygulama listesi icin sert sinir (hedef tavaninin ust siniri).
    const sinir = require('../config.cjs').TUNABLES.SCALEX_MAX_TARGETS.hardMax;
    const r4 = await sim.onizle({ apps: Array.from({ length: sinir + 1 }, (_, i) => `app-${i}`) });
    assert.equal(r4.status, 400, r4.metin);
    assert.match(r4.json.message, new RegExp(`en fazla ${sinir} uygulama`));
    dokunulmadi('uygulama siniri');

    // Tavanin icinde: gecer, her namespace cluster basina denetlenir, is baslar.
    const r5 = await kesif(['odeme', 'kredi']);
    assert.equal(r5.status, 200, r5.metin);
    assert.deepEqual(sim.kayit.yetkiSorgulari, ['ns:odeme', 'ns:kredi']);
    assert.equal(sim.baslatmalar().length, 1, 'kesif isi baslamadi');
  } finally {
    if (eski === undefined) delete process.env.SCALEX_MAX_AUDIT_NAMESPACES;
    else process.env.SCALEX_MAX_AUDIT_NAMESPACES = eski;
  }
});

// ── KM30 ADMIN KARTININ KURAL KUTUSU SUNUCUDAN ───────────────────────────────────
// Admin > ScaleX karti "SMART yalnizca production'da", "ortam bilinmiyorsa prod sayilir",
// "dry_run hicbir kapidan gecmez", "Geri Al OCO'yu uyari olarak gecer (gerekce zorunlu)"
// diye SABIT yaziyordu. Olcut: karttaki her kural, AYNI ayarda `/preview`in ve `/run`in
// gercek karariyla ayni ve ayar degisince ANINDA degisir.
test('KM30 admin kartinin kural kutusu = onizleme ve calistirma karari; ayar degisince degisir', async (t) => {
  sim.konsoluSustur(t);
  const kartAl = async () => {
    const once = sim.ayar.kullanici;
    sim.ayar.kullanici = sim.KULLANICILAR.yonetici;
    try {
      const r = await sim.istek('GET', '/api/scalex/admin/gate-status');
      assert.equal(r.status, 200, r.metin);
      return r.json;
    } finally {
      sim.ayar.kullanici = once;
    }
  };
  const ozet = (p) => ({ oco: p.oco, smart: p.smart, smartStatus: p.smartStatus });
  const OCO_AYARLARI = {
    varsayilan: null,
    kapali: { enabled: false },
    listeli: { enabled: true, environments: ['prod', 'test'] },
  };
  let hucre = 0;
  const kartlar = {};
  for (const kip of ['varsayilan', 'oco_only'])
    for (const smart of ['yok', 'hazir'])
      for (const [ocoAdi, ocoCheck] of Object.entries(OCO_AYARLARI)) {
        const ad = `kip=${kip} smart=${smart} oco=${ocoAdi}`;
        const kurulum = (s) => {
          const govde = kur({ kip, smart, kim: 'ayse', oco: 'numarasiz', eylem: '-', ...s });
          if (ocoCheck) sim.ayar.ozellestirme = { ...(sim.ayar.ozellestirme || {}), ocoCheck };
          return govde;
        };
        kurulum({ env: 'prod', action: 'stop', mode: 'apply' });
        const kart = await kartAl();
        const k = kart.kurallar;
        assert.ok(k, `${ad}: kartta kural kutusu yok`);
        kartlar[ad] = k;

        // Prod disi ornek ortam ve dry_run: onizlemenin AYNI secimdeki karari.
        let on = await sim.onizle(kurulum({ env: k.prodDisi.ortam, action: 'stop', mode: 'apply' }));
        assert.equal(on.status, 200, on.metin);
        assert.deepEqual(ozet(k.prodDisi), ozet(on.json.gatePolicy), `${ad}: prod disi kurali onizlemeden ayrisiyor`);
        on = await sim.onizle(kurulum({ env: 'prod', action: 'stop', mode: 'dry_run' }));
        assert.equal(on.status, 200, on.metin);
        assert.deepEqual(ozet(k.dryRun), ozet(on.json.gatePolicy), `${ad}: dry_run kurali onizlemeden ayrisiyor`);

        // Ortami bilinmeyen istek: SMART icin prod sayilir. OCO ortam LISTESI tanimliysa bos
        // ortam listede olmadigi icin OCO istenmez (cozucunun bugunku davranisi; kart bunu
        // ayrica yazar). Bu yola istekle ULASILAMAZ: asagida bos ortam her uctan 400 alir.
        assert.equal(k.bilinmeyenOrtam.prodSayilir, true, `${ad}: bilinmeyen ortam prod sayilmiyor`);
        assert.deepEqual(
          [k.bilinmeyenOrtam.smart, k.bilinmeyenOrtam.smartStatus],
          [kart.policy.smart, kart.policy.smartStatus],
          `${ad}: bilinmeyen ortamda SMART prod kararindan ayrisiyor`,
        );
        assert.equal(k.bilinmeyenOrtam.oco, ocoAdi === 'listeli' ? 'skip' : kart.policy.oco, `${ad}: bilinmeyen ortamin OCO karari`);

        // Geri Al: karar onizlemeyle ayni; gerekce kurali `/run`in uyguladigiyla ayni.
        const geriAlGovde = kurulum({ env: 'prod', action: 'restore', mode: 'apply' });
        on = await sim.onizle(geriAlGovde);
        assert.equal(on.status, 200, on.metin);
        assert.deepEqual(ozet(k.geriAl), ozet(on.json.gatePolicy), `${ad}: Geri Al kurali onizlemeden ayrisiyor`);
        const gerekcesiz = { ...geriAlGovde };
        delete gerekcesiz.reason;
        const r = await sim.calistir(gerekcesiz);
        if (!on.json.gatePolicy.blocked) {
          assert.equal(
            r.status === 400 && r.json?.reasonRequired === true,
            k.geriAl.gerekceZorunlu,
            `${ad}: kart "gerekce ${k.geriAl.gerekceZorunlu ? 'zorunlu' : 'istenmez'}" diyor, calistirma ${r.status} ${r.metin}`,
          );
        }
        hucre++;
      }
  assert.equal(hucre, 12);

  // BOS ORTAM HICBIR KARAR UCUNA ULASMAZ (bilinmeyen ortam kurali yalniz savunma katmani).
  kur({ kip: 'varsayilan', smart: 'hazir', kim: 'ayse', oco: 'numarasiz', eylem: '-' });
  const once = [sim.kayit.awxIstekleri.length, sim.kayit.ocoSorgulari.length, sim.kayit.smartTalepleri.length];
  for (const [ad, r] of [
    ['onizleme', await sim.onizle({ env: '' })],
    ['calistirma', await sim.calistir({ env: '' })],
    ['toplu geri alma', await sim.istek('POST', '/api/scalex/restore-all', { env: '', tenant: 't1', reason: 'INC-1' })],
    ['kapi ozeti', await sim.istek('GET', '/api/scalex/gate-summary?env=')],
  ]) {
    assert.equal(r.status, 400, `${ad}: bos ortam reddedilmedi (${r.status} ${r.metin})`);
  }
  assert.deepEqual(
    [sim.kayit.awxIstekleri.length, sim.kayit.ocoSorgulari.length, sim.kayit.smartTalepleri.length],
    once,
    'bos ortamli istek bir dis sisteme gitti',
  );

  // MUTLAK DEGERLER (tutarlilik tek basina yetmez: cozucu bozulsa iki taraf birlikte kayardi).
  const v = kartlar['kip=varsayilan smart=hazir oco=varsayilan'];
  assert.equal(v.prodDisi.smart, 'skip');
  assert.deepEqual([v.dryRun.oco, v.dryRun.smart], ['skip', 'skip']);
  assert.deepEqual([v.geriAl.oco, v.geriAl.gerekceZorunlu, v.geriAl.smart], ['warn', true, 'require']);
  const kapali = kartlar['kip=varsayilan smart=hazir oco=kapali'];
  assert.deepEqual([kapali.geriAl.oco, kapali.geriAl.gerekceZorunlu], ['skip', false], 'OCO kapaliyken Geri Al karti degismedi');
  assert.equal(kartlar['kip=oco_only smart=hazir oco=varsayilan'].geriAl.smart, 'skip', 'yalniz OCO kipi Geri Al kartina yansimadi');
});
