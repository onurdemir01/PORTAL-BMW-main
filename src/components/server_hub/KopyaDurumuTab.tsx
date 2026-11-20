// src/components/server_hub/KopyaDurumuTab.tsx — Server Hub › Kopya Durumu (2026-11-14).
//
// Kullanıcı: "Bazı JBoss uygulamaları production'da toplam 5 makinede sadece birinde açık." KOPYA_TUTARSIZ
// bulgusu bunu kopya başına ve dağınık söyler; bu sekme kopya grubu (aynı ortam + JBoss nesli + JVM adı)
// başına tek satır verir: "çalışan 1 / 5". Gruplama sunucuda capraz.cjs ile TEK kural (kopya-durumu.cjs).
// Salt okunur: hiçbir şey çalıştırmaz. Bayat / ölçülemeyen kopya "bilinmiyor" (kapalı sayılmaz).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownTrayIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import {
  serverHubApi,
  type ShKopya,
  type ShKopyaDurum,
  type ShKopyaDurumuSonuc,
  type ShKopyaGrubu,
} from '@/api/serverHubApi';
import { fmtNumber } from '@/utils/datetime';
import { downloadCsv } from '@/utils/csv';
import LoadError from '@/components/common/LoadError';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { BTN, btnStil } from './RetireEtiketleri';
import SunucuPaneli from './SunucuPaneli';
import { useSekmeGorunur } from './sekmeGorunurlugu';

const MUTED: React.CSSProperties = { color: 'var(--text-muted)' };
/** Ekranda bir seferde en fazla bu kadar satır (CSV hepsini verir). */
export const KD_SATIR_SINIRI = 500;

/**
 * Durum = renk + BİÇİM (renk körlüğünde de ayrılsın): çalışıyor dolu, kapalı içi boş kalın kenar,
 * bilinmiyor kesik kenar. Renkler tema durum tokenları (açık / koyu temada tanımlı).
 */
export const KD_DURUM: Record<
  ShKopyaDurum,
  { etiket: string; renk: string; dolu: boolean; kenar: 'solid' | 'dashed'; sira: number }
> = {
  calisiyor: {
    etiket: 'çalışıyor',
    renk: 'var(--status-success)',
    dolu: true,
    kenar: 'solid',
    sira: 0,
  },
  kapali: { etiket: 'kapalı', renk: 'var(--status-danger)', dolu: false, kenar: 'solid', sira: 1 },
  bilinmiyor: {
    etiket: 'bilinmiyor',
    renk: 'var(--status-neutral)',
    dolu: false,
    kenar: 'dashed',
    sira: 2,
  },
};
/** Ortam seçeneklerinin sabit sırası (prod önce); listede olmayan ortam sona, ada göre. */
const ORTAM_SIRA = ['PROD', 'QA', 'TEST', 'DEV', 'EDU'];
const ortamNo = (o: string) =>
  ORTAM_SIRA.indexOf(o) < 0 ? ORTAM_SIRA.length : ORTAM_SIRA.indexOf(o);
export const kdOrtamSirala = (o: string[]) =>
  [...o].sort((a, b) => ortamNo(a) - ortamNo(b) || a.localeCompare(b));
/**
 * Bulgular geçişi: KOPYA_TUTARSIZ metni `JBoss<nesil> <JVM>: ...` diye başlar; iki nokta alt dize
 * eşleşmesini (PAY / PAYMENT) keser, ortam grubu prod ile prod dışını ayırır.
 */
export const kdBulguSuzgeci = (g: Pick<ShKopyaGrubu, 'app' | 'gen' | 'env'>) => ({
  code: 'KOPYA_TUTARSIZ',
  q: `JBoss${g.gen} ${g.app}:`,
  envGroup: g.env === 'PROD' ? 'Production' : 'Non-Production',
});

