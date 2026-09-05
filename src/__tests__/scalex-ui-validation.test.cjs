// src/__tests__/scalex-ui-validation.test.cjs — ScaleX ekraninin MERGE ONCESI
// dogrulamasi. Bu depodaki diger UI bekcileriyle ayni yontem: kaynak metni uzerinde
// yapisal denetim (React calistirici yok, ama bu sinif hatalarin cogu yapisal).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
    .join('\n')
    // PRETTIER UYUMLULUGU: kaynak-doğrulama testleri TIRNAK stiline bagimli kalmamali.
    // Prettier tek/çift tırnak arasında geçiş yapabilir; regex'ler hep çift tırnak bekler.
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');

const PAGE = read('components/scalex/ScaleXPage.tsx');
const WORKLOAD = read('components/scalex/steps/WorkloadStep.tsx');
const OPERATION = read('components/scalex/steps/OperationStep.tsx');
const PREVIEW = read('components/scalex/steps/PreviewStep.tsx');
const RESULT = read('components/scalex/steps/ScaleXResultPanel.tsx');
const STOPPED = read('components/scalex/StoppedPanel.tsx');
const SCOPE = read('components/scalex/steps/ScopeStep.tsx');
const NS = read('components/scalex/steps/NamespaceStep.tsx');
const API = read('api/scalexApi.ts');
const ALL_TSX = [PAGE, WORKLOAD, OPERATION, PREVIEW, RESULT, STOPPED, SCOPE, NS];
const NAMES = [
  'ScaleXPage',
  'WorkloadStep',
  'OperationStep',
  'PreviewStep',
  'ScaleXResultPanel',
  'StoppedPanel',
  'ScopeStep',
  'NamespaceStep',
];

// ── U1 Cift tik / cift is korumasi ──────────────────────────────────────────

test('U1 sihirbaz cift tik kilidini REF ile tutuyor (state degil)', () => {
  // `busy` bir React state'idir ve render'da yakalanir; ayni tick'te gelen iki tik
  // ikisi de `busy === false` gorup IKI AWX ISI acabilir.
  assert.match(codeOnly(PAGE), /busyRef\s*=\s*useRef\(false\)/);
  assert.match(codeOnly(PAGE), /if \(busyRef\.current\) return/);
});

test('U2 kesif baslatma da ref ile kilitli', () => {
  assert.match(codeOnly(WORKLOAD), /startingRef\s*=\s*useRef\(false\)/);
  assert.match(codeOnly(WORKLOAD), /if \(startingRef\.current\) return/);
});

// ── U3 Yoklama dongusu unmount'ta durmali ───────────────────────────────────

test('U3 kesif yoklamasi unmount olunca DURUYOR', () => {
  // `for(;;)` dongusu bilesen unmount olduktan sonra da donerse: (a) her 3 saniyede
  // bir gereksiz istek, (b) unmount sonrasi setState. `key={step}` ile adim degisince
  // bilesen remount oldugu icin bu gercek bir sizinti yolu.
  const code = codeOnly(WORKLOAD);
  assert.match(
    code,
    /aliveRef|cancelled|abort/i,
    'yoklama dongusunde unmount kontrolu yok — istek ve setState sizar',
  );
});

// ── U4 Hook sirasi ──────────────────────────────────────────────────────────

test("U4 hicbir bilesende hook'lardan ONCE erken return yok", () => {
  // "Rendered more hooks than during the previous render" — sayfa bembeyaz acilir.
  for (let i = 0; i < ALL_TSX.length; i++) {
    const full = codeOnly(ALL_TSX[i]);
    // Bilesen govdesi: `const X: React.FC...` satirindan sonrasi. Ust seviye yardimci
    // fonksiyonlardaki `return`ler hook sirasiyla ilgisizdir.
    const bodyStart = full.search(/const \w+: React\.FC/);
    if (bodyStart < 0) continue;
    const code = full.slice(bodyStart);
    const firstReturn = code.search(/^\s{2}(if \([^)]*\)\s*)?return\s/m);
    const lastHook = Math.max(
      code.lastIndexOf('useState('),
      code.lastIndexOf('useEffect('),
      code.lastIndexOf('useMemo('),
      code.lastIndexOf('useRef('),
    );
    if (firstReturn < 0 || lastHook < 0) continue;
    assert.ok(
      firstReturn > lastHook,
      `${NAMES[i]}: erken return hook'lardan ONCE — hook sirasi kirilir`,
    );
  }
});

// ── U5 Tema uyumu ───────────────────────────────────────────────────────────

test('U5 koyu temada kirilan SABIT renk yok', () => {
  // `src/index.css`teki uyum katmani Tailwind'in gri/kirmizi/amber tonlarini token'lara
  // esliyor, ama `bg-white` BILEREK eslenmedi (renkli zemin ustunde kullanilsin diye).
  // Koyu temada beyaz bir girdi kutusu okunamaz hale gelir.
  for (let i = 0; i < ALL_TSX.length; i++) {
    assert.ok(
      !/\bbg-white\b/.test(codeOnly(ALL_TSX[i])),
      `${NAMES[i]}: bg-white koyu temada kirilir — token kullan`,
    );
  }
});

test('U6 rozetler ortak pf-label sinifini kullaniyor', () => {
  const css = fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8');
  const used = new Set();
  for (const code of ALL_TSX) for (const m of code.matchAll(/pf-label--(\w+)/g)) used.add(m[1]);
  assert.ok(used.size > 0, 'hic pf-label kullanilmamis');
  for (const v of used)
    assert.ok(css.includes(`pf-label--${v}`), `pf-label--${v} CSS'te tanimli degil`);
});

