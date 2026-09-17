#!/usr/bin/env bash
# deploy/release.sh — BMW Portal sunucu tarafi surum yukleme (gblabt02, kullanici: was).
#
# Akis (2026-09-17, KESINTISIZE YAKIN — bkz. deploy/stage-lib.sh):
#   1. /vhosting8/bmw_portal/deploy/PORTAL-BMW-main.zip beklenir (once oraya kopyalayin)
#   2. Zip AYRI bir hazirlik dizinine acilir (app/.stage-<ts>/PORTAL-BMW-main)
#   3. Orada npm ci + npm run build — ESKI SURUM BU SIRADA CALISMAYA DEVAM EDER
#   4. Mevcut agacin yedegi alinir (deploy/backup-<ts>, son 3; rollback.sh icin)
#   5. stop → .env.*/server/data/sertifikalar/logs tasinir → dizin degisimi (mv) → start
#      Kesinti yalnizca bu adim: birkac saniye. Eski agac app/PORTAL-BMW-main.prev-<ts>
#      olarak build'li hâliyle KALIR (hizli geri donus).
#
# ESKI AKIS "stop → unzip → npm ci → build → start" idi: dakikalarca kapali kaldigi icin o
# pencerede sayfayi acan herkes login ekranina dusuyordu ("session kopuyor"). Oturumlar
# MSSQL'de (portal_sessions) oldugu icin restart oturum DUSURMEZ; sorun kesinti suresiydi.
#
# Kullanim:
#   ./deploy/release.sh <dev|test|qa|prod>
#
# NOT: Tum kalici veri MSSQL'dedir (TBMWANS) — app dizinini degistirmek veri kaybetmez.
# .env.<env> dosyalari zip icinde YOKTUR (gitignore) — eski agactan yeni agaca kopyalanir.
set -euo pipefail

BASE_DIR="/vhosting8/bmw_portal"
DEPLOY_DIR="$BASE_DIR/deploy"
APP_DIR="$BASE_DIR/app"
ZIP_FILE="$DEPLOY_DIR/PORTAL-BMW-main.zip"
APP_ROOT="$APP_DIR/PORTAL-BMW-main"
KEEP_BACKUPS=3
KEEP_PREV=1

ENV_NAME="${1:-}"
case "$ENV_NAME" in dev|test|qa|prod) ;; *) echo "Kullanim: $0 <dev|test|qa|prod>" >&2; exit 2 ;; esac

[[ -f "$ZIP_FILE" ]] || { echo "HATA: $ZIP_FILE yok — once zip'i deploy/ altina kopyalayin." >&2; exit 1; }
command -v node >/dev/null || { echo "HATA: node bulunamadi." >&2; exit 1; }
command -v unzip >/dev/null || { echo "HATA: unzip bulunamadi." >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# stage-lib once ZIP'in icindeki (yeni) surumden, yoksa bu betigin yanindan okunur
TS="$(date +%Y%m%d-%H%M%S)"
STAGE_DIR="$APP_DIR/.stage-$TS"
STAGE_ROOT="$STAGE_DIR/PORTAL-BMW-main"
mkdir -p "$STAGE_DIR"
trap 'rm -rf "$STAGE_DIR"' EXIT

# 1) Zip'i HAZIRLIK dizinine ac (calisan agaca dokunulmaz)
echo "[release] unzip: $ZIP_FILE -> $STAGE_DIR"
unzip -oq "$ZIP_FILE" -d "$STAGE_DIR"
[[ -d "$STAGE_ROOT" ]] || { echo "HATA: zip icinde PORTAL-BMW-main/ dizini yok." >&2; exit 1; }
if [[ -f "$STAGE_ROOT/deploy/stage-lib.sh" ]]; then source "$STAGE_ROOT/deploy/stage-lib.sh"; else source "$SCRIPT_DIR/stage-lib.sh"; fi

# 2) Env dosyalari build'den ONCE de lazim olabilir (vite env okur) — simdiden kopyala
stage_carry_persistent "$APP_ROOT" "$STAGE_ROOT"
[[ -f "$STAGE_ROOT/.env.$ENV_NAME" ]] || echo "UYARI: .env.$ENV_NAME bulunamadi — baslatmadan once $APP_ROOT altina olusturun."

# 3) Bagimliliklar + build — ESKI SURUM CALISIRKEN (vite build devDependencies ister → tam npm ci)
cd "$STAGE_ROOT"
echo "[release] npm ci (hazirlik dizini)"
npm ci --no-audit --no-fund
echo "[release] npm run build (hazirlik dizini)"
npm run build
[[ -f "$STAGE_ROOT/dist/index.html" ]] || { echo "HATA: build cikti uretmedi." >&2; exit 1; }

# 4) Yedek (rollback.sh ile uyumlu; node_modules ve dist yedege girmez)
if [[ -d "$APP_ROOT" ]]; then
  BACKUP="$DEPLOY_DIR/backup-$TS"
  echo "[release] yedek aliniyor: $BACKUP"
  mkdir -p "$BACKUP"
  (cd "$APP_DIR" && tar --exclude='*/node_modules' --exclude='*/dist' -cf "$BACKUP/app.tar" PORTAL-BMW-main) || true
  ls -1dt "$DEPLOY_DIR"/backup-* 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs rm -rf 2>/dev/null || true
fi

# 5) stop → tasima → degisim → start (kesinti yalnizca burada)
mkdir -p "$APP_DIR"
stage_swap_and_start "$ENV_NAME" "$APP_ROOT" "$STAGE_ROOT" "$DEPLOY_DIR" "$KEEP_PREV"
echo "[release] tamam. Durum: $APP_ROOT/deploy/run.sh $ENV_NAME status"
