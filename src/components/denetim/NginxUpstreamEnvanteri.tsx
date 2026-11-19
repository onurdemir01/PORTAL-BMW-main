// src/components/denetim/NginxUpstreamEnvanteri.tsx — Nginx Hub > "Upstream Envanteri".
//
// Kullanıcı (2026-11-19): "Nginx Envanteri gibi bir envanter daha istiyorum: hangi sunucu herhangi bir
// upstream'a bağlı mı, bağlıysa hangi upstream'e bağlı".
// Kaynak: nginx_audit son taraması (Nginx_Audit_Upstreams / Locations / Servers). "Bağlı" = en az bir
// location'ı proxy_pass ile TANIMLI bir upstream'e gidiyor; tanımlı ama hiç kullanılmayan upstream
// bağlı saymaz, ayrıca "kullanılmayan" sayılır. Upstream'i atlayıp doğrudan DNS adına giden location
// ayrı gösterilir (çalışır ama resolve / keepalive katmanı devre dışı).
// Sunucu başına özet tek istekte; bir sunucunun upstream'leri satır açılınca yüklenir (SPA
// sunucusunda binlerce upstream). Ters arama: arka uç adresi ya da upstream adı -> hangi sunucu.
// Tarama upstream'in TÜM server satırlarını içermiyorsa (eski tarayıcı yalnız SONUNCUYU yazardı)
// eldeki adres "tam liste değil" diye gösterilir; tek arka uç SANILMAZ.
// HTTP/2 (2026-11-19, "upstream envanteri ile http2 envanterini ortaklaştıralım; http2'si açık
// servisleri hızlıca çekmek istiyorum"): sunucu başına açık blok sayısı, "HTTP/2 açık" süzgeci
// (bağlantı süzgeciyle birlikte çalışır) ve CSV'de server_name başına http2 kolonu.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import {
  denetimApi,
  type NginxUpsAramaResult,
  type NginxUpsDetayResult,
  type NginxUpsHost,
  type NginxUpsHttp2,
  type NginxUpsKullanan,
  type NginxUpsOzetResult,
} from '@/api/denetimApi';
import { eskiGizliKaydet } from '@/api/nginxEskiSunucuApi';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { downloadCsv as csvDownload } from '@/utils/csv';
import { OrtamRozeti } from './NginxEnvanteri';
import { Note } from './ui';

const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);
const dosyaAdi = (p: string) => p.split('/').pop() || p;

const NEDEN_METNI: Record<string, string> = {
  tablo:
    'nginx denetim tabloları (dbo.Nginx_Audit_*) yok; bmw_nginx/nginx_audit şeması uygulanmamış.',
  tarama: 'nginx denetim taramasında henüz satır yok.',
};

const TAM_LISTE_YOK =
  'Son tarama upstream’in tüm server satırlarını içermiyor; gösterilen yalnız SON satır. ' +
  'Güncel nginx_audit paketi AWX’e alındıktan sonraki ilk taramayla tam liste gelir.';

type Suzgec = 'hepsi' | 'bagli' | 'bagsiz' | 'olculmedi';

/** CSV değeri (ASCII, filtrelenebilir) */
const HTTP2_CSV: Record<NginxUpsHttp2, string> = {
  acik: 'acik',
  kismen: 'kismen',
  kapali: 'kapali',
  http_degil: 'http_degil',
  olculmedi: 'olculmedi',
};
const HTTP2_YOK =
  'Son tarama HTTP/2 durumunu içermiyor; güncel nginx_audit paketiyle ilk taramadan sonra gelir.';

const btn =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg hover:bg-[var(--bg-elevated)] transition-colors';

function Rozet({
  children,
  ton = 'notr',
  title,
}: {
  children: React.ReactNode;
  ton?: 'iyi' | 'uyari' | 'notr';
  title?: string;
}) {
  const stil =
    ton === 'iyi'
      ? { background: 'var(--status-success-bg)', color: 'var(--status-success)' }
      : ton === 'uyari'
        ? { background: 'var(--status-warning-bg)', color: 'var(--status-warning-text)' }
        : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' };
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold whitespace-nowrap"
      style={stil}
      title={title}
    >
      {children}
    </span>
  );
}

