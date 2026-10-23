#!/usr/bin/env bash
# deploy/release-git.sh — BMW Portal sunucu tarafi surum yukleme, git tabanli
# (gblabt02, kullanici: was). deploy/release.sh'in zip yerine git kullanan esdegeri.
#
# Akis (2026-09-17, KESINTISIZE YAKIN — bkz. deploy/stage-lib.sh):
#   1. APP_ROOT bir git deposu degilse REPO_URL'den klonlanir (ilk calistirma)
#   2. Hedef dal AYRI bir hazirlik dizinine klonlanir (app/.stage-<ts>/PORTAL-BMW-main;
#      nesneler yerel depodan --reference ile paylasilir, ag trafigi yalniz fark)
#   3. Orada npm ci + npm run build — ESKI SURUM BU SIRADA CALISMAYA DEVAM EDER
#   4. Mevcut agacin yedegi alinir (deploy/backup-<ts>, son 3; rollback.sh icin)
#   5. stop → .env.*/server/data/sertifikalar/logs tasinir → dizin degisimi (mv) → start
#      Kesinti yalnizca bu adim: birkac saniye. Eski agac app/PORTAL-BMW-main.prev-<ts>
#      olarak KALIR (hizli geri donus).
#
# Kullanim:
#   ./deploy/release-git.sh <dev|test|qa|prod> [branch]
#   (branch verilmezse "main" varsayilir)
#
# NOT: .env.<env>, server/ansible/ocp-clusters.json, server/data/ ve sertifikalar git'te
# yoktur; stage_carry_persistent bunlari eski agactan yeni agaca kopyalar.
set -euo pipefail

# PORTAL_BASE_DIR ile ikinci bir ornek (DEV) ayri agacta kurulur: PORTAL_BASE_DIR=/vhosting8/bmw_portal_dev (bkz. docs/DEV-PROD.md)
BASE_DIR="${PORTAL_BASE_DIR:-/vhosting8/bmw_portal}"
DEPLOY_DIR="$BASE_DIR/deploy"
APP_DIR="$BASE_DIR/app"
APP_ROOT="$APP_DIR/PORTAL-BMW-main"
# Depo PRIVATE ise (2026-10-23) anonim HTTPS klonu duser. PORTAL_REPO_URL ile SSH adresi verilir
# (salt-okunur deploy key; port 22 kapaliysa ~/.ssh/config'te github.com icin ssh.github.com:443)
# ya da HTTPS + git credential helper'da salt-okunur token. Token ASLA URL'e yazilmaz (ps / log).
REPO_URL="${PORTAL_REPO_URL:-https://github.com/onurdemir01/PORTAL-BMW-main.git}"
YETKI_IPUCU="Depo private ise: was kullanicisina salt-okunur deploy key (SSH) tanimlayin ve PORTAL_REPO_URL=git@github.com:onurdemir01/PORTAL-BMW-main.git verin; mevcut agacta: git -C <APP_ROOT> remote set-url origin <ayni adres>. Ayrinti: docs/DEPLOYMENT.md"
KEEP_BACKUPS=3
KEEP_PREV=1
# Portal'a ozel Node (deploy/install-node.sh) varsa npm ci / build de ONU kullanir (run.sh ile ayni kural).
PORTAL_NODE_HOME="${PORTAL_NODE_HOME:-$BASE_DIR/runtime/node}"
if [[ -x "$PORTAL_NODE_HOME/bin/node" ]]; then export PATH="$PORTAL_NODE_HOME/bin:$PATH"; fi

ENV_NAME="${1:-}"
BRANCH="${2:-main}"
case "$ENV_NAME" in dev|test|qa|prod) ;; *) echo "Kullanim: $0 <dev|test|qa|prod> [branch]" >&2; exit 2 ;; esac

