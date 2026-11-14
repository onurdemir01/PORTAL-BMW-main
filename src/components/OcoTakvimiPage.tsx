// src/components/OcoTakvimiPage.tsx — ekibin OCO'ları, kronolojik.
//
// Kullanıcı (2026-09-28): "Ekibime ait production operational change order'ları listeleyen
// bir endpoint göndereceğim. Portal'da solda 'OCO Takvimi' diye bir sekme oluştur ve
// buradaki OCO'ları tarihlere ve başlığa işleyerek kronolojik listele."
//
// SIRALAMA planlanan başlangıca göre. Bugün bir ayraçla işaretlenir: takvimin okunma
// biçimi "bugün neredeyim, sırada ne var".
//
// TARİHSİZ OCO ATILMAZ: planlanan tarihi olmayan kayıt en sonda ayrı bir başlıkta durur.
// Listeden düşürmek, var olan bir değişikliği yokmuş gibi gösterirdi.
//
// GEÇMİŞ GİZLENMEZ, KATLANIR: varsayılan görünüm bugünden itibarendir; geçmiş kayıtlar
// tek tıkla açılır. Tamamen gizlemek, "bu OCO hiç yok" yanılgısı üretirdi.
//
// TAKVİM YAPRAĞI (2026-11-13, "bazı arkadaşlar o şekilde görmek istiyor"): Liste | Takvim seçimi.
// Liste varsayılan ve değişmedi; ?gorunum=takvim (paylaşılabilir) ya da izleyicinin son seçimi
// takvimi açar. Takvim: src/components/oco/OcoTakvimYapragi.tsx; ortak rozet/ayrıntı OcoOrtak.tsx.
import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { CodeChip } from '@/components/common/CodeChip';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtDate, fmtDateTime } from '@/utils/datetime';
import { gunSinifi, gunVurgu, pencereKapandi, type GunSinifi } from '@/components/oco/takvimVurgu';
import { OcoDetay, OcoRozetleri, saat, type OcoRow } from '@/components/oco/OcoOrtak';
import { gunAnahtari } from '@/components/oco/takvimIzgara';
import OcoTakvimYapragi from '@/components/oco/OcoTakvimYapragi';

// Liste ile takvim yapragi ayni tipi, ayni gun anahtarini kullanir (tek kaynak: oco/).
export type { OcoRow };
export { gunAnahtari };

/** Gorunum secimi (2026-11-13, takvim yapragi): URL'de ?gorunum=takvim (paylasilabilir), yoksa
 *  izleyicinin son secimi (localStorage), yoksa LISTE. */
export type Gorunum = 'liste' | 'takvim';
export const GORUNUM_ANAHTARI = 'oco-takvimi.gorunum';
function kayitliGorunum(): Gorunum | null {
  try {
    const v = window.localStorage.getItem(GORUNUM_ANAHTARI);
    return v === 'takvim' || v === 'liste' ? v : null;
  } catch {
    return null;
  }
}
function gorunumKaydet(g: Gorunum) {
  try {
    window.localStorage.setItem(GORUNUM_ANAHTARI, g);
  } catch {
    /* gizli pencere / engelli depolama: yalniz hatirlanmaz */
  }
}

interface Sonuc {
  ok: boolean;
  rows?: OcoRow[];
  total?: number;
  fetched?: number;
  truncated?: boolean;
  fetchedAt?: string;
  /** Sorgu başına servis sayıları (açtığımız / bize açılan). */
  kaynak?: Partial<Record<'acan' | 'sorumlu', { total: number; fetched: number; truncated: boolean }>>;
  /** Düşen sorgu: liste yalnız diğerinden — ekranda söylenir. */
  eksik?: { rol: string; message: string }[];
  cached?: boolean;
  notConfigured?: boolean;
  message?: string;
}

