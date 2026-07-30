#!/usr/bin/env bash
# deploy/release.sh — BMW Portal sunucu tarafi surum yukleme (gblabt02, kullanici: was).
#
# Akis (zip → unzip → ci → build → start):
#   1. /vhosting8/bmw_portal/deploy/PORTAL-BMW-main.zip beklenir (once oraya kopyalayin)
#   2. Calisan ortam durdurulur
#   3. Mevcut app agacinin yedegi alinir (deploy/backup-<ts>) — son 3 yedek tutulur
#   4. Zip app/ altina acilir (unzip -o)
#   5. npm ci + npm run build
#   6. deploy/run.sh <env> start
#
# Kullanim:
#   ./deploy/release.sh <dev|test|qa|prod>
#
# NOT: Tum kalici veri MSSQL'dedir (TBMWANS) — app dizinini ezmek/silmek veri
# kaybetmez. .env.<env> dosyalari zip icinde YOKTUR (gitignore) — app dizininde
# elle korunur; yedekten geri kopyalanir.
set -euo pipefail

BASE_DIR="/vhosting8/bmw_portal"
DEPLOY_DIR="$BASE_DIR/deploy"
APP_DIR="$BASE_DIR/app"
ZIP_FILE="$DEPLOY_DIR/PORTAL-BMW-main.zip"
APP_ROOT="$APP_DIR/PORTAL-BMW-main"
KEEP_BACKUPS=3

ENV_NAME="${1:-}"
case "$ENV_NAME" in dev|test|qa|prod) ;; *) echo "Kullanim: $0 <dev|test|qa|prod>" >&2; exit 2 ;; esac

[[ -f "$ZIP_FILE" ]] || { echo "HATA: $ZIP_FILE yok — once zip'i deploy/ altina kopyalayin." >&2; exit 1; }
command -v node >/dev/null || { echo "HATA: node bulunamadi." >&2; exit 1; }
command -v unzip >/dev/null || { echo "HATA: unzip bulunamadi." >&2; exit 1; }

TS="$(date +%Y%m%d-%H%M%S)"

# 1) Calisan ortami durdur (run.sh varsa)
if [[ -x "$APP_ROOT/deploy/run.sh" ]]; then
  "$APP_ROOT/deploy/run.sh" "$ENV_NAME" stop || true
fi

# 2) Yedek al (env dosyalari + onceki kod)
if [[ -d "$APP_ROOT" ]]; then
  BACKUP="$DEPLOY_DIR/backup-$TS"
  echo "[release] yedek aliniyor: $BACKUP"
  mkdir -p "$BACKUP"
  # node_modules ve dist yedege girmez (buyuk + yeniden uretilebilir)
  (cd "$APP_DIR" && tar --exclude='*/node_modules' --exclude='*/dist' -cf "$BACKUP/app.tar" PORTAL-BMW-main) || true
  # Eski yedekleri temizle (son KEEP_BACKUPS kalir)
  ls -1dt "$DEPLOY_DIR"/backup-* 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs rm -rf 2>/dev/null || true
fi

# 3) Env dosyalarini kenara al (zip'te yoklar — kaybolmasinlar)
ENV_TMP="$(mktemp -d)"
if [[ -d "$APP_ROOT" ]]; then
  cp "$APP_ROOT"/.env.* "$ENV_TMP/" 2>/dev/null || true
fi

# 4) Zip'i ac
echo "[release] unzip: $ZIP_FILE -> $APP_DIR"
mkdir -p "$APP_DIR"
unzip -oq "$ZIP_FILE" -d "$APP_DIR"

# 5) Env dosyalarini geri koy
cp "$ENV_TMP"/.env.* "$APP_ROOT/" 2>/dev/null || true
rm -rf "$ENV_TMP"
[[ -f "$APP_ROOT/.env.$ENV_NAME" ]] || echo "UYARI: $APP_ROOT/.env.$ENV_NAME yok — baslatmadan once olusturun."

# 6) Bagimliliklar + build (vite build devDependencies gerektirir → tam npm ci)
cd "$APP_ROOT"
echo "[release] npm ci"
npm ci --no-audit --no-fund
echo "[release] npm run build"
npm run build

# 7) Baslat
chmod +x deploy/run.sh deploy/release.sh 2>/dev/null || true
echo "[release] baslatiliyor: $ENV_NAME"
./deploy/run.sh "$ENV_NAME" start
echo "[release] tamam. Durum: ./deploy/run.sh $ENV_NAME status"
