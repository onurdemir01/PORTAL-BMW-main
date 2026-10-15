// src/components/common/SmartBeklemeSayaci.tsx — Smart onayi beklenirken zaman asimi sayaci.
//
// Kullanici (2026-10-15): "Smart onayinda beklerken bir zaman asimi sayaci olsun hatta boyle bir
// insan veya cita figuru sayacin basinda yurusun sonuna dogru kosmaya baslasin."
//
// Iki kip:
//   * geri     : sunucu bir son tarih verdi (OCO penceresinin sonu ya da genel sinir). Geri sayar;
//                cita parkurda gecen sure oraninda ilerler, sona yaklasinca (kalan < %25 ya da
//                < 10 dk) kosmaya baslar, sure dolunca bitis cizgisinde durur.
//   * sinirsiz : varsayilan sistemde zaman asimi YOK (deadline null). Gecen sureyi gosterir; cita
//                parkurun basinda sakin sakin gidip gelir - bir hedefe kostugu izlenimi VERMEZ.
//
// NEDEN serverNow: istemci saati sunucudan dakikalarca sapabiliyor; kalan sure sunucu saatine gore
// hesaplanir. Kayma = serverNow - alindiMs (yanitin istemciye ULASTIGI yerel an).
// NEDEN alindiMs (2026-10-15 denetim): kayma eskiden sayacin KURULDUGU anda olculup kilitleniyordu.
// Ust bilesen sayaci saklanmis (bayat) bir yanitla yeniden kurunca (Admin'de OCO paneline gidip
// donmek, Taleplerim'i daraltip acmak) kalan sure yanitin yasi kadar FAZLA gorunuyor, sonra gelen
// taze yanit da duzeltmiyordu. Simdi: alindiMs verilirse kayma ondan olculur; serverNow her
// degistiginde (taze yanit) yeniden olculur. 2 sn alti fark ag gecikmesi titremesidir, uygulanmaz.
// NEDEN aria-live yalniz esiklerde (2026-10-15 denetim): dakikada bir duyuru, varsayilan sinirsiz
// kipte ekran okuyucu kullanicisina SURESIZ olarak her dakika konusmak demekti (4 saatlik geri
// sayim 241 duyuru). Canli bolge kurulusta sessizdir; yalniz cita kosmaya baslayinca, kalan 10 / 5
// / 1 dakikanin altina inince ve sure dolunca konusur. Sinirsiz kipte hic konusmaz. Guncel ozet her
// zaman role=timer'in aria-label'inda (istenince okunur).
// Kompakt (liste) gorunumde canli bolge hic yok - satir basina bir duyuru da gurultu olurdu.
// Renkler yalniz token'dan; animasyonlar prefers-reduced-motion altinda durur.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { fmtDateShort } from '@/utils/datetime';

export interface SmartBeklemeSayaciProps {
  createdAt: string | null | undefined;
  deadline: string | null | undefined;
  serverNow?: string | null;
  /** serverNow'u tasiyan yanitin istemciye ulastigi yerel an (Date.now()). Ust bilesen yaniti
   *  ALDIGI anda kaydeder; verilmezse kayma serverNow'un sayaca ulastigi anda olculur. */
  alindiMs?: number | null;
  kompakt?: boolean;
  className?: string;
}

export type SayacKip = 'geri' | 'sinirsiz';
export type SayacEvre = 'yuru' | 'kos' | 'bitti' | 'bekle';

export interface SayacDurumu {
  kip: SayacKip;
  /** Son tarihe kalan (>= 0). Sinirsiz kipte null. */
  kalanMs: number | null;
  /** Talep acildigindan beri gecen (>= 0). */
  gecenMs: number;
  /** Gecen / toplam, 0..1. Sinirsiz kipte null. */
  oran: number | null;
  evre: SayacEvre;
}

const DAKIKA_MS = 60_000;
/** Kalan sure toplamin bu oraninin altina dusunce cita kosar. */
export const KOS_ORANI = 0.25;
/** Kalan sure bunun altindaysa (toplam ne olursa olsun) cita kosar. */
export const KOS_ESIGI_MS = 10 * DAKIKA_MS;

