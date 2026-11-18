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
  const [acik, setAcik] = useState<Set<string>>(() => new Set());
  const [yenile, setYenile] = useState(0);
  const [yukleniyor, setYukleniyor] = useState(true);

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
        (!s || h.host.includes(s)),
    );
  }, [veri, q, suzgec, ortam]);

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
                onClick={() =>
                  csvDownload(
                    'nginx_upstream_envanteri',
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
                    ]),
                  )
                }
                className={btn}
                style={{ borderColor: 'var(--border)' }}
              >
                <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
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
                    colSpan={6}
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
                    </tr>
                    {genis && (
                      <tr>
                        <td
                          colSpan={6}
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
