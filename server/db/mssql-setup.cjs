'use strict';
// Creates portal tables in MSSQL if they don't exist.
// Called once at server startup.

const { getPool } = require('../inventory/mssql.cjs');

const TABLES = [
  {
    name: 'inventory_hosts',
    sql: `
      CREATE TABLE inventory_hosts (
        id                 INT IDENTITY(1,1) PRIMARY KEY,
        hostname           NVARCHAR(255) NOT NULL,
        fqdn               NVARCHAR(255),
        ip                 NVARCHAR(45) NOT NULL,
        environment        NVARCHAR(50),
        product_type       NVARCHAR(100),
        middleware_type    NVARCHAR(100),
        middleware_version NVARCHAR(50),
        port               INT NOT NULL DEFAULT 1111,
        is_active          BIT NOT NULL DEFAULT 1,
        notes              NVARCHAR(MAX),
        server_type        NVARCHAR(50) DEFAULT 'generic',
        created_at         DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at         DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      )`,
  },
  // logx_permissions ve logx_sessions (eski port-1111 proxy'nin fail-closed per-host ACL'i
  // ve proxy oturumlari) Faz 7 kesiminde KALDIRILDI — LogX v2 varsayilan-acik
  // logx_v2_restrictions modelini ve request-tabanli job takibini kullaniyor. Mevcut
  // production DB'de bu tablolar varsa dokunulmadi (yalnizca bundan boyle
  // olusturulmuyor/yonetilmiyor) — canli veri kaybi riski tasiyan bir DROP TABLE hicbir
  // zaman burada calistirilmaz.
  {
    name: 'logx_audit_logs',
    sql: `
      CREATE TABLE logx_audit_logs (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        session_id  NVARCHAR(36),
        username    NVARCHAR(255) NOT NULL,
        auth_source NVARCHAR(50),
        role        NVARCHAR(50),
        target_host NVARCHAR(255),
        target_ip   NVARCHAR(45),
        action      NVARCHAR(100) NOT NULL,
        result      NVARCHAR(50),
        detail      NVARCHAR(MAX),
        client_ip   NVARCHAR(45),
        prev_hash   NVARCHAR(64),
        entry_hash  NVARCHAR(64),
        created_at  DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      )`,
  },
  {
    name: 'ansible_job_history',
    sql: `
      CREATE TABLE ansible_job_history (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        username      NVARCHAR(255) NOT NULL,
        awx_server_id INT,
        template_id   INT NOT NULL,
        template_name NVARCHAR(500),
        job_id        INT NOT NULL,
        status        NVARCHAR(50),
        started_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        finished_at   DATETIME2,
        params        NVARCHAR(MAX)
      )`,
  },
  {
    // AI'in sohbette kendi karariyla cagirabildigi salt-okunur tanilama playbook'larinin
    // kaydi — hangi AWX template ID'sinin hangi playbook'a karsilik geldigi burada (admin
    // ekranindan) VEYA env_var_name uzerinden .env'de tutulur (bkz. server/ansible/
    // playbook-registry.cjs getEffectiveTemplateId). Bir satirin hicbir kaynaktan template
    // ID'si yoksa ilgili AI araci sessizce olusturulmaz — kullanici bunu asla gormez.
    name: 'ansible_playbook_registry',
    sql: `
      CREATE TABLE ansible_playbook_registry (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        key_name        NVARCHAR(100) NOT NULL UNIQUE,
        display_name    NVARCHAR(255) NOT NULL,
        description     NVARCHAR(MAX),
        category        NVARCHAR(50) NOT NULL DEFAULT 'genel',
        handler         NVARCHAR(30) NOT NULL DEFAULT 'host_target',
        playbook_path   NVARCHAR(255),
        awx_template_id INT NULL,
        env_var_name    NVARCHAR(100),
        enabled         BIT NOT NULL DEFAULT 1,
        created_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      )`,
  },
  // ── LogX v2 (guvenli dosya indirme yeniden tasarimi) ────────────────────────
  {
    // Sihirbaz oturumu basina bir satir — resumable state machine + TOCTOU kaynagi.
    // discovery_result_json, transfer isteginin karsilastirilacagi TEK dogruluk kaynagidir.
    name: 'logx_v2_requests',
    sql: `
      CREATE TABLE logx_v2_requests (
        id                    INT IDENTITY(1,1) PRIMARY KEY,
        request_id            NVARCHAR(36) NOT NULL DEFAULT NEWID(),
        username              NVARCHAR(255) NOT NULL,
        auth_source           NVARCHAR(50) NOT NULL DEFAULT 'local',
        role                  NVARCHAR(50),
        session_token         NVARCHAR(128) NOT NULL,
        platform              NVARCHAR(20) NOT NULL,
        state                 NVARCHAR(30) NOT NULL DEFAULT 'draft',
        input_json            NVARCHAR(MAX),
        discovery_result_json NVARCHAR(MAX),
        selected_files_json   NVARCHAR(MAX),
        error_message         NVARCHAR(MAX),
        created_at            DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at            DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        expires_at            DATETIME2 NOT NULL,
        UNIQUE(request_id)
      )`,
  },
  {
    // Bir request_id altinda 1..N AWX job'i (orn. OCP'de namespace-discovery + discover-fetch
    // ayri job'lardir) — her biri kendi awx_job_id'siyle ayri ayri izlenir.
    name: 'logx_v2_jobs',
    sql: `
      CREATE TABLE logx_v2_jobs (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        request_id          NVARCHAR(36) NOT NULL,
        job_type            NVARCHAR(30) NOT NULL,
        awx_server_id       INT NOT NULL,
        awx_job_id          INT NOT NULL,
        status              NVARCHAR(20) NOT NULL DEFAULT 'pending',
        extra_vars_redacted NVARCHAR(MAX),
        artifacts_json      NVARCHAR(MAX),
        started_at          DATETIME2,
        finished_at         DATETIME2,
        error_message       NVARCHAR(MAX),
        created_at          DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        FOREIGN KEY (request_id) REFERENCES logx_v2_requests(request_id) ON DELETE CASCADE
      )`,
  },
  {
    // Kripto-rastgele indirme token'lari — IDOR'a direncli (username+session_token bagli, TTL).
    name: 'logx_v2_downloads',
    sql: `
      CREATE TABLE logx_v2_downloads (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        token          NVARCHAR(64) NOT NULL,
        request_id     NVARCHAR(36) NOT NULL,
        username       NVARCHAR(255) NOT NULL,
        session_token  NVARCHAR(128) NOT NULL,
        staged_path    NVARCHAR(1000) NOT NULL,
        filename       NVARCHAR(500) NOT NULL,
        size_bytes     BIGINT,
        is_fallback    BIT NOT NULL DEFAULT 0,
        consumed_count INT NOT NULL DEFAULT 0,
        expires_at     DATETIME2 NOT NULL,
        created_at     DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(token),
        FOREIGN KEY (request_id) REFERENCES logx_v2_requests(request_id) ON DELETE CASCADE
      )`,
  },
  {
    // OpsX Thread/Heap Dump indirme token'lari — logx_v2_downloads ile AYNI IDOR-direncli
    // desen (kripto-rastgele token, TTL), ama LogX'in request/job state-machine'ine
    // (logx_v2_requests) BAGLANMAZ: OpsX'in kendi tek-tablolu, basit mekanizmasi
    // (bkz. server/opsx/downloads.cjs) — AWX job'i dogrudan awx_server_id/awx_job_id ile
    // izlenir, ayri bir "request" kavrami yok.
    name: 'opsx_dump_downloads',
    sql: `
      CREATE TABLE opsx_dump_downloads (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        token          NVARCHAR(64) NOT NULL,
        username       NVARCHAR(255) NOT NULL,
        awx_server_id  INT NOT NULL,
        awx_job_id     INT NOT NULL,
        staged_path    NVARCHAR(1000) NOT NULL,
        filename       NVARCHAR(500) NOT NULL,
        size_bytes     BIGINT,
        consumed_count INT NOT NULL DEFAULT 0,
        expires_at     DATETIME2 NOT NULL,
        created_at     DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(token)
      )`,
  },
  {
    // A4 fetch-back: log-kaynak host NFS'e ERISEMEZSE arsivi portal'a HTTP ile push eder.
    // Bu tablo tek-kullanimlik, TTL'li ingest token'larini tutar (kaynak host bu token'li
    // URL'ye upload yapar → portal fallback dizinine yazar). Bkz. server/logx/v2/ingest.cjs.
    name: 'logx_v2_ingest',
    sql: `
      CREATE TABLE logx_v2_ingest (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        token          NVARCHAR(64) NOT NULL,
        request_id     NVARCHAR(36) NOT NULL,
        filename       NVARCHAR(500) NOT NULL,
        fallback_dir   NVARCHAR(1000) NOT NULL,
        consumed       BIT NOT NULL DEFAULT 0,
        received_bytes BIGINT,
        expires_at     DATETIME2 NOT NULL,
        created_at     DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(token),
        FOREIGN KEY (request_id) REFERENCES logx_v2_requests(request_id) ON DELETE CASCADE
      )`,
  },
  {
    // OpenShift env→tenant→cluster hiyerarsisi — admin CRUD, portal DB'sinde YALNIZCA
    // tanimlayicilar tutulur (cluster URL/credential ayri, harici bir projede yasar).
    name: 'ocp_cluster_index',
    sql: `
      CREATE TABLE ocp_cluster_index (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        env          NVARCHAR(30) NOT NULL,
        tenant       NVARCHAR(100) NOT NULL,
        cluster_name NVARCHAR(150) NOT NULL,
        is_active    BIT NOT NULL DEFAULT 1,
        created_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(env, tenant, cluster_name)
      )`,
  },
  {
    // {tenant}_{env} → terminal/bastion host eslemesi — job'in hangi sunucu uzerinde (oc
    // CLI zaten login akisini bilen) calisacagini belirler.
    name: 'ocp_terminal_host_map',
    sql: `
      CREATE TABLE ocp_terminal_host_map (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        tenant        NVARCHAR(100) NOT NULL,
        env           NVARCHAR(30) NOT NULL,
        terminal_host NVARCHAR(255) NOT NULL,
        is_active     BIT NOT NULL DEFAULT 1,
        created_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(tenant, env)
      )`,
  },
  {
    // credentials.yaml icindeki vault DEGISKEN ADLARININ katalogu (uxmid_gar, uxmid_das,
    // uxmid_gtek ...). Admin buradan ekler/duzenler/siler; OCP Cluster Hiyerarsisi
    // ekranindaki "Vault Anahtari" alani onerilerini BURADAN alir — daha once oneriler
    // mevcut cluster satirlarindan turetiliyordu, yani hic kullanilmamis bir anahtar
    // hicbir zaman onerilmiyordu.
    //
    // PAROLA BURADA YOK ve OLMAYACAK: yalnizca anahtarin ADI tutulur. Parolayi playbook
    // AWX vault'undan lookup('vars', <ad>) ile cozer.
    name: 'ocp_vault_key_catalog',
    sql: `
      CREATE TABLE ocp_vault_key_catalog (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        key_name         NVARCHAR(128) NOT NULL,
        default_username NVARCHAR(128) NULL,
        description      NVARCHAR(400) NULL,
        is_active        BIT NOT NULL DEFAULT 1,
        created_at       DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at       DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(key_name)
      )`,
  },
  {
    // OCP namespace ONBELLEGI. Namespace kesfi bugune kadar REQUEST-SCOPED idi
    // (logx_v2_requests.discovery_result_json, 24s TTL) — yani her kullanici her seferinde
    // yeniden AWX job'i calistiriyordu ve sonuc kimseyle paylasilmiyordu. Bu tablo sonucu
    // kullanicilar arasi paylasilir hale getirir: sihirbaz ONCE buradan okur, kullanici
    // aradigini bulamazsa "Burada kesfet" ile taze tarama tetikler.
    // TTL dolunca satir SILINMEZ, `stale` olarak isaretlenip yine gosterilir (bayat veri,
    // hic veri olmamasindan iyidir — bkz. logx/v2/legacy.cjs snapshot fallback deseni).
    name: 'ocp_namespace_cache',
    sql: `
      CREATE TABLE ocp_namespace_cache (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        env          NVARCHAR(30) NOT NULL,
        tenant       NVARCHAR(64) NOT NULL,
        cluster_name NVARCHAR(64) NOT NULL,
        namespace    NVARCHAR(100) NOT NULL,
        source       NVARCHAR(32) NOT NULL DEFAULT 'discovery',
        fetched_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        expires_at   DATETIME2 NULL,
        is_deleted   BIT NOT NULL DEFAULT 0,
        UNIQUE(env, tenant, cluster_name, namespace)
      )`,
  },
  {
    // OCP namespace ICINDEKI is yuku/ag objeleri onbellegi. Kullanici uygulama adini
    // bilmek zorunda kalmasin diye: sihirbaz listeyi buradan gosterir, bulunamazsa
    // "Burada kesfet" ile logx_ocp_app_discovery playbook'u calisir.
    // `kind` obje tipidir (Deployment/StatefulSet/Service/Route/...); ayni namespace'te
    // ayni ada sahip FARKLI tipler olabilir, bu yuzden UNIQUE'e dahildir.
    name: 'ocp_app_cache',
    sql: `
      CREATE TABLE ocp_app_cache (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        env           NVARCHAR(30) NOT NULL,
        tenant        NVARCHAR(64) NOT NULL,
        cluster_name  NVARCHAR(64) NOT NULL,
        namespace     NVARCHAR(100) NOT NULL,
        kind          NVARCHAR(32) NOT NULL,
        app_name      NVARCHAR(150) NOT NULL,
        replicas      INT NULL,
        image         NVARCHAR(512) NULL,
        label_app     NVARCHAR(256) NULL,
        created_at_k8s DATETIME2 NULL,
        payload_json  NVARCHAR(MAX) NULL,
        source        NVARCHAR(32) NOT NULL DEFAULT 'discovery',
        fetched_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        expires_at    DATETIME2 NULL,
        is_deleted    BIT NOT NULL DEFAULT 0,
        UNIQUE(env, tenant, cluster_name, namespace, kind, app_name)
      )`,
  },
  {
    // Uygulama TARAMASININ kendisinin kaydi — sonucu degil.
    //
    // NEDEN VAR (2026-08-10): `ocp_app_cache` yalnizca BULUNAN uygulamalari tutuyordu ve
    // `getApps` "onbellekte var mi"yi `rows.length > 0` ile olcuyordu. Gercekten BOS bir
    // namespace tarandiginda hicbir satir yazilmadigi icin sonuc "hic taranmamis"tan
    // ayirt edilemiyordu: sihirbaz her girişte ~1 dk'lik AWX job'ini yeniden aciyordu ve
    // kullaniciya hep ayni "kayit yok" cumlesi gosteriliyordu.
    //
    // Burada BOS sonuc da bir kayittir (app_count = 0) — "tarandi, bos cikti" artik
    // bilinebilir bir durum.
    name: 'ocp_app_scan_log',
    sql: `
      CREATE TABLE ocp_app_scan_log (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        env           NVARCHAR(30) NOT NULL,
        tenant        NVARCHAR(64) NOT NULL,
        cluster_name  NVARCHAR(64) NOT NULL,
        namespace     NVARCHAR(100) NOT NULL,
        app_count     INT NOT NULL DEFAULT 0,
        scanned_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(env, tenant, cluster_name, namespace)
      )`,
  },
  {
    // Legacy EAR-klasor-son-eki ('-T','-D', son-ek-yok) → ortam etiketi — EnvanterApps.env
    // sutunu guvenilmez oldugu icin ortam etiketi BURADAN turetilir (admin duzeltebilir).
    name: 'logx_env_suffix_map',
    sql: `
      CREATE TABLE logx_env_suffix_map (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        suffix     NVARCHAR(20) NOT NULL,
        env_label  NVARCHAR(50) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(suffix)
      )`,
  },
  {
    // Varsayilan-acik yetkilendirme: bir kaynagin (app/namespace) burada satiri YOKSA
    // herkese aciktir; satiri VARSA yalnizca asagidaki grants tablosundaki kullanicilar
    // (+ her zaman Admin) erisebilir. logx_permissions'in (fail-closed) tam tersi model.
    name: 'logx_v2_restrictions',
    sql: `
      CREATE TABLE logx_v2_restrictions (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        resource_type NVARCHAR(20) NOT NULL,
        resource_key  NVARCHAR(255) NOT NULL,
        description   NVARCHAR(500),
        created_by    NVARCHAR(255) NOT NULL,
        created_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(resource_type, resource_key)
      )`,
  },
  {
    name: 'logx_v2_restriction_grants',
    sql: `
      CREATE TABLE logx_v2_restriction_grants (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        restriction_id INT NOT NULL,
        username       NVARCHAR(255) NOT NULL,
        created_by     NVARCHAR(255) NOT NULL,
        created_at     DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(restriction_id, username),
        FOREIGN KEY (restriction_id) REFERENCES logx_v2_restrictions(id) ON DELETE CASCADE
      )`,
  },
  // ── Genel yapilandirma tablolari (eskiden server/data/*.json dosyalariydi) ──────
  {
    // Eskiden server/data/page-visibility.json — hangi sayfanin hangi rollere
    // gorunecegi (bkz. server/auth/index.cjs readVisibility/writeVisibility).
    name: 'page_visibility',
    sql: `
      CREATE TABLE page_visibility (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        page_name  NVARCHAR(100) NOT NULL,
        roles      NVARCHAR(200) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(page_name)
      )`,
  },
  {
    // Eskiden server/data/user-roles.json — LDAP grup uyeliginin uzerine yazan
    // per-kullanici manuel rol atamasi (bkz. server/auth/index.cjs).
    name: 'user_role_overrides',
    sql: `
      CREATE TABLE user_role_overrides (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        username   NVARCHAR(255) NOT NULL,
        role       NVARCHAR(50) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(username)
      )`,
  },
  {
    // Eskiden server/data/inventory-table-aliases.json (bkz. server/inventory/index.cjs).
    name: 'inventory_table_aliases',
    sql: `
      CREATE TABLE inventory_table_aliases (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        table_name NVARCHAR(255) NOT NULL,
        alias      NVARCHAR(255) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(table_name)
      )`,
  },
  {
    // ESKI sema — server/data/inventory-visible-tables.json'dan gocmustu, 2 satirlik (role→CSV)
    // bir model. actions.md #12 (Bolum K) bunu "her tablo icin bir kayit" modeline zorluyor —
    // ARTIK KAYNAK DEGIL, yalniz bir kerelik goc kaynagi olarak DB'de tutulur (bkz.
    // server/inventory/index.cjs migrateLegacyVisibleTablesIfNeeded). Silinmez (geri-donus emniyeti).
    name: 'inventory_visible_tables',
    sql: `
      CREATE TABLE inventory_visible_tables (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        role_name  NVARCHAR(50) NOT NULL,
        tables     NVARCHAR(MAX) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(role_name)
      )`,
  },
  {
    // actions.md #12 (Bolum K) — YENI sema: HER fiziksel tablo icin BIR satir (eskiden yalniz
    // 2 satirlik CSV-blob modeliydi). table_name='*' ozel bir SENTINEL satirdir (gercek bir
    // tablo degildir, INFORMATION_SCHEMA uzlastirmasi tarafindan asla dokunulmaz/pasife
    // alinmaz) — bir rolun bu sentinel'e can_view=1 kaydi olmasi "o rol TUM tablolari gorur"
    // ("*") anlamina gelir; boylece eski PUT /visible-tables {tables:"*"} davranisi YENI semada
    // da BIREBIR temsil edilebilir (bkz. inventory/index.cjs readVisibleTables/adapter).
    name: 'inventory_table_visibility',
    sql: `
      CREATE TABLE inventory_table_visibility (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        schema_name  NVARCHAR(128) NOT NULL DEFAULT 'dbo',
        table_name   NVARCHAR(255) NOT NULL,
        display_name NVARCHAR(255) NULL,
        is_active    BIT NOT NULL DEFAULT 1,
        sort_order   INT NOT NULL DEFAULT 0,
        description  NVARCHAR(500) NULL,
        created_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(table_name)
      )`,
  },
  {
    // Rol bazli gorunurluk — coklu-satirli (eski CSV yerine). can_view=0 satirlari da
    // tutulur (acikca "gormez" — CSV modelinde "listede yok" ile ayni anlamdaydi, burada
    // acik kayit daha izlenebilir; okuma tarafi yalniz can_view=1 satirlarini kullanir).
    name: 'inventory_table_role_visibility',
    sql: `
      CREATE TABLE inventory_table_role_visibility (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        table_visibility_id INT NOT NULL,
        role_name           NVARCHAR(50) NOT NULL,
        can_view            BIT NOT NULL DEFAULT 1,
        updated_at          DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(table_visibility_id, role_name),
        FOREIGN KEY (table_visibility_id) REFERENCES inventory_table_visibility(id) ON DELETE CASCADE
      )`,
  },
  {
    // Kullanici-bazli override — rol kuralinin USTUNE yazar (allow rol kuralini gecersiz
    // kilip gorunur yapar, deny rol kuralini gecersiz kilip gizler). actions.md #12'nin
    // ornek dummy tablosuyla birebir eslesir.
    name: 'inventory_table_user_override',
    sql: `
      CREATE TABLE inventory_table_user_override (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        table_visibility_id INT NOT NULL,
        username             NVARCHAR(255) NOT NULL,
        override_type        NVARCHAR(10) NOT NULL,
        created_at            DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        created_by            NVARCHAR(255) NULL,
        UNIQUE(table_visibility_id, username),
        FOREIGN KEY (table_visibility_id) REFERENCES inventory_table_visibility(id) ON DELETE CASCADE
      )`,
  },
  {
    // Kolon-seviyesi gorunurluk — TAMAMEN yeni (eskiden hic yoktu). role_name='ALL' (sentinel,
    // NULL degil — MSSQL UNIQUE kisitlamasinda birden fazla NULL farkli sayilir, bu yuzden
    // "herkes icin" durumunu acik bir deger ile temsil ederiz) tum rollere uygulanir.
    name: 'inventory_column_visibility',
    sql: `
      CREATE TABLE inventory_column_visibility (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        table_visibility_id INT NOT NULL,
        column_name         NVARCHAR(255) NOT NULL,
        is_visible          BIT NOT NULL DEFAULT 1,
        role_name           NVARCHAR(50) NOT NULL DEFAULT 'ALL',
        updated_at          DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(table_visibility_id, column_name, role_name),
        FOREIGN KEY (table_visibility_id) REFERENCES inventory_table_visibility(id) ON DELETE CASCADE
      )`,
  },
  {
    // Dinamik gorunurluk/modulerlik motorunun element katalogu (tek gercek kaynagi).
    // Her kontrol edilebilir oge (sayfa/tab/buton/admin-tab/nav-grup/feature/mcp/awx) burada
    // bir satir. `enabled`=global kill-switch (herkese kapatir, admin dahil); `default_visible`=
    // hic kural yoksa varsayilan gorunurluk. Agac `parent_key` ile kurulur. Bkz.
    // server/auth/visibility.cjs (resolveVisibility/requireVisible).
    name: 'portal_elements',
    sql: `
      CREATE TABLE portal_elements (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        element_key     NVARCHAR(200) NOT NULL,
        element_type    NVARCHAR(40)  NOT NULL,
        parent_key      NVARCHAR(200) NULL,
        label           NVARCHAR(200) NULL,
        route           NVARCHAR(200) NULL,
        sort_order      INT NOT NULL DEFAULT 0,
        enabled         BIT NOT NULL DEFAULT 1,
        default_visible BIT NOT NULL DEFAULT 1,
        metadata        NVARCHAR(MAX) NULL,
        updated_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(element_key)
      )`,
  },
  {
    // express-session icin MSSQL-tabanli session store (opt-in: SESSION_STORE=mssql). Restart'ta
    // oturumlar korunur, MemoryStore bellek-sismesi P0 kalkar. Harici servis YOK (mevcut portal DB).
    // Bkz. server/auth/mssql-session-store.cjs.
    name: 'portal_sessions',
    sql: `
      CREATE TABLE portal_sessions (
        sid      NVARCHAR(128) NOT NULL PRIMARY KEY,
        sess     NVARCHAR(MAX) NOT NULL,
        expires  DATETIME2 NOT NULL
      )`,
  },
  {
    // JSON-dosya config depolarinin DB yansimasi (links/selfservice/duty-roster/ocp-clusters).
    // Her store'un TUM icerigi tek bir JSON blob satiri olarak tutulur — DB kalici/merkezî
    // kaynak, dosya hizli yerel cache + outage fallback (bkz. server/db/config-mirror.cjs).
    name: 'portal_config_blobs',
    sql: `
      CREATE TABLE portal_config_blobs (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        name       NVARCHAR(100) NOT NULL,
        data       NVARCHAR(MAX) NOT NULL,
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(name)
      )`,
  },
  {
    // Element basina hedefleme kurallari. principal_type ∈ {role, user}; principal_id =
    // rol adi ("Admin"/"User") veya kullanici adi (lowercase). Cozunurluk (visibility.cjs):
    // enabled=false ⇒ herkese kapali → Admin ⇒ gorur → user kurali > role kurali → default_visible.
    name: 'portal_element_visibility',
    sql: `
      CREATE TABLE portal_element_visibility (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        element_key    NVARCHAR(200) NOT NULL,
        principal_type NVARCHAR(20)  NOT NULL,
        principal_id   NVARCHAR(255) NOT NULL,
        allow          BIT NOT NULL DEFAULT 1,
        updated_at     DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(element_key, principal_type, principal_id)
      )`,
  },
  // ── Normalize store tablolari (eskiden server/data/*.json + portal_config_blobs) ──
  {
    // Eskiden server/data/important-links.json + 'links' blob'u (bkz. server/links/index.cjs).
    name: 'portal_links',
    sql: `
      CREATE TABLE portal_links (
        id              NVARCHAR(64) NOT NULL PRIMARY KEY,
        label           NVARCHAR(255) NOT NULL,
        url             NVARCHAR(1000) NOT NULL,
        category        NVARCHAR(100) NOT NULL DEFAULT 'Genel',
        description     NVARCHAR(MAX),
        is_active       BIT NOT NULL DEFAULT 1,
        sort_order      INT NOT NULL DEFAULT 0,
        open_in_new_tab BIT NOT NULL DEFAULT 1,
        icon            NVARCHAR(100),
        visible_to      NVARCHAR(200) NOT NULL DEFAULT 'Admin,User',
        is_favorite     BIT NOT NULL DEFAULT 0,
        updated_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      )`,
  },
  {
    // Self-service agacinin kok seviyesi (eskiden server/data/selfservice.json).
    name: 'selfservice_tabs',
    sql: `
      CREATE TABLE selfservice_tabs (
        id         NVARCHAR(64) NOT NULL PRIMARY KEY,
        name       NVARCHAR(255) NOT NULL,
        section    NVARCHAR(20) NOT NULL DEFAULT 'smart',
        sort_order INT NOT NULL DEFAULT 0,
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      )`,
  },
  {
    // actions.md #5 (Bolum D) — eskiden Smart/Ansible/Digerleri src/components/SelfServicePage.tsx
    // icinde HARDCODED bir TOP_TABS sabitiydi (actions.md'nin acikca yasakladigi durum).
    // Artik ust-seviye grup KATALOGU burada — seed migration mevcut 3 degeri ekler
    // (geriye donuk uyumluluk, sifir veri kaybi).
    name: 'selfservice_groups',
    sql: `
      CREATE TABLE selfservice_groups (
        id         NVARCHAR(64) NOT NULL PRIMARY KEY,
        group_key  NVARCHAR(50) NOT NULL,
        label      NVARCHAR(100) NOT NULL,
        icon       NVARCHAR(50) NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_active  BIT NOT NULL DEFAULT 1,
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(group_key)
      )`,
  },
  {
    name: 'selfservice_subtabs',
    sql: `
      CREATE TABLE selfservice_subtabs (
        id         NVARCHAR(64) NOT NULL PRIMARY KEY,
        tab_id     NVARCHAR(64) NOT NULL,
        name       NVARCHAR(255) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        FOREIGN KEY (tab_id) REFERENCES selfservice_tabs(id) ON DELETE CASCADE
      )`,
  },
  {
    name: 'selfservice_items',
    sql: `
      CREATE TABLE selfservice_items (
        id              NVARCHAR(64) NOT NULL PRIMARY KEY,
        subtab_id       NVARCHAR(64) NOT NULL,
        tab_id          NVARCHAR(64) NOT NULL,
        title           NVARCHAR(255) NOT NULL,
        sort_order      INT NOT NULL DEFAULT 0,
        info            NVARCHAR(MAX),
        go_url          NVARCHAR(1000),
        request_example NVARCHAR(MAX),
        details         NVARCHAR(MAX),
        sample_type     NVARCHAR(10) NOT NULL DEFAULT 'text',
        sample_value    NVARCHAR(MAX),
        extra           NVARCHAR(MAX),
        updated_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        FOREIGN KEY (subtab_id) REFERENCES selfservice_subtabs(id) ON DELETE CASCADE
      )`,
  },
  {
    // Eskiden server/data/duty-roster.json — merge anahtari (duty_date, email) dosyadaki
    // date::lower(email) stableKey semantigiyle birebir ayni.
    name: 'duty_roster',
    sql: `
      CREATE TABLE duty_roster (
        id         NVARCHAR(64) NOT NULL PRIMARY KEY,
        duty_date  DATE NOT NULL,
        first_name NVARCHAR(100) NOT NULL DEFAULT '',
        last_name  NVARCHAR(100) NOT NULL DEFAULT '',
        phone      NVARCHAR(50) NOT NULL DEFAULT '',
        email      NVARCHAR(255) NOT NULL DEFAULT '',
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(duty_date, email)
      )`,
  },
  {
    // actions.md #6 (Bolum E) — nobetci/index.cjs'in bellek-ici cache'inin (NOBETCI_LIST_CACHE)
    // YANINDA (yerine degil) DB-yazma katmani: restart sonrasi harici gbnys API'si henuz
    // cevap vermemisse, en son basarili sonuc buradan okunur (bkz. server/nobetci/index.cjs).
    name: 'nobetci_cache',
    sql: `
      CREATE TABLE nobetci_cache (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        cache_key   NVARCHAR(100) NOT NULL,
        payload_json NVARCHAR(MAX) NOT NULL,
        source      NVARCHAR(50) NOT NULL DEFAULT 'api',
        fetched_at  DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        expires_at  DATETIME2 NULL,
        UNIQUE(cache_key)
      )`,
  },
  {
    // Eskiden server/ansible/ocp-clusters.json + 'ocp-clusters' blob'u (bkz. ocp-store.cjs).
    name: 'ansible_ocp_clusters',
    sql: `
      CREATE TABLE ansible_ocp_clusters (
        id          NVARCHAR(64) NOT NULL PRIMARY KEY,
        name        NVARCHAR(150) NOT NULL,
        display     NVARCHAR(150),
        env         NVARCHAR(10) NOT NULL DEFAULT 'prod',
        api_url     NVARCHAR(500),
        console_url NVARCHAR(500),
        token       NVARCHAR(MAX),
        description NVARCHAR(MAX),
        namespace   NVARCHAR(150),
        jump_host   NVARCHAR(255),
        updated_at  DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      )`,
  },
  {
    // Eskiden server/data/ansible-ss-items.json — admin tarafindan derlenen self-service
    // Ansible kartlari (bkz. runner.cjs readSsItems/writeSsItems).
    name: 'ansible_ss_items',
    sql: `
      CREATE TABLE ansible_ss_items (
        id              NVARCHAR(64) NOT NULL PRIMARY KEY,
        title           NVARCHAR(255) NOT NULL,
        description     NVARCHAR(MAX),
        awx_server_id   INT NOT NULL DEFAULT 1,
        awx_template_id INT NOT NULL,
        enabled         BIT NOT NULL DEFAULT 0,
        sort_order      INT NOT NULL DEFAULT 0,
        updated_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(awx_server_id, awx_template_id)
      )`,
  },
  {
    // Eskiden server/data/ansible-customizations/{srv}_{tpl}.json — survey alan override'lari
    // AWX survey spec'ine karsi tek birim olarak dogrulandigi icin payload JSON kalir.
    name: 'ansible_ss_customizations',
    sql: `
      CREATE TABLE ansible_ss_customizations (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        awx_server_id INT NOT NULL,
        template_id   INT NOT NULL,
        data          NVARCHAR(MAX) NOT NULL,
        updated_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(awx_server_id, template_id)
      )`,
  },
  {
    // Self Service akislarinda "Smart onayi gerekli" isaretlenmis (bkz.
    // ansible_ss_customizations.data.smartApproval) bir servis calistirildiginda acilan
    // Smart/RFF talebinin durumunu tutar. AWX job'i APPROVED olana kadar TETIKLENMEZ —
    // pending_launch_json'da (extraVars + launch secenekleri) saklanip, onay geldiginde
    // server/smart/poller.cjs tarafindan launch edilir. Bkz. server/smart/README notlari.
    name: 'smart_tickets',
    sql: `
      CREATE TABLE smart_tickets (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        external_ticket_id  NVARCHAR(200) NOT NULL,
        username            NVARCHAR(200) NOT NULL,
        awx_server_id       INT NOT NULL,
        awx_template_id     INT NOT NULL,
        flow_key            NVARCHAR(200) NULL,
        status              NVARCHAR(20) NOT NULL DEFAULT 'PENDING',
        smart_state_name    NVARCHAR(200) NULL,
        pending_launch_json NVARCHAR(MAX) NOT NULL,
        awx_job_id          INT NULL,
        error_message       NVARCHAR(MAX) NULL,
        created_at          DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at          DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        resolved_at         DATETIME2 NULL
      )`,
  },
  {
    // Eskiden server/data/inventory-saved-queries.json — kimlik anahtari 'name'
    // (bkz. server/inventory/index.cjs readSavedQueries/writeSavedQueries).
    name: 'inventory_saved_queries',
    sql: `
      CREATE TABLE inventory_saved_queries (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        name         NVARCHAR(255) NOT NULL UNIQUE,
        sql_text     NVARCHAR(MAX) NOT NULL,
        is_published BIT NOT NULL DEFAULT 1,
        is_default   BIT NOT NULL DEFAULT 0,
        published_by NVARCHAR(255) DEFAULT '',
        description  NVARCHAR(MAX) DEFAULT '',
        saved_at     DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      )`,
  },
  // ── Kimlik + kullanici tercihleri ──────────────────────────────────────────────
  {
    // Portal'a giris yapan her kullanicinin profili — /login basarisinda MERGE edilir
    // (last_login, login_count, LDAP profil alanlari). Bkz. server/auth/index.cjs.
    name: 'portal_users',
    sql: `
      CREATE TABLE portal_users (
        username     NVARCHAR(255) NOT NULL PRIMARY KEY,
        display_name NVARCHAR(255),
        mail         NVARCHAR(255),
        department   NVARCHAR(255),
        title        NVARCHAR(255),
        auth_source  NVARCHAR(50) NOT NULL DEFAULT 'local',
        first_seen   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        last_login   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        login_count  INT NOT NULL DEFAULT 1
      )`,
  },
  {
    // Kullanici basina UI tercihleri (generic KV): tema, envanter kolon secimleri,
    // filtre/siralama/limit, aktif admin sekmesi vb. Restart ve tarayici degisiminde korunur.
    name: 'portal_user_preferences',
    sql: `
      CREATE TABLE portal_user_preferences (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        username   NVARCHAR(255) NOT NULL,
        pref_key   NVARCHAR(200) NOT NULL,
        pref_value NVARCHAR(MAX),
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(username, pref_key)
      )`,
  },
  // ── AI Analyst kalicilik ───────────────────────────────────────────────────────
  {
    // AI sohbet oturumlari — refresh/restart sonrasi devam edilebilir.
    name: 'ai_conversations',
    sql: `
      CREATE TABLE ai_conversations (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        username   NVARCHAR(255) NOT NULL,
        title      NVARCHAR(500) NOT NULL DEFAULT '',
        archived   BIT NOT NULL DEFAULT 0,
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      )`,
  },
  {
    name: 'ai_messages',
    sql: `
      CREATE TABLE ai_messages (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        conversation_id INT NOT NULL,
        role            NVARCHAR(20) NOT NULL,
        content         NVARCHAR(MAX) NOT NULL DEFAULT '',
        tool_name       NVARCHAR(100),
        created_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
      )`,
  },
  {
    // AI kullanim/performans telemetrisi — cagri basina token/latency/tool-call kaydi.
    name: 'ai_usage_log',
    sql: `
      CREATE TABLE ai_usage_log (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        username      NVARCHAR(255) NOT NULL,
        feature       NVARCHAR(30) NOT NULL,
        provider      NVARCHAR(30),
        model         NVARCHAR(100),
        input_tokens  INT,
        output_tokens INT,
        latency_ms    INT,
        tool_calls    INT NOT NULL DEFAULT 0,
        ok            BIT NOT NULL DEFAULT 1,
        error         NVARCHAR(500),
        created_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      )`,
  },
  // ── Ayar/config tablolari ──────────────────────────────────────────────────────
  {
    // Admin Sistem sekmesinin kalici env override'lari — .env.local dosyasina yazmak yerine.
    // Boot'ta dotenv yuklemesinden SONRA uygulanir (bkz. server/db/env-overrides.cjs).
    name: 'portal_env_overrides',
    sql: `
      CREATE TABLE portal_env_overrides (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        env_key    NVARCHAR(100) NOT NULL,
        env_value  NVARCHAR(MAX) NOT NULL DEFAULT '',
        updated_by NVARCHAR(255),
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(env_key)
      )`,
  },
  {
    // Runtime tunables (LogX TTL/limitler, AI MAX_TOKENS/rate limitleri vb.) — env
    // fallback'li getSetting() ile okunur (bkz. server/db/settings.cjs).
    name: 'portal_settings',
    sql: `
      CREATE TABLE portal_settings (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        setting_key   NVARCHAR(100) NOT NULL,
        setting_value NVARCHAR(MAX) NOT NULL DEFAULT '',
        description   NVARCHAR(500),
        updated_by    NVARCHAR(255),
        updated_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(setting_key)
      )`,
  },
  {
    // PII maskeleme kurallari (eskiden server/logx/masker.cjs icinde hardcoded RULES).
    // sort_order KRITIK: PHONE_GEN, TCKN'den sonra kosmali (cifte maskeleme onlenir).
    name: 'logx_mask_rules',
    sql: `
      CREATE TABLE logx_mask_rules (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        name        NVARCHAR(50) NOT NULL,
        pattern     NVARCHAR(500) NOT NULL,
        flags       NVARCHAR(10) NOT NULL DEFAULT 'g',
        replacement NVARCHAR(200) NOT NULL,
        sort_order  INT NOT NULL DEFAULT 0,
        enabled     BIT NOT NULL DEFAULT 1,
        updated_at  DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(name)
      )`,
  },
  {
    // AWX sunucu kayitlari (eskiden yalnizca env AWX_1..9_*). Ilk boot'ta env'den seed
    // edilir; getServers() DB-oncelikli okur, bos secret alanlari icin env fallback surer.
    name: 'ansible_awx_servers',
    sql: `
      CREATE TABLE ansible_awx_servers (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        server_no     INT NOT NULL,
        name          NVARCHAR(150) NOT NULL,
        url           NVARCHAR(500) NOT NULL,
        token         NVARCHAR(MAX),
        username      NVARCHAR(255),
        password      NVARCHAR(MAX),
        client_id     NVARCHAR(255),
        client_secret NVARCHAR(MAX),
        enabled       BIT NOT NULL DEFAULT 1,
        updated_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(server_no)
      )`,
  },
  {
    // Splunk urun listesi (eskiden SPLUNK_PRODUCTS env virgullu listesi).
    name: 'splunk_products',
    sql: `
      CREATE TABLE splunk_products (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        product    NVARCHAR(100) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        enabled    BIT NOT NULL DEFAULT 1,
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(product)
      )`,
  },
  // ── Portal geneli audit + telemetri ───────────────────────────────────────────
  {
    // Portal geneli hash-zincirli denetim kaydi (logx_audit_logs ile ayni v3 sema) —
    // login/logout, tum admin CRUD'lari, dogrudan Ansible launch, AI kullanim.
    name: 'portal_audit_logs',
    sql: `
      CREATE TABLE portal_audit_logs (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        session_id  NVARCHAR(36),
        username    NVARCHAR(255) NOT NULL,
        auth_source NVARCHAR(50),
        role        NVARCHAR(50),
        target_host NVARCHAR(255),
        target_ip   NVARCHAR(45),
        action      NVARCHAR(100) NOT NULL,
        result      NVARCHAR(50),
        detail      NVARCHAR(MAX),
        client_ip   NVARCHAR(45),
        prev_hash   NVARCHAR(80),
        entry_hash  NVARCHAR(80),
        created_at  DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      )`,
  },
  {
    // AWX job stdout arsivi — job terminal duruma gecince bir kez cekilip saklanir
    // (AWX tarafinda job silinse bile gecmis portal'da kalir).
    name: 'ansible_job_output',
    sql: `
      CREATE TABLE ansible_job_output (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        awx_server_id INT NOT NULL,
        job_id        INT NOT NULL,
        stdout        NVARCHAR(MAX),
        fetched_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UNIQUE(awx_server_id, job_id)
      )`,
  },
  {
    // Servis metrik anlik goruntusu — 5 dk'da bir yazilir; canli sayaclar (metrics.cjs)
    // proses ici kalir, bu tablo restart'lar arasi trend gecmisini saklar.
    name: 'metrics_snapshots',
    sql: `
      CREATE TABLE metrics_snapshots (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        captured_at       DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        requests          BIGINT NOT NULL DEFAULT 0,
        errors_5xx        BIGINT NOT NULL DEFAULT 0,
        p50_ms            INT,
        p95_ms            INT,
        p99_ms            INT,
        event_loop_lag_ms INT,
        rss_mb            INT,
        heap_used_mb      INT
      )`,
  },
];

