// src/components/server_hub/RetirementWebSatir.tsx — retirement web (vhost) satirinin ayirt edici bilgisi.
//
// 2026-10-23, Retirement #27 (GBCEPPOSDASHBOARD): "Web sunucusu kolonundaki duplike satirlar niye
// duplike?" Ayni host + ServerName birden cok satir olabilir (:80 / :443 bloklari, farkli conf dosyasi);
// ekran yalniz "host · ServerName" bastigi icin dordu ayni gorunuyordu.
//
// 2026-10-26 (tablo yeniden tasarimi): vhost ve sag deger (trafik / web adimi) AYNI izgara satirinda
// (hiza yapisal olarak kaymaz), host grup basina BIR kez. Gruplama saf: webGrupla / trafikBirlestir.
import React from 'react';
import type { RtVhostTrafik, RtWeb } from '@/api/retirementApi';

/** Port(lar) · conf dosya adi · urun; tam conf yolu ipucunda. `portlar` verilmezse w.port. */
export function WebAyrinti({ w, portlar }: { w: RtWeb; portlar?: string[] }) {
  const conf = String(w.confFile || '');
  const p = (portlar && portlar.length ? portlar : [w.port]).filter(Boolean).map((x) => `:${x}`).join(' ');
  const parca = [p, conf.split('/').pop() || '', w.product || ''].filter(Boolean);
  if (!parca.length) return null;
  // max-w-full truncate: uzun conf adi kolondan TASMAZ (denetim B5: 1280'de Durum kolonuna biniyordu); tam yol ipucunda.
  return <span className="max-w-full truncate text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }} title={conf ? `conf: ${conf}` : undefined} data-testid="rt-web-ayrinti">{parca.join(' · ')}</span>;
}

/** Ayni host + ServerName birden cok satir olabilir; sira da anahtarda - React cocuklari cakismaz. */
export const webKey = (w: RtWeb, i: number) => `${w.host}|${w.serverName}|${w.port || ''}|${w.confFile || ''}|${i}`;

const CIP = 'px-1 rounded border text-[11px] font-semibold leading-4 whitespace-nowrap';
/** Vhost'un nasil bulundugu (2026-10-12): AJP/proxy hedefiyle bulunanlar etiketlenir. */
export function WebKaynak({ w }: { w: RtWeb }) {
  const k = String(w.kaynak || '');
  const ajp = k.includes('ajp');
  const mc = k.includes('mc');
  if (!ajp && !mc && !w.elle) return null;
  return (
    <>
      {w.elle && <span className={CIP} style={{ color: 'var(--status-warning-text)', borderColor: 'var(--status-warning)' }} title={w.elle}>elle</span>}
      {ajp && <span className={CIP} style={{ color: 'var(--status-info)', borderColor: 'var(--status-info)' }} title={`mod_jk/proxy hedefi ${w.ajpHedef || ''} bu JVM'in portu${k === 'ajp' ? ' — ad eşleşmesiyle BULUNAMAZDI' : ''}`}>AJP</span>}
      {mc && <span className={CIP} style={{ color: 'var(--status-info)', borderColor: 'var(--status-info)' }} title={`Red Hat Apache mod_cluster: vhost balancer://${w.mcBalancer || ''} = uygulama adı (JBoss 8 kendini bu adla duyurur). Aynı site + ortamdaki web sunucusu; o anki üye JVM doğrulanmadı.`}>mod_cluster</span>}
    </>
  );
}

/** Ayni conf + urun: portlari tek baga toplanir (`:80 :443 · mod-jk.conf · IHS`). */
export interface WebBag { anahtar: string; ornek: RtWeb; portlar: string[] }
/** Ayni host + ServerName (buyuk/kucuk harf duyarsiz; discover.cjs trafik anahtariyla ayni). */
export interface WebSatiri { anahtar: string; host: string; serverName: string; baglar: WebBag[]; kaynak: RtWeb; trafik?: RtVhostTrafik; indeksler: number[] }
export interface WebGrubu { anahtar: string; host: string; urunler: string[]; satirlar: WebSatiri[] }

// Birlesik `kaynak` belirtecleri bu sirada yazilir (bilinmeyenler sonda, gorulme sirasiyla).
const KAYNAK_SIRA = ['ad', 'ajp', 'mc'];
const kaynakSirasi = (k: string) => (KAYNAK_SIRA.includes(k) ? KAYNAK_SIRA.indexOf(k) : KAYNAK_SIRA.length);

