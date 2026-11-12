// src/components/nginx_console/SpaOzetMatrisi.tsx — Nginx Hub › SPA Uygulamaları: ortam başına özet.
//
// Kullanıcı (2026-11-12): "mevcut sayfayı okumak çok zor... 'keşif özeti' kısmını komple kaldıralım".
// Öğrenmek istenen altı soru, her biri bir sütun (satır = ortam, en altta toplam):
//   1. Tüm ortamlarda kaç SPA var, ayrı ayrı
//   2. SPA'ların tipi: hangi ortamda kaç internet, kaç intranet
//   3. Ad kalıbına uyuyor mu
//   4. Kaçı reverse proxy üzerinden hizmet alıyor
//   5. RP üzerinden hizmet alıyorsa yük alıyor mu
//   6. RP sunucuları kendi arasında eşit mi: tanım ortamın TÜM eşlenik RP sunucularında var ve sorunsuz mu
// Her sayı tıklanır: alttaki liste o ortam + o kırılıma süzülür. Sayım YALNIZ SPA olan (pod'da nginx)
// uygulamalar üzerinden; "SPA mı bilinmiyor" sayısı ayrıca yazılır, gizlenmez.
import React from 'react';
import type { NgSpaApp } from '@/api/nginxConsoleApi';
import { fmtNumber } from '@/utils/datetime';

export type Eslenik = 'tam' | 'eksik' | 'hatali';

/**
 * Tanım eşlenik RP sunucularında sağlam mı (yalnız rp = tanımlı). 2026-11-12 düzeltmesi: eşlenik =
 * AYNI servisi aynı kurulumda taşıyan sunucular (sunucu hesaplar: rpEslenik). Eskiden payda ortamın
 * TÜM RP sunucularıydı (QA'da Glomo ve Glomo dışı sunucular, PROD'da eski + yeni filo) ve neredeyse
 * her uygulama "eksik" görünüyordu.
 *   'hatali' : bir sunucudaki tanımda sorun kodu (dizin eksik, include bozuk, uygulama yok, prod'da
 *              non-prod hedef). Ortam dışı uyarısı hata sayılmaz.
 *   'eksik'  : aynı servisi taşıyan sunuculardan en az birinde tanım yok.
 */
export function eslenikDurumu(a: NgSpaApp): Eslenik | null {
  if (a.rp !== 'tanimli') return null;
  if ((a.rpSorun || []).some((s) => s !== 'ORTAM_DISI')) return 'hatali';
  return a.rpEslenik === 'eksik' ? 'eksik' : 'tam';
}

export interface OzetSuzgec {
  ortam: string;
  ag?: NgSpaApp['ag'];
  kalip?: NgSpaApp['pattern'];
  rp?: NgSpaApp['rp'];
  rpIstek?: NgSpaApp['rpIstek'];
  eslenik?: Eslenik;
  /** RP servisi (GLOMO, SAKLAMA ...); 'yok' = RP servisi bilinmiyor. */
  servis?: string;
}

interface Satir {
  ortam: string;
  spa: number;
  bilinmiyor: number;
  internet: number;
  intranet: number;
  digerAg: number;
  kalipUyuyor: number;
  kalipUymuyor: number;
  rpTanimli: number;
  rpTanimsiz: number;
  rpOlculemedi: number;
  yukVar: number;
  yukYok: number;
  yukOlculemedi: number;
  esTam: number;
  esEksik: number;
  esHatali: number;
  /** RP'de yayinda olanlarin servis kirilimi (bir uygulama birden cok serviste olabilir). */
  servisler: Record<string, number>;
}

const ORTAM_SIRA = ['prod', 'qa', 'test', 'dev', 'edu'];
const ETIKET: Record<string, string> = { prod: 'Prod', qa: 'QA', test: 'Test', dev: 'Dev', edu: 'Edu', belirsiz: 'Belirsiz', tumu: 'Toplam' };

export function ortamAnahtari(a: NgSpaApp) {
  const e = String(a.env || '').toLowerCase();
  return ORTAM_SIRA.includes(e) ? e : 'belirsiz';
}

const bos = (ortam: string): Satir => ({
  ortam, spa: 0, bilinmiyor: 0, internet: 0, intranet: 0, digerAg: 0, kalipUyuyor: 0, kalipUymuyor: 0,
  rpTanimli: 0, rpTanimsiz: 0, rpOlculemedi: 0, yukVar: 0, yukYok: 0, yukOlculemedi: 0, esTam: 0, esEksik: 0, esHatali: 0,
  servisler: {},
});