// LogX v2 EAR-klasor-son-eki → ortam etiketi varsayilan seed'i (admin ekranindan duzenlenebilir).
const ENV_SUFFIX_SEED = [
  { suffix: '-T', env_label: 'TEST', sort_order: 1 },
  { suffix: '-D', env_label: 'DEV', sort_order: 2 },
  { suffix: '', env_label: 'PROD', sort_order: 3 },
];

async function seedEnvSuffixMap(pool) {
  for (const row of ENV_SUFFIX_SEED) {
    try {
      const exists = await pool.request()
        .input('suffix', row.suffix)
        .query(`SELECT 1 FROM logx_env_suffix_map WHERE suffix = @suffix`);
      if (exists.recordset.length) continue;
      await pool.request()
        .input('suffix', row.suffix)
        .input('env_label', row.env_label)
        .input('sort_order', row.sort_order)
        .query(`
          INSERT INTO logx_env_suffix_map (suffix, env_label, sort_order)
          VALUES (@suffix, @env_label, @sort_order)
        `);
      console.log(`[DB] Ortam son-eki eslemesi eklendi: '${row.suffix}' -> ${row.env_label}`);
    } catch (err) {
      console.warn(`[DB] Ortam son-eki eslemesi eklenemedi ('${row.suffix}'):`, err.message);
    }
  }
}

