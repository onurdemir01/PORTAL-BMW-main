// src/components/ArkSpaRaporuPage.tsx — Nginx ARK SPA Raporu.
//
// Kullanıcı (2026-09-28): "SPA Taşımaları sayfasının birebir aynısını Glomo / Webforms /
// Saklama / Geintdigital vb. TÜM servislerimiz için, sol menüye yeni bir bölüm ekleyerek
// 'Nginx ARK SPA Raporu' adıyla istiyorum. Buraya ekiplerin giriş yapabilmesini istiyorum.
/// Kolonlar: Ekip Beyanı, Uygulama, Namespace, Ekip, Yük Durumu, Location, Açıklama."
// Kolon sırası 2026-09-29'da kullanıcı isteğiyle değişti: Location, Ekip Beyanı'ndan
// hemen sonra geliyor (satırı okurken önce "hangi adres" sorusu cevaplanıyor).
//
// TAŞIMA EKRANINDAN FARKI: orası iki sabit sunucu grubunun taşınmasını izler. Burası
// taşıma sormaz; envanterin tamamını SERVİS bazında listeler ve ekibin beyanını toplar.
//
// İKİ SÜTUN, İKİ AYRI ŞEY: "Yük durumu" access log'dan ÖLÇÜLÜR, "Ekip beyanı" ekibin
// dediğidir. Çelişebilirler ve çelişki BİLGİDİR — yılda bir koşan bir iş ölçümde "yük
// almıyor" görünür ama ekip kullanıyordur. Biri diğerini ezmez.
import { useCallback, useMemo, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';
import { arkSpaApi, type ArkRapor, type ArkSatir, type ArkYuk } from '@/api/arkSpaApi';
import { kismiEtiket, kismiAciklama } from '@/components/denetim/yukPencere';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { downloadCsv } from '@/utils/csv';
import GlomoGecisPlani from '@/components/GlomoGecisPlani';
import { fmtDate, EMPTY_MARK } from '@/utils/datetime';

/** Beyan tarihi: yalnizca gun. Saat/dakika bu ekranda karar degistirmiyor. Ortak
 *  bicimlendirici (Portal saat dilimi); bozuk deger bos kalir (CSV'de "—" yazmasin). */
function fmtTarih(v: string): string {
  const s = fmtDate(v);
  return s === EMPTY_MARK ? '' : s;
}

const BEYAN: Record<string, { label: string; color: string }> = {
  yes: { label: 'kullanıyor', color: 'var(--status-success)' },
  no: { label: 'kullanmıyor', color: 'var(--status-danger)' },
  unknown: { label: 'bilmiyor', color: 'var(--status-warning)' },
};

/** Yük hücresi. ÜÇ DURUM: ölçülemedi ile "yük yok" AYNI ŞEY DEĞİL. */
function YukHucre({ t }: { t: ArkYuk | null }) {
  if (!t)
    return (
      <span
        style={{ color: 'var(--text-muted)' }}
        title="Bu location için hiç ölçüm yok — “yük almıyor” DEMEK DEĞİL."
      >
        ölçüm yok
      </span>
    );
  if (t.state === 'active')
    return (
      <span
        style={{ color: 'var(--status-success)', fontWeight: 600 }}
        title={`7 günde ${t.req7} istek (hc.jsp/hc.html hariç)`}
      >
        yük alıyor · {t.req7}
      </span>
    );
  if (t.state === 'idle')
    return (
      <span
        style={{ color: 'var(--text-secondary)' }}
        title="Access log okundu, 7 günün tamamına ve tanımın her sunucusuna bakıldı; sağlık kontrolü dışında hiç istek bulunamadı."
      >
        yük almıyor
      </span>
    );
  // "ÖLÇÜLEMEDİ" AYRI SEBEPLERDEN OLUR ve hiçbiri "yük yok" DEĞİLDİR. Metin, teknik
  // terimle değil OLAN BİTENLE anlatılır (kullanıcı, 2026-09-29: "bu ne demek anlamadım?
  // bozuk bir Türkçe'yle yazılmış" — eski metin "log kuyruğu 7 günü kapsamıyor: sayı ALT
  // SINIRDIR" diyordu, okuyana hiçbir şey söylemiyordu).
  //
  // İSTEK YOK AMA 7 GÜN ÖLÇÜLEMEDİ (2026-10-02): günlük rotasyonlu sunucuda okunan log 1-4
  // gün kalır; etiket ölçülen süreyi söyler ("son 3 günde istek yok (7 gün ölçülemedi)").
  // Bu satırlar "yük almıyor (emekli adayı)" süzgecine GİRMEZ. Metin Denetim ve Production
  // Taşımaları ile ortak (denetim/yukPencere.ts).
  const kismi = kismiEtiket(t);
  return (
    <span
      style={{ color: 'var(--status-warning)' }}
      title={
        t.hosts === 0
          ? `Access log okunamadı (${t.unknownHosts} sunucu). Bu uygulamanın istek alıp almadığı ölçülemedi — “yük almıyor” demek değil.`
          : kismi
            ? kismiAciklama(t)
            : `Access log dosyasının tamamı değil, yalnızca son bölümü okunabildi; okunan bölüm 7 günün tamamını kapsamıyor.${
                t.req7
                  ? ` Orada ${t.req7} istek görüldü, gerçek sayı bundan fazla olabilir.`
                  : ' Okunan bölümde istek yok, ama 7 günün tamamına bakılamadığı için “yük almıyor” denemez.'
              }`
      }
    >
      {kismi || `ölçülemedi${t.sampled && t.req7 ? ` (en az ${t.req7})` : ''}`}
    </span>
  );
}

/** Satır kimliği: aynı uygulamanın birden çok location'ı var, anahtar location'ı DA içerir. */
const satirAnahtari = (r: ArkSatir) => `${r.namespace}/${r.application}\u0000${r.location}`;

const SEKME_KEY = 'ark-spa-sekme';
function sekmeOku(): 'rapor' | 'glomo' {
  try { return window.localStorage.getItem(SEKME_KEY) === 'glomo' ? 'glomo' : 'rapor'; } catch { return 'rapor'; }
}

export default function ArkSpaRaporuPage() {
  // SEKMELER (2026-10-13): rapor + Glomo Gecis Plani (set bazli tasima takvimi, katilimci girisi).
  const [sekme, setSekmeHam] = useState<'rapor' | 'glomo'>(sekmeOku);
  const setSekme = (v: 'rapor' | 'glomo') => { setSekmeHam(v); try { window.localStorage.setItem(SEKME_KEY, v); } catch { /* yoksay */ } };
  const [data, setData] = useState<ArkRapor | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [servis, setServis] = useState('all');
  const [beyanSuzgec, setBeyanSuzgec] = useState<'all' | 'var' | 'yok'>('all');
  // EKIP ve YUK suzgecleri (kullanici, 2026-10-01): "ekibe gore filtreleme getirelim.
  // Bir de yuk durumuna gore de filtreleme getirelim ki insanlar kolaylikla burada islem
  // yapabilsin."
  const [ekip, setEkip] = useState('all');
  const [yuk, setYuk] = useState<'all' | 'active' | 'idle' | 'unknown' | 'none'>('all');
  const [q, setQ] = useState('');
  const [kayit, setKayit] = useState<string | null>(null);

  const yukle = useCallback(async (fresh = false) => {
    setYukleniyor(true);
    try {
      setData(await arkSpaApi.report(fresh));
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useAsyncEffect(async () => {
    await yukle(false);
  }, [yukle]);

  const satirlar = useMemo(() => {
    const hepsi = data?.rows || [];
    const ara = q.trim().toLowerCase();
    return hepsi.filter((r) => {
      if (servis !== 'all' && r.service !== servis) return false;
      if (beyanSuzgec === 'var' && !r.inUse) return false;
      if (beyanSuzgec === 'yok' && r.inUse) return false;
      if (ekip !== 'all') {
        // "bilinmiyor" AYRI BIR SECENEK: ekibi cozulemeyen satirlar kaybolmasin, cunku
        // sahibini bulmak gereken satirlar tam olarak onlar.
        if (ekip === '-') {
          if (r.team.length) return false;
        } else if (!r.team.includes(ekip)) return false;
      }
      // YUK: "olcum yok" ile "yuk almiyor" AYRI. Ucunu tek secenege indirmek, olculemeyen
      // bir uygulamayi emekli aday listesine sokardi.
      if (yuk !== 'all') {
        const durum = r.traffic ? r.traffic.state : 'none';
        if (durum !== yuk) return false;
      }
      if (!ara) return true;
      return (
        r.application.toLowerCase().includes(ara) ||
        r.namespace.toLowerCase().includes(ara) ||
        r.location.toLowerCase().includes(ara) ||
        r.team.join(' ').toLowerCase().includes(ara)
      );
    });
  }, [data, servis, beyanSuzgec, ekip, yuk, q]);

  // BEYAN SATIR BAZINDA (2026-10-01). Kullanıcı: "aynı uygulamaya tanımlı 3 tane location
  // bulunuyor. Birine kullanılmıyor dediğim zaman hepsine kullanılmıyor olarak
  // işaretleniyor."
  //
  // Eskiden hem istek `location` taşımıyordu (sunucu uygulama satırına yazıyordu) hem de
  // yanıt geldiğinde EKRAN aynı uygulamanın TÜM satırlarını güncelliyordu. İkisi birden
  // düzeltildi: istek location gönderir, ekran YALNIZ o satırı günceller.
  // CSV (kullanici, 2026-10-01): "Nginx ARK SPA raporunu komple indirilebilmesi icin de
  // bir buton koyar misin? Ayni CSV gibi."
  //
  // EKRANDA NE VARSA O INER: suzgecler uygulanmis haliyle. Suzgec yoksa rapor KOMPLE
  // iner - sayfa zaten tum satirlari bir kerede yukluyor. Dugmede kac satir inecegi
  // yaziyor ki "hepsi mi, suzulmusu mu" sorusu kalmasin.
  //
  // UC SUTUN AYRI: beyan (ekibin dedigi), beyan kapsami (location'a ozel mi devralinmis
  // mi) ve yuk (olcum). Ikisini tek sutuna indirmek, elektronik tabloda olcumle beyani
  // birbirine karistirirdi.
  const csvIndir = useCallback(() => {
    downloadCsv(
      'nginx_ark_spa_raporu',
      [
        'servis',
        'ortam',
        'namespace',
        'uygulama',
        'location',
        'ekip',
        'ekip_beyani',
        'beyan_kapsami',
        'beyan_eden',
        'beyan_tarihi',
        'aciklama',
        'yuk_durumu',
        'istek_7g',
        'istek_24s',
        'orneklem',
        'son_istek',
        'olculen_sunucu',
        'okunamayan_sunucu',
        'sunucular',
        // OLCULEN SURE (2026-10-02): "istek yok" satirinin kac saate dayandigi. 7 gunden
        // (168 saat) kisa ise satir "yuk almiyor" DEGILDIR.
        'olculen_saat',
      ],
      satirlar.map((r) => [
        r.service,
        r.env,
        r.namespace,
        r.application,
        r.location,
        r.team.join(' '),
        r.inUse ? BEYAN[r.inUse]?.label || r.inUse : '',
        // DEVRALINAN BEYAN ISARETLENIR: CSV'de de satirin KENDI beyani gibi okunmasin.
        r.inUseScope === 'application' ? 'uygulamadan devralindi' : r.inUseScope || '',
        r.inUseBy || '',
        r.inUseAt ? fmtTarih(r.inUseAt) : '',
        r.note || '',
        // OLCUM UC DURUM: "olcum yok" ile "yuk almiyor" AYRI kalmali. Kisa pencerede
        // ekrandaki etiketin aynisi ("son 3 gunde istek yok (7 gun olculemedi)").
        !r.traffic
          ? 'olcum yok'
          : r.traffic.state === 'active'
            ? 'yuk aliyor'
            : r.traffic.state === 'idle'
              ? 'yuk almiyor'
              : kismiEtiket(r.traffic) || 'olculemedi',
        // SAYI YALNIZ OLCULDUYSE: olculemeyen satira 0 yazmak, elektronik tabloda
        // toplanip "hic istek yok" diye okunurdu.
        r.traffic && r.traffic.req7 != null ? r.traffic.req7 : '',
        r.traffic && r.traffic.req24 != null ? r.traffic.req24 : '',
        r.traffic?.sampled ? 'evet' : '',
        r.traffic?.lastSeen || '',
        r.traffic ? r.traffic.hosts : '',
        r.traffic ? r.traffic.unknownHosts : '',
        r.hosts.join(' '),
        r.traffic && r.traffic.pencereSaat != null ? r.traffic.pencereSaat : '',
      ]),
    );
  }, [satirlar]);

  const beyanYaz = useCallback(async (r: ArkSatir, inUse: string | null, note: string) => {
    const k = satirAnahtari(r);
    setKayit(k);
    try {
      const cevap = await arkSpaApi.declare({
        namespace: r.namespace,
        application: r.application,
        location: r.location,
        inUse,
        note,
      });
      if (cevap.ok) {
        setData((d) =>
          d
            ? {
                ...d,
                rows: (d.rows || []).map((x) =>
                  satirAnahtari(x) === k
                    ? {
                        ...x,
                        inUse,
                        note,
                        inUseBy: cevap.inUseBy ?? x.inUseBy,
                        // Artık bu satırın KENDİ beyanı; devralınmış değil.
                        inUseScope: inUse ? 'location' : null,
                      }
                    : x,
                ),
              }
            : d,
        );
      }
    } finally {
      setKayit(null);
    }
  }, []);

  const servisler = data?.services || [];
  // EKIP LISTESI TUM SATIRLARDAN: suzgecin kendisi listeyi daraltmamali, yoksa bir ekibi
  // sectikten sonra otekilere geri donulemez.
  const ekipler = useMemo(() => {
    const t = new Set<string>();
    for (const r of data?.rows || []) for (const e of r.team) t.add(e);
    return [...t].sort();
  }, [data]);

  const sekmeler = (
    <div role="tablist" aria-label="Görünüm" className="flex gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
      {([['rapor', 'SPA raporu'], ['glomo', 'Glomo geçiş planı']] as const).map(([k, ad]) => (
        <button key={k} role="tab" aria-selected={sekme === k} onClick={() => setSekme(k)} className="px-3 py-1.5 text-[13px] -mb-px border-b-2" style={sekme === k ? { borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 600 } : { borderColor: 'transparent', color: 'var(--text-secondary)' }}>
          {ad}
        </button>
      ))}
    </div>
  );
  if (sekme === 'glomo')
    return (
      <div className="p-4 space-y-3">
        <h1 className="text-lg font-semibold">Nginx ARK SPA Raporu</h1>
        {sekmeler}
        <GlomoGecisPlani />
      </div>
    );

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Nginx ARK SPA Raporu</h1>
          <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            Production nginx tanımlarındaki tüm SPA uygulamaları, servis bazında. <b>Yük durumu</b>{' '}
            access log’dan ölçülür; <b>Ekip beyanı</b> sizin ifadenizdir. İkisi çelişebilir — yılda
            bir koşan bir iş ölçümde “yük almıyor” görünür ama siz kullanıyor olabilirsiniz.
          </p>
        </div>
        <button
          onClick={() => yukle(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg"
          style={{ borderColor: 'var(--border)' }}
          disabled={yukleniyor}
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin' : ''}`} /> Yenile
        </button>
      </div>
      {sekmeler}

      {data && !data.ok && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
        >
          {data.message || 'Rapor alınamadı.'}
        </div>
      )}
      {data?.notScanned && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-warning)', borderColor: 'var(--status-warning)' }}
        >
          Henüz tarama yok (nginx_config_audit job’ı koşmalı). Bu “SPA yok” demek değildir.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={servis}
          onChange={(e) => setServis(e.target.value)}
          className="px-2 py-1.5 text-xs border rounded-lg"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          <option value="all">tüm servisler ({servisler.length})</option>
          {servisler.map((s) => (
            <option key={s.service} value={s.service}>
              {s.service} — {s.apps} uygulama, {s.declared} beyanlı
            </option>
          ))}
        </select>
        <select
          value={beyanSuzgec}
          onChange={(e) => setBeyanSuzgec(e.target.value as 'all' | 'var' | 'yok')}
          className="px-2 py-1.5 text-xs border rounded-lg"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          <option value="all">beyan: hepsi</option>
          <option value="yok">beyan: BEKLEYEN</option>
          <option value="var">beyan: verilmiş</option>
        </select>
        <select
          value={ekip}
          onChange={(e) => setEkip(e.target.value)}
          className="px-2 py-1.5 text-xs border rounded-lg"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          <option value="all">ekip: hepsi ({ekipler.length})</option>
          {ekipler.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
          <option value="-">ekip: bilinmiyor</option>
        </select>
        <select
          value={yuk}
          onChange={(e) => setYuk(e.target.value as typeof yuk)}
          className="px-2 py-1.5 text-xs border rounded-lg"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          <option value="all">yük: hepsi</option>
          <option value="idle">yük almıyor (emekli adayı)</option>
          <option value="active">yük alıyor</option>
          <option value="unknown">ölçülemedi (7 gün ölçülemeyen “istek yok” dahil)</option>
          <option value="none">ölçüm yok</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="uygulama, namespace, location ya da ekip ara"
          className="px-2.5 py-1.5 text-xs border rounded-lg w-64"
          style={{ borderColor: 'var(--border)' }}
        />
        <button
          onClick={csvIndir}
          disabled={satirlar.length === 0}
          title="Ekranda görünen satırları CSV olarak indirir (süzgeç yoksa raporun tamamı)."
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg disabled:opacity-50"
          style={{ borderColor: 'var(--border)' }}
        >
          <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV ({satirlar.length})
        </button>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {satirlar.length} satır
          {data?.scanDate ? ` · tarama ${data.scanDate}` : ''}
          {data?.trafficReady === false ? ' · yük ölçümü yok' : ''}
        </span>
      </div>

      <div
        className="overflow-auto rounded-xl border"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              {/* Kolon sırası kullanıcının istediği gibi: Location, Ekip Beyanı'ndan
                  HEMEN SONRA (2026-09-29). */}
              <th className="text-left px-2 py-1.5">Ekip Beyanı</th>
              <th className="text-left px-2 py-1.5">Location</th>
              <th className="text-left px-2 py-1.5">Uygulama</th>
              <th className="text-left px-2 py-1.5">Namespace</th>
              <th className="text-left px-2 py-1.5">Ekip</th>
              <th className="text-left px-2 py-1.5">Yük Durumu</th>
              <th className="text-left px-2 py-1.5">Açıklama</th>
              {/* BEYAN EDEN (kullanici, 2026-10-01): "beyani dolduran kisinin ismi
                  otomatik olarak doldurulabilir mi". Zaten kaydediliyordu (sunucu
                  oturumdaki kullaniciyi yaziyor); eksik olan yalniz GOSTERIMDI.
                  Beyan bir OLCUM DEGIL, bir IFADEDIR - kimin soyledigi bilinmeden
                  degeri olmaz, bu yuzden kolon kalici. */}
              <th className="text-left px-2 py-1.5">Beyan Eden</th>
            </tr>
          </thead>
          <tbody>
            {satirlar.map((r, i) => {
              const k = satirAnahtari(r);
              const b = r.inUse ? BEYAN[r.inUse] : null;
              const devralinan = r.inUseScope === 'application';
              return (
                <tr key={i} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-2 py-1">
                    <select
                      value={r.inUse || ''}
                      disabled={kayit === k}
                      onChange={(e) => beyanYaz(r, e.target.value || null, r.note)}
                      className="px-1.5 py-1 text-[11px] border rounded-lg"
                      style={{
                        borderColor: 'var(--border)',
                        color: b?.color,
                        background: 'var(--bg-surface)',
                      }}
                      title={
                        r.inUse
                          ? `Beyan: ${b?.label}${r.inUseBy ? ` (${r.inUseBy})` : ''} — bu bir ÖLÇÜM DEĞİL.` +
                            (devralinan
                              ? ' Bu beyan UYGULAMA genelinden devralındı (SPA Taşımaları ekranı); bu location için ayrıca beyan girilmemiş. Seçim yaparsanız YALNIZ bu location için kaydedilir.'
                              : ' Bu location’a özel beyan.')
                          : 'Ekip bu location için beyan girmemiş.'
                      }
                    >
                      <option value="">— beyan yok —</option>
                      <option value="yes">kullanıyor</option>
                      <option value="no">kullanmıyor</option>
                      <option value="unknown">bilmiyor</option>
                    </select>
                    {devralinan && (
                      <div
                        className="text-[9px] mt-0.5"
                        style={{ color: 'var(--text-muted)' }}
                        title="Bu satırın kendi beyanı yok; uygulama genelindeki beyan gösteriliyor."
                      >
                        uygulamadan devralındı
                      </div>
                    )}
                  </td>
                  <td
                    className="px-2 py-1 font-mono break-all"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {r.location || '—'}
                    <span className="font-sans" style={{ color: 'var(--text-muted)' }}>
                      {' '}
                      · {r.service} · {r.hosts.length} sunucu
                    </span>
                  </td>
                  <td className="px-2 py-1 font-mono">{r.application}</td>
                  <td className="px-2 py-1 font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {r.namespace}
                  </td>
                  <td
                    className="px-2 py-1"
                    style={{ color: r.team.length ? undefined : 'var(--text-muted)' }}
                  >
                    {r.team.length ? r.team.join(', ') : 'bilinmiyor'}
                  </td>
                  <td className="px-2 py-1">
                    <YukHucre t={r.traffic} />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      defaultValue={r.note}
                      disabled={kayit === k}
                      onBlur={(e) => {
                        if (e.target.value !== r.note) beyanYaz(r, r.inUse, e.target.value);
                      }}
                      placeholder="not ekle"
                      className="px-1.5 py-1 text-[11px] border rounded-lg w-full"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    />
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    {r.inUseBy ? (
                      <span
                        title={
                          (devralinan
                            ? 'Uygulama genelindeki beyanı giren kişi. '
                            : 'Bu location için beyanı giren kişi. ') +
                          (r.inUseAt ? `Tarih: ${fmtTarih(r.inUseAt)}` : 'Tarih kaydı yok.')
                        }
                      >
                        {r.inUseBy}
                        {r.inUseAt && (
                          <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            {fmtTarih(r.inUseAt)}
                          </span>
                        )}
                      </span>
                    ) : (
                      // BEYAN YOKSA BOS: "-" bile yazmak, birinin bir sey soyledigi
                      // izlenimi verir.
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!satirlar.length && !yukleniyor && (
              <tr>
                <td colSpan={8} className="px-2 py-3" style={{ color: 'var(--text-muted)' }}>
                  Bu süzgeçlerle satır yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <details className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <summary className="cursor-pointer select-none">Bu rapor neyi gösteriyor?</summary>
        <div className="mt-1 space-y-1">
          <p>
            <CheckCircleIcon className="w-3.5 h-3.5 inline" /> Kaynak: nginx yapılandırma
            taramasının PROD SPA satırları. Aynı tanım birden fazla mirror sunucuda durduğu için
            satırlar tekilleştirilir; sunucu sayısı Location sütununda yazar.
          </p>
          <p>
            <ExclamationTriangleIcon className="w-3.5 h-3.5 inline" /> “ölçülemedi” ile “yük
            almıyor” <b>ayrı</b>: birincisinde log okunamamıştır, ikincisinde okunmuş ve istek
            bulunamamıştır. Emeklilik kararında bu fark önemlidir. “son 3 günde istek yok (7 gün
            ölçülemedi)” gibi satırlarda log okunmuş ama 7 günün tamamına bakılamamıştır (sunucuda
            log saklama süresi kısa): bunlar da “yük almıyor” <b>değildir</b>.
          </p>
          <p>
            <QuestionMarkCircleIcon className="w-3.5 h-3.5 inline" /> Beyan <b>location
            bazındadır</b>: bir satıra girdiğiniz değer aynı uygulamanın diğer
            location’larını <b>etkilemez</b>. SPA Taşımaları ekranındaki <b>uygulama</b>{' '}
            beyanı, kendi beyanı olmayan satırlarda <b>devralınmış</b> olarak görünür.
            {data?.skipped
              ? ` Uygulama/namespace bilgisi olmayan ${data.skipped} satır listeye alınmadı.`
              : ''}
          </p>
        </div>
      </details>
    </div>
  );
}
