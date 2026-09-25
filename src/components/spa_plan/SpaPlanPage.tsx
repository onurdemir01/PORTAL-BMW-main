// src/components/spa_plan/SpaPlanPage.tsx — SPA Taşıma Planı, EKİP ekranı (2026-09-26).
//
// Kullanıcı: "SPA production taşımaları için ekiplerden planlama almak istiyorum ama
// e-postadan takip etmek çok zor. Nginx Hub dışında bir yer olsun, Production Taşımaları
// sayfasının aynısı yansısın; ekipler uygulamaları kullanılıyor mu, kullanılıyorsa ne zaman
// deployment/rollout geçecekler — tarih girsinler."
//
// EKRANIN İKİ AYRI SÜTUNU BİLEREK YAN YANA:
//   "Yük alıyor mu"  → ÖLÇÜM (access log). Portal'ın ölçtüğü şey.
//   "Kullanımda mı"  → BEYAN (ekip). Ekibin söylediği şey.
// Biri diğerinin yerine geçmez: yılda bir koşan bir uygulama ölçümde "atıl" görünür ama
// ekip haklı olarak "kullanıyoruz" der. Yönetici tarafında bu iki bilginin ÇELİŞTİĞİ satır
// en değerli satırdır; o yüzden ikisi de görünür kalır.
//
// Ekip YALNIZ iki şey yazar (kullanımda mı + tarih). "Geçti" işareti taramayla doğrulanan
// bir olgu; bu ekranda yok.
import React, { useCallback, useMemo, useState } from 'react';
import {
  ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon,
  MagnifyingGlassIcon, SignalIcon, SignalSlashIcon, QuestionMarkCircleIcon, CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import { spaPlanApi, type SpaPlanResult, type SpaPlanRow, type SpaPlanInUse } from '@/api/spaPlanApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDateTime } from '@/utils/datetime';
import { toast } from '@/hooks/useToast';

const SM_BTN = 'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
const btn = (primary = false): React.CSSProperties => (primary
  ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-fg, #fff)' }
  : { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' });

const IN_USE_LABEL: Record<SpaPlanInUse, string> = {
  yes: 'Kullanılıyor',
  no: 'Kullanılmıyor',
  unknown: 'Emin değilim',
};

function TrafficCell({ t, ready }: { t: SpaPlanRow['traffic']; ready: boolean }) {
  if (!ready) {
    return <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>ölçülemedi</span>;
  }
  if (!t || t.state === 'unknown') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }}
        title={t?.sampled ? 'Log kuyruğu 7 günü kapsamıyor — "yük yok" denemez.' : 'Bu uygulamanın logları okunamadı.'}>
        <QuestionMarkCircleIcon className="h-3.5 w-3.5" /> ölçülemedi
      </span>
    );
  }
  if (t.state === 'active') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--status-success)' }}
        title={`7 günde ${t.req7} istek · son istek: ${t.lastSeen || '—'}`}>
        <SignalIcon className="h-3.5 w-3.5" /> yük alıyor
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--status-warning)' }}
      title="Log okundu, 7 gündür sağlık kontrolü dışında istek yok.">
      <SignalSlashIcon className="h-3.5 w-3.5" /> 7 gündür istek yok
    </span>
  );
}