// page_visibility varsayilan seed'i — server/auth/index.cjs'teki DEFAULT_VISIBILITY ile
// AYNI degerler (o dosya DB bosken/erisilemezken fallback olarak kendi kopyasini kullanir;
// burada yalnizca ilk kurulumda tabloyu doldurmak icin).
const PAGE_VISIBILITY_SEED = [
  { page_name: 'Dashboard', roles: 'Admin,User' },
  { page_name: 'Envanter', roles: 'Admin,User' },
  { page_name: 'LogX', roles: 'Admin,User' },
  { page_name: 'OpsX', roles: 'Admin,User' },
  { page_name: 'FileX', roles: 'Admin,User' },
  { page_name: 'Telnet', roles: 'Admin,User' },
  { page_name: 'Self Service', roles: 'Admin,User' },
  { page_name: 'Ansible', roles: 'Admin' },
  { page_name: 'Performance', roles: 'Admin,User' },
  { page_name: 'AI Analist', roles: 'Admin,User' },
  { page_name: 'Nöbet', roles: 'Admin,User' },
  { page_name: 'Linkler', roles: 'Admin,User' },
  { page_name: 'Admin', roles: 'Admin' },
];

async function seedPageVisibility(pool) {
  for (const row of PAGE_VISIBILITY_SEED) {
    try {
      const exists = await pool.request()
        .input('page_name', row.page_name)
        .query(`SELECT 1 FROM page_visibility WHERE page_name = @page_name`);
      if (exists.recordset.length) continue;
      await pool.request()
        .input('page_name', row.page_name)
        .input('roles', row.roles)
        .query(`INSERT INTO page_visibility (page_name, roles) VALUES (@page_name, @roles)`);
      console.log(`[DB] Sayfa gorunurlugu eklendi: ${row.page_name} -> ${row.roles}`);
    } catch (err) {
      console.warn(`[DB] Sayfa gorunurlugu eklenemedi (${row.page_name}):`, err.message);
    }
  }
}