/** Satırları güne göre gruplar; tarihsizler ayrı ve EN SONDA. */
export function gunlereBol(rows: OcoRow[]): { gun: string; rows: OcoRow[] }[] {
  const harita = new Map<string, OcoRow[]>();
  for (const r of rows) {
    const g = gunAnahtari(r.plannedStart);
    if (!harita.has(g)) harita.set(g, []);
    harita.get(g)!.push(r);
  }
  const gunler = [...harita.keys()].filter((g) => g).sort((a, b) => a.localeCompare(b));
  const cikti = gunler.map((g) => ({ gun: g, rows: harita.get(g)! }));
  if (harita.has('')) cikti.push({ gun: '', rows: harita.get('')! });
  return cikti;
}

export default function OcoTakvimiPage() {
  const [data, setData] = useState<Sonuc | null>(null);
  const [loading, setLoading] = useState(true);
  // GECMIS 7'SER GUN (kullanici, 2026-11-12: "gecmisi ac deyince 2024'e kadar her sey aciliyor; her
  // tiklamada 7 gun geri atsin"). 0 = kapali; her tiklama 7 gun daha eskiye uzanir.
  const [gecmisGun, setGecmisGun] = useState(0);
  const [sorgu, setSorgu] = useState('');
  const [acik, setAcik] = useState<number | null>(null);
  // ILISKI SUZGECI (kullanici, 2026-11-12): "hem bizim actigimiz hem bize acilan OCO'lar ayni
  // anda" - varsayilan hepsi; istenirse yalniz biri.
  const [iliski, setIliski] = useState<'tumu' | 'acan' | 'sorumlu'>('tumu');
  // GORUNUM (kullanici, 2026-11-13: "istek halinde gercek bir takvim yapragi seklinde"): liste
  // varsayilan; URL parametresi paylasilabilir/yer imi, yoksa izleyicinin son secimi.
  const [searchParams, setSearchParams] = useSearchParams();
  const [kayitli] = useState<Gorunum | null>(kayitliGorunum);
  const urlGorunum = searchParams.get('gorunum');
  const gorunum: Gorunum =
    urlGorunum === 'takvim' || urlGorunum === 'liste' ? urlGorunum : kayitli || 'liste';
  const gorunumSec = (g: Gorunum) => {
    gorunumKaydet(g);
    setSearchParams(
      (onceki) => {
        const yeni = new URLSearchParams(onceki);
        yeni.set('gorunum', g);
        return yeni;
      },
      { replace: true },
    );
  };

  const yukle = async (refresh = false) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/oco/calendar${refresh ? '?refresh=1' : ''}`);
      setData(await r.json().catch(() => ({ ok: false, message: 'Yanıt okunamadı.' })));
    } catch (e) {
      setData({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

  useAsyncEffect(async (alive) => {
    if (alive()) await yukle();
  }, []);

  const rows = useMemo(() => data?.rows || [], [data]);
  const iliskiSay = useMemo(
    () => ({
      acan: rows.filter((r) => r.iliski?.includes('acan')).length,
      sorumlu: rows.filter((r) => r.iliski?.includes('sorumlu')).length,
    }),
    [rows],
  );
  const suzulmus = useMemo(() => {
    const q = sorgu.trim().toLowerCase();
    const ilk = iliski === 'tumu' ? rows : rows.filter((r) => r.iliski?.includes(iliski));
    if (!q) return ilk;
    return ilk.filter(
      (r) =>
        String(r.oco).includes(q) ||
        r.subject.toLowerCase().includes(q) ||
        r.statusText.toLowerCase().includes(q) ||
        r.explanation.toLowerCase().includes(q),
    );
  }, [rows, sorgu, iliski]);

  const bugun = gunAnahtari(new Date().toISOString());
  const gecmis = useMemo(
    () =>
      suzulmus.filter((r) => gunAnahtari(r.plannedStart) && gunAnahtari(r.plannedStart) < bugun),
    [suzulmus, bugun],
  );
  // Gosterilen gecmis: bugunden gecmisGun gun oncesine kadar (yerel gun anahtari, ISO karsilastirma).
  const gecmisSinir = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - gecmisGun);
    return gunAnahtari(d.toISOString());
  }, [gecmisGun]);
  const gecmisGorunen = useMemo(
    () => (gecmisGun ? gecmis.filter((r) => gunAnahtari(r.plannedStart) >= gecmisSinir) : []),
    [gecmis, gecmisGun, gecmisSinir],
  );
  const dahaEski = gecmis.length - gecmisGorunen.length;
  const gelecek = useMemo(
    () =>
      suzulmus.filter((r) => !gunAnahtari(r.plannedStart) || gunAnahtari(r.plannedStart) >= bugun),
    [suzulmus, bugun],
  );

  const satir = (r: OcoRow, sinif: GunSinifi = 'gelecek') => {
    const acikMi = acik === r.oco;
    // BUGUNUN blogunda ama penceresi KAPANMIS OCO: "bugun yapilacak" demek yanlis olur.
    // `null` (plannedEnd yok) "kapandi" SAYILMAZ - isaret basilmaz.
    const kapandi = sinif === 'bugun' ? pencereKapandi(r.plannedEnd) === true : false;
    return (
      <div key={r.oco} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        {/* SATIR AÇICI ARTIK <button> DEĞİL, role="button" bir <div> (2026-09-29).
            Sebep: OCO numarası kopyalanabilir olsun diye içine gerçek bir <button>
            kondu; <button> içinde <button> geçersiz HTML'dir ve tarayıcılar iç
            düğmenin tıklamasını öngörülemez biçimde işler. Klavye erişimi korundu:
            tabIndex + Enter/Space. */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setAcik(acikMi ? null : r.oco)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setAcik(acikMi ? null : r.oco);
            }
          }}
          className="w-full text-left px-3 py-2 hover:bg-[var(--bg-elevated)] flex items-start gap-3 cursor-pointer"
        >
          <span
            className="text-[11px] tabular-nums pt-0.5"
            style={{ color: 'var(--text-muted)', minWidth: '5.5rem' }}
          >
            {saat(r.plannedStart)}–{saat(r.plannedEnd)}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm truncate" style={{ color: 'var(--text-primary)' }}>
              {r.subject || '(başlıksız)'}
            </span>
            <span className="flex flex-wrap items-center gap-1.5 mt-1">
              {/* Kopyalanabilir OCO numarası (kullanıcı, 2026-09-29). Tıklama satırı
                  AÇMAMALI: kopyalamak isteyen kişi satırı açmak istemiyor. */}
              <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <CodeChip value={String(r.oco)} label={`#${r.oco}`} copyable tone="muted" />
              </span>
              <OcoRozetleri r={r} kapandi={kapandi} />
            </span>
          </span>
          {acikMi ? (
            <ChevronDownIcon className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 mt-0.5 shrink-0" />
          )}
        </div>
        {acikMi && (
          <OcoDetay r={r} className="px-3 pb-3 pl-[7.5rem] space-y-2" />
        )}
      </div>
    );
  };

  const gunBlogu = (g: { gun: string; rows: OcoRow[] }) => {
    const sinif = gunSinifi(g.gun, bugun);
    const vurgu = gunVurgu(sinif);
    return (
      <section
        key={g.gun || 'tarihsiz'}
        className="rounded-xl border overflow-hidden"
        style={{
          // SOL SERIT: vurgu rengi. Tum kenarligi boyamak gelecek gunlerle farki
          // azaltiyordu; serit, listede goz gezdirirken ANINDA ayirt ediliyor.
          borderColor: 'var(--border-subtle)',
          borderLeftWidth: vurgu ? 3 : 1,
          borderLeftColor: vurgu ? vurgu.renk : 'var(--border-subtle)',
          background: 'var(--bg-surface)',
        }}
      >
        <div
          className="px-3 py-1.5 text-[11px] uppercase tracking-wide flex items-center gap-2"
          style={{
            // Baslik zemini de hafifce tonlanir (`color-mix`: tema degiskenini bozmadan
            // %12 karistirir, sabit bir renk yazmak koyu/acik temadan birinde patlardi).
            background: vurgu
              ? `color-mix(in srgb, ${vurgu.renk} 12%, var(--bg-elevated))`
              : 'var(--bg-elevated)',
            color: vurgu ? vurgu.renk : 'var(--text-muted)',
          }}
        >
          <CalendarDaysIcon className="h-3.5 w-3.5" />
          {g.gun ? fmtDate(g.gun) : 'Planlanan tarihi yok'}
          {vurgu && (
            <span
              className="font-semibold px-1.5 py-0.5 rounded-full border text-[10px]"
              style={{ borderColor: vurgu.renk }}
              title={
                sinif === 'bugun'
                  ? 'Bugün yapılacak çalışmalar'
                  : 'Planlanan tarihi geçmiş — yapıldıysa OCO kapatılmalı'
              }
            >
              {vurgu.etiket}
            </span>
          )}
          <span className="ml-auto tabular-nums">{g.rows.length}</span>
        </div>
        {g.rows.map((r) => satir(r, sinif))}
      </section>
    );
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          OCO Takvimi
        </h1>
        <input
          value={sorgu}
          onChange={(e) => setSorgu(e.target.value)}
          placeholder="başlık, OCO no, durum ya da açıklamada ara"
          aria-label="OCO takviminde ara"
          className="h-8 px-2.5 text-xs rounded-lg border min-w-[18rem]"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
          }}
        />
        <div
          role="radiogroup"
          aria-label="OCO ilişkisi"
          className="flex gap-1 rounded-lg p-0.5 w-fit"
          style={{ background: 'var(--bg-elevated)' }}
          data-testid="oco-iliski"
        >
          {(
            [
              { id: 'tumu', label: 'Tümü', n: rows.length },
              { id: 'acan', label: 'Açtığımız', n: iliskiSay.acan },
              { id: 'sorumlu', label: 'Bize açılan', n: iliskiSay.sorumlu },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={iliski === s.id}
              onClick={() => setIliski(s.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md ${iliski === s.id ? 'shadow-sm' : ''}`}
              style={{
                background: iliski === s.id ? 'var(--bg-surface)' : 'transparent',
                color: iliski === s.id ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {s.label}
              <span className="ml-1.5 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {s.n}
              </span>
            </button>
          ))}
        </div>
        <div
          role="radiogroup"
          aria-label="Görünüm"
          className="flex gap-1 rounded-lg p-0.5 w-fit"
          style={{ background: 'var(--bg-elevated)' }}
          data-testid="oco-gorunum"
        >
          {(
            [
              { id: 'liste', label: 'Liste' },
              { id: 'takvim', label: 'Takvim' },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={gorunum === s.id}
              onClick={() => gorunumSec(s.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${gorunum === s.id ? 'shadow-sm' : ''}`}
              style={{
                background: gorunum === s.id ? 'var(--bg-surface)' : 'transparent',
                color: gorunum === s.id ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void yukle(true)}
          disabled={loading}
          className="inline-flex items-center gap-1 h-8 px-2.5 text-xs rounded-lg border disabled:opacity-40"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
          }}
        >
          <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
        </button>
        {data?.fetchedAt && (
          <span
            className="text-[11px] flex items-center gap-1"
            style={{ color: 'var(--text-muted)' }}
          >
            <ClockIcon className="h-3.5 w-3.5" />
            {fmtDateTime(data.fetchedAt)} {data.cached && '(önbellek)'}
          </span>
        )}
      </div>

      {data && !data.ok && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
          style={{
            color: 'var(--status-danger)',
            background: 'var(--status-danger-bg)',
            borderColor: 'var(--status-danger)',
          }}
        >
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0" />
          {/* Mesaj artik cagrilan ADRESI de tasiyor (bkz. server/oco/search.cjs
              aramaHatasi). Uzun bir URL sarmalanmazsa kutuyu yatayda tasirir. */}
          <span className="min-w-0 break-words">{data.message || 'OCO listesi alınamadı.'}</span>
        </div>
      )}

      {/* IKI SORGUDAN BIRI DUSTU: liste yalniz digerinden; "OCO yok" gibi okunmasin. */}
      {data?.ok && !!data.eksik?.length && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{
            color: 'var(--status-warning-text)',
            background: 'var(--status-warning-bg)',
            borderColor: 'var(--status-warning)',
          }}
          data-testid="oco-eksik"
        >
          Liste <b>eksik</b>: {data.eksik.map((e) => e.message).join(' · ')}
        </div>
      )}

      {/* SESSIZ KIRPMA YOK: sayfa siniri asildiysa liste EKSIK, bu yazilir. */}
      {data?.truncated && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{
            color: 'var(--status-warning-text)',
            background: 'var(--status-warning-bg)',
            borderColor: 'var(--status-warning)',
          }}
        >
          Liste <b>eksik</b>: servis sayfa sınırına takıldı
          {data.kaynak
            ? ` (${(['acan', 'sorumlu'] as const)
                .filter((k) => data.kaynak?.[k]?.truncated)
                .map((k) => `${k === 'acan' ? 'açtığımız' : 'bize açılan'}: ${data.kaynak![k]!.fetched} / ${data.kaynak![k]!.total} kayıt`)
                .join(' · ')})`
            : ` (${data.fetched} / ${data.total} kayıt)`}
          .
        </div>
      )}

      {loading && !data ? (
        <LoadingLogo compact />
      ) : gorunum === 'takvim' ? (
        <>
          <OcoTakvimYapragi rows={suzulmus} tumRows={rows} eksik={!!data?.truncated} bugun={bugun} />
          {data?.ok && suzulmus.length === 0 && (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {sorgu
                ? 'Aramayla eşleşen OCO yok.'
                : iliski !== 'tumu'
                  ? `${iliski === 'acan' ? 'Açtığımız' : 'Bize açılan'} OCO görünmüyor.`
                  : 'Bu grupta OCO görünmüyor.'}
            </div>
          )}
          {data?.ok && (
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {suzulmus.length} / {rows.length} OCO gösteriliyor
            </div>
          )}
        </>
      ) : (
        <>
          {gecmis.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-[11px]" data-testid="oco-gecmis">
              {dahaEski > 0 && (
                <button
                  type="button"
                  onClick={() => setGecmisGun((g) => g + 7)}
                  className="underline"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {gecmisGun ? `7 gün daha geriye git` : 'Geçen haftanın OCO’larını göster'}
                </button>
              )}
              {gecmisGun > 0 && (
                <>
                  <span style={{ color: 'var(--text-muted)' }}>
                    son {gecmisGun} gün · {gecmisGorunen.length} geçmiş OCO
                    {dahaEski > 0 ? ` · daha eski ${dahaEski}` : ''}
                  </span>
                  <button type="button" onClick={() => setGecmisGun(0)} className="underline" style={{ color: 'var(--text-muted)' }}>
                    Geçmişi gizle
                  </button>
                </>
              )}
            </div>
          )}
          {gecmisGun > 0 && gunlereBol(gecmisGorunen).map(gunBlogu)}

          {gelecek.length === 0 && gecmis.length === 0 ? (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {data?.ok
                ? sorgu
                  ? 'Aramayla eşleşen OCO yok.'
                  : iliski !== 'tumu'
                    ? `${iliski === 'acan' ? 'Açtığımız' : 'Bize açılan'} OCO görünmüyor.`
                    : 'Bu grupta OCO görünmüyor.'
                : ''}
            </div>
          ) : (
            gunlereBol(gelecek).map(gunBlogu)
          )}

          {data?.ok && (
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {suzulmus.length} / {rows.length} OCO gösteriliyor
              {data.kaynak?.acan || data.kaynak?.sorumlu
                ? ` · serviste açtığımız ${data.kaynak?.acan?.total ?? '?'}, bize açılan ${data.kaynak?.sorumlu?.total ?? '?'} (ortak olanlar bir kez listelenir)`
                : ` · serviste toplam ${data.total ?? '?'}`}
            </div>
          )}
        </>
      )}
    </div>
  );
}
