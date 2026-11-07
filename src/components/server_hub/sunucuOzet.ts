// src/components/server_hub/sunucuOzet.ts — Sunucu panelinin özet kartları ve zincir rozetleri (2026-11-07; saf).
//
// Kullanıcı: "basitleştirilmiş görünümden istedikçe açılan, özelleşen, bilgi veren ekranlar". Panel üstünde
// beş kart (bulgular, Retirement etiketi, trafik, Uygulama Envanteri, auto-start uyumu): her kart kendi
// bölümünü açar. Zincir kartı önce tek satır rozet (JVM · EAR · web · trafik), ayrıntı tıklayınca.
// DURUM DİLİ: ölçülemeyen ya da okunamayan hiçbir şey yeşil / "yok" görünmez.
import type { ShHostDetail, ShJvm, ShRetireEtiketHer } from '@/api/serverHubApi';
import { deploymentMetni } from './retireEtiket';

export type OzetTon = 'iyi' | 'uyari' | 'kotu' | 'notr';
export type BolumId = 'neYapmali' | 'uygulamalar' | 'bulgular' | 'etiketler' | 'dogrulama';
export interface OzetKarti {
  id: 'bulgular' | 'etiketler' | 'trafik' | 'envanter' | 'autostart';
  baslik: string;
  deger: string;
  ton: OzetTon;
  /** Kart tıklanınca açılacak bölüm. */
  bolum: BolumId;
  title?: string;
}

/** JVM'in web trafiği: biri ACTIVE ise var; hepsi ölçülüp boşsa yok; aksi halde (eşlenmeyen dahil) ölçülemedi. */
export function jvmTrafik(j: Pick<ShJvm, 'vhosts'>): 'ACTIVE' | 'NO_RECENT_TRAFFIC' | 'OLCULEMEDI' {
  const t = (j.vhosts || []).map((v) => v.trafficState || null);
  if (t.includes('ACTIVE')) return 'ACTIVE';
  if (t.length && t.every((x) => x === 'NO_RECENT_TRAFFIC')) return 'NO_RECENT_TRAFFIC';
  return 'OLCULEMEDI';
}

/** assess'teki REBOOT_RISK / STOPPED_AUTOSTART_ON ile aynı koşul; ölçülemeyen çalışma karar vermez. */
export const autostartUyumsuz = (
  j: Pick<ShJvm, 'running' | 'autoStart'> & { runningKnown?: boolean },
) =>
  j.runningKnown !== false &&
  ((j.running && j.autoStart === 'false') || (!j.running && j.autoStart === 'true'));