// ── Dinamik gorunurluk element katalogu seed'i ────────────────────────────────
// Sayfalar mevcut anahtar isimleriyle (frontend canViewPage ile birebir uyumlu) tutulur —
// boylece Faz 1'de frontend bozulmaz. Tab anahtarlari da mevcut "Perf:*" ile ayni. Admin
// sekmeleri ve butonlar yeni semada ("admintab:*", "btn:*"). `roles` verilmisse element
// kisitlidir (default_visible=0 + o roller icin allow); verilmemisse default-open.
const ELEMENT_SEED = [
  // actions.md #19 (Bolum O.2) — ana menu ust-seviye grup basliklari artik burada, DB
  // kaydi olarak. Asagidaki PAGE satirlarinin parent_key'i bu grup anahtarlarina isaret
  // eder (mevcut kurulumlarda parent_key UPDATE'i icin bkz. migratePageParentKeysToNavGroups —
  // idempotent seed INSERT deseni VAR OLAN satirlari GUNCELLEMEZ, bu yuzden ayri bir migration
  // adimi gerekiyor).
  { element_key: 'navgroup:genel',     element_type: 'nav_group', label: 'Genel',              sort_order: 1 },
  { element_key: 'navgroup:envanter',  element_type: 'nav_group', label: 'Envanter',            sort_order: 2 },
  { element_key: 'navgroup:performance', element_type: 'nav_group', label: 'Performance',       sort_order: 4 },
  { element_key: 'navgroup:operasyon', element_type: 'nav_group', label: 'Nöbetçiler',          sort_order: 5 },
  { element_key: 'navgroup:otomasyon', element_type: 'nav_group', label: 'Self Servis',         sort_order: 6 },
  { element_key: 'navgroup:ai',        element_type: 'nav_group', label: 'AI Analist',          sort_order: 7 },
  { element_key: 'navgroup:kaynaklar', element_type: 'nav_group', label: 'Yardımcı Araçlar',    sort_order: 8 },
  { element_key: 'navgroup:admin',     element_type: 'nav_group', label: 'Admin',               sort_order: 9 },
  // Sayfalar (mevcut PAGE_VISIBILITY_SEED ile ayni roller)
  { element_key: 'Dashboard',    element_type: 'page', parent_key: 'navgroup:genel',       label: 'Dashboard',    route: '/dashboard',       sort_order: 1,  roles: ['Admin', 'User'] },
  { element_key: 'Envanter',     element_type: 'page', parent_key: 'navgroup:envanter',    label: 'Envanter',     route: '/envanter',        sort_order: 2,  roles: ['Admin', 'User'] },
  { element_key: 'LogX',         element_type: 'page', parent_key: 'navgroup:otomasyon',   label: 'LogX',         route: '/logx',            sort_order: 7,  roles: ['Admin', 'User'] },
  { element_key: 'OpsX',         element_type: 'page', parent_key: 'navgroup:otomasyon',   label: 'OpsX',         route: '/opsx',            sort_order: 8,  roles: ['Admin', 'User'] },
  { element_key: 'FileX',        element_type: 'page', parent_key: 'navgroup:otomasyon',   label: 'FileX',        route: '/filex',           sort_order: 8,  roles: ['Admin', 'User'] },
  { element_key: 'Telnet',       element_type: 'page', parent_key: 'navgroup:otomasyon',   label: 'Telnet',       route: '/telnet',          sort_order: 9,  roles: ['Admin', 'User'] },
  { element_key: 'Self Service', element_type: 'page', parent_key: 'navgroup:otomasyon',   label: 'Otomasyon',    route: '/self-service',    sort_order: 5,  roles: ['Admin', 'User'] },
  { element_key: 'Ansible',      element_type: 'page', parent_key: 'navgroup:otomasyon',   label: 'Ansible',      route: '/ansible',         sort_order: 6,  roles: ['Admin'] },
  { element_key: 'Performance',  element_type: 'page', parent_key: 'navgroup:performance', label: 'Performance',  route: '/performance',     sort_order: 7,  roles: ['Admin', 'User'] },
  { element_key: 'AI Analist',   element_type: 'page', parent_key: 'navgroup:ai',          label: 'AI Analist',   route: '/ai-analyst',      sort_order: 8,  roles: ['Admin', 'User'] },
  { element_key: 'Nöbet',        element_type: 'page', parent_key: 'navgroup:operasyon',   label: 'Nöbet',        route: '/duty-roster',     sort_order: 9,  roles: ['Admin', 'User'] },
  { element_key: 'Linkler',      element_type: 'page', parent_key: 'navgroup:kaynaklar',   label: 'Linkler',      route: '/important-links', sort_order: 10, roles: ['Admin', 'User'] },
  { element_key: 'Admin',        element_type: 'page', parent_key: 'navgroup:admin',       label: 'Admin',        route: '/admin',           sort_order: 11, roles: ['Admin'] },
  // Performance alt-tab'lari (bugun default-open — koru)
  { element_key: 'Perf:problems', element_type: 'tab', parent_key: 'Performance', label: 'Problems',  sort_order: 1, default_visible: 1 },
  { element_key: 'Perf:events',   element_type: 'tab', parent_key: 'Performance', label: 'Events',    sort_order: 2, default_visible: 1 },
  { element_key: 'Perf:entities', element_type: 'tab', parent_key: 'Performance', label: 'Entities',  sort_order: 3, default_visible: 1 },
  { element_key: 'Perf:metrics',  element_type: 'tab', parent_key: 'Performance', label: 'Metrics',   sort_order: 4, default_visible: 1 },
  { element_key: 'Perf:instana',  element_type: 'tab', parent_key: 'Performance', label: 'Instana',   sort_order: 5, default_visible: 1 },
  { element_key: 'Perf:splunk',   element_type: 'tab', parent_key: 'Performance', label: 'Splunk',    sort_order: 6, default_visible: 1 },
  // Admin sekmeleri (yeni sema; Admin zaten hepsini gorur — default-open yeterli)
  { element_key: 'admintab:logxv2',      element_type: 'admin_tab', parent_key: 'Admin', label: 'LogX Yapılandırma',  sort_order: 1,  default_visible: 1 },
  { element_key: 'admintab:audit',       element_type: 'admin_tab', parent_key: 'Admin', label: 'Denetim Kaydı',      sort_order: 2,  default_visible: 1 },
  { element_key: 'admintab:selfservice', element_type: 'admin_tab', parent_key: 'Admin', label: 'Self Service',       sort_order: 3,  default_visible: 1 },
  { element_key: 'admintab:ansible',     element_type: 'admin_tab', parent_key: 'Admin', label: 'Ansible Info',       sort_order: 6,  default_visible: 1 },
  { element_key: 'admintab:playbooks',   element_type: 'admin_tab', parent_key: 'Admin', label: 'Playbook Kayıtları', sort_order: 7,  default_visible: 1 },
  { element_key: 'admintab:system',      element_type: 'admin_tab', parent_key: 'Admin', label: 'Sistem',             sort_order: 8,  default_visible: 1 },
  { element_key: 'admintab:users',       element_type: 'admin_tab', parent_key: 'Admin', label: 'Kullanıcılar',       sort_order: 9,  default_visible: 1 },
  { element_key: 'admintab:visibility',  element_type: 'admin_tab', parent_key: 'Admin', label: 'Görünürlük',         sort_order: 10, default_visible: 1 },
  { element_key: 'admintab:inventoryvis', element_type: 'admin_tab', parent_key: 'Admin', label: 'Envanter Görünürlüğü', sort_order: 11, default_visible: 1 },
  { element_key: 'admintab:branding',     element_type: 'admin_tab', parent_key: 'Admin', label: 'Marka',              sort_order: 13, default_visible: 1 },
  // AI-tetiklemeli altyapi launch kill-switch'i (guvenlik-hassas). Kapatinca AI, altyapi
  // job'i baslatamaz (bkz. server/ai-analyst/portal-tools.cjs feature:ai_infra_launch).
  { element_key: 'feature:ai_infra_launch', element_type: 'feature', parent_key: 'AI Analist', label: 'AI → Altyapı Job Başlatma', sort_order: 1, default_visible: 1 },
];

