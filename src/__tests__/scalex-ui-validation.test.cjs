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
const codeOnly = (s) => s
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
  .join('\n');

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
const NAMES = ['ScaleXPage', 'WorkloadStep', 'OperationStep', 'PreviewStep', 'ScaleXResultPanel', 'StoppedPanel', 'ScopeStep', 'NamespaceStep'];

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
  assert.match(code, /aliveRef|cancelled|abort/i,
    'yoklama dongusunde unmount kontrolu yok — istek ve setState sizar');
});

// ── U4 Hook sirasi ──────────────────────────────────────────────────────────

test('U4 hicbir bilesende hook\'lardan ONCE erken return yok', () => {
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
      code.lastIndexOf('useState('), code.lastIndexOf('useEffect('),
      code.lastIndexOf('useMemo('), code.lastIndexOf('useRef(')
    );
    if (firstReturn < 0 || lastHook < 0) continue;
    assert.ok(firstReturn > lastHook,
      `${NAMES[i]}: erken return hook'lardan ONCE — hook sirasi kirilir`);
  }
});

// ── U5 Tema uyumu ───────────────────────────────────────────────────────────

test('U5 koyu temada kirilan SABIT renk yok', () => {
  // `src/index.css`teki uyum katmani Tailwind'in gri/kirmizi/amber tonlarini token'lara
  // esliyor, ama `bg-white` BILEREK eslenmedi (renkli zemin ustunde kullanilsin diye).
  // Koyu temada beyaz bir girdi kutusu okunamaz hale gelir.
  for (let i = 0; i < ALL_TSX.length; i++) {
    assert.ok(!/\bbg-white\b/.test(codeOnly(ALL_TSX[i])),
      `${NAMES[i]}: bg-white koyu temada kirilir — token kullan`);
  }
});

test('U6 rozetler ortak pf-label sinifini kullaniyor', () => {
  const css = fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8');
  const used = new Set();
  for (const code of ALL_TSX) for (const m of code.matchAll(/pf-label--(\w+)/g)) used.add(m[1]);
  assert.ok(used.size > 0, 'hic pf-label kullanilmamis');
  for (const v of used) assert.ok(css.includes(`pf-label--${v}`), `pf-label--${v} CSS'te tanimli degil`);
});

// ── U7 Erisilebilirlik ──────────────────────────────────────────────────────

