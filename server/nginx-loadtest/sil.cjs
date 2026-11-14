// server/nginx-loadtest/sil.cjs - Yuk Testi kosu sonucu silme (2026-11-04).
//
// Kullanici: "istedigim yuk testi sonuclarini kaldirabilmek istiyorum". Uclar index.cjs'te (DELETE /kosular/:id ve
// POST /kosular/sil); bu dosya kurallari, SQL'i ve engel metinlerini tasir (saf, DB'siz test edilir).
//
// NE SILINIR: Portal DB'de kosu ya da on kontrol satiri (nginx_loadtest_kosular, islem 'kosu' | 'on_kontrol') ve adim
// satirlari (nginx_loadtest_adimlar.kosu_id). FK yok (tablolar FK'siz kuruldu); kosu id'sine bagli baska satir:
//   - nginx_loadtest_kosular.on_kontrol_kosu_id (kosunun dayandigi on kontrol)  -> bagli kosu varsa on kontrol SILINMEZ
//   - nginx_loadtest_kuyruk_ogeler.kosu_id / on_kontrol_kosu_id                  -> BEKLIYOR / CALISIYOR ogede SILINMEZ;
//     bitmis ogenin satiri ve numarasi KALIR (NULL'lanmaz: kuyruk yurutucusu "numarasiz oge hic baslamamistir" der),
//     kuyruk ayrintisi kosuSilindi / onKontrolSilindi ile "silindi" gosterir
//   - nginx_loadtest_kuyruk.dinlenme_kosu_id (DINLENME)                          -> SILINMEZ (dinlenme bitince silinir)
//   - nginx_loadtest_kilitleri (kosu.kilit_id ile)                               -> tutulan kilit varsa SILINMEZ
// /sw altindaki ham olcum dosyalarina DOKUNULMAZ (Portal'in isi degil; ekran soyler).
//
// ATOMIK: tek batch, SET XACT_ABORT ON + BEGIN TRAN; satirlar UPDLOCK + HOLDLOCK ile kosul YENIDEN denetlenerek
// secilir, secilen sayi istenen sayiya esit DEGILSE hicbir sey silinmez (hepsi ya da hic). Poller / Durdur / yeniden
// oku ayni satiri bu islem bitene dek guncelleyemez; sonra kosullu UPDATE'leri 0 satir bulur.
'use strict';

const MAX_TOPLU = 50;
const AKTIF = Object.freeze(['QUEUED', 'RUNNING', 'FINALIZING']);
const ISLEMLER = Object.freeze(['kosu', 'on_kontrol']);

/** $bas..$(bas+n-1) yer tutuculari. */
function yerler(n, bas = 1) {
  return Array.from({ length: n }, (_, i) => `$${bas + i}`).join(', ');
}

// Kosu satirinin (alias k) kilidi hala tutuluyor mu: kuyruk.cjs kilitTutuluyor ile AYNI kural (kilit.casLock'un
// "devralinabilir" kosulunun tersi: dolu ve suresi gecerli ya da ise bagli ve 12 saatten taze).
const KILITLI = `(k.kilit_id IS NOT NULL AND EXISTS (SELECT 1 FROM nginx_loadtest_kilitleri l
     WHERE l.lock_id = k.kilit_id AND l.held = 1 AND l.locked_until IS NOT NULL AND l.locked_until >= DATEADD(HOUR, -12, GETUTCDATE())
       AND (l.locked_until >= GETUTCDATE() OR l.awx_job_id IS NOT NULL)))`;
const KUYRUK_OGE = `(SELECT TOP 1 o.kuyruk_id FROM nginx_loadtest_kuyruk_ogeler o
     WHERE (o.kosu_id = k.id OR o.on_kontrol_kosu_id = k.id) AND o.durum IN ('BEKLIYOR', 'CALISIYOR') ORDER BY o.kuyruk_id)`;
const KUYRUK_DINLENME = `(SELECT TOP 1 q.id FROM nginx_loadtest_kuyruk q WHERE q.dinlenme_kosu_id = k.id AND q.durum = 'DINLENME' ORDER BY q.id)`;
/** On kontrole dayanan, silinecekler listesinde OLMAYAN kosu (ikisi birlikte secildiyse engel degil). */
const bagliKosu = (yer, kilit = '') => `(SELECT TOP 1 k2.id FROM nginx_loadtest_kosular k2${kilit}
     WHERE k.islem = 'on_kontrol' AND k2.on_kontrol_kosu_id = k.id AND k2.id NOT IN (${yer}) ORDER BY k2.id)`;

/** Engel nedenleri icin okuma (islem disi; yalniz mesaj). Parametreler: kosu id'leri. */
function okumaSql(n) {
  const yer = yerler(n);
  return `SELECT /*SIL:oku*/ k.id, k.islem, k.durum, k.etiket, k.hedef_host, k.hedef_ip, k.hedef_turu, k.created_by,
  CASE WHEN ${KILITLI} THEN 1 ELSE 0 END AS kilitli,
  ${KUYRUK_OGE} AS kuyruk_oge, ${KUYRUK_DINLENME} AS kuyruk_dinlenme, ${bagliKosu(yer)} AS bagli_kosu
FROM nginx_loadtest_kosular k WHERE k.id IN (${yer})`;
}