async function seedPortalElements(pool) {
  // 1) Element satirlari — idempotent
  for (const el of ELEMENT_SEED) {
    try {
      const exists = await pool.request().input('k', el.element_key)
        .query(`SELECT 1 FROM portal_elements WHERE element_key = @k`);
      if (exists.recordset.length) continue;
      const restricted = Array.isArray(el.roles);
      const defaultVisible = restricted ? 0 : (el.default_visible != null ? (el.default_visible ? 1 : 0) : 1);
      await pool.request()
        .input('k', el.element_key).input('t', el.element_type)
        .input('p', el.parent_key || null).input('l', el.label || null)
        .input('r', el.route || null).input('o', el.sort_order || 0)
        .input('dv', defaultVisible)
        .query(`INSERT INTO portal_elements (element_key, element_type, parent_key, label, route, sort_order, enabled, default_visible)
                VALUES (@k, @t, @p, @l, @r, @o, 1, @dv)`);
    } catch (err) {
      console.warn(`[DB] portal_elements seed eklenemedi (${el.element_key}):`, err.message);
    }
  }
  // 2) Gorunurluk kurallari — yalnizca tablo TAMAMEN bossa (ilk kurulum/migrasyon). Mevcut
  //    page_visibility (admin duzenlemeleri) varsa oradan tasinir; yoksa ELEMENT_SEED rolleri.
  try {
    const any = await pool.request().query(`SELECT TOP 1 1 AS x FROM portal_element_visibility`);
    if (any.recordset.length) return;
    const pv = await pool.request().query(`SELECT page_name, roles FROM page_visibility`);
    const pvMap = {};
    for (const r of pv.recordset) {
      pvMap[r.page_name] = String(r.roles).split(',').map((s) => s.trim()).filter(Boolean);
    }
    for (const el of ELEMENT_SEED) {
      if (!Array.isArray(el.roles)) continue; // yalnizca kisitli elementler rol kurali alir
      const roles = pvMap[el.element_key] || el.roles;
      for (const role of roles) {
        await pool.request()
          .input('k', el.element_key).input('pt', 'role').input('pid', role).input('a', 1)
          .query(`INSERT INTO portal_element_visibility (element_key, principal_type, principal_id, allow)
                  VALUES (@k, @pt, @pid, @a)`);
      }
    }
    console.log('[DB] portal_element_visibility ilk kez seed edildi (page_visibility tasindi).');
  } catch (err) {
    console.warn('[DB] portal_element_visibility seed hata:', err.message);
  }
}

// ── Playbook registry seed — idempotent ("yoksa ekle") ────────────────────────
// awx_template_id her zaman NULL baslar; admin ekranindan veya ilgili env_var_name
// (.env) ile doldurulur — ikisi de desteklenir (bkz. getEffectiveTemplateId).
const PLAYBOOK_REGISTRY_SEED = [
  {
    key_name: 'jvm_heap_status', display_name: 'JVM Heap/GC Durumu', category: 'jvm', handler: 'host_target',
    description: 'JBoss/WildFly/EAP JVM prosesinin heap/GC istatistiklerini ve başlangıç bayraklarını (jstat/jmap, salt-okunur) getirir.',
    playbook_path: 'server/ansible/playbooks/jvm_heap_status.yml', env_var_name: 'AWX_JVM_HEAP_TEMPLATE_ID',
  },
  {
    key_name: 'ocp_pod_status', display_name: 'OpenShift Pod Durumu', category: 'openshift', handler: 'ocp_cluster',
    description: 'Kayıtlı bir OpenShift cluster\'ının pod/node/cluster-operator durumunu (oc get, salt-okunur) getirir.',
    playbook_path: 'server/ansible/playbooks/ocp_pod_status.yml', env_var_name: 'AWX_OCP_POD_STATUS_TEMPLATE_ID',
  },
  {
    key_name: 'network_connectivity_check', display_name: 'Network Bağlantı Durumu', category: 'network', handler: 'host_target',
    description: 'Ağ arayüzleri, route, DNS çözümleme ve dinleyen portları (salt-okunur) getirir.',
    playbook_path: 'server/ansible/playbooks/network_connectivity_check.yml', env_var_name: 'AWX_NETWORK_CHECK_TEMPLATE_ID',
  },
  {
    key_name: 'disk_usage_status', display_name: 'Disk Kullanım Durumu', category: 'system', handler: 'host_target',
    description: 'Disk/inode kullanımı ve en büyük dizinleri (salt-okunur) getirir.',
    playbook_path: 'server/ansible/playbooks/disk_usage_status.yml', env_var_name: 'AWX_DISK_USAGE_TEMPLATE_ID',
  },
  {
    key_name: 'system_health_overview', display_name: 'Sistem Sağlığı Genel Görünüm', category: 'system', handler: 'host_target',
    description: 'Uptime, bellek, CPU ve en yoğun prosesleri (salt-okunur) getirir.',
    playbook_path: 'server/ansible/playbooks/system_health_overview.yml', env_var_name: 'AWX_SYSTEM_HEALTH_TEMPLATE_ID',
  },
  {
    key_name: 'web_server_status', display_name: 'Web Sunucu Durumu', category: 'network', handler: 'host_target',
    description: 'Nginx/Apache/Tomcat proses ve config durumunu, 80/443 bağlantılarını (salt-okunur) getirir.',
    playbook_path: 'server/ansible/playbooks/web_server_status.yml', env_var_name: 'AWX_WEB_SERVER_STATUS_TEMPLATE_ID',
  },
  {
    key_name: 'service_status_check', display_name: 'Servis Durumu Kontrolü', category: 'system', handler: 'host_target',
    description: 'Yaygın servislerin (nginx/httpd/docker/podman/jbossas/tomcat) durumunu (salt-okunur) getirir.',
    playbook_path: 'server/ansible/playbooks/service_status_check.yml', env_var_name: 'AWX_SERVICE_STATUS_TEMPLATE_ID',
  },
  // ── LogX v2 job tipleri — kilitli (admin UI'dan yeni satir olusturulamaz, yalnizca
  // template ID + awx_server_id duzenlenebilir), ocp_pod_status ile ayni "locked" desen.
  {
    key_name: 'logx_legacy_discovery', display_name: 'LogX — Legacy Log Keşfi', category: 'logx', handler: 'legacy_discovery',
    description: 'Bir uygulamanın /vhosting ve /vhosting8 altındaki log dosyalarını (salt-okunur, find) keşfeder.',
    playbook_path: 'server/ansible/playbooks/logx_legacy_discovery.yml', env_var_name: 'AWX_LOGX_LEGACY_DISCOVERY_TEMPLATE_ID',
  },
  {
    key_name: 'logx_legacy_transfer', display_name: 'LogX — Legacy Log Transferi', category: 'logx', handler: 'legacy_transfer',
    description: 'Seçilen log dosyalarını zip\'leyip portalın okuyabildiği staging dizinine bırakır.',
    playbook_path: 'server/ansible/playbooks/logx_legacy_transfer.yml', env_var_name: 'AWX_LOGX_LEGACY_TRANSFER_TEMPLATE_ID',
  },
  {
    key_name: 'logx_ocp_namespace_discovery', display_name: 'LogX — OCP Namespace Keşfi', category: 'logx', handler: 'ocp_namespace_discovery',
    description: 'Seçilen cluster(lar)da kullanıcının erişebildiği namespace/proje listesini (oc get projects, salt-okunur) getirir.',
    playbook_path: 'server/ansible/playbooks/logx_ocp_namespace_discovery.yml', env_var_name: 'AWX_LOGX_OCP_NAMESPACE_DISCOVERY_TEMPLATE_ID',
  },
  {
    key_name: 'logx_ocp_app_discovery', display_name: 'LogX — OCP Uygulama/Obje Keşfi', category: 'logx', handler: 'ocp_app_discovery',
    description: 'Seçilen namespace(ler)de çalışan uygulama ve objeleri (deployment, statefulset, pod, service, route…) salt-okunur listeler; sonuç portalda önbelleğe alınır.',
    playbook_path: 'server/ansible/playbooks/logx_ocp_app_discovery.yml', env_var_name: 'AWX_LOGX_OCP_APP_DISCOVERY_TEMPLATE_ID',
  },
  {
    key_name: 'logx_ocp_discover_fetch', display_name: 'LogX — OCP Pod Log Keşfi+Çekme', category: 'logx', handler: 'ocp_discover_fetch',
    description: 'Seçilen cluster(lar)da uygulama adına eşleşen tüm pod\'ların loglarını çeker, zip\'ler, staging dizinine bırakır.',
    playbook_path: 'server/ansible/playbooks/logx_ocp_discover_fetch.yml', env_var_name: 'AWX_LOGX_OCP_DISCOVER_FETCH_TEMPLATE_ID',
  },
  // ── OpsX islem tipleri — LogX ile AYNI desen: satirlar seed'den gelir, admin
  // yalnizca awx_template_id + awx_server_id degerlerini duzenler (Admin > Playbook
  // Kayitlari). Template ID bos oldugu surece OpsX ilgili platformda calismaz ve
  // kullaniciya "yonetici tanimlamali" mesaji doner.
  {
    key_name: 'opsx_legacy_operation', display_name: 'OpsX — Legacy Uygulama Operasyonu', category: 'opsx', handler: 'opsx_legacy',
    description: 'JBoss/WAS geleneksel Linux sunucularda uygulama restart/stop/start/thread dump/heap dump islemi.',
    playbook_path: null, env_var_name: 'OPSX_LEGACY_TEMPLATE_ID',
  },
  {
    key_name: 'opsx_openshift_operation', display_name: 'OpsX — Openshift Uygulama Operasyonu', category: 'opsx', handler: 'opsx_openshift',
    description: 'ARK/Non-ARK container uygulamalarinda restart/stop/start islemi.',
    playbook_path: null, env_var_name: 'OPSX_OPENSHIFT_TEMPLATE_ID',
  },
  // ── OpsX Thread/Heap Dump — restart/stop/start'tan AYRI template'ler (dosya
  // staging/indirme gerektirdigi icin mimari olarak farkli, bkz. server/opsx/downloads.cjs).
  {
    key_name: 'opsx_legacy_dump', display_name: 'OpsX — Legacy Thread/Heap Dump', category: 'opsx', handler: 'opsx_legacy_dump',
    description: 'JBoss7/8 sunucularda jmap/jstack ile heap/thread dump alir, paylasilan staging dizinine birakir.',
    playbook_path: 'server/ansible/playbooks/opsx_legacy_dump.yml', env_var_name: 'OPSX_LEGACY_DUMP_TEMPLATE_ID',
  },
  {
    key_name: 'opsx_openshift_dump', display_name: 'OpsX — Openshift Thread/Heap Dump', category: 'opsx', handler: 'opsx_openshift_dump',
    description: 'Secilen pod\'lardan heap/thread dump alir (bmw_portal/opsx_openshift_dump/opsx_openshift_dump.yaml) - dump\'lar tek arsivde toplanip portalin staging dizinine birakilir, kullanici portaldan indirir.',
    playbook_path: null, env_var_name: 'OPSX_OPENSHIFT_DUMP_TEMPLATE_ID',
  },
  {
    key_name: 'opsx_openshift_pods', display_name: 'OpsX — Openshift Pod Keşfi', category: 'opsx', handler: 'opsx_openshift_pods',
    description: 'Bir namespace\'teki pod\'lari listeler (salt-okunur, oc get pods) - dump sihirbazi kullaniciya pod sectirmek icin ANLIK tetikler. bmw_portal/opsx_openshift_dump/opsx_openshift_pods.yaml',
    playbook_path: null, env_var_name: 'OPSX_OPENSHIFT_PODS_TEMPLATE_ID',
  },
  {
    key_name: 'opsx_legacy_jvm_discover', display_name: 'OpsX — Legacy JVM Keşfi', category: 'opsx', handler: 'opsx_legacy_jvm_discover',
    description: 'Secili sunucularda uygulama adina calisan JVM\'leri (PID + komut satiri) listeler (salt-okunur, ps) - dump sihirbazi kullaniciya JVM sectirmek icin ANLIK tetikler. server/ansible/playbooks/opsx_legacy_jvm_discover.yml',
    playbook_path: 'server/ansible/playbooks/opsx_legacy_jvm_discover.yml', env_var_name: 'OPSX_LEGACY_JVM_DISCOVER_TEMPLATE_ID',
  },
  // ── Telnet baglanti testi — OpsX ile AYNI desen (bkz. server/telnet/index.cjs) ────
  {
    key_name: 'telnet_legacy_operation', display_name: 'Telnet — Legacy Baglanti Testi', category: 'telnet', handler: 'telnet_legacy',
    description: 'JBoss/WAS sunucularindan verilen IP/Port\'a Telnet baglanti testi.',
    playbook_path: null, env_var_name: 'TELNET_LEGACY_TEMPLATE_ID',
  },
  {
    key_name: 'telnet_openshift_operation', display_name: 'Telnet — Openshift Baglanti Testi', category: 'telnet', handler: 'telnet_openshift',
    description: 'ARK/Non-ARK container ortamlarindan verilen IP/Port\'a Telnet baglanti testi.',
    playbook_path: null, env_var_name: 'TELNET_OPENSHIFT_TEMPLATE_ID',
  },
  // ── FileX — Self Servis dosya listeleme (SADECE Legacy) ──────────────────────
  // OpsX/Telnet ile AYNI desen: satir seed'den gelir, admin yalniz awx_template_id +
  // awx_server_id doldurur. Playbook'un kendisi bu repo'nun DISINDA tutulur
  // (middleware_inventory.yml/openshift_inventory.yml ile ayni konvansiyon) — bu yuzden
  // playbook_path null (OpsX/Telnet gibi).
  {
    key_name: 'filex_list_files', display_name: 'FileX — Dosya Listeleme (Legacy)', category: 'filex', handler: 'filex_list_files',
    description: 'Secilen uygulamanin .ear dizinindeki (logs haric) tum dosyalari ls -la + sha512sum bilgisiyle salt-okunur listeler.',
    playbook_path: null, env_var_name: 'FILEX_LIST_FILES_TEMPLATE_ID',
  },
];

