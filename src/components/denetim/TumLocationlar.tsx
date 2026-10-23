// src/components/denetim/TumLocationlar.tsx — Production SPA Taşımaları: eski sunuculardaki TÜM
// location'lar (kullanıcı, 2026-10-18).
//
// "SPA kuralı arama, direkt ne kadar location var ve hangileri yoksa hepsini bana göster. İsim
// standardına uymayıp taşımadıklarımız çok büyük problem oluyor." Uygulama tablosu SPA ad
// kalıbına (-app-v / -app-emb-v) göre kuruluyor; kalıba uymayan hedefler katlanır "SPA olmayan
// hedefler" listesinde duruyor, yeni sunucuda olmadıkları HİÇBİR YERDE "eksik" diye görünmüyordu.
// Bu liste AD KALIBINA BAKMAZ: eski sunucudaki her location yeni sunuculardaki tanım durumuyla tek
// satır. Sınıf bilgi içindir; varsayılan görünüm "yeni sunucularda olmayan / kısmen olan".
//
// İKİ KAYNAK (aynı gün, kullanıcı: "/consent-mng/, /domestic-trf/ tanımları var ama ekrana
// yansımıyor"): config taraması yalnız proxy_pass / include taşıyan ve satır kalıbına uyan
// location'ları kaydediyordu (iç içe `if` bloğu olan location kayboluyordu). Liste artık nginx -T
// taramasını da okur; yalnız orada görünen satır "config taramasında yok" rozetiyle işaretlenir —
// neden önceden hiçbir ekranda olmadığı görünsün. Yalnız yeni sunucularda olan location'lar da
// ayrı süzgeçle görülebilir (taşıma açığı değil, sayıma girmez).
//
// Hesap sunucuda (server/audit/nginx-migration.cjs, group.locations); burada süzme ve gösterim.
import React, { useMemo, useState } from 'react';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import type {
  NginxMigrationGroup,
  NginxMigrationLocation,
  NginxMigrationLocSinif,
} from '@/api/denetimApi';
import { downloadCsv } from '@/utils/csv';
import { kismiEtiket } from './yukPencere';
import { Pill, type Tone } from './ui';

const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

export const LOC_SINIF: Record<NginxMigrationLocSinif, { label: string; tone: Tone; hint: string }> =
  {
    'spa-disi': {
      label: 'ad kalıbına uymuyor',
      tone: 'warning',
      hint: 'Hedefin adı -app-v / -app-emb-v kalıbında değil; uygulama tablosunda YOK. Yeni sunucuda tanımı yoksa elle taşınmalı.',
    },
    cozulemedi: {
      label: 'envanterde yok',
      tone: 'warning',
      hint: 'Hedef ne route ne OpenShift envanterinde bulundu — kaldırılmış olabilir ya da envanter eksik.',
    },
    include: {
      label: 'eski sunucuda include',
      tone: 'neutral',
      hint: 'Eski sunucuda proxy_pass değil application-confs include deseninde duruyor.',
    },
    spa: {
      label: 'SPA',
      tone: 'info',
      hint: 'Ad kalıbına uyan SPA hedefi.',
    },
    statik: {
      label: 'statik içerik',
      tone: 'neutral',
      hint: 'proxy_pass yok; root / alias / try_files ile dosya sunuyor (nginx -T).',
    },
    yonlendirme: {
      label: 'return / rewrite',
      tone: 'neutral',
      hint: 'proxy_pass yok; return ya da rewrite ile yanıt veriyor / yönlendiriyor (nginx -T).',
    },
    'erisim-engeli': {
      label: 'deny',
      tone: 'neutral',
      hint: 'Erişimi engelleyen location (deny) — nginx -T.',
    },
    diger: {
      label: 'diğer',
      tone: 'neutral',
      hint: 'proxy_pass / statik / return olmayan location (nginx -T).',
    },
  };

