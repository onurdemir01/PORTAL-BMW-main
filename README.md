# BMW Portal — Kurumsal Operasyon Merkezi

Node.js + Express backend, React 19 + TypeScript + Vite frontend'den oluşan portal uygulaması.

## Özellikler

| Modül | Açıklama |
|---|---|
| **Dashboard** | KPI'lar, günün nöbetçisi, canlı kullanıcılar, Dynatrace problem özeti |
| **Envanter** | MSSQL envanter tabloları — rol bazlı görünürlük, gelişmiş filtre, CSV |
| **LogX** | Hedef sunuculardaki :1111 log arayüzüne güvenli proxy (izole origin iframe), audit hash zinciri |
| **Self Service / Ansible** | AWX template kataloğu (çoklu sunucu), survey/extra_vars formları, canlı job çıktısı |
| **Performance** | Dynatrace **Managed** MCP — problems/events/entities/metrics, çoklu ortam (alias) |
| **AI Analist** | LLM'in Dynatrace+Instana MCP araçlarını zincirleme çağırdığı analiz sohbeti (SSE) + PII maskeli log analizi |
| **Nöbet** | Nöbetçi API entegrasyonu + takvim |
| **Admin** | Roller, sayfa erişimi, sistem ayarları (env görüntüle/düzenle), audit log |

## Dokümantasyon

| Doküman | İçerik |
|---|---|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | **RHEL 8/9 production kurulumu** — adım adım |
| [docs/DATABASE.md](docs/DATABASE.md) | **MSSQL semasi** — tum tablolar ve kalicilik modeli |
| [docs/SETUP-SIMPLE.md](docs/SETUP-SIMPLE.md) | Yerel gelistirme kurulumu |
| [docs/MCP-SETUP.md](docs/MCP-SETUP.md) | Dynatrace/Instana MCP bağlantı kurulumu + TLS |
| [docs/SCALABILITY.md](docs/SCALABILITY.md) | 3.000 kullanıcı ölçekleme analizi |
| [docs/SCALEX.md](docs/SCALEX.md) | **ScaleX** — OCP replica durdurma/geri alma/ölçekleme; kapılar, yetki, tuzaklar |
| [Jenkinsfile](Jenkinsfile) | CI/CD pipeline (build → paket → onaylı deploy → health/rollback) |

---

## Hızlı Başlangıç (Geliştirme)

```bash
npm install
cp .env.example .env.local     # değerleri doldurun (aşağıya bakın)

# Geliştirme modunda çalıştır (server + frontend paralel)
npm run dev:all

# Sadece backend / sadece frontend
npm run server
npm run dev

# Production build + production modda çalıştırma
npm run build
npm start                      # NODE_ENV=production — dist/'i de servis eder
```

**Gereksinimler:** Node.js >= 20, npm >= 9

## Production

Tam kurulum için **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — özet (tek :3000 semasi):

```bash
# zip'i sunucuya kopyala → /vhosting8/bmw_portal/deploy/PORTAL-BMW-main.zip
cd /vhosting8/bmw_portal/app/PORTAL-BMW-main
./deploy/release.sh prod        # stop → yedek → unzip → npm ci → build → start (:3000)
```

Kurumsal nginx 443'u :3000'e proxy'ler (dokunulmaz — referans: `deploy/BMW_Portal-D.conf`).
Node production modda dist/ + /api'yi ayni porttan servis eder; **tum kalici veri
MSSQL'dedir (TBMWANS)** — surum degisiminde hicbir kayit/ayar kaybolmaz.

---

## Ortam Değişkenleri

Proje kök dizinine `.env.local` dosyası oluşturun — **tam şablon ve tüm değişkenlerin
açıklamaları için [`.env.example`](.env.example)** (dummy değerler/pattern'lerle).
Aşağıdaki tablolar özet referanstır.

### Temel Ayarlar

| Değişken | Açıklama | Örnek |
|----------|----------|-------|
| `PORT` | Backend port (sunucu ortamlari: `3000`, yerel dev: `5055`) | `3000` |
| `NODE_ENV` | Ortam | `production` |
| `SESSION_SECRET` | Session imza anahtarı (`openssl rand -hex 32`) | `a1b2c3...` |
| `LOGX_PROXY_PORT` | LogX iframe izolasyon portu (dev) | `5056` |
| `LOGX_PROXY_PUBLIC_URL` | LogX izolasyon hostname'i (**prod/nginx'te zorunlu**) | `https://portal-logx.sirket.com.tr` |

### Yerel Fallback Kullanıcıları

LDAP erişilemediğinde veya geliştirme ortamında kullanılır.

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `LOCAL_ADMIN_USER` | Admin kullanıcı adı | `admin` |
| `LOCAL_ADMIN_PASS` | Admin şifre — **boşsa hesap çalışmaz** | _(boş)_ |
| `LOCAL_USER` | Normal kullanıcı adı | `user` |
| `LOCAL_USER_PASS` | Normal kullanıcı şifre — **boşsa hesap çalışmaz** | _(boş)_ |

