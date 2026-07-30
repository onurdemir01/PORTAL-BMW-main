> **ARSIV** — Eski calisma not defteri (ham terminal ciktilari). Guncel dokumanlar: ../DEPLOYMENT.md, ../DATABASE.md, ../SETUP-SIMPLE.md.

öncelikle bütün yapıyı codu amacı git commitlerini her şeyi analiz et zaten buraya kadar da her şeyi sen yazmıştın. bunu tekrardan incele. daha sonrada aşağıdaki adımları bilgileri ve isterleri incele ve pşanalr ve tasklar oluştur.
---
[gblabt02]/usr/nginx/conf.d$pwd
/usr/nginx/conf.d
[gblabt02]/usr/nginx/conf.d$cat BMW_Portal-D.conf
server {
listen 10.151.162.147:443 ssl;
http2 on;
server_name bmwportal-d.fw.garanti.com.tr;
ssl_certificate /usr/nginx/ssl/wildcard.fw.garantibbva.com.tr.crt;
ssl_certificate_key /usr/nginx/ssl/wildcard.fw.garantibbva.com.tr.key;

access_log /portal-bmw-nginx.log bmw;
error_log /web_log/portal-error.log;

  location / {
    proxy_pass http://10.151.162.147:3000/;
  }
}
[gblabt02]/usr/nginx/conf.d$cat ../nginx.conf
user www;
worker_processes auto;
pid /usr/nginx/run/nginx.pid;

load_module modules/ngx_http_headers_more_filter_module.so;

events {
    worker_connections 12000;
}

