#!/usr/bin/env bash
# deploy/release-git.sh — BMW Portal sunucu tarafi surum yukleme, git tabanli
# (gblabt02, kullanici: was). deploy/release.sh'in zip yerine git pull kullanan
# esdegeri.
#
# Akis (fetch → reset --hard → npm ci → build → start):
#   1. APP_ROOT bir git deposu degilse REPO_URL'den klonlanir (ilk calistirma)
#   2. Calisan ortam durdurulur
#   3. Mevcut app agacinin yedegi alinir (deploy/backup-<ts>) — son 3 yedek tutulur
#   4. origin/main fetch edilip uzerine hard-reset yapilir (tracked dosyalar guncellenir)
#   5. npm ci + npm run build
#   6. deploy/run.sh <env> start
#
# Kullanim:
#   ./deploy/release-git.sh <dev|test|qa|prod> [branch]
#   (branch verilmezse "main" varsayilir)
#
# NOT: .env.<env> ve server/ansible/ocp-clusters.json gibi dosyalar .gitignore'da
# olup git tarafindan HIC dokunulmaz (reset --hard sadece TRACKED dosyalari etkiler,
# untracked dosyalari silmez) — elle tasima/geri koyma GEREKMEZ.
set -euo pipefail

BASE_DIR="/vhosting8/bmw_portal"
DEPLOY_DIR="$BASE_DIR/deploy"
APP_DIR="$BASE_DIR/app"
APP_ROOT="$APP_DIR/PORTAL-BMW-main"
REPO_URL="https://github.com/onurdemir01/PORTAL-BMW-main.git"
KEEP_BACKUPS=3

ENV_NAME="${1:-}"
BRANCH="${2:-main}"
case "$ENV_NAME" in dev|test|qa|prod) ;; *) echo "Kullanim: $0 <dev|test|qa|prod> [branch]" >&2; exit 2 ;; esac

command -v node >/dev/null || { echo "HATA: node bulunamadi." >&2; exit 1; }
command -v git >/dev/null || { echo "HATA: git bulunamadi." >&2; exit 1; }

TS="$(date +%Y%m%d-%H%M%S)"

# 1) Ilk calistirma: APP_ROOT yoksa veya git deposu degilse klonla
if [[ ! -d "$APP_ROOT/.git" ]]; then
  echo "[release-git] $APP_ROOT bir git deposu degil — klonlaniyor: $REPO_URL"
  mkdir -p "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_ROOT"
fi

# 2) Calisan ortami durdur (run.sh varsa)
if [[ -x "$APP_ROOT/deploy/run.sh" ]]; then
  "$APP_ROOT/deploy/run.sh" "$ENV_NAME" stop || true
fi

# 3) Yedek al (mevcut kod agaci)
BACKUP="$DEPLOY_DIR/backup-$TS"
echo "[release-git] yedek aliniyor: $BACKUP"
mkdir -p "$BACKUP"
# node_modules ve dist yedege girmez (buyuk + yeniden uretilebilir)
(cd "$APP_DIR" && tar --exclude='*/node_modules' --exclude='*/dist' -cf "$BACKUP/app.tar" PORTAL-BMW-main) || true
# Eski yedekleri temizle (son KEEP_BACKUPS kalir)
ls -1dt "$DEPLOY_DIR"/backup-* 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs rm -rf 2>/dev/null || true

# 4) En son surumu cek (tracked dosyalar reset edilir; .env.* ve diger untracked
# dosyalar dokunulmadan kalir)
cd "$APP_ROOT"
echo "[release-git] fetch + reset --hard origin/$BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
# .gitignore'daki desenler (.env.*, node_modules, dist, logs...) zaten korunur —
# clean sadece TAKIP EDILMEYEN ve IGNORE EDILMEYEN artik dosyalari temizler
# (ornegin eski zip-deploy'dan kalan bir seyler varsa).
git clean -fd

[[ -f "$APP_ROOT/.env.$ENV_NAME" ]] || echo "UYARI: $APP_ROOT/.env.$ENV_NAME yok — baslatmadan once olusturun."

# 5) Bagimliliklar + build (vite build devDependencies gerektirir → tam npm ci)
echo "[release-git] npm ci"
npm ci --no-audit --no-fund
echo "[release-git] npm run build"
npm run build

# 6) Baslat
chmod +x deploy/run.sh deploy/release-git.sh 2>/dev/null || true
echo "[release-git] baslatiliyor: $ENV_NAME"
./deploy/run.sh "$ENV_NAME" start
echo "[release-git] tamam. Durum: ./deploy/run.sh $ENV_NAME status"
