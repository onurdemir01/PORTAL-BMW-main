// src/utils/safeUrl.ts — kullanıcı/admin girdisi bir `href`e basılmadan önce.
//
// GÜVENLİK AÇIĞI (2026-09-07'de kapatıldı): `portal_links.url` yalnızca "boş mu"
// diye doğrulanıyordu ve önyüz değeri DOĞRUDAN `href`e basıyordu. `javascript:...`
// kaydedilebiliyor ve tıklayan HERKESTE portal origin'inde çalışıyordu — depolanmış XSS.
//
// SUNUCU KAPISI TEK BAŞINA YETMEZ. O kapı yalnızca YENİ yazımları korur; tabloda
// zaten duran satırlar doğrulanmadan geçmiştir. Bu yüzden aynı kural render anında
// da uygulanır — savunma iki katmanlı.
//
// İZİN VERİLENLER:
//   * https: / http:     — normal dış bağlantılar
//   * `/` ile başlayan    — portal içi yol (seed'de `/logx` satırı VAR, kırılmamalı)
// REDDEDİLENLER: javascript:, data:, vbscript:, file: ve protokol-göreli `//host`
// (sonuncusu şema mirası aldığı için `https://` gibi görünür ama başka bir origin'e gider).

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

export interface SafeUrl {
  /** `href`e basılabilecek değer. Güvenli değilse boş string. */
  href: string;
  /** Güvenli mi? Değilse bağlantı TIKLANABİLİR YAPILMAMALI. */
  safe: boolean;
  /** Güvenli değilse sebebi — kullanıcıya/adminine gösterilir. */
  reason: string;
}

export function safeLinkUrl(raw: unknown): SafeUrl {
  const url = String(raw ?? '').trim();
  if (!url) return { href: '', safe: false, reason: 'Adres boş.' };

  if (url.startsWith('/')) {
    // `//host` PROTOKOL-GÖRELİDİR: şemayı sayfadan miras alır ve DIŞ bir origin'e
    // gider. Tek `/` ile başlayan gerçek portal-içi yoldan ayrılmak zorunda.
    if (url.startsWith('//')) {
      return { href: '', safe: false, reason: 'Protokol-göreli adres (//) kabul edilmiyor.' };
    }
    return { href: url, safe: true, reason: '' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { href: '', safe: false, reason: 'Geçerli bir adres değil.' };
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return {
      href: '',
      safe: false,
      reason: `"${parsed.protocol}" şeması kabul edilmiyor (yalnızca http, https ya da /portal-yolu).`,
    };
  }
  return { href: url, safe: true, reason: '' };
}
