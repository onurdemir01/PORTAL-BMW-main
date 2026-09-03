// src/utils/jboss.ts — JBoss surum kimligi. Dort modul (LogX, OpsX, Telnet, FileX)
// ayni envanter tablosunu okuyor ve ayni sunucu secim ekranini gosteriyor; bu
// dosya o ortak kurallari TEK yerde tutar.
//
// ── NEDEN VAR: AYNI SUNUCUDA IKI JBOSS OLABILIR ─────────────────────────────
// Kurumsal envanter (`MWAppsInventory`) ayni host icin BIRDEN COK satir dondurur —
// biri JBoss 7 kurulumu, digeri JBoss 8. Sorgular `SELECT DISTINCT host, env,
// jboss_version, status` oldugu icin iki satir da ekrana gelir.
//
// Dort ekran da satiri YALNIZCA host adiyla kimlikliyordu (`key={h.host}`,
// `selected: Set<string>`). Sonucu kullanicinin bildirdigi uc belirti:
//   · iki satir tek onay kutusu durumunu paylasiyordu → birini isaretleyince
//     digeri de isaretleniyordu ("ayni anda sectiriyor"),
//   · "yalnizca bu sunucunun JBoss 8 kurulumu" denemiyordu ("birini sectiremiyor"),
//   · satirlar gorsel olarak ayni goruniyordu ("uygulamaci anlamiyor").
// Ustelik React ayni `key` degerini iki kez aliyordu.
//
// Cozum tek cumle: SATIRIN KIMLIGI HOST DEGIL, (host, major) CIFTIDIR.

/** Envanterdeki tam surum string'inden ("8.1.2" -> "8") majör surumu cikarir.
 *  Taninmayan/bos bicimde bos string doner ("Bilinmiyor" grubuna girer). */
export function jbossMajorOf(version: string): string {
  return /^(\d+)/.exec(version || '')?.[1] || '';
}

/** Envanterde JBoss olmayan/bilinmeyen surumu isaretleyen deger. WAS gibi JBoss
 *  olmayan uygulamalarda da bos gelir — ikisi ayni grupta toplanir. */
export function normalizeJbossVersion(raw: string | null | undefined): string {
  const v = String(raw || '').trim();
  return v && v.toUpperCase() !== 'NF' ? v : '';
}

/** Majör surumun kullaniciya gosterilen adi. */
export function jbossLabel(major: string): string {
  return major ? `JBoss ${major}` : 'Bilinmiyor';
}

/** SATIR VE SECIM KIMLIGI. Ayni host iki majörde varsa iki FARKLI anahtar uretir —
 *  bu dosyanin var olus sebebi. Host adi buyuk harfe cevrilir: envanter bazi
 *  satirlarda kucuk harf donebiliyor ve ayni sunucu iki kez secilebilir hale gelirdi. */
export function hostKey(host: string, major: string): string {
  return `${String(host || '').trim().toUpperCase()}|${major}`;
}

/** `hostKey` cozumlemesi — secilen anahtarlari sunucuya gonderilecek cifte cevirir. */
export function parseHostKey(key: string): { host: string; jbossMajor: string } {
  const i = String(key || '').indexOf('|');
  if (i < 0) return { host: String(key || '').trim().toUpperCase(), jbossMajor: '' };
  return {
    host: String(key).slice(0, i).trim().toUpperCase(),
    jbossMajor: String(key).slice(i + 1),
  };
}

/** Bir envanter satirinin majör surumu — `normalizeJbossVersion` + `jbossMajorOf`
 *  zinciri dort ekranda da AYNI sekilde uygulanmali. */
export function majorOfHost(h: { jbossVersion?: string | null }): string {
  return jbossMajorOf(normalizeJbossVersion(h.jbossVersion));
}

/** Secilen anahtar kumesinden sunucuya gonderilecek `{host, jbossMajor}` cifti. */
export function toHostPairs(keys: Iterable<string>): { host: string; jbossMajor: string }[] {
  return [...keys].map(parseHostKey);
}