function Row({ r, onSaved, trafficReady }: { r: SpaPlanRow; onSaved: () => void; trafficReady: boolean }) {
  const [inUse, setInUse] = useState<SpaPlanInUse | ''>(r.inUse || '');
  const [date, setDate] = useState(r.plannedDate || '');
  const [note, setNote] = useState(r.note || '');
  const [busy, setBusy] = useState(false);

  const degisti = (inUse || null) !== (r.inUse || null)
    || (date || null) !== (r.plannedDate || null)
    || (note || '') !== (r.note || '');

  const kaydet = async () => {
    // Sunucu da ayni kurali uygular; buradaki kontrol yalniz kullaniciya HIZLI geri bildirim.
    if (inUse === 'yes' && !date) { toast.error('Kullanımdaysa deployment/rollout tarihi gerekli.'); return; }
    setBusy(true);
    try {
      const res = await spaPlanApi.declare({
        group: r.group, namespace: r.namespace, application: r.application,
        inUse: (inUse || null) as SpaPlanInUse | null,
        plannedDate: date || null,
        note: note || null,
      });
      if (!res.ok) { toast.error(res.message || 'Kaydedilemedi.'); return; }
      toast.success(`${r.application}: kaydedildi.`);
      onSaved();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
      <td className="px-3 py-2">
        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{r.application}</div>
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{r.namespace}</div>
        {r.mine === null && (
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--status-warning)' }}>sahibi çözülemedi</div>
        )}
      </td>
      <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        {r.services.join(', ') || '—'}
        <div style={{ color: 'var(--text-muted)' }}>{r.locationCount} yol</div>
      </td>
      <td className="px-3 py-2"><TrafficCell t={r.traffic} ready={trafficReady} /></td>
      <td className="px-3 py-2">
        <select
          value={inUse}
          onChange={(e) => setInUse(e.target.value as SpaPlanInUse | '')}
          className="h-7 text-[12px] rounded-lg border px-1.5 w-36"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
        >
          <option value="">— seçiniz —</option>
          <option value="yes">{IN_USE_LABEL.yes}</option>
          <option value="no">{IN_USE_LABEL.no}</option>
          <option value="unknown">{IN_USE_LABEL.unknown}</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={inUse === 'no'}
          title={inUse === 'no' ? 'Kullanılmıyorsa tarih gerekmez.' : 'Deployment / rollout tarihi'}
          className="h-7 text-[12px] rounded-lg border px-1.5 disabled:opacity-40"
          style={{ borderColor: inUse === 'yes' && !date ? 'var(--status-danger)' : 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
        />
      </td>
      <td className="px-3 py-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="not (isteğe bağlı)"
          maxLength={500}
          className="h-7 text-[12px] rounded-lg border px-1.5 w-full min-w-[10rem]"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
        />
        {r.updatedBy && (
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            son: {r.updatedBy}{r.updatedAt ? ` · ${fmtDateTime(r.updatedAt)}` : ''}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        {r.migratedDate ? (
          <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--status-success)' }}>
            <CheckCircleIcon className="h-3.5 w-3.5" /> geçti
          </span>
        ) : (
          <button type="button" className={SM_BTN} style={btn(degisti)} disabled={!degisti || busy} onClick={kaydet}>
            {busy ? 'kaydediliyor…' : 'Kaydet'}
          </button>
        )}
      </td>
    </tr>
  );
}

export default function SpaPlanPage() {
  const [data, setData] = useState<SpaPlanResult | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  // undefined = sunucu karar versin (yonetici ve grubu olmayan kullanici icin tumu).
  const [all, setAll] = useState<boolean | undefined>(undefined);
  const [q, setQ] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [tick, setTick] = useState(0);

  const load = useCallback(async (alive: () => boolean, fresh = false) => {
    setLoading(true); setErr('');
    try {
      const r = await spaPlanApi.rows(all, fresh);
      if (!alive()) return;
      if (!r.ok) { setErr(r.message || 'Liste alınamadı.'); setData(null); return; }
      setData(r);
    } catch (e: unknown) { if (alive()) setErr(e instanceof Error ? e.message : String(e)); } finally { if (alive()) setLoading(false); }
  }, [all]);

  useAsyncEffect(async (alive) => { await load(alive); }, [all, tick]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.rows || []).filter((r) => {
      if (onlyOpen && (r.inUse && (r.inUse !== 'yes' || r.plannedDate))) return false;
      if (!needle) return true;
      return r.application.includes(needle) || r.namespace.includes(needle) || r.services.join(' ').toLowerCase().includes(needle);
    });
  }, [data, q, onlyOpen]);

  // BOS EKRAN SEBEBINI SOYLER (2026-09-26): "hic satir yok" ile "suzgec hepsini eledi"
  // ayri seylerdir. Ilkini ikincisi gibi gostermek, kullaniciyi sayfanin bozuk oldugunu
  // dusunmeye iter - nitekim ilk surumde tam olarak bu oldu.
  const bosSebep = useMemo(() => {
    const toplam = data?.rows?.length ?? 0;
    if (toplam === 0 && (data?.hiddenByOwner ?? 0) > 0) {
      return {
        title: 'Sahiplik süzgeci tüm uygulamaları eledi',
        description: `${data?.hiddenByOwner} uygulama başka ekiplerin AD gruplarına ait görünüyor. “Tüm ekipler” kutusunu işaretleyerek hepsini görebilirsiniz.`,
      };
    }
    if (toplam === 0) {
      return {
        title: 'Taşıma listesi boş',
        description: 'Nginx taraması henüz uygulama üretmemiş olabilir (nginx_config_audit koşmamış) ya da bu gruplarda taşınacak uygulama yok.',
      };
    }
    if (onlyOpen) {
      return {
        title: 'Bekleyen bilgi yok',
        description: 'Tüm uygulamalar için bilgi girilmiş. “Yalnız bilgi bekleyenler” kutusunu kaldırarak tamamını görebilirsiniz.',
      };
    }
    return { title: 'Uygulama bulunamadı', description: 'Arama ölçütünüze uyan uygulama yok.' };
  }, [data, onlyOpen]);

  const bekleyen = useMemo(
    () => (data?.rows || []).filter((r) => !r.inUse || (r.inUse === 'yes' && !r.plannedDate)).length,
    [data],
  );

  if (loading && !data) return <LoadingLogo compact />;
  if (err) {
    return <div className="text-sm rounded-xl px-3 py-2 border" style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>{err}</div>;
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>SPA Taşıma Planı</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Uygulamalarınız yeni production Nginx sunucularına taşınıyor. Her uygulama için
          <b> kullanımda mı</b> olduğunu işaretleyin; kullanımdaysa <b>deployment/rollout tarihinizi</b> girin.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
          {data?.rows?.length ?? 0} uygulama
        </span>
        {bekleyen > 0 && (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium"
            style={{ background: 'var(--status-warning-bg)', color: 'var(--status-warning)', border: '1px solid var(--status-warning)' }}>
            {bekleyen} uygulama için bilgi bekleniyor
          </span>
        )}
        <span className="flex-1" />
        <div className="relative">
          <MagnifyingGlassIcon className="h-4 w-4 absolute left-2 top-1.5" style={{ color: 'var(--text-muted)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="uygulama / namespace ara"
            className="h-7 pl-7 pr-2 text-[12px] rounded-lg border w-56"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
          />
        </div>
        <label className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          yalnız bilgi bekleyenler
        </label>
        {(data?.isAdmin || (data?.groupCount ?? 0) === 0) && (
          <label
            className="inline-flex items-center gap-1 text-[11px]"
            style={{ color: 'var(--text-secondary)' }}
            title="Kapatırsanız yalnızca AD gruplarınıza ait uygulamalar listelenir."
          >
            <input type="checkbox" checked={data?.all === true} onChange={(e) => setAll(e.target.checked)} />
            tüm ekipler
          </label>
        )}
        <button type="button" className={SM_BTN} style={btn()} onClick={() => setTick((n) => n + 1)}>
          <ArrowPathIcon className="h-3.5 w-3.5" /> Yenile
        </button>
      </div>

      {data?.trafficReady === false && (
        <div className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
          <InformationCircleIcon className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Yük ölçümü şu an yok (access log taraması henüz koşmamış). Bu, “yük almıyor” anlamına <b>gelmez</b>.</span>
        </div>
      )}

      {(data?.hiddenByOwner ?? 0) > 0 && data?.all !== true && (
        <div className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
          <InformationCircleIcon className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Başka ekiplere ait {data?.hiddenByOwner} uygulama listelenmedi. Sizde görünmesi gereken bir uygulama eksikse bize bildirin (sahiplik AD grubundan çözülüyor).</span>
        </div>
      )}

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                <th className="text-left font-medium px-3 py-2">Uygulama</th>
                <th className="text-left font-medium px-3 py-2">Servis</th>
                <th className="text-left font-medium px-3 py-2" title="Access log ölçümü — Portal'ın ölçtüğü">Yük alıyor mu <span className="normal-case">(ölçüm)</span></th>
                <th className="text-left font-medium px-3 py-2" title="Sizin beyanınız">Kullanımda mı <span className="normal-case">(beyan)</span></th>
                <th className="text-left font-medium px-3 py-2">Deployment / rollout tarihi</th>
                <th className="text-left font-medium px-3 py-2">Not</th>
                <th className="text-left font-medium px-3 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <TableEmptyRow colSpan={7} title={bosSebep.title} description={bosSebep.description} />
              )}
              {rows.map((r) => (
                <Row key={`${r.group}|${r.namespace}|${r.application}`} r={r} trafficReady={data?.trafficReady !== false} onSaved={() => setTick((n) => n + 1)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--text-muted)' }}>
        <CalendarDaysIcon className="h-4 w-4 shrink-0" />
        Girdiğiniz tarih, taşımayı yürüten ekibin planlama ekranına anında yansır; e-posta göndermenize gerek yok.
        Bir tarihi değiştirmeniz gerekirse aynı satırdan güncelleyebilirsiniz.
      </p>
      {data?.ownersReady === false && (
        <p className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--status-warning)' }}>
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
          Uygulama sahipliği şu an tam çözülemiyor; liste eksik olabilir.
        </p>
      )}
    </div>
  );
}
