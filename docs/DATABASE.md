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

## Gorevler

| Tablo | Amac |
|---|---|
| `portal_tasks` / `portal_task_comments` | Gorev yonetimi + yorumlar |

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
| `ocp_cluster_index` / `ocp_terminal_host_map` / `logx_env_suffix_map` | OCP hiyerarsi + bastion eslemesi + ortam etiketi |
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
