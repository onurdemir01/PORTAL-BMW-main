// server/nginx-loadtest/__tests__/kuyruk-sahte-tablo.cjs - sahte gece kuyrugu tablolari (2026-11-03).
// kuyruk.test.cjs ve kapi.test.cjs ortak kullanir. Ifadeler /*KQ:ad*/ etiketiyle taninir; YARIS KOSULLARI
// SQL METNINDEN uygulanir (kosulu silinen ifade sahte tabloda da uygulanmaz: mutasyon davranis testinde kirmizi).
// Zaman D.simdi (ms); kilitler D.kilitler (Map, kapi.test bicimi), kosular D.kosular.
'use strict';

const tek = (q) => String(q).replace(/\s+/g, ' ').trim();
const var_ = (q, metin) => tek(q).includes(metin);

function kalan(D, t) {
  return t == null ? null : Math.round((t - D.simdi) / 1000);
}

function kuyrukSatiri(D, r) {
  return {
    ...r,
    baslangic_kalan_sn: kalan(D, r.baslangic_at),
    bitis_kalan_sn: kalan(D, r.en_gec_bitis),
    dinlenme_kalan_sn: kalan(D, r.dinlenme_bitis),
    baslangic_at: r.baslangic_at == null ? null : new Date(r.baslangic_at),
    en_gec_bitis: r.en_gec_bitis == null ? null : new Date(r.en_gec_bitis),
    dinlenme_bitis: r.dinlenme_bitis == null ? null : new Date(r.dinlenme_bitis),
    duraklat_at: r.duraklat_at == null ? null : new Date(r.duraklat_at),
  };
}

const ogeSatiri = (D, o) => ({
  ...o, baslama_at: o.baslama_at == null ? null : new Date(o.baslama_at),
  sonraki_deneme_at: o.sonraki_deneme_at == null ? null : new Date(o.sonraki_deneme_at), deneme_kalan_sn: kalan(D, o.sonraki_deneme_at ?? null),
});
const sirali = (a, b) => a.sira - b.sira || a.id - b.id;
/** Metindeki IN listesi: `<onEk> IN ('A', 'B')` -> ['A', 'B'] (yoksa null). */
function inListesi(q, onEk) {
  const i = q.indexOf(`${onEk} IN (`);
  if (i < 0) return null;
  const bas = i + onEk.length + 5;
  return q.slice(bas, q.indexOf(')', bas)).split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
}
/** ORDER BY metinden: "sira ASC, id ASC" -> sira sonra id; "id ASC" -> id. */
function siralayici(q) {
  if (/ORDER BY sira ASC, id ASC/.test(q)) return sirali;
  if (/ORDER BY sira/.test(q)) return (a, b) => a.sira - b.sira;
  return (a, b) => a.id - b.id;
}
/** DATEADD(<birim>, <ifade>...) birimi metinden -> ms carpani. */
function birimMs(q, ifade) {
  for (const [birim, ms] of [['SECOND', 1000], ['MINUTE', 60000], ['HOUR', 3600000]]) if (q.includes(`DATEADD(${birim}, ${ifade}`)) return ms;
  throw new Error(`DATEADD birimi bulunamadi: ${ifade}`);
}

function kuyrukTablolariKur(D) {
  if (!D.kuyruk) D.kuyruk = [];
  if (!D.ogeler) D.ogeler = [];
  if (!D.kuyrukSorgular) D.kuyrukSorgular = [];
  if (!D.sablonlar) D.sablonlar = [];
}

