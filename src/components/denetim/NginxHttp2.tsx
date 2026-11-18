// src/components/denetim/NginxHttp2.tsx — Nginx Hub > Envanter > "HTTP/2".
//
// Kullanıcı (2026-11-18): "bizim Nginx Envanterine http2 açık olan konfigürasyonları da işleyebilir miyiz".
// Kaynak: dbo.Nginx_Audit_Servers.http2 / http2_source (bmw_nginx/nginx_audit, son tarama). Değer
// nginx'in kendi kuralıyla hesaplanan ETKİN durumdur; yalnız `listen … http2`'ye bakmak yeni SPA
// şablonundaki `http2 on;` satırını kaçırırdı. Kaynaklar KAYNAK_METNI'nde.
// Ölçülmeyen blok (eski tarama satırı / bağlamı çözülemeyen `http2` ya da `listen`) "kapalı" SAYILMAZ,
// ayrı gösterilir. stream{} / mail{} blokları HTTP değildir ("HTTP değil"), kapalı sayılmaz.
// Envanter'in "Yenile"si bu görünümü de önbelleği atlayarak tazeler (`yenile` sayacı). Önbellek YALNIZ
// bileşen açıkken sayaç değişince atlanır: sekmeye dönüş / satır açma önbellekten okur (her geçişte
// ?fresh=1 göndermek Nginx_Audit_Servers'a her seferinde GROUP BY attırırdı).
// Sunucu başına sayım tek istekte gelir; bir sunucunun blokları satır açılınca yüklenir (filo
// binlerce server bloğu).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import {
  denetimApi,
  type NginxHttp2Host,
  type NginxHttp2Kaynak,
  type NginxHttp2OzetResult,
  type NginxHttp2Satir,
} from '@/api/denetimApi';
import { eskiGizliKaydet } from '@/api/nginxEskiSunucuApi';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { downloadCsv as csvDownload } from '@/utils/csv';
import { Note } from './ui';

const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

export const HTTP2_KAYNAK_SIRA: NginxHttp2Kaynak[] = [
  'server',
  'listen',
  'http',
  'socket',
  'default',
];

export const KAYNAK_METNI: Record<NginxHttp2Kaynak, { ad: string; ipucu: string }> = {
  server: {
    ad: 'http2 on',
    ipucu: 'Server bloğunda `http2 on;` (nginx 1.25.1 ve sonrası; yeni SPA şablonu böyle).',
  },
  listen: {
    ad: 'listen … http2',
    ipucu: 'Bloğun kendi `listen … http2` parametresi (eski biçim).',
  },
  http: {
    ad: "http{}'den miras",
    ipucu: 'Blokta `http2` satırı yok; `http2 on;` http{} düzeyinden geliyor.',
  },
  socket: {
    ad: 'aynı soket',
    ipucu:
      'Bu blokta HTTP/2 yazmıyor, ama aynı adres:port’u dinleyen başka bir blokta `listen … http2` var. ' +
      'Eski parametre soketin özelliğidir: o soketteki her blok HTTP/2 olur.',
  },
  default: {
    ad: 'varsayılan sunucudan',
    ipucu:
      'TLS’siz soket (h2c): bağlantıda SNI yok, HTTP/2 kararını o adres:port’un varsayılan sunucusu verir ' +
      've onda `http2` açık.',
  },
};

const NEDEN_METNI: Record<string, string> = {
  tablo:
    'nginx denetim tabloları (dbo.Nginx_Audit_*) yok; bmw_nginx/nginx_audit şeması uygulanmamış.',
  tarama: 'nginx denetim taramasında henüz satır yok.',
  kolon:
    'Son nginx denetim taraması HTTP/2 bilgisini içermiyor. Güncel nginx_audit paketi AWX’e alındıktan sonraki ilk taramayla dolacak.',
};