command -v node >/dev/null || { echo "HATA: node bulunamadi." >&2; exit 1; }
echo "[release-git] node: $(command -v node) $(node -v)"
command -v git >/dev/null || { echo "HATA: git bulunamadi." >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"

# 1) Ilk calistirma: APP_ROOT yoksa veya git deposu degilse klonla ve normal start
if [[ ! -d "$APP_ROOT/.git" ]]; then
  echo "[release-git] $APP_ROOT bir git deposu degil — klonlaniyor: $REPO_URL"
  mkdir -p "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_ROOT" || { echo "HATA: klon basarisiz. $YETKI_IPUCU" >&2; exit 1; }
  cd "$APP_ROOT"
  npm ci --no-audit --no-fund
  npm run build
  chmod +x deploy/*.sh 2>/dev/null || true
  ./deploy/run.sh "$ENV_NAME" start
  exit $?
fi

# 2) Hazirlik dizinine klon (yerel depo referans: hizli, az ag)
STAGE_DIR="$APP_DIR/.stage-$TS"
STAGE_ROOT="$STAGE_DIR/PORTAL-BMW-main"
mkdir -p "$STAGE_DIR"
trap 'rm -rf "$STAGE_DIR"' EXIT
echo "[release-git] fetch origin/$BRANCH (calisan agac dokunulmaz)"
git -C "$APP_ROOT" fetch origin "$BRANCH" || { echo "HATA: fetch basarisiz. $YETKI_IPUCU" >&2; exit 1; }
echo "[release-git] hazirlik klonu: $STAGE_ROOT"
git clone --quiet --branch "$BRANCH" --reference "$APP_ROOT" --dissociate "$REPO_URL" "$STAGE_ROOT" \
  || { echo "HATA: hazirlik klonu basarisiz. $YETKI_IPUCU" >&2; exit 1; }
git -C "$STAGE_ROOT" reset --hard "origin/$BRANCH" --quiet
echo "[release-git] surum: $(git -C "$STAGE_ROOT" log --oneline -1)"
if [[ -f "$STAGE_ROOT/deploy/stage-lib.sh" ]]; then source "$STAGE_ROOT/deploy/stage-lib.sh"; else source "$SCRIPT_DIR/stage-lib.sh"; fi

# 3) Kalici dosyalar (build oncesi de lazim olabilir) + npm ci + build — eski surum calisirken
stage_carry_persistent "$APP_ROOT" "$STAGE_ROOT"
[[ -f "$STAGE_ROOT/.env.$ENV_NAME" ]] || echo "UYARI: .env.$ENV_NAME bulunamadi — baslatmadan once $APP_ROOT altina olusturun."
cd "$STAGE_ROOT"
echo "[release-git] npm ci (hazirlik dizini)"
npm ci --no-audit --no-fund
echo "[release-git] npm run build (hazirlik dizini)"
npm run build
[[ -f "$STAGE_ROOT/dist/index.html" ]] || { echo "HATA: build cikti uretmedi." >&2; exit 1; }

# 3b) Test kapisi (2026-09-20) GERI ALINDI (2026-09-21): npm test hazirlik dizininde takili kaldi
# (uzun suren/asili testler release'i bloke etti). Testler CI'da (Jenkins) kosar; release betigi
# yalniz build'e bakar.
# 4) Yedek (rollback.sh ile uyumlu)
BACKUP="$DEPLOY_DIR/backup-$TS"
echo "[release-git] yedek aliniyor: $BACKUP"
mkdir -p "$BACKUP"
(cd "$APP_DIR" && tar --exclude='*/node_modules' --exclude='*/dist' -cf "$BACKUP/app.tar" PORTAL-BMW-main) || true
ls -1dt "$DEPLOY_DIR"/backup-* 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs rm -rf 2>/dev/null || true

# 5) stop → tasima → degisim → start (kesinti yalnizca burada)
stage_swap_and_start "$ENV_NAME" "$APP_ROOT" "$STAGE_ROOT" "$DEPLOY_DIR" "$KEEP_PREV"
echo "[release-git] tamam. Durum: $APP_ROOT/deploy/run.sh $ENV_NAME status"