const ESLESME_VARSAYILAN = {
  kural:
    'Aynı ortam + aynı JBoss nesli (7 / 8) + aynı JVM adı (büyük / küçük harf duyarsız), farklı sunucular.',
  kacirabilir:
    'Farklı JVM adıyla kurulmuş kopyalar (ör. PAY1 / PAY2) aynı grup sayılmaz; bu ekran onları ayrı uygulama olarak görür ya da hiç göstermez.',
  aktifPasif:
    'Aktif / pasif (DR) kurgusunda bir kopyanın kapalı durması beklenen olabilir; karar vermeden önce uygulama sahibine sorun.',
  bayat:
    'Bayat sunucudaki ya da çalışması ölçülemeyen kopya “bilinmiyor” sayılır, kapalı sayılmaz ve tutarsızlık kararına girmez.',
  dusen:
    'Son tam taramada hiç görülmeyen (taramadan düşen) sunucudaki kopya toplama girmez; satırda ayrıca “taramadan düştü” diye yazılır (sunucu silinmiş de olabilir).',
  digerSinirlar:
    'JBoss nesli okunamayıp yalnız envanterden (MWAppsInventory) gelen JVM ayrı grup sayılır; ortamı belirlenemeyen (BİLİNMİYOR) ya da ODM sunucuları hiçbir gruba girmez.',
};

export interface KdSuzgec {
  yalnizTutarsiz: boolean;
  env: string;
  gen: string;
  q: string;
}

/** Saf süzgeç (test edilir): tutarsız / ortam / nesil / uygulama ya da sunucu adı. */
export function kdSuz(gruplar: ShKopyaGrubu[], s: KdSuzgec): ShKopyaGrubu[] {
  const n = s.q.trim().toLowerCase();
  return gruplar.filter(
    (g) =>
      (!s.yalnizTutarsiz || g.tutarsiz) &&
      (s.env === 'all' || g.env === s.env) &&
      (s.gen === 'all' || String(g.gen) === s.gen) &&
      (!n ||
        g.app.toLowerCase().includes(n) ||
        g.copies.some((k) => k.host.toLowerCase().includes(n))),
  );
}

const asMetni = (v: string) => (v === 'true' ? 'açık' : v === 'false' ? 'kapalı' : 'bilinmiyor');

/** CSV satırları (test edilir): grup başına bir satır. */
export function kdCsv(gruplar: ShKopyaGrubu[]): {
  baslik: string[];
  satirlar: (string | number)[][];
} {
  return {
    baslik: [
      'Uygulama (JVM)',
      'Ortam',
      'JBoss',
      'Çalışan',
      'Kapalı',
      'Bilinmiyor',
      'Toplam',
      'Tutarsız',
      'Auto-start uyumsuz',
      'Kapalı sunucular',
      'Kopyalar',
      'Retirement',
      'OpenShift',
    ],
    satirlar: gruplar.map((g) => [
      g.app,
      g.env,
      g.gen,
      g.running,
      g.stopped,
      g.unknown,
      g.total,
      g.tutarsiz ? 'evet' : 'hayır',
      g.autoStartUyumsuz,
      g.stoppedHosts.join(' '),
      g.copies
        .map(
          (k) =>
            `${k.host}:${KD_DURUM[k.durum].etiket}/auto-start ${asMetni(k.autoStart)}${k.fresh ? '' : '/bayat'}`,
        )
        .join(' '),
      g.retirement.map((r) => `#${r.kayit}`).join(' '),
      g.ocp.map((o) => `${o.namespace}@${o.cluster}`).join(' '),
    ]),
  };
}

function kopyaBasligi(k: ShKopya) {
  const p = [`${k.host}: ${KD_DURUM[k.durum].etiket}`, `auto-start ${asMetni(k.autoStart)}`];
  if (k.serverState && k.serverState !== 'unknown') p.push(k.serverState);
  if (!k.fresh) p.push(`bayat tarama${k.scanDate ? ` (${k.scanDate})` : ''}`);
  if (k.sapma.includes('autostart')) p.push('auto-start öteki kopyalardan farklı');
  return p.join(' · ');
}

