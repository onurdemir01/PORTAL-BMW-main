# Oturum ve Giriş Yönetimi

Portalın oturum modeli. 2026-10'da beş adımda (PR #166–#170) yeniden kuruldu. Kullanıcıların şikâyeti şuydu: "login aşamasında çokça atıyor, ne kadar bağlı kalabileceği ayarlanabilsin."

## Model

**Sunucu tek yetkilidir.**
- Tarayıcıda yalnızca `httpOnly` bir çerez tutulur ve içinde opak bir oturum kimliği vardır.
- Oturumun kendisi MSSQL'deki `portal_sessions` tablosunda durur.
- JWT ya da localStorage token kullanılmaz.

| Kural | Varsayılan | Ayar | Not |
|---|---|---|---|
| Boşta kalma | 60 dk | `SESSION_IDLE_MINUTES` (5–720) | Her kullanıcı işlemi süreyi yeniden başlatır. Arka plan yoklamaları (pano, çevrimiçi listesi, görünürlük sürümü) başlatmaz. |
| Mutlak süre | 12 sa | `SESSION_ABSOLUTE_HOURS` (1–72) | Etkin kullanımda bile girişten bu kadar sonra yeniden giriş istenir. |
| Beni hatırla | 7 gün | `SESSION_REMEMBER_DAYS` (0–30, 0 = kapalı) | Kalıcı çerez. Boşta kalma kuralı yine geçerlidir. |
| Uyarı | 120 sn | `SESSION_WARN_SECONDS` | "Oturumu Sürdür" penceresi. |
| Eşzamanlı oturum | sınırsız | `SESSION_MAX_CONCURRENT` (0 = sınırsız) | Aşılırsa son etkinliği en eski olan oturum kapanır. |

Bütün ayarlar **Admin > Sistem Yapılandırması > Oturum ve Giriş** ekranındadır.
- Değişiklikler anında geçerli olur; yeniden başlatma gerekmez.
- Sunucu, değeri kaydetmeden önce doğrular.

## Sekmeler ve istemci

- **Sekmeler tek saati paylaşır** (`src/contexts/sessionClock.ts`; BroadcastChannel, yoksa `storage` olayı).
  - Bir sekmede yapılan uzatma, çıkış ya da giriş öteki sekmelere de yansır.
  - İstemci kendi başına **logout çağırmaz**. Süre dolunca sunucuya sorar; oturum gerçekten bittiyse sunucu imzalı 401 döner.
- **Bitiş zamanları her yanıtta gelir:** `X-Portal-Session-Expires` (boşta kalma) ve `X-Portal-Session-Absolute` başlıkları.
- **Etkinlik bildirimi:** okuma ve kaydırma gibi API çağrısı üretmeyen etkinlik, `POST /api/auth/session/extend` ile sunucuya bildirilir; bu çağrı en sık 5 dakikada bir yapılır.
- **Oturum düşünce uygulama kapanmaz.** Ekranın üstünde yeniden giriş katmanı açılır ve açık form korunur.
  - Katman oturumun neden bittiğini gösterir; sebep `X-Portal-Session-Reason: idle|absolute` başlığından gelir.
  - Farklı bir kullanıcıyla giriş yapılırsa sayfa tamamen yenilenir.

## Giriş

- **Kabul edilen kullanıcı adı biçimleri:**
  - `kullanici`
  - `KURUM\kullanici` — izin verilen alan adları `AUTH_ALLOWED_DOMAINS` ile sınırlanabilir.
  - `kullanici@kurum` — `userPrincipalName` alanıyla aranır; izin verilen sonekler `AUTH_ALLOWED_UPN_SUFFIXES` ile sınırlanabilir.
- Türkçe büyük İ / küçük ı katlanır. Görünmez karakter ve ortadaki boşluk açık bir mesajla reddedilir. Şifre kırpılmaz.
- **AD hata kodları ayrı mesajlara çevrilir:**

  | Kod | Anlamı |
  |---|---|
  | 775 | Hesap kilitli |
  | 533 | Hesap devre dışı |
  | 701 | Hesabın süresi dolmuş |
  | 532 | Şifrenin süresi dolmuş |
  | 773 | Şifre değiştirilmeli |

  "Kullanıcı yok" ile "şifre yanlış" bilerek ayrılmaz; bu, kullanıcı adlarının dışarıdan sınanmasını önler.