/**
 * Silme islemi. Parametreler: kosu id'leri ($1..$n) + beklenen sayi ($n+1). Yalniz silinen satirlar OUTPUT ile doner
 * (tek kayit kumesi); kosul tutmayan tek satir bile varsa hic satir donmez ve hicbir sey silinmez.
 */
function silmeSql(n) {
  const yer = yerler(n);
  return `SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @sil TABLE (id INT PRIMARY KEY);
INSERT INTO @sil (id)
  SELECT /*SIL:tx*/ k.id FROM nginx_loadtest_kosular k WITH (UPDLOCK, HOLDLOCK)
   WHERE k.id IN (${yer}) AND k.islem IN ('kosu', 'on_kontrol') AND k.durum NOT IN ('QUEUED', 'RUNNING', 'FINALIZING')
     AND NOT ${KILITLI}
     AND ${KUYRUK_OGE} IS NULL
     AND ${KUYRUK_DINLENME} IS NULL
     AND ${bagliKosu(yer, ' WITH (UPDLOCK, HOLDLOCK)')} IS NULL;
IF (SELECT COUNT(1) FROM @sil) = $${n + 1}
BEGIN
  DELETE FROM nginx_loadtest_adimlar WHERE kosu_id IN (SELECT id FROM @sil);
  DELETE FROM nginx_loadtest_kosular
    OUTPUT DELETED.id, DELETED.islem, DELETED.etiket, DELETED.hedef_host, DELETED.hedef_ip, DELETED.hedef_turu
    WHERE id IN (SELECT id FROM @sil);
END
COMMIT;`;
}

const islemAdi = (islem) => (islem === 'on_kontrol' ? 'Ön kontrol' : 'Koşu');
const sayiOf = (v) => (v == null || v === '' ? null : Number(v));

/**
 * Okunan satirlardan engeller (istenen sirayla). Bos dizi = silinebilir. Kodlar: kosu_yok, islem_desteklenmiyor,
 * kosu_suruyor, kosu_kilitli, kuyruga_bagli, on_kontrol_bagli.
 */
function engeller(ids, rows) {
  const byId = new Map((rows || []).map((r) => [Number(r.id), r]));
  const out = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) {
      out.push({ id, kod: 'kosu_yok', metin: `#${id} bulunamadı (silinmiş olabilir).` });
      continue;
    }
    const ad = `${islemAdi(r.islem)} #${id}`;
    if (!ISLEMLER.includes(r.islem)) out.push({ id, kod: 'islem_desteklenmiyor', metin: `${ad}: bu kayıt türü silinemez.` });
    else if (AKTIF.includes(r.durum)) out.push({ id, kod: 'kosu_suruyor', metin: `${ad} sürüyor (${r.durum}); bitmeden silinemez. Gerekirse önce Durdur’u kullanın.` });
    else if (Number(r.kilitli) === 1 || r.kilitli === true) out.push({ id, kod: 'kosu_kilitli', metin: `${ad}: kilitleri henüz bırakılmadı (uzaktaki yük sürüyor olabilir); kilit bırakılınca silinebilir.` });
    else if (r.kuyruk_oge != null) out.push({ id, kod: 'kuyruga_bagli', kuyrukId: sayiOf(r.kuyruk_oge), metin: `${ad} gece kuyruğu K${r.kuyruk_oge} içinde bekleyen / çalışan bir öğeye bağlı; önce kuyruktan çıkarın (ya da kuyruğu İptal edin).` });
    else if (r.kuyruk_dinlenme != null) out.push({ id, kod: 'kuyruga_bagli', kuyrukId: sayiOf(r.kuyruk_dinlenme), metin: `${ad}: gece kuyruğu K${r.kuyruk_dinlenme} bu koşudan sonra dinleniyor; dinlenme bitince (ya da kuyruk İptal edilince) silinebilir.` });
    else if (r.bagli_kosu != null) out.push({ id, kod: 'on_kontrol_bagli', bagliKosuId: sayiOf(r.bagli_kosu), metin: `${ad}: bu ön kontrole dayanan koşu #${r.bagli_kosu} var; önce koşuyu silin ya da ikisini birlikte seçin.` });
  }
  return out;
}

/** Onay metni: tekli silmede kosu numarasi ("12" ya da "#12"), toplu silmede secilen SAYI. Bas / son bosluk yok sayilir. */
function onayDogru(confirmText, beklenen) {
  if (typeof confirmText !== 'string') return false;
  const t = confirmText.trim();
  return t === String(beklenen) || t === `#${beklenen}`;
}

/** Denetim satiri: kosuyu tanitan kisa metin (sir yok; etiket kullanicinin yazdigi). */
function denetimMetni(r) {
  const hedef = r.hedef_host || r.hedef_ip || '?';
  return `#${r.id} ${r.islem} ${hedef}${r.etiket ? (" " + r.etiket) : ''}`;
}

function silinenApi(r) {
  return {
    id: Number(r.id), islem: r.islem, etiket: r.etiket ?? null, hedefHost: r.hedef_host || null, hedefIp: r.hedef_ip ?? null, hedefTuru: r.hedef_turu || 'sunucu',
  };
}

module.exports = { MAX_TOPLU, okumaSql, silmeSql, engeller, onayDogru, denetimMetni, silinenApi, _yerlerForTest: yerler };