export function sayacDurumu(
  simdiMs: number,
  createdAtMs: number,
  deadlineMs: number | null,
): SayacDurumu {
  const gecenMs = Math.max(0, simdiMs - createdAtMs);
  if (deadlineMs === null || !Number.isFinite(deadlineMs)) {
    return { kip: 'sinirsiz', kalanMs: null, gecenMs, oran: null, evre: 'bekle' };
  }
  const toplamMs = deadlineMs - createdAtMs;
  const kalanMs = Math.max(0, deadlineMs - simdiMs);
  const oran = toplamMs > 0 ? Math.min(1, Math.max(0, (simdiMs - createdAtMs) / toplamMs)) : 1;
  let evre: SayacEvre;
  if (kalanMs <= 0) evre = 'bitti';
  else if (kalanMs < toplamMs * KOS_ORANI || kalanMs < KOS_ESIGI_MS) evre = 'kos';
  else evre = 'yuru';
  return { kip: 'geri', kalanMs, gecenMs, oran, evre };
}

const iki = (n: number) => String(n).padStart(2, '0');

/** Geri sayim metni: 1 saat ve ustu "2 sa 14 dk", altinda "09:41". Saniye YUKARI yuvarlanir:
 *  sure dolmadan "00:00" gorunmesin. */
export function sureMetni(kalanMs: number): string {
  const sn = Math.max(0, Math.ceil(kalanMs / 1000));
  if (sn >= 3600) return `${Math.floor(sn / 3600)} sa ${iki(Math.floor((sn % 3600) / 60))} dk`;
  return `${iki(Math.floor(sn / 60))}:${iki(sn % 60)}`;
}

/** Gecen sure metni: "45 sn", "12 dk", "1 sa 05 dk". */
export function gecenMetni(gecenMs: number): string {
  const sn = Math.max(0, Math.floor(gecenMs / 1000));
  if (sn < 60) return `${sn} sn`;
  const dk = Math.floor(sn / 60);
  if (dk < 60) return `${dk} dk`;
  return `${Math.floor(dk / 60)} sa ${iki(dk % 60)} dk`;
}

function sozluSure(toplamDk: number, ekli: boolean): string {
  const sa = Math.floor(toplamDk / 60);
  const dk = toplamDk % 60;
  if (sa > 0 && dk === 0) return ekli ? `${sa} saattir` : `${sa} saat`;
  const dkMetni = ekli ? `${dk} dakikadır` : `${dk} dakika`;
  return sa > 0 ? `${sa} saat ${dkMetni}` : dkMetni;
}

/** Ekran okuyucu ozeti - DAKIKA cozunurlugunde (saniyede bir degismez). */
export function ozetMetni(d: SayacDurumu): string {
  if (d.kip === 'sinirsiz') {
    const dk = Math.floor(d.gecenMs / DAKIKA_MS);
    if (dk < 1) return 'Smart onayı 1 dakikadan kısa süredir bekleniyor, süre sınırı yok';
    return `Smart onayı ${sozluSure(dk, true)} bekleniyor, süre sınırı yok`;
  }
  if (d.evre === 'bitti') return 'Smart onayı için süre doldu';
  const dk = Math.floor(Math.ceil((d.kalanMs ?? 0) / 1000) / 60);
  if (dk < 1) return 'Zaman aşımına 1 dakikadan az kaldı';
  return `Zaman aşımına ${sozluSure(dk, false)} kaldı`;
}

/** Canli bolgenin konustugu kalan-sure esikleri (dk), kucukten buyuge. */
export const DUYURU_ESIKLERI_DK = [1, 5, 10] as const;

/** Canli bolge yalniz bu anahtar DEGISINCE konusur (dakikalik ozet degisimi konusturmaz). */
export function duyuruEsigi(d: SayacDurumu): string {
  if (d.kip === 'sinirsiz') return 'sinirsiz';
  if (d.evre === 'bitti') return 'bitti';
  const kalan = d.kalanMs ?? 0;
  for (const dk of DUYURU_ESIKLERI_DK) if (kalan < dk * DAKIKA_MS) return `e${dk}`;
  return d.evre;
}

/** Esige girildiginde okunacak cumle (o andaki durumdan; esik boyunca SABIT kalir). */
export function duyuruMetni(esik: string, d: SayacDurumu): string {
  if (esik === 'sinirsiz') return '';
  if (esik === 'e5' || esik === 'e10') return `Zaman aşımına ${esik.slice(1)} dakikadan az kaldı`;
  return ozetMetni(d);
}

const SINIRSIZ_ACIKLAMA = "Süre sınırı yok — talep onaylanana ya da Smart'ta reddedilene kadar bekler.";

function tarihMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/** Kayma = sunucu saati - yanitin alindigi yerel an (alindiMs yoksa `yerelMs`). */
export function kaymaOlc(
  serverNow: string | null | undefined,
  alindiMs: number | null | undefined,
  yerelMs: number,
): number | null {
  const sunucu = tarihMs(serverNow);
  if (sunucu === null) return null;
  const alindi = typeof alindiMs === 'number' && Number.isFinite(alindiMs) ? alindiMs : yerelMs;
  return sunucu - alindi;
}

/** Bu kadar kucuk kayma farki ag gecikmesi titremesidir; sayi ziplamasin diye uygulanmaz. */
export const KAYMA_ESIGI_MS = 2000;

// Parkurdaki figurun genisligi (px). Ilerleme cizgisi ve serit hesabi buna gore.
const FIGUR_W = 56;

// NEDEN <style precedence>: React 19 ayni href'li stili <head>'e bir kez tasir; tabloda 50 satir
// olsa da kural bir kez yazilir. Sinif oneki `sbs-` (Smart Bekleme Sayaci).
const STIL = `
.sbs{--sbs-renk:var(--accent);--sbs-figur-w:${FIGUR_W}px;display:block;color:var(--text-primary)}
.sbs[data-evre="kos"]{--sbs-renk:var(--status-warning-text)}
.sbs[data-evre="bitti"]{--sbs-renk:var(--status-danger-text)}
.sbs-deger{font-family:var(--font-display);font-size:1.75rem;line-height:1.1;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-0.01em}
.sbs[data-evre="kos"] .sbs-deger,.sbs[data-evre="bitti"] .sbs-deger{color:var(--sbs-renk)}
.sbs-alt{margin-top:2px;display:flex;flex-wrap:wrap;gap:0 6px;font-size:12px;color:var(--text-secondary)}
.sbs-alt time{font-variant-numeric:tabular-nums;font-weight:600;color:var(--text-primary)}
.sbs-aciklama{margin-top:4px;font-size:12px;color:var(--text-muted)}
.sbs-parkur{position:relative;margin-top:10px;padding-right:18px;height:38px;overflow:hidden}
.sbs-alan{position:relative;height:100%}
.sbs-cizgi{position:absolute;left:0;right:-18px;bottom:1px;height:2px;border-radius:1px;background:var(--border-strong)}
.sbs-cizgi::before{content:"";position:absolute;left:0;bottom:-3px;width:2px;height:8px;border-radius:1px;background:var(--border-strong)}
.sbs[data-kip="sinirsiz"] .sbs-cizgi{background:repeating-linear-gradient(90deg,var(--border-strong) 0 6px,transparent 6px 11px)}
.sbs-dolu{position:absolute;left:0;bottom:1px;height:2px;border-radius:1px;background:var(--sbs-renk);opacity:.7;transition:width 1s linear}
.sbs-bayrak{position:absolute;right:2px;bottom:3px;width:14px;height:24px;color:var(--text-secondary)}
.sbs[data-evre="kos"] .sbs-bayrak,.sbs[data-evre="bitti"] .sbs-bayrak{color:var(--sbs-renk)}
.sbs-bayrak svg{display:block;width:100%;height:100%}
.sbs-serit{position:absolute;left:0;top:0;bottom:0;width:calc(100% - var(--sbs-figur-w))}
.sbs-konum{position:absolute;bottom:2px;width:var(--sbs-figur-w);transition:left 1s linear}
.sbs-yon{display:block}
.sbs-serit--devriye{width:calc(60% - var(--sbs-figur-w));animation:sbs-devriye 16s linear infinite}
.sbs-serit--devriye .sbs-yon{animation:sbs-yon 16s step-end infinite}
.sbs-cita{display:block;width:100%;height:auto;overflow:visible;color:var(--sbs-renk)}
.sbs-cita g,.sbs-cita path{transform-box:view-box}
.sbs-bacak{animation:sbs-adim .6s ease-in-out infinite alternate}
.sbs-b-ay{transform-origin:17px 18px}
.sbs-b-au{transform-origin:19.5px 18px;animation-delay:-.6s}
.sbs-b-oy{transform-origin:42px 19px;animation-delay:-.6s}
.sbs-b-ou{transform-origin:39.5px 19px}
.sbs-beden{animation:sbs-zipla .6s ease-in-out infinite}
.sbs-kuyruk{transform-origin:13.5px 14.5px;animation:sbs-kuyruk 1.2s ease-in-out infinite alternate}
.sbs-egim{transform-origin:32px 22px;transition:transform .4s ease-out}
.sbs[data-evre="kos"] .sbs-egim{transform:rotate(4deg) scaleX(1.07)}
.sbs[data-evre="kos"] .sbs-bacak{animation-name:sbs-adim-kos;animation-duration:.175s}
.sbs[data-evre="kos"] .sbs-b-ay{animation-delay:0s}
.sbs[data-evre="kos"] .sbs-b-au{animation-delay:-.02s}
.sbs[data-evre="kos"] .sbs-b-oy{animation-delay:-.175s}
.sbs[data-evre="kos"] .sbs-b-ou{animation-delay:-.195s}
.sbs[data-evre="kos"] .sbs-beden{animation-name:sbs-zipla-kos;animation-duration:.35s}
.sbs[data-evre="kos"] .sbs-kuyruk{animation:none;transform:rotate(22deg)}
.sbs[data-evre="bitti"] .sbs-cita *{animation:none}
.sbs-hiz{position:absolute;right:100%;top:28%;width:20px;height:12px;margin-right:2px;display:none}
.sbs[data-evre="kos"] .sbs-hiz{display:block}
.sbs-hiz span{position:absolute;right:0;height:1.5px;border-radius:1px;background:var(--sbs-renk);opacity:.5;animation:sbs-hiz .45s linear infinite}
.sbs-hiz span:nth-child(1){top:0;width:12px}
.sbs-hiz span:nth-child(2){top:5px;width:18px;animation-delay:-.15s}
.sbs-hiz span:nth-child(3){top:10px;width:9px;animation-delay:-.3s}
.sbs--kompakt{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:1;white-space:nowrap;vertical-align:middle;color:var(--text-secondary)}
.sbs-kfigur{display:inline-block;flex:none;width:32px}
.sbs-kdeger{font-weight:600;font-variant-numeric:tabular-nums;color:var(--text-primary)}
.sbs--kompakt[data-evre="kos"] .sbs-kdeger,.sbs--kompakt[data-evre="bitti"] .sbs-kdeger{color:var(--sbs-renk)}
@keyframes sbs-adim{from{transform:rotate(-16deg)}to{transform:rotate(16deg)}}
@keyframes sbs-adim-kos{from{transform:rotate(-40deg)}to{transform:rotate(36deg)}}
@keyframes sbs-zipla{0%,100%{transform:translateY(0)}50%{transform:translateY(-.7px)}}
@keyframes sbs-zipla-kos{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.6px)}}
@keyframes sbs-kuyruk{from{transform:rotate(-5deg)}to{transform:rotate(7deg)}}
@keyframes sbs-hiz{0%{transform:translateX(4px);opacity:0}30%{opacity:.85}100%{transform:translateX(-12px);opacity:0}}
@keyframes sbs-devriye{0%,100%{transform:translateX(0)}50%{transform:translateX(100%)}}
@keyframes sbs-yon{0%{transform:scaleX(1)}50%{transform:scaleX(-1)}}
@media (prefers-reduced-motion: reduce){.sbs *,.sbs *::before,.sbs *::after{animation:none!important;transition:none!important}}
`;