function Kullananlar({ xs }: { xs: NginxUpsKullanan[] }) {
  const [hepsi, setHepsi] = useState(false);
  const SINIR = 4;
  const gor = hepsi ? xs : xs.slice(0, SINIR);
  return (
    <ul className="space-y-0.5">
      {gor.map((k, i) => (
        <li
          key={`${k.confFile}#${k.location}#${i}`}
          className="font-mono text-[11.5px] [overflow-wrap:anywhere]"
          title={k.confFile}
        >
          {k.serverName ? (
            <span style={{ color: 'var(--text-primary)' }}>{k.serverName}</span>
          ) : (
            <span
              style={{ color: 'var(--text-muted)' }}
              title="Bu location'ı içeren dosyayı çeken server bloğu bulunamadı (include zinciri çözülemedi)"
            >
              (server bilinmiyor)
            </span>
          )}
          <span style={{ color: 'var(--text-muted)' }}> · </span>
          {k.location}
        </li>
      ))}
      {xs.length > SINIR && (
        <li>
          <button
            type="button"
            onClick={() => setHepsi((x) => !x)}
            className="text-[11px] underline"
            style={{ color: 'var(--text-secondary)' }}
          >
            {hepsi ? 'daha az' : `+${nf(xs.length - SINIR)} daha`}
          </button>
        </li>
      )}
    </ul>
  );
}