export function spaOzeti(apps: NgSpaApp[]): { satirlar: Satir[]; toplam: Satir } {
  const m = new Map<string, Satir>();
  const toplam = bos('tumu');
  for (const a of apps) {
    const o = ortamAnahtari(a);
    if (!m.has(o)) m.set(o, bos(o));
    for (const s of [m.get(o)!, toplam]) {
      if (a.spa === 'bilinmiyor') s.bilinmiyor += 1;
      if (a.spa !== 'evet') continue;
      s.spa += 1;
      if (a.ag === 'internet') s.internet += 1;
      else if (a.ag === 'intranet') s.intranet += 1;
      else s.digerAg += 1;
      if (a.pattern === 'uyuyor') s.kalipUyuyor += 1;
      else s.kalipUymuyor += 1;
      if (a.rp === 'tanimli') s.rpTanimli += 1;
      else if (a.rp === 'tanimsiz') s.rpTanimsiz += 1;
      else if (a.rp === 'olculemedi') s.rpOlculemedi += 1;
      if (a.rp === 'tanimli') {
        if (a.rpIstek === 'var') s.yukVar += 1;
        else if (a.rpIstek === 'yok') s.yukYok += 1;
        else s.yukOlculemedi += 1;
        const es = eslenikDurumu(a);
        if (es === 'tam') s.esTam += 1;
        else if (es === 'eksik') s.esEksik += 1;
        else s.esHatali += 1;
        const sv = a.rpServis && a.rpServis.length ? a.rpServis : [''];
        for (const x of sv) s.servisler[x] = (s.servisler[x] || 0) + 1;
      }
    }
  }
  const satirlar = [...m.values()]
    .filter((s) => s.spa > 0 || s.bilinmiyor > 0)
    .sort((x, y) => (ORTAM_SIRA.indexOf(x.ortam) + 1 || 99) - (ORTAM_SIRA.indexOf(y.ortam) + 1 || 99));
  return { satirlar, toplam };
}

function Sayi({ n, ton, onClick, title }: { n: number; ton?: 'iyi' | 'uyari' | 'kritik' | 'soluk'; onClick?: () => void; title?: string }) {
  const renk =
    n === 0
      ? 'var(--text-muted)'
      : ton === 'iyi'
        ? 'var(--status-success)'
        : ton === 'uyari'
          ? 'var(--status-warning-text)'
          : ton === 'kritik'
            ? 'var(--status-danger)'
            : ton === 'soluk'
              ? 'var(--text-muted)'
              : 'var(--text-primary)';
  if (!onClick || n === 0)
    return (
      <span className="tabular-nums" style={{ color: renk }} title={title}>
        {fmtNumber(n)}
      </span>
    );
  return (
    <button type="button" onClick={onClick} title={title ? `${title} — listeyi süz` : 'Listeyi süz'} className="tabular-nums hover:underline focus-visible:outline focus-visible:outline-2 rounded" style={{ color: renk }}>
      {fmtNumber(n)}
    </button>
  );
}

/** "12 · 3" biçiminde iki-üç sayılık hücre; her sayının altında küçük etiket. */
function Ikili({ ogeler }: { ogeler: { n: number; etiket: string; ton?: 'iyi' | 'uyari' | 'kritik' | 'soluk'; suz?: () => void; title?: string }[] }) {
  return (
    <div className="flex gap-4">
      {ogeler.map((o) => (
        <div key={o.etiket} className="flex flex-col leading-tight">
          <span className="text-[14px] font-semibold">
            <Sayi n={o.n} ton={o.ton} onClick={o.suz} title={o.title} />
          </span>
          <span className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>{o.etiket}</span>
        </div>
      ))}
    </div>
  );
}

function RpSatiri({ n, metin, ton, onClick, girinti = 0, testId }: { n: number; metin: string; ton?: 'iyi' | 'uyari' | 'kritik' | 'soluk'; onClick?: () => void; girinti?: number; testId?: string }) {
  if (!n) return null;
  return (
    <li className="flex items-baseline gap-1.5" style={{ paddingLeft: girinti * 14 }} data-testid={testId}>
      {girinti > 0 && <span aria-hidden="true" style={{ color: 'var(--border)' }}>└</span>}
      <span className="text-[13px] font-semibold min-w-[2.25rem] text-right">
        <Sayi n={n} ton={ton} onClick={onClick} title={metin} />
      </span>
      <span style={{ color: 'var(--text-secondary)' }}>{metin}</span>
    </li>
  );
}

/** Reverse proxy sutunu: internet SPA'larinin sirayla okunan akisi (kullanici, 2026-11-12: "RP uzerinden,
 *  RP'de yok, yuk var/yok, RP eslenik sunucular hicbir seyi anlamiyorum"). Satir = soru, sayi tiklanir. */
