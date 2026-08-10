# TLS / Sertifika Kurulumu — Kurumsal Ağ Rehberi

> Portalın dış bağlantıları (MCP route'ları + OpenAI/Anthropic) kurumsal ağda iki
> FARKLI sertifika evreninden geçer. Bu rehber her ikisinin de doğrulama AÇIK
> şekilde çalışmasını sağlar — `NODE_TLS_REJECT_UNAUTHORIZED=0` veya
> `rejectUnauthorized:false` kalıcı çözüm DEĞİLDİR ve kullanılmaz.

## Neden iki farklı zincir var?

| Trafik | Yol | Sertifikayı imzalayan |
|---|---|---|
| MCP (Dynatrace/Instana) | Doğrudan kurum içi OpenShift route | Kurum içi route CA'sı |
| OpenAI / Anthropic | Kurumsal internet çıkışı (**SSL inspection** — ör. Blue Coat) | Kurumsal inspection zinciri (`SSL-SG1-GLOBAL → Cloud Services CA - G3 → Cloud Services Root CA`) |

Node'un `https.Agent({ ca })` yapısında özel CA verildiğinde **varsayılan public kökler
devre dışı kalır** — bu yüzden tek zincir dosyası her iki trafiği çözmez. Portalın
çözümü (`server/ai/ca.cjs`): **public kökler + tüm kurumsal zincirlerin birleşimi**.

## Kurulum akışı

### Windows (kurum makinesi)

```powershell
# 1) Zincirleri yakala (her hedef için — kurumsal ağda):
powershell -ExecutionPolicy Bypass -File .\scripts\fetch-ca.ps1 -TargetHost api.openai.com
powershell -ExecutionPolicy Bypass -File .\scripts\fetch-ca.ps1 -TargetHost dynatrace-mcp.apps-3rd-t.fw.garanti.com.tr -OutDir server\certs\mcp
powershell -ExecutionPolicy Bypass -File .\scripts\fetch-ca.ps1 -TargetHost instana-mcp.apps-3rd-t.fw.garanti.com.tr -OutDir server\certs\mcp

# 2) Birleşik bundle üret (public kökler + tüm kurumsal zincirler):
node scripts\build-ca-bundle.cjs

# 3) Doğrula:
node scripts\test-tls.cjs
```

### Linux / macOS (RHEL sunucu dahil)

```bash
bash scripts/fetch-ca.sh api.openai.com
bash scripts/fetch-mcp-ca.sh                    # her iki MCP route'u birden
node scripts/build-ca-bundle.cjs
node scripts/test-tls.cjs
```

### 4) `.env.local` ayarı (her ortamda — dosya git ile gelmez!)

```env
CORP_CA_CERT_PATH=server/certs/combined-ca-chain.pem
# MCP_TLS_INSECURE artık GEREKMEZ — kaldırın (zincir varken zaten yok sayılır)
```

Uygulamayı yeniden başlatın; boot logunda şunu görmelisiniz:
```
[CA] Kurumsal zincir yüklendi: .../combined-ca-chain.pem
[AI] TLS güven deposu: 145 public kök + N kurumsal zincir (doğrulama AÇIK).
```

## Proxy kuralları (kritik)

Kurumsal internet çıkışı proxy'liyse:
```env
HTTPS_PROXY=http://proxy.sirket.com.tr:8080
# Kurum İÇİ MCP route'ları proxy'ye GİTMEMELİ — yoksa proxy CONNECT'i keser (ECONNRESET):
NO_PROXY=localhost,127.0.0.1,.fw.garanti.com.tr
```
MCP client `NO_PROXY`'yi host bazlı değerlendirir (suffix eşleşme; `server/mcp/client.cjs`).

**Etkisiz denemeler (yapmayın):** `npm config set proxy ...` yalnızca npm komutlarını
etkiler, çalışan uygulamanın fetch/https trafiğini yönlendirmez.

## "300 global kök" hakkında

Dünyadaki kamu kök CA sayısı ~145-155'tir (Node `tls.rootCertificates` = Mozilla güven
deposunun tamamı). `build-ca-bundle.cjs` bu TAM seti + kurumsal zincirlerinizi birleştirir
ve sayıyı raporlar. Daha fazla "kök" diye bir şey yoktur — geri kalan tüm sertifikalar bu
köklerin altındaki intermediate'lerdir; ihtiyaç duyulanlar fetch-ca ile zaten toplanır.

## Sorun giderme matrisi

| Hata | Anlamı | Çözüm |
|---|---|---|
| `ENOTFOUND` | DNS çözülmüyor — sertifika sorunu DEĞİL | VPN/kurumsal ağ; hostname'i doğrula (gerçek OpenShift route mu?) |
| `ERR_INVALID_URL` | URL bozuk (boşluk / birleşen satır) | `.env.local` satırlarını kontrol et — her değişken AYRI satırda, URL'de boşluk yok |
| `ECONNRESET` (proxy tanımlıyken) | Kurum içi adres proxy'ye gidiyor, proxy kesiyor | `NO_PROXY`'ye iç domain'leri ekle |
| `SELF_SIGNED_CERT_IN_CHAIN` | Zincirdeki kök güvenilir değil | fetch-ca + build-ca-bundle + `CORP_CA_CERT_PATH` |
| `SELF_SIGNED_CERT_IN_CHAIN` (SADECE proxy arkasındaki servis-özel hedeflerde, ör. Smart) | Hedef bir proxy'nin (ör. `SMART_PROXY_URL`) arkasında ve proxy SSL inspection yapıyor olabilir | `fetch-ca.sh <host> <port> <outdir> <proxy_host:port>` — proxy'nin AYNI CONNECT tüneli üzerinden zinciri yakalar |
| `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | Sunulan zincirin issuer'ı depoda yok (tipik: SSL inspection) | Hedefin (ör. api.openai.com) zincirini fetch-ca ile çek, bundle'ı yeniden üret |
| `AI API 429 ... quota` | TLS/ağ TAMAM — sağlayıcı kotası/bakiye | API hesabına bakiye/plan (portalda düzeltilecek şey yok) |
| Zincirde tek sertifika (leaf) | Sunucu intermediate göndermiyor | Kök/intermediate'i IT sertifika portalından alıp `*-ca-chain.pem`'e elle ekle |

## Dosya düzeni

```
server/certs/
├── mcp/<host>-ca-chain.pem        # fetch-ca çıktıları (route zincirleri)
├── openai/<host>-ca-chain.pem     # SSL inspection zinciri
├── ldap/ca-chain.pem              # LDAPS için (ayrı mekanizma: LDAP_CA_CERT_PATH)
└── combined-ca-chain.pem          # build-ca-bundle çıktısı → CORP_CA_CERT_PATH
```

Tüm `.pem/.cer` dosyaları gitignore'dadır — **her ortamda scriptlerle yeniden üretilir**
(ortamların inspection zincirleri farklı olabilir). Prod'da dosyalar
`/opt/bmw-portal/shared/certs/` altında sürümler arası korunur (bkz. DEPLOYMENT.md).