async function seedPlaybookRegistry(pool) {
  for (const row of PLAYBOOK_REGISTRY_SEED) {
    try {
      const exists = await pool.request()
        .input('key_name', row.key_name)
        .query(`SELECT 1 FROM ansible_playbook_registry WHERE key_name = @key_name`);
      if (exists.recordset.length) continue;
      await pool.request()
        .input('key_name', row.key_name)
        .input('display_name', row.display_name)
        .input('description', row.description)
        .input('category', row.category)
        .input('handler', row.handler)
        .input('playbook_path', row.playbook_path)
        .input('env_var_name', row.env_var_name)
        .query(`
          INSERT INTO ansible_playbook_registry
            (key_name, display_name, description, category, handler, playbook_path, env_var_name)
          VALUES (@key_name, @display_name, @description, @category, @handler, @playbook_path, @env_var_name)
        `);
      console.log(`[DB] Playbook kaydi eklendi: ${row.key_name}`);
    } catch (err) {
      console.warn(`[DB] Playbook kaydi eklenemedi (${row.key_name}):`, err.message);
    }
  }
}

// ── Maskeleme kurallari seed'i — server/logx/masker.cjs'teki RULES ile birebir ayni.
// Regex kaynaklari string olarak saklanir; masker bunlari new RegExp(pattern, flags) ile
// derler. sort_order regex calisma sirasidir (PHONE_GEN en sonda kalmali).
const MASK_RULES_SEED = [
  { name: 'TCKN',      pattern: '\\b[1-9]\\d{10}\\b',                                                              flags: 'g',  replacement: '[TCKN]',                     sort_order: 1 },
  { name: 'IBAN',      pattern: '\\bTR\\d{2}(?:[ -]?\\d{4}){5}[ -]?\\d{2}\\b',                                     flags: 'gi', replacement: '[IBAN]',                     sort_order: 2 },
  { name: 'IBAN_INTL', pattern: '\\b[A-Z]{2}\\d{2}[0-9A-Z]{11,30}\\b',                                             flags: 'g',  replacement: '[IBAN]',                     sort_order: 3 },
  { name: 'CARD',      pattern: '\\b(?:\\d[ -]?){13,16}\\b',                                                       flags: 'g',  replacement: '[CARD]',                     sort_order: 4 },
  { name: 'BEARER',    pattern: 'Bearer\\s+[A-Za-z0-9\\-._~+/]+=*',                                                flags: 'gi', replacement: 'Bearer [TOKEN]',             sort_order: 5 },
  { name: 'JWT',       pattern: 'eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]*',                             flags: 'g',  replacement: '[JWT]',                      sort_order: 6 },
  { name: 'AUTH_HDR',  pattern: 'Authorization:\\s*\\S+',                                                          flags: 'gi', replacement: 'Authorization: [REDACTED]',  sort_order: 7 },
  { name: 'PASSWORD',  pattern: '("password"\\s*:\\s*)"[^"]*"',                                                    flags: 'gi', replacement: '$1"[REDACTED]"',             sort_order: 8 },
  { name: 'PASSWORD2', pattern: '(password=)[^&\\s]+',                                                             flags: 'gi', replacement: '$1[REDACTED]',               sort_order: 9 },
  { name: 'EMAIL',     pattern: '\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}\\b',                       flags: 'g',  replacement: '[EMAIL]',                    sort_order: 10 },
  { name: 'PHONE_TR',  pattern: '(\\+90|0)[\\s-]?(5\\d{2})[\\s\\-]?(\\d{3})[\\s\\-]?(\\d{2})[\\s\\-]?(\\d{2})\\b', flags: 'g',  replacement: '[PHONE]',                    sort_order: 11 },
  { name: 'PHONE_GEN', pattern: '(?<!\\d)\\d{10,12}(?!\\d)',                                                       flags: 'g',  replacement: '[PHONE]',                    sort_order: 12 },
];

async function seedMaskRules(pool) {
  for (const row of MASK_RULES_SEED) {
    try {
      const exists = await pool.request().input('name', row.name)
        .query(`SELECT 1 FROM logx_mask_rules WHERE name = @name`);
      if (exists.recordset.length) continue;
      await pool.request()
        .input('name', row.name).input('pattern', row.pattern).input('flags', row.flags)
        .input('replacement', row.replacement).input('sort_order', row.sort_order)
        .query(`
          INSERT INTO logx_mask_rules (name, pattern, flags, replacement, sort_order)
          VALUES (@name, @pattern, @flags, @replacement, @sort_order)
        `);
      console.log(`[DB] Maskeleme kurali eklendi: ${row.name}`);
    } catch (err) {
      console.warn(`[DB] Maskeleme kurali eklenemedi (${row.name}):`, err.message);
    }
  }
}

// AWX sunucu kayitlarini env'den DB'ye tasi (ilk kurulum) — env'de tanimli olup DB'de
// olmayan server_no satirlari eklenir; mevcut satirlara dokunulmaz (admin duzenlemeleri kazanir).
async function seedAwxServersFromEnv(pool) {
  for (let i = 1; i <= 9; i++) {
    const url = (process.env[`AWX_${i}_URL`] || '').trim();
    if (!url) continue;
    try {
      const exists = await pool.request().input('no', i)
        .query(`SELECT 1 FROM ansible_awx_servers WHERE server_no = @no`);
      if (exists.recordset.length) continue;
      await pool.request()
        .input('no', i)
        .input('name', (process.env[`AWX_${i}_NAME`] || `AWX ${i}`).trim())
        .input('url', url)
        .input('token', (process.env[`AWX_${i}_TOKEN`] || '').trim() || null)
        .input('username', (process.env[`AWX_${i}_USER`] || '').trim() || null)
        .input('password', (process.env[`AWX_${i}_PASSWORD`] || '').trim() || null)
        .input('client_id', (process.env[`AWX_${i}_CLIENT_ID`] || '').trim() || null)
        .input('client_secret', (process.env[`AWX_${i}_CLIENT_SECRET`] || '').trim() || null)
        .query(`
          INSERT INTO ansible_awx_servers (server_no, name, url, token, username, password, client_id, client_secret)
          VALUES (@no, @name, @url, @token, @username, @password, @client_id, @client_secret)
        `);
      console.log(`[DB] AWX sunucusu env'den eklendi: #${i}`);
    } catch (err) {
      console.warn(`[DB] AWX sunucusu eklenemedi (#${i}):`, err.message);
    }
  }
}

// Splunk urun listesini env'den seed et (tablo bossa) — sonrasi admin/DB yonetiminde.
async function seedSplunkProducts(pool) {
  try {
    const any = await pool.request().query(`SELECT TOP 1 1 AS x FROM splunk_products`);
    if (any.recordset.length) return;
    const products = String(process.env.SPLUNK_PRODUCTS || 'httpd,nginx,tomcat,jboss')
      .split(',').map((s) => s.trim()).filter(Boolean);
    let order = 1;
    for (const product of products) {
      await pool.request().input('product', product).input('sort_order', order++)
        .query(`INSERT INTO splunk_products (product, sort_order) VALUES (@product, @sort_order)`);
    }
    if (products.length) console.log(`[DB] Splunk urunleri seed edildi (${products.length})`);
  } catch (err) {
    console.warn('[DB] Splunk urunleri seed hata:', err.message);
  }
}

// actions.md #5 (Bolum D) — Smart/Ansible/Digerleri artik veri, seed migration mevcut
// 3 degeri (eskiden SelfServicePage.tsx TOP_TABS sabitindeki) ekler.
async function seedSelfServiceGroups(pool) {
  try {
    const any = await pool.request().query(`SELECT TOP 1 1 AS x FROM selfservice_groups`);
    if (any.recordset.length) return;
    const groups = [
      { id: 'grp-smart', key: 'smart', label: 'Smart', icon: 'SparklesIcon', sort: 1 },
      { id: 'grp-ansible', key: 'ansible', label: 'Ansible', icon: 'CommandLineIcon', sort: 2 },
      { id: 'grp-others', key: 'others', label: 'Diğerleri', icon: 'EllipsisHorizontalIcon', sort: 3 },
    ];
    for (const g of groups) {
      await pool.request()
        .input('id', g.id).input('key', g.key).input('label', g.label).input('icon', g.icon).input('sort', g.sort)
        .query(`INSERT INTO selfservice_groups (id, group_key, label, icon, sort_order) VALUES (@id, @key, @label, @icon, @sort)`);
    }
    console.log('[DB] selfservice_groups seed edildi (3 varsayilan grup).');
  } catch (err) {
    console.warn('[DB] selfservice_groups seed hata:', err.message);
  }
}

// group_id sutunu ALTER ile eklendikten SONRA calisir (setupTables sonunda cagrilir) —
// mevcut selfservice_tabs satirlarinin section='smart'|'others' degerini ilgili
// selfservice_groups satirina baglar. Idempotent: yalniz group_id IS NULL satirlari etkiler.
async function migrateSelfServiceSectionsToGroups(pool) {
  try {
    const pending = await pool.request().query(`SELECT COUNT(*) AS n FROM selfservice_tabs WHERE group_id IS NULL`);
    if (!Number(pending.recordset[0]?.n || 0)) return;
    await pool.request().query(
      `UPDATE t SET t.group_id = g.id
         FROM selfservice_tabs t
         JOIN selfservice_groups g ON g.group_key = t.section
        WHERE t.group_id IS NULL`
    );
    console.log('[DB] selfservice_tabs.section -> group_id gocuruldu.');
  } catch (err) {
    console.warn('[DB] selfservice_tabs group_id gocurulemedi:', err.message);
  }
}