const CONFIG_YOK = {
  label: 'config taramasında yok',
  hint:
    'Yalnız nginx -T taramasında görülüyor: config taraması bu location’ı kaydetmedi (ör. içinde çok ' +
    'satırlı if / limit_except bloğu var, başka bir dosyadan include ediliyor ya da proxy_pass/include ' +
    'taşımıyor). Uygulama tablosunda ve eski sayımlarda bu yüzden yoktu.',
};

const DURUM: Record<
  NginxMigrationLocation['newStatus'],
  { label: string; mark: string; color: string; hint: string }
> = {
  none: {
    label: 'YOK',
    mark: '✗',
    color: 'var(--status-danger-text)',
    hint: 'Hiçbir yeni sunucuda bu location tanımlı değil.',
  },
  partial: {
    label: 'KISMEN',
    mark: '◐',
    color: 'var(--status-warning-text)',
    hint: 'Bazı yeni sunucularda tanımlı, bazılarında yok.',
  },
  'not-scanned': {
    label: 'TARANMADI',
    mark: '?',
    color: 'var(--text-muted)',
    hint: 'Yeni sunucular henüz taranmadı — "yok" demek DEĞİLDİR.',
  },
  defined: {
    label: 'TANIMLI',
    mark: '✓',
    color: 'var(--status-success)',
    hint: 'Her yeni sunucuda tanımlı.',
  },
};

export type LocDurumSuzgec = 'eksik' | 'all' | 'yalniz-yeni' | NginxMigrationLocation['newStatus'];
export type LocSinifSuzgec = 'all' | NginxMigrationLocSinif;
export type LocKaynakSuzgec = 'all' | 'yalniz-nginx-T';

const eksikMi = (l: NginxMigrationLocation) =>
  l.eskide && (l.newStatus === 'none' || l.newStatus === 'partial');
const yalnizNginxT = (l: NginxMigrationLocation) => l.eskide && !l.kaynaklar.includes('config');

/** Saf süzgeç (test edilir). 'eksik' = eski sunucularda olup yeni sunucularda YOK ya da KISMEN;
 *  'yalniz-yeni' = yalnız yeni sunucularda olan; 'all' = hepsi; durum adı = eski taraftan o durum. */
