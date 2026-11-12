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

export type Eslenik = 'tam' | 'eksik';

/** RP tanımı ortamın tüm eşlenik sunucularında var mı ve hatasız mı (yalnız rp = tanımlı). */
export function eslenikDurumu(a: NgSpaApp): Eslenik | null {
  if (a.rp !== 'tanimli') return null;
  const m = /^(\d+)\/(\d+)$/.exec(a.rpHost || '');
  const eksikSunucu = m ? Number(m[1]) < Number(m[2]) : false;
  const hata = (a.rpSorun || []).some((s) => s !== 'ORTAM_DISI');
  return eksikSunucu || hata ? 'eksik' : 'tam';
}

export interface OzetSuzgec {
  ortam: string;
  ag?: NgSpaApp['ag'];
  kalip?: NgSpaApp['pattern'];
  rp?: NgSpaApp['rp'];
  rpIstek?: NgSpaApp['rpIstek'];
  eslenik?: Eslenik;
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
}

const ORTAM_SIRA = ['prod', 'qa', 'test', 'dev', 'edu'];
const ETIKET: Record<string, string> = { prod: 'Prod', qa: 'QA', test: 'Test', dev: 'Dev', edu: 'Edu', belirsiz: 'Belirsiz', tumu: 'Toplam' };

export function ortamAnahtari(a: NgSpaApp) {
  const e = String(a.env || '').toLowerCase();
  return ORTAM_SIRA.includes(e) ? e : 'belirsiz';
}

const bos = (ortam: string): Satir => ({
  ortam, spa: 0, bilinmiyor: 0, internet: 0, intranet: 0, digerAg: 0, kalipUyuyor: 0, kalipUymuyor: 0,
  rpTanimli: 0, rpTanimsiz: 0, rpOlculemedi: 0, yukVar: 0, yukYok: 0, yukOlculemedi: 0, esTam: 0, esEksik: 0,
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
        if (eslenikDurumu(a) === 'tam') s.esTam += 1;
        else s.esEksik += 1;
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
          <Ikili
            ogeler={[
              { n: s.rpTanimli, etiket: 'RP üzerinden', ton: 'iyi', suz: suz({ rp: 'tanimli' }), title: 'Kendi ortamının reverse proxy sunucularında tanımlı' },
              { n: s.rpTanimsiz, etiket: 'RP\'de yok', ton: 'uyari', suz: suz({ rp: 'tanimsiz' }), title: 'Internet SPA ama kendi ortamının RP sunucularında tanım yok' },
              ...(s.rpOlculemedi ? [{ n: s.rpOlculemedi, etiket: 'ölçülemedi', ton: 'soluk' as const, suz: suz({ rp: 'olculemedi' }) }] : []),
            ]}
          />
        </td>
        <td className={td}>
          <Ikili
            ogeler={[
              { n: s.yukVar, etiket: 'yük var', ton: 'iyi', suz: suz({ rp: 'tanimli', rpIstek: 'var' }), title: 'RP access log: son 7 günde istek var' },
              { n: s.yukYok, etiket: 'yük yok', ton: 'kritik', suz: suz({ rp: 'tanimli', rpIstek: 'yok' }), title: 'RP access log: 7 günün tamamı ölçüldü, istek yok' },
              ...(s.yukOlculemedi ? [{ n: s.yukOlculemedi, etiket: 'ölçülemedi', ton: 'soluk' as const, title: 'kısmi pencere / ölçüm kaynağı yok / ayrılamaz' }] : []),
            ]}
          />
        </td>
        <td className={td}>
          <Ikili
            ogeler={[
              { n: s.esTam, etiket: 'tüm sunucularda', ton: 'iyi', suz: suz({ eslenik: 'tam' }), title: 'Tanım ortamın tüm eşlenik RP sunucularında var ve hatasız' },
              { n: s.esEksik, etiket: 'eksik / hatalı', ton: 'kritik', suz: suz({ eslenik: 'eksik' }), title: 'Tanım bazı eşlenik RP sunucularında yok ya da bir sunucuda hatalı (dizin eksik, 404 vb.)' },
            ]}
          />
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
              <th className={th}>Reverse proxy</th>
              <th className={th}>RP'de yük (7 gün)</th>
              <th className={th}>RP eşlenik sunucular</th>
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
        kırılıma süzülür. Yük ve eşlenik sütunları yalnız reverse proxy'de tanımlı olanları sayar.
      </p>
    </section>
  );
}
