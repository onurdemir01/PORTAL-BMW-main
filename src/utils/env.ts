// src/utils/env.ts — ortam adının PROD olup olmadığı: ekran tarafındaki TEK tanım.
//
// NEDEN TEK YERDE: bu soru artık iki ekranda birden soruluyor (ScopeStep'in prod
// vurgusu ve her adımda görünen künye). İkinci bir kopya yazmak, birinin değişip
// diğerinin sessizce eskimesi demekti — bu depoda tekrar eden hata sınıfı.
//
// SUNUCUYLA AYNI DEĞERLER: `server/oco/prod-detect.cjs` `PROD_VALUES` listesi
// (`prod`, `production`, büyük/küçük harf duyarsız). Orası bilerek YAPILANDIRILAMAZ
// çünkü bayat bir DB satırı güvenlik kapısını sessizce kapatabilirdi; buradaki kopya
// da aynı sebeple sabittir.
//
// SINIR — BU BİR GÜVENLİK KAPISI DEĞİL, bir GÖRSEL VURGUDUR. Gerçek karar (OCO/SMART
// zorunluluğu) her zaman sunucuda verilir; buradaki değer yalnızca kullanıcının
// hangi ortamda olduğunu kazara öğrenmemesini sağlar.
const PROD_VALUES = ['prod', 'production'];

export function isProdEnv(env?: string | null): boolean {
  return PROD_VALUES.includes(
    String(env ?? '')
      .trim()
      .toLowerCase(),
  );
}