function Parca({ k, kucuk = false }: { k: ShKopya; kucuk?: boolean }) {
  const d = KD_DURUM[k.durum];
  return (
    <span
      data-durum={k.durum}
      title={kopyaBasligi(k)}
      className={`inline-block rounded-sm ${kucuk ? 'h-2 w-2' : 'h-2.5 w-2.5'}`}
      style={{
        background: d.dolu ? d.renk : 'transparent',
        borderWidth: 2,
        borderStyle: d.kenar,
        borderColor: d.renk,
        // auto-start sapan kopya dış çizgiyle işaretlenir
        outline: k.sapma.includes('autostart') ? '1px solid var(--status-warning)' : undefined,
        outlineOffset: 1,
      }}
    />
  );
}

/** Kopya başına bir parça, duruma göre sıralı (çalışan, kapalı, bilinmiyor): oran bir bakışta okunur. */
export function KopyaCubugu({ g }: { g: ShKopyaGrubu }) {
  const sirali = [...g.copies].sort(
    (a, b) => KD_DURUM[a.durum].sira - KD_DURUM[b.durum].sira || a.host.localeCompare(b.host),
  );
  return (
    <span
      className="inline-flex gap-1 align-middle"
      role="img"
      aria-label={`${g.running} çalışıyor, ${g.stopped} kapalı, ${g.unknown} bilinmiyor`}
    >
      {sirali.map((k, i) => (
        <Parca key={`${k.host}-${i}`} k={k} />
      ))}
    </span>
  );
}

function OrtamRozeti({ env }: { env: string }) {
  const prod = env === 'PROD';
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold border"
      style={{
        background: prod ? 'var(--status-danger-bg)' : 'var(--bg-elevated)',
        color: prod ? 'var(--status-danger-text)' : 'var(--text-secondary)',
        borderColor: prod ? 'var(--status-danger)' : 'var(--border-subtle)',
      }}
    >
      {env}
    </span>
  );
}

