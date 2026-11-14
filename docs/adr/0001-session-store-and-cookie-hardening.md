# ADR-0001: Oturum Deposu ve Çerez Sertleştirme Modeli

- **Durum:** Kabul Edildi
- **Tarih:** 2026-11-14

## Bağlam

Portal bankacılık içi sistemlere hizmet vermektedir. `har` kayıtlarında oturum/kimlik başlıklarının log sızıntısı riski, proxy IP sabit kodlaması ve çerez `Secure` bayrağı yönetimi denetim bulgusu olarak tespit edilmiştir.

## Karar

1. Production ortamında `__Host-portal.sid` ön ekli, `HttpOnly`, `SameSite=Lax` ve `Secure=true` oturum çerezi kullanılır; `COOKIE_SECURE` env değişkeni ile HTTPS sonlandırma arkasındaki test ortamlarında da zorlanabilir.
2. `app.set('trust proxy', ...)` değeri kaynak kodda sabit IP tutmak yerine `TRUST_PROXY` env değişkeni üzerinden çözümlenir (`server/util/guvenlik-yardimci.cjs`). Tanımsızsa üretimde tek atlama (`1`), geliştirmede `loopback`: nginx Node'a makinenin loopback olmayan adresinden bağlandığı için `loopback` varsayılanı üretimde oturum çerezinin hiç verilmemesi demekti.
3. `sessionOrIpKey` rate-limit anahtarı yalnızca kriptografik olarak doğrulanan iç-servis kimliğini (`trustedHeaderUser`) kabul eder; ham `x-portal-user` başlığını yoksayar.
4. Tüm yanıtlarda `CSP` ve `Permissions-Policy` uygulanır. `Strict-Transport-Security` **varsayılan kapalıdır** (üretimde de): makine adının tüm portlarını tarayıcıda HTTPS'e zorlar ve geri alınması zordur; yalnız `PORTAL_HSTS_MAX_AGE` ile, o adı bilen tarafından açılır (`docs/OTURUM-YONETIMI.md`).

## Sonuçlar

- Reverse-proxy topoloji değişiklikleri kod değişikliği olmadan env ile yönetilir.
- Kimlik başlığı sahteciliği ile rate-limit atlatma ve session hijacking yüzeyi kapatılır.