/** Cita silueti: tek renk (currentColor), saga bakar. Uzak bacaklar yari saydam (derinlik). */
function Cita() {
  const bacak = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <svg className="sbs-cita" viewBox="0 0 64 34" aria-hidden="true" focusable="false">
      <g className="sbs-egim">
        <g className="sbs-beden">
          <path className="sbs-bacak sbs-b-au" d="M19.5 18 L18 25.6 L20 32.4 L21.8 32.6" strokeWidth={1.9} opacity={0.5} {...bacak} />
          <path className="sbs-bacak sbs-b-ou" d="M39.5 19 L40 26 L39.8 32.4 L41.8 32.6" strokeWidth={1.9} opacity={0.5} {...bacak} />
          <path
            className="sbs-kuyruk"
            d="M13.5 14.5 C9 13.5 6 15.5 4.5 19 C3.5 21.5 3.6 24 5.2 24.6"
            strokeWidth={1.7}
            {...bacak}
          />
          <path
            fill="currentColor"
            d="M13 14 C17 11.2 27 12.2 35 12 C40 11.8 44 12.4 46 15 C47.5 17.5 46.5 21 42.5 21.6 C37 22.2 33 19.6 27 19.8 C22 20 19.5 21.8 16 21 C12.5 20.2 11.6 16.5 13 14 Z"
          />
          <path fill="currentColor" d="M41 13.5 C44 10.5 47 9 50 8.6 L51.5 13.2 C49 14 47 15.6 45.5 17.5 Z" />
          <ellipse fill="currentColor" cx={51.3} cy={10.6} rx={3.6} ry={2.9} />
          <path fill="currentColor" d="M53.5 9.6 C55.6 9.8 56.8 10.8 56.6 11.8 C56.4 12.7 54.6 13.1 52.8 12.9 Z" />
          <path fill="currentColor" d="M48.6 8.6 L49.2 6.6 L50.8 8.1 Z" />
          <path className="sbs-bacak sbs-b-ay" d="M17 18 L15.4 25.6 L17.6 32.4 L19.4 32.6" strokeWidth={2.2} {...bacak} />
          <path className="sbs-bacak sbs-b-oy" d="M42 19 L42.6 26 L42.4 32.4 L44.4 32.6" strokeWidth={2.2} {...bacak} />
        </g>
      </g>
    </svg>
  );
}

