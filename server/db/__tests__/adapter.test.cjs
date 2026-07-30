// server/db/__tests__/adapter.test.cjs — Postgres→MSSQL ceviri katmaninin (db/index.cjs
// adaptSql/coerce) birim testleri. Bu katman regex-tabanli ve KIRILGAN; her DB-tabanli
// ozellik buna bagli (denetim P1). DB gerektirmez — saf string donusumu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { _adaptSql: adaptSql, _coerce: coerce } = require('../index.cjs');

test('$n → @pn (tek ve çok basamaklı)', () => {
  assert.equal(adaptSql('SELECT * FROM t WHERE a=$1 AND b=$2'), 'SELECT * FROM t WHERE a=@p1 AND b=@p2');
  assert.equal(adaptSql('SELECT $10, $1'), 'SELECT @p10, @p1');
});

test('RETURNING * → INSERT ... OUTPUT INSERTED.* VALUES', () => {
  const out = adaptSql('INSERT INTO t (a,b) VALUES ($1,$2) RETURNING *');
  assert.match(out, /OUTPUT INSERTED\.\* VALUES/i);
  assert.doesNotMatch(out, /RETURNING/i);
  assert.match(out, /@p1,@p2/);
});

test('RETURNING belirli sütunlar → INSERTED.col listesi', () => {
  const out = adaptSql('INSERT INTO t (a) VALUES ($1) RETURNING id, name');
  assert.match(out, /OUTPUT INSERTED\.id, INSERTED\.name VALUES/i);
});

test('UPDATE ... WHERE ... RETURNING * → OUTPUT INSERTED.* WHERE (gerçek PG sırası)', () => {
  // PG'de RETURNING sorgunun SONUNDA gelir; adapter OUTPUT'u WHERE'den ONCE yerlestirir.
  const out = adaptSql('UPDATE t SET a=$1 WHERE id=$2 RETURNING *');
  assert.match(out, /UPDATE t SET a=@p1 OUTPUT INSERTED\.\* WHERE id=@p2/i);
  assert.doesNotMatch(out, /RETURNING/i);
});

// ── Denetim bulgusu #3 (BLOCKER, kod tabani AI incelemesi): WHERE'siz UPDATE...RETURNING
// eskiden OUTPUT hic eklenmiyordu (regex \bWHERE\b hic eslesmiyordu) — RETURNING yine de
// silindigi icin satir(lar) GUNCELLENIYOR ama caller'a sessizce bos rows donuyordu.
test('UPDATE ... RETURNING * (WHERE YOK) → OUTPUT sorgu SONUNA eklenir (sessiz veri kaybi onlendi)', () => {
  const out = adaptSql('UPDATE t SET a=$1 RETURNING *');
  assert.match(out, /UPDATE t SET a=@p1 OUTPUT INSERTED\.\*\s*$/i);
  assert.doesNotMatch(out, /RETURNING/i);
});

// DUZELTILDI (kurumsal AI kod incelemesi, review.md #20): eski regex `[\w\s,*]+\s*$` sonda
// noktali virgul olunca hic eslesmiyordu (RETURNING oldugu gibi kalip MSSQL syntax hatasi
// veriyordu). Yeni regex `[^;]+?\s*(?:;\s*)?$` trailing noktali virguli ACIKCA tuketir.
test('RETURNING sonrası noktalı virgül olsa bile OUTPUT doğru eklenir', () => {
  const out = adaptSql('UPDATE t SET a=$1 RETURNING id;');
  assert.match(out, /UPDATE t SET a=@p1 OUTPUT INSERTED\.id\s*$/i);
  assert.doesNotMatch(out, /RETURNING/i);
});

// DUZELTILDI (review.md #20): koseli-parantezli ve tablo-nitelikli kolon adlari artik
// dogru yakalanip OUTPUT'a cevriliyor. Tablo-nitelikli durumda (RETURNING t.id) OUTPUT
// INSERTED/DELETED pseudo-tablosuna gore SADECE kolon adini kullanir — `INSERTED.t.id`
// GECERSIZ T-SQL olurdu, son "." sonrasi segment alinir.
test('RETURNING [id] (köşeli parantezli kolon adı) doğru işlenir', () => {
  const out = adaptSql('INSERT INTO t (a) VALUES ($1) RETURNING [id]');
  assert.match(out, /OUTPUT INSERTED\.\[id\] VALUES/i);
});

