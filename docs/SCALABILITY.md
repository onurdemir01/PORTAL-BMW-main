# Ölçeklenebilirlik Analizi — 3.000 Eş Zamanlı/Aktif Kullanıcı

> Tarih: 2026-07-10 · Kod tabanındaki somut bulgulara dayanır (dosya/satır referanslı).
> Öncelikler: **P0** = 3.000 kullanıcıda kesin arıza/veri kaybı riski, önce çözülmeli ·
> **P1** = ciddi performans/işletme riski · **P2** = iyileştirme.

## Özet Tablosu

| # | Alan | Mevcut Durum | Öncelik |
|---|------|--------------|---------|
| 1 | Session yönetimi | In-memory MemoryStore, tek proses | **P0** |
| 2 | Veri katmanı | 13 JSON dosyası + `fs.writeFileSync` | **P0** |
| 3 | Yatay ölçekleme | Stateless değil, tek instance | **P0/P1** |
| 4 | MSSQL bağlantı havuzu | max 10 bağlantı, index eksikleri | **P1** |
| 5 | In-memory cache'ler | Prosese bağlı, replikada tutarsız | **P1** |
| 6 | Rate limiting | Var ama 3.000 kullanıcıya kalibre değil | **P1** |
| 7 | Polling yükü | Dashboard 25s + Ansible 3s + DT 5dk | **P1** |
| 8 | LogX proxy | Yanıtlar tam buffer'lanıyor (50MB'a kadar) | **P1** |
| 9 | Frontend bundle/CDN | 1.2MB tek bundle, code splitting yok | **P2** |
| 10 | İzleme/alerting | Sadece health endpoint'leri + slow-log | **P2** |

---

## 1. Session Yönetimi — **P0**

**Mevcut durum:** `server/auth/index.cjs:88` — `express-session` varsayılan **MemoryStore** ile
kullanılıyor (hiçbir `store` parametresi verilmemiş). Ayrıca LDAP şifre cache'i (`_ldapCredCache`)
ve online-kullanıcı haritası (`_onlineUsers`) da proses belleğinde.

**Risk:**
- MemoryStore, express-session dokümantasyonunda açıkça "production için değil" olarak işaretli:
  bellek sızıntısı gibi büyür (3.000 aktif session × session payload ≈ yönetilemez GC baskısı).
- Sunucu restart'ında **tüm kullanıcılar logout** olur.
- Birden fazla instance çalıştırılamaz — session sadece bir proseste var.

**Öneri:**
- `connect-redis` + Redis ile session store. Session payload'ından `photoUrl` (base64 data-url,
  onlarca KB olabilir!) çıkarılıp ayrı bir Redis anahtarına veya diske alınmalı — şu an her
  istekte session ile birlikte deserialize ediliyor.
- LDAP cred cache ve `_onlineUsers` da Redis'e taşınmalı (TTL'li anahtarlar birebir karşılık).

## 2. Veri Katmanı: JSON Dosya Store'ları — **P0**

**Mevcut durum:** `server/data/` altında 13 JSON dosyası (duty-roster, important-links,
selfservice, ansible-ss-items, inventory-visible-tables, user-roles, page-visibility …).
Yazma her yerde `fs.writeFileSync` ile (server/index.cjs, links/index.cjs, selfservice/store.cjs,
ansible/store.cjs, inventory/index.cjs, auth/index.cjs).

**Risk:**
- **Read-modify-write yarışı:** iki eş zamanlı istek aynı dosyayı okuyup yazarsa biri kaybolur
  (ör. iki admin aynı anda link eklerse). 3.000 kullanıcıda bu istatistiksel kesinlik olur.
- `writeFileSync` event loop'u bloklar — büyüyen dosyalarda tüm istekler bekler.
- Çoklu instance'da dosyalar replikalar arasında paylaşılamaz/senkronize edilemez.

**Öneri:**
- Tüm JSON store'ları MSSQL portal DB'sine taşı (şema zaten var: `mssql-setup.cjs` deseni).
  Öncelik sırası: kullanıcı-yazılabilir olanlar (selfservice, links, duty-roster, user-roles) önce;
  salt-admin/nadiren yazılanlar (aliases, page-visibility) sonra.
- Geçiş süresince ara çözüm: yazmaları tek kuyruklu hale getir (per-file mutex + atomic rename).

## 3. Yatay Ölçekleme / Stateless'lık — **P0/P1**

**Mevcut durum:** Tek Node prosesi, iki port (5055 ana + 5056 LogX proxy izolasyonu).
State prosese gömülü: session, cache'ler, `_credStore` (LogX şifreleri, logx/index.cjs),
AWX token cache'leri, DT/Instana MCP bağlantı singleton'ları.