export function ozetKartlari(d: ShHostDetail, etiketler: ShRetireEtiketHer[] | null): OzetKarti[] {
  const kritik = d.findings.filter((f) => f.severity === 'danger').length;
  const uyari = d.findings.filter((f) => f.severity === 'warning').length;
  const jvms = d.jvms || [];
  const tr = jvms.map(jvmTrafik);
  const aktif = tr.filter((t) => t === 'ACTIVE').length;
  const bos = tr.filter((t) => t === 'NO_RECENT_TRAFFIC').length;
  const olc = tr.length - aktif - bos;
  const uyumsuz = jvms.filter(autostartUyumsuz).length;
  const seviye = etiketler
    ? etiketler.some((e) => e.seviye === 'KESIN')
      ? 'KESIN'
      : etiketler.length
        ? 'SUPHELI'
        : null
    : undefined;
  const ear = d.ear;
  const envanter: Pick<OzetKarti, 'deger' | 'ton'> =
    !ear || ear.durum === 'YOK'
      ? { deger: 'veri yok', ton: 'notr' }
      : ear.durum === 'OKUNAMADI'
        ? { deger: 'okunamadı', ton: 'uyari' }
        : ear.durum === 'ESKI'
          ? { deger: `eski (${ear.yasGun ?? '?'} gün)`, ton: 'uyari' }
          : {
              deger: ear.yasGun === 0 ? 'bugün tarandı' : `${ear.yasGun ?? '?'} gün önce`,
              ton: (ear.yasGun ?? 0) > 7 ? 'uyari' : 'iyi',
            };
  return [
    {
      id: 'bulgular',
      baslik: 'Bulgular',
      deger: `${kritik} kritik · ${uyari} uyarı`,
      ton: kritik ? 'kotu' : uyari ? 'uyari' : 'iyi',
      bolum: 'bulgular',
    },
    {
      id: 'etiketler',
      baslik: 'Retirement etiketi',
      deger:
        seviye === undefined
          ? 'yükleniyor'
          : seviye === null
            ? 'yok'
            : `${seviye === 'KESIN' ? 'kesin' : 'şüpheli'} · ${etiketler!.length}`,
      ton: seviye === 'KESIN' ? 'kotu' : seviye === 'SUPHELI' ? 'uyari' : 'notr',
      bolum: 'etiketler',
    },
    {
      id: 'trafik',
      baslik: 'Trafik (7 gün)',
      deger: jvms.length
        ? `${aktif} aktif · ${bos} boşta${olc ? ` · ${olc} ölçülemedi` : ''}`
        : 'JVM yok',
      ton: 'notr',
      bolum: 'uygulamalar',
      title:
        'JVM başına web katmanı trafiği (hc.jsp / hc.html hariç); eşlenmeyen JVM ölçülemedi sayılır',
    },
    { id: 'envanter', baslik: 'Uygulama Envanteri', ...envanter, bolum: 'uygulamalar' },
    {
      id: 'autostart',
      baslik: 'Auto-start uyumsuz',
      deger: uyumsuz ? `${uyumsuz} JVM` : 'yok',
      ton: uyumsuz ? 'kotu' : 'iyi',
      bolum: 'uygulamalar',
      title: 'Çalışıyor + auto-start kapalı ya da kapalı + auto-start açık',
    },
  ];
}

/** Zincir kartının ilk satırı: JVM durumu, auto-start, EAR, web, trafik, parametre ve deployment. */
export function zincirRozetleri(
  d: ShHostDetail,
  j: ShJvm & { runningKnown?: boolean },
  earSayisi: number,
  katman: string,
): { metin: string; ton: OzetTon; title?: string }[] {
  const r: { metin: string; ton: OzetTon; title?: string }[] = [];
  r.push(
    j.runningKnown === false
      ? { metin: 'ölçülemedi', ton: 'notr', title: 'Süreç görünmüyor: kapalı sayılmaz' }
      : j.running
        ? { metin: 'çalışıyor', ton: 'iyi' }
        : { metin: 'kapalı', ton: 'uyari' },
  );
  r.push({
    metin: `auto-start ${j.autoStart === 'true' ? 'açık' : j.autoStart === 'false' ? 'kapalı' : '?'}`,
    ton: autostartUyumsuz(j) ? 'kotu' : 'notr',
  });
  r.push(
    earSayisi
      ? { metin: `EAR ${earSayisi}`, ton: 'notr' }
      : d.ear?.durum === 'VAR'
        ? { metin: 'EAR yok', ton: 'uyari', title: 'domain.xml / host.xml bu JVM’e EAR bağlamıyor' }
        : { metin: 'EAR ?', ton: 'notr', title: 'Uygulama Envanteri verisi yok' },
  );
  r.push({
    metin:
      katman === 'ayni-sunucu'
        ? 'web: aynı sunucu'
        : katman === 'ayri-web'
          ? 'web: ayrı sunucu'
          : 'web eşlenemedi',
    ton: 'notr',
  });
  const t = jvmTrafik(j);
  r.push(
    t === 'ACTIVE'
      ? { metin: 'trafik var', ton: 'iyi' }
      : t === 'NO_RECENT_TRAFFIC'
        ? { metin: 'trafik yok (7 gün)', ton: 'uyari' }
        : { metin: 'trafik ölçülemedi', ton: 'notr' },
  );
  if (j.argFark === 1) r.push({ metin: 'parametre farkı var', ton: 'kotu' });
  if (j.argFark === 2) r.push({ metin: 'parametre farkı ölçülemedi', ton: 'notr' });
  const dm = deploymentMetni(d, j);
  if (dm.ton === 'kotu' || dm.ton === 'uyari')
    r.push({ metin: `deployment: ${dm.metin}`, ton: dm.ton });
  return r;
}
