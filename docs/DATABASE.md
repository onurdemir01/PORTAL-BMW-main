# BMW Portal — Veritabani Semasi (MSSQL / TBMWANS)

Tum kalici veri bu DB'de yasar. Tablolar boot'ta `server/db/mssql-setup.cjs`
`setupTables()` ile idempotent olusturulur (varsa dokunulmaz; eksik kolonlar
ALTER ile eklenir). Eski JSON dosyalarindan tek seferlik goc, ilgili store'un
ilk yuklemesinde yapilir (tablo bosken) ve `[DB] migrated <ad>` loglanir.

Baglanti: `PORTAL_DB_*` env'leri (bos alanlar `MSSQL_*`'e duser) —
**`PORTAL_DB_DATABASE=TBMWANS` acikca yazilmalidir.**

## Cekirdek

| Tablo | Amac | Modul |
|---|---|---|
| `portal_sessions` | express-session MSSQL store (VARSAYILAN — restart'ta logout olmaz) | auth/mssql-session-store.cjs |
| `portal_users` | Kullanici profili: last_login, login_count, LDAP alanlari | auth/users.cjs |
| `portal_user_preferences` | Kullanici basina UI tercihi (tema, envanter kolonlari, aktif admin sekmesi...) — generic KV | auth/users.cjs |
| `user_role_overrides` | Admin panelden manuel rol atamasi | auth/index.cjs |
| `page_visibility` | Sayfa → rol gorunurlugu | auth/index.cjs |
| `portal_elements` / `portal_element_visibility` | Dinamik gorunurluk motoru katalogu + kurallari | auth/elements.cjs, visibility.cjs |
| `portal_env_overrides` | Admin Sistem sekmesi env degisiklikleri (boot'ta dotenv ustune uygulanir) | db/env-overrides.cjs |
| `portal_settings` | Runtime tunables KV (TTL/limit vb. — env fallback'li) | db/env-overrides.cjs (rezerv) |
| `portal_audit_logs` | Portal geneli hash-zincirli denetim: login/logout, tum admin CRUD, Ansible launch | audit/index.cjs |
| `metrics_snapshots` | 5 dk'da bir servis metrik ozeti (trend gecmisi) | metrics.cjs |

## Icerik store'lari (eskiden server/data/*.json)

| Tablo | Eski kaynak | Modul |
|---|---|---|
| `portal_links` | important-links.json | links/index.cjs |
| `selfservice_tabs` / `selfservice_subtabs` / `selfservice_items` | selfservice.json | selfservice/store.cjs |
| `duty_roster` | duty-roster.json — `UNIQUE(duty_date, email)` | duty-roster/index.cjs |
| `inventory_saved_queries` | inventory-saved-queries.json | inventory/index.cjs |
| `inventory_table_aliases` / `inventory_visible_tables` | (zaten DB) | inventory/index.cjs |
| `portal_config_blobs` | Eski blob aynasi — yalnizca goc kaynagi, artik guncellenmez | db/config-mirror.cjs |

## Gorevler (KALDIRILDI)

"Gorevler" ozelligi portaldan cikarildi; yeni kurulumlarin seed'inde `portal_tasks` /
`portal_task_comments` tablolari YOKTUR. Mevcut kurulumlarda tablolar veri iceriyor
olabilecegi icin kendiliginden dusurulmez — temizlik `scripts/remove-tasks.cjs` ile
elle yapilir (varsayilan GUVENLI: `--drop-tables` verilmedikce tablolar birakilir).

## Ansible / AWX

| Tablo | Amac |
|---|---|
| `ansible_awx_servers` | AWX sunucu kayitlari (env `AWX_1..9`'dan seed; DB oncelikli, secret'larda env fallback) |
| `ansible_job_history` | Launch gecmisi (kullanici, template, durum, redakte parametreler) |
| `ansible_job_output` | Terminal duruma gecen job'larin stdout arsivi (AWX'te silinse de kalir) |
| `ansible_playbook_registry` | AI'in cagirabildigi salt-okunur playbook kayitlari |
| `ansible_ocp_clusters` | OCP cluster kayitlari (eskiden ocp-clusters.json) |
| `ansible_ss_items` | Self-service Ansible kartlari (eskiden ansible-ss-items.json) |
| `ansible_ss_customizations` | Survey alan override'lari — `UNIQUE(awx_server_id, template_id)` |

## LogX

| Tablo | Amac |
|---|---|
| `logx_audit_logs` | LogX akis denetimi (v3 hash-zincir) |
| `logx_v2_requests` / `logx_v2_jobs` / `logx_v2_downloads` / `logx_v2_ingest` | LogX v2 sihirbaz durum makinesi + indirme/ingest token'lari |
| `logx_v2_restrictions` / `logx_v2_restriction_grants` | Varsayilan-acik erisim kisitlari |
| `ocp_cluster_index` | OCP hiyerarsi (env/tenant/cluster) + CLUSTER-BAZLI jump server (`terminal_host`) + birlesik katalog alanlari (`legacy_id` ile `ansible_ocp_clusters` aynasi) — bkz. docs/OCP-DINAMIK-YAPI.md |
| `ocp_terminal_host_map` | Bastion YEDEK eslemesi (tenant+env) — cluster satirinda `terminal_host` bossa devreye girer |
| `logx_env_suffix_map` | Legacy ortam etiketi (EAR klasor son-eki) |
| `logx_mask_rules` | PII maskeleme kurallari (admin duzenlenebilir; sort_order = regex sirasi) |

## AI Analist

| Tablo | Amac |
|---|---|
| `ai_conversations` / `ai_messages` | Sohbet gecmisi — refresh/restart sonrasi devam edilebilir |
| `ai_usage_log` | Cagri basina kullanim/performans telemetrisi (model, latency, tool sayisi, hata) |

## Envanter (harici veri)

| Tablo | Amac |
|---|---|
| `inventory_hosts` | Yonetilen host kayitlari |
| `EnvanterApps` vb. | Harici envanter tablolari (portal sahibi degil, salt-okunur sorgulanir) |

## Nginx / tasima

| Tablo | Amac | Modul |
|---|---|---|
| `nginx_migration_tracking` | Uygulama basina tasima durumu: planlanan/gecis tarihi, not, tanim ve silme job damgalari. **`in_use` / `in_use_by` / `in_use_at`**: ekibin "kullanimda mi" beyani (SPA Tasima Plani ekrani) | nginx-migration/index.cjs, spa-plan/index.cjs |
| `nginx_migration_path_jobs` | Yol (servis + location) basina tanim olusturma job kayitlari | nginx-migration/index.cjs |
| `nginx_cis_overrides` | CIS maddesi istisnalari (sunucu bazli ve `*` ile host-geneli) | nginx-cis/index.cjs |

**Tek kayit yeri (bilincli):** SPA Tasima Plani ekraninda ekibin girdigi tarih, yoneticinin
Production Tasimalari ekraniyla AYNI satira yazilir. Ayri bir "ekip tablosu" iki listenin
ayrismasina yol acardi. Ekip yalnizca `in_use`, `planned_date` ve `note` yazabilir; "gecti"
isareti (`migrated_date`) taramayla dogrulanan bir olgudur ve `/api/spa-plan/declare` ona
DOKUNMAZ (bekci SP4).

## Nginx Hub / Yuk Testi

Portal DB'si (nitelendirilmemis tablo adlari; `PORTAL_DB_*` bos ise TBMWANS). Ayrinti:
[NGINX-YUK-TESTI.md](NGINX-YUK-TESTI.md).

| Tablo | Amac | Modul |
|---|---|---|
| `nginx_loadtest_senaryolar` | Senaryo: YALNIZ yol satirlari (kanonik TSV + sha256, yol sayisi, ayristirici ozeti). HAR tarayicidan cikmaz; yumusak silme (`silindi`) | nginx-loadtest/index.cjs |
| `nginx_loadtest_kosular` | On kontrol (`islem='on_kontrol'`) ve kosu (`islem='kosu'`) satirlari: hedef / IP / vhost / yuk makinesi, parametreler, AWX sunucu + is numarasi (uclar istemciden ALMAZ), durum (`QUEUED`..`OKUNAMADI`), maskeli set_stats, gecerlilik + nedenler. `kilit_id` (kosunun kilit kimligi; Durdur kilitleri bununla durdur isine baglar), `durdur_awx_server_id` / `durdur_awx_job_id` (son Durdur isi, `GET /kosular/:id` `durdurIsi`), `sonuclandirma_denemesi` (INT NOT NULL DEFAULT 0: poller FINALIZING sayaci; 3'u gecerse `/sw` okunmaz - cokme dongusu kalkani; `POST /kosular/:id/yeniden-oku` sifirlar). Tur 3: `hedef_turu` (NVARCHAR(10) NOT NULL DEFAULT `'sunucu'`; `'sunucu'` \| `'serbest'` - serbest = LB VIP / yonetilmeyen sunucu, satirda `hedef_host = ''`, NULL'a cevrilmez), `motor` (NVARCHAR(8) NOT NULL DEFAULT `'k6'`; `'k6'` \| `'wrk'`, kanonik `parametreler.motor`'un liste / suzgec kopyasi, ayni INSERT'te yazilir), `plan_uyarilari` (NVARCHAR(2000) NULL: on kontrolun onay isteyen plan uyarilari, JSON dizi; bos ise NULL; kosu bu listeyi onaylatir, yeni uyari cikarsa `on_kontrol_eski`). Indeks `IX_nlk_job`, `IX_nlk_hedef` | nginx-loadtest/index.cjs, poller.cjs |
| `nginx_loadtest_adimlar` | Kosu basina TUR satiri (`R<id>_<K\|B>_<kip>_<ae>_<hiz>_r<n>`): istemci/sunucu metrikleri (FLOAT, NULL = olculmedi), `ham` JSON. Zaman serisi YOK. Indeks `IX_nla_kosu` | nginx-loadtest/poller.cjs |
| `nginx_loadtest_kilitleri` | CAS kilidi, `opsx_was_locks` bicimi: `G\|global`, `T\|<HEDEF>`, `T\|IP:<ip>` (serbest hedef: hedef sunucu yok, kilit IP'ye), `L\|<YUK>`; satir SILINMEZ, TTL 75 dk. Sunucu hedefinde on kontrol `T` + `L`, kosu `G` + `T` + `L`; serbest hedefte on kontrol DE `G` alir (`G` + `T\|IP:` + `L`: serbest on kontrolun istekleri VIP arkasindaki bir hostun olcum penceresine girmesin). VIP arkasindaki hostlar `T` kilidiyle korunmaz (Portal VIP havuzunu bilmez). `bag_turu` (`on_kontrol` \| `kosu` \| `durdur`): bagli isin turu; AWX iptali / hatasinda kosu ve durdur kilidi BIRAKILMAZ, isten cozulur (`awx_*` = NULL) ve TTL ile duser (`kilit.bagliIsKarari`). Ise bagli tutulan kilit AWX sunucusunu kapatmayi engeller | nginx-loadtest/kilit.cjs |

**Saklama:** `db/housekeeping.cjs` gece temizliginde kosular ve adimlari
`NGINX_LOADTEST_RETENTION_DAYS` (varsayilan 365) gunden eskiyse en cok 500'luk `DELETE TOP (@n)`
partileriyle siler: once adimlar, sonra adimi kalmamis kosular. Suren kosu
(`QUEUED`/`RUNNING`/`FINALIZING`) silinmez. Senaryolar ve kilit satirlari silinmez.
Ham olcum dosyalari DB'de degil, `/sw/BMW_PORTAL/nginx_loadtest/<kosu>/` altindadir.

**Sema notu (tur 2 + tur 3, 2026-10-28):** ozellik itildi; tablolar bir ortamda onceki bicimiyle
yaratilmis olabilir. Bu yuzden sonradan eklenen her kolon HEM `CREATE TABLE` icinde HEM `alters`
listesindedir (eksikse boot'ta eklenir): tur 2 `kilit_id`, `durdur_awx_server_id`, `durdur_awx_job_id`,
`sonuclandirma_denemesi` (kosular), `bag_turu` (kilitleri); tur 3 `hedef_turu` (`DF_nlk_hedef_turu`
DEFAULT `'sunucu'`), `motor` (`DF_nlk_motor` DEFAULT `'k6'`), `plan_uyarilari` (NULL). Mevcut satirlar
sunucu / k6 / NULL olur. `hedef_host` NOT NULL kalir (serbest satirda `''`); `IX_nlk_hedef` yeniden
kurulmaz. `nginx_loadtest_adimlar` sema degismez: wrk kosusunda `hiz` kolonu baglanti sayisidir (birim
kosu satirinin `motor`'undan).

## Crypto Hub (harici tarama verisi)

DDL portal boot'unda DEGIL, `bmw_automation_folder/crypto_hub/files/crypto_hub_schema.sql`
ile elle kurulur (idempotent). Tablolar yoksa ekran "tablolar yok" der — "bilesen yok" ile
karistirmaz.

| Tablo | Amac |
|---|---|
| `dbo.Crypto_Hub_Components` | Kiraci basina Deployment/StatefulSet: istenen/hazir replika, imaj, surum |
| `dbo.Crypto_Hub_Releases` | Helm release'leri: chart, chart surumu, uygulama surumu, durum |
| `dbo.Crypto_Hub_ChartTags` | Depodaki mevcut chart surumleri (OCI veya helm deposu) |
| `dbo.Crypto_Hub_Archives` | Bastion'da duran indirilmis chart ve values dosyalari — **yalniz ad/boyut/tarih, ICERIK YOK** |
| `dbo.Crypto_Hub_Notes` | `NOTE` / `ERR` satirlari: "olculemedi" ile "sorun yok" karismasin |

Hepsi "son tarama" mantigiyla okunur (`MAX(scan_date)`); yukleyici sifir satirda veritabanina
dokunmaz ve ayni gun tekrar kosulursa yalniz o gunun satirlarini yeniler.

## Diger

| Tablo | Amac |
|---|---|
| `splunk_products` | Splunk urun listesi (env `SPLUNK_PRODUCTS`'tan seed) |

## Bilerek DB'ye TASINMAYANLAR (gerekceli)

- `_ldapCredCache` — duz metin LDAP sifreleri; ASLA kalicilastirilmaz (bellek, TTL'li).
- AWX OAuth token cache'leri, Dynatrace/Instana/Splunk TTL cache'leri, `_onlineUsers`,
  avatar cache, rate-limit sayaclari — ucucu olmalari dogru (restart'ta sifirlanir).
- `server/data/logx-legacy-snapshot.json` — Envanter DB'si KESIKKEN kullanilan dosya
  fallback'i; DB'ye tasimak amacini bozar.
- LogX staging dizinleri (`/sw/BMW_PORTAL/logs/*`) — TTL ile temizlenen runtime artefakti.
- Crypto Hub `garanti_values.yaml` ve benzeri values dosyalarinin ICERIGI — parola
  barindirabiliyor; yalnizca dosya adi/boyutu/tarihi tutulur (bkz. `Crypto_Hub_Archives`).
