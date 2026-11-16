// src/components/denetim/InitSunucuGeneli.tsx — Denetim > Init Scripts, "Sunucu geneli" bolumu.
//
// NEDEN VAR (kullanici, 2026-11-16): "/vhosting ile /vhosting8 sayfalarinda appdomain.service'ler
// neden farkli gozukuyor? appdomain.service her sunucuda 1 tane zaten." Dosya
// /etc/systemd/system altinda, sunucuda TEK; ama iki kok tablosuna da yaziliyordu ve her kok
// sekmesi kendi cogunluguna gore olcuyordu. Simdi sunucu ucu iki tablonun birlesiminden sunucu
// basina TEK satir ve TEK referansla `sunucuGeneli` doner; bu bolum kok seciminden BAGIMSIZDIR
// (kok degisince icerik ayni kalir, arama/suzgec durumu korunur).
import React, { useMemo, useState } from 'react';
import { ArrowDownTrayIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import type {
  InitSunucuGeneli as InitSunucuGeneliData,
  InitSunucuGeneliBlock,
  InitSunucuGeneliDurum,
  InitSunucuGeneliFile,
  InitSunucuGeneliRow,
} from '@/api/denetimApi';
import CodeChip from '@/components/common/CodeChip';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtNumber } from '@/utils/datetime';
import { downloadCsv as csvDownload } from '@/utils/csv';

const DURUM: Record<InitSunucuGeneliDurum, { label: string; cls: string; title: string }> = {
  ayni: {
    label: 'aynı',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    title: 'Referansla aynı içerik',
  },
  bicim: {
    label: 'yalnız biçim farkı',
    cls: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)]',
    title: 'İçerik referansla aynı; yalnız satır sonu / boşluk farkı. Sapma sayılmaz.',
  },
  farkli: {
    label: 'farklı',
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
    title: 'İçerik referanstan farklı',
  },
  yok: {
    label: 'yok',
    cls: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)]',
    title: 'Dosya bulunamadı',
  },
  okunamadi: {
    label: 'okunamadı',
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
    title: 'Dosya var ama tarama kullanıcısı okuyamıyor (ya da hash alınamadı)',
  },
};
const SIRA: InitSunucuGeneliDurum[] = ['farkli', 'okunamadi', 'yok', 'bicim', 'ayni'];

function kokFarkiNotu(r: InitSunucuGeneliRow): string {
  if (!r.kokFarki || !r.digerKaynak) return '';
  const tur =
    r.kokFarki === 'bicim'
      ? 'yalnız biçim farkı'
      : r.kokFarki === 'durum'
        ? r.hash
          ? `/${r.digerKaynak} kaydında dosya yok`
          : `/${r.digerKaynak} kaydında dosya var`
        : 'içerik farklı';
  return `iki kök farklı (${tur}) — /${r.kaynak} kaydı kullanıldı`;
}

function Sayi({ n, l, tone }: { n: number; l: string; tone?: 'ok' | 'warn' }) {
  const color =
    tone === 'ok'
      ? 'text-emerald-600'
      : tone === 'warn'
        ? 'text-amber-600'
        : 'text-[var(--text-primary)]';
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <div className={`text-lg font-bold tabular-nums ${color}`}>{fmtNumber(n)}</div>
      <div className="text-[11px] text-[var(--text-secondary)]">{l}</div>
    </div>
  );
}

