#!/usr/bin/env bash
# deploy/setup-rhel.sh — BMW Portal RHEL 8/9 sistem hazirligi (idempotent, root ile)
#
# Kullanim:  sudo bash deploy/setup-rhel.sh
# Yaptiklari: dizinler, firewalld, SELinux boolean'lari.
# Node kurulumu ve uygulama adimlari icin: docs/DEPLOYMENT.md
#
# Hedef yerlesim (gblabt02):
#   /vhosting8/bmw_portal/deploy/PORTAL-BMW-main.zip   ← surum zip'i buraya
#   /vhosting8/bmw_portal/app/PORTAL-BMW-main/          ← acilan uygulama agaci
# Uygulama 'was' kullanicisiyla calisir; kurumsal nginx 443 → 127.0.0.1:3000 proxy'ler.
set -euo pipefail

APP_USER="was"
BASE_DIR="/vhosting8/bmw_portal"

echo "── [1/4] Dizinler"
mkdir -p "$BASE_DIR"/{deploy,app}
chown -R "$APP_USER:$APP_USER" "$BASE_DIR" 2>/dev/null || true
echo "  OK $BASE_DIR/{deploy,app} hazir (sahip: $APP_USER)"

echo "── [2/4] firewalld"
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=https >/dev/null
  firewall-cmd --permanent --add-service=http >/dev/null   # 80→443 redirect icin
  firewall-cmd --reload >/dev/null
  echo "  OK 80/443 acik (:3000 SADECE localhost — kurumsal nginx proxy'ler, disari acilmaz)"
else
  echo "  ~ firewalld aktif degil, atlandi"
fi

echo "── [3/4] SELinux"
if command -v getenforce &>/dev/null && [ "$(getenforce)" != "Disabled" ]; then
  # nginx'in 127.0.0.1:3000 upstream'ine baglanabilmesi icin:
  setsebool -P httpd_can_network_connect on
  echo "  OK httpd_can_network_connect=on"
  # Not: Uygulama disari baglantilar da yapar (MSSQL 1453, LDAPS 636, MCP 443).
  # Node prosesi unconfined calistigi icin ek 'semanage port' genelde GEREKMEZ;
  # AVC denial gorulurse:  ausearch -m avc -ts recent | audit2why
else
  echo "  ~ SELinux kapali, atlandi"
fi

echo "── [4/4] Ozet"
cat <<EOF
  Sonraki adimlar (docs/DEPLOYMENT.md):
    1. Node 20+:   dnf module enable -y nodejs:20 && dnf install -y nodejs
    2. Zip'i kopyala:  cp PORTAL-BMW-main.zip $BASE_DIR/deploy/
    3. Surum yukle:    dzdo su - $APP_USER; cd $BASE_DIR; \\
                       app/PORTAL-BMW-main/deploy/release.sh prod
       (ilk kurulumda: unzip -o deploy/PORTAL-BMW-main.zip -d app/ && cd app/PORTAL-BMW-main
        && cp .env.example .env.prod && vi .env.prod && ./deploy/release.sh prod)
       release.sh, run.sh'i cagirarak baslatir; node_modules/dist eksikse otomatik kurar/insa eder.
    4. Kurumsal nginx zaten 443 → :3000 proxy'liyor (BMW_Portal-D.conf) — referans:
       deploy/BMW_Portal-D.conf (canli dosyaya dokunulmaz).
    5. KALICI CALISMA (crash + reboot kurtarma) — HANGISI, root erisimine gore secilir:
       - Root/sudo YOKSA: ./deploy/install-cron.sh prod
         (cron: @reboot otomatik acilir, 2 dk'da bir watchdog crash kontrolu yapar)
       - Root/sudo VARSA: sudo cp deploy/bmw-portal@.service /etc/systemd/system/ && \\
         sudo systemctl daemon-reload && sudo systemctl enable --now bmw-portal@prod
         (bu durumda deploy/run.sh KULLANILMAZ — dogrudan systemctl start/stop/status)
       Ikisini AYNI ortam icin BIRLIKTE kullanmayin — bkz. docs/DEPLOYMENT.md.
EOF
echo "OK Sistem hazirligi tamam."
