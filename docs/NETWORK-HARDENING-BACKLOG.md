# Ağ / TLS / Proxy Sertleştirme — İnceleme Raporu ve Task Backlog'u

> Tarih: 2026-07-11 · Kapsam: tüm repo (server/, scripts/, env/config, dokümanlar, log_analiz/)
> Referans başarı durumu (KORUNACAK): OpenAI TLS testi STATUS 401 · Dynatrace MCP 19 tool +
> uçtan uca list_problems · Instana MCP 9 tool · rejectUnauthorized=true (AI+MCP) ·
> CA store: ~146 public kök + kurumsal zincirler.
>
> **Güncelleme (2026-07-11, aynı gün ikinci geçiş):** Bu belge yazıldıktan sonra
> `server/ai/ca.cjs`, `server/ai/provider.cjs`, `server/mcp/client.cjs` üzerinde ek commit'ler
> geldi (`2e730cd`, `318c895`, `fc1ec7f`, `3b3f244` — bu belgeyi ekleyen `7972c68`'den SONRA).
> Aşağıda ✅ işaretli maddeler bu commit'lerle zaten çözülmüş durumda; kod yeniden okunarak
> doğrulandı. Ayrıca kapsam `log_analiz/` alt-projesine genişletildi (bkz. §1.11) — orijinal
> incelemede yoktu ve bağımsız bir AI/HTTP yığını olduğu için aynı risk sınıfını taşıyor.

---

# BÖLÜM 1 — Bulgu Envanteri (dosya:satır bazında)

## 1.1 Merkezi CA'yı KULLANAN katmanlar (✅ hedef mimariye uygun)

| Dosya | Kullanım |
|---|---|
| `server/ai/provider.cjs:39,42` | `buildCombinedCa()` + `rejectUnauthorized:true` + keepAlive agent |
| `server/mcp/client.cjs:14,45` | `buildCombinedCa()` + NO_PROXY host-bazlı karar (`isNoProxyHost`, :24) |

## 1.2 Merkezi CA'yı KULLANMAYAN, kendi TLS kararını veren dış bağlantılar (⚠)

| Dosya:Satır | Bağlantı | Mevcut davranış | Risk |
|---|---|---|---|
| `server/ansible/runner.cjs:176,244,292,356,484` | AWX (5 ayrı istemci noktası: template list, token OAuth2/basic, launch, job) | `rejectUnauthorized:false` sabit | #5, #19 — kurumsal CA varken bile doğrulamasız |
| `server/index.cjs:205` | Nöbetçi API (gbnys) | `rejectUnauthorized:false` sabit | #5, #19 |
| `server/logx/index.cjs:63` | LogX test-access (hedef :1111) | `rejectUnauthorized:false` | Bilinçli (self-signed hedefler) ama merkezî değil |
| `server/logx/proxy.cjs:25-27,176` | LogX proxy upstream agent | `rejectUnauthorized:false` | Bilinçli — hedefler self-signed; pinning opsiyonu yok |
| `server/auth/ldap.cjs:26-31` | LDAPS | Kendi CA mekanizması (`LDAP_CA_CERT_PATH`); cert yoksa `rejectUnauthorized:false` varsayılan | #19, #20 — trust-store kodu duplicate |

## 1.3 Insecure fallback / global env mutasyonu

| Dosya:Satır | Sorun | Durum |
|---|---|---|
| ~~`server/mcp/client.cjs` global `NODE_TLS_REJECT_UNAUTHORIZED='0'` mutasyonu~~ | Tüm proses TLS'ini kapatan "emniyet kemeri" | ✅ **ÇÖZÜLDÜ** — güncel kodda bu satır yok; `MCP_TLS_INSECURE=1` yalnızca ilgili dispatcher'ın `tlsOpts.rejectUnauthorized` alanını etkiliyor (client.cjs:90-103), globale dokunmuyor. |
| ~~undici require edilemezse sessiz `null` → yerleşik fetch fallback~~ | CA'sız/proxy'siz sessiz devam (#11) | ✅ **ÇÖZÜLDÜ** — güncel `buildDispatcher`/`buildFetch` (client.cjs:54-60, 148-156) undici yüklenemezse açık `Error` fırlatıyor; sessiz fallback yok. |
| `MCP_TLS_INSECURE=1` prod'da engellenmiyor | Boot'ta `NODE_ENV=production` kontrolü yok | 🔴 **HALEN AÇIK** — NET-27 kapsamında ele alınacak. |
| **Ortam durumu (kod değil, config):** `.env.local` şu an `MCP_TLS_INSECURE=1` **aktif**, `CORP_CA_CERT_PATH` satırı yorum satırı (kapalı) | Bu makinede MCP TLS doğrulaması fiilen KAPALI | ℹ️ Aksiyon: `bash scripts/fetch-mcp-ca.sh` + `node scripts/build-ca-bundle.cjs` çalıştırıp `CORP_CA_CERT_PATH`'i aktif edip `MCP_TLS_INSECURE` satırını silmek (TLS-SETUP.md'deki akış) — kod değişikliği değil, operasyonel adım. |

## 1.4 Repo ↔ hedef durum farkları — ✅ TAMAMEN ÇÖZÜLDÜ (bu belgeden sonraki commit'lerle)

| Madde | Durum |
|---|---|
| PEM blok ayrıştırma (`BEGIN/END` regex), her bloğun `crypto.X509Certificate` ile doğrulanması, SHA-256 fingerprint dedup, BOM + CRLF normalize, metrik logları | ✅ `server/ai/ca.cjs` — `parsePemCertificates`/`normalizePemContent`/`getFingerprint` ile uygulanmış, `{publicRoots, corporatePemBlocks, addedCorporateCertificates, totalCertificates}` loglanıyor. |
| `https.request`'e açık `port:443` + `servername:hostname`; timeout'ta `req.destroy(error)` | ✅ `server/ai/provider.cjs:76-77,117-119` |
| MCP dispatcher'da açık `servername` (SNI) | ✅ `server/mcp/client.cjs:73` (`tlsOpts.servername = target.hostname`) — Agent'a ayrıca `keepAlive`/`timeout` hizalaması (NET-11) henüz eklenmedi, bu kısım hâlâ açık. |

Bu üçü NET-01 ve NET-14'ün kabul kriterlerini karşılıyor — aşağıdaki Kategori 1/5 görev
kartları artık "TAMAMLANDI" olarak işaretlenmiştir; iz kaydı için kartlar silinmedi.

## 1.5 HTTP istemci çeşitliliği (ortak katman yok)

`https/http.request` kullanan 8 bağımsız nokta: provider(1), ansible(5), nobetci(1), logx test-access(1), logx proxy(1, özel amaçlı) + MCP undici fetch. Timeout'lar tutarsız (8s/10s/15s/30s), retry politikası yok, hata normalizasyonu yalnız MCP'de (`describeError`).

## 1.6 Proxy kararı

Yalnız `server/mcp/client.cjs` NO_PROXY değerlendiriyor (suffix/exact/`*`; **port/IPv4-CIDR/IPv6 yok**). AI provider (`api.openai.com`) proxy'den TAMAMEN habersiz — kurumda AI trafiği zorunlu proxy'liyse kopar (şu an direct çalışıyor; davranış korunarak opsiyonel destek eklenmeli). AWX/nobetci/LDAP istemcileri de proxy-habersiz (kurum içi oldukları için bugün sorun değil — NO_PROXY'ye girmeliler).

## 1.7 Env/config

- dotenv sırası: `.env.local` önce, `.env` sonra (`server/index.cjs:8-9`) → .env.local kazanır ✓ (dotenv var olanı ezmez). Testle sabitlenmeli.
- Duplicate key kontrolü yok (kurum makinesinde yaşanan "aynı satıra birleşme/çift tanım" sınıfı hatayı boot yakalamıyor) — `.env.local`'da şu an duplicate yok (doğrulandı).
- URL startup validation yok (ERR_INVALID_URL ancak ilk çağrıda patlar, hangi env olduğunu söylemez).
- Admin system-config PUT regex'i (`^KEY=.*$/m`) çift tanım varsa yalnız ilkini günceller → ikinci sessizce kazanmaya devam eder (#17).

## 1.8 Secret/loglama

- Maskeleme yalnız log-analiz hattında (`logx/masker.cjs`) ve system-config GET'te. Bağlantı logları host-bazlı, header loglamıyor ✓; ancak ortak redact helper yok — yeni log noktaları risk (#23).
- `.gitignore`: `*.pem/.key/.crt/.cer` ✓. CI'da "BEGIN PRIVATE KEY" bekçisi yok.

## 1.9 Health/diagnostics

- DT health: reachable+mcpConnected+lastError ✓. Instana health: yalnız `configured` (bağlantı testi yok). AI-analyst health: yalnız key varlığı — TLS/CA/proxy teşhisi hiçbirinde yok (#25).
- Diag scriptleri: test-tls, test-dt-mcp, test-instana-mcp ✓; OpenAI/Anthropic API-katmanı diag'ı (401=TLS-OK kanıtı) yok; tek-komut toplu teşhis yok.
- Sertifika expiry kontrolü hiçbir yerde yok (#21).

## 1.10 Test otomasyonu

`npm test` yok; birim/entegrasyon/regresyon testi yok (bu oturumlardaki inline testler kalıcılaştırılmadı). Jenkins kalite kapısı yalnız tsc+syntax.

## 1.11 `log_analiz/backend` — ayrı bir stack, merkezi CA/proxy katmanının tamamen DIŞINDA (🔴 yeni bulgu)

Bu alt-proje (`log_analiz/backend`, kendi `package.json`'ı ve TS derlemesiyle bağımsız bir
Node servisi) orijinal incelemenin kapsamı dışında kalmıştı. Kendi ağ çıkışları var ve
bunların HİÇBİRİ `server/ai/ca.cjs`'i, proxy/NO_PROXY mantığını veya AWX/LDAP tarzı bir
TLS yapılandırmasını kullanmıyor — hepsi çıplak global `fetch()`:

| Dosya:Satır | Hedef | Durum |
|---|---|---|
| `log_analiz/backend/src/routes/admin.router.ts:1564` | `https://api.anthropic.com/v1/messages` — admin AI-öneri özelliği | 🔴 Guides.md'nin "İleride Anthropic API" maddesiyle birebir aynı sınıf: kurumsal ağda SSL inspection (Blue Coat) zincirinden geçecek ama hiçbir özel CA/agent verilmiyor. Kurumsal ortamda tetiklenirse `bmw-portal` tarafında zaten çözülmüş olan `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` hatasının BİREBİR AYNISI beklenir. |
| `log_analiz/backend/src/connectors/http-log.connector.ts` | Garanti iç sunucuları, port 1111 | Global `fetch()`, proxy/CA farkında değil — ama hedef iç ağ (RFC-1918, IP inventory onaylı) olduğu için bugün muhtemelen sorun çıkarmıyor; NO_PROXY kapsamına girmesi gerekir. |
| `log_analiz/backend/src/observability/webfetch.util.ts` | `raw.githubusercontent.com`, `api.github.com`, Confluence (whitelist + SSRF koruması var) | SSRF koruması iyi tasarlanmış (ayrı, olumlu not); TLS/proxy katmanından yine bağımsız. |
| `log_analiz/backend/src/observability/alerting.service.ts` | `WEBHOOK_URL` (fire-and-forget) | Aynı şekilde bağımsız `fetch()`; düşük risk (dış sistem, PII'siz). |

**Kök neden:** `server/network/*` gibi paylaşılan bir katman hiç yok (NET-08 bunu hedefliyor),
bu yüzden `log_analiz/backend` kendi başına bir HTTP yığını yazmış — NET-19/#20'nin
("trust-store kodunun duplicate edilmesi") en somut örneği, hatta duplicate bile değil,
**yok**. Bkz. yeni görev **NET-35** (Kategori 4/5 sınırında, aşağıda).

---

# BÖLÜM 2 — Task Backlog'u

> Alan kısaltmaları: **Ö**=Öncelik, **K**=Karmaşıklık (S/M/L/XL). Her task "mevcut çalışan
> davranışı bozma" ilkesiyle tasarlandı; geri dönüş planı çoğunlukla "önceki dosya sürümüne
> revert" (küçük, izole patch'ler).

## Kategori 1 — TLS ve trust-store

### NET-01 · ca.cjs güçlendirme: PEM ayrıştırma + doğrulama + dedup + metrik — ✅ TAMAMLANDI
- **Ö:** Critical · **K:** S · **Durum:** Uygulandı (bkz. §1.4) — kabul kriterleri kod okuması ile doğrulandı, kurum makinesinde smoke bu oturumda tekrarlanmadı.
- **Risk:** Bozuk/BOM'lu/çift sertifikalı bundle sessizce kabul ediliyor; metrik yok (kurum makinesindeki nihai çözümle repo arasındaki fark).
- **Dosyalar:** `server/ai/ca.cjs`
- **Mevcut:** Dosya içeriği tek string olarak ca[]'ya ekleniyor; doğrulama/dedup/normalize yok.
- **Hedef:** BOM+CRLF normalize → `BEGIN/END CERTIFICATE` bloklarını ayrıştır → her bloğu `new crypto.X509Certificate()` ile doğrula (bozuksa dosya adıyla ERROR, o blok atlanır) → SHA-256 fingerprint dedup (public köklerle de) → `{publicRoots, corporatePemBlocks, addedCorporateCertificates, totalCertificates}` logu.
- **Değişiklik:** loadCorporateCas → blok-bazlı parse+validate; buildCombinedCa → dedup + metrik dönüşü; provider/mcp log satırları yeni metriği basar.
- **Kabul:** Kurum bundle'ı ile boot logu `publicRoots:146, corporatePemBlocks:N, added:N, total:...`; bozuk PEM'li dosyada blok adıyla ERROR + kalanlar yüklenir; davranış regresyonu yok (test-tls 4/4).
- **Test:** Unit — geçerli çoklu-PEM, BOM'lu, CRLF'li, bozuk blok, boş dosya, duplicate blok; entegrasyon — test-tls.
- **Geri dönüş:** ca.cjs revert (tek dosya).
- **Bağımlılık:** — (ilk task)

### NET-02 · Tüm dış HTTPS istemcilerinin merkezi CA'ya geçirilmesi
- **Ö:** High · **K:** M
- **Risk:** AWX(5)/Nöbetçi/LogX test-access sabit `rejectUnauthorized:false`; LDAP ayrı trust kodu (#5,#19,#20).
- **Dosyalar:** `server/ansible/runner.cjs` (176,244,292,356,484), `server/index.cjs:205`, `server/logx/index.cjs:63`, `server/auth/ldap.cjs:26-31`
- **Mevcut:** Nokta-bazlı `rejectUnauthorized:false`.
- **Hedef:** Ortak `buildTlsOptions(serviceName)` (ca.cjs'e eklenir): kurumsal CA yüklüyse `{ca, rejectUnauthorized:true}`; yüklü değilse **mevcut davranış korunur** (`false`) ama `NODE_ENV=production`'da WARN. LogX proxy upstream (`proxy.cjs`) kapsam DIŞI (bilinçli self-signed hedefler — NET-29). LDAP: `LDAP_CA_CERT_PATH` mekanizması korunur, ek olarak combined CA da güven listesine eklenir.
- **Kabul:** AWX/nöbetçi akışları CA'sız ortamda aynen çalışır; CA'lı ortamda doğrulama açık; kurum makinesinde AWX+nöbetçi smoke ✓.
- **Test:** Mock self-signed sunucu — CA'sızken bağlanır (dev), CA verilince doğrular; entegrasyon: gerçek AWX template listesi.
- **Geri dönüş:** Nokta bazlı revert (her istemci bağımsız).
- **Bağımlılık:** NET-01.

### NET-03 · CORP_CA_CERT_PATH startup validation
- **Ö:** Medium · **K:** S — Boot'ta CA yükle+doğrula; prod'da "tanımlı ama yüklenemedi" = başlatma hatası; dev'de ERROR log. **Dosyalar:** `server/index.cjs` (boot), ca.cjs. **Kabul:** yanlış path ile prod boot'u açıklayıcı mesajla durur. **Bağımlılık:** NET-01, NET-17.

### NET-04 · JKS/PKCS12 → PEM dönüşüm aracı
- **Ö:** Low · **K:** M — `scripts/convert-keystore.sh` (+ps1): keytool/openssl sarmalayıcı, çıktıyı `*-ca-chain.pem` düzenine koyar. **Kabul:** örnek JKS'ten geçerli PEM; build-ca-bundle tüketebilir. **Bağımlılık:** NET-01.

## Kategori 2 — Proxy ve NO_PROXY

### NET-05 · Merkezi proxy karar katmanı `server/network/proxy.cjs`
- **Ö:** High · **K:** S
- **Risk:** Proxy kararı yalnız MCP'de ve gömülü; başka katman proxy gerektirdiğinde kopya kod (#19).
- **Hedef:** `decideProxy(targetUrl) → {useProxy, proxyUrl, reason}` — HTTP(S)_PROXY/ALL_PROXY + NO_PROXY (mevcut kurallar taşınır); karar `[NET] direct|proxy host=... reason=...` diye loglanır (secret'sız). mcp/client `isNoProxyHost`+seçim mantığını buradan kullanır (davranış birebir).
- **Kabul:** NO_PROXY birim testleri geçer (mevcut + taşınan); MCP bağlantı davranışı değişmez (kurum smoke).
- **Geri dönüş:** mcp/client eski gömülü mantığa döner. **Bağımlılık:** —

### NET-06 · NO_PROXY genişletme: port, wildcard, IPv4/IPv6, CIDR
- **Ö:** Medium · **K:** M — `host:port` girdisi, `10.0.0.0/8` CIDR (kurum NO_PROXY örneğinde ZATEN var — bugün sessizce eşleşmiyor!), IPv6 köşeli parantez. **Dosyalar:** network/proxy.cjs. **Kabul:** kullanıcının gerçek NO_PROXY satırı (CIDR'li) doğru değerlendirilir; birim test matrisi. **Bağımlılık:** NET-05.

### NET-07 · AI provider için opsiyonel proxy desteği
- **Ö:** Medium · **K:** M
- **Risk:** AI çağrıları proxy-habersiz; internet çıkışı zorunlu proxy'li ortamda AI kopar.
- **Hedef:** provider httpsPost, `decideProxy('https://api.openai.com')` sonucuna göre HTTP CONNECT tüneli (https.request + tunnel kurma veya undici ProxyAgent'a geçiş NET-08'de). **Davranış koruma:** proxy env yoksa bugünkü direct akış birebir.
- **Kabul:** proxy'siz ortamda STATUS 401 testi aynen; mock CONNECT proxy testinde tünel kurulur. **Bağımlılık:** NET-05, NET-08 ile birleşebilir.

## Kategori 3 — Ortak HTTP client

### NET-08 · `server/network/http-client.cjs`
- **Ö:** High · **K:** L
- **Risk:** 8 bağımsız istemci; tutarsız timeout, retry yok, hata biçimi farklı (#26).
- **Hedef:** `request({service, url, method, headers, body, timeoutMs, retries})` → CA (NET-01) + proxy (NET-05) + timeout + idempotent-GET retry(exp backoff, maks 2) + normalize hata (NET-09) + `{service, host, status, ms, retryCount}` logu (redact'li NET-20). **Aşamalı geçiş:** 1) ai/provider.httpsPost sarmalanır, 2) ansible awxRequest*, 3) nobetci. LogX proxy pass-through kapsam DIŞI (özel akış).
- **Kabul:** Her geçiş adımında ilgili akışın smoke'u (AWX template listesi, nöbetçi today, OpenAI 401) birebir; geçiş adım adım commit'lenir.
- **Geri dönüş:** Adaptör deseni — eski fonksiyon imzaları korunur, revert kolay. **Bağımlılık:** NET-01, NET-05, NET-09.

### NET-09 · Ortak error normalizer `server/network/errors.cjs`
- **Ö:** High · **K:** S
- **Hedef:** `describeError` (mcp/client'tan taşınır) + `classify(err|status)` → `dns|tls|proxy|timeout|conn|http-auth|http-quota|http-notfound|http-server` etiketi; MCP/AI/frontend mesaj haritaları bunu kullanır (429-kota ≠ sertifika hatası ayrımı garanti, #29,#30).
- **Kabul:** Birim test: ENOTFOUND→dns, SELF_SIGNED→tls, ECONNRESET(proxy'li)→proxy, 429→http-quota... **Bağımlılık:** —

## Kategori 4 — MCP istemcileri

### NET-10 · Global NODE_TLS_REJECT_UNAUTHORIZED mutasyonunun kaldırılması + sessiz fetch fallback'in kapatılması — ✅ TAMAMLANDI
- **Ö:** Critical · **K:** S · **Durum:** Uygulandı (bkz. §1.3) — global env mutasyonu yok, undici yüklenemezse açık `Error` fırlatılıyor.
- **Kalan alt-madde (hâlâ açık):** `MCP_TLS_INSECURE=1` için `NODE_ENV=production` boot guard'ı yok → NET-27'ye taşındı, orada takip edilecek.

### NET-11 · MCP dispatcher SNI + keepalive + timeout hizalama — kısmen tamamlandı
- **Ö:** Medium · **K:** S — SNI (`tlsOpts.servername`) ✅ uygulandı (client.cjs:73). **Kalan:** `new Agent({connect: tlsOpts})` çağrısına `connect:{timeout: CONNECT_TIMEOUT_MS}` ve keepAlive ayarları hâlâ eklenmedi. **Kabul:** kurum smoke değişmez; SNI'lı route'larda handshake doğru (bu kısım doğrulandı). **Bağımlılık:** NET-10 (tamamlandı).

### NET-12 · Instana header lazy-refresh
- **Ö:** Medium · **K:** S — `getInstance` token/baseUrl'i her connect'te env'den okur (instance cache'i URL'e bağlı kalır); admin system-config ile token değişimi restart'sız etkir. **Kabul:** env değiştir→disconnect→yeni çağrı yeni header'la. **Bağımlılık:** —

### NET-13 · MCP URL startup validation
- **Ö:** Medium · **K:** S — Boot'ta DT/Instana URL'leri `new URL` + boşluk/scheme/path kontrolü; hangi env değişkeninin bozuk olduğunu söyleyen mesaj (ERR_INVALID_URL'i ilk çağrıdan boot'a çeker, #14,#15,#16). NET-17'nin parçası olarak da uygulanabilir. **Bağımlılık:** NET-17.

## Kategori 5 — AI provider bağlantıları

### NET-14 · httpsPost sertleştirme: servername + port + destroy(error) — ✅ TAMAMLANDI
- **Ö:** High · **K:** S · **Durum:** Uygulandı (bkz. §1.4) — `server/ai/provider.cjs:76-77` (`port:443`, `servername:hostname`) ve `:117-119` (`req.destroy(new Error(...))` timeout'ta).

### NET-15 · AI sağlayıcı diag scriptleri
- **Ö:** Medium · **K:** S — `scripts/test-ai-provider.cjs [--provider openai|anthropic]`: key'siz istek → beklenen 401/anthropic eşleniği = "TLS+ağ OK" kanıtı; key varsa mini gerçek istek (opsiyonel `--live`); issuer/authorized raporu. **Kabul:** kurumda STATUS 401 çıktısı; sandbox'ta public CA ile ✓. **Bağımlılık:** NET-09 (sınıflandırma etiketi).

### NET-16 · HTTP durumlarının ağ hatalarından ayrık UI haritası
- **Ö:** Medium · **K:** S — ai-analyst + analyze-logs + DT/Instana yüzeylerinde classify() etiketine göre Türkçe mesaj (401→anahtar, 429→kota, 5xx→sağlayıcı, tls→sertifika+TLS-SETUP linki, dns→VPN). **Bağımlılık:** NET-09.

### NET-35 · `log_analiz/backend`'i merkezi CA/proxy katmanına bağlama (yeni bulgu, §1.11)
- **Ö:** High · **K:** M
- **Risk:** `log_analiz/backend/src/routes/admin.router.ts:1564` kurumsal ağda `api.anthropic.com`'a çıplak `fetch()` ile bağlanıyor — `server/ai/provider.cjs`'de zaten çözülmüş olan SSL-inspection/CA sorununun bu servis için henüz YAŞANMAMIŞ ama garantili bir tekrarı. `http-log.connector.ts` de NO_PROXY kapsamına girmiyor.
- **Etkilenen dosyalar:** `log_analiz/backend/src/routes/admin.router.ts`, `log_analiz/backend/src/connectors/http-log.connector.ts`, (opsiyonel: `webfetch.util.ts`, `alerting.service.ts` — düşük risk, dış/whitelist'li hedefler).
- **Mevcut davranış:** Her dosya bağımsız global `fetch()` kullanıyor; CA, proxy, timeout-retry, redact — hiçbiri paylaşılmıyor.
- **Hedef davranış:** `log_analiz/backend`, `bmw-portal`'ın `server/network/http-client.cjs`'ini (NET-08) ya paylaşılan bir npm workspace paketi olarak tüketir ya da (daha düşük karmaşıklık) kendi ince bir `buildCombinedCa()`/`decideProxy()` import'unu (aynı dosyaları relative path ile) kullanır. **Davranış korunur:** whitelist/SSRF kontrolleri (`webfetch.util.ts`) AYNEN kalır — bu görev sadece TLS/proxy katmanını ekler, güvenlik kısıtlarını gevşetmez.
- **Kabul kriterleri:** Kurumsal ağda `admin.router.ts` Anthropic çağrısı SELF_SIGNED/UNABLE_TO_GET_ISSUER hatası vermeden 401 veya gerçek yanıt döner; `http-log.connector.ts` NO_PROXY'ye giren hostlara direct bağlanır.
- **Test senaryoları:** Kurumsal CA'sız ortamda mevcut davranış (bugünkü gibi, muhtemelen hata) → sonra CA eklenince başarı; `bmw-portal` ile aynı mock-TLS entegrasyon testleri `log_analiz/backend` için de çalıştırılır (NET-25 altyapısı paylaşılabilir).
- **Geri dönüş planı:** Yeni import'lar kaldırılıp eski çıplak `fetch()` çağrılarına dönülür (dosya bazlı, izole revert).
- **Bağımlılık:** NET-08 (ortak http-client varsa doğrudan tüketilir; yoksa NET-01/05'in dosyaları relative import ile kullanılır).
- **Tahmini karmaşıklık:** M

## Kategori 6 — Environment/config yönetimi

### NET-17 · Startup config validator `server/config/validate.cjs`
- **Ö:** High · **K:** S
- **Hedef:** Boot'ta: (a) kritik URL'lerin parse kontrolü (boşluk dahil), (b) `.env.local` ham metninde duplicate key uyarısı, (c) CORP_CA_CERT_PATH yükleme sonucu, (d) prod'da MCP_TLS_INSECURE reddi (NET-27 kuralı burada uygulanır), (e) özet tablo logu. Hatalar: prod=fail-fast, dev=ERROR log.
- **Kabul:** Bozuk URL'lü .env ile boot, değişken ADIYLA hata verir; temiz env'de tek satır özet. **Bağımlılık:** NET-01. (Faz 0)

### NET-18 · system-config PUT duplicate-güvenli yazım
- **Ö:** Medium · **K:** S — PUT sırasında dosyada aynı anahtar birden fazlaysa hepsini tek satıra indir; yazım sonrası duplicate kontrolü. **Dosyalar:** `server/index.cjs` system-config PUT. **Bağımlılık:** NET-17.

### NET-19 · dotenv sıra güvencesi
- **Ö:** Low · **K:** S — `.env.local`'ın `.env`'i ezdiğini sabitleyen birim test + README notu. **Bağımlılık:** NET-24 (test altyapısı).

## Kategori 7 — Hata yönetimi ve loglama

### NET-20 · Secret redact helper + log denetimi
- **Ö:** High · **K:** S
- **Hedef:** `server/network/redact.cjs`: `redactHeaders(h)`, `redactUrl(u)`, `redactText(s)` (x-api-key/authorization/instana-api-token/password/token kalıpları). http-client (NET-08) ve mevcut TÜM bağlantı log noktaları bundan geçer; mevcut loglarda secret basan yer olmadığı testle sabitlenir.
- **Kabul:** Birim test: örnek header seti → maskeli; grep denetimi CI'de (NET-28 ile). **Bağımlılık:** — (Faz 0)

### NET-21 · dns/tls/proxy/http hata etiketlerinin uçtan uca yüzeylere işlenmesi
- **Ö:** Medium · **K:** S — health mesajları + friendlyDtError + AI hata banner'ları classify() etiketiyle önek alır (`[DNS]`, `[TLS]`...). **Bağımlılık:** NET-09.

## Kategori 8 — Health check ve diagnostics

### NET-22 · Health endpoint'lerine TLS/proxy teşhisi (secret'sız)
- **Ö:** Medium · **K:** S — `/api/dynatrace/health`, `/api/instana/health` (+gerçek connect testi eklenir — şu an yalnız configured), `/api/ai-analyst/health`: `{ tls:{caPath, pemBlocks, totalCerts, nearestExpiry}, proxy:{decision, noProxyMatched}, lastError }`. Token/anahtar ASLA girmez. **Bağımlılık:** NET-01, NET-05, NET-32.

### NET-23 · Tek-komut ağ teşhisi `scripts/diag-network.cjs`
- **Ö:** Medium · **K:** S — env özeti (redact'li) + CA metrikleri + test-tls hedefleri + MCP connect + AI 401 → tek rapor, CI-uyumlu exit code. **Bağımlılık:** NET-15, NET-20, NET-22.

## Kategori 9 — Test otomasyonu

### NET-24 · Birim test paketi + `npm test`
- **Ö:** High · **K:** M
- **Hedef:** `node:test` ile `test/` dizini: PEM parse/BOM/CRLF/dedup/bozuk/boş/olmayan-path (NET-01); NO_PROXY exact/suffix/wildcard/port/CIDR/IPv6 (NET-05/06); URL validation (NET-17); cause flattening + classify (NET-09); redact (NET-20); dotenv sırası (NET-19); audit kuyruk sıralılığı (mevcut inline test kalıcılaşır). Jenkins kalite kapısına `npm test` eklenir.
- **Kabul:** `npm test` yeşil; Jenkinsfile güncel. **Bağımlılık:** ilgili tasklar.

### NET-25 · Mock TLS/proxy entegrasyon testleri
- **Ö:** Medium · **K:** M — openssl ile üretilen sertifika setleri (geçerli kurumsal kök, intermediate-eksik, expired, hostname-mismatch, yanlış CA) + lokal https sunucular; mock CONNECT proxy ile proxy/bypass; lokal express ile 401/403/404/406/429/500 ayrımı; DNS-fail/timeout/ECONNRESET senaryoları. `npm run test:integration`. **Bağımlılık:** NET-24.

### NET-26 · Regresyon test seti (geçmiş 8 hata)
- **Ö:** Medium · **K:** S — SELF_SIGNED / UNABLE_TO_GET_ISSUER(_LOCALLY) / iç-route-ECONNRESET / ENOTFOUND-yanlış-host / ERR_INVALID_URL-boşluk / tek-PEM-string / sessiz-fetch-fallback senaryolarının her biri NET-24/25 altyapısında adlandırılmış test olarak. **Bağımlılık:** NET-24, NET-25.

## Kategori 10 — Güvenlik hardening

### NET-27 · Production'da insecure TLS engeli
- **Ö:** Critical · **K:** S
- **Hedef:** `NODE_ENV=production` iken: MCP_TLS_INSECURE=1 → boot FAIL (açık mesaj: TLS-SETUP.md); `NODE_TLS_REJECT_UNAUTHORIZED=0` tespit edilirse ERROR+unset önerisi. Dev'de: yalnız açık flag + her boot'ta WARN. NET-17 validator'ında uygulanır.
- **Kabul:** prod+insecure boot durur; dev davranışı değişmez. **Bağımlılık:** NET-17. (Faz 0)

### NET-28 · CI secret/anahtar bekçisi
- **Ö:** Medium · **K:** S — Jenkins kalite kapısına: `grep -r "BEGIN.*PRIVATE KEY" --include=* .` guard'ı + redact denetim grep'i (Authorization/x-api-key düz loglanıyor mu). **Bağımlılık:** NET-20.

### NET-29 · LogX hedef :1111 için fingerprint pinning (opsiyonel)
- **Ö:** Low · **K:** L — Envanter host kaydına opsiyonel `tls_fingerprint`; proxy.cjs bağlantıda karşılaştırır (self-signed dünyasında MITM'e karşı tek gerçekçi savunma). **Bağımlılık:** Faz 2 sonrası değerlendirme.

## Kategori 11 — Dokümantasyon

### NET-30 · Runbook: ağ teşhis akış şeması
- **Ö:** Medium · **K:** S — TLS-SETUP'a (veya `docs/RUNBOOK-NETWORK.md`) karar ağacı: hata kodu → katman → komut (diag-network/test-tls/test-ai-provider/test-dt-mcp) → çözüm; bu incelemedeki envanter tablosu bakım listesi olarak eklenir. **Bağımlılık:** NET-23.

### NET-31 · TOPOLOGY'ye T7: TLS/proxy karar akışı diyagramı
- **Ö:** Low · **K:** S — İstek → decideProxy → CA store → hedef; katman sahiplikleri. **Bağımlılık:** NET-05, NET-08.

## Kategori 12 — Sertifika yenileme ve operasyon

### NET-32 · `scripts/check-cert-expiry.cjs`
- **Ö:** Medium · **K:** S — `server/certs/**/*.pem` + bundle içindeki her sertifikanın notAfter taraması; <30 gün WARN, süresi dolmuş FAIL (exit 1); tablo çıktı. **Bağımlılık:** NET-01 (parse helper'ı paylaşır).

### NET-33 · build-ca-bundle'a expiry raporu + health'te nearestExpiry
- **Ö:** Medium · **K:** S — bundle üretirken süre uyarısı; NET-22 health alanını besler. **Bağımlılık:** NET-32.

### NET-34 · Sertifika yenileme prosedürü + zamanlanmış kontrol
- **Ö:** Low · **K:** M — docs prosedürü (kim/ne zaman/nasıl: fetch-ca→bundle→test-tls→deploy) + Jenkins aylık job (check-cert-expiry; FAIL'de bildirim). **Bağımlılık:** NET-32, NET-30.

---

# BÖLÜM 3 — Fazlar ve Patch Sırası

## Faz 0 — Minimum Güvenli Paket (önce bunlar; her biri bağımsız revert edilebilir)

| Sıra | Task | Neden önce | Durum |
|---|---|---|---|
| 1 | **NET-10** | Global TLS kapatma mutasyonu tüm prosesi etkiliyor — en tehlikeli mevcut davranış | ✅ TAMAMLANDI |
| 2 | **NET-01** | Trust-store bütünlüğü; sonraki her şeyin temeli | ✅ TAMAMLANDI |
| 3 | **NET-14** | 3 satırlık sertleştirme, kurum çözümüyle eşitlenme | ✅ TAMAMLANDI |
| 4 | **NET-17 (+NET-27 kuralı)** | Bozuk env/URL/insecure'un boot'ta yakalanması | 🔴 açık |
| 5 | **NET-20** | Yeni loglar eklenmeden redact tabanı | 🔴 açık |
| 6 | **NET-15** | "STATUS 401 = başarı" kanıtının kalıcı scripti (regresyon bekçisi) | 🔴 açık |

Kalan Faz 0 kapsamı artık yalnızca 4-5-6 (env/insecure boot guard, redact helper, kalıcı
diag script) — 1-2-3 kod tarafında bitti, sadece kurum makinesinde smoke ile teyit gerekiyor.

Faz 0 çıkış kriteri: kurum makinesinde `diag` akışı — test-tls 4/4 ✓, test-dt-mcp uçtan uca ✓,
test-instana ✓, test-ai-provider 401 ✓; `npm run build`+boot temiz.

## Faz 1 — Mimari Konsolidasyon

Sıra: NET-09 → NET-05 → NET-24 (test tabanı erken) → NET-02 → NET-08 (aşamalı: provider→ansible→nobetci) → NET-11 → NET-16 → NET-06/07 → NET-13/18 → **NET-35** (log_analiz/backend, NET-08 bittikten sonra).

Not (ca.cjs taşıma): `server/network/ca.cjs`'e taşıma NET-05/08 ile birlikte tek migration
commit'i olarak yapılır — `server/ai/ca.cjs` geriye uyumlu re-export bırakır (kırılma yok).

## Faz 2 — Operasyon ve Gözlemlenebilirlik

NET-32 → NET-33 → NET-22 → NET-23 → NET-25 → NET-26 → NET-28 → NET-30/31 → NET-12 → NET-19 → NET-34 → (değerlendirme: NET-04, NET-29).

## Bağımlılık grafiği (özet)

```
NET-01 ─┬─ NET-02 ─┐
        ├─ NET-03  ├─ NET-08 ── NET-07
        └─ NET-32 ─┴─ NET-33 ── NET-22 ── NET-23
NET-05 ─┬─ NET-06                │
        └────────────────────────┘
NET-09 ─┬─ NET-16 / NET-21 / NET-15
NET-17 ─┬─ NET-27 / NET-13 / NET-18 / NET-03
NET-20 ─── NET-28
NET-24 ─┬─ NET-25 ── NET-26
        └─ NET-19
```

## Korunacak davranışlar (her patch sonrası smoke)

```
OpenAI TLS testi: STATUS 401
Dynatrace MCP: 19 tool + list_problems uçtan uca
Instana MCP: 9 tool + tools/list
rejectUnauthorized=true (AI + MCP, kurumsal CA ile)
CA store: ~146 public kök + kurumsal zincirler (metrikli)
LogX proxy: gerçek host oturumu (5056 / portal-logx origin)
AI Analist: SSE akışı + portal_logx araçları
```