function RpAkisi({ s, suz }: { s: Satir; suz: (x: Omit<OzetSuzgec, 'ortam'>) => () => void }) {
  if (!s.internet && !s.rpTanimli && !s.rpTanimsiz && !s.rpOlculemedi)
    return <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>internet SPA yok (intranet SPA'lar reverse proxy kullanmaz)</span>;
  return (
    <ul className="space-y-0.5 text-[11.5px]" data-testid="rp-akisi">
      <RpSatiri n={s.rpTanimli} metin="RP'de yayında" ton="iyi" onClick={suz({ rp: 'tanimli' })} testId="rp-yayinda" />
      {/* HANGI RP (kullanici, 2026-11-12: "en onemli sey uygulama hangi reverse proxy'e tanimli, Glomo mu"):
          servis basina sayi; tiklamak listeyi o servise suzer. */}
      {s.rpTanimli > 0 && (
        <li className="flex flex-wrap items-center gap-1 pb-0.5" style={{ paddingLeft: 14 }} data-testid="rp-servisler">
          <span aria-hidden="true" style={{ color: 'var(--border)' }}>└</span>
          {Object.entries(s.servisler)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'tr'))
            .map(([ad, n]) => (
              <button
                key={ad || 'bilinmiyor'}
                type="button"
                onClick={suz({ rp: 'tanimli', servis: ad || 'yok' })}
                title={ad ? `${ad} reverse proxy servisinde tanımlı — listeyi süz` : 'RP servisi okunamadı — listeyi süz'}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] hover:underline focus-visible:outline focus-visible:outline-2"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: ad ? 'var(--text-primary)' : 'var(--text-muted)' }}
              >
                <span className="font-semibold">{ad || 'servis bilinmiyor'}</span>
                <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{fmtNumber(n)}</span>
              </button>
            ))}
        </li>
      )}
      <RpSatiri n={s.yukVar} metin="son 7 günde trafik aldı" ton="iyi" onClick={suz({ rp: 'tanimli', rpIstek: 'var' })} girinti={1} testId="rp-trafik-var" />
      <RpSatiri n={s.yukYok} metin="trafik almadı" ton="kritik" onClick={suz({ rp: 'tanimli', rpIstek: 'yok' })} girinti={1} testId="rp-trafik-yok" />
      <RpSatiri n={s.yukOlculemedi} metin="trafik ölçülemedi" ton="soluk" girinti={1} />
      <RpSatiri n={s.esEksik} metin="aynı servisin bazı RP sunucularında tanımı yok" ton="uyari" onClick={suz({ eslenik: 'eksik' })} girinti={1} testId="rp-eksik-sunucu" />
      <RpSatiri n={s.esHatali} metin="bir RP sunucusunda tanım hatalı" ton="kritik" onClick={suz({ eslenik: 'hatali' })} girinti={1} testId="rp-hatali" />
      <RpSatiri n={s.rpTanimsiz} metin="RP'de tanımı yok" ton="kritik" onClick={suz({ rp: 'tanimsiz' })} testId="rp-tanimsiz" />
      <RpSatiri n={s.rpOlculemedi} metin="RP'de var mı ölçülemedi" ton="soluk" onClick={suz({ rp: 'olculemedi' })} />
    </ul>
  );
}