- LDAP'a ulaşılamıyorsa ve yerel hesap eşleşmiyorsa **503** döner ("şifre hatalı" denmez).
- **Hatalı deneme sınırı kullanıcı başınadır.**
  - `LOGIN_USER_MAX_FAILS` (varsayılan 5) hatadan sonra bekleme süresi 30 sn → 2 dk → 8 dk → en çok 15 dk olarak artar.
  - Bekleme sırasında istek AD'ye **hiç gitmez**; bu, AD hesap kilidini korur.
  - **Bu eşik AD'nin kilitleme eşiğinin altında tutulmalıdır.**
  - IP başına taban sınır `LOGIN_IP_MAX_PER_MIN`'dir (varsayılan 30).

## Aktif oturumlar ve iptal

- **Kullanıcı:** üst menü > "Aktif oturumlarım". Açık oturumlar cihaz, IP, giriş ve son etkinlik bilgisiyle listelenir. Tek tek ya da "diğerlerinin hepsinden çık" ile kapatılabilir.
- **Admin:** Admin > Kullanıcılar > "Kullanıcı oturumları".
- Oturum anahtarı (sid) istemciye hiç gönderilmez. İptal isteğindeki kısa kimlik, sunucu tarafında yalnızca o kullanıcının **kendi** oturumları içinde aranır.
- **Rol değişince:**
  - Yükseltme (Admin verme) kullanıcıyı atmaz; yeni rol yerinde yansır.
  - Düşürme ya da override'ın kaldırılması, kullanıcının tüm oturumlarını sonlandırır.

## Güvenlik

- **Çerez:** `httpOnly`, `SameSite=Lax`, üretimde `Secure`.
  - Üretimde çerezin adı `__Host-portal.sid`'dir. Bu önek tarayıcıya HTTPS, `Path=/` ve Domain'siz kullanımı zorunlu kılar; böylece kardeş alt alan adları çerezi ezemez.
  - Eski `connect.sid` çerezi ilk istekte sessizce taşınır, **kimse oturumdan atılmaz**.
  - Geliştirme ortamında (HTTP) ad `connect.sid` olarak kalır.
- **CSRF:** durum değiştiren `/api` isteklerinde `Origin` (o yoksa `Referer`) portalın kendi adresi olmalıdır; aksi halde 403 döner, kullanıcı atılmaz.
  - Portal birden çok adla açılıyorsa (kısa ad + tam ad) öteki adlar `PORTAL_ALLOWED_ORIGINS` ile eklenir.
  - İlk devreye almada güvenli geçiş için `CSRF_ORIGIN_CHECK=log` kullanılabilir. Bu modda istek engellenmez, yalnızca uyarı loglanır.
- Girişte oturum kimliği yenilenir (`regenerate`).

## Denetim

`Admin > Denetim` ekranında görülen olaylar:

| Olay | Kaydedilen bilgi |
|---|---|
| `login` | Başarılı giriş |
| `login_failed` | `code=` sebep kodu (şifre yazılmaz) |
| `logout` | Çıkış |
| `session_expired` | `reason=idle\|absolute`, oturum yaşı |
| `session_revoked` | `by=self\|admin\|concurrency\|role` |
| `csrf_blocked` | Köken kontrolünün reddettiği istek |

"Sık atılıyoruz" şikâyeti `session_expired` sebep dağılımıyla ölçülür.

## Operasyon notları

- **`SESSION_STORE=memory` üretimde kullanılmaz.** Bu modda her yeniden başlatma herkesi oturumdan atar. Varsayılan MSSQL'dir.
- **`SESSION_SECRET` döndürülürse tüm oturumlar düşer.** Değişiklik bilerek ve duyurularak yapılmalıdır.
- **`portal_sessions` tablosu:** `username`, `created_at` ve `last_seen_at` sütunları NULL'a izin verir, setup bunları ekler. Eklenemezlerse giriş yine çalışır, yalnızca oturum listesi boş görünür.
- **Teşhis:** `GET /api/auth/session-debug` (yalnızca Admin). Store'u, çerez adını, oturum politikasını ve proxy başlıklarını döner.

## Sonraki adım (kapsam dışı)

SSO (OIDC / Keycloak / Red Hat SSO) ve MFA. Giriş şu an LDAP ile yapılıyor.