// actions.md #19 (Bolum O.2) — seedPortalElements idempotent INSERT deseni VAR OLAN satirlari
// gormezden gelir (element_key zaten varsa atlar), bu yuzden mevcut kurulumlarda sayfa
// elementlerinin parent_key'ini navgroup:*'a baglamak icin AYRI bir migration adimi gerekir.
// Yalniz parent_key IS NULL olan (henuz baglanmamis) satirlari etkiler — idempotent.
async function migratePageParentKeysToNavGroups(pool) {
  const pageToGroup = {
    'Dashboard': 'navgroup:genel', 'Envanter': 'navgroup:genel',
    'LogX': 'navgroup:otomasyon', 'OpsX': 'navgroup:otomasyon', 'FileX': 'navgroup:otomasyon',
    'Nöbet': 'navgroup:operasyon',
    'Self Service': 'navgroup:otomasyon', 'Ansible': 'navgroup:otomasyon',
    'Performance': 'navgroup:performance',
    'AI Analist': 'navgroup:ai',
    'Linkler': 'navgroup:kaynaklar',
    'Admin': 'navgroup:admin',
  };
  try {
    for (const [pageKey, groupKey] of Object.entries(pageToGroup)) {
      await pool.request().input('p', pageKey).input('g', groupKey)
        .query(`UPDATE portal_elements SET parent_key = @g WHERE element_key = @p AND parent_key IS NULL`);
    }
  } catch (err) {
    console.warn('[DB] Sayfa -> nav-grup parent_key gocurulemedi:', err.message);
  }
}