> **Güvenlik:** şifreyi kullanıcı adıyla aynı yapmak (`admin`/`admin`, `user`/`user`)
> sunucu tarafında açıktan engellenir; env'de böyle ayarlansa bile giriş reddedilir.
> Bilinçli olarak açmak gerekirse `ALLOW_WEAK_LOCAL_PASS=true`.

### MSSQL (Envanter)

| Değişken | Açıklama |
|----------|----------|
| `MSSQL_SERVER` | Sunucu IP/hostname |
| `MSSQL_PORT` | Port (varsayılan: 1453) |
| `MSSQL_DATABASE` | Veritabanı adı |
| `MSSQL_USER` | Kullanıcı adı |
| `MSSQL_PASSWORD` | Şifre |

### LDAP / LDAPS Kimlik Doğrulama

| Değişken | Açıklama | Örnek |
|----------|----------|-------|
| `LDAP_URL` | LDAP sunucu URL | `ldaps://adds.sirket.com.tr:636` |
| `LDAP_BASE_DN` | Arama tabanı | `DC=sirket,DC=com,DC=tr` |
| `LDAP_BIND_DN` | Servis hesabı DN | `CN=svc,OU=Users,DC=...` |
| `LDAP_BIND_PASSWORD` | Servis hesabı şifresi | |
| `LDAP_REJECT_UNAUTHORIZED` | SSL sertifika doğrulama | `false` (self-signed için) |
| `LDAP_CA_CERT_PATH` | CA sertifikası yolu | `server/certs/ldap/ca-chain.pem` |
| `LDAP_ADMIN_GROUP` | Admin grubu DN | `CN=Portal_Admins,OU=...` |
| `LDAP_USER_GROUP` | Normal kullanıcı grubu DN | `CN=Portal_Users,OU=...` |

> `LDAP_ADMIN_GROUP` ve `LDAP_USER_GROUP` boş bırakılırsa tüm LDAP kullanıcıları `User` rolü alır.

### Ansible AWX

| Değişken | Açıklama |
|----------|----------|
| `AWX_URL` | AWX/Tower URL |
| `AWX_TOKEN` | AWX API token (tercih edilen) |
| `AWX_USER` | AWX kullanıcı adı (token yoksa) |
| `AWX_PASSWORD` | AWX şifre |
| `AWX_READ_ONLY_TEMPLATE_IDS` | İzin verilen template ID'leri (virgülle) |
| `AWX_LOG_FETCH_TEMPLATE_ID` | LogX log çekme template ID'si |

### Nöbet API

| Değişken | Açıklama | Örnek |
|----------|----------|-------|
| `NOBETCI_TEAM_ID` | Takım ID (set ise `/list/{ID}/{TYPE}` çağrılır — **önerilen**) | `1700000000000` |
| `NOBETCI_TEAM_TYPE` | Takım tipi | `CUSTOM` |
| `NOBETCI_TEAM_NAME` | Görünen takım adı | `Takim-Adi` |
| `NOBETCI_API_URL` | Alternatif tam URL (TEAM_ID boşsa) | `https://nobet.../api/...` |
| `NOBETCI_API_HOST` | DNS bypass: doğrudan IP | `10.x.x.x` |

**Neden `NOBETCI_API_HOST`?**
Nöbet API'si kurumsal iç hostname kullanır. Lokalde DNS çözümlenemiyor olabilir.
- Kurumsal sunucuda (`gbaocp01` gibi) bu değişken gerekmez — DNS zaten çalışır
- Lokal geliştirmede `NOBETCI_API_HOST=<IP>` ile DNS bypass yapılabilir
- API başarısız olursa Nöbet Listesi sayfasındaki manuel kayıtlar otomatik fallback olarak kullanılır

### MCP (Dynatrace Managed + Instana)

| Değişken | Açıklama | Örnek |
|----------|----------|-------|
| `DT_MANAGED_MCP_URL` | Dynatrace **Managed** MCP (https + `/mcp`!) | `https://dynatrace-mcp.sirket.com.tr/mcp` |
| `DT_DEFAULT_ENV_ALIAS` | Varsayılan environment alias | `takim-managed-test` |
| `INSTANA_MCP_URL` | Instana MCP | `https://instana-mcp.sirket.com.tr/mcp` |
| `INSTANA_API_TOKEN_*` / `INSTANA_BASE_URL_*` | nonprod/prod token + base-url | |
| `CORP_CA_CERT_PATH` | Kurumsal CA zinciri (`scripts/fetch-mcp-ca.sh` üretir) | `server/certs/mcp/ca-chain.pem` |
| `MCP_TLS_INSECURE` | Geçici: sertifika doğrulamasını kapat (CA varsa yok sayılır) | `1` |