/** Tek bloğun durumu: Açık (kaynak) · Kapalı · Ölçülmedi. */
export function Http2Durum({
  http2,
  kaynak,
  httpDisi = null,
}: {
  http2: boolean | null;
  kaynak: NginxHttp2Kaynak | null;
  httpDisi?: string | null;
}) {
  if (http2 === null)
    return (
      <span
        className="text-[11.5px]"
        style={{ color: 'var(--text-muted)' }}
        title="Eski tarama satırı ya da bağlamı çözülemeyen `http2` / `listen` (include satırı bulunamadı)"
      >
        ölçülmedi
      </span>
    );
  if (!http2 && httpDisi)
    return (
      <span
        className="text-[11.5px]"
        style={{ color: 'var(--text-muted)' }}
        title={`${httpDisi}{} bloğu: HTTP değil, HTTP/2 uygulanmaz`}
      >
        HTTP değil ({httpDisi})
      </span>
    );
  if (!http2)
    return (
      <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
        kapalı
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className="px-1.5 py-0.5 rounded text-[10.5px] font-semibold"
        style={{ background: 'var(--status-success-bg)', color: 'var(--status-success)' }}
      >
        HTTP/2
      </span>
      {kaynak && (
        <span
          className="text-[11.5px]"
          style={{ color: 'var(--text-secondary)' }}
          title={KAYNAK_METNI[kaynak].ipucu}
        >
          {KAYNAK_METNI[kaynak].ad}
        </span>
      )}
    </span>
  );
}

