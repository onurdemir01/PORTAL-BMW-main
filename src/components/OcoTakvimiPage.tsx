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
import React, { useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtDate, fmtDateTime } from '@/utils/datetime';

export interface OcoRow {
  oco: number;
  subject: string;
  explanation: string;
  statusText: string;
  statusCode: number;
  impactText: string;
  processText: string;
  pcabRequired: boolean;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  openedAt: string | null;
}

interface Sonuc {
  ok: boolean;
  rows?: OcoRow[];
  total?: number;
  fetched?: number;
  truncated?: boolean;
  fetchedAt?: string;
  cached?: boolean;
  notConfigured?: boolean;
  message?: string;
}

/** Gün anahtarı (YYYY-AA-GG) — yerel saatte. OCO pencereleri gece yarısını aşabildiği
 *  için gruplama BAŞLANGIÇ gününe göre yapılır; bitiş satırda ayrıca yazar. */
export function gunAnahtari(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Satırları güne göre gruplar; tarihsizler ayrı ve EN SONDA. */
export function gunlereBol(rows: OcoRow[]): { gun: string; rows: OcoRow[] }[] {
  const harita = new Map<string, OcoRow[]>();
  for (const r of rows) {
    const g = gunAnahtari(r.plannedStart);
    if (!harita.has(g)) harita.set(g, []);
    harita.get(g)!.push(r);
  }
  const gunler = [...harita.keys()].filter((g) => g).sort();
  const cikti = gunler.map((g) => ({ gun: g, rows: harita.get(g)! }));
  if (harita.has('')) cikti.push({ gun: '', rows: harita.get('')! });
  return cikti;
}

const DURUM_TON: Record<string, string> = {
  'Sorumlu Grup Açma Onayı': 'var(--status-info)',
  'Yönetici Onayı': 'var(--status-info)',
  'Değişiklik Yönetimi Kontrol Onayı': 'var(--status-warning)',
  'SRM Test ve Kapama Onayı': 'var(--status-success)',
};

function Chip({
  children,
  tone,
  title,
}: {
  children: React.ReactNode;
  tone?: string;
  title?: string;
}) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap"
      style={{ color: tone || 'var(--text-muted)', borderColor: tone || 'var(--border-subtle)' }}
      title={title}
    >
      {children}
    </span>
  );
}