function SunucuUpstreamleri({ host, yenile }: { host: string; yenile: number }) {
  const [veri, setVeri] = useState<NginxUpsDetayResult | null>(null);
  const [hata, setHata] = useState('');
  useEffect(() => {
    let iptal = false;
    denetimApi
      .nginxUpstreamSunucu(host, yenile > 0)
      .then((r) => {
        if (iptal) return;
        if (r.ok && r.hazir) {
          setVeri(r);
          setHata('');
        } else {
          setVeri(null);
          setHata(r.ok ? NEDEN_METNI[r.neden || ''] || 'veri yok' : r.message || 'okunamadı');
        }
      })
      .catch((e: Error) => {
        if (iptal) return;
        setVeri(null);
        setHata(e.message);
      });
    return () => {
      iptal = true;
    };
  }, [host, yenile]);

  if (hata)
    return (
      <p className="px-4 py-2 text-[12px]" style={{ color: 'var(--status-danger)' }}>
        Upstream’ler okunamadı: {hata}
      </p>
    );
  if (!veri)
    return (
      <p className="px-4 py-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
        Yükleniyor…
      </p>
    );
  const ups = veri.upstreams || [];
  const dog = veri.dogrudan || [];
  return (
    <div className="px-4 py-3 space-y-3" data-testid={`ups-detay-${host}`}>
      {ups.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          Bu sunucuda upstream tanımı yok.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th className="text-left font-semibold pr-3 py-1.5">Upstream</th>
                <th className="text-left font-semibold pr-3 py-1.5">Arka uç sunucular</th>
                <th className="text-left font-semibold pr-3 py-1.5">Ayar</th>
                <th className="text-left font-semibold py-1.5">Kullanan server_name · location</th>
              </tr>
            </thead>
            <tbody>
              {ups.map((u) => (
                <tr
                  key={u.ad}
                  className="border-t align-top"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <td className="pr-3 py-1.5">
                    <div className="font-mono font-semibold break-all" title={u.confFile}>
                      {u.ad}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {dosyaAdi(u.confFile)}
                    </div>
                  </td>
                  <td className="pr-3 py-1.5">
                    {u.servers ? (
                      <ul className="space-y-0.5">
                        {u.servers.map((s, i) => (
                          <li key={i} className="font-mono text-[11.5px] break-all">
                            {s}
                          </li>
                        ))}
                        {u.serversKesik > 0 && (
                          <li
                            className="text-[11px]"
                            style={{ color: 'var(--text-muted)' }}
                            title="Kayıt sınırı (2.000 karakter) aşıldı; satırlar konfigürasyonda var, burada gösterilmiyor"
                          >
                            +{nf(u.serversKesik)} satır daha (kayıt sınırı)
                          </li>
                        )}
                      </ul>
                    ) : (
                      <span className="font-mono text-[11.5px] break-all" title={TAM_LISTE_YOK}>
                        {u.sonServer || '—'}{' '}
                        <span className="font-sans" style={{ color: 'var(--text-muted)' }}>
                          (tam liste değil)
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="pr-3 py-1.5">
                    <span className="inline-flex flex-wrap gap-1">
                      <Rozet ton={u.resolve ? 'iyi' : 'uyari'} title="server satırında resolve">
                        resolve {u.resolve ? 'var' : 'yok'}
                      </Rozet>
                      <Rozet ton={u.keepalive ? 'iyi' : 'uyari'}>
                        keepalive {u.keepalive ? 'var' : 'yok'}
                      </Rozet>
                      <Rozet ton={u.zone ? 'iyi' : 'notr'}>zone {u.zone ? 'var' : 'yok'}</Rozet>
                    </span>
                  </td>
                  <td className="py-1.5">
                    {u.kullananlar.length ? (
                      <Kullananlar xs={u.kullananlar} />
                    ) : u.kullaniliyor ? (
                      <Rozet
                        ton="iyi"
                        title="Location'da değil, ör. stream{} server'ında proxy_pass ile kullanılıyor"
                      >
                        kullanılıyor (location dışı)
                      </Rozet>
                    ) : (
                      <Rozet
                        ton="uyari"
                        title="Hiçbir location proxy_pass ile bu upstream'e gitmiyor"
                      >
                        kullanılmıyor
                      </Rozet>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dog.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
            Upstream’i atlayan location’lar ({nf(dog.reduce((s, d) => s + d.kullananlar.length, 0))}
            )
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] border-collapse">
              <tbody>
                {dog.map((d) => (
                  <tr
                    key={`${d.tur}:${d.hedef}`}
                    className="border-t align-top"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <td className="pr-3 py-1.5 font-mono break-all">{d.hedef}</td>
                    <td className="pr-3 py-1.5">
                      {d.tur === 'fqdn' ? (
                        <Rozet title="proxy_pass doğrudan DNS adına gidiyor: çalışır ama resolve / keepalive katmanı devre dışı">
                          doğrudan adres
                        </Rozet>
                      ) : d.tur === 'variable' ? (
                        <Rozet title="Hedef çalışma anında değişkenden çözülür (ör. set $be ...; proxy_pass http://$be). Hangi upstream'e gittiği konfigürasyondan bilinemez.">
                          değişken hedef
                        </Rozet>
                      ) : d.tur === 'unix' ? (
                        <Rozet title="Yerel unix soketine gidiyor">unix soketi</Rozet>
                      ) : (
                        <Rozet ton="uyari" title="Ne tanımlı upstream ne çözümlenebilir ad">
                          tanımsız hedef
                        </Rozet>
                      )}
                    </td>
                    <td className="py-1.5">
                      <Kullananlar xs={d.kullananlar} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TersArama({ yenile }: { yenile: number }) {
  const [q, setQ] = useState('');
  const [sonuc, setSonuc] = useState<NginxUpsAramaResult | null>(null);
  const [bekle, setBekle] = useState(false);
  const [hata, setHata] = useState('');
  const ara = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = q.trim();
    if (t.length < 2) {
      setHata('En az 2 karakter yazın.');
      return;
    }
    setBekle(true);
    setHata('');
    try {
      const r = await denetimApi.nginxUpstreamAra(t, yenile > 0);
      if (!r.ok) setHata(r.message || 'Arama yapılamadı.');
      else if (!r.hazir) setHata(NEDEN_METNI[r.neden || ''] || 'veri yok');
      else setSonuc(r);
    } catch (err: unknown) {
      setHata(err instanceof Error ? err.message : String(err));
    } finally {
      setBekle(false);
    }
  };
  const satirlar = sonuc?.satirlar || [];
  return (
    <section
      className="rounded-xl border"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
    >
      <form onSubmit={ara} className="px-4 py-3 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Arka uca göre ara
        </span>
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="adres ya da upstream adı (ör. app.apps…:443)"
            aria-label="Arka uç adresi ya da upstream adı"
            className="pf-input pl-8 text-xs w-80"
          />
        </div>
        <button
          type="submit"
          disabled={bekle}
          className={btn}
          style={{ borderColor: 'var(--border)' }}
        >
          {bekle ? 'Aranıyor…' : 'Ara'}
        </button>
        <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          Hangi nginx sunucusunun hangi upstream’le bu adrese bağlandığını gösterir.
        </span>
      </form>
      {hata && (
        <p className="px-4 pb-3 text-[12px]" style={{ color: 'var(--status-danger)' }}>
          {hata}
        </p>
      )}
      {sonuc && (
        <div className="border-t overflow-x-auto" style={{ borderColor: 'var(--border-subtle)' }}>
          <p
            className="px-4 py-2 text-[12px]"
            style={{ color: 'var(--text-secondary)' }}
            data-testid="ups-arama-ozet"
          >
            “{sonuc.ara}”: {nf(new Set(satirlar.map((x) => x.host)).size)} sunucu,{' '}
            {nf(satirlar.length)} upstream
            {sonuc.kesildi ? ' (ilk 2.000 satır; aramayı daraltın)' : ''}
            {sonuc.serversOlculdu === false ? ` · ${TAM_LISTE_YOK}` : ''}
          </p>
          {satirlar.length > 0 && (
            <table className="w-full text-[12px] border-collapse" data-testid="ups-arama-tablo">
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left font-semibold px-4 py-1.5">Sunucu</th>
                  <th className="text-left font-semibold px-3 py-1.5">Upstream</th>
                  <th className="text-left font-semibold px-3 py-1.5">Eşleşen arka uç</th>
                  <th className="text-left font-semibold px-3 py-1.5">Kullanımda</th>
                </tr>
              </thead>
              <tbody>
                {satirlar.map((x) => (
                  <tr
                    key={`${x.host}#${x.upstream}`}
                    className="border-t"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <td className="px-4 py-1.5 font-mono">{x.host}</td>
                    <td className="px-3 py-1.5 font-mono break-all">{x.upstream}</td>
                    <td className="px-3 py-1.5 font-mono break-all">
                      {x.eslesen.length ? (
                        x.eslesen.join(', ')
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>(upstream adı eşleşti)</span>
                      )}
                      {!x.tamListe && (
                        <span
                          className="font-sans"
                          style={{ color: 'var(--text-muted)' }}
                          title={TAM_LISTE_YOK}
                        >
                          {' '}
                          (tam liste değil)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {x.kullaniliyor ? (
                        <Rozet ton="iyi">evet</Rozet>
                      ) : (
                        <Rozet ton="uyari">kullanılmıyor</Rozet>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

export function NginxUpstreamEnvanteri() {
  const [veri, setVeri] = useState<NginxUpsOzetResult | null>(null);
  const [hata, setHata] = useState('');
  const [q, setQ] = useState('');
  const [suzgec, setSuzgec] = useState<Suzgec>('hepsi');
  const [ortam, setOrtam] = useState('');
  const [yalnizH2, setYalnizH2] = useState(false);
  const [acik, setAcik] = useState<Set<string>>(() => new Set());
  const [yenile, setYenile] = useState(0);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [indiriliyor, setIndiriliyor] = useState(false);
  const [indirmeNotu, setIndirmeNotu] = useState<{ metin: string; hata: boolean } | null>(null);

  useEffect(() => {
    let iptal = false;
    denetimApi
      .nginxUpstreamOzet(yenile > 0)
      .then(eskiGizliKaydet('upstream'))
      .then((r) => {
        if (iptal) return;
        if (r.ok) {
          setVeri(r);
          setHata('');
        } else setHata(r.message || 'okunamadı');
      })
      .catch((e: Error) => !iptal && setHata(e.message))
      .finally(() => !iptal && setYukleniyor(false));
    return () => {
      iptal = true;
    };
  }, [yenile]);

  const ortamlar = useMemo(
    () => [...new Set((veri?.hosts || []).map((h) => h.ortam))].sort(),
    [veri],
  );
  const satirlar = useMemo(() => {
    const s = q.trim().toUpperCase();
    return (veri?.hosts || []).filter(
      (h: NginxUpsHost) =>
        (suzgec === 'hepsi' ||
          (suzgec === 'bagli' && h.bagli) ||
          (suzgec === 'bagsiz' && !h.bagli && !h.olculmedi) ||
          (suzgec === 'olculmedi' && h.olculmedi)) &&
        (!ortam || h.ortam === ortam) &&
        (!yalnizH2 || (h.http2Acik ?? 0) > 0) &&
        (!s || h.host.includes(s)),
    );
  }, [veri, q, suzgec, ortam, yalnizH2]);

  if (hata && !veri)
    return (
      <Note tone="danger" title="Upstream envanteri okunamadı">
        {hata}
      </Note>
    );
  if (!veri) return <LoadingLogo />;
  if (!veri.hazir || !veri.totals)
    return (
      <Note tone="info" title="Upstream envanteri henüz yok">
        {NEDEN_METNI[veri.neden || ''] || 'Veri yok.'}
      </Note>
    );

  const t = veri.totals;
  const h2Var = t.http2Olculdu === true;
  // DISA AKTARIM (kullanici, 2026-11-19): "sunucu - server name - upstream - upstream endpoint" + http2.
  // Satirlar tum filo icin sunucudan gelir; ekrandaki suzgecler (ortam / baglanti / arama) uygulanir.
  // "HTTP/2 acik" suzgeci seciliyse yalniz HTTP/2'si acik (ya da kismen acik) server_name satirlari.
  const baglantiIndir = async () => {
    setIndiriliyor(true);
    setIndirmeNotu(null);
    try {
      const r = await denetimApi.nginxUpstreamListe(yenile > 0);
      if (!r.ok || !r.hazir) {
        setIndirmeNotu({
          metin: `İndirilemedi: ${r.message || NEDEN_METNI[r.neden || ''] || 'veri yok'}`,
          hata: true,
        });
        return;
      }
      const gorunen = new Set(satirlar.map((h) => h.host));
      const xs = (r.satirlar || []).filter(
        (x) => gorunen.has(x.host) && (!yalnizH2 || x.http2 === 'acik' || x.http2 === 'kismen'),
      );
      csvDownload(
        yalnizH2 ? 'nginx_upstream_http2_acik' : 'nginx_upstream_baglantilari',
        ['sunucu', 'server_name', 'upstream', 'upstream_endpoint', 'http2'],
        xs.map((x) => [
          x.host,
          x.serverName,
          x.upstream,
          x.endpoint,
          x.http2 ? HTTP2_CSV[x.http2] : 'olculmedi',
        ]),
      );
      const eksik = r.eksikUpstream || 0;
      setIndirmeNotu({
        metin:
          `${nf(xs.length)} satır indirildi (${nf(gorunen.size)} sunucu).` +
          (eksik
            ? ` ${nf(eksik)} upstream’in arka uç listesi tam değil (${r.serversOlculdu === false ? 'tarama tüm server satırlarını içermiyor' : 'kayıt sınırında kesik'}); onlar için yalnız bilinen adresler yazıldı.`
            : '') +
          (r.http2Olculdu === false ? ` http2 kolonu boş: ${HTTP2_YOK}` : ''),
        hata: false,
      });
    } catch (e: unknown) {
      setIndirmeNotu({
        metin: `İndirilemedi: ${e instanceof Error ? e.message : String(e)}`,
        hata: true,
      });
    } finally {
      setIndiriliyor(false);
    }
  };
  const ac = (h: string) =>
    setAcik((x) => {
      const y = new Set(x);
      if (y.has(h)) y.delete(h);
      else y.add(h);
      return y;
    });
  const SUZGEC: { id: Suzgec; ad: string; sayi: number }[] = [
    { id: 'hepsi', ad: 'Tümü', sayi: t.hosts },
    { id: 'bagli', ad: 'Upstream’e bağlı', sayi: t.bagli },
    { id: 'bagsiz', ad: 'Bağlı değil', sayi: t.bagliDegil },
    ...(t.olculmedi > 0
      ? [{ id: 'olculmedi' as Suzgec, ad: 'Taranamadı', sayi: t.olculmedi }]
      : []),
  ];

  return (
    <div className="space-y-4">
      {veri.serversOlculdu === false && (
        <Note tone="warning" title="Arka uç listeleri eksik">
          {TAM_LISTE_YOK}
        </Note>
      )}
      <section
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
        data-testid="ups-gorunum"
      >
        <header
          className="px-4 py-3 border-b space-y-2.5"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <p
            className="text-[13px]"
            style={{ color: 'var(--text-primary)' }}
            data-testid="ups-ozet"
          >
            <strong className="tabular-nums">{nf(t.bagli)}</strong> / {nf(t.hosts)} sunucu bir
            upstream’e bağlı
            <span style={{ color: 'var(--text-muted)' }}>
              {' '}
              · {nf(t.upstream)} upstream tanımı · {nf(t.kullanilmayan)} kullanılmıyor
              {t.dogrudanLocation > 0 &&
                ` · ${nf(t.dogrudanLocation)} location upstream’i atlayıp doğrudan adrese gidiyor`}
              {t.tanimsizLocation > 0 &&
                ` · ${nf(t.tanimsizLocation)} location tanımsız hedefe gidiyor`}
              {t.degiskenLocation > 0 &&
                ` · ${nf(t.degiskenLocation)} location değişken hedefe gidiyor`}
            </span>
            <span className="ml-2 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
              nginx denetim taraması {veri.scanDate}
            </span>
          </p>
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="Bağlantı süzgeci"
          >
            {SUZGEC.map((x) => {
              const a = suzgec === x.id;
              return (
                <button
                  key={x.id}
                  type="button"
                  aria-pressed={a}
                  onClick={() => setSuzgec(x.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px]"
                  style={{
                    borderColor: a ? 'var(--accent)' : 'var(--border-subtle)',
                    background: a ? 'var(--accent-bg)' : 'var(--bg-surface)',
                    color: a ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  {x.ad}
                  <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {nf(x.sayi)}
                  </span>
                </button>
              );
            })}
            {h2Var && (
              <button
                type="button"
                aria-pressed={yalnizH2}
                onClick={() => setYalnizH2((x) => !x)}
                title="En az bir server bloğunda HTTP/2 açık olan sunucular; CSV de yalnız HTTP/2'si açık server_name satırlarını verir"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] ml-1"
                style={{
                  borderColor: yalnizH2 ? 'var(--accent)' : 'var(--border-subtle)',
                  background: yalnizH2 ? 'var(--accent-bg)' : 'var(--bg-surface)',
                  color: yalnizH2 ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                HTTP/2 açık
                <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {nf(t.http2Host ?? 0)}
                </span>
              </button>
            )}
            <select
              value={ortam}
              onChange={(e) => setOrtam(e.target.value)}
              aria-label="Ortam"
              className="pf-input text-xs ml-1"
              style={{ width: 'auto' }}
            >
              <option value="">Tüm ortamlar</option>
              {ortamlar.map((o) => (
                <option key={o} value={o}>
                  {o === 'BILINMIYOR' ? 'Kalıp dışı' : o}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="sunucu ara"
                aria-label="Upstream envanteri sunucu ara"
                className="pf-input pl-8 text-xs w-56"
              />
            </div>
            <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {nf(satirlar.length)} / {nf(t.hosts)} sunucu
            </span>
            <span className="ml-auto inline-flex items-center gap-2">
              <button
                type="button"
                onClick={baglantiIndir}
                disabled={indiriliyor}
                className={btn}
                style={{ borderColor: 'var(--border)' }}
                title="Her satır: sunucu · server_name · upstream · upstream endpoint · http2 (ekrandaki süzgeçlerle)"
              >
                <ArrowDownTrayIcon className="w-3.5 h-3.5" />{' '}
                {indiriliyor ? 'Hazırlanıyor…' : 'CSV'}
              </button>
              <button
                type="button"
                onClick={() =>
                  csvDownload(
                    'nginx_upstream_ozet',
                    [
                      'sunucu',
                      'ortam',
                      'bagli',
                      'upstream',
                      'kullanilan',
                      'kullanilmayan',
                      'location_upstream',
                      'location_dogrudan',
                      'location_tanimsiz',
                      'resolve_yok',
                      'keepalive_yok',
                      'http2_acik_blok',
                      'server_blok',
                    ],
                    satirlar.map((h) => [
                      h.host,
                      h.ortam,
                      h.bagli ? 'evet' : 'hayir',
                      String(h.upstream),
                      String(h.kullanilan),
                      String(h.kullanilmayan),
                      String(h.upstreamLocation),
                      String(h.dogrudanLocation),
                      String(h.tanimsizLocation),
                      String(h.resolveYok),
                      String(h.keepaliveYok),
                      h.http2Acik == null ? '' : String(h.http2Acik),
                      h.http2Blok == null ? '' : String(h.http2Blok),
                    ]),
                  )
                }
                className={btn}
                style={{ borderColor: 'var(--border)' }}
                title="Sunucu başına sayılar"
              >
                <ArrowDownTrayIcon className="w-3.5 h-3.5" /> Özet CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  setYukleniyor(true);
                  setYenile((x) => x + 1);
                }}
                className={btn}
                style={{ borderColor: 'var(--border)' }}
              >
                <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin' : ''}`} />{' '}
                Yenile
              </button>
            </span>
          </div>
          {hata && (
            <p className="text-[12px]" style={{ color: 'var(--status-danger)' }}>
              Yenilenemedi: {hata}
            </p>
          )}
          {indirmeNotu && (
            <p
              className="text-[12px]"
              style={{ color: indirmeNotu.hata ? 'var(--status-danger)' : 'var(--text-secondary)' }}
              data-testid="ups-indirme-notu"
            >
              {indirmeNotu.metin}
            </p>
          )}
        </header>
        <div className="relative overflow-auto" style={{ maxHeight: '40rem' }}>
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr>
                {[
                  ['Sunucu', 'left'],
                  ['Ortam', 'left'],
                  ['Bağlantı', 'left'],
                  ['Upstream (kullanılan / tanımlı)', 'right'],
                  ['Location → upstream', 'right'],
                  ['Doğrudan adres', 'right'],
                  ['HTTP/2 (açık / blok)', 'right'],
                ].map(([ad, yon]) => (
                  <th
                    key={ad}
                    className={`sticky top-0 font-semibold px-3 py-2 whitespace-nowrap ${yon === 'right' ? 'text-right' : 'text-left'}`}
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  >
                    {ad}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {satirlar.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-4 text-center"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Eşleşen sunucu yok.
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
                        <OrtamRozeti ortam={h.ortam} />
                      </td>
                      <td className="px-3 py-1.5">
                        {h.bagli ? (
                          <Rozet ton="iyi">bağlı</Rozet>
                        ) : h.olculmedi ? (
                          <Rozet
                            ton="uyari"
                            title="nginx denetim taraması bu sunucuda başarısız ya da nginx kurulu değil: bağlantı ölçülemedi"
                          >
                            taranamadı
                          </Rozet>
                        ) : h.upstream > 0 ? (
                          <Rozet
                            ton="uyari"
                            title="Upstream tanımı var ama hiçbir location kullanmıyor"
                          >
                            tanımlı, kullanılmıyor
                          </Rozet>
                        ) : (
                          <Rozet>bağlı değil</Rozet>
                        )}
                        {h.durum && h.durum !== 'ok' && (
                          <span className="ml-1">
                            <Rozet
                              ton="uyari"
                              title="nginx denetim taraması bu sunucuda başarısız / nginx kurulu değil"
                            >
                              tarama: {h.durum}
                            </Rozet>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        <strong>{nf(h.kullanilan)}</strong>
                        <span style={{ color: 'var(--text-muted)' }}> / {nf(h.upstream)}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {nf(h.upstreamLocation)}
                      </td>
                      <td
                        className="px-3 py-1.5 text-right tabular-nums"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {h.dogrudanLocation ? nf(h.dogrudanLocation) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {h.http2Acik == null || h.http2Blok == null ? (
                          <span style={{ color: 'var(--text-muted)' }} title={HTTP2_YOK}>
                            —
                          </span>
                        ) : (
                          <>
                            <strong>{nf(h.http2Acik)}</strong>
                            <span style={{ color: 'var(--text-muted)' }}> / {nf(h.http2Blok)}</span>
                          </>
                        )}
                      </td>
                    </tr>
                    {genis && (
                      <tr>
                        <td
                          colSpan={7}
                          className="p-0"
                          style={{ background: 'var(--bg-elevated)' }}
                        >
                          <SunucuUpstreamleri host={h.host} yenile={yenile} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <TersArama yenile={yenile} />
    </div>
  );
}
