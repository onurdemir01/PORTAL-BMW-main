// src/components/intranetSpa.ts — Nginx ARK SPA > Intranet SPA geçiş takvimi: saf yardımcılar
// (tarih gösterimi, süzgeç, sıralama, CSV, set ilerlemesi). Sayfa: IntranetSpaPage.tsx. Takvim, set
// planı ve alan önceliği sunucuda (server/spa-report/intranet-takvim.cjs, intranet-set-plani.cjs);
// burada yalnız gösterim ve DC başına ilerleme hesabı.
import type { TakvimPlanSatir, TakvimSatir } from '@/api/arkSpaApi';
import { fmtOran, fmtYuzde } from '@/utils/datetime';

const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** ISO (yyyy-mm-dd) → "gg.aa.yyyy GünAdı" (yüklenen listeyle aynı biçim). Geçersizse olduğu gibi. */
export function tarihGoster(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  const gun = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${m[3]}.${m[2]}.${m[1]} ${GUNLER[gun]}`;
}

/** Pilot, Set 1..N; set içinde sıra; eşitlikte namespace / uygulama. */
export function takvimSirala(rows: readonly TakvimSatir[]): TakvimSatir[] {
  return [...rows].sort(
    (a, b) =>
      a.setSira - b.setSira ||
      a.sira - b.sira ||
      a.namespace.localeCompare(b.namespace) ||
      a.uygulama.localeCompare(b.uygulama),
  );
}

export interface TakvimSuzgec {
  set: string;
  ekip: string;
  q: string;
}

export function suzTakvim(rows: readonly TakvimSatir[], f: TakvimSuzgec): TakvimSatir[] {
  const ara = f.q.trim().toLocaleLowerCase('tr');
  return rows.filter((r) => {
    if (f.set !== 'all' && r.set !== f.set) return false;
    if (f.ekip !== 'all' && r.ekip !== f.ekip) return false;
    if (!ara) return true;
    return [
      r.namespace,
      r.uygulama,
      r.ekip,
      r.ekipEposta,
      r.routeAdresleri,
      r.aciklama,
      r.set,
      tarihGoster(r.gecisTarihi),
    ]
      .join(' ')
      .toLocaleLowerCase('tr')
      .includes(ara);
  });
}

/** Yükleme / indirme sözleşmesi: ekrandaki 11 sütun, bu sırayla. */
export const TAKVIM_CSV_BASLIK = [
  'set',
  'gecis_tarihi',
  'sira',
  'ekip',
  'ekip_eposta',
  'namespace',
  'uygulama',
  'route_adresleri',
  'dynatrace_durumu',
  'dynatrace_istek',
  'aciklama',
] as const;

/** CSV formül enjeksiyonu (OWASP): =, +, -, @, TAB, CR ile başlayan hücre Excel'de formül olarak
 *  çalışır. Açıklama ortak uygulama notudur, yüklenen liste de serbest metin taşır: başına ' konur. */
function formulsuz(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function takvimCsvSatirlari(rows: readonly TakvimSatir[]): string[][] {
  return rows.map((r) => takvimCsvHam(r).map(formulsuz));
}

function takvimCsvHam(r: TakvimSatir): string[] {
  return [
    r.set,
    tarihGoster(r.gecisTarihi),
    String(r.sira),
    r.ekip,
    r.ekipEposta,
    r.namespace,
    r.uygulama,
    r.routeAdresleri,
    r.dynatraceDurumu,
    r.dynatraceIstek,
    r.aciklama,
  ];
}

/** Takvim satırı anahtarı (set, namespace, uygulama): uygulama her DC'nin setinde ayrı satırdır. */
export const satirAnahtari = (r: Pick<TakvimSatir, 'set' | 'namespace' | 'uygulama'>) =>
  `${r.set}|${r.namespace}/${r.uygulama}`;

/** Set içindeki satır anahtarı: set planı düzeltmesinin `beklenen` sözlüğü (sunucuyla aynı). */
export const setIciAnahtar = (r: Pick<TakvimSatir, 'namespace' | 'uygulama'>) =>
  `${r.namespace}/${r.uygulama}`;

// ── SET İLERLEMESİ ───────────────────────────────────────────────────────────
export type SetDurum = 'gecti' | 'bugun' | 'planli';
export const SET_DURUM_METIN: Record<SetDurum, string> = {
  gecti: 'Geçti',
  bugun: 'Bugün',
  planli: 'Planlı',
};

export interface SetIlerleme {
  set: string;
  setSira: number;
  /** Set planı satırı; takvimde olup planda olmayan sette null ("plan yok"). */
  plan: TakvimPlanSatir | null;
  /** Setin tarihi: plandan; plan yoksa satırların en sık tarihi (eşitlikte en erken). */
  tarih: string | null;
  uygulama: number;
  /** Bu DC'deki takvim satırı toplamına oran (0..1, kullanıcının tablosundaki gibi 0,156); toplam 0
   *  ise null. */
  pay: number | null;
  /** DC içinde bu sete kadar (dahil) geçmiş olacak uygulama sayısı. */
  kumulatif: number;
  yuzde: number | null;
  durum: SetDurum | null;
  /** Tarihi setin tarihinden farklı uygulama sayısı (tek satır düzeltmesi). */
  farkliTarih: number;
}

export interface DcGrubu {
  /** Boş = DC belirtilmemiş (plan yok ya da planda DC boş). Gruplama kırpılmış ve harf duyarsız
   *  (sunucunun aynı DC uyarısıyla aynı kural); görünen ad grubun ilk setinin yazımı. */
  dc: string;
  toplam: number;
  setler: SetIlerleme[];
}

function enSikTarih(tarihler: readonly string[]): string | null {
  const say = new Map<string, number>();
  for (const t of tarihler) say.set(t, (say.get(t) || 0) + 1);
  let en: string | null = null;
  for (const [t, n] of [...say.entries()].sort((a, b) => a[0].localeCompare(b[0])))
    if (en === null || n > (say.get(en) || 0)) en = t;
  return en;
}

function durumOf(tarih: string | null, bugun: string): SetDurum | null {
  if (!tarih) return null;
  if (tarih < bugun) return 'gecti';
  return tarih === bugun ? 'bugun' : 'planli';
}

/**
 * DC başına set ilerlemesi (kullanıcının takvim tablosu: Set | Tarih | DC | Eski IP | Yeni IP |
 * Uygulama | Setin payı | Toplam geçmiş olacak | Toplamın yüzdesi | Durum). Sabit sayı yok: uygulama
 * sayısı takvim satırlarından, pay ve yüzde paydası o DC'deki takvim satırı toplamı. Gruplar plan
 * sırasıyla (grubun ilk seti), "DC belirtilmemiş" en sonda; planda olup uygulaması 0 olan set de
 * görünür. `bugun` PORTAL_TZ takvim günü (utils/datetime portalGunu).
 */
export function setIlerlemesi(
  rows: readonly TakvimSatir[],
  plan: readonly TakvimPlanSatir[],
  bugun: string,
): DcGrubu[] {
  const satirlar = new Map<string, TakvimSatir[]>();
  for (const r of rows) {
    const s = satirlar.get(r.set);
    if (s) s.push(r);
    else satirlar.set(r.set, [r]);
  }
  const planM = new Map(plan.map((p) => [p.set, p]));
  const adlar = new Map<string, number>();
  for (const p of plan) adlar.set(p.set, p.setSira);
  for (const r of rows) if (!adlar.has(r.set)) adlar.set(r.set, r.setSira);
  const gruplar = new Map<string, DcGrubu & { ilk: number }>();
  for (const [set, setSira] of [...adlar.entries()].sort((a, b) => a[1] - b[1])) {
    const p = planM.get(set) || null;
    const s = satirlar.get(set) || [];
    const tarih = p ? p.gecisTarihi : enSikTarih(s.map((r) => r.gecisTarihi));
    const dc = p?.dc.trim() || '';
    const anahtar = dc.toLowerCase();
    let g = gruplar.get(anahtar);
    if (!g) {
      g = { dc, toplam: 0, setler: [], ilk: dc ? setSira : Number.POSITIVE_INFINITY };
      gruplar.set(anahtar, g);
    }
    g.toplam += s.length;
    g.setler.push({
      set,
      setSira,
      plan: p,
      tarih,
      uygulama: s.length,
      pay: null,
      kumulatif: 0,
      yuzde: null,
      durum: durumOf(tarih, bugun),
      farkliTarih: s.filter((r) => r.gecisTarihi !== tarih).length,
    });
  }
  return [...gruplar.values()]
    .sort((a, b) => a.ilk - b.ilk)
    .map((g) => {
      let kumulatif = 0;
      const setler = g.setler.map((s) => {
        kumulatif += s.uygulama;
        return {
          ...s,
          kumulatif,
          pay: g.toplam ? s.uygulama / g.toplam : null,
          yuzde: g.toplam ? (kumulatif / g.toplam) * 100 : null,
        };
      });
      return { dc: g.dc, toplam: g.toplam, setler };
    });
}

export const DC_BELIRTILMEMIS = 'DC belirtilmemiş';

export const ILERLEME_CSV_BASLIK = [
  'Set',
  'Tarih',
  'DC',
  'Eski IP',
  'Yeni IP',
  'Uygulama',
  'Setin payı',
  'Toplam geçmiş olacak',
  'Toplamın yüzdesi',
  'Durum',
] as const;

/** Set ilerlemesi durum metni: "Geçti", "Planlı · 2 uygulama farklı tarihte", plansız set için ek. */
export function durumMetni(s: SetIlerleme): string {
  const parca = [s.durum ? SET_DURUM_METIN[s.durum] : ''];
  if (s.farkliTarih) parca.push(`${s.farkliTarih} uygulama farklı tarihte`);
  if (!s.plan) parca.push('plan yok');
  return parca.filter(Boolean).join(' · ');
}

export function ilerlemeCsvSatirlari(gruplar: readonly DcGrubu[]): string[][] {
  return gruplar.flatMap((g) =>
    g.setler.map((s) =>
      [
        s.set,
        s.tarih ? tarihGoster(s.tarih) : '',
        g.dc || DC_BELIRTILMEMIS,
        s.plan?.eskiIp || '',
        s.plan?.yeniIp || '',
        String(s.uygulama),
        fmtOran(s.pay),
        String(s.kumulatif),
        fmtYuzde(s.yuzde),
        durumMetni(s),
      ].map(formulsuz),
    ),
  );
}