// ── U7 Erisilebilirlik ──────────────────────────────────────────────────────

test('U7 kesilen (truncate) her oge title tasiyor', () => {
  for (let i = 0; i < ALL_TSX.length; i++) {
    const code = ALL_TSX[i];
    for (const m of code.matchAll(/<span[^>]*\btruncate\b[^>]*>/g)) {
      assert.ok(
        /title=/.test(m[0]),
        `${NAMES[i]}: kesilen deger okunamiyor (title yok) → ${m[0].slice(0, 90)}`,
      );
    }
  }
});

test('U8 dekoratif ikonlar aria-hidden', () => {
  for (let i = 0; i < ALL_TSX.length; i++) {
    for (const m of codeOnly(ALL_TSX[i]).matchAll(/<([A-Z]\w*Icon)\b([^>]*)>/g)) {
      assert.ok(/aria-hidden/.test(m[2]), `${NAMES[i]}: ${m[1]} aria-hidden tasimiyor`);
    }
  }
});

test('U9 her girdi bir etiketle iliskili', () => {
  for (let i = 0; i < ALL_TSX.length; i++) {
    // `<input ... onChange={(e) => ...}>` — ok fonksiyonundaki `>` naif bir regex'i
    // erken bitirir. Etiketi bir sonraki `<` ya da `/>` gorene kadar al.
    for (const m of codeOnly(ALL_TSX[i]).matchAll(/<input\b([\s\S]*?)\/>/g)) {
      const a = m[1];
      if (/type="(checkbox|radio)"/.test(a)) continue; // <label> icinde sarili
      assert.ok(/\bid=|aria-label=/.test(a), `${NAMES[i]}: etiketsiz girdi → ${m[0].slice(0, 80)}`);
    }
  }
});

// ── U10 Yonlendirmesizlik (kullanici karari) ────────────────────────────────

