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
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';
import { arkSpaApi, type ArkRapor, type ArkSatir, type ArkYuk } from '@/api/arkSpaApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';

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
        title="Access log okundu, 7 günün tamamına bakıldı ve sağlık kontrolü dışında hiç istek bulunamadı."
      >
        yük almıyor
      </span>
    );
  // "ÖLÇÜLEMEDİ" İKİ AYRI SEBEPTEN OLUR ve ikisi de "yük yok" DEĞİLDİR. Metin, teknik
  // terimle değil OLAN BİTENLE anlatılır (kullanıcı, 2026-09-29: "bu ne demek anlamadım?
  // bozuk bir Türkçe'yle yazılmış" — eski metin "log kuyruğu 7 günü kapsamıyor: sayı ALT
  // SINIRDIR" diyordu, okuyana hiçbir şey söylemiyordu).
  return (
    <span
      style={{ color: 'var(--status-warning)' }}
      title={
        t.hosts === 0
          ? `Access log okunamadı (${t.unknownHosts} sunucu). Bu uygulamanın istek alıp almadığı ölçülemedi — “yük almıyor” demek değil.`
          : `Access log dosyasının tamamı değil, yalnızca son bölümü okunabildi; okunan bölüm 7 günün tamamını kapsamıyor.${
              t.req7
                ? ` Orada ${t.req7} istek görüldü, gerçek sayı bundan fazla olabilir.`
                : ' Okunan bölümde istek yok, ama 7 günün tamamına bakılamadığı için “yük almıyor” denemez.'
            } Daha uzun süre ölçmek için tarama ayarındaki log okuma boyutu (spa_traffic_tail_mb) artırılmalı.`
      }
    >
      ölçülemedi{t.sampled && t.req7 ? ` (en az ${t.req7})` : ''}
    </span>
  );
}

export default function ArkSpaRaporuPage() {
  const [data, setData] = useState<ArkRapor | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [servis, setServis] = useState('all');
  const [beyanSuzgec, setBeyanSuzgec] = useState<'all' | 'var' | 'yok'>('all');
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
      if (!ara) return true;
      return (
        r.application.toLowerCase().includes(ara) ||
        r.namespace.toLowerCase().includes(ara) ||
        r.location.toLowerCase().includes(ara) ||
        r.team.join(' ').toLowerCase().includes(ara)
      );
    });
  }, [data, servis, beyanSuzgec, q]);

  const beyanYaz = useCallback(async (r: ArkSatir, inUse: string | null, note: string) => {
    const k = `${r.namespace}/${r.application}`;
    setKayit(k);
    try {
      const cevap = await arkSpaApi.declare({
        namespace: r.namespace,
        application: r.application,
        inUse,
        note,
      });
      if (cevap.ok) {
        // AYNI UYGULAMANIN TÜM SATIRLARI güncellenir: beyan uygulama başınadır, aynı
        // uygulama birden fazla location'dan sunuluyor olabilir.
        setData((d) =>
          d
            ? {
                ...d,
                rows: (d.rows || []).map((x) =>
                  x.namespace === r.namespace && x.application === r.application
                    ? { ...x, inUse, note, inUseBy: cevap.inUseBy ?? x.inUseBy }
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
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="uygulama, namespace, location ya da ekip ara"
          className="px-2.5 py-1.5 text-xs border rounded-lg w-64"
          style={{ borderColor: 'var(--border)' }}
        />
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
            </tr>
          </thead>
          <tbody>
            {satirlar.map((r, i) => {
              const k = `${r.namespace}/${r.application}`;
              const b = r.inUse ? BEYAN[r.inUse] : null;
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
                          ? `Beyan: ${b?.label}${r.inUseBy ? ` (${r.inUseBy})` : ''} — bu bir ÖLÇÜM DEĞİL.`
                          : 'Ekip bu uygulama için beyan girmemiş.'
                      }
                    >
                      <option value="">— beyan yok —</option>
                      <option value="yes">kullanıyor</option>
                      <option value="no">kullanmıyor</option>
                      <option value="unknown">bilmiyor</option>
                    </select>
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
                </tr>
              );
            })}
            {!satirlar.length && !yukleniyor && (
              <tr>
                <td colSpan={7} className="px-2 py-3" style={{ color: 'var(--text-muted)' }}>
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
            bulunamamıştır. Emeklilik kararında bu fark önemlidir.
          </p>
          <p>
            <QuestionMarkCircleIcon className="w-3.5 h-3.5 inline" /> Beyanınız SPA Taşımaları
            ekranındaki beyanla <b>aynı alandır</b>; birinde girdiğiniz değer diğerinde de görünür.
            {data?.skipped
              ? ` Uygulama/namespace bilgisi olmayan ${data.skipped} satır listeye alınmadı.`
              : ''}
          </p>
        </div>
      </details>
    </div>
  );
}
