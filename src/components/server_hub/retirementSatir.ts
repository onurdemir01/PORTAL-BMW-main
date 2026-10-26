// src/components/server_hub/retirementSatir.ts — Retirement hedef satirinin SAF yardimcilari (2026-10-26).
// Bilesen yok, yan etki yok: vitest dogrudan cagirir (retirement-satir.test.ts RS1-RS4; sonucAyir RS3).
import type { RtIsAdim, RtTarget, RtWeb2 } from '@/api/retirementApi';
import { fmtDate, fmtDateTime } from '@/utils/datetime';
import { kalanGun } from './RetirementAkis';

/** Sonuc metninin bas etiketi ("OK — ...", "FAIL - ..."); etiket yoksa null, govde metnin kendisi.
 *  Govde ayni kelimeyle basliyorsa (sunucu: "PLAN — PLAN (HENUZ HICBIR SEY YAPILMADI): ...") o kelime
 *  atilir: ekranda cip + govde "PLAN PLAN" diye tekrarlanmasin. */
export function sonucAyir(metin: string): { etiket: 'OK' | 'FAIL' | 'PLAN' | 'SKIP' | null; govde: string } {
  const s = String(metin ?? '');
  const m = /^(OK|FAIL|PLAN|SKIP)\s*[—-]\s*/.exec(s);
  if (!m) return { etiket: null, govde: s };
  const etiket = m[1] as 'OK' | 'FAIL' | 'PLAN' | 'SKIP';
  const govde = s.slice(m[0].length);
  const tekrar = /^(OK|FAIL|PLAN|SKIP)(?=[\s(:—-])\s*(?:[—:-]\s*)?/.exec(govde);
  return { etiket, govde: tekrar && tekrar[1] === etiket && govde.length > tekrar[0].length ? govde.slice(tekrar[0].length) : govde };
}

export type SiradakiTon = 'notr' | 'aksan' | 'uyari';
export interface SatirBaglami {
  /** Kayit iptal ya da silinmis: birincil eylem yok (retirementAdimi 'yok'). */
  kayitKapali: boolean;
  kayitIptal: boolean;
  effectiveDeleteAt: string | null;
  saat: string;
  /** Kayit duzeyinde "beklemeyi atla" ani. */
  kayitAtladi?: string | null;
  bugun?: Date;
}

/** "Sıradaki: ..." satiri: hedefin durumundan bir sonraki adim (ya da neyi bekledigi). Bos metin donmez. */
export function sonrakiAdim(t: RtTarget, k: SatirBaglami): { metin: string; ton: SiradakiTon } {
  const web = t.webSonuc || [];
  // Kayit kapaliyken baslat / onayla sunulmaz; satir "sıradaki" demesin.
  if (k.kayitKapali && (t.status === 'pending' || t.status === 'planned' || (t.status === 'failed' && !web.some((w) => w.status === 'ok'))))
    return { metin: 'Kayıt kapalı · bu hedefte işlem yapılmaz', ton: 'notr' };
  switch (t.status) {
    case 'pending': return { metin: 'Sıradaki: Retirement’ı başlat — ön kontrol, hiçbir şey değişmez', ton: 'aksan' };
    case 'planning': return { metin: 'Ön kontrol AWX’te çalışıyor; bitince onay penceresi açılır', ton: 'notr' };
    case 'planned': return { metin: 'Sıradaki: sonucu gör ve onayla', ton: 'aksan' };
    case 'stop_scheduled':
      return { metin: `STOP ${fmtDateTime(t.scheduledAt)}${t.windowEnd ? ` – ${fmtDateTime(t.windowEnd)}` : ''} OCO penceresinde başlar`, ton: 'notr' };
    case 'stopping': return { metin: 'JBoss durduruluyor', ton: 'notr' };
    case 'deleting': return { metin: 'Silme işi çalışıyor', ton: 'notr' };
    case 'rolling_back': return { metin: 'Geri alma çalışıyor', ton: 'notr' };
    case 'stopped': {
      if (k.kayitIptal) return { metin: 'Kayıt iptal edildi · uygulama DURDURULMUŞ kaldı — gerekirse “Geri aktif et”', ton: 'uyari' };
      if (web.some((w) => w.status === 'failed' || w.status === 'skip')) return { metin: 'Sıradaki: web adımını yeniden deneyin', ton: 'aksan' };
      if (t.deleteNowAt || k.kayitAtladi) return { metin: 'Silme sırada — zamanlayıcının ilk turunda', ton: 'uyari' };
      const kg = kalanGun(k.effectiveDeleteAt, k.bugun);
      if (kg === null) return { metin: 'Silme tarihi yok', ton: 'notr' };
      if (kg > 0) return { metin: `Silme ${fmtDate(k.effectiveDeleteAt)} ${k.saat} · ${kg} gün kaldı`, ton: 'notr' };
      if (kg === 0) return { metin: `Silme BUGÜN ${k.saat}`, ton: 'uyari' };
      return { metin: `Silme günü geçti — sıradaki ${k.saat} turunda`, ton: 'notr' };
    }
    case 'deleted': return { metin: `Silindi · ${fmtDateTime(t.deletedAt)}`, ton: 'notr' };
    case 'active': return { metin: `Geri aktif · ${fmtDateTime(t.rolledBackAt)} — gerekirse yeniden başlatılabilir`, ton: 'notr' };
    case 'rollback_failed': return { metin: 'Sıradaki: nedeni İş çıktısında inceleyin, “Geri aktif et”i yeniden deneyin', ton: 'aksan' };
    case 'failed':
      if (web.some((w) => w.status === 'ok')) return { metin: 'Dikkat: vhost kaldırıldı ama JBoss durmadı — geri açın ya da yeniden başlatın', ton: 'uyari' };
      return { metin: 'Sıradaki: nedeni İş çıktısında inceleyin, sonra yeniden başlatın', ton: 'aksan' };
    // Atlanan hedef yeniden alinabilir ('Retirement’ı başlat' BASLATILABILIR'da; sunucu da reddetmez).
    case 'skipped': return { metin: k.kayitKapali ? 'Kayıttan çıkarıldı · işlem yapılmaz' : 'Kayıttan çıkarıldı — işlem yapılmaz; yeniden almak için “Retirement’ı başlat”', ton: 'notr' };
    default: return { metin: `Durum: ${String(t.status)}`, ton: 'notr' };
  }
}

/** Bir vhost satirinin (host + ServerName, buyuk/kucuk harf duyarsiz) web adimi sonuclari.
 *  `i` webSonuc icindeki OZGUN siradir: is ciktisi ucu `web` parametresi onu bekler. */
export function webSonuclari(webSonuc: RtWeb2[] | null | undefined, host: string, serverName: string): { w: RtWeb2; i: number }[] {
  const h = String(host || '').trim().toUpperCase();
  const s = String(serverName || '').trim().toLowerCase();
  const out: { w: RtWeb2; i: number }[] = [];
  (webSonuc || []).forEach((w, i) => {
    if (String(w.host || '').trim().toUpperCase() === h && String(w.serverName || '').trim().toLowerCase() === s) out.push({ w, i });
  });
  return out;
}

const GECIS_ADIMI: Record<string, RtIsAdim> = { planning: 'onkontrol', stopping: 'stop', deleting: 'delete', rolling_back: 'rollback' };
/** Gecis durumunun AWX adimi ("Canlı çıktıyı izle" o adimin isini secer); gecis degilse undefined. */
export const gecisAdimi = (status: string): RtIsAdim | undefined => GECIS_ADIMI[status];

/** Hedefte suren bir AWX isi var mi (yalniz sunucunun listesinden; istemci tahmin etmez). */
export const hedefteCanliIs = (t: Pick<RtTarget, 'awxIsleri'>): boolean => (t.awxIsleri || []).some((x) => x.durum === 'suruyor');