test('U10 "Onerilen" etiketi ve on-secim YOK', () => {
  // "Once kontrol et" ile "Uygula" ESIT agirlikta olmali: rozet yok, on-secim yok.
  // Yorumlari VE JSX yorum bloklarini at: test kendi ACIKLAMASIYLA eslesmemeli —
  // bu depoda tam olarak bu hata birkac kez yapildi.
  const visible = OPERATION.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/Önerilen|Onerilen|recommended/i.test(visible), 'nötr sunum bozulmus');
  // KURAL: "ILK SUNUM NOTR". Bunu artik literal `useState(null)` ile degil, kullanicinin
  // KENDI onceki secimini geri yukleyen bir prop ile ifade ediyoruz — geri donunce bos
  // form gostermek de bir tur veri kaybiydi. Kural iki parcali:
  //   1) OperationStep hicbir LITERAL islem/mod ile baslamaz,
  //   2) `previous` YALNIZCA kullanici adimi doldurduktan sonra gecilir.
  const code = codeOnly(OPERATION);
  assert.match(
    code,
    /useState<ScaleXMode \| null>\(previous\?\.executionMode \?\? null\)/,
    'calistirma modu ONCEDEN secili gelmemeli',
  );
  assert.match(code, /useState<ScaleXAction \| null>\(previous\?\.action \?\? null\)/);
  assert.ok(
    !/useState<ScaleXMode \| null>\("(dry_run|apply)"\)/.test(code),
    'literal mod on-secimi YOK',
  );
  assert.ok(
    !/useState<ScaleXAction \| null>\("(stop|restore|scale)"\)/.test(code),
    'literal islem on-secimi YOK',
  );

  const page = codeOnly(PAGE);
  // Prettier `previous={` sonrasinda satir kiriyor. Kural KOSULLU GECIS; satir duzeni
  // degil. Bosluga toleransli desen, `previous={{` (kosulsuz) halini hala yakalar.
  assert.match(
    page,
    /previous=\{\s*operationTouched\s*\?\s*\{/,
    '`previous` kosulsuz gecilirse ilk sunum on-secili olurdu',
  );
  assert.match(
    page,
    /const \[operationTouched, setOperationTouched\] = useState\(false\)/,
    'bayrak FALSE baslamali — ilk gelisde notr',
  );
});

test('U11 iki mod kartinin sinif dizesi AYNI', () => {
  // ARAYA OZNITELIK GIREBILIR (orn. `aria-pressed`): desen `onClick`ten sonra
  // DOGRUDAN `className` bekliyordu ve bir oznitelik eklenince kural aynen dururken
  // bekci "iki mod karti bulunamadi" ile kirmizi oluyordu. Kurali olcuyoruz, duzeni
  // degil — `[^`]` sinifi geri-tirnak icermedigi icin arada baska bir sablon dizesi
  // yakalanmasi mumkun degil.
  const cards = [
    ...OPERATION.matchAll(
      /onClick=\{\(\) => setMode\("(dry_run|apply)"\)\}[^`]*?className=\{`([^`]+)`\}/g,
    ),
  ];
  assert.equal(cards.length, 2, 'iki mod karti bulunamadi');
  const norm = (s) =>
    s
      .replace(/mode === "\w+"/, 'MODE')
      .replace(/\s+/g, ' ')
      .trim();
  assert.equal(
    norm(cards[0][2]),
    norm(cards[1][2]),
    'iki secenek gorsel olarak esit agirlikta DEGIL',
  );
});

test('U12 playbook degisken adlari ekranda GORUNMUYOR', () => {
  for (let i = 0; i < ALL_TSX.length; i++) {
    const visible = ALL_TSX[i].replace(/^\s*(\/\/|\*).*$/gm, '');
    for (const v of [
      'allow_partial_execution',
      'bulk_change_confirmation',
      'change_confirmation',
      'verification_timeout',
    ]) {
      assert.ok(
        !visible.includes(`>${v}`) && !new RegExp(`"[^"]*${v}[^"]*"\\s*[},]`).test(visible),
        `${NAMES[i]}: playbook degiskeni "${v}" kullaniciya gosteriliyor`,
      );
    }
  }
});

// ── U13 Durum sizintisi ─────────────────────────────────────────────────────

test('U13 calistirmaya ozel TUM alanlar sifirlaniyor (HER iki yolda)', () => {
  // Bir onceki calistirmanin izleri `resetRunState()`te temizlenir; sihirbaz SECIMLERI
  // `restart()`ta. Ikisi ayri, cunku panelden gelen "Geri Al" kisayolu izleri temizler
  // ama secimleri KENDISI belirler.
  const reset = PAGE.slice(
    PAGE.indexOf('function resetRunState()'),
    PAGE.indexOf('function restart()'),
  );
  for (const f of [
    'setJob',
    'setRunResult',
    'setTrackedJobId',
    'setCatalogWarning',
    'setNotice',
    'setError',
    'setCancelling',
    'setElapsed',
  ]) {
    assert.ok(
      reset.includes(f),
      `resetRunState() ${f} cagirmiyor — onceki islemin izi ekranda kalir`,
    );
  }

  const body = PAGE.slice(
    PAGE.indexOf('function restart()'),
    PAGE.indexOf('async function guarded'),
  );
  // `env`/`tenant`/`clusters` BILEREK korunuyor (kullanici ayni kapsamda ikinci bir
  // islem yapacak). Ama calistirmaya ozel her alan sifirlanmali; kalan bir deger
  // sonraki isleme SESSIZCE tasinir.
  for (const f of [
    'setNamespace',
    'setApps',
    'setWorkloads',
    'setAction',
    'setExecutionMode',
    'setTargetReplicas',
    'setVerificationTimeout',
    'setAllowPartial',
    'setMailCc',
  ]) {
    assert.ok(body.includes(f), `restart() ${f} cagirmiyor — deger sonraki isleme tasinir`);
  }
  assert.ok(
    body.includes('resetRunState()'),
    'restart() onceki calistirmanin izlerini temizlemiyor',
  );
});

test('U13b panelden gelen "Geri Al" da onceki calistirmanin izlerini TEMIZLIYOR', () => {
  // Bu yol uzun sure HICBIR sey sifirlamiyordu: onceki islemin sonuc paneli ve BASKA
  // BIR UYGULAMANIN saglik satirlari yeni islemin ekraninda duruyordu, ustelik
  // `healthStartedRef` hala true oldugu icin saglik kontrolu bir daha hic kosmuyordu.
  const body = PAGE.slice(PAGE.indexOf('function restoreFromPanel'), PAGE.indexOf('const back ='));
  assert.ok(
    body.includes('resetRunState()'),
    'restoreFromPanel onceki calistirmanin izlerini temizlemiyor',
  );
  // Temizlik, yeni degerler yazilmadan ONCE olmali; sonra cagrilirsa onlari ezer.
  assert.ok(
    body.indexOf('resetRunState()') < body.indexOf('setClusters('),
    'resetRunState() yeni degerlerden SONRA cagriliyor — onlari ezer',
  );
});

test('U14 restoreFromPanel geri alma icin gerekli alanlari SET ediyor', () => {
  const body = PAGE.slice(PAGE.indexOf('function restoreFromPanel'), PAGE.indexOf('const back ='));
  for (const f of [
    'setClusters',
    'setNamespace',
    'setApps',
    'setWorkloads',
    'setAction',
    'setExecutionMode',
    'setStep',
  ]) {
    assert.ok(body.includes(f), `restoreFromPanel ${f} cagirmiyor`);
  }
  assert.match(body, /restorable:\s*true/, 'geri alinabilirlik isaretlenmemis');
});

// ── U15 Kapi el sikismasi ───────────────────────────────────────────────────

test('U15 kullanici kapi yanitinda KILITLENMIYOR', () => {
  // Sunucu `ocoDecisionRequired` / `ocoExpired` / `writtenConfirmRequired` /
  // `reasonRequired` donebilir. Bunlar HATA DEGIL, bir el sikisma adimidir; ekran
  // yalnizca `setError` yapip birakirsa kullanici ne yapacagini bilemez.
  const body = PAGE.slice(PAGE.indexOf('function run('), PAGE.indexOf('function cancel('));
  assert.match(
    body,
    /ocoDecisionRequired|ocoExpired|writtenConfirmRequired|reasonRequired/,
    'kapi el sikisma yanitlari ele alinmiyor — kullanici cikmaza duser',
  );
});

test('U16 pendingApproval ayri ele aliniyor (hata degil)', () => {
  assert.match(codeOnly(PAGE), /r\.pendingApproval[\s\S]{0,200}setNotice/);
});

// ── U17 API ↔ sunucu alan adlari ────────────────────────────────────────────

test('U17 API istemcisi sunucunun DONDURDUGU alan adlarini okuyor', () => {
  const server = fs.readFileSync(path.join(ROOT, '..', 'server', 'scalex', 'index.cjs'), 'utf8');
  for (const f of ['serverId', 'templateId', 'jobId', 'status']) {
    assert.ok(API.includes(f), `scalexApi ${f} tipini tanimlamiyor`);
  }
  assert.ok(server.includes('catalogWarning'), 'sunucu catalogWarning dondurmuyor');
  assert.ok(API.includes('catalogWarning'), 'API catalogWarning tipini tanimlamiyor');
  assert.ok(server.includes('hiddenCount'), 'sunucu hiddenCount dondurmuyor');
  assert.ok(API.includes('hiddenCount'), 'API hiddenCount tipini tanimlamiyor');
});

test('U18 API tum uclari BASE onekiyle cagiriyor', () => {
  for (const m of API.matchAll(/fetch\(`?([^`,)]*)/g)) {
    const url = m[1];
    if (!url || url.startsWith('${BASE}') || url.includes('BASE')) continue;
    assert.fail(`API BASE disi cagri: ${url}`);
  }
});

// ── U19 Sonuc sunumu ────────────────────────────────────────────────────────

test("U19 strict_blocked FAIL'den AYRI gosteriliyor", () => {
  assert.match(codeOnly(RESULT), /result\.strictBlocked/);
  assert.match(RESULT, /Hiçbir değişiklik uygulanmadı/);
});

test('U20 validation asamasi ayri ekran', () => {
  assert.match(codeOnly(RESULT), /result\.stage === "validation"/);
  assert.match(RESULT, /validationError/);
});

test('U21 kismi basari sayaclari gosteriliyor', () => {
  assert.match(RESULT, /counts\.ok[\s\S]{0,120}counts\.warn[\s\S]{0,120}counts\.fail/);
});

test('U22 ayrinti YALNIZCA sorunlu satirlarda', () => {
  assert.match(codeOnly(RESULT), /t\.status !== "OK" && t\.detail/);
});

test('U23 kirpma kullaniciya soyleniyor', () => {
  assert.match(codeOnly(RESULT), /targetsTruncated/);
});

// ── U24 Sapma ───────────────────────────────────────────────────────────────

test('U24 uc sapma durumunun ikisi kullaniciya ACIKLANIYOR', () => {
  assert.match(STOPPED, /missing_on_cluster/);
  assert.match(STOPPED, /unknown_to_portal/);
  assert.match(STOPPED, /elle geri almış|elle durdurulmuş/);
});

test('U25 sapmali kayitta ve SUREN islemde "Geri Al" GOSTERILMIYOR', () => {
  const code = codeOnly(STOPPED);
  // Cluster'da ConfigMap yokken geri alma denemek `STATE;FAIL` ile duserdi.
  assert.match(
    code,
    /driftStatus === "in_sync"[\s\S]{0,60}onRestore/,
    'sapmali kayitta buton hala gosteriliyor',
  );
  // Suren bir geri alma varken sunucu ikinci istegi 409 ile reddediyor (ayna kilidi).
  // Butonu acik birakmak, kullaniciyi reddedilecek bir istege gondermek olurdu.
  assert.match(
    code,
    /phase !== "restoring"[\s\S]{0,60}onRestore/,
    'geri alma surerken buton hala tiklanabiliyor',
  );
  assert.match(code, /Geri alma sürüyor/, 'suren islem kullaniciya SOYLENMIYOR');
});

// ── U26 Kayit / yonlendirme ─────────────────────────────────────────────────

test('U26 sayfa uc yerde de AYNI anahtarla kayitli', () => {
  const app = read('App.tsx');
  const elements = read('config/elements.ts');
  assert.match(app, /pageId="ScaleX"/);
  assert.match(app, /path="\/scalex"/);
  assert.match(elements, /id: "ScaleX"/);
  assert.match(elements, /route: "\/scalex"/);
  assert.ok(
    elements.includes('"ScaleX"') && /itemIds:.*ScaleX/.test(elements),
    'nav grubuna eklenmemis',
  );
});

test('U27 sayfa route bazli code-splitting ile yukleniyor', () => {
  assert.match(
    read('App.tsx'),
    /React\.lazy\(\(\) => import\("@\/components\/scalex\/ScaleXPage"\)\)/,
  );
});

// ── U28 Kullanilmayan/olu kod ───────────────────────────────────────────────

test("U28 OperationStep'in topladigi HER alan calistirmaya gidiyor", () => {
  const runBody = PAGE.slice(
    PAGE.indexOf('const r = await scalexApi.run('),
    PAGE.indexOf('if (!r.ok)'),
  );
  for (const f of [
    'action',
    'executionMode',
    'targetReplicas',
    'verificationTimeout',
    'allowPartial',
    'mailCc',
  ]) {
    assert.ok(runBody.includes(f), `${f} toplaniyor ama calistirmaya GONDERILMIYOR`);
  }
});

test('U29 kullanilmayan import yok', () => {
  for (let i = 0; i < ALL_TSX.length; i++) {
    const code = ALL_TSX[i];
    const imports = [...code.matchAll(/import\s+(?:\{([^}]*)\}|(\w+))\s+from/g)];
    for (const m of imports) {
      const names = (m[1] || m[2] || '')
        .split(',')
        .map((x) =>
          x
            .trim()
            .split(/\s+as\s+/)
            .pop(),
        )
        .filter(Boolean);
      for (const n of names) {
        if (n.startsWith('type ')) continue;
        const body = code.slice(code.indexOf('\n', m.index));
        assert.ok(
          new RegExp(`\\b${n.replace('type ', '')}\\b`).test(body),
          `${NAMES[i]}: kullanilmayan import → ${n}`,
        );
      }
    }
  }
});