/** Damali bitis bayragi (tek renk; damalar saydamlikla). */
function Bayrak() {
  const kareler: ReactElement[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      kareler.push(
        <rect key={`${r}-${c}`} x={2.6 + c * 2.6} y={1 + r * 2.6} width={2.6} height={2.6} fill="currentColor" opacity={(r + c) % 2 === 0 ? 1 : 0.25} />,
      );
    }
  }
  return (
    <span className="sbs-bayrak" aria-hidden="true">
      <svg viewBox="0 0 14 24" focusable="false">
        <rect x={1} y={0} width={1.6} height={24} rx={0.8} fill="currentColor" />
        {kareler}
      </svg>
    </span>
  );
}

function HizCizgileri() {
  return (
    <span className="sbs-hiz" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function SmartBeklemeSayaci({
  createdAt,
  deadline,
  serverNow,
  alindiMs,
  kompakt = false,
  className,
}: SmartBeklemeSayaciProps) {
  // Ilk render: kayma (serverNow - yanitin alindigi an) ve "simdi" ayni anda olculur.
  const [ilk] = useState(() => {
    const yerel = Date.now();
    const kayma = kaymaOlc(serverNow, alindiMs, yerel);
    return { kayma, simdi: yerel + (kayma ?? 0) };
  });
  const kaymaRef = useRef<number | null>(ilk.kayma);
  const [simdi, setSimdi] = useState(ilk.simdi);

  // NEDEN her serverNow degisiminde: yeni deger TAZE bir yanit demek. Ust bilesen sayaci yanit
  // gelmeden (serverNow bos) ya da bayat bir yanitla kurmus olabilir; ilk taze yanit kaymayi
  // duzeltir. Ref yazimi render tetiklemez; bir sonraki tik (<= 1 sn) yeni kaymayi kullanir.
  useEffect(() => {
    const yeni = kaymaOlc(serverNow, alindiMs, Date.now());
    if (yeni === null) return;
    const eski = kaymaRef.current;
    if (eski === null || Math.abs(yeni - eski) > KAYMA_ESIGI_MS) kaymaRef.current = yeni;
  }, [serverNow, alindiMs]);

  const etkin = tarihMs(createdAt) !== null;
  useEffect(() => {
    if (!etkin) return undefined;
    const tikla = () => setSimdi(Date.now() + (kaymaRef.current ?? 0));
    // NEDEN ilk tik 0 ms'de: sayac sonradan etkinlesirse (createdAt gec geldi) "simdi" bayat kalmasin.
    const ilkTik = setTimeout(tikla, 0);
    const aralik = setInterval(tikla, 1000);
    return () => {
      clearTimeout(ilkTik);
      clearInterval(aralik);
    };
  }, [etkin]);

  const createdMs = tarihMs(createdAt);
  const deadlineMs = tarihMs(deadline);
  const d = createdMs === null ? null : sayacDurumu(simdi, createdMs, deadlineMs);

  // CANLI BOLGE: kurulusta (ve sayac ilk kez cizildiginde) SESSIZ; esik degisince o anin cumlesi
  // yazilir ve bir sonraki esige kadar SABIT kalir. NEDEN render sirasinda: React'in "girdi
  // degisince state'i render'da ayarla" deseni - effect + setState bir render gec kalirdi.
  const esik = d ? duyuruEsigi(d) : null;
  const [duyuru, setDuyuru] = useState<{ esik: string | null; metin: string }>({ esik, metin: '' });
  if (d && esik !== null && duyuru.esik !== esik) {
    setDuyuru({ esik, metin: duyuru.esik === null ? '' : duyuruMetni(esik, d) });
  }

  if (createdMs === null || d === null) return null;
  const ozet = ozetMetni(d);
  const sonTarih = deadlineMs !== null ? fmtDateShort(deadlineMs) : '';
  const kok = ['sbs', kompakt ? 'sbs--kompakt' : '', className ?? ''].filter(Boolean).join(' ');
  const stil = (
    <style href="smart-bekleme-sayaci" precedence="default">
      {STIL}
    </style>
  );
  const canli = (
    <span className="sr-only" aria-live="polite" data-testid="sbs-canli">
      {duyuru.metin}
    </span>
  );

  if (kompakt) {
    const metin =
      d.kip === 'sinirsiz' ? (
        <>
          Bekliyor <span className="sbs-kdeger">{gecenMetni(d.gecenMs)}</span>
        </>
      ) : d.evre === 'bitti' ? (
        <span className="sbs-kdeger">Süre doldu</span>
      ) : (
        <>
          Kalan <span className="sbs-kdeger">{sureMetni(d.kalanMs ?? 0)}</span>
        </>
      );
    return (
      <span
        className={kok}
        role="timer"
        aria-label={ozet}
        data-kip={d.kip}
        data-evre={d.evre}
        title={d.kip === 'sinirsiz' ? SINIRSIZ_ACIKLAMA : `Son tarih ${sonTarih}`}
      >
        {stil}
        <span className="sbs-kfigur" aria-hidden="true">
          <Cita />
        </span>
        <span aria-hidden="true" data-testid="sbs-metin">
          {metin}
        </span>
        {/* NEDEN canli bolge YOK (2026-10-15, entegrasyon): kompakt sayac listelerde (Taleplerim,
            Admin > Smart Talepleri) satir basina bir tane; her biri dakikada bir okunursa ekran
            okuyucu susmaz. Ozet aria-label'da (role=timer) - satira gelince okunur. */}
      </span>
    );
  }

  const sinirsiz = d.kip === 'sinirsiz';
  const oran = d.oran ?? 0;
  return (
    <div className={kok} role="timer" aria-label={ozet} data-kip={d.kip} data-evre={d.evre}>
      {stil}
      <div aria-hidden="true">
        <div className="sbs-deger" data-testid="sbs-deger">
          {sinirsiz ? gecenMetni(d.gecenMs) : d.evre === 'bitti' ? 'Süre doldu' : sureMetni(d.kalanMs ?? 0)}
        </div>
        {sinirsiz ? (
          <>
            <div className="sbs-alt">
              <span>Bekleme süresi</span>
            </div>
            <div className="sbs-aciklama">{SINIRSIZ_ACIKLAMA}</div>
          </>
        ) : (
          <div className="sbs-alt">
            <span>{d.evre === 'bitti' ? 'Talep zaman aşımına uğruyor' : 'Zaman aşımına kalan'}</span>
            <span>·</span>
            <span>
              Son tarih <time dateTime={new Date(deadlineMs as number).toISOString()}>{sonTarih}</time>
            </span>
          </div>
        )}
      </div>
      <div className="sbs-parkur" aria-hidden="true">
        <div className="sbs-alan">
          <div className="sbs-cizgi" />
          {!sinirsiz && (
            <div className="sbs-dolu" style={{ width: `calc((100% - ${FIGUR_W}px) * ${oran} + ${FIGUR_W / 2}px)` }} />
          )}
          <div className={sinirsiz ? 'sbs-serit sbs-serit--devriye' : 'sbs-serit'}>
            <div className="sbs-konum" data-testid="sbs-konum" style={{ left: sinirsiz ? 0 : `${oran * 100}%` }}>
              <HizCizgileri />
              <span className="sbs-yon">
                <Cita />
              </span>
            </div>
          </div>
        </div>
        {!sinirsiz && <Bayrak />}
      </div>
      {canli}
    </div>
  );
}

export default SmartBeklemeSayaci;
