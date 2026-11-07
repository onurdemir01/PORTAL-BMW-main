// src/components/server_hub/uygulama360.ts — Uygulama 360 sekmesinin saf yardımcıları (2026-11-07).
//
// DURUM DİLİ (retireEtiket.ts ile aynı): ölçülemeyen hiçbir şey "yok" ya da "sorun yok" görünmez; yeşil
// yalnız ölçülmüş iyi durumdur. Hızlı çipler satırın kendi sayılarından süzer (sunucuya gitmez).
import type { Sh360Kopya, Sh360Ortam, Sh360Ozet } from '@/api/serverHubApi';

export type U360Hizli =
  'hepsi' | 'retire' | 'autostart' | 'kopya' | 'kalinti' | 'ocp' | 'retirement';

export const U360_HIZLI: { id: U360Hizli; etiket: string; aciklama: string }[] = [
  { id: 'hepsi', etiket: 'hepsi', aciklama: 'Bütün uygulamalar.' },
  {
    id: 'retire',
    etiket: 'retire adayı',
    aciklama: 'Kesin ya da şüpheli Retirement etiketi olan uygulamalar.',
  },
  {
    id: 'autostart',
    etiket: 'auto-start uyumsuz',
    aciklama: 'Bir kopyası çalışıyor ama auto-start kapalı ya da kapalı ama auto-start açık.',
  },
  {
    id: 'kopya',
    etiket: 'kopyalar tutarsız',
    aciklama: 'Aynı ortamdaki kopyalardan biri kapalı ya da auto-start’ı farklı.',
  },
  {
    id: 'kalinti',
    etiket: 'prod’da yok, test yaşıyor',
    aciklama: 'Prod’da çalışan kopya yok ama DEV / TEST / QA kopyası çalışıyor.',
  },
  {
    id: 'ocp',
    etiket: 'OpenShift’te de var',
    aciklama: 'Aynı uygulama OpenShift envanterinde aynı ortamda var.',
  },
  {
    id: 'retirement',
    etiket: 'Retirement’ta / çelişkili',
    aciklama: 'Retirement kaydı olan ya da kaydıyla çelişen uygulamalar.',
  },
];

const SUZ: Record<U360Hizli, (u: Sh360Ozet) => boolean> = {
  hepsi: () => true,
  retire: (u) => !!u.etiket,
  autostart: (u) => u.autostartUyumsuz > 0,
  kopya: (u) => u.kopyaTutarsiz > 0,
  kalinti: (u) => u.kalinti > 0,
  ocp: (u) => !!u.ocp,
  retirement: (u) => u.retirement.length > 0 || u.celiski > 0,
};
export const u360Suz = (l: Sh360Ozet[], h: U360Hizli) => l.filter(SUZ[h] || SUZ.hepsi);
export const u360Say = (l: Sh360Ozet[]) =>
  Object.fromEntries(U360_HIZLI.map((h) => [h.id, l.filter(SUZ[h.id]).length])) as Record<
    U360Hizli,
    number
  >;

export type U360Ton = 'iyi' | 'uyari' | 'kotu' | 'notr';

/** Ortam rozeti: "PROD 2/3" — hepsi açık iyi, hiçbiri açık değil kötü, ölçülemeyen varsa nötr. */
export function ortamRozeti(o: Sh360Ortam): { metin: string; ton: U360Ton; title: string } {
  const title = `${o.ortam}: ${o.acik} açık, ${o.kapali} kapalı${o.olculemedi ? `, ${o.olculemedi} ölçülemedi` : ''} (toplam ${o.toplam})`;
  const ton: U360Ton = o.olculemedi
    ? 'notr'
    : o.acik === o.toplam
      ? 'iyi'
      : o.acik === 0
        ? 'kotu'
        : 'uyari';
  return { metin: `${o.ortam} ${o.acik}/${o.toplam}`, ton, title };
}