/** Kuyruk sorgusu degilse null. `D.kuyrukHata` = { ad, hata } verilen etiketteki ILK sorguda hata atar. */
function kuyrukSorgusu(D, sql, params = []) {
  const q = tek(sql);
  const m = /\/\*KQ:(\w+)\*\//.exec(q);
  if (!m) return null;
  kuyrukTablolariKur(D);
  const ad = m[1];
  D.kuyrukSorgular.push({ ad, q, params });
  if (D.kuyrukHata && D.kuyrukHata.ad === ad) {
    const h = D.kuyrukHata;
    D.kuyrukHata = null;
    throw h.hata;
  }
  const K = (id) => D.kuyruk.find((r) => r.id === Number(id));
  const O = (id) => D.ogeler.find((o) => o.id === Number(id));
  const bir = (ok) => ({ rows: [], rowCount: ok ? 1 : 0 });
  // ogeGeriAl / kosuGeriAl: token NULL yalniz metinde "$2 IS NULL" varsa her deneme_id'yi tutar (SQL'de deneme_id = NULL bilinmez).
  const tokenTutar = (o, token) => (token == null ? var_(q, '$2 IS NULL') : o.deneme_id === token);
  const kuyrukBizde = (o, kira) => {
    // ${KUYRUK_BIZDE}: kuyruk CALISIYOR ve kira bizde - metinde varsa uygulanir.
    const k = K(o.kuyruk_id);
    if (var_(q, "q.durum = 'CALISIYOR'") && !(k && k.durum === 'CALISIYOR')) return false;
    const yuruyen = inListesi(q, 'q.durum');
    if (yuruyen && !(k && yuruyen.includes(k.durum))) return false;
    if (var_(q, 'q.duraklat_at IS NULL') && !(k && k.duraklat_at == null)) return false;
    if (var_(q, 'q.kira_id = ') && !(k && k.kira_id === kira)) return false;
    return true;
  };
  switch (ad) {
    case 'aktifKuyruklar': {
      // Aktif durumlar ve "calisan ogesi olan bitmis kuyruk" durumlari METINDEN.
      const aktif = inListesi(q, '(q.durum') || [];
      const yetimRe = /OR \(q\.durum IN \(([^)]*)\) AND EXISTS \(SELECT 1 FROM nginx_loadtest_kuyruk_ogeler o WHERE o\.kuyruk_id = q\.id AND o\.durum = 'CALISIYOR'\)\)/.exec(q);
      const yetim = yetimRe ? yetimRe[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')) : [];
      return {
        rows: D.kuyruk.filter((r) => (var_(q, 'q.hazir = 1') ? r.hazir === 1 : true)
          && (aktif.includes(r.durum) || (yetim.includes(r.durum) && D.ogeler.some((o) => o.kuyruk_id === r.id && o.durum === 'CALISIYOR'))))
          .sort((a, b) => a.id - b.id).map((r) => ({ id: r.id })),
      };
    }
    case 'kiraAl': {
      const [id, kira, sn] = params;
      const r = K(id);
      const bos = r && (r.kira_id == null || r.kira_id === kira || r.kira_bitis == null || (var_(q, 'kira_bitis < GETUTCDATE()') && r.kira_bitis < D.simdi));
      if (bos) Object.assign(r, { kira_id: kira, kira_bitis: D.simdi + sn * 1000 });
      return bir(bos);
    }
    case 'kuyrukOku':
      return { rows: D.kuyruk.filter((r) => r.id === Number(params[0])).map((r) => kuyrukSatiri(D, r)) };
    case 'kuyrukBasla': {
      const r = K(params[0]);
      const ok = r && r.durum === 'BEKLIYOR' && r.hazir === 1 && (!var_(q, 'kira_id = $2') || r.kira_id === params[1]) && (!var_(q, 'duraklat_at IS NULL') || r.duraklat_at == null)
        && (r.baslangic_at == null || r.baslangic_at <= D.simdi);
      if (ok) r.durum = 'CALISIYOR';
      return bir(ok);
    }
    case 'calisanOge':
    case 'siradakiOge': {
      // Durum ve siralama METINDEN (ORDER BY bozulursa sahte tablo da bozuk sirayla doner).
      const dm = /AND durum = '(\w+)' ORDER BY/.exec(q);
      if (!dm) throw new Error(`${ad}: durum kosulu yok`);
      return { rows: D.ogeler.filter((o) => o.kuyruk_id === Number(params[0]) && o.durum === dm[1]).sort(siralayici(q)).slice(0, 1).map((o) => ogeSatiri(D, o)) };
    }
    case 'kuyrukBitti': {
      const r = K(params[0]);
      const ok = r && r.durum === 'CALISIYOR' && r.kira_id === params[1] && !D.ogeler.some((o) => o.kuyruk_id === r.id && ['BEKLIYOR', 'CALISIYOR'].includes(o.durum));
      if (ok) Object.assign(r, { durum: 'BITTI', bitis_at: D.simdi });
      return bir(ok);
    }
    case 'ogeKapat': {
      const [id, beklenen, yeni, neden] = params;
      const o = O(id);
      const ok = o && o.durum === beklenen;
      if (ok) Object.assign(o, { durum: yeni, neden, deneme_id: null, bitis_at: D.simdi });
      return bir(ok);
    }
    case 'ogeAtla': {
      const [id, neden, govde, etiket] = params;
      const o = O(id);
      const ok = o && o.durum === 'BEKLIYOR' && (!var_(q, 'govde = $3') || o.govde === govde) && (!var_(q, 'etiket = $4') || o.etiket === etiket);
      if (ok) Object.assign(o, { durum: 'ATLANDI', neden, deneme_id: null, bitis_at: D.simdi });
      return bir(ok);
    }
    case 'ogeNeden': {
      const [id, neden, artis, durum] = params;
      const o = O(id);
      const ok = o && o.durum === durum;
      if (ok) Object.assign(o, { neden, deneme: o.deneme + artis });
      return bir(ok);
    }
    case 'ogeSahiplen': {
      const [id, token, kira, govde, etiket] = params;
      const o = O(id);
      let ok = o && (!var_(q, "durum = 'BEKLIYOR'") || o.durum === 'BEKLIYOR') && o.on_kontrol_kosu_id == null && o.kosu_id == null && kuyrukBizde(o, kira)
        && (!var_(q, 'govde = $4') || o.govde === govde) && (!var_(q, 'etiket = $5') || o.etiket === etiket);
      const baskaCalisan = o && D.ogeler.some((x) => x.kuyruk_id === o.kuyruk_id && x.durum === 'CALISIYOR' && x.id !== o.id);
      if (ok && baskaCalisan && var_(q, "o2.durum = 'CALISIYOR'")) ok = false;
      // UX_nlko_calisan (filtreli tekil indeks): NOT EXISTS'i gecse de ikinci calisan oge yazilamaz.
      if (ok && baskaCalisan && D.indeksVar !== false) throw Object.assign(new Error("Cannot insert duplicate key row in object with unique index 'UX_nlko_calisan'"), { number: 2601 });
      if (ok) Object.assign(o, { durum: 'CALISIYOR', asama: 'on_kontrol', deneme_id: token, baslama_at: o.baslama_at ?? D.simdi, neden: null });
      return bir(ok);
    }
    case 'okKaydet':
    case 'kosuKaydet': {
      const [id, kosuId, token, kira] = params;
      const o = O(id);
      const alan = ad === 'okKaydet' ? 'on_kontrol_kosu_id' : 'kosu_id';
      const asama = ad === 'okKaydet' ? 'on_kontrol' : 'kosu';
      const ok = o && (!var_(q, 'deneme_id = $3') || o.deneme_id === token) && o.durum === 'CALISIYOR' && o.asama === asama && o[alan] == null && kuyrukBizde(o, kira);
      if (ok) o[alan] = kosuId;
      return bir(ok);
    }
    case 'ogeGeriAl': {
      const [id, token, neden, artis] = params;
      const o = O(id);
      const ok = o && o.durum === 'CALISIYOR' && o.asama === 'on_kontrol' && o.on_kontrol_kosu_id == null && o.kosu_id == null && tokenTutar(o, token) && kuyrukBizde(o);
      if (ok) Object.assign(o, { durum: 'BEKLIYOR', asama: null, deneme_id: null, neden, deneme: o.deneme + artis });
      return bir(ok);
    }
    case 'kosuAsamasi': {
      const [id, okId, token, kira] = params;
      const o = O(id);
      const ok = o && o.durum === 'CALISIYOR' && o.asama === 'on_kontrol' && o.on_kontrol_kosu_id === okId && o.kosu_id == null && kuyrukBizde(o, kira);
      if (ok) Object.assign(o, { asama: 'kosu', deneme_id: token, neden: null });
      return bir(ok);
    }
    case 'kosuGeriAl': {
      const [id, token, neden, artis] = params;
      const o = O(id);
      const ok = o && o.durum === 'CALISIYOR' && o.asama === 'kosu' && o.kosu_id == null && tokenTutar(o, token) && kuyrukBizde(o);
      if (ok) Object.assign(o, { asama: 'on_kontrol', deneme_id: null, neden, deneme: o.deneme + artis });
      return bir(ok);
    }
    case 'onKontrolYenile': {
      const [id, okId, neden] = params;
      const o = O(id);
      const ok = o && o.durum === 'CALISIYOR' && o.asama === 'on_kontrol' && o.on_kontrol_kosu_id === okId && o.kosu_id == null && kuyrukBizde(o);
      if (ok) Object.assign(o, { durum: 'BEKLIYOR', asama: null, deneme_id: null, on_kontrol_kosu_id: null, neden });
      return bir(ok);
    }
    case 'kosuYenidenSirala': {
      const [id, kosuId, neden] = params;
      const o = O(id);
      const ok = o && o.durum === 'CALISIYOR' && o.asama === 'kosu' && (!var_(q, 'kosu_id = $2') || o.kosu_id === kosuId) && kuyrukBizde(o);
      if (ok) Object.assign(o, { durum: 'BEKLIYOR', asama: null, deneme_id: null, kosu_id: null, on_kontrol_kosu_id: null, baslama_at: null, neden });
      return bir(ok);
    }
    case 'kuyrukDuraklat': {
      const r = K(params[0]);
      const durumlar = inListesi(q, 'durum') || [];
      const ok = r && (!var_(q, 'hazir = 1') || r.hazir === 1) && durumlar.includes(r.durum) && (!var_(q, 'duraklat_at IS NULL') || r.duraklat_at == null);
      if (ok) Object.assign(r, { duraklat_at: D.simdi, duraklatan: params[1] });
      return bir(ok);
    }
    case 'kuyrukDevam': {
      const r = K(params[0]);
      const durumlar = inListesi(q, 'durum') || [];
      const ok = r && durumlar.includes(r.durum) && (!var_(q, 'duraklat_at IS NOT NULL') || r.duraklat_at != null);
      if (ok) Object.assign(r, { duraklat_at: null, duraklatan: null });
      return bir(ok);
    }
    case 'ogeGuncelle': {
      const [kuyrukId, id, etiket, govde, butce_sn, uyari_turleri] = params;
      const o = O(id);
      const ok = o && (!var_(q, 'kuyruk_id = $1') || o.kuyruk_id === Number(kuyrukId)) && (!var_(q, "durum = 'BEKLIYOR'") || o.durum === 'BEKLIYOR')
        && (!var_(q, 'on_kontrol_kosu_id IS NULL') || o.on_kontrol_kosu_id == null) && (!var_(q, 'kosu_id IS NULL') || o.kosu_id == null);
      if (ok) Object.assign(o, { etiket, govde, butce_sn, uyari_turleri, neden: null, ...(var_(q, 'deneme = 0') ? { deneme: 0 } : {}), ...(var_(q, 'sonraki_deneme_at = NULL') ? { sonraki_deneme_at: null } : {}) });
      return bir(ok);
    }
    case 'kuyrukTurlerEkle': {
      const r = K(params[0]);
      const durumlar = inListesi(q, 'durum') || [];
      const ok = r && durumlar.includes(r.durum) && (!var_(q, "COALESCE(onaylanan_turler, '') = $3") || (r.onaylanan_turler ?? '') === params[2]);
      if (ok) r.onaylanan_turler = params[1];
      return bir(ok);
    }
    case 'sablonListe':
      return { rows: D.sablonlar.filter((s) => !var_(q, 'silindi = 0') || !s.silindi).sort((a, b) => a.ad.localeCompare(b.ad)).slice(0, 200) };
    case 'sablonAdVar': {
      // D.sablonAdKacir: on kontrolu gecen eszamanli kayit (yalniz bir kez, indeks yakalar).
      if (D.sablonAdKacir) { D.sablonAdKacir = false; return { rows: [] }; }
      const [adi, haric] = params;
      return { rows: D.sablonlar.filter((s) => s.ad === adi && !s.silindi && (haric == null || !var_(q, 'id <> $2') || s.id !== Number(haric))).slice(0, 1).map((s) => ({ id: s.id })) };
    }
    case 'sablonEkle': {
      const [adi, govde, kim] = params;
      // UX_nls_ad: filtreli tekil indeks (D.indeksVar === false: kurulumda olusturulamamis).
      if (D.indeksVar !== false && D.sablonlar.some((s) => s.ad === adi && !s.silindi)) throw Object.assign(new Error("Cannot insert duplicate key row in object with unique index 'UX_nls_ad'"), { number: 2601 });
      const id = D.sablonlar.length + 1;
      D.sablonlar.push({ id, ad: adi, govde, created_by: kim, created_at: new Date(D.simdi), updated_by: kim, updated_at: new Date(D.simdi), silindi: 0 });
      return { rows: [{ id }], rowCount: 1 };
    }
    case 'sablonGuncelle': {
      const [id, adi, govde, kim] = params;
      const s = D.sablonlar.find((x) => x.id === Number(id) && (!var_(q, 'silindi = 0') || !x.silindi));
      if (s && D.sablonlar.some((x) => x !== s && x.ad === adi && !x.silindi)) throw Object.assign(new Error("Cannot insert duplicate key row in object with unique index 'UX_nls_ad'"), { number: 2601 });
      if (s) Object.assign(s, { ad: adi, govde, updated_by: kim, updated_at: new Date(D.simdi) });
      return bir(!!s);
    }
    case 'sablonSil': {
      const s = D.sablonlar.find((x) => x.id === Number(params[0]) && (!var_(q, 'silindi = 0') || !x.silindi));
      if (s) Object.assign(s, { silindi: 1, updated_by: params[1], updated_at: new Date(D.simdi) });
      return bir(!!s);
    }
    case 'okSifirla':
    case 'kosuSifirla': {
      const [id, token, neden, artis, kosuId] = params;
      const o = O(id);
      const okMu = ad === 'okSifirla';
      const ok = o && (!var_(q, 'deneme_id = $2') || o.deneme_id === token) && o.durum === 'CALISIYOR' && o.asama === (okMu ? 'on_kontrol' : 'kosu')
        && (okMu ? (!var_(q, 'on_kontrol_kosu_id = $5') || o.on_kontrol_kosu_id === kosuId) && o.kosu_id == null : (!var_(q, 'kosu_id = $5') || o.kosu_id === kosuId))
        && kuyrukBizde(o);
      if (ok) {
        Object.assign(o, okMu ? { durum: 'BEKLIYOR', asama: null, deneme_id: null, on_kontrol_kosu_id: null } : { asama: 'on_kontrol', deneme_id: null, kosu_id: null });
        Object.assign(o, { neden, deneme: o.deneme + artis });
      }
      return bir(ok);
    }
    case 'ogeErtele': {
      const o = O(params[0]);
      const durumlar = inListesi(q, 'durum') || [];
      const ok = o && durumlar.includes(o.durum);
      if (ok) o.sonraki_deneme_at = D.simdi + params[1] * birimMs(q, '$2');
      return bir(ok);
    }
    case 'ayniHedefAktif': {
      const durumlar = inListesi(q, 'durum') || [];
      return { rows: D.kuyruk.filter((r) => r.onay_hedefi === params[0] && (!var_(q, 'hazir = 1') || r.hazir === 1) && durumlar.includes(r.durum)).sort((a, b) => a.id - b.id).slice(0, 1).map((r) => ({ id: r.id })) };
    }
    case 'dinlenmeyeGec': {
      const r = K(params[0]);
      const ok = r && r.durum === 'CALISIYOR';
      if (ok) Object.assign(r, { durum: 'DINLENME', dinlenme_kosu_id: params[1], dinlenme_bitis: null });
      return bir(ok);
    }
    case 'dinlenmeBaslat': {
      const r = K(params[0]);
      const ok = r && r.durum === 'DINLENME' && (!var_(q, 'dinlenme_bitis IS NULL') || r.dinlenme_bitis == null);
      if (ok) r.dinlenme_bitis = D.simdi + r.bekleme_dk * birimMs(q, 'bekleme_dk');
      return bir(ok);
    }
    case 'dinlenmeBitti': {
      const r = K(params[0]);
      const ok = r && r.durum === 'DINLENME' && r.dinlenme_bitis != null && r.dinlenme_bitis <= D.simdi;
      if (ok) Object.assign(r, { durum: 'CALISIYOR', dinlenme_kosu_id: null, dinlenme_bitis: null });
      return bir(ok);
    }
    case 'kosuKilidi':
      return { rows: (D.kosular || []).filter((k) => k.id === Number(params[0])).map((k) => ({ kilit_id: k.kilit_id ?? null, durum: k.durum })) };
    case 'kilitTutuluyor': {
      const t = (r) => { if (typeof r.locked_until === 'number') return r.locked_until; if (r.locked_until == null) return null; return new Date(r.locked_until).getTime(); };
      const n = [...(D.kilitler ? D.kilitler.values() : [])].filter((r) => r.lock_id === params[0] && r.held && t(r) != null && t(r) >= D.simdi - 12 * 3600000
        && (t(r) >= D.simdi || (var_(q, 'OR awx_job_id IS NOT NULL') && r.awx_job_id != null))).length;
      return { rows: [{ n }], rowCount: 1 };
    }
    case 'hedefKilitli': {
      const t = (r) => { if (typeof r.locked_until === 'number') return r.locked_until; if (r.locked_until == null) return null; return new Date(r.locked_until).getTime(); };
      const r = D.kilitler ? D.kilitler.get(params[0]) : null;
      const n = r && r.held && t(r) != null && t(r) >= D.simdi - 12 * 3600000 && (t(r) >= D.simdi || r.awx_job_id != null) ? 1 : 0;
      return { rows: [{ n }], rowCount: 1 };
    }
    case 'sonAyarliKosu':
      return { rows: (D.kosular || []).filter((k) => k.hedef_host === params[0] && String(k.parametreler).includes('"sunucuAyar":{')).sort((a, b) => b.id - a.id).slice(0, 1).map((k) => ({ id: k.id })) };
    case 'hataSay': {
      const r = K(params[0]);
      if (r) Object.assign(r, { hata_sayisi: r.hata_sayisi + 1, son_hata: params[1] });
      return bir(!!r);
    }
    case 'hataSifirla': {
      const r = K(params[0]);
      const ok = r && r.hata_sayisi !== 0;
      if (ok) r.hata_sayisi = 0;
      return bir(ok);
    }
    case 'kuyrukHatali': {
      const r = K(params[0]);
      const ok = r && r.hata_sayisi >= params[1] && ['BEKLIYOR', 'CALISIYOR', 'DINLENME'].includes(r.durum);
      if (ok) Object.assign(r, { durum: 'HATALI', bitis_at: D.simdi });
      return bir(ok);
    }
    case 'hataliOgeler':
    case 'ogelerIptal': {
      let n = 0;
      for (const o of D.ogeler) {
        if (o.kuyruk_id === Number(params[0]) && o.durum === 'BEKLIYOR') {
          Object.assign(o, { durum: ad === 'hataliOgeler' ? 'ATLANDI' : 'IPTAL', neden: params[1], bitis_at: D.simdi });
          n += 1;
        }
      }
      return { rows: [], rowCount: n };
    }
    case 'kuyrukEkle': {
      const [adi, bekleme_dk, baslangic, bitis, onay_hedefi, hedef_turu, onaylanan_turler, created_by] = params;
      const id = D.kuyruk.length + 1;
      D.kuyruk.push({
        id, ad: adi, durum: 'BEKLIYOR', bekleme_dk, baslangic_at: baslangic == null ? null : new Date(baslangic).getTime(), en_gec_bitis: bitis == null ? null : new Date(bitis).getTime(),
        onay_hedefi, hedef_turu, onaylanan_turler, created_by, created_at: new Date(D.simdi), iptal_eden: null, iptal_at: null, dinlenme_kosu_id: null, dinlenme_bitis: null,
        hata_sayisi: 0, son_hata: null, bitis_at: null, kira_id: null, kira_bitis: null, hazir: 0, duraklat_at: null, duraklatan: null,
      });
      return { rows: [{ id }], rowCount: 1 };
    }
    case 'kuyrukHazir': {
      const r = K(params[0]);
      const ok = r && r.hazir === 0;
      if (ok) Object.assign(r, { hazir: 1, baslangic_at: r.baslangic_at ?? D.simdi });
      return bir(ok);
    }
    case 'kuyrukYarim': {
      const r = K(params[0]);
      const ok = r && r.hazir === 0;
      if (ok) Object.assign(r, { durum: 'HATALI', son_hata: params[1] });
      return bir(ok);
    }
    case 'ogeEkle': {
      const [kuyruk_id, sira, etiket, govde, butce_sn, uyari_turleri] = params;
      const id = D.ogeler.length + 1;
      D.ogeler.push({
        id, kuyruk_id, sira, etiket, govde, butce_sn, uyari_turleri, durum: 'BEKLIYOR', asama: null, deneme_id: null, on_kontrol_kosu_id: null, kosu_id: null,
        neden: null, deneme: 0, baslama_at: null, bitis_at: null, created_at: new Date(D.simdi),
      });
      return bir(true);
    }
    case 'kuyrukListe':
      return {
        rows: D.kuyruk.slice().sort((a, b) => b.id - a.id).slice(0, 50).map((r) => ({
          ...kuyrukSatiri(D, r), oge_sayisi: D.ogeler.filter((o) => o.kuyruk_id === r.id).length,
          biten_sayisi: D.ogeler.filter((o) => o.kuyruk_id === r.id && ['BITTI', 'ATLANDI', 'HATALI', 'IPTAL'].includes(o.durum)).length,
        })),
      };
    case 'ogeListe':
      return { rows: D.ogeler.filter((o) => o.kuyruk_id === Number(params[0])).sort(siralayici(q)).map((o) => ogeSatiri(D, o)) };
    case 'kuyrukIptal': {
      const r = K(params[0]);
      // Iptal edilebilir durumlar METINDEN (filtre silinirse bitmis kuyruk da IPTAL'e yazilir).
      const durumlar = inListesi(q, 'WHERE id = $1 AND durum');
      const ok = r && (durumlar == null || durumlar.includes(r.durum));
      if (ok) Object.assign(r, { durum: 'IPTAL', iptal_eden: params[1], iptal_at: D.simdi, bitis_at: D.simdi });
      return bir(ok);
    }
    case 'ogeCikar': {
      const o = O(params[1]);
      const ok = o && o.kuyruk_id === Number(params[0]) && o.durum === 'BEKLIYOR';
      if (ok) Object.assign(o, { durum: 'IPTAL', neden: params[2], bitis_at: D.simdi });
      return bir(ok);
    }
    case 'siraTaban': {
      const s = D.ogeler.filter((o) => o.kuyruk_id === Number(params[0])).map((o) => o.sira);
      return { rows: [{ m: s.length ? Math.max(...s) : null }] };
    }
    case 'sira': {
      const id = Number(params[0]);
      const idler = params.slice(1, -1).map(Number);
      const taban = Number(params.at(-1));
      let n = 0;
      idler.forEach((oid, i) => {
        const o = O(oid);
        if (o && o.kuyruk_id === id && o.durum === 'BEKLIYOR') {
          o.sira = taban + i + 1;
          n += 1;
        }
      });
      return { rows: [], rowCount: n };
    }
    default:
      throw new Error(`taninmayan kuyruk sorgusu: ${ad}`);
  }
}

