// src/components/server_hub/SunucuPaneli.tsx — Bulgular › sunucuya tıklayınca açılan panel (2026-11-06).
//
// Kullanıcı: "bulgular ekranında bir sunucuya tıklanırsa da ui simple aksiyona yönelik ve açılır kapanır
// şekilde detay gösteren gerçek sonuç gösteren şekilde olsun". Bölümler açılır-kapanır; yalnız "Ne
// yapmalı" açık başlar. Her değer kaynağıyla (Server Hub taraması / Uygulama Envanteri) ve tarihiyle.
// Zincir: JVM → bağlı EAR (domain.xml / host.xml) → web sunucusu (aynı makine ya da ayrı) → trafik.
import React, { useMemo, useState } from 'react';
import {
  serverHubApi,
  type ShEtiketKurali,
  type ShFinding,
  type ShFix,
  type ShHostDetail,
  type ShRetireEtiketHer,
  type ShRetireSonuc,
  type ShSeverity,
} from '@/api/serverHubApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';
import LoadError from '@/components/common/LoadError';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { SeviyeRozeti } from './KurallarTab';
import { BTN, btnStil, EtiketAyrinti, EtiketRozeti, KomutSatiri } from './RetireEtiketleri';
import {
  ETIKET_SEVIYE,
  KONTROL_DURUM,
  bulgudanJvm,
  deploymentMetni,
  dogrulamaAdimlari,
  earDurumMetni,
  hostEtiketleri,
  konuMetni,
  retirementUygulamasi,
  zincirKartlari,
} from './retireEtiket';

const SIRA: Record<ShSeverity, number> = { danger: 3, warning: 2, info: 1, ok: 0 };

function Bolum({
  baslik,
  acik = false,
  children,
  testId,
}: {
  baslik: React.ReactNode;
  acik?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <details
      open={acik}
      className="rounded-lg border"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      data-testid={testId}
    >
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold select-none">
        {baslik}
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2 text-xs">{children}</div>
    </details>
  );
}

/** "R1 · Kapalı + auto-start açık + trafik yok" — kod tek başına anlamsız; adıyla birlikte. */
const kurallarMetni = (kodlar: string[], kurallar: ShEtiketKurali[]) =>
  kodlar.map((k) => `${k} · ${kurallar.find((x) => x.kural === k)?.ad || ''}`.trim()).join(' + ');