http {
    include /usr/nginx/mime.types;
    include /usr/nginx/conf/custom.conf;
    include /usr/nginx/conf/bmw_defaults.conf;
    include /usr/nginx/conf/proxy_settings.conf;
    include /usr/nginx/conf/rate_limits.conf;
    include /usr/nginx/conf/log_format.conf;
    include /usr/nginx/conf.d/*.conf;
}[gblabt02]/usr/nginx/conf.d$


BENİM NGİNX BU ŞEKİLDE KURULSAL YAPIYI BOZMADAN EKLEMELERİNİ YAP

---
---
[was@gblabt02]/home/was>cd /vhosting8/
[was@gblabt02]/vhosting8>ls -lrti
total 0
131 drwxrwxr-x 3 was was 24 Feb 23 10:25 scripts
137 drwxrwxr-x 2 was was  6 May 12 09:54 backup
132 drwxrwxr-x 4 was was 31 Jul 14 18:59 bmw_portal
[was@gblabt02]/vhosting8>cd bmw_portal/
[was@gblabt02]/vhosting8/bmw_portal>pwd
/vhosting8/bmw_portal
[was@gblabt02]/vhosting8/bmw_portal>l s-lrti
-bash: l: command not found
[was@gblabt02]/vhosting8/bmw_portal>l s-lrti
-bash: l: command not found
[was@gblabt02]/vhosting8/bmw_portal>ls -lrti
total 0
33575040 drwxrwxrwx 3 was was 29 Jul 14 19:01 app
16777355 drwxrwxr-x 2 was was 33 Jul 18 21:32 deploy
[was@gblabt02]/vhosting8/bmw_portal>pwd
/vhosting8/bmw_portal
[was@gblabt02]/vhosting8/bmw_portal>cd deploy/
[was@gblabt02]/vhosting8/bmw_portal/deploy>ls -lrti
total 956
16779909 -rwxrwxr-x 1 was was 975417 Jul 18 21:32 PORTAL-BMW-main.zip
[was@gblabt02]/vhosting8/bmw_portal/deploy>cd .
[was@gblabt02]/vhosting8/bmw_portal/deploy>cd ..
[was@gblabt02]/vhosting8/bmw_portal>pwd
/vhosting8/bmw_portal
[was@gblabt02]/vhosting8/bmw_portal>cd app/
[was@gblabt02]/vhosting8/bmw_portal/app>ls -lrti
total 0
50331776 drwxrwxrwx 3 was was 159 Jul 18 21:32 PORTAL-BMW-main
[was@gblabt02]/vhosting8/bmw_portal/app>cd PORTAL-BMW-main/
[was@gblabt02]/vhosting8/bmw_portal/app/PORTAL-BMW-main>ls -lrti
total 252
50331915 -rw-rw-r-- 1 was was 132336 Jul 18 21:24  guides.md
50331914 -rw-rw-r-- 1 was was   2995 Jul 18 21:24  fw_izinler.txt
50331916 -rw-rw-r-- 1 was was 113658 Jul 18 21:24 'Ekran görüntüsü 2026-07-18 150702.png'
     134 drwxrwxr-x 9 was was   4096 Jul 18 21:38  bmw-portal-project-management-dashboard
[was@gblabt02]/vhosting8/bmw_portal/app/PORTAL-BMW-main>pwd
/vhosting8/bmw_portal/app/PORTAL-BMW-main
[was@gblabt02]/vhosting8/bmw_portal/app/PORTAL-BMW-main>cd bmw-portal-project-management-dashboard/
[was@gblabt02]/vhosting8/bmw_portal/app/PORTAL-BMW-main/bmw-portal-project-management-dashboard>ls -lrti
total 268
     141 -rw-rw-r--   1 was was    396 Jul 12 01:48 docker-compose.yml
    3207 -rw-rw-r--   1 was was   2277 Jul 18 21:24 vite.config.ts
    3206 -rw-rw-r--   1 was was    636 Jul 18 21:24 tsconfig.json
     171 -rw-rw-r--   1 was was  12341 Jul 18 21:24 setup.ps1
     139 -rw-rw-r--   1 was was  10865 Jul 18 21:24 README.md
     144 -rw-rw-r--   1 was was   1786 Jul 18 21:24 package.json
     142 -rw-rw-r--   1 was was    306 Jul 18 21:24 metadata.json
     136 -rw-rw-r--   1 was was   4388 Jul 18 21:24 Jenkinsfile
     140 -rw-rw-r--   1 was was   1024 Jul 18 21:24 index.html
16777356 drwxrwxr-x   2 was was    121 Jul 18 21:32 deploy
33575041 drwxrwxr-x   2 was was   4096 Jul 18 21:32 docs
50331780 drwxrwxr-x   2 was was   4096 Jul 18 21:32 scripts
     146 drwxrwxr-x  20 was was   4096 Jul 18 21:32 server
33575067 drwxrwxr-x  13 was was   4096 Jul 18 21:32 src
     138 drwxrwxr-x 234 was was  16384 Jul 18 21:35 node_modules
     143 -rw-rw-r--   1 was was 173316 Jul 18 21:35 package-lock.json
50390735 drwxrwxr-x   3 was was     38 Jul 18 21:35 dist
[was@gblabt02]/vhosting8/bmw_portal/app/PORTAL-BMW-main/bmw-portal-project-management-dashboard>cat .env.
cat: .env.: No such file or directory
[was@gblabt02]/vhosting8/bmw_portal/app/PORTAL-BMW-main/bmw-portal-project-management-dashboard>cat .env.local 
# Server
PORT=5055
NODE_ENV=development


# Local fallback users
LOCAL_ADMIN_USER=admin
LOCAL_ADMIN_PASS=admin
LOCAL_USER=user
LOCAL_USER_PASS=user

#  Portal DB
PORTAL_DB_SERVER=10.230.111.44
PORTAL_DB_PORT=1453
PORTAL_DB_DATABASE=TBMWANS
PORTAL_DB_USER=TBMWANS_usr
PORTAL_DB_PASSWORD=

# MSSQL (Inventory)
MSSQL_SERVER=10.230.111.44
MSSQL_PORT=1453
MSSQL_DATABASE=TBMWANS
MSSQL_USER=TBMWANS_usr
MSSQL_PASSWORD=

# LDAP/LDAPS Authentication
LDAP_ENABLED=true
LDAP_URL=ldaps://adds.fw.garanti.com.tr:636
LDAP_BASE_DN=DC=fw,DC=garanti,DC=com,DC=tr
LDAP_BIND_DN=CN=srv_sentryldap,OU=Service Users,OU=System Users,OU=All Users,DC=fw,DC=garanti,DC=com,DC=tr
LDAP_BIND_PASSWORD=
LDAP_USER_FILTER=sAMAccountName
AUTH_LDAP_SEARCH_ATTR=sAMAccountName
LDAP_GROUP_ADMIN_DN=
LDAP_CA_CERT_PATH=server/certs/ldap/ca-chain.pem
LDAP_REJECT_UNAUTHORIZED=true


# Ansible AWX (AWX_1..AWX_9)
AWX_1_NAME=Maestro
AWX_1_URL=https://maestro/
AWX_1_USER=uxmid
AWX_1_PASSWORD=

AWX_2_NAME=Maestro 2
AWX_2_URL=https://maestro2/
AWX_2_USER=uxmid
AWX_2_PASSWORD=

#  Ansible AWX 
AWX_URL=https://maestro2/
AWX_USER=uxmid
AWX_PASSWORD=

#  LogX v2
AWX_LOGX_SERVER_ID=2
AWX_LOGX_LEGACY_DISCOVERY_TEMPLATE_ID=2139
AWX_LOGX_LEGACY_TRANSFER_TEMPLATE_ID=2140
AWX_LOGX_OCP_NAMESPACE_DISCOVERY_TEMPLATE_ID=2142
AWX_LOGX_OCP_DISCOVER_FETCH_TEMPLATE_ID=2141
LOGX_V2_STAGING_LEGACY_DIR=/sw/BMW_PORTAL/logs/legacy
LOGX_V2_STAGING_OCP_DIR=/sw/BMW_PORTAL/logs/ocp
LOGX_STAGING_FALLBACK_DIR=/tmp/logx-v2-fallback

#  NOBETCI API
NOBETCI_TEAM_ID=1731069488613
NOBETCI_TEAM_TYPE=CUSTOM
NOBETCI_TEAM_NAME=GT-Agile BMW
NOBETCI_API_URL=https://gbnys.fw.garanti.com.tr/api/nobetkayit/list/1731069488613/CUSTOM


#  Dynatrace MANAGED MCP 
DT_MANAGED_MCP_URL=https://dynatrace-mcp.apps-3rd-t.fw.garanti.com.tr/mcp
DT_DEFAULT_ENV_ALIAS=garanti-managed-test

#  Instana MCP ¦
# Ortam seçi her istekte header ile yapýtoken + base-url):
INSTANA_MCP_URL=https://instana-mcp.apps-3rd-t.fw.garanti.com.tr/mcp
INSTANA_API_TOKEN_NONPROD=
INSTANA_BASE_URL_NONPROD=https://nonprod-gt.instana.apps.gbocpinstest2.fw.garanti.com.tr
INSTANA_API_TOKEN_PROD=
INSTANA_BASE_URL_PROD=https://prod-gt.instana.apps.gbocpinsprod2.fw.garanti.com.tr
CORP_CA_CERT_PATH=server/certs/openai/combined-ca-chain.pem


# AI Log Analysis
AI_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

# Session
SESSION_SECRET=
[was@gblabt02]/vhosting8/bmw_portal/app/PORTAL-BMW-main/bmw-portal-project-management-dashboard>

burada şifreler var ve çalışıyor düşün buna göre ideal .env.dev .env.test. .env.qa dosyaları olsun.
---
---
bu şekilde de hatalı düzeltmeli bvs kurulumu da yaptım

Last login: Sat Jul 18 12:38:53 2026 from 10.240.6.205
[gblabt02]~$dzdo su - was
Last login: Sat Jul 18 12:47:03 +03 2026 on pts/3
cd [was@gblabt02]/home/was>cd /vhosting8/
backup/         bmw_portal_hkn/ scripts/        
[was@gblabt02]/home/was>cd /vhosting8/bmw_portal_hkn/
[was@gblabt02]/vhosting8/bmw_portal_hkn>cd .
[was@gblabt02]/vhosting8/bmw_portal_hkn>cd  ..
[was@gblabt02]/vhosting8>ls -lrti
total 0
131 drwxrwxr-x 3 was was 24 Feb 23 10:25 scripts
137 drwxrwxr-x 2 was was  6 May 12 09:54 backup
132 drwxrwxr-x 4 was was 31 Jul 14 18:59 bmw_portal_hkn
[was@gblabt02]/vhosting8>mv bmw_portal_hkn/ bmw_portal
[was@gblabt02]/vhosting8>ls -lrti
total 0
131 drwxrwxr-x 3 was was 24 Feb 23 10:25 scripts
137 drwxrwxr-x 2 was was  6 May 12 09:54 backup
132 drwxrwxr-x 4 was was 31 Jul 14 18:59 bmw_portal
[was@gblabt02]/vhosting8>cd bmw_portal/
[was@gblabt02]/vhosting8/bmw_portal>ls -rlti
total 0
33575040 drwxrwxrwx 3 was was 29 Jul 14 19:01 app
16777355 drwxrwxr-x 2 was was 64 Jul 18 15:55 deploy
[was@gblabt02]/vhosting8/bmw_portal>cd deploy/
[was@gblabt02]/vhosting8/bmw_portal/deploy>ls
PORTAL-BMW-main_2.zip  PORTAL-BMW-main_3.zip
[was@gblabt02]/vhosting8/bmw_portal/deploy>rm -rf ./*
[was@gblabt02]/vhosting8/bmw_portal/deploy>rm -rf /tmp/PORTAL-BMW-main*
rm: cannot remove '/tmp/PORTAL-BMW-main_2.zip': Operation not permitted
rm: cannot remove '/tmp/PORTAL-BMW-main_3.zip': Operation not permitted
rm: cannot remove '/tmp/PORTAL-BMW-main.zip': Operation not permitted
[was@gblabt02]/vhosting8/bmw_portal/deploy>logout
[gblabt02]~$rm -rf /tmp/PORTAL-BMW-main*
[gblabt02]~$dzdo su - was
Last login: Sat Jul 18 21:28:48 +03 2026 on pts/3
CD[was@gblabt02]/home/was>CD ^C
[was@gblabt02]/home/was>cd ^C
[was@gblabt02]/home/was>logout
[gblabt02]~$chmod 777 /tmp/PORTAL-BMW-main.zip 
[gblabt02]~$dzdo su - was
Last login: Sat Jul 18 21:30:34 +03 2026 on pts/3
[was@gblabt02]/home/was>CD ^C
[was@gblabt02]/home/was>cd /vhosting8/bmw_portal/deploy
[was@gblabt02]/vhosting8/bmw_portal/deploy> cp /tmp/PORTAL-BMW-main.zip .
[was@gblabt02]/vhosting8/bmw_portal/deploy>cd ..
[was@gblabt02]/vhosting8/bmw_portal>unzip -o deploy/PORTAL-BMW-main.zip -d app/Archive:  deploy/PORTAL-BMW-main.zip
9233b16ee019dff2cef9258e9a4f4e74b726af43
 extracting: app/PORTAL-BMW-main/.gitignore  
  inflating: app/PORTAL-BMW-main/Ekran gÃ¶rÃ¼ntÃ¼sÃ¼ 2026-07-18 150702.png  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/.env.example  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/.gitignore  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/Jenkinsfile  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/README.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/deploy/bmw-portal.service  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/deploy/nginx-bmw-fe.conf  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/deploy/nginx-bmw-portal.conf  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/deploy/run.sh  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/deploy/setup-rhel.sh  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/docs/AI-INTEGRATION-ROADMAP.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/docs/DEPLOYMENT.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/docs/LOGX-V2-PLAYBOOKS.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/docs/MCP-SETUP.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/docs/MINDMAP.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/docs/NETWORK-HARDENING-BACKLOG.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/docs/PLATFORM-EXPANSION-ROADMAP.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/docs/PLAYBOOK-REGISTRY.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/docs/QUICK-SOLVER.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/docs/SCALABILITY.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/docs/SETUP-SIMPLE.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/docs/TLS-SETUP.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/docs/TOPOLOGY.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/index.html  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/metadata.json  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/package-lock.json  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/package.json  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/scripts/build-ca-bundle.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/scripts/deploy.sh  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/scripts/devlog.ps1  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/scripts/devlog.sh  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/scripts/fetch-ca.ps1  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/scripts/fetch-ca.sh  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/scripts/fetch-mcp-ca.sh  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/scripts/standardize-src.mjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/scripts/test-dt-mcp.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/scripts/test-instana-mcp.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/scripts/test-tls.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/admin/system-config.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ai-analyst/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ai-analyst/orchestrator.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ai-analyst/portal-tools.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ai/ca.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ai/provider.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/LOGX_ANSIBLE_SETUP.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/NEEDS.md  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/index.cjs  
 extracting: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/ocp-clusters.json  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/ocp-store.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbook-registry.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/check_jboss_services.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/disk_usage_status.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/gather_server_facts.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/jvm_heap_status.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/logx_legacy_discovery.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/logx_legacy_transfer.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/logx_ocp_discover_fetch.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/logx_ocp_namespace_discovery.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/network_connectivity_check.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/nginx_status.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/ocp_pod_status.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/service_status_check.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/system_health_overview.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/view_jboss_logs.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/playbooks/web_server_status.yml  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/ansible/runner.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/auth/__tests__/session-store.test.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/auth/__tests__/visibility.test.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/auth/elements.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/auth/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/auth/ldap.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/auth/mssql-session-store.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/auth/utils.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/auth/visibility.cjs  
 extracting: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/data/duty-roster.json  
 extracting: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/data/inventory-saved-queries.json  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/data/selfservice.json  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/db/__tests__/adapter.test.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/db/config-mirror.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/db/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/db/migrate.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/db/mssql-setup.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/db/portal-mssql.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/db/seed.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/dynatrace/cache.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/dynatrace/client.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/dynatrace/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/instana/client.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/instana/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/inventory/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/inventory/mssql.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/kibana/client.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/kibana/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/links/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/ai-analyzer.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/audit.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/inventory.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/masker.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/__tests__/admin-conflict.test.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/__tests__/downloads-resolver.test.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/__tests__/ingest.test.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/__tests__/logxv2.test.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/__tests__/persistence.test.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/admin.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/cleanup.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/downloads.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/ingest.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/jobs.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/legacy.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/ocp.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/requests.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/logx/v2/restrictions.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/mcp/client.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/mcp/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/metrics.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/selfservice/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/selfservice/store.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/service.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/splunk/client.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/splunk/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/tasks/index.cjs  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/setup.ps1  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/App.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/adminApi.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/aiAnalystApi.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/ansibleApi.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/dutyRosterApi.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/dynatraceApi.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/instanaApi.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/inventoryApi.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/linksApi.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/logxApi.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/logxV2Api.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/nobetciApi.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/playbookRegistryApi.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/selfServiceApi.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/splunkApi.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/api/taskApi.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/DashboardPage.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/DutyRosterPage.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/EnvanterPage.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/ForbiddenPage.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/Gate.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/GorevPage.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/ImportantLinksPage.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/LoginPage.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/SelfServicePage.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/SessionTimeoutModal.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/Sidebar.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/admin/AdminPage.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/admin/tabs/AnsibleConfigTab.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/admin/tabs/AuditLogTab.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/admin/tabs/LogXv2AdminTab.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/admin/tabs/NobetAdminTab.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/admin/tabs/PageVisibilityTab.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/admin/tabs/PlaybookRegistryTab.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/admin/tabs/SelfServiceAdminTab.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/admin/tabs/SystemConfigTab.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/admin/tabs/TasksAdminTab.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/admin/tabs/UserManagementTab.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/admin/tabs/logxv2/SimpleCrudTable.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/ai_analyst/AiAnalystPage.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/ai_analyst/LogAnalysisPanel.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/ansible/AnsiblePage.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/AnsibleLogTerminal.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/Badge.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/Button.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/Card.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/Collapse.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/CommandPalette.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/EmptyState.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/HelpModal.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/Modal.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/PortalLogo.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/SectionHeader.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/StatTile.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/Tabs.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/Toast.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/common/Tooltip.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/dashboard/MissionOrbit.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/dashboard/TechFactCard.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/dynatrace/DynatracePage.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/envanter/ColumnFilterDropdown.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/envanter/ColumnPicker.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/envanter/DynamicTable.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/envanter/FilterBar.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/envanter/QueryPanel.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/login/ArtisticBackdrop.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/login/LoginBackgroundCanvas.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/logx_v2/LogXWizardPage.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/logx_v2/shared/DownloadStep.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/logx_v2/shared/JobProgress.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/logx_v2/steps/PlatformStep.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/logx_v2/steps/legacy/AppSearchStep.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/logx_v2/steps/legacy/FileSelectionStep.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/logx_v2/steps/ocp/AppNameStep.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/logx_v2/steps/ocp/ClusterSelectStep.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/logx_v2/steps/ocp/NamespacePickerStep.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/logx_v2/steps/ocp/NamespaceStep.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/self_service/FieldOverridesModal.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/self_service/SelfServiceItemModal.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/self_service/SimpleNameModal.tsx  
   creating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/ui/
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/components/ui/Form.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/config/elements.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/contexts/AppContext.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/contexts/AuthContext.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/contexts/ThemeContext.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/data/techFacts.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/hooks/useCommandPalette.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/hooks/useToast.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/index.css  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/index.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/layouts/AppLayout.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/routes/AdminRoute.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/routes/PageVisibilityRoute.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/routes/ProtectedRoute.tsx  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/styles/animations.css  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/types.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/types/react-dom.d.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/utils/aiHandoff.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/utils/statusColor.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/src/utils/url.ts  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/tsconfig.json  
  inflating: app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/vite.config.ts  
  inflating: app/PORTAL-BMW-main/fw_izinler.txt  
  inflating: app/PORTAL-BMW-main/guides.md  
[was@gblabt02]/vhosting8/bmw_portal>cd app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/
[was@gblabt02]/vhosting8/bmw_portal/app/PORTAL-BMW-main/bmw-portal-project-management-dashboard>npm run dev:all

> bmw-portal-project-management-dashboard@1.0.0 dev:all
> concurrently -n SERVER,WEB -c auto "npm run server" "npm run dev"

[SERVER] 
[SERVER] > bmw-portal-project-management-dashboard@1.0.0 server
[SERVER] > node server/index.cjs
[SERVER] 
[WEB] 
[WEB] > bmw-portal-project-management-dashboard@1.0.0 dev
[WEB] > vite
[WEB] 
[SERVER] â—‡ injected env (65) from .env.local // tip: âŒ auth for agents [www.vestauth.com]
[SERVER] â—‡ injected env (0) from .env // tip: âŒ˜ custom filepath { path: '/custom/path/.env' }
[WEB] 
[WEB]   VITE v6.4.3  ready in 875 ms
[WEB] 
[WEB]     Local:   http://localhost:3000/
[WEB]     Network: http://10.151.162.147:3000/
[SERVER] [CA] TLS gÃ¼ven deposu hazÄ±rlandÄ±: {
[SERVER]   caPath: '/vhosting8/bmw_portal/app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/certs/openai/combined-ca-chain.pem',
[SERVER]   publicRoots: 144,
[SERVER]   corporatePemBlocks: 6,
[SERVER]   addedCorporateCertificates: 6,
[SERVER]   totalCertificates: 150
[SERVER] }
[SERVER] [AI] TLS gÃ¼ven deposu: {
[SERVER]   caPath: '/vhosting8/bmw_portal/app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/certs/openai/combined-ca-chain.pem',
[SERVER]   publicRoots: 144,
[SERVER]   corporatePemBlocks: 6,
[SERVER]   addedCorporateCertificates: 6,
[SERVER]   rejectUnauthorized: true
[SERVER] }
[SERVER] [Auth] module mounted at /api/auth
[SERVER] [SystemConfig] admin env endpoints mounted at /api/admin/system-config
[SERVER] [Ansible] module mounted at /api/ansible (AWX: configured)
[SERVER] [SelfService] module mounted at /api/selfservice
[SERVER] [LogX] module mounted at /api/logx (v1 â€” yalnÄ±zca inventory/audit/playbook-run)
[SERVER] [LogXv2] module mounted at /api/logx/v2
[SERVER] [Inventory] module mounted at /api/inventory
[SERVER] [Tasks] Routes registered.
[SERVER] [Links] module mounted at /api/links
[SERVER] [MCP] generic endpoints mounted at /api/mcp/:server
[SERVER] [AI-Analyst] module mounted at /api/ai-analyst
[SERVER] [Metrics] /api/metrics-lite (admin) mounted
[SERVER] [Server] listening on :3000  Â·  ortam=(APP_ENV yok â€” .env.local/.env)  Â·  NODE_ENV=development
[SERVER] [Inventory] MSSQL baÄŸlantÄ±sÄ± kuruldu.
[SERVER] [PortalDB] BaÄŸlantÄ± kuruldu: 10.230.111.44 / TBMWANS
[WEB] 9:37:04 PM [vite] http proxy error: /api/auth/login
[WEB] Error: connect ECONNREFUSED 127.0.0.1:5055
[WEB]     at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16)
^C[SERVER] npm run server exited with code 130
[WEB] npm run dev exited with code 130
[was@gblabt02]/vhosting8/bmw_portal/app/PORTAL-BMW-main/bmw-portal-project-management-dashboard>vi .env.^C
[was@gblabt02]/vhosting8/bmw_portal/app/PORTAL-BMW-main/bmw-portal-project-management-dashboard>vi .env.local 
[was@gblabt02]/vhosting8/bmw_portal/app/PORTAL-BMW-main/bmw-portal-project-management-dashboard>npm run dev:all

> bmw-portal-project-management-dashboard@1.0.0 dev:all
> concurrently -n SERVER,WEB -c auto "npm run server" "npm run dev"

[WEB] 
[WEB] > bmw-portal-project-management-dashboard@1.0.0 dev
[WEB] > vite
[WEB] 
[SERVER] 
[SERVER] > bmw-portal-project-management-dashboard@1.0.0 server
[SERVER] > node server/index.cjs
[SERVER] 
[SERVER] â—‡ injected env (65) from .env.local // tip: âŒ˜ multiple files { path: ['.env.local', '.env'] }
[SERVER] â—‡ injected env (0) from .env // tip: â—ˆ secrets for agents [www.dotenvx.com]
[SERVER] [CA] TLS gÃ¼ven deposu hazÄ±rlandÄ±: {
[SERVER]   caPath: '/vhosting8/bmw_portal/app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/certs/openai/combined-ca-chain.pem',
[SERVER]   publicRoots: 144,
[SERVER]   corporatePemBlocks: 6,
[SERVER]   addedCorporateCertificates: 6,
[SERVER]   totalCertificates: 150
[SERVER] }
[SERVER] [AI] TLS gÃ¼ven deposu: {
[SERVER]   caPath: '/vhosting8/bmw_portal/app/PORTAL-BMW-main/bmw-portal-project-management-dashboard/server/certs/openai/combined-ca-chain.pem',
[SERVER]   publicRoots: 144,
[SERVER]   corporatePemBlocks: 6,
[SERVER]   addedCorporateCertificates: 6,
[SERVER]   rejectUnauthorized: true
[SERVER] }
[WEB] 
[WEB]   VITE v6.4.3  ready in 762 ms
[WEB] 
[WEB]     Local:   http://localhost:3000/
[WEB]     Network: http://10.151.162.147:3000/
[SERVER] [Auth] module mounted at /api/auth
[SERVER] [SystemConfig] admin env endpoints mounted at /api/admin/system-config
[SERVER] [Ansible] module mounted at /api/ansible (AWX: configured)
[SERVER] [SelfService] module mounted at /api/selfservice
[SERVER] [LogX] module mounted at /api/logx (v1 â€” yalnÄ±zca inventory/audit/playbook-run)
[SERVER] [LogXv2] module mounted at /api/logx/v2
[SERVER] [Inventory] module mounted at /api/inventory
[SERVER] [Tasks] Routes registered.
[SERVER] [Links] module mounted at /api/links
[SERVER] [MCP] generic endpoints mounted at /api/mcp/:server
[SERVER] [AI-Analyst] module mounted at /api/ai-analyst
[SERVER] [Metrics] /api/metrics-lite (admin) mounted
[SERVER] [Server] listening on :5055  Â·  ortam=(APP_ENV yok â€” .env.local/.env)  Â·  NODE_ENV=development
[SERVER] [Inventory] MSSQL baÄŸlantÄ±sÄ± kuruldu.
[SERVER] [PortalDB] BaÄŸlantÄ± kuruldu: 10.230.111.44 / TBMWANS
[SERVER] [Nobetci] BaÄŸlanÄ±yor: gbnys.fw.garanti.com.tr:443/api/nobetkayit/list/1731069488613/CUSTOM
[SERVER] [MCP:dynatrace] BaÄŸlantÄ± hatasÄ± (https://dynatrace-mcp.apps-3rd-t.fw.garanti.com.tr/mcp): [MCP:dynatrace] undici yÃ¼klenemedi: webidl.util.markAsUncloneable is not a function
[SERVER] [slow] GET /api/dynatrace/health 643ms
[SERVER] [AWX:Maestro] Yeni token alÄ±ndÄ±, expire: 3025-11-18T18:39:17.044546Z
[SERVER] [slow] GET /api/ansible/templates/1 1619ms
[SERVER] [AWX:Maestro 2] Yeni token alÄ±ndÄ±, expire: 3025-11-18T18:39:27.815386Z
[SERVER] [slow] GET /api/ansible/survey/2/1760 1277ms
[SERVER] [slow] POST /api/ansible/launch-ss/2/1760 836ms
[SERVER] [slow] GET /api/ansible/ss/job-status/2/3150189 1009ms
[SERVER] [slow] GET /api/ansible/ss/job-status/2/3150189 619ms
[SERVER] [slow] GET /api/ansible/ss/job-status/2/3150189 547ms
[SERVER] [slow] GET /api/ansible/survey/1/1289 594ms
[SERVER] [slow] GET /api/ansible/survey/1/1289 591ms
[SERVER] [MCP:dynatrace] BaÄŸlantÄ± hatasÄ± (https://dynatrace-mcp.apps-3rd-t.fw.garanti.com.tr/mcp): [MCP:dynatrace] undici yÃ¼klenemedi: webidl.util.markAsUncloneable is not a function
[SERVER] [slow] POST /legacy/7CB02E0B-1F36-49B6-B293-A54005B9A3AB/discover 2302ms
[SERVER] [slow] POST /legacy/7CB02E0B-1F36-49B6-B293-A54005B9A3AB/transfer 2278ms

---
---
yapıyı gördüm buna göre repomuun dizin yapı ilşkisinini tree yapısını düzenle
artık unzip yapıp ne yapayım nereleri ne şekilde düzenleyelim belirle
---
---

her bilgi db de tutulmalı ben npm run bozum tekrar çalıştırdığı her şeyi olduğu gibi aynı görmek isterim kayıtlardan sayfa görünümlerine kadar her şeyi anynı isterim ben sana bir iki nokta söyledim sen bunu her şey için geçerli olacak şekilde uygula yap.

---

bütün yapıyı türkçe karakterlerden kurtar yani dosya dizin log yorum olarak türkçe karakter olmasın

----

bütü md dosyalarını örnek conf dosyalarını vs vs lerii incele en güncel. halleri,ne en basit hallerine getir. 


---

ayrıca en basit şekilde admin ekranında olan ya da herhangi bir ekranda olan düzenleme değişiklik kayıt npm run sessionı bitince gitmesin. uygulama restart edildiğinde bunların kaybolmasını istemiyorum. eksik bütün db tablolarını mssql üzerinde portal db üzerinde oluştur. çekinme her şey için db tablosu oluşturabiliriz. her şeyi dbye yazıp silmeliyiz ui üzerinden bunları kaydet editle sil yapsak bile db ile konuşabilir olmalı yani her şey dbden gelmeli db upfate edilmeli her dosyayı dolaş her şeyi incele bunu her yere uygulamamız lazım. ben versiyon güncelledikçe restart reboot attıkça herhangi bir şey kaybetmek tekrar dğzenlemek eklemek silmek vs vs istemiyorum ve bunu en ufak bir şey için bile istemiyorum.

----
buna göre bütün tasklarını planla