test('U7 kesilen (truncate) her oge title tasiyor', () => {
  for (let i = 0; i < ALL_TSX.length; i++) {
    const code = ALL_TSX[i];
    for (const m of code.matchAll(/<span[^>]*\btruncate\b[^>]*>/g)) {
      assert.ok(/title=/.test(m[0]),
        `${NAMES[i]}: kesilen deger okunamiyor (title yok) → ${m[0].slice(0, 90)}`);
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
      if (/type="(checkbox|radio)"/.test(a)) continue;   // <label> icinde sarili
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
  assert.match(codeOnly(OPERATION), /useState<ScaleXMode \| null>\(null\)/,
    'calistirma modu ONCEDEN secili gelmemeli');
  assert.match(codeOnly(OPERATION), /useState<ScaleXAction \| null>\(null\)/);
});

test('U11 iki mod kartinin sinif dizesi AYNI', () => {
  // ARAYA OZNITELIK GIREBILIR (orn. `aria-pressed`): desen `onClick`ten sonra
  // DOGRUDAN `className` bekliyordu ve bir oznitelik eklenince kural aynen dururken
  // bekci "iki mod karti bulunamadi" ile kirmizi oluyordu. Kurali olcuyoruz, duzeni
  // degil — `[^`]` sinifi geri-tirnak icermedigi icin arada baska bir sablon dizesi
  // yakalanmasi mumkun degil.
  const cards = [...OPERATION.matchAll(/onClick=\{\(\) => setMode\("(dry_run|apply)"\)\}[^`]*?className=\{`([^`]+)`\}/g)];
  assert.equal(cards.length, 2, 'iki mod karti bulunamadi');
  const norm = (s) => s.replace(/mode === "\w+"/, 'MODE').replace(/\s+/g, ' ').trim();
  assert.equal(norm(cards[0][2]), norm(cards[1][2]), 'iki secenek gorsel olarak esit agirlikta DEGIL');
});

test('U12 playbook degisken adlari ekranda GORUNMUYOR', () => {
  for (let i = 0; i < ALL_TSX.length; i++) {
    const visible = ALL_TSX[i].replace(/^\s*(\/\/|\*).*$/gm, '');
    for (const v of ['allow_partial_execution', 'bulk_change_confirmation', 'change_confirmation', 'verification_timeout']) {
      assert.ok(!visible.includes(`>${v}`) && !new RegExp(`"[^"]*${v}[^"]*"\\s*[},]`).test(visible),
        `${NAMES[i]}: playbook degiskeni "${v}" kullaniciya gosteriliyor`);
    }
  }
});

// ── U13 Durum sizintisi ─────────────────────────────────────────────────────

test('U13 restart() calistirmaya ozel TUM alanlari sifirliyor', () => {
  const body = PAGE.slice(PAGE.indexOf('function restart()'), PAGE.indexOf('async function guarded'));
  // `env`/`tenant`/`clusters` BILEREK korunuyor (kullanici ayni kapsamda ikinci bir
  // islem yapacak). Ama calistirmaya ozel her alan sifirlanmali; kalan bir deger
  // sonraki isleme SESSIZCE tasinir.
  for (const f of ['setNamespace', 'setApps', 'setWorkloads', 'setAction', 'setExecutionMode',
    'setTargetReplicas', 'setVerificationTimeout', 'setAllowPartial', 'setMailCc',
    'setJob', 'setRunResult', 'setTrackedJobId', 'setCatalogWarning', 'setNotice', 'setError']) {
    assert.ok(body.includes(f), `restart() ${f} cagirmiyor — deger sonraki isleme tasinir`);
  }
});

test('U14 restoreFromPanel geri alma icin gerekli alanlari SET ediyor', () => {
  const body = PAGE.slice(PAGE.indexOf('function restoreFromPanel'), PAGE.indexOf('const back ='));
  for (const f of ['setClusters', 'setNamespace', 'setApps', 'setWorkloads', 'setAction', 'setExecutionMode', 'setStep']) {
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
  assert.match(body, /ocoDecisionRequired|ocoExpired|writtenConfirmRequired|reasonRequired/,
    'kapi el sikisma yanitlari ele alinmiyor — kullanici cikmaza duser');
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

test('U19 strict_blocked FAIL\'den AYRI gosteriliyor', () => {
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

test('U25 sapmali kayitta "Geri Al" GOSTERILMIYOR', () => {
  // Cluster'da ConfigMap yokken geri alma denemek `STATE;FAIL` ile duserdi.
  assert.match(codeOnly(STOPPED), /driftStatus === "in_sync" && onRestore/);
});

// ── U26 Kayit / yonlendirme ─────────────────────────────────────────────────

test('U26 sayfa uc yerde de AYNI anahtarla kayitli', () => {
  const app = read('App.tsx');
  const elements = read('config/elements.ts');
  assert.match(app, /pageId="ScaleX"/);
  assert.match(app, /path="\/scalex"/);
  assert.match(elements, /id: "ScaleX"/);
  assert.match(elements, /route: "\/scalex"/);
  assert.ok(elements.includes('"ScaleX"') && /itemIds:.*ScaleX/.test(elements), 'nav grubuna eklenmemis');
});

test('U27 sayfa route bazli code-splitting ile yukleniyor', () => {
  assert.match(read('App.tsx'), /React\.lazy\(\(\) => import\("@\/components\/scalex\/ScaleXPage"\)\)/);
});

// ── U28 Kullanilmayan/olu kod ───────────────────────────────────────────────

test('U28 OperationStep\'in topladigi HER alan calistirmaya gidiyor', () => {
  const runBody = PAGE.slice(PAGE.indexOf('const r = await scalexApi.run('), PAGE.indexOf('if (!r.ok)'));
  for (const f of ['action', 'executionMode', 'targetReplicas', 'verificationTimeout', 'allowPartial', 'mailCc']) {
    assert.ok(runBody.includes(f), `${f} toplaniyor ama calistirmaya GONDERILMIYOR`);
  }
});

test('U29 kullanilmayan import yok', () => {
  for (let i = 0; i < ALL_TSX.length; i++) {
    const code = ALL_TSX[i];
    const imports = [...code.matchAll(/import\s+(?:\{([^}]*)\}|(\w+))\s+from/g)];
    for (const m of imports) {
      const names = (m[1] || m[2] || '').split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean);
      for (const n of names) {
        if (n.startsWith('type ')) continue;
        const body = code.slice(code.indexOf('\n', m.index));
        assert.ok(new RegExp(`\\b${n.replace('type ', '')}\\b`).test(body),
          `${NAMES[i]}: kullanilmayan import → ${n}`);
      }
    }
  }
});

test('U30 sonsuz yoklama dongusunde hata siniri var', () => {
  assert.match(codeOnly(WORKLOAD), /MAX_POLL_ERRORS/,
    'ardisik hatada donguden cikilmazsa sekme sonsuza dek istek atar');
});


// ═══ V. YENI DAVRANISLAR (HPA / GitOps / yas / saglik / tasima) ════════════

test('V1 HPA sabitleme kutusu ONCEDEN SECILI DEGIL', () => {
  // HPA'ya dokunmak mevcut politikanin tersi — kullanici BILINCLI olarak istemeli.
  assert.match(codeOnly(OPERATION), /useState\(false\)[^\n]*\n?/);
  assert.match(codeOnly(OPERATION), /const \[hpaPin, setHpaPin\] = useState\(false\)/);
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
  const body = PAGE.slice(PAGE.indexOf('healthStartedRef.current) return'), PAGE.indexOf('// İş bitince yapılandırılmış'));
  assert.match(body, /mode !== "apply"/, 'dry_run sonrasi saglik kontrolu anlamsiz');
  assert.match(body, /action === "stop"/, 'Durdur sonrasi 0 pod bekleniyor — saglik kontrolu anlamsiz');
  assert.match(body, /overallStatus === "FAIL"/, 'zaten basarisiz bir iste saglik sormanin anlami yok');
});

test('V10 saglik kontrolu BEST-EFFORT — asil sonucu gizlemiyor', () => {
  const body = PAGE.slice(PAGE.indexOf('healthStartedRef.current = true'), PAGE.indexOf('// İş bitince yapılandırılmış'));
  assert.match(body, /catch\s*\{/, 'saglik kontrolu hatasi asil sonuc ekranini bozmamali');
});

test('V11 saglik kontrolu bir kez kosar (ref ile kilitli)', () => {
  assert.match(codeOnly(PAGE), /healthStartedRef\s*=\s*useRef\(false\)/);
});

test('V12 restart() saglik durumunu ve kilidini de sifirliyor', () => {
  const body = PAGE.slice(PAGE.indexOf('function restart()'), PAGE.indexOf('async function guarded'));
  assert.ok(body.includes('setHealth(null)'), 'onceki islemin saglik sonucu ekranda kalirdi');
  assert.ok(body.includes('healthStartedRef.current = false'), 'ikinci islem icin saglik hic kosmazdi');
  assert.ok(body.includes('setHpaPin(false)'), 'HPA sabitleme tercihi sonraki isleme tasinirdi');
});

test('V13 hpaPin calistirmaya GERCEKTEN gonderiliyor', () => {
  const runBody = PAGE.slice(PAGE.indexOf('const r = await scalexApi.run('), PAGE.indexOf('if (!r.ok)'));
  assert.ok(runBody.includes('hpaPin'), 'kutu isaretlense de sunucuya gitmezdi');
});

test('V14 ekranda "chaos" gecmiyor', () => {
  for (let i = 0; i < ALL_TSX.length; i++) {
    assert.ok(!/chaos/i.test(ALL_TSX[i]), `${NAMES[i]}: eski ad kalmis`);
  }
});