/** Testte dogrudan kuyruk + ogeler kurar (olusturma ucundan gecmeden). */
function kuyrukKur(D, { kuyruk = {}, ogeler = [] } = {}) {
  kuyrukTablolariKur(D);
  const id = D.kuyruk.length + 1;
  D.kuyruk.push({
    id, ad: null, durum: 'BEKLIYOR', bekleme_dk: 5, baslangic_at: D.simdi, en_gec_bitis: null, onay_hedefi: 'GBNGXT33', hedef_turu: 'sunucu',
    onaylanan_turler: '[]', created_by: 'onur', created_at: new Date(D.simdi), iptal_eden: null, iptal_at: null, dinlenme_kosu_id: null, dinlenme_bitis: null,
    hata_sayisi: 0, son_hata: null, bitis_at: null, kira_id: null, kira_bitis: null, hazir: 1, duraklat_at: null, duraklatan: null, ...kuyruk,
  });
  ogeler.forEach((o, i) => {
    D.ogeler.push({
      id: D.ogeler.length + 1, kuyruk_id: id, sira: i + 1, etiket: `oge ${i + 1}`, sonraki_deneme_at: null, govde: JSON.stringify({ senaryoId: 1, hedefHost: 'GBNGXT33', hedefIp: '10.0.0.9', vhost: 'app.test.local', yukHost: 'GBNGXT34', sni: false, parametreler: { hizlar: [100] } }),
      butce_sn: 600, uyari_turleri: '[]', durum: 'BEKLIYOR', asama: null, deneme_id: null, on_kontrol_kosu_id: null, kosu_id: null, neden: null, deneme: 0,
      baslama_at: null, bitis_at: null, created_at: new Date(D.simdi), ...o,
    });
  });
  return id;
}

module.exports = { kuyrukSorgusu, kuyrukKur, kuyrukTablolariKur };
