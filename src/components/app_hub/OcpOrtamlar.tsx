// src/components/app_hub/OcpOrtamlar.tsx — Application Hub OCP: ortam başına küme, cluster'lar alt alta (2026-11-23).
//
// Her ortam ayrı kart; içinde cluster / namespace satırları alt alta: tür, replika, pod, sürüm (imaj etiketi),
// CPU / bellek, JVM parametreleri ve verinin kaynağı. Aynı ortamda çoğunluktan sapan hücre sarı ve altında
// çoğunluk değeri yazar (kurallar: ocpKarsilastir.ts). Ortamlar arası karşılaştırma yapılmaz.
import React, { useMemo, useState } from 'react';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import type { OcpCanliOkuma, OcpYer } from '@/api/appHubApi';
import { fmtDateTime, fmtRelative } from '@/utils/datetime';
import { Hap, JvmArglari, TD, TH, argBol } from './ortak';
import {
  type Fark,
  type FarkAlani,
  type OrtamGrubu,
  type UyeSatiri,
  ortamGruplari,
} from './ocpKarsilastir';

const ALAN_AD: Record<FarkAlani, string> = {
  tur: 'tür',
  replika: 'replika',
  surum: 'sürüm',
  kaynak: 'CPU / bellek',
  jvm: 'JVM',
};
const FARK_HUCRE = { background: 'var(--status-warning-bg)' };
const MONO = { fontFamily: 'var(--font-mono)' };

function FarkNotu({ farklar }: { farklar: Fark[] }) {
  if (!farklar.length) return null;
  return (
    <div className="mt-0.5 text-[11px]" style={{ color: 'var(--status-warning-text)' }}>
      {farklar.map((f) => (
        <div key={f.metin + f.ipucu}>{f.ipucu}</div>
      ))}
    </div>
  );
}

function DurumHap({ g }: { g: OrtamGrubu }) {
  if (g.katalogDisi)
    return (
      <Hap ton="notr" title="Cluster Portal kataloğunda yok: ortamı bilinmiyor, canlı okunamaz">
        ortam bilinmiyor · karşılaştırılmaz
      </Hap>
    );
  if (g.olculen < 2)
    return <Hap ton="notr">{g.olculen ? 'tek cluster ölçüldü' : 'ölçülemedi'}</Hap>;
  if (g.farkliUye) return <Hap ton="uyari">{`${g.farkliUye} cluster'da fark`}</Hap>;
  return <Hap ton="iyi">cluster'lar aynı</Hap>;
}

function parametreSayisi(u: UyeSatiri): number {
  return u.containerlar.reduce(
    (a, c) =>
      a +
      (c.jvm || []).reduce(
        (b, e) => b + (e.referans || !e.deger.trim().startsWith('-') ? 1 : argBol(e.deger).length),
        0,
      ),
    0,
  );
}

function JvmHucresi({
  u,
  karsilastirildi,
  acik,
  ac,
}: {
  u: UyeSatiri;
  karsilastirildi: boolean;
  acik: boolean;
  ac: () => void;
}) {
  if (!u.olculdu) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  if (u.containerlar.length && u.containerlar.every((c) => c.jvm === null))
    return (
      <span
        style={{ color: 'var(--text-muted)' }}
        title="JVM ayrıntısı boyut sınırı yüzünden atıldı"
      >
        ölçülemedi
      </span>
    );
  const farklar = u.farklar.filter((f) => f.alan === 'jvm');
  const sayi = parametreSayisi(u);
  const dugme = sayi > 0 && (
    <button type="button" className="pf-btn-link text-[12px]" onClick={ac} aria-expanded={acik}>
      {acik ? 'gizle' : 'tümünü göster'}
    </button>
  );
  if (farklar.length)
    return (
      <div className="space-y-0.5" data-testid="jvm-fark">
        {farklar.map((f) => (
          <div key={f.metin} className="text-[12px] break-all">
            <span style={{ ...MONO, color: 'var(--status-warning-text)' }}>{f.metin}</span>
            <span style={{ color: 'var(--text-muted)' }}> · {f.ipucu}</span>
          </div>
        ))}
        {dugme}
      </div>
    );
  if (!sayi) return <span style={{ color: 'var(--text-muted)' }}>tanımlı değil</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-[12px]">
      <span style={{ color: karsilastirildi ? 'var(--status-success)' : 'var(--text-secondary)' }}>
        {karsilastirildi ? `aynı · ${sayi} parametre` : `${sayi} parametre`}
      </span>
      {dugme}
    </span>
  );
}

