// src/components/nginx_console/PaketTutarlilik.tsx — Nginx Hub › Tutarlılık › Paketler (2026-11-16).
//
// Kullanici: "Glomo sunucularinin her zaman ve her sartta esit oldugunu bilmek istiyorum." Yeni
// PROD SPA filolarinda (tasima gruplari: Glomo ve digeri) her SPA uygulamasinin paketi (.version,
// dosya icerigi ozeti, config ozeti) her sunucuda ayni mi. Sunucu: nginx-console/paket-tutarlilik.cjs.
// Hukum: EŞİT yalniz tum sunucular taze olculmusken; olculemeyen sunucu "esit" sayilmaz.
import React, { useCallback, useState } from 'react';
import { ArrowPathIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { Pill } from '@/components/denetim/ui';
import LoadError from '@/components/common/LoadError';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { fmtDateTime, fmtNumber, fmtRelative } from '@/utils/datetime';
import {
  nginxConsoleApi,
  type NcPaketGrup,
  type NcPaketHucre,
  type NcPaketResult,
  type NcPaketSunucu,
  type NcPaketUygulama,
} from '@/api/nginxConsoleApi';

const HUKUM: Record<
  NcPaketGrup['hukum'],
  { label: string; tone: 'success' | 'danger' | 'warning'; aciklama: string }
> = {
  esit: {
    label: 'EŞİT',
    tone: 'success',
    aciklama: 'Tüm sunucular ölçüldü; her uygulama her sunucuda birebir aynı.',
  },
  farkli: {
    label: 'FARKLI',
    tone: 'danger',
    aciklama: 'En az bir uygulama sunucular arasında farklı ya da bazı sunucularda yok.',
  },
  olculemedi: {
    label: 'ÖLÇÜLEMEDİ',
    tone: 'warning',
    aciklama:
      'Kesin bir fark yok ama en az bir sunucu ya da uygulama ölçülemedi (veya karşılaştırılacak uygulama yok); eşit olduğu söylenemez.',
  },
};

const SUNUCU_DURUM: Record<
  NcPaketSunucu['durum'],
  { label: string; tone: 'success' | 'warning' | 'danger' }
> = {
  olculdu: { label: 'ölçüldü', tone: 'success' },
  bayat: { label: 'eski ölçüm', tone: 'warning' },
  'eski-betik': { label: 'paket verisi yok', tone: 'warning' },
  olculemedi: { label: 'ölçülemedi', tone: 'warning' },
  'dokum-yok': { label: 'döküm yok', tone: 'danger' },
};

const FARK_ADI: Record<string, string> = {
  version: 'sürüm',
  icerik: 'dosyalar',
  config: 'config',
  sikistirma: 'bayat sıkıştırma',
};

const UYG_DURUM: Record<NcPaketUygulama['durum'], { label: string; tone: 'danger' | 'warning' }> = {
  eksik: { label: 'eksik', tone: 'warning' },
  farkli: { label: 'farklı', tone: 'danger' },
  olculemedi: { label: 'okunamadı', tone: 'warning' },
};

const imza = (h: NcPaketHucre) => [h.version || '-', h.icerik || '-', h.config || '-'].join('|');

export function PaketTutarlilik({ onOpen }: { onOpen: (host: string) => void }) {
  const [data, setData] = useState<NcPaketResult | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await nginxConsoleApi.paketTutarlilik();
      if (r.ok) {
        setData(r);
        setHata(null);
      } else {
        setHata(r.message || 'Paket tutarlılığı alınamadı.');
      }
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useAsyncEffect(async () => {
    await load();
  }, [load]);

  if (hata) {
    return (
      <LoadError
        compact
        title="Paket tutarlılığı okunamadı"
        message={hata}
        onRetry={load}
        retrying={loading}
        testId="paket-hata"
      />
    );
  }
  if (!data) return <LoadingLogo compact />;

  return (
    <div className="space-y-4" data-testid="paket-tutarlilik">
      <div className="flex flex-wrap items-start gap-2">
        <div className="text-[11px] max-w-3xl" style={{ color: 'var(--text-muted)' }}>
          Yeni PROD SPA sunucu gruplarında her uygulamanın paketi karşılaştırılır: <b>sürüm</b>{' '}
          (.version), <b>dosyalar</b> (yol + içerik özeti; .gz/.br hariç) ve <b>config</b>{' '}
          (application.json + config.json özeti); kaynağından eski .gz/.br de fark sayılır,
          okunamayan dizin ya da dosya ölçülemedi sayılır. Veri Nginx Hub dökümünden gelir (her 30
          dakikada bir); bir sunucunun son ölçümü {data.tazeSaat ?? 3} saatten eskiyse ya da paket
          verisi yoksa o grup için <b>EŞİT</b> denmez.
        </div>
        <button
          onClick={load}
          className="ml-auto px-2.5 py-1.5 text-xs border rounded-lg"
          style={{ borderColor: 'var(--border)' }}
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 inline ${loading ? 'animate-spin' : ''}`} /> Yenile
        </button>
      </div>
      {data.groups.map((g) => (
        <GrupKart key={g.id} g={g} onOpen={onOpen} />
      ))}
      {data.generatedAt && (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Hesaplandı: {fmtDateTime(data.generatedAt)}
        </div>
      )}
    </div>
  );
}

function GrupKart({ g, onOpen }: { g: NcPaketGrup; onOpen: (host: string) => void }) {
  const [ayniAcik, setAyniAcik] = useState(false);
  const [tanimsizAcik, setTanimsizAcik] = useState(false);
  const h = HUKUM[g.hukum];
  const renk =
    h.tone === 'success'
      ? 'var(--status-success)'
      : h.tone === 'danger'
        ? 'var(--status-danger)'
        : 'var(--status-warning)';
  return (
    <section
      className="rounded-xl border"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      data-testid={`paket-grup-${g.id}`}
    >
      <div
        className="flex flex-wrap items-center gap-3 p-3 border-b"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div className="text-sm font-semibold">{g.label}</div>
        <span
          className="px-2.5 py-0.5 rounded-md text-xs font-bold tracking-wide"
          style={{ color: renk, border: `1px solid ${renk}` }}
          data-testid={`paket-hukum-${g.id}`}
          title={h.aciklama}
        >
          {h.label}
        </span>
        <div className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
          {fmtNumber(g.sayac.uygulama)} uygulama · {fmtNumber(g.sayac.ayni)} aynı ·{' '}
          <span style={{ color: g.sayac.farkli ? 'var(--status-danger)' : undefined }}>
            {fmtNumber(g.sayac.farkli)} farklı
          </span>{' '}
          ·{' '}
          <span style={{ color: g.sayac.eksik ? 'var(--status-warning-text)' : undefined }}>
            {fmtNumber(g.sayac.eksik)} eksik
          </span>{' '}
          {g.sayac.olculemedi > 0 && (
            <>
              {' '}
              ·{' '}
              <span style={{ color: 'var(--status-warning-text)' }}>
                {fmtNumber(g.sayac.olculemedi)} okunamadı
              </span>
            </>
          )}{' '}
          · {g.sayac.olculen}/{g.sayac.sunucu} sunucu ölçüldü
        </div>
      </div>
      <div className="p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {g.sunucular.map((s) => (
            <button
              key={s.host}
              onClick={() => onOpen(s.host)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs"
              style={{ borderColor: 'var(--border-subtle)' }}
              title={[
                s.neden,
                s.seenAt ? `son görülme: ${fmtDateTime(s.seenAt)}` : null,
                s.dumpedAt ? `son döküm: ${fmtDateTime(s.dumpedAt)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              data-testid={`paket-sunucu-${s.host}`}
            >
              <span className="font-mono">{s.host}</span>
              <Pill tone={SUNUCU_DURUM[s.durum].tone}>{SUNUCU_DURUM[s.durum].label}</Pill>
              {s.seenAt && (
                <span style={{ color: 'var(--text-muted)' }}>{fmtRelative(s.seenAt)}</span>
              )}
            </button>
          ))}
        </div>
        {g.sunucular.some((s) => s.durum !== 'olculdu') && (
          <ul
            className="text-[11px] list-disc pl-5"
            style={{ color: 'var(--status-warning-text)' }}
          >
            {g.sunucular
              .filter((s) => s.durum !== 'olculdu')
              .map((s) => (
                <li key={s.host}>
                  {s.host}: {s.neden}
                </li>
              ))}
          </ul>
        )}
        {g.apps.length > 0 ? (
          <UygulamaTablosu g={g} />
        ) : (
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {g.sayac.uygulama === 0
              ? 'Karşılaştırılacak uygulama bulunamadı (paket verisi boş ya da okunamadı); eşit olduğu söylenemez.'
              : g.hukum === 'esit'
                ? `${g.sayac.sunucu} sunucunun hepsinde ${fmtNumber(g.sayac.ayni)} uygulama birebir aynı.`
                : `Paketi okunabilen sunucular arasında fark bulunmadı (${fmtNumber(g.sayac.ayni)} uygulama); ölçülemeyen sunucular yüzünden eşit denemez.`}
          </div>
        )}
        <div className="flex flex-wrap gap-4 text-xs">
          <button
            onClick={() => setAyniAcik(!ayniAcik)}
            className="flex items-center gap-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            {ayniAcik ? (
              <ChevronDownIcon className="w-3.5 h-3.5" />
            ) : (
              <ChevronRightIcon className="w-3.5 h-3.5" />
            )}
            aynı olanlar ({fmtNumber(g.ayni.length)})
          </button>
          {g.tanimsiz.length > 0 && (
            <button
              onClick={() => setTanimsizAcik(!tanimsizAcik)}
              className="flex items-center gap-1"
              style={{ color: 'var(--text-secondary)' }}
              title="Uygulama dizini var ama hiçbir sunucuda bir conf onu göstermiyor (artık dizin); hükmü etkilemez."
            >
              {tanimsizAcik ? (
                <ChevronDownIcon className="w-3.5 h-3.5" />
              ) : (
                <ChevronRightIcon className="w-3.5 h-3.5" />
              )}
              tanımsız dizinler ({fmtNumber(g.tanimsiz.length)})
            </button>
          )}
        </div>
        {ayniAcik && (
          <div className="columns-1 md:columns-2 xl:columns-3 text-[11px] font-mono gap-6">
            {g.ayni.map((a) => (
              <div key={a.key} className="break-inside-avoid">
                {a.key} <span style={{ color: 'var(--text-muted)' }}>({a.version || '-'})</span>
              </div>
            ))}
          </div>
        )}
        {tanimsizAcik && (
          <div className="text-[11px] font-mono space-y-0.5">
            {g.tanimsiz.map((t) => (
              <div key={t.key}>
                {t.key} <span style={{ color: 'var(--text-muted)' }}>· {t.hosts.join(', ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function UygulamaTablosu({ g }: { g: NcPaketGrup }) {
  return (
    <div
      className="overflow-x-auto rounded-lg border"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <table className="w-full text-xs">
        <thead>
          <tr
            className="text-left"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
          >
            <th className="px-2 py-1.5 font-medium">Uygulama</th>
            <th className="px-2 py-1.5 font-medium">Durum</th>
            {g.hosts.map((h) => (
              <th key={h} className="px-2 py-1.5 font-medium font-mono">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {g.apps.map((a) => (
            <UygulamaSatiri key={a.key} a={a} hosts={g.hosts} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UygulamaSatiri({ a, hosts }: { a: NcPaketUygulama; hosts: string[] }) {
  const cogunlukImza = a.cogunluk
    ? [a.cogunluk.version || '-', a.cogunluk.icerik || '-', a.cogunluk.config || '-'].join('|')
    : null;
  const hucreOf = new Map(a.sunucular.map((s) => [s.host, s]));
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
      <td className="px-2 py-1.5">
        <div className="font-medium">{a.app}</div>
        <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {a.ns}
        </div>
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <Pill tone={UYG_DURUM[a.durum].tone}>{UYG_DURUM[a.durum].label}</Pill>
        {a.fark.length > 0 && (
          <div
            className="text-[10px] mt-0.5"
            style={{ color: 'var(--text-muted)' }}
            data-testid={`paket-fark-${a.key}`}
          >
            {a.fark.map((f) => FARK_ADI[f] || f).join(', ')}
          </div>
        )}
      </td>
      {hosts.map((h) => {
        const c = hucreOf.get(h);
        if (!c) {
          return (
            <td key={h} className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>
              ölçülmedi
            </td>
          );
        }
        if (c.okunamadi) {
          return (
            <td
              key={h}
              className="px-2 py-1.5 font-semibold"
              style={{ color: 'var(--status-warning-text)' }}
              data-testid={`paket-hucre-${a.key}-${h}`}
              title="Sunucuda bu uygulamanın dizini ya da bir dosyası okunamadı; özet çıkarılamadı."
            >
              OKUNAMADI
            </td>
          );
        }
        if (c.yok) {
          return (
            <td
              key={h}
              className="px-2 py-1.5 font-semibold"
              style={{ color: 'var(--status-warning-text)' }}
              data-testid={`paket-hucre-${a.key}-${h}`}
            >
              YOK
            </td>
          );
        }
        const sapma = cogunlukImza != null && imza(c) !== cogunlukImza;
        return (
          <td
            key={h}
            className="px-2 py-1.5"
            style={sapma ? { background: 'var(--status-danger-bg)' } : undefined}
            data-testid={`paket-hucre-${a.key}-${h}`}
            data-sapma={sapma ? '1' : '0'}
            title={c.versionZamani ? `.version: ${c.versionZamani}` : undefined}
          >
            <div
              className="font-mono"
              style={{ color: sapma ? 'var(--status-danger)' : undefined }}
            >
              {c.version || '—'}
            </div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {(c.icerik || '-').slice(0, 8)} · {(c.config || '-').slice(0, 8)} · {c.dosya ?? '?'}{' '}
              dosya
            </div>
            {(c.bayatSikistirma ?? 0) > 0 && (
              <div className="text-[10px]" style={{ color: 'var(--status-danger)' }}>
                {c.bayatSikistirma} bayat .gz/.br
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}
