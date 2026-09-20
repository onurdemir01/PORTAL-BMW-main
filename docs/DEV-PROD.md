# DEV ↔ PROD ayrımı (2026-09-20)

**Neden:** 20 Eylül'de `main`'e giren bir değişiklik (Nginx Hub bellek kullanımı) doğrudan
kullanıcıya gitti ve Portal OOM ile çöktü; ayrıca her release'de dakikalarca 503 görülüyor.
Kök sebep tek ortam: geliştirme, deneme ve kullanıcıya sunulan sürüm aynı süreç, aynı dal.

**Karar:** aynı sunucuda (GBLABT02) **iki Portal örneği**, aynı **TBMWANS** veritabanında **iki
şema**, GitHub'da **iki dal**. Yeni veritabanı gerekmez.

| | PROD (kullanıcı) | DEV (biz) |
|---|---|---|
| Dal | `main` | `develop` |
| Dizin | `/vhosting8/bmw_portal` | `/vhosting8/bmw_portal_dev` |
| Port | 3000 (`.env.prod`) | 3001 (`.env.dev`) |
| DB kullanıcısı | `TBMWANS_usr` (varsayılan şema `dbo`) | `TBMWANS_dev_usr` (varsayılan şema **`dev`**) |
| Portal tabloları | `dbo.portal_users`, `dbo.ansible_job_history` … | `dev.portal_users`, `dev.ansible_job_history` … |
| Envanter tabloları (Ansible yazar) | `dbo.Inventory`, `dbo.nginx_inventory`, `dbo.Nginx_Audit_*` … | **aynı `dbo` tablolar, salt okunur paylaşım** |
| /sw dizinleri | `/sw/BMW_PORTAL/...` | `/sw/BMW_PORTAL_DEV/...` (`NGINX_CONSOLE_DIR`, `DB_FULL_BACKUP_DIR`, staging) |
| AWX template'leri | prod Playbook Kayıtları | dev Playbook Kayıtları (aynı template'ler olabilir; DB kaydı şemaya göre ayrı) |

## Nasıl çalışıyor (kod değişikliği yok denecek kadar az)

Portal kendi tablolarına her yerde **şema adı yazmadan** erişir (`SELECT ... FROM portal_users`).
MSSQL, nitelenmemiş adı bağlantı kullanıcısının **varsayılan şemasında** arar. Dev kullanıcısının
varsayılan şeması `dev` olunca aynı kod `dev.portal_users`'a gider; `mssql-setup.cjs` açılışta
tabloları **o şemada** oluşturur (varolus kontrolleri `TABLE_SCHEMA = SCHEMA_NAME()` ile —
2026-09-20'de eklendi). Envanter tabloları kodda `dbo.` ile nitelenmiştir, iki ortam da aynı
veriyi okur; Envanter listesi/kolon keşfi `TABLE_SCHEMA = 'dbo'` ile filtrelenir, dev şemasındaki
Portal tabloları envanter sanılmaz.

## Kurulum — bir kez (sen)

### 1. Veritabanı (TBMWANS'ta, DBA ya da db_owner ile)
```sql
USE TBMWANS;
CREATE SCHEMA dev AUTHORIZATION dbo;
CREATE LOGIN TBMWANS_dev_usr WITH PASSWORD = '<güçlü parola>';
CREATE USER TBMWANS_dev_usr FOR LOGIN TBMWANS_dev_usr WITH DEFAULT_SCHEMA = dev;
-- dev şemasında her şey; dbo'da yalnız okuma (envanter) — dev prod tablolarına YAZAMAZ
GRANT CONTROL ON SCHEMA::dev TO TBMWANS_dev_usr;
GRANT CREATE TABLE TO TBMWANS_dev_usr;
GRANT SELECT ON SCHEMA::dbo TO TBMWANS_dev_usr;
GRANT VIEW DEFINITION ON SCHEMA::dbo TO TBMWANS_dev_usr;
```
İstersen prod verisinin bir kopyasıyla başla (kullanıcılar, playbook kayıtları, görünürlük):
```sql
SELECT * INTO dev.portal_users FROM dbo.portal_users;                 -- benzer şekilde
SELECT * INTO dev.ansible_playbook_registry FROM dbo.ansible_playbook_registry;
SELECT * INTO dev.ansible_awx_servers FROM dbo.ansible_awx_servers;
SELECT * INTO dev.portal_elements FROM dbo.portal_elements;
SELECT * INTO dev.portal_element_visibility FROM dbo.portal_element_visibility;
```
(`SELECT INTO` IDENTITY'yi korur ama PK/varsayılan değerleri kopyalamaz; boş bırakıp Portal'ın
kendi şemasını oluşturmasına izin vermek de olur — ilk açılışta tüm tablolar `dev` altında kurulur,
kullanıcıları elle eklersin.)

### 2. Dev örneği (GBLABT02, `was` ile)
```bash
mkdir -p /vhosting8/bmw_portal_dev/{app,deploy}
PORTAL_BASE_DIR=/vhosting8/bmw_portal_dev bash /vhosting8/bmw_portal/app/PORTAL-BMW-main/deploy/release-git.sh dev develop
```
`.env.dev` = `.env.prod` kopyası, şu farklarla: `PORT=3001`, `PORTAL_DB_USER=TBMWANS_dev_usr` +
parolası, `NGINX_CONSOLE_DIR=/sw/BMW_PORTAL_DEV/nginx_console`, `DB_FULL_BACKUP_DIR=/sw/.../backup_dev`,
LogX/OpsX staging dizinleri `_DEV`, `TEAMS_*` webhook'ları **boş** (dev'den Teams'e mesaj gitmesin),
`SMART_*` kapalı ya da test kuyruğu. nginx'e `bmw-dev.fw.garanti.com.tr` (ya da `/dev` yolu) →
`localhost:3001`. systemd: `bmw-portal@dev` (unit'teki `WorkingDirectory`'yi dev dizinine kopyalayıp
`bmw-portal-dev@.service` olarak ayrı unit).

### 3. GitHub
- `develop` dalı açıldı (2026-09-20). **Branch protection** (Settings › Branches › `main`): "Require a
  pull request before merging" + "Require status checks" (varsa Jenkins). Böylece `main`'e doğrudan
  push mümkün olmaz; herkes `develop`'a çalışır.

## Günlük akış (biz: Onur, Hakan, Claude)

1. Her değişiklik **`develop`**'a gider (doğrudan push ya da küçük PR'lar). `main`'e kimse push'lamaz.
2. Dev örneği `develop`'ı koşar: `PORTAL_BASE_DIR=/vhosting8/bmw_portal_dev deploy/release-git.sh dev develop`
   — istediğimiz kadar sık, gündüz, kimse etkilenmez. Dev'de kullanıcılar biziz.