async function setupTables() {
  let pool;
  try {
    pool = await getPool();
  } catch {
    console.warn('[DB] Tablo kurulumu atlandi — MSSQL baglantisi yok.');
    return;
  }
  if (!pool) {
    console.warn('[DB] Tablo kurulumu atlandi — MSSQL pool null.');
    return;
  }

  for (const { name, sql } of TABLES) {
    try {
      const exists = await pool.request().query(
        `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${name}'`
      );
      if (!exists.recordset.length) {
        await pool.request().query(sql);
        console.log(`[DB] Tablo olusturuldu: ${name}`);
      }
    } catch (err) {
      console.warn(`[DB] Tablo olusturulamadi (${name}):`, err.message);
    }
  }

  await seedPlaybookRegistry(pool);
  await seedEnvSuffixMap(pool);
  await seedPageVisibility(pool);
  await seedPortalElements(pool);
  await migratePageParentKeysToNavGroups(pool);
  await seedMaskRules(pool);
  await seedAwxServersFromEnv(pool);
  await seedSplunkProducts(pool);
  await seedSelfServiceGroups(pool);

  // NOT: OCP katalog seed'i BURADA DEGIL, setupTables'in EN SONUNDA calisir — kullandigi
  // kolonlar (api_url, vault_credential_key, source, terminal_host) asagidaki ALTER
  // dongusuyle ekleniyor. Burada calistirilsaydi her INSERT "Invalid column name" ile
  // patlar, hatalar yutulur ve "yapildi" isareti yine de yazilirdi → katalog KALICI
  // OLARAK BOS kalirdi.

  // Not: Eski portal_config_blobs uzlastirmasi (config-mirror.cjs) kaldirildi — store'lar
  // artik normalize tablolara dogrudan yazar; blob'lar yalnizca her store'un kendi
  // tek-seferlik goc adiminda (tablo bosken) okunur. Blob satirlari geri donus emniyeti
  // icin silinmez ama bir daha guncellenmez.

  // ── Olu tablolari dusur (eski port-1111 LogX proxy'sinden kalma) ──────────────
  // logx_sessions ve logx_permissions inventory_hosts'a FOREIGN KEY tutuyor; bu yuzden
  // bir inventory_hosts satiri silinmek istendiginde "DELETE conflicted with REFERENCE
  // constraint FK__logx_sess__..." hatasi veriyordu. Bu tablolara YENI kodda hicbir yerde
  // yazilmiyor/okunmuyor (LogX v2 tamamen farkli tablolar kullaniyor) — guvenle
  // dusurulurler. DROP idempotent: tablo yoksa sessizce atlanir.
  for (const deadTable of ['logx_sessions', 'logx_permissions']) {
    try {
      const exists = await pool.request().query(
        `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${deadTable}'`
      );
      if (exists.recordset.length) {
        await pool.request().query(`DROP TABLE ${deadTable}`);
        console.log(`[DB] Olu tablo dusuruldu: ${deadTable} (eski LogX proxy kalintisi)`);
      }
    } catch (err) {
      console.warn(`[DB] Olu tablo dusurulemedi (${deadTable}):`, err.message);
    }
  }

  // Alter existing tables to add missing columns
  const alters = [
    {
      table: 'inventory_hosts', col: 'server_type',
      sql: `ALTER TABLE inventory_hosts ADD server_type NVARCHAR(50) DEFAULT 'generic'`,
    },
    {
      // Job-tipi basina hangi AWX sunucusunun (1..9 yapilandirilmis) kullanilacagini
      // belirler — NULL ise mevcut tek-legacy-AWX davranisi korunur (geriye uyumlu).
      table: 'ansible_playbook_registry', col: 'awx_server_id',
      sql: `ALTER TABLE ansible_playbook_registry ADD awx_server_id INT NULL`,
    },
    {
      table: 'logx_audit_logs', col: 'prev_hash',
      sql: `ALTER TABLE logx_audit_logs ADD prev_hash NVARCHAR(64)`,
    },
    {
      table: 'logx_audit_logs', col: 'entry_hash',
      sql: `ALTER TABLE logx_audit_logs ADD entry_hash NVARCHAR(64)`,
    },
    {
      // actions.md #3 (Bolum C) — soft-delete/aktiflik icin, DELETE yerine toggle.
      table: 'logx_env_suffix_map', col: 'is_active',
      sql: `ALTER TABLE logx_env_suffix_map ADD is_active BIT NOT NULL DEFAULT 1`,
    },
    {
      // actions.md #11 (Bolum J) — kaynak tipi (playbook nereden geliyor: AWX template'i /
      // repo dosyasi / harici script). Serbest metin, admin ekraninda bir Select ile sunulur.
      table: 'ansible_playbook_registry', col: 'source_type',
      sql: `ALTER TABLE ansible_playbook_registry ADD source_type NVARCHAR(50) NOT NULL DEFAULT 'awx_template'`,
    },
    {
      // Onceden yalniz dosya basindaki yorumda belgeleniyordu ("salt-okunur tanilama
      // playbook'lari") — artik gercek, admin tarafindan gorulebilir/duzenlenebilir bir alan.
      table: 'ansible_playbook_registry', col: 'is_readonly',
      sql: `ALTER TABLE ansible_playbook_registry ADD is_readonly BIT NOT NULL DEFAULT 1`,
    },
    {
      // page_visibility.roles ile ayni CSV-rol deseni ('User,Admin' | 'Admin') — ayri bir
      // tabloya cikarmayi gerektirmeyecek kadar basit bir gorunurluk ihtiyaci.
      table: 'ansible_playbook_registry', col: 'visibility',
      sql: `ALTER TABLE ansible_playbook_registry ADD visibility NVARCHAR(200) NOT NULL DEFAULT 'User,Admin'`,
    },
    {
      table: 'ansible_playbook_registry', col: 'sort_order',
      sql: `ALTER TABLE ansible_playbook_registry ADD sort_order INT NOT NULL DEFAULT 0`,
    },
    {
      // actions.md #8 (Bolum G) — gercek /api/v2/ping/ sonucu kalici hale getirilir, boylece
      // "son kontrol zamani" restart sonrasi da (bir sonraki canli kontrole kadar) gosterilebilir.
      table: 'ansible_awx_servers', col: 'last_checked_at',
      sql: `ALTER TABLE ansible_awx_servers ADD last_checked_at DATETIME2 NULL`,
    },
    {
      table: 'ansible_awx_servers', col: 'last_status',
      sql: `ALTER TABLE ansible_awx_servers ADD last_status NVARCHAR(20) NULL`,
    },
    {
      table: 'ansible_awx_servers', col: 'last_response_ms',
      sql: `ALTER TABLE ansible_awx_servers ADD last_response_ms INT NULL`,
    },
    {
      // actions.md #9 (Bolum H) — soft-delete + kim/ne zaman olusturdu + gercek baglanti testi sonucu.
      table: 'ansible_ocp_clusters', col: 'is_active',
      sql: `ALTER TABLE ansible_ocp_clusters ADD is_active BIT NOT NULL DEFAULT 1`,
    },
    {
      table: 'ansible_ocp_clusters', col: 'created_at',
      sql: `ALTER TABLE ansible_ocp_clusters ADD created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()`,
    },
    {
      table: 'ansible_ocp_clusters', col: 'created_by',
      sql: `ALTER TABLE ansible_ocp_clusters ADD created_by NVARCHAR(255) NULL`,
    },
    {
      table: 'ansible_ocp_clusters', col: 'last_checked_at',
      sql: `ALTER TABLE ansible_ocp_clusters ADD last_checked_at DATETIME2 NULL`,
    },
    {
      table: 'ansible_ocp_clusters', col: 'connection_status',
      sql: `ALTER TABLE ansible_ocp_clusters ADD connection_status NVARCHAR(20) NULL`,
    },
    {
      // OCP dinamik yapi: bastion artik CLUSTER seviyesinde tanimlanabilir. NULL ise
      // ocp_terminal_host_map(tenant,env) fallback'i gecerlidir (bkz. logx/v2/admin.cjs
      // resolveTerminalHosts) — mevcut kurulumlar hicbir davranis degisikligi gormez.
      table: 'ocp_cluster_index', col: 'terminal_host',
      sql: `ALTER TABLE ocp_cluster_index ADD terminal_host NVARCHAR(255) NULL`,
    },
    // ── Katalog birlestirme: ansible_ocp_clusters alanlari ocp_cluster_index'e tasinir ──
    // Portalda IKI ayri OCP katalogu vardi: ocp_cluster_index (env/tenant/cluster_name —
    // LogX/OpsX/Telnet sihirbazlari) ve ansible_ocp_clusters (URL/token/jump_host — Ansible
    // Info ekrani + AI pod-status). Ortak anahtarlari yoktu. Asagidaki kolonlar ikinciyi
    // birincinin icinde temsil edebilmek icindir; hepsi NULL'lanabilir, mevcut satirlar
    // etkilenmez. `legacy_id` goc idempotentligini saglar (ayni satir iki kez tasinmaz).
    { table: 'ocp_cluster_index', col: 'display',           sql: `ALTER TABLE ocp_cluster_index ADD display NVARCHAR(150) NULL` },
    { table: 'ocp_cluster_index', col: 'api_url',           sql: `ALTER TABLE ocp_cluster_index ADD api_url NVARCHAR(500) NULL` },
    { table: 'ocp_cluster_index', col: 'console_url',       sql: `ALTER TABLE ocp_cluster_index ADD console_url NVARCHAR(500) NULL` },
    { table: 'ocp_cluster_index', col: 'token',             sql: `ALTER TABLE ocp_cluster_index ADD token NVARCHAR(MAX) NULL` },
    { table: 'ocp_cluster_index', col: 'description',       sql: `ALTER TABLE ocp_cluster_index ADD description NVARCHAR(MAX) NULL` },
    { table: 'ocp_cluster_index', col: 'default_namespace', sql: `ALTER TABLE ocp_cluster_index ADD default_namespace NVARCHAR(150) NULL` },
    { table: 'ocp_cluster_index', col: 'created_by',        sql: `ALTER TABLE ocp_cluster_index ADD created_by NVARCHAR(255) NULL` },
    { table: 'ocp_cluster_index', col: 'last_checked_at',   sql: `ALTER TABLE ocp_cluster_index ADD last_checked_at DATETIME2 NULL` },
    { table: 'ocp_cluster_index', col: 'connection_status', sql: `ALTER TABLE ocp_cluster_index ADD connection_status NVARCHAR(20) NULL` },
    { table: 'ocp_cluster_index', col: 'legacy_id',         sql: `ALTER TABLE ocp_cluster_index ADD legacy_id NVARCHAR(64) NULL` },
    // Ansible katalogunda tenant (platform) kavrami yoktu; ortak agacta yerini bulabilmesi
    // icin eklendi. Bos birakilirsa kayit '_atanmadi' tenant'i ile PASIF aynalanir.
    { table: 'ansible_ocp_clusters', col: 'tenant',         sql: `ALTER TABLE ansible_ocp_clusters ADD tenant NVARCHAR(100) NULL` },
    { table: 'ocp_cluster_index', col: 'source',            sql: `ALTER TABLE ocp_cluster_index ADD source NVARCHAR(20) NULL` },
    // ── OCP katalogunun AWX inventory dosyasindan bagimsizlastirilmasi ──────────
    // Playbook'lar cluster URL/parolasini AWX'teki openshift_inventory_vars.yaml'dan
    // okuyordu; artik URL portaldan gelir. PAROLA ASLA DB'YE GIRMEZ — yalnizca hangi
    // vault anahtarinin (credentials.yaml icindeki uxmid_gar / uxmid_das / uxmid_gtek ...)
    // kullanilacaginin ADI tutulur; playbook parolayi lookup('vars', <ad>) ile cozer.
    { table: 'ocp_cluster_index', col: 'vault_credential_key', sql: `ALTER TABLE ocp_cluster_index ADD vault_credential_key NVARCHAR(128) NULL` },
    // `oc login --username=...` degeri. Playbook'lar bunu AWX'teki
    // openshift_inventory_vars.yaml icindeki `username` degiskeninden okuyordu; o dosya
    // AWX'te YOK ve uretimde TUM cluster'lar "'username' is undefined" ile dustu
    // (2026-08-09). Artik cluster satirinin kendi degeri kullanilir; bos ise
    // Admin > OCP Calistirma Ayarlari'ndaki genel varsayilan devreye girer.
    { table: 'ocp_cluster_index', col: 'ocp_username',       sql: `ALTER TABLE ocp_cluster_index ADD ocp_username NVARCHAR(128) NULL` },
    // Periyodik besleme job'inin cluster basina son durumu (tanilama icin).
    { table: 'ocp_cluster_index', col: 'last_synced_at',     sql: `ALTER TABLE ocp_cluster_index ADD last_synced_at DATETIME2 NULL` },
    { table: 'ocp_cluster_index', col: 'sync_status',        sql: `ALTER TABLE ocp_cluster_index ADD sync_status NVARCHAR(32) NULL` },
    { table: 'ocp_cluster_index', col: 'sync_error',         sql: `ALTER TABLE ocp_cluster_index ADD sync_error NVARCHAR(1000) NULL` },
    // actions.md #13 (Bolum L) — Tablo Takma Adlari eksik alanlar.
    {
      table: 'inventory_table_aliases', col: 'schema_name',
      sql: `ALTER TABLE inventory_table_aliases ADD schema_name NVARCHAR(128) NULL`,
    },
    {
      table: 'inventory_table_aliases', col: 'description',
      sql: `ALTER TABLE inventory_table_aliases ADD description NVARCHAR(500) NULL`,
    },
    {
      table: 'inventory_table_aliases', col: 'is_active',
      sql: `ALTER TABLE inventory_table_aliases ADD is_active BIT NOT NULL DEFAULT 1`,
    },
    {
      table: 'inventory_table_aliases', col: 'language',
      sql: `ALTER TABLE inventory_table_aliases ADD language NVARCHAR(10) NOT NULL DEFAULT 'tr'`,
    },
    {
      table: 'inventory_table_aliases', col: 'sort_order',
      sql: `ALTER TABLE inventory_table_aliases ADD sort_order INT NOT NULL DEFAULT 0`,
    },
    // actions.md #14 (Bolum M) — rol override kaynagi/aciklamasi + soft-delete + denetim izi.
    {
      table: 'user_role_overrides', col: 'source_type',
      sql: `ALTER TABLE user_role_overrides ADD source_type NVARCHAR(20) NOT NULL DEFAULT 'manual'`,
    },
    {
      table: 'user_role_overrides', col: 'ldap_role',
      sql: `ALTER TABLE user_role_overrides ADD ldap_role NVARCHAR(50) NULL`,
    },
    {
      table: 'user_role_overrides', col: 'is_active',
      sql: `ALTER TABLE user_role_overrides ADD is_active BIT NOT NULL DEFAULT 1`,
    },
    {
      table: 'user_role_overrides', col: 'created_by',
      sql: `ALTER TABLE user_role_overrides ADD created_by NVARCHAR(255) NULL`,
    },
    {
      table: 'user_role_overrides', col: 'created_at',
      sql: `ALTER TABLE user_role_overrides ADD created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()`,
    },
    {
      table: 'user_role_overrides', col: 'description',
      sql: `ALTER TABLE user_role_overrides ADD description NVARCHAR(500) NULL`,
    },
    {
      table: 'user_role_overrides', col: 'last_applied_at',
      sql: `ALTER TABLE user_role_overrides ADD last_applied_at DATETIME2 NULL`,
    },
    // actions.md #15 (Bolum N) — kullanilmayan metadata JSON blob'u yerine gercek alanlar.
    {
      table: 'portal_elements', col: 'description',
      sql: `ALTER TABLE portal_elements ADD description NVARCHAR(500) NULL`,
    },
    {
      table: 'portal_elements', col: 'created_at',
      sql: `ALTER TABLE portal_elements ADD created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()`,
    },
    // actions.md #6 (Bolum E) — Nobet: dinamik kaynak + restart-hayatta-kalan kalici cache.
    {
      table: 'duty_roster', col: 'duty_group',
      sql: `ALTER TABLE duty_roster ADD duty_group NVARCHAR(100) NULL`,
    },
    {
      table: 'duty_roster', col: 'team',
      sql: `ALTER TABLE duty_roster ADD team NVARCHAR(100) NULL`,
    },
    {
      table: 'duty_roster', col: 'service',
      sql: `ALTER TABLE duty_roster ADD service NVARCHAR(100) NULL`,
    },
    {
      table: 'duty_roster', col: 'is_active',
      sql: `ALTER TABLE duty_roster ADD is_active BIT NOT NULL DEFAULT 1`,
    },
    {
      table: 'duty_roster', col: 'data_source',
      sql: `ALTER TABLE duty_roster ADD data_source NVARCHAR(20) NOT NULL DEFAULT 'manual'`,
    },
    // actions.md #5 (Bolum D) — selfservice_tabs artik sabit 'section' string'i yerine
    // gercek bir selfservice_groups satirina baglanir (bkz. server/selfservice/store.cjs
    // migrateSectionsToGroupsIfNeeded). 'section' kolonu SILINMEZ (geriye-donuk okuma icin).
    {
      table: 'selfservice_tabs', col: 'group_id',
      sql: `ALTER TABLE selfservice_tabs ADD group_id NVARCHAR(64) NULL`,
    },
    {
      table: 'selfservice_tabs', col: 'is_active',
      sql: `ALTER TABLE selfservice_tabs ADD is_active BIT NOT NULL DEFAULT 1`,
    },
    {
      table: 'selfservice_tabs', col: 'icon',
      sql: `ALTER TABLE selfservice_tabs ADD icon NVARCHAR(50) NULL`,
    },
    {
      table: 'selfservice_subtabs', col: 'is_active',
      sql: `ALTER TABLE selfservice_subtabs ADD is_active BIT NOT NULL DEFAULT 1`,
    },
    {
      table: 'selfservice_items', col: 'service_type',
      sql: `ALTER TABLE selfservice_items ADD service_type NVARCHAR(50) NULL`,
    },
    {
      table: 'selfservice_items', col: 'visibility',
      sql: `ALTER TABLE selfservice_items ADD visibility NVARCHAR(200) NOT NULL DEFAULT 'User,Admin'`,
    },
    {
      table: 'selfservice_items', col: 'is_active',
      sql: `ALTER TABLE selfservice_items ADD is_active BIT NOT NULL DEFAULT 1`,
    },
    {
      table: 'selfservice_items', col: 'awx_template_ref',
      sql: `ALTER TABLE selfservice_items ADD awx_template_ref INT NULL`,
    },
    {
      table: 'selfservice_items', col: 'awx_server_ref',
      sql: `ALTER TABLE selfservice_items ADD awx_server_ref INT NULL`,
    },
    {
      table: 'selfservice_items', col: 'form_schema_ref',
      sql: `ALTER TABLE selfservice_items ADD form_schema_ref NVARCHAR(255) NULL`,
    },
    {
      table: 'selfservice_items', col: 'permission_info',
      sql: `ALTER TABLE selfservice_items ADD permission_info NVARCHAR(500) NULL`,
    },
  ];

  for (const { table, col, sql } of alters) {
    try {
      const has = await pool.request().query(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${table}' AND COLUMN_NAME='${col}'`
      );
      if (!has.recordset.length) {
        await pool.request().query(sql);
        console.log(`[DB] Sutun eklendi: ${table}.${col}`);
      }
    } catch (err) {
      console.warn(`[DB] Sutun eklenemedi (${table}.${col}):`, err.message);
    }
  }

  // group_id sutunu yukaridaki alters dongusunde eklendikten SONRA calismali.
  await migrateSelfServiceSectionsToGroups(pool);

  // Column widening: audit hash sutunlari 'v2:' oneki + 64 hex = 67 karakter gerektirir
  // (v2 hash semasi — bkz. server/logx/audit.cjs)
  const widenings = [
    { table: 'logx_audit_logs', col: 'prev_hash',  minLen: 80 },
    { table: 'logx_audit_logs', col: 'entry_hash', minLen: 80 },
  ];
  for (const { table, col, minLen } of widenings) {
    try {
      const info = await pool.request().query(
        `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_NAME='${table}' AND COLUMN_NAME='${col}'`
      );
      const len = info.recordset[0]?.len;
      if (len != null && len > 0 && len < minLen) {
        await pool.request().query(`ALTER TABLE ${table} ALTER COLUMN ${col} NVARCHAR(${minLen})`);
        console.log(`[DB] Sutun genisletildi: ${table}.${col} → NVARCHAR(${minLen})`);
      }
    } catch (err) {
      console.warn(`[DB] Sutun genisletilemedi (${table}.${col}):`, err.message);
    }
  }

  // ── Performans index'leri (olcek — Sprint 4/D3) — idempotent (yoksa olustur) ────
  // Sik filtrelenen/siralanan sutunlar; tablo buyudukce (audit, download, job) sorgulari hizlandirir.
  const indexes = [
    { name: 'IX_audit_created',       table: 'logx_audit_logs',   cols: 'created_at DESC' },
    { name: 'IX_audit_user_created',  table: 'logx_audit_logs',   cols: 'username, created_at DESC' },
    { name: 'IX_dl_expires',          table: 'logx_v2_downloads', cols: 'expires_at' },
    { name: 'IX_dl_token',            table: 'logx_v2_downloads', cols: 'token' },
    { name: 'IX_dl_request',          table: 'logx_v2_downloads', cols: 'request_id' },
    { name: 'IX_opsxdl_expires',      table: 'opsx_dump_downloads', cols: 'expires_at' },
    { name: 'IX_opsxdl_token',        table: 'opsx_dump_downloads', cols: 'token' },
    { name: 'IX_jobs_request',        table: 'logx_v2_jobs',      cols: 'request_id' },
    { name: 'IX_req_state',           table: 'logx_v2_requests',  cols: 'state' },
    { name: 'IX_req_expires',         table: 'logx_v2_requests',  cols: 'expires_at' },
    { name: 'IX_paudit_created',      table: 'portal_audit_logs', cols: 'created_at DESC' },
    { name: 'IX_paudit_user_created', table: 'portal_audit_logs', cols: 'username, created_at DESC' },
    { name: 'IX_aimsg_conv',          table: 'ai_messages',       cols: 'conversation_id, id' },
    { name: 'IX_aiconv_user',         table: 'ai_conversations',  cols: 'username, updated_at DESC' },
    { name: 'IX_aiusage_created',     table: 'ai_usage_log',      cols: 'created_at DESC' },
    { name: 'IX_prefs_user',          table: 'portal_user_preferences', cols: 'username' },
    { name: 'IX_duty_date',           table: 'duty_roster',       cols: 'duty_date' },
    { name: 'IX_metrics_captured',    table: 'metrics_snapshots', cols: 'captured_at DESC' },
  ];
  for (const { name, table, cols } of indexes) {
    try {
      const exists = await pool.request().query(
        `SELECT 1 FROM sys.indexes WHERE name = '${name}' AND object_id = OBJECT_ID('${table}')`
      );
      if (!exists.recordset.length) {
        await pool.request().query(`CREATE INDEX ${name} ON ${table} (${cols})`);
        console.log(`[DB] Index olusturuldu: ${name} ON ${table} (${cols})`);
      }
    } catch (err) {
      console.warn(`[DB] Index olusturulamadi (${name}):`, err.message);
    }
  }

  // ── OCP katalogu ilk kurulumu — EN SONDA ────────────────────────────────────
  // Digerlerinden FARKLI olarak BIR KERELIK calisir (isaret: portal_settings). Sebep:
  // admin bir cluster'i bilerek silerse restart onu geri getirmemeli.
  // BURADA olmasi ZORUNLU: kullandigi kolonlar (api_url, vault_credential_key, source,
  // terminal_host) yukaridaki ALTER dongusunde ekleniyor; seed daha once calisirsa her
  // INSERT "Invalid column name" ile patlar ve katalog kalici olarak bos kalirdi.
  try {
    await require('./ocp-bootstrap-seed.cjs').seedOcpBootstrapOnce();
  } catch (e) {
    console.warn('[DB] OCP katalog seed atlandi:', e.message);
  }
}

module.exports = { setupTables };
