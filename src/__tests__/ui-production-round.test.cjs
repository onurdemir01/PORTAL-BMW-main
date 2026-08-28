// src/__tests__/ui-production-round.test.cjs — uretim ekran goruntulerinden cikan tur.
//
// Kaynak: hknisci/bmw_portal `action_list/aksiyonlar.md` — dort uretim ekran goruntusu
// (Dashboard, Denetim acik+koyu, Ansible). Asagidaki her bekci ya o goruntulerde
// GORULEN bir sorunu ya da sayimla OLCULEN bir tutarsizligi kilitler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const CSS = read('index.css');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const SRC_FILES = walk(ROOT);
const stripComments = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// ── G1/G10/G11: tasma ───────────────────────────────────────────────────────
test('G1: Ansible kartindaki playbook yolu artik CodeChip ile ciziliyor', () => {
  // URETIMDE GORULDU: yol kartin disina tasiyordu — `flex-wrap` kelimenin ICINDEN
  // kiramaz ve chip'te `min-w-0`/`break-all` yoktu.
  const src = stripComments(read('components/ansible/AnsiblePage.tsx'));
  assert.match(src, /<CodeChip value=\{t\.playbook\} \/>/);
  assert.ok(!/font-mono bg-slate-100 text-slate-600/.test(src), 'eski kirilmayan chip duruyor');
});

test('G10/G11: CodeChip min-w-0 + kirilma + title tasiyor', () => {
  const src = read('components/common/CodeChip.tsx');
  assert.match(src, /min-w-0/, 'min-w-0 YOK — flex cocugunun varsayilan min-width:auto tasmanin KOK NEDENI');
  assert.match(src, /break-all/);
  assert.match(src, /truncate/);
  assert.match(src, /title=\{value\}/, 'tam deger fare ustunde okunabilmeli');
});

test('G13: kirpilmis hash KOPYALANABILIR', () => {
  // Hash'in tek isi baska bir hash ile karsilastirilmak; okunup kopyalanamamasi
  // onu kullanissiz kiliyordu.
  const src = read('components/DenetimPage.tsx');
  assert.match(src, /<CodeChip value=\{sc\.majorityHash\}[^>]*copyable/);
});

// ── G2/G3: eylem hiyerarsisi ────────────────────────────────────────────────
test('G2/G3: Başlat DOLU birincil, Bilgi sade', () => {
  const src = stripComments(read('components/ansible/AnsiblePage.tsx'));
  assert.match(src, /background: "var\(--accent\)", color: "var\(--text-on-accent\)"/,
    'Başlat dolu birincil degil');
  assert.ok(!/background: "rgba\(79,142,255,0\.1\)"/.test(src), 'eski tint duruyor');
});

// ── G5: talepler paneli ─────────────────────────────────────────────────────
test('G5: panel BOSKEN daralir ama kullanicinin ACIK tercihi kazanir', () => {
  const src = read('components/self_service/RequestsSidePanel.tsx');
  assert.match(src, /const \[userPref, setUserPref\] = useState<boolean \| null>/);
  assert.match(src, /const collapsed = userPref \?\? autoCollapsed;/);
  // Ilk yukleme bitmeden karar verilirse panel bir an serit cizilip genisler.
  assert.match(src, /userPref === null && !loading && tickets\.length === 0/);
});

test('G5: OTOMATIK daralmis panel YOKLAMAYA devam eder (kendini kilitlemesin)', () => {
  // Eskiden `if (collapsed) return;` vardi. Otomatik daraltma ile bu, kendini
  // kilitleyen bir durum uretirdi: bos -> daralir -> yoklama durur -> yeni talep
  // hic ogrenilmez -> panel BIR DAHA acilmaz.
  const src = stripComments(read('components/self_service/RequestsSidePanel.tsx'));
  assert.match(src, /if \(userPref === true\) return;/,
    'yoklama yalnizca KULLANICI acikca kapattiginda durmali');
  assert.ok(!/if \(collapsed\) return;/.test(src), 'kendini kilitleyen guard duruyor');
});