test('U30 sonsuz yoklama dongusunde hata siniri var', () => {
  assert.match(
    codeOnly(WORKLOAD),
    /MAX_POLL_ERRORS/,
    'ardisik hatada donguden cikilmazsa sekme sonsuza dek istek atar',
  );
});

// ═══ V. YENI DAVRANISLAR (HPA / GitOps / yas / saglik / tasima) ════════════

test('V1 HPA sabitleme kutusu ONCEDEN SECILI DEGIL', () => {
  // HPA'ya dokunmak mevcut politikanin tersi — kullanici BILINCLI olarak istemeli.
  // Kullanicinin onceki secimi geri yuklenebilir, ama VARSAYILAN daima `false`:
  // `previous` yoksa kutu isaretsiz gelir.
  const code = codeOnly(OPERATION);
  assert.match(code, /const \[hpaPin, setHpaPin\] = useState\(previous\?\.hpaPin \?\? false\)/);
  assert.ok(
    !/const \[hpaPin, setHpaPin\] = useState\((true|previous\?\.hpaPin \?\? true)\)/.test(code),
    'HPA sabitleme varsayilan olarak ACIK olamaz',
  );
});

test('V2 HPA sabitleme `Durdur`da HIC sunulmuyor', () => {
  const code = codeOnly(OPERATION);
  assert.match(code, /action !== "stop"/, 'stop dalinda sabitleme gosterilmemeli');
  assert.match(code, /pinRelevant[\s\S]{0,200}action === "restore"/);
});