**Risk:** 1–2 çözülmeden replika artırılamaz; tek instance 3.000 kullanıcının tüm yükünü taşır
(Node tek thread — CPU-bound anlar [LogX HTML rewrite, büyük JSON parse] herkes için gecikme).

**Öneri (sıralı):**
1. Madde 1–2 ve 5'i çöz (Redis + DB) → prosesler stateless'a yaklaşır.
2. `_credStore` (LogX Basic Auth şifreleri) bilinçli olarak bellekte — replikalar arası sticky
   session (LB'de `ip_hash`/cookie affinity) VEYA şifrelerin kısa ömürlü şifreli Redis kaydına
   taşınması gerekir. Güvenlik değerlendirmesiyle karar verilmeli.
3. N replica + nginx/HAProxy LB. **Not:** LOGX_PROXY_PORT (5056) ayrı origin izolasyonu için —
   LB'de ayrı upstream olarak yönlendirilmeli, sertifika/host yapılandırması buna göre.
4. MCP bağlantıları replika başına birer singleton olarak kalabilir (sorun değil).

## 4. Veritabanı (MSSQL) — **P1**

**Mevcut durum:** `server/db/portal-mssql.cjs:20` → `pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }`.
Envanter için ayrı pool (`server/inventory/mssql.cjs`). `logx_audit_logs` sorguları
`ORDER BY created_at DESC` + `username/target_host/action` filtreleri kullanıyor (audit.cjs getLogs).

**Risk:** 3.000 kullanıcıda 10'luk havuz anlık yoğunlukta kuyruklanır (özellikle audit yazmaları
her LogX proxy isteğinde çalışıyor). `created_at`/`username` üzerinde index yoksa audit listeleme
tablo büyüdükçe (yüz binlerce satır) yavaşlar.

**Öneri:**
- Pool `max`'ı 25–50'ye çıkar (DB sunucusunun bağlantı limitine göre), `min: 2` ısınma için.
- Index'ler: `logx_audit_logs(created_at DESC)`, `(username, created_at)`, `(target_host)`.
  `logx_sessions(expires_at)` (expiry job taraması için).
- Audit yazması şu an her proxy isteğinde senkron `await`siz `.catch(()=>{})` ile — doğru desen;
  yüksek hacimde batch insert kuyruğuna geçilebilir.

## 5. Cache Stratejisi — **P1**

**Mevcut durum:** Modül seviyesinde in-memory cache'ler: nobetci list/today (server/index.cjs),
DT health (dynatrace/index.cjs, 30s), frontend'te de ayrıca module-level TTL cache'ler
(nobetciApi, dynatraceApi, inventoryApi, logxApi). AWX token cache'leri (runner.cjs).