export default function KopyaDurumuTab({
  onGoFindings,
  onRetirement,
}: {
  /** Bulgular sekmesine KOPYA_TUTARSIZ + uygulama adı süzgeciyle geçiş. */
  onGoFindings?: (f: { code: string; q: string; envGroup: string }) => void;
  /** BMW Hub › Retirement sayfası (liste; belirli kaydı açan derin bağlantı yok). */
  onRetirement?: () => void;
}) {
  const gorunur = useSekmeGorunur();
  const [veri, setVeri] = useState<ShKopyaDurumuSonuc | null>(null);
  const [hata, setHata] = useState('');
  const [yuk, setYuk] = useState(false);
  const [s, setS] = useState<KdSuzgec>({ yalnizTutarsiz: true, env: 'all', gen: 'all', q: '' });
  const [acik, setAcik] = useState<string | null>(null);
  const [host, setHost] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Panel tablonun altında açılır: görünür alana kaydır (500 satırda tıklama boşa gitmiş gibi durmasın).
  useEffect(() => {
    if (host) panelRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [host]);
  const sunucuAc = (h: string) => setHost((x) => (x === h ? null : h));
  const yukle = useCallback(async (fresh = false) => {
    setYuk(true);
    try {
      const r = await serverHubApi.kopyaDurumu(fresh);
      if (r.ok) {
        setVeri(r);
        setHata('');
      } else setHata(r.message || 'Kopya durumu okunamadı.');
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setYuk(false);
    }
  }, []);
  useAsyncEffect(async () => {
    if (gorunur && !veri && !hata) await yukle();
  }, [gorunur, veri, hata, yukle]);
  const gruplar = useMemo(() => veri?.gruplar || [], [veri]);
  const ortamlar = useMemo(() => kdOrtamSirala([...new Set(gruplar.map((g) => g.env))]), [gruplar]);
  const satirlar = useMemo(() => kdSuz(gruplar, s), [gruplar, s]);
  const gosterilen = satirlar.slice(0, KD_SATIR_SINIRI);
  const csvIndir = () => {
    const c = kdCsv(satirlar);
    downloadCsv('server-hub_kopya-durumu', c.baslik, c.satirlar);
  };

  if (!veri && hata)
    return (
      <LoadError
        title="Kopya durumu okunamadı"
        message={hata}
        onRetry={() => setHata('')}
        retrying={yuk}
      />
    );
  if (!veri)
    return (
      <div className="py-10 flex justify-center">
        <LoadingLogo />
      </div>
    );
  const e = veri.eslesme || ESLESME_VARSAYILAN;
  const oz = veri.ozet;
  return (
    <div className="space-y-3" data-testid="kopya-durumu">
      <div className="text-xs space-y-1" style={MUTED}>
        <p>
          Aynı uygulamanın kopyaları kaç sunucuda çalışıyor? Kopya grubu: {e.kural} Yalnız iki ya da
          daha çok sunucuya yayılan gruplar listelenir.
        </p>
        <p>
          {e.aktifPasif} {e.bayat}
        </p>
        <p>
          <b>Eşleşme sınırı:</b> {e.kacirabilir}{' '}
          {e.digerSinirlar || ESLESME_VARSAYILAN.digerSinirlar}{' '}
          {e.dusen || ESLESME_VARSAYILAN.dusen}
        </p>
        {veri.capraz && (veri.capraz.ocp?.okunamadi || veri.capraz.retirement?.okunamadi) && (
          <p data-testid="kopya-kaynak-notu">
            {[
              veri.capraz.ocp?.okunamadi && 'OpenShift',
              veri.capraz.retirement?.okunamadi && 'Retirement',
            ]
              .filter(Boolean)
              .join(' ve ')}{' '}
            kaynağı okunamadı: bu bağlantılar eksik olabilir.
          </p>
        )}
      </div>
      {hata && (
        <div
          role="alert"
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: 'var(--status-danger)',
            background: 'var(--status-danger-bg)',
            color: 'var(--status-danger-text)',
          }}
        >
          Yenileme başarısız: {hata}. Gösterilen veri {veri.latestScan || 'önceki okuma'}{' '}
          taramasından.
        </div>
      )}
      {veri.staleFleet && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: 'var(--status-warning)',
            background: 'var(--status-warning-bg)',
            color: 'var(--status-warning-text)',
          }}
        >
          Tarama verisi bayat: hiçbir sunucu taze değil, bütün kopyalar “bilinmiyor” sayılır.
        </div>
      )}
      {veri.tableMissing ? (
        <div className="text-xs" style={MUTED}>
          Server Hub tarama tabloları yok: önce günlük tarama çalışmalı.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex gap-1" role="group" aria-label="Hızlı süzgeç">
              {(
                [
                  { v: true, etiket: 'Tutarsız', n: oz?.tutarsiz ?? 0 },
                  { v: false, etiket: 'Hepsi', n: oz?.grup ?? gruplar.length },
                ] as const
              ).map((b) => (
                <button
                  key={b.etiket}
                  type="button"
                  aria-pressed={s.yalnizTutarsiz === b.v}
                  onClick={() => setS((x) => ({ ...x, yalnizTutarsiz: b.v }))}
                  className="px-2.5 py-1 rounded-lg border"
                  style={{
                    borderColor:
                      s.yalnizTutarsiz === b.v ? 'var(--accent)' : 'var(--border-subtle)',
                    background:
                      s.yalnizTutarsiz === b.v ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                  }}
                >
                  {b.etiket} <b className="tabular-nums">{fmtNumber(b.n)}</b>
                </button>
              ))}
            </div>
            {oz && oz.prodTutarsiz > 0 && (
              <button
                type="button"
                className="underline decoration-dotted font-semibold"
                style={{ color: 'var(--status-danger-text)' }}
                onClick={() => setS((x) => ({ ...x, yalnizTutarsiz: true, env: 'PROD' }))}
                title="Yalnız PROD'daki tutarsız grupları göster"
              >
                PROD’da {fmtNumber(oz.prodTutarsiz)} tutarsız grup
              </button>
            )}
            <label className="flex items-center gap-1">
              Ortam
              <select
                aria-label="Ortam"
                value={s.env}
                onChange={(ev) => setS((x) => ({ ...x, env: ev.target.value }))}
                className="h-7 rounded-lg border px-1"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
              >
                <option value="all">hepsi</option>
                {ortamlar.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              JBoss
              <select
                aria-label="JBoss nesli"
                value={s.gen}
                onChange={(ev) => setS((x) => ({ ...x, gen: ev.target.value }))}
                className="h-7 rounded-lg border px-1"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
              >
                <option value="all">hepsi</option>
                <option value="7">7</option>
                <option value="8">8</option>
              </select>
            </label>
            <input
              type="search"
              aria-label="Uygulama ya da sunucu ara"
              placeholder="uygulama ya da sunucu ara"
              value={s.q}
              onChange={(ev) => setS((x) => ({ ...x, q: ev.target.value }))}
              className="h-7 rounded-lg border px-2 min-w-[12rem]"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            />
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className={BTN}
                style={btnStil()}
                onClick={csvIndir}
                disabled={!satirlar.length}
              >
                <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
              </button>
              <button
                type="button"
                className={BTN}
                style={btnStil()}
                onClick={() => void yukle(true)}
                disabled={yuk}
              >
                <ArrowPathIcon className={`w-3.5 h-3.5 ${yuk ? 'animate-spin' : ''}`} /> Yenile
              </button>
            </span>
          </div>
          {!satirlar.length ? (
            <div className="text-xs py-4" style={MUTED}>
              {gruplar.length
                ? s.yalnizTutarsiz && !s.q && s.env === 'all' && s.gen === 'all'
                  ? 'Tutarsız kopya grubu yok: her grupta kopyalar aynı durumda.'
                  : 'Süzgeçle eşleşen kopya grubu yok.'
                : 'Birden çok sunucuya yayılan kopya grubu yok.'}
            </div>
          ) : (
            <div
              className="overflow-x-auto rounded-lg border"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <table className="w-full text-xs">
                <thead>
                  <tr
                    className="text-left"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  >
                    <th className="px-2 py-1.5 font-medium">Uygulama (JVM)</th>
                    <th className="px-2 py-1.5 font-medium">Ortam</th>
                    <th className="px-2 py-1.5 font-medium">Çalışan</th>
                    <th className="px-2 py-1.5 font-medium">Kapalı sunucular</th>
                    <th className="px-2 py-1.5 font-medium">Auto-start</th>
                    <th className="px-2 py-1.5 font-medium">Bağlantılar</th>
                  </tr>
                </thead>
                <tbody>
                  {gosterilen.map((g) => (
                    <React.Fragment key={g.anahtar}>
                      <tr
                        className="border-t align-top"
                        style={{ borderColor: 'var(--border-subtle)' }}
                        data-testid="kopya-satiri"
                      >
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            aria-expanded={acik === g.anahtar}
                            onClick={() => setAcik((a) => (a === g.anahtar ? null : g.anahtar))}
                            className="font-mono font-semibold text-left"
                            title="Kopyaları göster"
                          >
                            {g.app}
                          </button>{' '}
                          <span style={MUTED}>JBoss {g.gen}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          <OrtamRozeti env={g.env} />
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span className="tabular-nums font-semibold">
                            çalışan {g.running} / {g.total}
                          </span>{' '}
                          <KopyaCubugu g={g} />
                          {g.unknown > 0 && (
                            <span
                              className="ml-1"
                              style={MUTED}
                              title="Bayat ya da ölçülemeyen kopya: kapalı sayılmadı"
                            >
                              · {g.unknown} bilinmiyor
                            </span>
                          )}
                          {!!g.dusen?.length && (
                            <span
                              className="ml-1"
                              style={MUTED}
                              title={`Toplama girmedi (son tam taramada görülmedi): ${g.dusen
                                .map((d) => `${d.host}${d.scanDate ? ` (son ${d.scanDate})` : ''}`)
                                .join(', ')}`}
                            >
                              · +{g.dusen.length} taramadan düştü
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {g.stoppedHosts.length ? (
                            <span className="font-mono">
                              {g.stoppedHosts.map((h, i) => (
                                <React.Fragment key={h}>
                                  {i > 0 && ' '}
                                  <button
                                    type="button"
                                    className="underline decoration-dotted"
                                    onClick={() => sunucuAc(h)}
                                    title="Sunucu ayrıntısı"
                                  >
                                    {h}
                                  </button>
                                </React.Fragment>
                              ))}
                            </span>
                          ) : (
                            <span style={MUTED}>—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {g.autoStartUyumsuz > 0 ? (
                            <span
                              className="inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold border"
                              style={{
                                background: 'var(--status-warning-bg)',
                                color: 'var(--status-warning-text)',
                                borderColor: 'var(--status-warning)',
                              }}
                              title={`auto-start açık ${g.autoStartAcik}, kapalı ${g.autoStartKapali}`}
                            >
                              {g.autoStartUyumsuz} kopya farklı
                            </span>
                          ) : (
                            <span style={MUTED}>uyumlu</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                            {onGoFindings && g.tutarsiz && (
                              <button
                                type="button"
                                className="underline decoration-dotted"
                                onClick={() => onGoFindings(kdBulguSuzgeci(g))}
                              >
                                Bulgular
                              </button>
                            )}
                            {g.retirement.map((r) =>
                              onRetirement ? (
                                <button
                                  key={r.kayit}
                                  type="button"
                                  className="underline decoration-dotted"
                                  onClick={onRetirement}
                                  title={`Retirement sayfasını açar; kayıt #${r.kayit} (${r.durum}) listede aranır`}
                                >
                                  Retirement #{r.kayit}
                                </button>
                              ) : (
                                <span key={r.kayit}>Retirement #{r.kayit}</span>
                              ),
                            )}
                            {g.ocp.length > 0 && (
                              <span
                                style={MUTED}
                                title={g.ocp.map((o) => `${o.namespace} @ ${o.cluster}`).join(', ')}
                              >
                                OpenShift: {g.ocp[0].namespace}
                                {g.ocp.length > 1 ? ` +${g.ocp.length - 1}` : ''}
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                      {acik === g.anahtar && (
                        <tr style={{ background: 'var(--bg-elevated)' }}>
                          <td colSpan={6} className="px-2 py-1.5">
                            <ul className="flex flex-wrap gap-x-4 gap-y-1">
                              {g.copies.map((k, i) => (
                                <li key={`${k.host}-${i}`} className="flex items-center gap-1">
                                  <Parca k={k} kucuk />
                                  <button
                                    type="button"
                                    className="font-mono underline decoration-dotted"
                                    onClick={() => sunucuAc(k.host)}
                                    title="Sunucu ayrıntısı"
                                  >
                                    {k.host}
                                  </button>
                                  <span style={MUTED}>
                                    {kopyaBasligi(k).replace(`${k.host}: `, '')}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {satirlar.length > KD_SATIR_SINIRI && (
            <div className="text-xs" style={MUTED}>
              İlk {fmtNumber(KD_SATIR_SINIRI)} grup gösteriliyor ({fmtNumber(satirlar.length)}{' '}
              grup); hepsi için CSV.
            </div>
          )}
          {host && (
            <div data-testid="kopya-durumu-panel" className="space-y-1" ref={panelRef}>
              <div className="flex justify-end">
                <button
                  type="button"
                  className={BTN}
                  style={btnStil()}
                  onClick={() => setHost(null)}
                >
                  Kapat
                </button>
              </div>
              <SunucuPaneli
                key={host}
                host={host}
                retire={null}
                onEtiketDegisti={() => undefined}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