test('V3 `Durdur` + HPA icin DOGRU aciklama gosteriliyor', () => {
  // Kullanicinin sartı: "HPA bile olsa 0 podda kalabilmeli". Ekran bunun NEDEN
  // calistigini soylemeli, yoksa kullanici HPA rozetini gorup vazgecer.
  assert.match(OPERATION, /replica 0 olduğunda[\s\S]{0,120}devre dışı/);
});

test('V4 `Ölçekle` + HPA icin "kalici olmayabilir" uyarisi var', () => {
  assert.match(OPERATION, /kalıcı olmayabilir/);
});

test('V5 GitOps rozeti gosteriliyor', () => {
  assert.match(codeOnly(WORKLOAD), /w\.gitops &&/);
  assert.match(WORKLOAD, /GitOps ile yönetiliyor/);
});

test('V6 PDB uyarisi ekrana tasiniyor', () => {
  assert.match(codeOnly(WORKLOAD), /pdbWarning/);
});

test('V7 onizleme GitOps ve HPA sabitleme durumunu soyluyor', () => {
  assert.match(codeOnly(PREVIEW), /w\.gitops/);
  assert.match(codeOnly(PREVIEW), /hpaPin &&/);
});

test('V8 durdurma yasi esigi hesaplaniyor', () => {
  assert.match(codeOnly(STOPPED), /STALE_DAYS/);
  assert.match(codeOnly(STOPPED), /daysSince/);
  assert.match(STOPPED, /gündür durdurulmuş/);
});