**Risk:** Tek proseste sorunsuz; çoklu replikada her replika ayrı cache tutar → tutarsız görünüm
(ör. bir replikada nöbetçi cache'i temizlendi, diğerinde eski). Admin "cache temizle" butonları
sadece istek düşen replikayı temizler.

**Öneri:** Yatay ölçeklemeyle birlikte server-side cache'leri Redis'e taşı (aynı TTL'lerle).
Frontend cache'leri kullanıcı-lokal olduğu için değişiklik gerekmez. Cache temizleme endpoint'leri
Redis anahtarı sildiğinde tüm replikalar aynı anda tazelenir.

## 6. Rate Limiting — **P1**

**Mevcut durum:** `server/service.cjs:33-50` — login: 10/dk/IP; genel API: **300/dk/IP**.

**Risk:** Kurumsal ağda binlerce kullanıcı aynı NAT/proxy IP'sinden gelebilir → 300/dk **paylaşılan**
limit anında dolar (yanlış pozitif ban). Öte yandan pahalı endpoint'lerin (AI analyze, AWX launch,
LogX proxy) özel limiti yok.

**Öneri:**
- Genel limiti IP yerine **session kullanıcısına** göre anahtarla (`keyGenerator: req.session?.user?.username || ip`),
  değeri kullanıcı başına 120/dk gibi belirle.
- Özel limitler: `/api/logx/analyze` (zaten uygulama içi 10/saat var — iyi), `/api/ansible/*launch*`
  kullanıcı başına 10/dk, `/api/logx/proxy` kullanıcı başına 300/dk (log arayüzü çok istek atar).
- Çoklu replika için rate-limit sayaçları da Redis'te tutulmalı (`rate-limit-redis`).

## 7. Polling / Gerçek Zamanlı Yük — **P1**

**Mevcut durum:** WebSocket/SSE yok; her şey polling:
- Dashboard online-users: 25s (yeni eklendi)
- Ansible job status: 3s (çalışan job başına)
- DT problems: 5dk + sayfa mount'ları
- LogX heartbeat: 2dk (açık oturum başına)

**Projeksiyon (3.000 aktif, ~%20'si dashboard'da):** online-users tek başına ≈ 600 istek/25s ≈ 24 rps.
Toplam arka plan polling gerçekçi senaryoda 40–80 rps — Node için taşınabilir ama DB'ye inen
istekler cache'lenmezse (madde 5) sorun olur.

**Öneri:**
- `/api/auth/online` zaten saf bellek — ucuz, sorun değil. Yine de yanıtı 5s server-side micro-cache'le.
- Job status polling'i çalışan job'larla sınırlı — kabul edilebilir. 100+ eş zamanlı job izleyicisi
  görülürse SSE'ye geçiş (tek bağlantı, sunucu push) planlanmalı; Express'te `res.write` ile basit.
- DT problems zaten 5dk cache'li (dynatrace/cache.cjs) — yeterli.

## 8. LogX Proxy Bellek Profili — **P1**

**Mevcut durum:** `server/logx/proxy.cjs` — her upstream yanıtı **tamamen buffer'lanır**
(`Buffer.concat(chunks)`), istek gövdesi için `express.raw({ limit: '50mb' })`.
HTML yanıtlarda string'e çevirip regex rewrite yapılıyor.

**Risk:** 50 kullanıcı aynı anda 20MB'lık log dosyası açarsa ≈ 1GB anlık heap. Node varsayılan
heap limitiyle (≈4GB) 3.000 kullanıcıda OOM gerçekçi bir risk.

**Öneri:**
- HTML olmayan içerik (log dosyaları, binary) **stream pass-through** yapılmalı — rewrite sadece
  `text/html`'de gerekiyor; content-type'a göre `res.pipe` dallanması eklenebilir.
- İstek/yanıt boyut limitini düşür (log görüntüleme için 50MB gereksiz; 10MB + Range desteği).
- `--max-old-space-size` bilinçli set edilmeli; container limitiyle hizalı.

## 9. Frontend / Statik Varlıklar — **P2**

**Mevcut durum:** Vite build → **tek 1.2MB JS bundle** (gzip 240KB, build uyarısı mevcut).
Statik servis şu an Vite dev / Express üzerinden; CDN/cache header stratejisi yok.

**Öneri:**
- Route bazlı code splitting: `React.lazy(() => import(...))` ile sayfa bileşenleri
  (LogX, Ansible, Envanter, Dynatrace en büyük adaylar) — ilk yük ≈ %50 küçülür.
- Prod'da statikler nginx'ten `Cache-Control: public, max-age=31536000, immutable`
  (Vite hash'li dosya adları bunu güvenli kılar) + `index.html` no-cache.
- Kurum içi CDN/reverse-proxy cache varsa statik path'ler oraya alınmalı.

## 10. İzleme ve Alerting — **P2**

**Mevcut durum:** Health endpoint'leri (inventory, logx, dynatrace, instana) + `service.cjs`'te
500ms üzeri istekleri loglayan basit slow-log. Metrik toplama/alerting yok.

**Öneri:**
- `prom-client` ile `/metrics`: istek sayısı/latency histogramı (route bazlı), event loop lag,
  heap kullanımı, MSSQL pool doluluk, LogX aktif session sayısı, audit yazma hataları.
- Temel alert seti: p95 latency > 1s (5dk), event loop lag > 200ms, pool exhaustion,
  5xx oranı > %2, heap > %80.
- Mevcut Dynatrace/Instana entegrasyonu varken portalın kendisi de Instana agent'ı ile izlenebilir —
  en düşük maliyetli seçenek bu.

---

## Önerilen Yol Haritası

1. **Faz 1 (P0, ~1-2 hafta):** Redis kurulumu → session store + LDAP cred + online-users taşıma;
   JSON store'ların kullanıcı-yazılabilir olanlarını MSSQL'e taşıma.
2. **Faz 2 (P1):** Pool/index ayarları; rate-limit kullanıcı-bazlı + Redis; LogX proxy streaming;
   server cache'lerinin Redis'e taşınması.
3. **Faz 3 (ölçekleme):** 2-3 replica + LB (sticky veya cred-store çözümü ile); yük testi
   (k6/artillery ile 3.000 sanal kullanıcı senaryosu) — hedef: p95 < 500ms, hata < %0.5.
4. **Faz 4 (P2):** Code splitting + statik cache; prometheus metrics + alerting.