function UyeSatir({ u, g }: { u: UyeSatiri; g: OrtamGrubu }) {
  const [acik, setAcik] = useState(false);
  const fark = (a: FarkAlani) => u.farklar.filter((f) => f.alan === a);
  const hucre = (a: FarkAlani) => (fark(a).length ? FARK_HUCRE : undefined);
  const o = u.okuma;
  const y = u.yer;
  const karsilastirildi = !g.katalogDisi && g.olculen >= 2;
  return (
    <>
      <tr
        style={{ borderTop: '1px solid var(--border-subtle)' }}
        data-testid="ocp-uye"
        data-fark={u.farklar.length ? 'var' : 'yok'}
      >
        <td className={TD}>
          <div style={MONO}>
            {y.konsol ? (
              <a
                href={y.konsol}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                {y.cluster} <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
              </a>
            ) : (
              y.cluster
            )}
          </div>
          <div className="text-[12px]" style={{ ...MONO, color: 'var(--text-muted)' }}>
            {y.namespace}
            {y.tenant ? ` · ${y.tenant}` : ''}
          </div>
        </td>
        <td className={TD} style={hucre('tur')}>
          {u.tur || <span style={{ color: 'var(--text-muted)' }}>bilinmiyor</span>}
          <FarkNotu farklar={fark('tur')} />
        </td>
        <td className={`${TD} tabular-nums`} style={hucre('replika')}>
          {u.replika ? `${u.replika.hazir} / ${u.replika.istenen}` : '—'}
          <FarkNotu farklar={fark('replika')} />
        </td>
        <td className={`${TD} tabular-nums`} data-testid="yer-pod">
          {u.pod ? (
            <span
              style={{
                color:
                  u.pod.toplam && u.pod.hazir < u.pod.toplam
                    ? 'var(--status-warning-text)'
                    : undefined,
                fontWeight: 600,
              }}
            >
              {u.pod.hazir} / {u.pod.toplam}
            </span>
          ) : (
            <span
              style={{ color: 'var(--text-muted)' }}
              title={o ? 'Pod listesi okunamadı' : 'Bu yer için tarama verisi yok'}
            >
              {o ? 'ölçülemedi' : '—'}
            </span>
          )}
        </td>
        <td className={TD} style={hucre('surum')}>
          {u.containerlar.length ? (
            u.containerlar.map((c) => (
              <div key={c.ad} className="break-all" style={MONO} title={c.imaj || undefined}>
                {u.containerlar.length > 1 ? `${c.ad}: ` : ''}
                {c.surum}
              </div>
            ))
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>—</span>
          )}
          <FarkNotu farklar={fark('surum')} />
        </td>
        <td className={`${TD} text-[12px] tabular-nums`} style={hucre('kaynak')}>
          {u.containerlar.length
            ? u.containerlar.map((c) => (
                <div key={c.ad}>
                  {u.containerlar.length > 1 ? `${c.ad}: ` : ''}
                  {c.kaynak}
                </div>
              ))
            : '—'}
          <FarkNotu farklar={fark('kaynak')} />
        </td>
        <td className={TD} style={hucre('jvm')}>
          <JvmHucresi
            u={u}
            karsilastirildi={karsilastirildi}
            acik={acik}
            ac={() => setAcik((x) => !x)}
          />
        </td>
        <td className={`${TD} text-[12px]`}>
          {o ? (
            <>
              <Hap ton={o.ok ? 'notr' : 'kritik'}>
                {o.ok ? (o.kaynak === 'saatlik' ? 'saatlik tarama' : 'canlı okuma') : 'okunamadı'}
              </Hap>
              {o.alinma && (
                <div style={{ color: 'var(--text-muted)' }} title={fmtDateTime(o.alinma)}>
                  {fmtRelative(o.alinma)}
                </div>
              )}
              {(o.sonOkumaHatasi || o.sonTaramaHatasi) && (
                <div style={{ color: 'var(--status-warning-text)' }}>
                  son okuma başarısız; veri eski
                </div>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>
              {y.onbellek ? `önbellek${y.onbellek.bayat ? ' · bayat' : ''}` : 'veri yok'}
            </span>
          )}
        </td>
      </tr>
      {acik && (
        <tr>
          <td colSpan={8} className="px-3 pb-3" style={{ background: 'var(--bg-inset)' }}>
            {u.containerlar.map((c) => (
              <div key={c.ad} className="space-y-2 pt-2">
                {u.containerlar.length > 1 && (
                  <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                    container <strong style={MONO}>{c.ad}</strong>
                  </div>
                )}
                {(c.jvm || []).map((e) =>
                  e.referans ? (
                    <p key={e.ad} className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                      <code style={MONO}>{e.ad}</code> değeri {e.deger} üzerinden geliyor (değer
                      okunmaz).
                    </p>
                  ) : (
                    <JvmArglari key={e.ad} baslik={e.ad} args={e.deger} bosMetin={`${e.ad} boş.`} />
                  ),
                )}
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

function OrtamKarti({ g }: { g: OrtamGrubu }) {
  const farkOzeti = (Object.entries(g.farkSayilari) as [FarkAlani, number][])
    .map(([a, n]) => `${ALAN_AD[a]} ${n}`)
    .join(' · ');
  return (
    <div data-testid="ocp-ortam" data-ortam={g.ortam || 'bilinmiyor'}>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5"
        style={{ background: 'var(--bg-inset)', borderTop: '1px solid var(--border-subtle)' }}
      >
        <h3
          className="text-[15px] font-semibold"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {g.katalogDisi ? "Katalogda olmayan cluster'lar" : g.ortam}
        </h3>
        <DurumHap g={g} />
        <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
          {g.uyeler.length} cluster / namespace · pod{' '}
          <strong>
            {g.pod.hazir} / {g.pod.toplam}
          </strong>{' '}
          hazır
          {g.pod.olculemeyen ? ` · ${g.pod.olculemeyen} yerde ölçülemedi` : ''}
        </span>
        {g.surumler.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-[12px]">
            <span style={{ color: 'var(--text-muted)' }}>sürüm</span>
            {g.surumler.map((s) => (
              <code
                key={s.surum}
                className="px-1.5 py-0.5 rounded"
                style={{
                  ...MONO,
                  background: 'var(--bg-surface)',
                  border: `1px solid ${g.surumler.length > 1 ? 'var(--status-warning-text)' : 'var(--border-subtle)'}`,
                  color: 'var(--text-primary)',
                }}
              >
                {s.surum}
                {g.surumler.length > 1 ? ` ×${s.sayi}` : ''}
              </code>
            ))}
          </span>
        )}
        {farkOzeti && (
          <span className="text-[12px]" style={{ color: 'var(--status-warning-text)' }}>
            farklı olan: {farkOzeti}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ color: 'var(--text-secondary)' }}>
              <th className={TH}>Cluster / namespace</th>
              <th className={TH}>Tür</th>
              <th className={TH}>Replika (hazır / istenen)</th>
              <th className={TH}>Pod (hazır / toplam)</th>
              <th className={TH}>Sürüm (imaj)</th>
              <th className={TH}>CPU / bellek</th>
              <th className={TH}>JVM parametreleri</th>
              <th className={TH}>Veri</th>
            </tr>
          </thead>
          <tbody>
            {g.uyeler.map((u) => (
              <UyeSatir key={u.anahtar} u={u} g={g} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function OcpOrtamlar({
  yerler,
  okumalar,
}: {
  yerler: OcpYer[];
  okumalar: OcpCanliOkuma[];
}) {
  const gruplar = useMemo(() => ortamGruplari(yerler, okumalar), [yerler, okumalar]);
  if (!yerler.length)
    return (
      <p className="p-4 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Envanterde bu uygulama için cluster / namespace kaydı yok.
      </p>
    );
  return (
    <div>
      {gruplar.map((g) => (
        <OrtamKarti key={g.ortam || 'bilinmiyor'} g={g} />
      ))}
    </div>
  );
}