test('V9 saglik kontrolu YALNIZCA gercek degisiklikten sonra kosar', () => {
  const body = PAGE.slice(
    PAGE.indexOf('healthStartedRef.current) return'),
    PAGE.indexOf('// İş bitince yapılandırılmış'),
  );
  assert.match(body, /mode !== ["']apply["']/, 'dry_run sonrasi saglik kontrolu anlamsiz');
  assert.match(
    body,
    /action === ["']stop["']/,
    'Durdur sonrasi 0 pod bekleniyor — saglik kontrolu anlamsiz',
  );
  assert.match(
    body,
    /overallStatus === ["']FAIL["']/,
    'zaten basarisiz bir iste saglik sormanin anlami yok',
  );
});

test('V10 saglik kontrolu BEST-EFFORT — asil sonucu gizlemiyor', () => {
  const body = PAGE.slice(
    PAGE.indexOf('healthStartedRef.current = true'),
    PAGE.indexOf('// İş bitince yapılandırılmış'),
  );
  // Yetki hatasi (401/403) donguyu DURDURUR — gereksiz yeniden deneme yapilmaz.
  assert.match(body, /401.*403|403.*401/, 'saglik yoklamasi 401/403 hatasinda durmali');
  // Diger hatalar BEST-EFFORT: asil sonucu gizlememeli.
  assert.match(body, /catch\s*\(/, 'saglik kontrolu hatasi asil sonuc ekranini bozmamali');
});

test('V11 saglik kontrolu bir kez kosar (ref ile kilitli)', () => {
  assert.match(codeOnly(PAGE), /healthStartedRef\s*=\s*useRef\(false\)/);
});

test('V12 saglik durumu ve kilidi de sifirlaniyor', () => {
  // Saglik izi `resetRunState()`te — boylece panelden gelen geri alma yolunda da
  // temizleniyor (eskiden yalnizca `restart()`ta vardi ve o yol onu hic cagirmiyordu).
  const reset = PAGE.slice(
    PAGE.indexOf('function resetRunState()'),
    PAGE.indexOf('function restart()'),
  );
  assert.ok(reset.includes('setHealth(null)'), 'onceki islemin saglik sonucu ekranda kalirdi');
  assert.ok(
    reset.includes('healthStartedRef.current = false'),
    'ikinci islem icin saglik hic kosmazdi',
  );
  const body = PAGE.slice(
    PAGE.indexOf('function restart()'),
    PAGE.indexOf('async function guarded'),
  );
  assert.ok(body.includes('setHpaPin(false)'), 'HPA sabitleme tercihi sonraki isleme tasinirdi');
});

test('V13 hpaPin calistirmaya GERCEKTEN gonderiliyor', () => {
  const runBody = PAGE.slice(
    PAGE.indexOf('const r = await scalexApi.run('),
    PAGE.indexOf('if (!r.ok)'),
  );
  assert.ok(runBody.includes('hpaPin'), 'kutu isaretlense de sunucuya gitmezdi');
});

test('V14 ekranda "chaos" gecmiyor', () => {
  for (let i = 0; i < ALL_TSX.length; i++) {
    assert.ok(!/chaos/i.test(ALL_TSX[i]), `${NAMES[i]}: eski ad kalmis`);
  }
});

// ── W. SONUC EKRANINDAN HIZLI GERI ALMA (2026-09-02) ───────────────────────

test('W1 hizli geri alma YALNIZCA gercekten geri alinabilir sonucta cikar', () => {
  const code = codeOnly(RESULT);
  // `scale` kayit BIRAKMAZ, `dry_run` cluster'a hic dokunmadi, OK olmayan hedef
  // aynaya yazilmadi — ucunde de geri alinacak bir sey yok. Butonu yine de
  // gostermek, kullaniciyi kesin dusecek bir ise gondermek olurdu.
  assert.match(code, /result\.action !== "stop"/, 'stop disinda buton gizlenmiyor');
  assert.match(code, /result\.mode !== "apply"/, 'dry_run sonrasi buton gizlenmiyor');
  assert.match(code, /status === "OK"/, 'yalnizca OK hedefler kapsanmali');
});

test('W2 kirpilmis listede kapsam ACIKCA soyleniyor', () => {
  // Kirpilmis bir listede buton yalnizca GORUNEN hedefleri kapsar. Bunu
  // soylememek, "hepsi geri alindi" yalani olurdu.
  assert.match(
    codeOnly(RESULT),
    /targetsTruncated[\s\S]{0,120}yalnızca yukarıda görünen/,
    'kirpilmis listede kapsam uyarisi yok',
  );
});

test('W3 hizli geri alma UYDURMA replica sayisi tasimiyor', () => {
  // Portal onceki replica sayisini BILMIYOR (deger cluster'daki durum kaydinda) ve
  // sonuc satiri onu tasimiyor. Uydurulmus bir sayi geri almayi BOZARDI.
  const body = PAGE.slice(PAGE.indexOf('function restoreFromResult'), PAGE.indexOf('const back ='));
  assert.match(body, /previousReplicas:\s*null/, 'uydurulmus previousReplicas yazilmis');
  assert.match(body, /setHpaPin\(false\)/, 'hedef bilinmiyorken HPA sabitleme kapali olmali');
  assert.match(body, /resetRunState\(\)/, 'onceki islemin izleri temizlenmiyor');
});

// ── X. ONIZLEMEDE CANLI BILGI (2026-09-02) ─────────────────────────────────

test('X1 UYDURMA metrik gosterilmiyor: canli ayrinti yalnizca KESIF satirlarinda', () => {
  // Panelden/sonuctan gelen kisayolda satirlar AYNADAN turetiliyor ve
  // `specReplicas`/`readyReplicas`/`image` 0/null oluyor. Bunlari gostermek,
  // prod'da tek tikla apply'a giden akista "0/0 hazir, imaj yok" diye
  // UYDURULMUS bir gerceklik sunmak olurdu.
  const code = codeOnly(PREVIEW);
  assert.match(code, /w\.source === "discovery"/, 'kaynak ayrimi yapilmiyor');
  assert.match(code, /\{live &&/, 'canli ayrinti kaynak ayrimindan GECMIYOR');
  // Mevcut replica sayisi da kaynaga bagli olmali.
  assert.match(
    code,
    /live \? w\.specReplicas : "\?"/,
    'mevcut replica sentetik satirda uydurma gosteriliyor',
  );
});

test('X2 sentetik satirlar `source: "mirror"` ile isaretleniyor', () => {
  // `source` ZORUNLU bir alan; opsiyonel olsaydi yeni bir sentetik yol eklendiginde
  // unutulur ve uydurma metrikler sessizce ekrana duserdi.
  const api = read('api/scalexApi.ts');
  assert.match(api, /source:\s*"discovery"\s*\|\s*"mirror";/, 'kaynak alani opsiyonel ya da yok');
  const page = codeOnly(PAGE);
  const synthetic = (page.match(/source:\s*["']mirror["']/g) || []).length;
  assert.equal(
    synthetic,
    2,
    `sentetik kurulum sayisi degismis (${synthetic}) — yeni yol isaretlenmemis olabilir`,
  );
});

test('X3 "zaten durdurulmus" rozeti YALNIZCA `stop` dalinda', () => {
  // Bir GERI ALMA onizlemesinde bu rozet, kullaniciya yanlis islem yaptigini
  // dusundururdu — geri alinan uygulama zaten durdurulmus olmali.
  assert.match(
    codeOnly(PREVIEW),
    /action === "stop" && w\.statePhase === "scaled_down"/,
    'rozet islemden bagimsiz gosteriliyor',
  );
});

test('X4 calistirma ayarlari ve VERI TAZELIGI onizlemede', () => {
  const code = codeOnly(PREVIEW);
  // Bu uc deger `İşlem` adiminda toplaniyor ve dogrudan calistirmaya gidiyordu ama
  // onizlemede hic gorunmuyordu.
  assert.match(code, /allowPartial \?/, '"hepsi ya da hicbiri" karari onizlemede yok');
  assert.match(code, /Sonuç kontrolü/, 'dogrulama suresi onizlemede yok');
  assert.match(code, /Rapor CC/, 'CC adresleri onizlemede yok');
  // Onizleme yeniden kesif YAPMIYOR: damga olmadan dakikalar once alinmis bir
  // replica sayisi "su anki durum" sanilirdi.
  assert.match(code, /fetchedAt[\s\S]{0,120}alındı/, 'veri tazeligi damgasi yok');
});

// ── Y: HER WORKLOAD TIPI EKRANDA ─────────────────────────────────────────────
//
// Uretimde bildirilen "StatefulSet kesifte cikmiyor" sorununun ekran tarafi.
// Kesif artik alti tipe bakiyor ve bakamadigi tipi de bildiriyor; ekranin bunlari
// GOSTERDIGINI ve olceklenemeyenleri SECTIRMEDIGINI kilitler.

test('Y1 tekillestirme ADA bazinda — ayni ad farkli tipte bile tek satir', () => {
  const code = codeOnly(WORKLOAD);
  // Secim artik uygulama adi bazinda; ayni ad farkli cluster'larda farkli
  // tipte olabilir ve tek tikla hepsi secilir. Tip ozeti satirda gosterilir.
  assert.match(code, /byName\.set\(w\.name,\s*w\)/, 'tekillestirme ada gore yapilmiyor');
  assert.doesNotMatch(
    code,
    /\$\{w\.name\}\\u0000\$\{w\.kind\}/,
    'satir anahtari hala ad+tip — name-only secim bozulur',
  );
});

test('Y2 ayni ad farkli tipte ise ekran TIP OZETI ve UYARI gosterir', () => {
  const code = codeOnly(WORKLOAD);
  // Ayni adin farkli cluster'larda farkli tipi olabilir; ekran bunu
  // `kindSummaryByName` ile hesaplar ve "cluster'a gore degisir" uyarisiyla
  // kullaniciya bildirir.
  assert.match(code, /kindSummaryByName/, 'tip ozeti hesaplanmiyor');
  assert.match(
    code,
    /cluster[’']a göre değişir/,
    'kullaniciya farkli clusterlarda farkli tip oldugu soylenmiyor',
  );
});

test('Y3 olceklenemeyen tipler LISTEDE ama SECILEMEZ', () => {
  const code = codeOnly(WORKLOAD);
  // TANIMLAYICININ VARLIGI DEGIL, KARAR NOKTASINDAKI KULLANIMI aranir: `scalable`
  // bu dosyada baska yerde de geciyor (cakisma hesabinda) ve yalnizca adini aramak,
  // satir kilidi tamamen kaldirildiginda bile bekciyi YESIL birakiyordu (mutasyonla
  // dogrulandi).
  assert.match(
    code,
    /const locked = w\.scalable === false/,
    'satir kilidi olceklenebilirlikten TURETILMIYOR',
  );
  // Harfi harfine bir ifade DEGIL, `locked`in secimi gercekten kapattigi aranir:
  // ekran daha sonra baska kilit kosullari da ekleyebilir (ekledi de).
  assert.match(
    code,
    /disabled=\{[^}]*\blocked\b[^}]*\}/,
    'DaemonSet/CronJob secilebilir kaliyor — replica ile olceklenemezler',
  );
  assert.match(code, /checked=\{!locked/, 'kilitli satir yine de isaretli gorunebilir');
  assert.match(code, /ölçeklenemez/, 'neden secilemedigi yazmiyor');
  // Neden'i de yazmali: "olceklenemez" tek basina kullaniciyi AWX log'una gonderir.
  assert.match(code, /suspend gerekir/, 'CronJob icin suspend aciklamasi yok');
  assert.match(code, /düğüm sayısıyla ölçeklenir/, 'DaemonSet icin dugum aciklamasi yok');
});

test('Y4 BAKILAMAYAN tip ekranda gorunur ve nedeni AYRISTIRILIR', () => {
  const code = codeOnly(WORKLOAD);
  // Hesaplanmasi yetmez; RENDER edilmesi gerekir (ayni kor nokta).
  assert.match(
    code,
    /\{unreadableKinds\.length > 0 && \(/,
    'bakilamayan tipler hesaplaniyor ama EKRANA hic basilmiyor',
  );
  // Iki neden kullanici icin tamamen farkli: biri platformdan ISTENEBILIR,
  // digeri hakkinda yapacak bir sey olmayan bir olgu. Ayni cumleye sokmak,
  // kullaniciyi bos yere platform ekibine gondermek olurdu.
  assert.match(code, /no_permission/, 'yetki eksikligi ayirt edilmiyor');
  assert.match(code, /ClusterRole/, 'platformdan NE isteneceği yazmiyor');
  assert.match(code, /API\/CRD yok/, 'API yoklugu icin "yapacak bir sey yok" denmiyor');
});

test('Y5 paket surumu uyusmazliginda ekran TAHMIN ETMEZ, soyler', () => {
  const code = codeOnly(WORKLOAD);
  assert.match(code, /pkg\.running !== pkg\.expected/, 'surum karsilastirmasi yok');
  assert.match(code, /scalex_app\//, 'ne yapilmasi gerektigi (yeniden kopyalama) yazmiyor');
});

test('Y6 tip haritasi YALNIZCA kesiften gelen satirlardan uretilir', () => {
  const page = codeOnly(PAGE);
  assert.match(page, /workloadKinds/, 'tip haritasi hic gonderilmiyor');
  // Aynadan turetilen satirlarda tip alani ESKI bir kayittan gelir; bayat bir
  // tiple islem yapmak yanlis nesneye dokunmak demektir.
  assert.match(
    page,
    /w\.source === ["']discovery["'][\s\S]{0,120}workloadKinds|workloadKinds[\s\S]{0,200}w\.source === ["']discovery["']/,
    'bayat (ayna kaynakli) tipler de haritaya giriyor olabilir',
  );
});

test('Y7 ayni ad farkli tipte oldugunda secim IZIN VERILIR; her cluster kendi tipiyle gider', () => {
  const code = codeOnly(WORKLOAD);
  const page = codeOnly(PAGE);
  // Yeni sozlesme: UI name-only secer; cluster basina kind haritasi AWX'e gider.
  // Playbook ayni cluster icindeki belirsizligi `auto` taramasiyla cozer.
  assert.doesNotMatch(code, /const kindBlocked = isKindBlocked\(w\)/, 'eski tip kilidi hala var');
  assert.doesNotMatch(
    code,
    /farklı bir tip seçildi/,
    'kullanici artik farkli tip yuzunden engellenmiyor',
  );
  assert.match(
    code,
    /clusterWorkloadKinds/,
    'per-cluster tip haritasi WorkloadStep icinde uretilmiyor',
  );
  assert.match(page, /clusterWorkloadKinds/, 'per-cluster tip haritasi calistirmaya gitmiyor');
});

// ── Z: SECIM TURU VE SECILEMEZ LISTE (denetim bulgulari B2 / B3) ─────────────

test('Z1 secim kimligi KOSULSUZ AD — geri donuste secim kaybolmaz', () => {
  const code = codeOnly(WORKLOAD);
  // Anahtar yalnizca uygulama adidir; `ScaleXPage` bu adi `initial` olarak geri verir.
  // Eski kosullu ad+tip anahtari "Geri" donusunde kutu bos gorunup sayac "1 secili"
  // diyen tutarsizliga yol aciyordu.
  assert.doesNotMatch(
    code,
    /ambiguousNames\.has\(w\.name\) \? `\$\{w\.name\}/,
    'secim kimligi hala KOSULLU',
  );
  assert.match(
    code,
    /const keyOf = \(w: ScaleXWorkload\) => w\.name/,
    'tek kimlik fonksiyonu name donmuyor',
  );
  assert.match(
    code,
    /const isSelected = \(w: ScaleXWorkload\) => selected\.includes\(keyOf\(w\)\)/,
    'secim kontrolu keyOf uzerinden gitmiyor',
  );
});

test('Z2 secim anahtarlari ekrana GERI VERILIR', () => {
  const code = codeOnly(WORKLOAD);
  const page = codeOnly(PAGE);
  assert.match(code, /selectedKeys: selected/, 'anahtarlar onSubmit ile donmuyor');
  assert.match(page, /setWorkloadKeys\(v\.selectedKeys\)/, 'anahtarlar saklanmiyor');
  assert.match(
    page,
    /initial=\{workloadKeys\}/,
    '`initial` hala duz ad listesi — geri donuste secim eslesmez',
  );
  // Yeni namespace/yeniden baslatma eski secimi TASIMAMALI.
  assert.match(page, /setWorkloadKeys\(\[\]\)/, 'sifirlama yollarinda anahtarlar temizlenmiyor');
});

test('Z3 liste dolu ama hicbiri secilemiyorsa SEBEBI yazilir', () => {
  const code = codeOnly(WORKLOAD);
  // "Bulunamadi" bloku ateslenmez (liste bos degil), `Devam` pasiftir ve sebep
  // hicbir yerde yazmazdi — ekranin sustugu sinifin ta kendisi.
  assert.match(
    code,
    /list\.length > 0 && list\.every\(\(w\) => w\.scalable === false\)/,
    'yalnizca secilemez satir kalan durum hic ele alinmiyor',
  );
  assert.match(code, /replica ile ölçeklenemeyen/, 'kullaniciya sebep yazilmiyor');
});

// ── W: DENETIM BULGULARI B2 / B3 ────────────────────────────────────────────

test('W1 RBAC cumlesi TAM KAYNAK ADINI yazar (kisa ad platform ekibine yanlis metin goturur)', () => {
  const code = codeOnly(WORKLOAD);
  // Runner `resource=statefulsets.apps` basiyordu ama portal alani DUSURUYOR, ekran da
  // `list sts` yaziyordu. `oc auth can-i list sts` kisa adi guvenilir cozmez ve RBAC
  // kurallari tam adla yazilir — kullanici platform ekibine calismayacak bir metin
  // goturuyordu. Runner tarafini D7c kilitliyor; bu, sozlesmenin EKRAN ucu.
  assert.match(
    code,
    /\{k\.verb \|\| ['"]list['"]\} \{k\.resource \|\| k\.kind\}/,
    'ekran hala kisa adi yaziyor — tam kaynak adi kullanilmali',
  );
});

test('W2 keşfedilen CRD, DaemonSet metniyle ANLATILMAZ', () => {
  const code = codeOnly(WORKLOAD);
  // `unsupported_kind` tek bir `else` daline dusuyordu ve o dal DaemonSet'e ozgudur:
  // uc replicali bir Kafka icin "0 dugumde calisiyor · dugum sayisiyla olceklenir"
  // yaziyordu — iki olgu da yanlis (`desired` bos oldugu icin sayi 0 gorunuyordu).
  assert.match(
    code,
    /notScalableReason === ['"]unsupported_kind['"]/,
    'kesfedilen CRD icin ayri dal yok — DaemonSet metnine duser',
  );
  assert.match(code, /bu nesne tipini henüz işleyemiyor/, 'kullaniciya dogru sebep yazilmiyor');
  // Uc dal da AYRI kalmali: suspend (CronJob) · unsupported_kind (CRD) · dugum (DaemonSet).
  assert.match(code, /düğüm sayısıyla ölçeklenir/, 'DaemonSet dali kaybolmus');
  assert.match(code, /suspend gerekir/, 'CronJob dali kaybolmus');
});