/** Vhost listesini host > ServerName > (conf, urun) olarak gruplar; ilk gorulme sirasi korunur. */
export function webGrupla(web: RtWeb[]): WebGrubu[] {
  const gruplar: WebGrubu[] = [];
  const grupBul = new Map<string, WebGrubu>();
  const satirBul = new Map<string, { s: WebSatiri; trafikler: (RtVhostTrafik | undefined)[]; kaynaklar: string[] }>();
  (web || []).forEach((w, i) => {
    const ga = String(w.host || '').trim().toUpperCase();
    let g = grupBul.get(ga);
    if (!g) {
      g = { anahtar: ga, host: w.host, urunler: [], satirlar: [] };
      grupBul.set(ga, g);
      gruplar.push(g);
    }
    const urun = String(w.product || '').trim();
    if (urun && !g.urunler.some((u) => u.toUpperCase() === urun.toUpperCase())) g.urunler.push(urun);
    const sa = `${ga}|${String(w.serverName || '').trim().toLowerCase()}`;
    let kayit = satirBul.get(sa);
    if (!kayit) {
      kayit = { s: { anahtar: sa, host: w.host, serverName: w.serverName, baglar: [], kaynak: { ...w }, indeksler: [] }, trafikler: [], kaynaklar: [] };
      satirBul.set(sa, kayit);
      g.satirlar.push(kayit.s);
    }
    const { s } = kayit;
    s.indeksler.push(i);
    kayit.trafikler.push(w.trafik);
    for (const k of String(w.kaynak || '').split('+').map((x) => x.trim()).filter(Boolean)) if (!kayit.kaynaklar.includes(k)) kayit.kaynaklar.push(k);
    // ajpHedef / mcBalancer / elle: ilk dolu olan.
    if (!s.kaynak.ajpHedef && w.ajpHedef) s.kaynak.ajpHedef = w.ajpHedef;
    if (!s.kaynak.mcBalancer && w.mcBalancer) s.kaynak.mcBalancer = w.mcBalancer;
    if (!s.kaynak.elle && w.elle) s.kaynak.elle = w.elle;
    const ba = `${String(w.confFile || '')}|${String(w.product || '').toUpperCase()}`;
    let b = s.baglar.find((x) => x.anahtar === ba);
    if (!b) {
      b = { anahtar: ba, ornek: w, portlar: [] };
      s.baglar.push(b);
    }
    const port = String(w.port || '').trim();
    if (port && !b.portlar.includes(port)) b.portlar.push(port);
  });
  for (const { s, trafikler, kaynaklar } of satirBul.values()) {
    s.kaynak.kaynak = kaynaklar.length ? [...kaynaklar].sort((a, b) => kaynakSirasi(a) - kaynakSirasi(b)).join('+') : undefined;
    s.trafik = trafikBirlestir(trafikler);
  }
  return gruplar;
}

/** Ayni vhost'un trafikleri tek degere. Bilinmeyeni ASLA "yok"a dusurmez:
 *  var (en buyuk req7; herhangi biri sampled ise sampled) > bilinmiyor (undefined) > olculemedi > yok. */
export function trafikBirlestir(l: (RtVhostTrafik | undefined)[]): RtVhostTrafik | undefined {
  const vars = l.filter((x): x is RtVhostTrafik => x?.durum === 'var');
  if (vars.length) {
    const enBuyuk = vars.reduce((a, b) => ((b.req7 ?? 0) > (a.req7 ?? 0) ? b : a));
    return vars.some((x) => x.sampled) ? { ...enBuyuk, sampled: true } : enBuyuk;
  }
  if (!l.length || l.some((x) => x === undefined)) return undefined;
  return l.find((x) => x?.durum === 'olculemedi') ?? l[0];
}

/** Tek izgara: host (grup basina bir kez) | ServerName + baglar + kaynak | sag deger (ayni satirin ilk 20px'i). */
export function WebVhostListesi({ web, sag, ipucu }: { web: RtWeb[]; sag?: (s: WebSatiri) => React.ReactNode; ipucu?: string }) {
  return (
    <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_auto] gap-x-2 text-[11px]" title={ipucu}>
      {webGrupla(web).map((g, gi) => g.satirlar.map((s, si) => {
        const ayrac = gi > 0 && si === 0 ? 'mt-1 border-t pt-1' : '';
        const as = ayrac ? { borderColor: 'var(--border-subtle)' } : undefined;
        return (
          <React.Fragment key={s.anahtar}>
            <span className={`truncate font-mono font-semibold leading-5 ${ayrac}`} style={{ ...as, color: 'var(--text-secondary)' }} title={si === 0 ? [g.host, g.urunler.join(', ')].filter(Boolean).join(' · ') : undefined}>{si === 0 ? g.host : ''}</span>
            <div className={`flex min-w-0 flex-wrap items-baseline gap-x-1.5 leading-5 ${ayrac}`} style={as}>
              <span data-rt-vhost className="max-w-full truncate font-mono" style={{ color: 'var(--text-primary)' }} title={s.serverName}>{s.serverName}</span>
              {s.baglar.map((b) => <WebAyrinti key={b.anahtar} w={b.ornek} portlar={b.portlar} />)}
              <WebKaynak w={s.kaynak} />
            </div>
            {/* Sag deger 20px kutuda DIKEY ORTALI: satir icinde taban cizgisine oturan 16px cip 1px asagida kaliyordu. */}
            <div data-rt-vhost-sag className={`whitespace-nowrap text-right leading-5 ${ayrac}`} style={as}><div className="flex h-5 items-center justify-end">{sag?.(s)}</div></div>
          </React.Fragment>
        );
      }))}
    </div>
  );
}