function saat(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function OcoTakvimiPage() {
  const [data, setData] = useState<Sonuc | null>(null);
  const [loading, setLoading] = useState(true);
  const [gecmisAcik, setGecmisAcik] = useState(false);
  const [sorgu, setSorgu] = useState('');
  const [acik, setAcik] = useState<number | null>(null);

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
  const suzulmus = useMemo(() => {
    const q = sorgu.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        String(r.oco).includes(q) ||
        r.subject.toLowerCase().includes(q) ||
        r.statusText.toLowerCase().includes(q) ||
        r.explanation.toLowerCase().includes(q),
    );
  }, [rows, sorgu]);

  const bugun = gunAnahtari(new Date().toISOString());
  const gecmis = useMemo(
    () =>
      suzulmus.filter((r) => gunAnahtari(r.plannedStart) && gunAnahtari(r.plannedStart) < bugun),
    [suzulmus, bugun],
  );
  const gelecek = useMemo(
    () =>
      suzulmus.filter((r) => !gunAnahtari(r.plannedStart) || gunAnahtari(r.plannedStart) >= bugun),
    [suzulmus, bugun],
  );

  const satir = (r: OcoRow) => {
    const acikMi = acik === r.oco;
    return (
      <div key={r.oco} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <button
          type="button"
          onClick={() => setAcik(acikMi ? null : r.oco)}
          className="w-full text-left px-3 py-2 hover:bg-[var(--bg-elevated)] flex items-start gap-3"
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
              <Chip title="OCO numarası">#{r.oco}</Chip>
              {r.statusText && <Chip tone={DURUM_TON[r.statusText]}>{r.statusText}</Chip>}
              {r.impactText && <Chip>{r.impactText}</Chip>}
              {r.pcabRequired && <Chip tone="var(--status-warning)">PCAB</Chip>}
              {r.processText && r.processText !== 'Normal' && <Chip>{r.processText}</Chip>}
            </span>
          </span>
          {acikMi ? (
            <ChevronDownIcon className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 mt-0.5 shrink-0" />
          )}
        </button>
        {acikMi && (
          <div className="px-3 pb-3 pl-[7.5rem] space-y-2">
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Planlanan: {r.plannedStart ? fmtDateTime(r.plannedStart) : '—'}
              {' → '}
              {r.plannedEnd ? fmtDateTime(r.plannedEnd) : '—'}
              {r.openedAt && <> · açılış {fmtDate(r.openedAt)}</>}
              {/* GERCEKLESEN TARIH BOSSA "yapilmadi" DEMEK DEGIL: OCO kapanmadan bu
                  alanlar dolmuyor. Bu yuzden yalnizca DOLU oldugunda yaziyoruz. */}
              {r.actualStart && <> · gerçekleşen {fmtDateTime(r.actualStart)}</>}
            </div>
            {r.explanation && (
              <pre
                className="text-[11px] whitespace-pre-wrap rounded-lg border p-2 max-h-60 overflow-auto"
                style={{
                  borderColor: 'var(--border-subtle)',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-secondary)',
                }}
              >
                {r.explanation}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  };

  const gunBlogu = (g: { gun: string; rows: OcoRow[] }) => (
    <section
      key={g.gun || 'tarihsiz'}
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
    >
      <div
        className="px-3 py-1.5 text-[11px] uppercase tracking-wide flex items-center gap-2"
        style={{
          background: 'var(--bg-elevated)',
          color: g.gun === bugun ? 'var(--accent)' : 'var(--text-muted)',
        }}
      >
        <CalendarDaysIcon className="h-3.5 w-3.5" />
        {g.gun ? fmtDate(g.gun) : 'Planlanan tarihi yok'}
        {g.gun === bugun && <span className="font-semibold">· bugün</span>}
        <span className="ml-auto tabular-nums">{g.rows.length}</span>
      </div>
      {g.rows.map(satir)}
    </section>
  );

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
          className="h-8 px-2.5 text-xs rounded-lg border min-w-[18rem]"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
          }}
        />
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

      {/* SESSIZ KIRPMA YOK: sayfa siniri asildiysa liste EKSIK, bu yazilir. */}
      {data?.truncated && (
        <div
          className="text-[12px] rounded-lg px-3 py-2 border"
          style={{
            color: 'var(--status-warning)',
            background: 'var(--status-warning-bg)',
            borderColor: 'var(--status-warning)',
          }}
        >
          Liste <b>eksik</b>: servis sayfa sınırına takıldı ({data.fetched} / {data.total} kayıt).
        </div>
      )}

      {loading && !data ? (
        <LoadingLogo compact />
      ) : (
        <>
          {gecmis.length > 0 && (
            <button
              type="button"
              onClick={() => setGecmisAcik((x) => !x)}
              className="text-[11px] underline"
              style={{ color: 'var(--text-muted)' }}
            >
              {gecmisAcik ? 'Geçmişi gizle' : `Geçmiş ${gecmis.length} OCO'yu göster`}
            </button>
          )}
          {gecmisAcik && gunlereBol(gecmis).map(gunBlogu)}

          {gelecek.length === 0 && gecmis.length === 0 ? (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {data?.ok ? (sorgu ? 'Aramayla eşleşen OCO yok.' : 'Bu grupta OCO görünmüyor.') : ''}
            </div>
          ) : (
            gunlereBol(gelecek).map(gunBlogu)
          )}

          {data?.ok && (
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {suzulmus.length} / {rows.length} OCO gösteriliyor · serviste toplam{' '}
              {data.total ?? '?'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