Detay + sorun giderme: [docs/MCP-SETUP.md](docs/MCP-SETUP.md)

### AI (Log Analizi + AI Analist)

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `AI_PROVIDER` | `anthropic` veya `openai` | `anthropic` |
| `ANTHROPIC_API_KEY` | Anthropic API anahtarı | |
| `ANTHROPIC_MODEL` | Model adı | `claude-haiku-4-5-20251001` |
| `OPENAI_API_KEY` | OpenAI API anahtarı | |
| `OPENAI_MODEL` | Model adı | `gpt-4o-mini` |

Limitler kullanıcı başına: log analizi 10/saat, AI Analist sohbeti 20/saat.

---

## Proje Yapısı

```
├── server/
│   ├── index.cjs            # Ana sunucu (nöbet proxy, system-config, prod static)
│   ├── service.cjs          # Express app factory (rate limit, compression)
│   ├── ai/                  # Ortak AI sağlayıcı çekirdeği (provider, rate limit)
│   ├── ai-analyst/          # AI Analist — MCP tool-use orkestrasyonu (SSE)
│   ├── auth/                # LDAP + session + online kullanıcılar + roller
│   ├── ansible/             # AWX entegrasyonu (çoklu sunucu, survey/extra_vars)
│   ├── db/                  # MSSQL pool + PG-dialect adapter + şema kurulumu
│   ├── dynatrace/           # Dynatrace MANAGED MCP proxy route'ları
│   ├── instana/             # Instana MCP (nonprod/prod header'lı)
│   ├── mcp/                 # Ortak MCP client factory + generic admin endpoint'leri
│   ├── inventory/           # Envanter sorguları (rol bazlı görünürlük)
│   ├── links/               # Portal linkleri (kategori bazlı)
│   ├── logx/                # :1111 proxy (izole origin), PII maskeli analiz, audit zinciri
│   ├── selfservice/         # Self-service katalog CRUD
│   ├── tasks/               # Görev yönetimi
│   └── data/                # JSON store (git'e girmez; prod'da shared/data symlink'i)
│
├── src/
│   ├── api/                 # Fetch client'lar
│   ├── components/          # Sayfalar (ai_analyst/, dynatrace/, logx/, admin/tabs/ ...)
│   ├── contexts/            # Auth + AppData
│   └── layouts/             # AppLayout + Sidebar
│
├── deploy/                  # systemd unit, nginx conf, RHEL hazırlık scripti
├── scripts/                 # deploy.sh, MCP test scriptleri, fetch-mcp-ca.sh
├── docs/                    # DEPLOYMENT, DATABASE, MCP-SETUP, SCALABILITY
├── Jenkinsfile              # CI/CD pipeline
├── .env.local               # Ortam değişkenleri (git'te YOK)
└── .env.example             # Şablon (git'te var, dummy değerler)
```

---

## Kullanıcı Rolleri

| Rol | Erişim |
|-----|--------|
| `Admin` | Tüm sayfalar + Admin merkezi |
| `User` | Konfigüre edilen sayfalar |

**Rol belirleme sırası:**
1. `server/data/user-roles.json`'da manuel override → o rol geçerli
2. Yoksa LDAP grup üyeliği (`LDAP_ADMIN_GROUP` / `LDAP_USER_GROUP`)
3. LDAP kapalıysa yerel kullanıcılar (`LOCAL_ADMIN_USER` = Admin, `LOCAL_USER` = User)

**Sayfa görünürlüğünü değiştirmek:** Admin Merkezi → Sayfa Erişimi sekmesi

**Kullanıcıya manuel rol atamak:** Admin Merkezi → Kullanıcılar sekmesi

---

## LogX — SSL ve 1111 Portu

- Bağlantı önce HTTP ile denenir
- Sunucu HTTPS bekliyorsa (self-signed dahil) otomatik HTTPS'e geçilir
- `rejectUnauthorized: false` ile kurumsal self-signed sertifikalar kabul edilir
- Frontend, SSL durumunu `test-access` sonucundan alır ve oturum açarken iletir

---

## Güvenlik

- DB şifreleri ortam değişkeninden okunur, kaynak kodda sabit değer yok
- `/api/inventory/query` yalnızca SELECT sorgularına izin verir
- Envanter tablo erişimi whitelist ile korunur
- LogX AI analizine göndermeden önce PII maskeleme uygulanır (TCKN, kart, IBAN, e-posta)
- Ansible yalnızca okuma/izleme yapar; `changed` output uyarı olarak gösterilir
- `server/data/` ve `.env.local` `.gitignore`'da — commit edilmez

---

## Geliştirme

```bash
# TypeScript kontrol
npx tsc --noEmit

# Yerel giriş (LDAP kapalıyken)
# Kullanıcı: admin  Şifre: admin
```