function Dosya({ f }: { f: InitSunucuGeneliFile }) {
  const [cls, setCls] = useState<'genel' | 'ozel'>('genel');
  const [q, setQ] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [acik, setAcik] = useState(false);
  const blok: InitSunucuGeneliBlock = cls === 'ozel' && f.special ? f.special : f;
  const s = blok.sayilar;
  const refHash = blok.referenceHash || blok.referenceNorm || blok.majorityHash || '';
  const ekip = blok.referenceSource === 'ekip';

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return blok.rows
      .filter((r) => {
        if (onlyDiff && r.durum === 'ayni' && !r.kokFarki) return false;
        if (needle && !r.host.toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort(
        (a, b) => SIRA.indexOf(a.durum) - SIRA.indexOf(b.durum) || a.host.localeCompare(b.host),
      );
  }, [blok, q, onlyDiff]);

  return (
    <section
      aria-label={`Sunucu geneli: ${f.label}`}
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Sunucu geneli: <span className="font-mono">{f.label}</span>
        </h3>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded border bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)]"
          title="/etc/systemd/system altında sunucu başına tek dosya. /vhosting ve /vhosting8 kayıtları birleştirilir; kök seçiminden bağımsızdır."
        >
          iki kök birlikte · kökten bağımsız
        </span>
        {refHash && (
          <span className="inline-flex items-center gap-1 min-w-0 text-xs text-[var(--text-secondary)]">
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 ${
                ekip
                  ? 'bg-sky-50 text-sky-700 border-sky-200'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)]'
              }`}
              title={
                ekip
                  ? "Ekip sürümü: depodaki dosyanın normalleştirilmiş hash'i"
                  : 'Ekip sürümü bilinmiyor; iki kökün birleşiminde en yaygın sürüm referans alındı'
              }
            >
              {ekip ? 'referans: ekip sürümü (depo)' : 'referans: çoğunluk'}
            </span>
            <CodeChip
              value={refHash}
              label={`${refHash.slice(0, 10)}…`}
              wrap="truncate"
              copyable
            />
          </span>
        )}
        {f.special && (
          <div className="flex gap-1 rounded-lg p-0.5 bg-[var(--bg-elevated)] ml-auto">
            {(
              [
                { id: 'genel', label: 'Genel envanter', n: f.sayilar.hosts },
                { id: 'ozel', label: 'GBEVM / GBPRV', n: f.special.sayilar.hosts },
              ] as const
            ).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCls(c.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  cls === c.id
                    ? 'bg-[var(--bg-surface)] shadow-sm text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {c.label} · {c.n}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-2 grid-cols-2 md:grid-cols-6">
        <Sayi n={s.hosts} l="sunucu (tek satır)" />
        <Sayi n={s.ayni} l="aynı" tone="ok" />
        <Sayi n={s.bicim} l="yalnız biçim farkı" />
        <Sayi n={s.farkli} l="farklı" tone={s.farkli ? 'warn' : undefined} />
        <Sayi n={s.yok + s.okunamadi} l="yok / okunamadı" />
        <Sayi n={s.kokFarki} l="iki kök farklı (bilgi)" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAcik(!acik)}
          aria-expanded={acik}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
        >
          {acik ? 'Sunucuları gizle' : `Sunucuları göster (${fmtNumber(blok.rows.length)})`}
        </button>
        {acik && (
          <>
            <div className="relative">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="sunucu ara"
                aria-label="Sunucu geneli: sunucu ara"
                className="pl-8 pr-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-56"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={onlyDiff}
                onChange={(e) => setOnlyDiff(e.target.checked)}
              />
              Sadece farkı olanlar
            </label>
            <span className="text-xs text-[var(--text-muted)] tabular-nums">
              {rows.length} sunucu
            </span>
            <button
              type="button"
              onClick={() =>
                csvDownload(
                  `init_sunucu_geneli_${f.key}${cls === 'ozel' ? '_ozel' : ''}`,
                  ['host', 'durum', 'hash', 'kaynak_kok', 'kokler', 'kok_farki', 'diger_hash', 'tarih'],
                  rows.map((r) => [
                    r.host,
                    r.durum,
                    r.hash || '',
                    r.kaynak,
                    r.kokler.join(' '),
                    r.kokFarki || '',
                    r.digerHash || '',
                    r.tarih || '',
                  ]),
                )
              }
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
            >
              <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
            </button>
          </>
        )}
      </div>

      {acik && (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
          <table className="w-full text-sm pf-table-sticky">
            <thead>
              <tr className="bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] text-left">
                <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Sunucu</th>
                <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Durum</th>
                <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Hash</th>
                <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Kaynak</th>
                <th className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Not</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {rows.length === 0 && <TableEmptyRow colSpan={5} />}
              {rows.slice(0, 500).map((r) => (
                <tr key={r.host} className="hover:bg-[var(--bg-elevated)]/60 align-top">
                  <td className="px-3 py-2 font-mono text-xs text-[var(--text-primary)] whitespace-nowrap">
                    {r.host}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      title={DURUM[r.durum].title}
                      className={`text-[11px] px-2 py-0.5 rounded-lg border ${DURUM[r.durum].cls}`}
                    >
                      {DURUM[r.durum].label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.hash ? (
                      <CodeChip
                        value={r.hash}
                        label={`${r.hash.slice(0, 10)}…`}
                        wrap="truncate"
                        copyable
                      />
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-secondary)] whitespace-nowrap">
                    /{r.kaynak}
                    {r.kokler.length > 1 && (
                      <span className="ml-1 text-[var(--text-muted)]">
                        ({r.kokler.map((k) => `/${k}`).join(' + ')})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-[var(--text-muted)]">
                    {r.kokFarki && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded border bg-sky-50 text-sky-700 border-sky-200"
                        title={`Diğer kayıt: ${r.digerHash || 'yok'}`}
                      >
                        {kokFarkiNotu(r)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {acik && rows.length > 500 && (
        <p className="text-xs text-[var(--text-muted)]">
          İlk 500 satır gösteriliyor — daraltmak için arama kutusunu kullanın ya da CSV indirin.
        </p>
      )}
    </section>
  );
}

/** Init Scripts sayfasinin ust bolumu: kokten bagimsiz sunucu geneli dosyalar. */
export default function InitSunucuGeneli({ data }: { data: InitSunucuGeneliData }) {
  // files bos + error: genis tablolar okunamadi, hicbir sey hesaplanmadi (inceleme B3).
  const hicOkunamadi = !!data.error && data.files.length === 0;
  const eksik = data.missingColumns || [];
  return (
    <div className="space-y-2">
      {data.error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          {hicOkunamadi
            ? `Sunucu geneli bölüm okunamadı (${data.error}); appdomain.service bu kez gösterilemiyor.`
            : `Sunucu geneli ayrıntı/referans tabloları okunamadı (${data.error}); bu bölüm ham hash ve çoğunlukla hesaplandı.`}
        </div>
      )}
      {eksik.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Sunucu geneli sütun veritabanında henüz yok:{' '}
          <b>{eksik.map((m) => `/${m.root} → ${m.label}`).join(', ')}</b>. Bu bölüm yalnız sütunu
          olan kök tablosundan hesaplandı.
        </div>
      )}
      {data.files.map((f) => (
        <Dosya key={f.key} f={f} />
      ))}
    </div>
  );
}