test('RETURNING t.id, t.name (tablo-nitelikli kolonlar) OUTPUT INSERTED.<kolon> olarak sadeleşir', () => {
  const out = adaptSql('UPDATE t SET a=$1 WHERE id=$2 RETURNING t.id, t.name');
  assert.match(out, /OUTPUT INSERTED\.id, INSERTED\.name WHERE/i);
  assert.doesNotMatch(out, /INSERTED\.t\./i, 'INSERTED.t.id gibi gecersiz bir T-SQL uretilmemeli');
});

// ── Gercek kod tabanindan alinan temsili sorgular (denetim bulgusu #20 — regresyon kapsami) ──
test('gercek desen: UPDATE-once → rowCount kontrol (server/auth/index.cjs setRoleOverride)', () => {
  const out = adaptSql('UPDATE user_role_overrides SET role = $1, updated_at = GETUTCDATE() WHERE username = $2');
  assert.equal(out, 'UPDATE user_role_overrides SET role = @p1, updated_at = GETUTCDATE() WHERE username = @p2');
});

test('gercek desen: coklu $n + RETURNING id tek satirda (server/ai-analyst/history.cjs createConversation)', () => {
  const out = adaptSql('INSERT INTO ai_conversations (username, title) VALUES ($1, $2) RETURNING id');
  assert.match(out, /INSERT INTO ai_conversations \(username, title\) OUTPUT INSERTED\.id VALUES \(@p1, @p2\)/i);
});

test('boolean literalleri: = true/false → = 1/0, IS true/false → = 1/0', () => {
  assert.equal(adaptSql('SELECT * FROM t WHERE enabled = true'), 'SELECT * FROM t WHERE enabled = 1');
  assert.equal(adaptSql('SELECT * FROM t WHERE enabled = false'), 'SELECT * FROM t WHERE enabled = 0');
  assert.equal(adaptSql('SELECT * FROM t WHERE x IS true'), 'SELECT * FROM t WHERE x = 1');
});

test('ILIKE → LIKE', () => {
  assert.equal(adaptSql("SELECT * FROM t WHERE name ILIKE '%a%'"), "SELECT * FROM t WHERE name LIKE '%a%'");
});

test('NOW() → GETUTCDATE()', () => {
  assert.equal(adaptSql('UPDATE t SET at = NOW()'), 'UPDATE t SET at = GETUTCDATE()');
});

test('LIMIT/OFFSET varyantları → OFFSET/FETCH', () => {
  assert.equal(adaptSql('SELECT * FROM t LIMIT $1 OFFSET $2'),
    'SELECT * FROM t OFFSET @p2 ROWS FETCH NEXT @p1 ROWS ONLY');
  assert.equal(adaptSql('SELECT * FROM t LIMIT 10 OFFSET 20'),
    'SELECT * FROM t OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY');
  assert.equal(adaptSql('SELECT * FROM t LIMIT $1'),
    'SELECT * FROM t OFFSET 0 ROWS FETCH NEXT @p1 ROWS ONLY');
  assert.equal(adaptSql('SELECT * FROM t LIMIT 5'),
    'SELECT * FROM t OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY');
});

test('coerce: array→JSON string, boolean→1/0, undefined→null, düz değer korunur', () => {
  assert.equal(coerce(['a', 'b']), '["a","b"]');
  assert.equal(coerce(true), 1);
  assert.equal(coerce(false), 0);
  assert.equal(coerce(undefined), null);
  assert.equal(coerce('metin'), 'metin');
  assert.equal(coerce(42), 42);
});

// ── BILINEN SINIRLAMA (denetim notu): adaptSql regex-tabanlidir; string LITERALI icindeki
// `$n` de cevrilir. Asagidaki test mevcut (hatali ama bilinen) davranisi BELGELER — parametreli
// sorgularda deger olarak gecildigi surece sorun olmaz; SQL metnine gomulu `$n` string'i
// yazmaktan kacinin. Ileride tokenizer ile duzeltilebilir.
test('BİLİNEN SINIRLAMA: string içindeki $n de çevrilir (parametre kullan, gömme)', () => {
  assert.equal(adaptSql("SELECT '$5 fiyat'"), "SELECT '@p5 fiyat'"); // istenmeyen ama beklenen
});