export const TRAFIK_METNI: Record<string, string> = {
  ACTIVE: 'var',
  NO_RECENT_TRAFFIC: 'yok (7 gün)',
  OLCULEMEDI: 'ölçülemedi',
  UNREADABLE: 'ölçülemedi (log okunamadı)',
  UNVERIFIED: 'ölçülemedi (doğrulanamadı)',
};
export const DEPLOYMENT_METNI: Record<string, string> = {
  OK: 'OK',
  FAILED: 'FAILED',
  YOK: 'deployment yok',
  KAPALI: 'devre dışı',
  OLCULEMEDI: 'ölçülemedi',
};

/** OpenShift hücresi: okunamadıysa "okunamadı" ("yok" demez). */
export function ocpMetni(u: Sh360Ozet, okunamadi: boolean): string {
  if (u.ocp) return u.ocp.tasinmisOlabilir ? 'taşınmış olabilir' : 'var';
  return okunamadi ? 'okunamadı' : 'yok';
}

/** Kopyanın rozetleri (matris hücresi): çalışma, auto-start, trafik ve risk işaretleri. */
export function kopyaRozetleri(k: Sh360Kopya): { metin: string; ton: U360Ton; title?: string }[] {
  const r: { metin: string; ton: U360Ton; title?: string }[] = [];
  r.push(
    k.calisiyor === null
      ? {
          metin: 'ölçülemedi',
          ton: 'notr',
          title: 'Süreç görünmüyor (hidepid / ps körlüğü): kapalı sayılmaz',
        }
      : k.calisiyor
        ? { metin: 'çalışıyor', ton: 'iyi' }
        : { metin: 'kapalı', ton: 'uyari' },
  );
  r.push({
    metin: `auto-start ${k.autoStart === 'true' ? 'açık' : k.autoStart === 'false' ? 'kapalı' : '?'}`,
    ton: k.autostartUyumsuz ? 'kotu' : 'notr',
    title: k.autostartUyumsuz
      ? k.autostartUyumsuz === 'REBOOT_RISK'
        ? 'Çalışıyor ama auto-start kapalı: reboot sonrası açılmaz'
        : 'Kapalı ama auto-start açık: reboot’ta açılır'
      : undefined,
  });
  if (k.trafik) r.push({ metin: `trafik ${TRAFIK_METNI[k.trafik] || k.trafik}`, ton: 'notr' });
  if (k.capraz?.kopya) r.push({ metin: 'kopyalardan farklı', ton: 'uyari' });
  if (k.capraz?.kalinti) r.push({ metin: 'prod’da yok', ton: 'uyari' });
  if (k.capraz?.celiski.length)
    r.push({
      metin: 'Retirement ile çelişiyor',
      ton: 'kotu',
      title: `Retirement #${k.capraz.celiski.map((c) => c.kayit).join(', #')}`,
    });
  if (!k.taze)
    r.push({
      metin: `bayat (${k.taramaTarihi || '?'})`,
      ton: 'notr',
      title: 'Tarama bayat: karar vermez',
    });
  return r;
}

/** Ortam × sunucu matrisi: ortam satırları (PROD önce), her satırda sunucunun kopyaları. */
export function matris(
  kopyalar: Sh360Kopya[],
): { ortam: string; hucreler: { host: string; kopyalar: Sh360Kopya[] }[] }[] {
  const sira: string[] = [];
  const m = new Map<string, Map<string, Sh360Kopya[]>>();
  for (const k of kopyalar) {
    if (!m.has(k.ortam)) {
      m.set(k.ortam, new Map());
      sira.push(k.ortam);
    }
    const s = m.get(k.ortam)!;
    if (!s.has(k.host)) s.set(k.host, []);
    s.get(k.host)!.push(k);
  }
  return sira.map((ortam) => ({
    ortam,
    hucreler: [...m.get(ortam)!.entries()].map(([host, l]) => ({ host, kopyalar: l })),
  }));
}