// ── G9: koyu temada gorunmeyen desen ────────────────────────────────────────
test('G9: "olculemedi" cizgisi TOKEN renginde (koyu temada gorunur)', () => {
  // Cizgi `rgb(0 0 0 / 0.07)` idi: koyu zeminde gorunmuyordu ve satir bos gri bir
  // bar gibi okunuyordu — yani "%0" ile ayirt edilemiyordu.
  const src = stripComments(read('components/DenetimPage.tsx'));
  assert.match(src, /repeating-linear-gradient\(45deg, var\(--border\)/);
  assert.ok(!/rgb\(0 0 0 \/ 0\.07\)/.test(src), 'sabit siyah cizgi duruyor');
});

// ── G14: eski aksan ─────────────────────────────────────────────────────────
test('G14: eski aksan (#4F8EFF) yalnizca giris dekoratiflerinde', () => {
  // rgba(79,142,255) portalin aksani (#0066cc / #b9dafc) DEGIL; ucuncu bir maviydi
  // ve tema degisince hic degismiyordu.
  const ALLOWED = new Set(['LoginBackgroundCanvas.tsx', 'ArtisticBackdrop.tsx']);
  const bad = [];
  for (const f of SRC_FILES) {
    if (ALLOWED.has(path.basename(f))) continue;
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    if (/79,\s*142,\s*255|#4[Ff]8[Ee][Ff]{2}/.test(src)) bad.push(path.relative(ROOT, f));
  }
  assert.deepEqual(bad, [], `eski aksan kaldi: ${bad.join(', ')}`);
});

test('G14: --accent-rgb her iki temada tanimli', () => {
  // Farkli saydamliklar gerektigi icin tek bir tint token'i yetmiyor.
  assert.match(CSS, /--accent-rgb:\s*0, 102, 204;/);
  assert.match(CSS, /--accent-rgb:\s*185, 218, 252;/);
});

// ── G17: yaricap celiskisi ──────────────────────────────────────────────────
test('G17: rounded-lg/xl ile .card AYNI token’dan', () => {
  // PF6 gecisinde `--radius-sm` 4px, `--radius-md` 6px oldu ve `.card` md kullanmaya
  // basladi; ama uyum katmani TUM rounded-*'i sm'e eziyordu. Sonuc: 350 oge 4px,
  // kartlar 6px — ayni ekranda iki farkli yuvarlaklik.
  assert.match(CSS, /:root \.rounded-lg, :root \.rounded-xl, :root \.rounded-2xl, :root \.rounded-3xl \{ border-radius: var\(--radius-md\); \}/);
  const cardRule = CSS.slice(CSS.indexOf('.card {'), CSS.indexOf('}', CSS.indexOf('.card {')));
  assert.match(cardRule, /border-radius: var\(--radius-md\)/);
});

test('G18: yaricap kuralinin BASLIGI guncel olcegi soyluyor', () => {
  // 3px PF **5** degeriydi ve baslik PF6 gecisinden sonra da oyle kalmisti.
  // Yorum GOVDESINDE eski degerden bahsedilebilir (neyin degistigini anlatmak icin)
  // ama BASLIK, kuralin gercekte ne yaptigini dogru soylemeli.
  const heading = (CSS.match(/\/\* Kose yaricapi:[^\n]*/) || [''])[0];
  assert.match(heading, /PF6 olcegi/, `bayat kural basligi: ${heading}`);
});

// ── G19: tarih ve sayi ──────────────────────────────────────────────────────
test('G19: ham toLocaleString kalmadi (ortak modul haric)', () => {
  const bad = [];
  for (const f of SRC_FILES) {
    if (f.endsWith('utils/datetime.ts')) continue;
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    if (/\.toLocale(String|DateString|TimeString)\(/.test(src)) bad.push(path.relative(ROOT, f));
  }
  assert.deepEqual(bad, [], `ortak bicimlendiriciyi kullanmayan dosyalar:\n${bad.join('\n')}`);
});

test('G19: sayi icin AYRI yardimci var (tarihle karistirilmasin)', () => {
  // Kalan cagrilarin cogu TARIH DEGIL, binlik ayracti; hepsini fmtDateTime'a
  // cevirmek yanlis olurdu.
  assert.match(read('utils/datetime.ts'), /export function fmtNumber/);
});

// ── G21/G22: tablo ──────────────────────────────────────────────────────────
test('G21: satir hover CSS’te, JS’te DEGIL', () => {
  assert.match(CSS, /\.pf-table-sticky tbody tr:hover/);
  // Inline stil CSS kurallarini EZER: JS ile yazilan hover, ortak sinifi ise yaramaz
  // kilardi (ve her satira iki olay dinleyicisi eklerdi).
  for (const f of ['components/envanter/DynamicTable.tsx', 'components/DutyRosterPage.tsx']) {
    const src = stripComments(read(f));
    assert.ok(!/onMouseEnter=\{e => .*style\.background/.test(src), `${f}: JS hover duruyor`);
  }
});

test('G22: hover rengi token’dan', () => {
  assert.match(CSS, /background-color: rgb\(var\(--accent-rgb\) \/ 0\.06\)/);
});

// ── G25/G26: modal odagi ────────────────────────────────────────────────────
test('G25: modal odak tuzagi var', () => {
  const src = read('components/common/Modal.tsx');
  assert.match(src, /e\.key !== "Tab"/, 'Tab dongusu yok — odak modalin ARKASINA kaciyor');
  assert.match(src, /panelRef/);
  assert.match(src, /tabIndex=\{-1\}/, 'odaklanabilir oge yoksa panelin kendisi odagi almali');
});

test('G26: kapaninca odak TETIKLEYEN ogeye doner', () => {
  const src = read('components/common/Modal.tsx');
  assert.match(src, /returnFocusRef/);
  // Oge DOM'dan kalkmis olabilir (or. silme onayindan sonra satir gitti) — hataya
  // donusturulmemeli.
  assert.match(src, /document\.contains\(target\)/);
});

// ── G23/G24: bos durumlar ───────────────────────────────────────────────────
test('G23: tablo bos-durumlari ortak bilesenden', () => {
  const bad = [];
  for (const f of SRC_FILES) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    if (/<td colSpan=\{[^}]+\}[^>]*>\s*(Kayıt|Çelişki)/.test(src)) bad.push(path.relative(ROOT, f));
  }
  assert.deepEqual(bad, [], `elle yazilmis bos-durum satiri: ${bad.join(', ')}`);
});

// ── G29: metin ──────────────────────────────────────────────────────────────
test('G29: ayni eylem icin tek fiil ("Vazgeç" kalmadi)', () => {
  const bad = SRC_FILES
    .filter((f) => /Vazgeç/.test(stripComments(fs.readFileSync(f, 'utf8'))))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(bad, [], `"İptal" ile ayni eylem: ${bad.join(', ')}`);
});

// ── G8: segment kontrol ─────────────────────────────────────────────────────
test('G8: aktif segment KENARLIK da tasiyor (renk tek basina yetmiyordu)', () => {
  assert.match(CSS, /\.pf-segment\.is-active \{[\s\S]*?border-color: var\(--border\);/);
});