/** Etiket satiri: ayrinti (eslenik kopyalar) YALNIZ acilinca cizilir ve indirilir. */
function AcilirEtiket({
  e,
  kurallar,
  onDegisti,
  onRetirementAc,
}: {
  e: ShRetireEtiketHer;
  kurallar: ShEtiketKurali[];
  onDegisti: () => void;
  onRetirementAc?: (uygulama: string, not: string) => void;
}) {
  const [acik, setAcik] = useState(false);
  return (
    <details
      className="rounded border px-2 py-1"
      style={{ borderColor: 'var(--border-subtle)' }}
      onToggle={(x) => setAcik((x.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer flex flex-wrap items-center gap-2">
        <EtiketRozeti b={ETIKET_SEVIYE[e.seviye]} kucuk />
        <span className="font-mono text-[11px]">{konuMetni(e)}</span>
        <span style={{ color: 'var(--text-muted)' }}>
          {kurallarMetni(e.kurallar, kurallar)} · {e.ortam} · {e.hostlar.length} sunucu
        </span>
        <EtiketRozeti b={KONTROL_DURUM[e.durum]} kucuk />
      </summary>
      {acik && (
        <div className="mt-2">
          <EtiketAyrinti
            e={e}
            kurallar={kurallar}
            onDegisti={onDegisti}
            onRetirementAc={onRetirementAc}
          />
        </div>
      )}
    </details>
  );
}

const calisma = (j: { running: boolean; runningKnown?: boolean | null }) =>
  j.runningKnown === false ? 'ölçülemedi' : j.running ? 'çalışıyor' : 'kapalı';

export default function SunucuPaneli({
  host,
  retire,
  onEtiketDegisti,
  onRetirementAc,
  onAutoStart,
  asBusy,
}: {
  host: string;
  retire: ShRetireSonuc | null;
  onEtiketDegisti: () => void;
  onRetirementAc?: (uygulama: string, not: string) => void;
  onAutoStart?: (f: { host: string; code: string; fix: ShFix }) => void;
  asBusy?: string | null;
}) {
  const [d, setD] = useState<ShHostDetail | null>(null);
  const [hata, setHata] = useState('');
  const [tazele, setTazele] = useState(0);
  useAsyncEffect(
    async (alive) => {
      try {
        const r = await serverHubApi.host(host);
        if (!alive()) return;
        setHata('');
        if (r.ok) setD(r.host);
        else setHata(r.message || 'Sunucu ayrıntısı alınamadı.');
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [host, tazele],
  );
  const etiketler = useMemo(() => hostEtiketleri(retire?.etiketler, host), [retire, host]);
  const bulgular = useMemo(
    () => (d ? [...d.findings].sort((a, b) => SIRA[b.severity] - SIRA[a.severity]) : []),
    [d],
  );
  if (hata)
    return (
      <LoadError
        title={`${host} ayrıntısı okunamadı`}
        message={hata}
        onRetry={() => setTazele((n) => n + 1)}
      />
    );
  if (!d)
    return (
      <div className="py-6 flex justify-center">
        <LoadingLogo />
      </div>
    );
  const { kartlar, bagsizEarlar } = zincirKartlari(d);
  const autoStartlar = bulgular.filter(
    (f): f is ShFinding & { fix: ShFix } =>
      !!f.fix && (f.fix.action === 'jboss_autostart_on' || f.fix.action === 'jboss_autostart_off'),
  );
  const kritik = bulgular.filter((f) => f.severity === 'danger');
  const adimlar = dogrulamaAdimlari(bulgular, etiketler, retire?.kurallar || [], bulgudanJvm);
  const kaynak = `Server Hub taraması ${d.scanDate || '?'}${d.fresh === false ? ' (bayat)' : ''}`;
  return (
    <div className="space-y-2" data-testid="sunucu-paneli">
      <Bolum baslik="Ne yapmalı" acik testId="bolum-ne-yapmali">
        <div style={{ color: 'var(--text-muted)' }}>
          {kaynak} · {earDurumMetni(d.ear)}
        </div>
        {kritik.length === 0 && etiketler.length === 0 && autoStartlar.length === 0 && (
          <div>Bu sunucuda eylem gerektiren bulgu ya da retirement etiketi yok.</div>
        )}
        {kritik.length > 0 && (
          <div>
            <b>{fmtNumber(kritik.length)} kritik bulgu:</b>
            <ul className="list-disc ml-5">
              {kritik.slice(0, 5).map((f, i) => (
                <li key={f.code + i}>{f.text}</li>
              ))}
            </ul>
            <div style={{ color: 'var(--text-muted)' }}>
              Nasıl doğrulanacağı “Doğrulama adımları” bölümünde.
            </div>
          </div>
        )}
        {autoStartlar.length > 0 && onAutoStart && (
          <div className="flex flex-wrap items-center gap-2">
            {autoStartlar.map((f) => {
              const k = `${host}|${f.fix.gen}|${f.fix.jvm}`;
              return (
                <button
                  key={k}
                  type="button"
                  className={BTN}
                  style={btnStil()}
                  disabled={asBusy === k}
                  onClick={() => onAutoStart({ host, code: f.code, fix: f.fix })}
                >
                  {asBusy === k
                    ? '…'
                    : `${f.fix.jvm}: auto-start ${f.fix.action === 'jboss_autostart_on' ? 'AÇ' : 'KAPAT'}`}
                </button>
              );
            })}
          </div>
        )}
        {etiketler.map((e) => {
          const uyg = retirementUygulamasi(e);
          return (
            <div key={e.anahtar} className="flex flex-wrap items-center gap-2">
              <EtiketRozeti b={ETIKET_SEVIYE[e.seviye]} kucuk />
              <span className="font-mono text-[11px]">{konuMetni(e)}</span>
              <span style={{ color: 'var(--text-muted)' }}>
                {kurallarMetni(e.kurallar, retire?.kurallar || [])}
              </span>
              <EtiketRozeti b={KONTROL_DURUM[e.durum]} kucuk />
              {e.retirementHazir && uyg && onRetirementAc ? (
                <button
                  type="button"
                  className={BTN}
                  style={btnStil(true)}
                  onClick={() =>
                    onRetirementAc(
                      uyg,
                      `Server Hub retirement etiketi (${e.kurallar.join(', ')}; ${e.ortam}): ${e.kontrol?.isaretleyen || '?'} doğruladı — ${e.kontrol?.aciklama || ''}`,
                    )
                  }
                >
                  Retirement kaydı aç
                </button>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>
                  {e.durum === 'DOGRULANDI'
                    ? 'doğrulandı'
                    : 'elle kontrol et → “Retirement etiketleri” bölümü'}
                </span>
              )}
            </div>
          );
        })}
      </Bolum>

      <Bolum baslik={`Uygulamalar (${kartlar.length} JVM)`} testId="bolum-uygulamalar">
        <div style={{ color: 'var(--text-muted)' }}>
          kaynak: JVM ve web — {kaynak}; EAR —{' '}
          {d.ear?.taranma
            ? `Uygulama Envanteri ${fmtDateTime(d.ear.taranma)}`
            : 'Uygulama Envanteri verisi yok'}
        </div>
        {kartlar.length === 0 && <div>Bu sunucuda JVM yok.</div>}
        {kartlar.map(({ jvm: j, earlar, katman }) => (
          <div
            key={`${j.gen}|${j.name}`}
            className="rounded-lg border px-3 py-2 space-y-1"
            style={{ borderColor: 'var(--border-subtle)' }}
            data-testid="zincir-karti"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <b className="font-mono text-[11px]">{j.name}</b>
              <span>JBoss {j.gen || '?'}</span>
              <span>{calisma(j)}</span>
              <span>
                auto-start{' '}
                {j.autoStart === 'true'
                  ? 'açık'
                  : j.autoStart === 'false'
                    ? 'kapalı'
                    : 'bilinmiyor'}
              </span>
              {j.argFark === 1 && (
                <span style={{ color: 'var(--status-danger-text)' }}>parametre farkı var</span>
              )}
              {j.argFark === 2 && (
                <span style={{ color: 'var(--text-muted)' }}>parametre farkı ölçülemedi</span>
              )}
              {j.tier && <span style={{ color: 'var(--text-muted)' }}>tier {j.tier}</span>}
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>EAR: </span>
              {earlar.length === 0
                ? d.ear?.durum === 'VAR'
                  ? 'domain.xml / host.xml bu JVM’e EAR bağlamıyor'
                  : 'Uygulama Envanteri verisi yok'
                : earlar
                    .map((u) => `${u.kok}/${u.ad} (${u.warSayisi ?? '?'} WAR, ${u.durum})`)
                    .join(' · ')}
            </div>
            {(() => {
              const dm = deploymentMetni(d, j);
              const renk = {
                kotu: 'var(--status-danger-text)',
                uyari: 'var(--status-warning-text)',
                notr: 'var(--text-muted)',
                bilgi: 'var(--text-primary)',
              }[dm.ton];
              return (
                <div data-testid="deployment-satiri">
                  <span style={{ color: 'var(--text-muted)' }}>Deployment (JBoss CLI): </span>
                  <span style={{ color: renk }}>{dm.metin}</span>
                </div>
              );
            })()}
            <div>
              <span style={{ color: 'var(--text-muted)' }}>
                Web (
                {katman === 'ayni-sunucu'
                  ? 'aynı sunucu'
                  : katman === 'ayri-web'
                    ? 'ayrı web sunucusu'
                    : 'eşlenemedi'}
                ):{' '}
              </span>
              {(j.vhosts || []).length === 0
                ? 'web katmanında eşleşen vhost yok — trafik bilinmiyor'
                : (j.vhosts || []).map((v) => (
                    <span key={`${v.host}|${v.serverName}`} className="font-mono text-[11px] mr-3">
                      {v.host === d.host ? '' : `${v.host}/`}
                      {v.serverName || '?'} → <b>{v.trafficState || '?'}</b>
                      {v.req7d != null && v.req7d >= 0 ? ` (${fmtNumber(v.req7d)} / 7 gün)` : ''}
                    </span>
                  ))}
            </div>
          </div>
        ))}
        {bagsizEarlar.length > 0 && (
          <div>
            <b>Hiçbir JVM’e bağlanmayan EAR’lar:</b>
            <ul className="list-disc ml-5">
              {bagsizEarlar.map((u) => (
                <li key={`${u.kok}/${u.ad}`} className="font-mono text-[11px]">
                  {u.kok}/{u.ad} — {u.warSayisi ?? '?'} WAR ·{' '}
                  {u.xml == null
                    ? 'eşleme ölçülmedi'
                    : u.xml.durum === 'OLCULEMEDI'
                      ? `yapılandırma okunamadı (${u.xml.neden || '?'})`
                      : u.xml.durum === 'JVM_YOK'
                        ? `JVM yok (${u.xml.neden || 'TANIM_YOK'})`
                        : 'eşlendi'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Bolum>

      <Bolum baslik={`Bulgular (${bulgular.length})`} testId="bolum-bulgular">
        {bulgular.length === 0 && <div>Bulgu yok.</div>}
        {bulgular.map((f, i) => (
          <details
            key={f.code + i}
            className="rounded border px-2 py-1"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <summary className="cursor-pointer flex flex-wrap items-center gap-2">
              <SeviyeRozeti s={f.severity} kucuk />
              <span className="font-mono text-[11px]">{f.code}</span>
              <span>{f.text}</span>
            </summary>
            {f.dogrulama ? (
              <div className="mt-1.5 space-y-1" style={{ color: 'var(--text-secondary)' }}>
                <div>
                  <b>Neden:</b> {f.dogrulama.neden}
                </div>
                <div>
                  <b>Ne eksik olabilir:</b> {f.dogrulama.eksik}
                </div>
              </div>
            ) : (
              <div className="mt-1.5" style={{ color: 'var(--text-muted)' }}>
                Bu bulgu için doğrulama metni yok.
              </div>
            )}
          </details>
        ))}
      </Bolum>

      <Bolum baslik={`Retirement etiketleri (${etiketler.length})`} testId="bolum-etiketler">
        {!retire && <div style={{ color: 'var(--text-muted)' }}>Etiketler yükleniyor…</div>}
        {retire && etiketler.length === 0 && <div>Bu sunucuda retirement etiketi yok.</div>}
        {etiketler.map((e) => (
          <AcilirEtiket
            key={e.anahtar}
            e={e}
            kurallar={retire?.kurallar || []}
            onDegisti={onEtiketDegisti}
            onRetirementAc={onRetirementAc}
          />
        ))}
      </Bolum>

      <Bolum baslik={`Doğrulama adımları (${adimlar.length})`} testId="bolum-dogrulama">
        {adimlar.length === 0 && <div>Elle kontrol gerektiren bulgu yok.</div>}
        {adimlar.map((a) => (
          <div key={a.baslik} className="space-y-1">
            <div className="font-semibold">{a.baslik}</div>
            <div style={{ color: 'var(--text-secondary)' }}>
              Ne eksik olabilir: {a.dogrulama.eksik}
            </div>
            {a.komutlar.map((k) => (
              <KomutSatiri key={k} komut={k} />
            ))}
          </div>
        ))}
      </Bolum>
    </div>
  );
}