function SunucuBloklari({ host, yenile }: { host: string; yenile: number }) {
  const [satirlar, setSatirlar] = useState<NginxHttp2Satir[] | null>(null);
  const [hata, setHata] = useState('');
  const ilkYenile = useRef(yenile);
  useEffect(() => {
    let iptal = false;
    denetimApi
      .nginxHttp2Sunucu(host, yenile !== ilkYenile.current)
      .then((r) => {
        if (iptal) return;
        if (r.ok && r.hazir) {
          setSatirlar(r.satirlar || []);
          setHata('');
        } else {
          setSatirlar(null);
          setHata(r.ok ? NEDEN_METNI[r.neden || ''] || 'veri yok' : r.message || 'okunamadı');
        }
      })
      .catch((e: Error) => {
        if (iptal) return;
        setSatirlar(null);
        setHata(e.message);
      });
    return () => {
      iptal = true;
    };
  }, [host, yenile]);
  if (hata)
    return (
      <p className="px-4 py-2 text-[12px]" style={{ color: 'var(--status-danger)' }}>
        Bloklar okunamadı: {hata}
      </p>
    );
  if (!satirlar)
    return (
      <p className="px-4 py-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
        Yükleniyor…
      </p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] border-collapse" data-testid={`http2-bloklar-${host}`}>
        <thead>
          <tr style={{ color: 'var(--text-muted)' }}>
            <th className="text-left font-semibold px-4 py-1.5">Konfigürasyon</th>
            <th className="text-left font-semibold px-3 py-1.5">server_name</th>
            <th className="text-left font-semibold px-3 py-1.5">listen</th>
            <th className="text-left font-semibold px-3 py-1.5">TLS</th>
            <th className="text-left font-semibold px-3 py-1.5">HTTP/2</th>
          </tr>
        </thead>
        <tbody>
          {satirlar.map((s) => (
            <tr
              key={`${s.confFile}#${s.seq}`}
              className="border-t"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <td className="px-4 py-1.5 font-mono text-[11.5px] break-all" title={s.confFile}>
                {s.confFile.split('/').pop() || s.confFile}
              </td>
              <td className="px-3 py-1.5 font-mono text-[11.5px] break-all">
                {s.serverName || '—'}
              </td>
              <td className="px-3 py-1.5 font-mono text-[11.5px] break-all">{s.listen || '—'}</td>
              <td className="px-3 py-1.5">{s.ssl ? 'var' : 'yok'}</td>
              <td className="px-3 py-1.5">
                <Http2Durum http2={s.http2} kaynak={s.kaynak} httpDisi={s.httpDisi} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * @param ortamRozeti sunucu adı -> ortam rozeti (Envanter'de olmayan sunucu için null)
 * @param yenile Envanter "Yenile" sayacı: her artışta önbelleği atlayarak yeniden okunur
 */
export function NginxHttp2({
  ortamRozeti,
  yenile = 0,
}: {
  ortamRozeti: (host: string) => React.ReactNode;
  yenile?: number;
}) {
  const [veri, setVeri] = useState<NginxHttp2OzetResult | null>(null);
  const [hata, setHata] = useState('');
  const [q, setQ] = useState('');
  const [yalnizAcik, setYalnizAcik] = useState(true);
  const [acik, setAcik] = useState<Set<string>>(() => new Set());
  const ilkYenile = useRef(yenile);

  useEffect(() => {
    let iptal = false;
    denetimApi
      .nginxHttp2Ozet(yenile !== ilkYenile.current)
      .then(eskiGizliKaydet('envanterHttp2'))
      .then((r) => {
        if (iptal) return;
        if (r.ok) {
          setVeri(r);
          setHata('');
        } else setHata(r.message || 'okunamadı');
      })
      .catch((e: Error) => !iptal && setHata(e.message));
    return () => {
      iptal = true;
    };
  }, [yenile]);

  const satirlar = useMemo(() => {
    const s = q.trim().toUpperCase();
    return (veri?.hosts || []).filter(
      (h: NginxHttp2Host) => (!yalnizAcik || h.acik > 0) && (!s || h.host.includes(s)),
    );
  }, [veri, q, yalnizAcik]);

  if (hata)
    return (
      <Note tone="danger" title="HTTP/2 durumu okunamadı">
        {hata}
      </Note>
    );
  if (!veri) return <LoadingLogo />;
  if (!veri.hazir || !veri.totals)
    return (
      <Note tone="info" title="HTTP/2 bilgisi henüz yok">
        {NEDEN_METNI[veri.neden || ''] || 'Veri yok.'}
      </Note>
    );

  const t = veri.totals;
  const ac = (h: string) =>
    setAcik((x) => {
      const y = new Set(x);
      if (y.has(h)) y.delete(h);
      else y.add(h);
      return y;
    });

  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      data-testid="http2-gorunum"
    >
      <header
        className="px-4 py-3 border-b space-y-2.5"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <p
          className="text-[13px]"
          style={{ color: 'var(--text-primary)' }}
          data-testid="http2-ozet"
        >
          <strong className="tabular-nums">{nf(t.hostsAcik)}</strong> sunucuda{' '}
          <strong className="tabular-nums">{nf(t.acik)}</strong> / {nf(t.bloklar)} server bloğunda
          HTTP/2 açık
          {t.olculmedi > 0 && (
            <span style={{ color: 'var(--text-muted)' }}>
              {' '}
              · {nf(t.olculmedi)} blok ölçülmedi ({nf(t.hostsOlculmedi)} sunucu)
            </span>
          )}
          {t.httpDisi > 0 && (
            <span style={{ color: 'var(--text-muted)' }}>
              {' '}
              · {nf(t.httpDisi)} stream/mail bloğu (HTTP değil)
            </span>
          )}
          <span className="ml-2 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            nginx denetim taraması {veri.scanDate}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="HTTP/2 kaynakları">
          {HTTP2_KAYNAK_SIRA.map((k) => (
            <span
              key={k}
              title={KAYNAK_METNI[k].ipucu}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px]"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              {KAYNAK_METNI[k].ad}
              <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {nf(t.kaynak[k])}
              </span>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="sunucu ara"
              aria-label="HTTP/2 sunucu ara"
              className="pf-input pl-8 text-xs w-56"
            />
          </div>
          <label
            className="inline-flex items-center gap-1.5 text-[12px]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <input
              type="checkbox"
              checked={yalnizAcik}
              onChange={(e) => setYalnizAcik(e.target.checked)}
            />
            Yalnız HTTP/2 açık olanlar
          </label>
          <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {nf(satirlar.length)} / {nf(t.hosts)} sunucu
          </span>
          <button
            type="button"
            onClick={() =>
              csvDownload(
                'nginx_http2',
                [
                  'sunucu',
                  'server_blogu',
                  'http2_acik',
                  'kapali',
                  'olculmedi',
                  'http_degil',
                  ...HTTP2_KAYNAK_SIRA.map((k) => `kaynak_${k}`),
                ],
                satirlar.map((h) => [
                  h.host,
                  String(h.toplam),
                  String(h.acik),
                  String(h.kapali),
                  String(h.olculmedi),
                  String(h.httpDisi),
                  ...HTTP2_KAYNAK_SIRA.map((k) => String(h.kaynak[k])),
                ]),
              )
            }
            className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg hover:bg-[var(--bg-elevated)] transition-colors"
            style={{ borderColor: 'var(--border)' }}
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </header>
      <div className="relative overflow-auto" style={{ maxHeight: '40rem' }}>
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
              <th
                className="sticky top-0 text-left font-semibold px-3 py-2"
                style={{ background: 'var(--bg-elevated)' }}
              >
                Sunucu
              </th>
              <th
                className="sticky top-0 text-left font-semibold px-3 py-2"
                style={{ background: 'var(--bg-elevated)' }}
              >
                Ortam
              </th>
              <th
                className="sticky top-0 text-right font-semibold px-3 py-2"
                style={{ background: 'var(--bg-elevated)' }}
              >
                HTTP/2 açık
              </th>
              <th
                className="sticky top-0 text-left font-semibold px-3 py-2"
                style={{ background: 'var(--bg-elevated)' }}
              >
                Kaynak
              </th>
              <th
                className="sticky top-0 text-right font-semibold px-3 py-2"
                style={{ background: 'var(--bg-elevated)' }}
              >
                Ölçülmedi
              </th>
            </tr>
          </thead>
          <tbody>
            {satirlar.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-4 text-center"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {yalnizAcik ? 'HTTP/2 açık sunucu yok.' : 'Eşleşen sunucu yok.'}
                </td>
              </tr>
            )}
            {satirlar.map((h) => {
              const genis = acik.has(h.host);
              const Ok = genis ? ChevronDownIcon : ChevronRightIcon;
              return (
                <React.Fragment key={h.host}>
                  <tr className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => ac(h.host)}
                        aria-expanded={genis}
                        className="inline-flex items-center gap-1 font-mono hover:text-[var(--accent)]"
                      >
                        <Ok className="w-3.5 h-3.5" aria-hidden="true" />
                        {h.host}
                      </button>
                    </td>
                    <td className="px-3 py-1.5">
                      {ortamRozeti(h.host) ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      <strong>{nf(h.acik)}</strong>
                      <span style={{ color: 'var(--text-muted)' }}> / {nf(h.toplam)}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex flex-wrap gap-1">
                        {HTTP2_KAYNAK_SIRA.filter((k) => h.kaynak[k] > 0).map((k) => (
                          <span
                            key={k}
                            title={KAYNAK_METNI[k].ipucu}
                            className="px-1.5 py-0.5 rounded border text-[11px] whitespace-nowrap"
                            style={{
                              borderColor: 'var(--border-subtle)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {KAYNAK_METNI[k].ad}{' '}
                            <span className="tabular-nums">{nf(h.kaynak[k])}</span>
                          </span>
                        ))}
                      </span>
                    </td>
                    <td
                      className="px-3 py-1.5 text-right tabular-nums"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {h.olculmedi ? nf(h.olculmedi) : '—'}
                    </td>
                  </tr>
                  {genis && (
                    <tr>
                      <td colSpan={5} className="p-0" style={{ background: 'var(--bg-elevated)' }}>
                        <SunucuBloklari host={h.host} yenile={yenile} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p
        className="px-4 py-2 border-t text-[11.5px]"
        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
      >
        Konfigürasyondan hesaplanır (nginx -T); istemcinin gerçekten HTTP/2 ile konuştuğu ölçülmez.
      </p>
    </section>
  );
}