export function suzLocationlar(
  list: readonly NginxMigrationLocation[],
  durum: LocDurumSuzgec,
  sinif: LocSinifSuzgec,
  q: string,
  kaynak: LocKaynakSuzgec = 'all',
): NginxMigrationLocation[] {
  const needle = q.trim().toLowerCase();
  return list.filter((l) => {
    if (durum === 'eksik' && !eksikMi(l)) return false;
    if (durum === 'yalniz-yeni' && l.eskide) return false;
    if (durum !== 'eksik' && durum !== 'all' && durum !== 'yalniz-yeni' && (!l.eskide || l.newStatus !== durum))
      return false;
    if (sinif !== 'all' && !l.siniflar.includes(sinif)) return false;
    if (kaynak === 'yalniz-nginx-T' && !yalnizNginxT(l)) return false;
    if (!needle) return true;
    return [l.service, l.location, ...l.targets, ...l.written, ...l.apps, ...l.oldHosts]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
}

/** Yeni sunucularda tanımı OLMAYAN sunucular (newHosts = tanımlı olanlar). */
export function eksikSunucular(l: NginxMigrationLocation, yeni: readonly string[]): string[] {
  return yeni.filter((h) => !l.newHosts.includes(h));
}

/** Liste özeti (test edilir): yalnız eski taraf sayılır. */
export function tumLocOzeti(list: readonly NginxMigrationLocation[]) {
  const c = { none: 0, partial: 0, 'not-scanned': 0, defined: 0 };
  let eski = 0;
  let tablodaYokEksik = 0;
  let nginxT = 0;
  for (const l of list) {
    if (!l.eskide) continue;
    eski++;
    c[l.newStatus]++;
    if (yalnizNginxT(l)) nginxT++;
    // Uygulama tablosu yalnız config taramasının SPA satırlarından kurulur: bunun dışındaki eksik
    // location'lar (ad kalıbına uymayan, statik, yalnız nginx -T'nin gördüğü) orada hiç görünmez.
    if (eksikMi(l) && !(l.siniflar.includes('spa') && l.kaynaklar.includes('config'))) tablodaYokEksik++;
  }
  return {
    ...c,
    eski,
    eksik: c.none + c.partial,
    tablodaYokEksik,
    nginxT,
    yalnizYeni: list.length - eski,
  };
}

function yukMetni(t: NginxMigrationLocation['traffic']): string {
  if (!t) return 'ölçüm yok';
  if (t.state === 'active') return `yük alıyor · 7g ${nf(t.req7 || 0)}`;
  if (t.state === 'idle') return 'yük almıyor';
  if (!t.hosts) return 'log okunamadı';
  return kismiEtiket(t) || 'kısmi ölçüm';
}

export const TUM_LOC_CSV_BASLIK = [
  'grup',
  'vhost',
  'location',
  'eski_sunucularda',
  'yeni_sunucularda',
  'tanimli_yeni_sunucular',
  'eksik_yeni_sunucular',
  'sinif',
  'kaynak',
  'davranis',
  'hedef',
  'yazilan_ad',
  'namespace_uygulama',
  'eski_sunucular',
  'yuk',
] as const;

export function tumLocCsvSatirlari(
  g: Pick<NginxMigrationGroup, 'label' | 'newHosts'>,
  list: readonly NginxMigrationLocation[],
): string[][] {
  return list.map((l) => [
    g.label,
    `${l.service}-PROD.conf`,
    l.location,
    l.eskide ? 'var' : 'yok (yalnız yeni sunucularda)',
    DURUM[l.newStatus].label,
    l.newHosts.join(' '),
    l.newStatus === 'not-scanned' ? '' : eksikSunucular(l, g.newHosts).join(' '),
    l.siniflar.map((s) => LOC_SINIF[s]?.label || s).join(' + '),
    l.kaynaklar.join(' + '),
    l.davranislar.join(' + '),
    l.targets.join(' '),
    l.written.join(' '),
    l.apps.join(' '),
    l.oldHosts.join(' '),
    l.eskide ? yukMetni(l.traffic) : '',
  ]);
}

const SELECT =
  'px-2 py-1 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-surface)] max-w-full';

export function TumLocationlar({
  g,
  kaynakTarihleri,
  nginxTHazir,
}: {
  g: NginxMigrationGroup;
  kaynakTarihleri?: { config: string | null; nginxT: string | null };
  /** Satir sayisindan bagimsiz nginx -T detail sorgusu basari durumu. */
  nginxTHazir?: boolean;
}) {
  const list = useMemo(() => g.locations || [], [g]);
  const [durum, setDurum] = useState<LocDurumSuzgec>('eksik');
  const [sinif, setSinif] = useState<LocSinifSuzgec>('all');
  const [kaynak, setKaynak] = useState<LocKaynakSuzgec>('all');
  const [q, setQ] = useState('');
  const rows = useMemo(
    () => suzLocationlar(list, durum, sinif, q, kaynak),
    [list, durum, sinif, q, kaynak],
  );
  const oz = useMemo(() => tumLocOzeti(list), [list]);
  if (!g.locations) return null;
  const baslikId = `tum-loc-${g.id}`;
  const nginxTYok =
    nginxTHazir === false ||
    (nginxTHazir == null && !!kaynakTarihleri && !kaynakTarihleri.nginxT);
  return (
    <section
      aria-labelledby={baslikId}
      className="rounded-xl border px-4 py-3 space-y-2"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h3
            id={baslikId}
            className="text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            Tüm location'lar — ad kalıbından bağımsız
          </h3>
          <div className="text-sm" style={{ color: 'var(--text-primary)' }} data-testid="tum-loc-ozet">
            Eski sunucularda <b className="tabular-nums">{nf(oz.eski)}</b> location;{' '}
            <b
              className="tabular-nums"
              style={{ color: oz.eksik ? 'var(--status-danger-text)' : undefined }}
            >
              {nf(oz.eksik)}
            </b>{' '}
            tanesi yeni sunucularda yok ya da eksik
            {oz.tablodaYokEksik > 0 && (
              <>
                {' '}
                (
                <b className="tabular-nums" style={{ color: 'var(--status-warning-text)' }}>
                  {nf(oz.tablodaYokEksik)}
                </b>{' '}
                tanesi uygulama tablosunda hiç görünmüyor)
              </>
            )}
            {oz.nginxT > 0 && (
              <span className="block text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                {nf(oz.nginxT)} location yalnız nginx -T taramasında görünüyor (config taraması
                kaydetmemişti)
              </span>
            )}
          </div>
        </div>
        <div
          className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums"
          style={{ color: 'var(--text-secondary)' }}
        >
          {(['none', 'partial', 'not-scanned', 'defined'] as const).map((k) =>
            k === 'not-scanned' && !oz[k] ? null : (
              <span key={k} title={DURUM[k].hint}>
                <span style={{ color: DURUM[k].color }}>{DURUM[k].mark}</span> {DURUM[k].label}{' '}
                {nf(oz[k])}
              </span>
            ),
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Yeni sunucudaki duruma göre süz"
          value={durum}
          onChange={(e) => setDurum(e.target.value as LocDurumSuzgec)}
          className={SELECT}
        >
          <option value="eksik">yeni sunucularda YOK ya da KISMEN ({nf(oz.eksik)})</option>
          <option value="all">hepsi ({nf(list.length)})</option>
          <option value="none">yalnız YOK ({nf(oz.none)})</option>
          <option value="partial">yalnız KISMEN ({nf(oz.partial)})</option>
          <option value="not-scanned">taranmadı ({nf(oz['not-scanned'])})</option>
          <option value="defined">TANIMLI ({nf(oz.defined)})</option>
          <option value="yalniz-yeni">yalnız yeni sunucularda olan ({nf(oz.yalnizYeni)})</option>
        </select>
        <select
          aria-label="Sınıfa göre süz"
          value={sinif}
          onChange={(e) => setSinif(e.target.value as LocSinifSuzgec)}
          className={SELECT}
        >
          <option value="all">her sınıf</option>
          {(Object.keys(LOC_SINIF) as NginxMigrationLocSinif[]).map((k) => (
            <option key={k} value={k}>
              {LOC_SINIF[k].label}
            </option>
          ))}
        </select>
        <select
          aria-label="Kaynağa göre süz"
          value={kaynak}
          onChange={(e) => setKaynak(e.target.value as LocKaynakSuzgec)}
          className={SELECT}
        >
          <option value="all">her kaynak</option>
          <option value="yalniz-nginx-T">config taramasında olmayanlar ({nf(oz.nginxT)})</option>
        </select>
        <input
          type="search"
          aria-label="Location ara"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="location, hedef, vhost, sunucu…"
          className={`${SELECT} w-56`}
        />
        <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {nf(rows.length)} satır
        </span>
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              `nginx_prod_tum_location_${g.id}`,
              TUM_LOC_CSV_BASLIK,
              tumLocCsvSatirlari(g, rows),
            )
          }
          disabled={!rows.length}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-surface)] disabled:opacity-50"
          title="Görünen satırları CSV olarak indir"
        >
          <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
        </button>
      </div>

      <div
        className="overflow-auto max-h-[28rem] rounded-lg border"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <table className="text-[11px] w-full">
          <thead className="sticky top-0" style={{ background: 'var(--bg-surface)' }}>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="text-left px-2 py-1 font-semibold">Yeni sunucularda</th>
              <th className="text-left px-2 py-1 font-semibold">Vhost</th>
              <th className="text-left px-2 py-1 font-semibold">Location</th>
              <th className="text-left px-2 py-1 font-semibold">Sınıf</th>
              <th className="text-left px-2 py-1 font-semibold">Hedef / uygulama</th>
              <th className="text-left px-2 py-1 font-semibold">Eski sunucular</th>
              <th className="text-left px-2 py-1 font-semibold">Yük</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const d = DURUM[l.newStatus];
              const eksikH = l.newStatus === 'not-scanned' ? [] : eksikSunucular(l, g.newHosts);
              return (
                <tr
                  key={l.service + '|' + l.location}
                  className="border-t align-top"
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                >
                  <td className="px-2 py-1 whitespace-nowrap" title={d.hint}>
                    <span className="font-semibold" style={{ color: d.color }}>
                      {d.mark} {d.label}
                    </span>
                    {l.newStatus === 'partial' && (
                      <div className="tabular-nums">
                        {l.newHosts.length}/{g.newHosts.length}
                      </div>
                    )}
                    {l.newStatus === 'partial' && eksikH.length > 0 && (
                      <div
                        className="font-mono text-[10px]"
                        style={{ color: 'var(--status-danger-text)' }}
                      >
                        eksik: {eksikH.join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1 font-mono">{l.service}-PROD.conf</td>
                  <td
                    className="px-2 py-1 font-mono break-all"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {l.location}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap gap-1">
                      {!l.eskide && (
                        <Pill
                          tone="accent"
                          title="Eski sunucularda bu vhost'ta yok; yeni sunucularda tanımlı. Taşıma açığı değildir, sayıma girmez."
                        >
                          yalnız yeni sunucularda
                        </Pill>
                      )}
                      {l.siniflar.map((s) => (
                        <Pill
                          key={s}
                          tone={LOC_SINIF[s]?.tone || 'neutral'}
                          title={LOC_SINIF[s]?.hint}
                        >
                          {LOC_SINIF[s]?.label || s}
                        </Pill>
                      ))}
                      {yalnizNginxT(l) && (
                        <Pill tone="warning" title={CONFIG_YOK.hint}>
                          {CONFIG_YOK.label}
                        </Pill>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1">
                    {l.targets.map((t) => (
                      <div key={t} className="font-mono break-all">
                        {t}
                      </div>
                    ))}
                    {l.written.filter((w) => !l.targets.includes(w)).length > 0 && (
                      <div className="font-mono" style={{ color: 'var(--text-muted)' }}>
                        yazım: {l.written.filter((w) => !l.targets.includes(w)).join(', ')}
                      </div>
                    )}
                    {l.apps.length > 0 && (
                      <div style={{ color: 'var(--text-muted)' }}>{l.apps.join(', ')}</div>
                    )}
                  </td>
                  <td
                    className="px-2 py-1 font-mono whitespace-nowrap"
                    title={l.oldHosts.join('\n')}
                  >
                    {!l.eskide
                      ? '—'
                      : l.oldHosts.length > 2
                        ? `${l.oldHosts.length} sunucu`
                        : l.oldHosts.join(', ')}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    {l.eskide ? yukMetni(l.traffic) : '—'}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-2" style={{ color: 'var(--text-muted)' }}>
                  {list.length === 0
                    ? 'Eski sunucularda location bulunamadı.'
                    : durum === 'eksik' && !q && sinif === 'all' && kaynak === 'all'
                      ? 'Yeni sunucularda olmayan location yok.'
                      : 'Süzgece uyan location yok.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] space-y-0.5" style={{ color: 'var(--text-muted)' }}>
        <div>
          Kaynaklar: config taraması
          {kaynakTarihleri?.config ? ` (${kaynakTarihleri.config})` : ''} — proxy_pass ve
          application-confs include taşıyan location'lar; nginx -T taraması
          {kaynakTarihleri?.nginxT ? ` (${kaynakTarihleri.nginxT})` : ''} — statik / return dahil
          her location, başka dosyadan include edilenler de.
        </div>
        {nginxTYok && (
          <div style={{ color: 'var(--status-warning-text)' }}>
            nginx -T taraması okunamadı (tablo/sonuç sorgusu okunamadı ya da iş hiç koşmadı): liste
            yalnız config taramasından; içinde iç içe blok olan location'lar eksik olabilir.
          </div>
        )}
      </div>
    </section>
  );
}
