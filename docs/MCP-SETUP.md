# MCP Kurulumu (Dynatrace + Instana) — Kurum Makinesi

> **ÖNEMLİ:** `.env.local` git'e dahil DEĞİLDİR (.gitignore). Aşağıdaki ayarlar
> her makinenin kendi `.env.local` dosyasına elle eklenmelidir — repo çekmek yetmez.
> `SELF_SIGNED_CERT_IN_CHAIN` hatasının 1 numaralı sebebi budur.
> Tam şablon (tüm değişkenler dummy değerlerle): kökteki [`.env.example`](../.env.example).
> Prod kurulumu: [DEPLOYMENT.md](DEPLOYMENT.md).
> **TLS/sertifika sorunları için birincil rehber: [TLS-SETUP.md](TLS-SETUP.md)**
> (fetch-ca scriptleri, birleşik bundle, NO_PROXY kuralları, hata matrisi).

## 1. Bağımlılıklar

```bash
npm install        # undici paketi MCP TLS/proxy desteği için gerekli
```

## 2. `.env.local`'a eklenecek blok

```bash
# ── MCP Sunucuları ──
DT_MANAGED_MCP_URL=https://dynatrace-mcp.apps-3rd-t.fw.garanti.com.tr/mcp

INSTANA_MCP_URL=https://instana-mcp.apps-3rd-t.fw.garanti.com.tr/mcp
INSTANA_API_TOKEN_NONPROD=FWTG0Jq8TX6rojLiiUzisg
INSTANA_BASE_URL_NONPROD=https://nonprod-gt.instana.apps.gbocpinstest2.fw.garanti.com.tr
INSTANA_API_TOKEN_PROD=5HGxA5JrQc-zED2Fg6Xx7g
INSTANA_BASE_URL_PROD=https://prod-gt.instana.apps.gbocpinsprod2.fw.garanti.com.tr

# TLS — SEÇENEK A (hızlı, geçici): sertifika doğrulamasını kapat
MCP_TLS_INSECURE=1
# TLS — SEÇENEK B (kalıcı, önerilen): full-chain CA (adım 3'ten sonra):
# CORP_CA_CERT_PATH=server/certs/mcp/ca-chain.pem
```

Not: Route'lar kurumsal (self-signed kök) CA imzalı — Node varsayılan olarak güvenmez.
`CORP_CA_CERT_PATH` tanımlı ve dosya okunabiliyorsa `MCP_TLS_INSECURE` otomatik yok sayılır.

## 3. Full-chain sertifika (kalıcı çözüm)

```bash
bash scripts/fetch-mcp-ca.sh
```

Script her iki MCP route'unun sunduğu zinciri `server/certs/mcp/ca-chain.pem`'e yazar.
Sonra `.env.local`'da `CORP_CA_CERT_PATH` satırını aktif edin, `MCP_TLS_INSECURE`'u silin.

**Zincir yetmezse** (hata devam ederse): sunucu genelde kök CA'yı göndermez.
Kurumsal kök sertifikayı (şirket sertifika portalı / IT) alıp `ca-chain.pem`'in
sonuna yapıştırın. Alternatifler:

```bash
# Alternatif 1: kök sertifikayı Node'un güven deposuna ekle
NODE_EXTRA_CA_CERTS=server/certs/mcp/ca-chain.pem npm run server

# Alternatif 2 (kurum makinesinde en pratik): işletim sisteminin sertifika
# deposunu kullan — kurumsal kök CA şirket bilgisayarlarında genelde OS'a yüklüdür
NODE_OPTIONS=--use-system-ca npm run server
```

## 4. Doğrulama

```bash
node scripts/test-dt-mcp.cjs           # Dynatrace: initialize → tools/list
node scripts/test-instana-mcp.cjs      # Instana nonprod
node scripts/test-instana-mcp.cjs prod # Instana prod
```

Test scriptleri başlıkta undici/TLS ayar durumunu basar ve hata halinde gerçek
sebebi (`fetch failed → <asıl hata> [KOD]`) gösterir.

## Hata → Çözüm tablosu

| Hata | Sebep | Çözüm |
|------|-------|-------|
| `SELF_SIGNED_CERT_IN_CHAIN` | Kurumsal CA güvenilir değil + bu makinede TLS ayarı yok | Adım 2'deki TLS satırları (A veya B) |
| `undici KURULU DEĞİL` | `npm install` yapılmamış | `npm install` |
| `ENOTFOUND` | Kurumsal DNS yok (VPN dışı) | VPN/kurumsal ağ |
| `406 Not Acceptable` | Eski SDK / yanlış Accept header | `npm install` (SDK ≥1.29 doğru header'ı gönderir) |
| `Instana yapılandırılmamış` | INSTANA_API_TOKEN_*/BASE_URL_* boş | Adım 2'deki Instana satırları |

## Portal içinde çoklu ortam

- **Dynatrace:** `?env=<alias>` query paramı (ConfigMap alias'ları, ör. `garanti-managed-test`).
- **Instana:** `?env=nonprod|prod` — ortam seçimi her istekte `instana-api-token` +
  `instana-base-url` header'larıyla yapılır (yukarıdaki env değişkenlerinden).