export default function SpaOzetMatrisi({ apps, onSuz, eksikTarama }: { apps: NgSpaApp[]; onSuz: (s: OzetSuzgec) => void; eksikTarama?: string }) {
  const { satirlar, toplam } = spaOzeti(apps);
  if (!satirlar.length) return null;
  const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap align-bottom';
  const td = 'px-3 py-2 align-top';
  const satirCiz = (s: Satir, toplamMi = false) => {
    const o = s.ortam;
    const suz = (x: Omit<OzetSuzgec, 'ortam'>) => () => onSuz({ ortam: o, ...x });
    return (
      <tr key={o} style={{ borderTop: toplamMi ? '2px solid var(--border)' : '1px solid var(--border-subtle)', background: toplamMi ? 'var(--bg-elevated)' : undefined }} data-testid={toplamMi ? 'ozet-toplam' : 'ozet-satiri'}>
        <td className={`${td} font-semibold`} style={{ color: 'var(--text-primary)' }}>{ETIKET[o] || o}</td>
        <td className={td}>
          <div className="text-[18px] font-semibold leading-tight">
            <Sayi n={s.spa} onClick={suz({})} title="SPA (pod'da nginx)" />
          </div>
          {s.bilinmiyor > 0 && <div className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>+{s.bilinmiyor} ölçülemedi</div>}
        </td>
        <td className={td}>
          <Ikili
            ogeler={[
              { n: s.internet, etiket: 'internet', suz: suz({ ag: 'internet' }), title: 'route passthrough' },
              { n: s.intranet, etiket: 'intranet', suz: suz({ ag: 'intranet' }), title: 'route reencrypt' },
              ...(s.digerAg ? [{ n: s.digerAg, etiket: 'diğer', ton: 'soluk' as const, title: 'edge / TLS yok / karışık / bilinmiyor' }] : []),
            ]}
          />
        </td>
        <td className={td}>
          <Ikili
            ogeler={[
              { n: s.kalipUyuyor, etiket: 'uyuyor', ton: 'iyi', suz: suz({ kalip: 'uyuyor' }), title: '-app-v / -app-emb-v' },
              { n: s.kalipUymuyor, etiket: 'uymuyor', ton: 'kritik', suz: suz({ kalip: 'uymuyor' }), title: 'adı -app-v / -app-emb-v kuralına uymuyor' },
            ]}
          />
        </td>
        <td className={td}>
          <RpAkisi s={s} suz={suz} />
        </td>
      </tr>
    );
  };
  return (
    <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }} data-testid="spa-ozet-matrisi">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              <th className={th}>Ortam</th>
              <th className={th}>SPA</th>
              <th className={th}>Tip</th>
              <th className={th}>Ad kalıbı</th>
              <th className={th} title="Internet SPA'ların reverse proxy (nginx) sunucularından dışarıya açılma durumu">
                Reverse proxy · internet SPA'ları
              </th>
            </tr>
          </thead>
          <tbody>
            {satirlar.map((s) => satirCiz(s))}
            {satirlar.length > 1 && satirCiz(toplam, true)}
          </tbody>
        </table>
      </div>
      {/* EKSIK TARAMA NITELENIR: sayilar taranabilen kisimdandir; "uymayan yok" kesin degil. */}
      {eksikTarama && (
        <p className="px-3 py-2 text-[11px] border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--status-warning-text)' }} data-testid="ozet-eksik-tarama">
          Sayılar yalnız taranabilen kısımdan: {eksikTarama}.
        </p>
      )}
      <p className="px-3 py-2 text-[11px] border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
        Sayılar yalnız SPA olan uygulamalardır (pod'unda nginx çalışıyor). Bir sayıya tıklayınca aşağıdaki liste o ortama ve o
        kırılıma süzülür.
      </p>
      <dl className="px-3 py-2 border-t grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-[max-content_1fr]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }} data-testid="rp-sozluk">
        <dt className="font-semibold">RP'de yayında</dt>
        <dd>Uygulamanın internet adresi, kendi ortamının reverse proxy (nginx) sunucularında tanımlı; internetten bu sunucular üzerinden erişilir.</dd>
        <dt className="font-semibold">GLOMO, SAKLAMA …</dt>
        <dd>Uygulamanın tanımlı olduğu reverse proxy servisi (vhost grubu). Bir uygulama birden çok serviste tanımlıysa her birinde sayılır.</dd>
        <dt className="font-semibold">RP'de tanımı yok</dt>
        <dd>Uygulama internete açık tipte (route passthrough) ama kendi ortamının reverse proxy sunucularında tanımı bulunamadı; dışarıdan erişilemiyor olabilir.</dd>
        <dt className="font-semibold">Trafik aldı / almadı</dt>
        <dd>Reverse proxy access log'larında son 7 günde bu uygulamaya istek geldi mi (sağlık kontrolü hc.jsp / hc.html sayılmaz). "Ölçülemedi": log 7 günü kapsamıyor ya da okunamadı — "almadı" demek değildir.</dd>
        <dt className="font-semibold">Aynı servisin bazı sunucularında tanımı yok</dt>
        <dd>Aynı servisi (ör. GLOMO) aynı kurulumda taşıyan reverse proxy sunucuları birbirinin kopyasıdır (ör. Pendik + Ankara); uygulamanın tanımı hepsinde olmalı. Bu sayı, o sunuculardan en az birinde tanımı olmayan uygulamalardır. Başka servisin sunucusu ve taranmayan sunucu sayılmaz.</dd>
        <dt className="font-semibold">Bir sunucuda tanım hatalı</dt>
        <dd>Tanım var ama bir sunucuda sorunlu: uygulama dosyaları yok (404), include bozuk ya da prod'da non-prod hedefe yönleniyor.</dd>
      </dl>
    </section>
  );
}