3. Bir özellik dev'de bir-iki gün yaşadı, OOM/503/yanlış veri görmedik → release adayı.

## Release (haftada bir, mesai dışı — örn. Perşembe 18:30 ya da Cuma 07:30)

1. GitHub'da PR: `develop → main`, başlık `Release YYYY-MM-DD`, açıklamada değişiklik listesi
   (commit başlıkları yeter). Hakan ya da sen onaylar → merge.
2. GBLABT02'de: `bash deploy/release-git.sh prod main`
   - Yeni: **test kapısı** — `npm test` koşar; bilinen taban dışında hata varsa **swap yapılmaz**,
     eski sürüm çalışmaya devam eder (`SKIP_TESTS=1` acil durum için).
   - Staging build eski sürüm çalışırken yapılır, swap birkaç saniye; kullanıcı 3 dk "Portal
     güncelleniyor" ekranıyla oturumunu kaybetmeden bekler.
3. 10 dk gözlem: `journalctl -u bmw-portal@prod -f`, Admin › Denetim Kaydı, RSS/heap (`ps -o rss`).
   Sorun → `deploy/rollback.sh` (son 3 yedek).
4. Acil düzeltme (hotfix) gerekirse: `develop`'ta düzelt, test et, aynı gün küçük PR ile `main`'e — ama
   yine mesai dışı; gerçekten acilse (Portal ayakta değil) hemen.

## Sıfır kesinti — sonraki adım (isteğe bağlı)

503 penceresini tamamen kapatmak için mavi/yeşil: nginx upstream'inde iki port (3000/3002),
release yeni sürümü boş porta kaldırır, `/api/health` yeşil olunca upstream değişir, eski süreç
kapanır. Oturumlar DB'de, kullanıcı hiçbir şey görmez. ~1 günlük iş; DEV/PROD ayrımı oturunca.

## Hakan'a özet
- Artık `main`'e push yok; `develop`'a çalış. Dev Portal: `https://bmw-dev...:3001` (`.env.dev`, `dev` şeması).
- Prod'a çıkış haftalık PR + mesai dışı `release-git.sh prod main`; test kapısı kırmızıysa çıkmaz.
- Envanter tabloları (`dbo.*`) ortak ve dev'den yazılamaz; Portal tabloları dev şemasında ayrı —
  dev'de kullanıcı/kayıt eklemek prod'u etkilemez.
- Teams webhook'ları dev'de boş; dev'den bildirim gitmez.
