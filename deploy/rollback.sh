#!/usr/bin/env bash
# deploy/rollback.sh — SON CALISAN PAKETE HIZLI GERI DONUS (gblabt02, kullanici: was).
#
# release.sh / release-git.sh her surumde once mevcut agacin yedegini alir:
#   /vhosting8/bmw_portal/deploy/backup-<zaman>/   (son 3 tutulur; dist + node_modules DAHIL)
# Bu betik en yeni (ya da secilen) yedegi uygulama agacinin uzerine geri koyar ve ortami
# yeniden baslatir. Build GEREKMEZ (yedek derlenmis halde). .env.<env> git'te olmadigi
# ve yedekte de bulundugu icin korunur. Kalici veri MSSQL'de - agaci degistirmek veri
# kaybettirmez. Bugun eklenen DB kolonlari yerinde kalir; eski kod onlari okumaz.
#
# Kullanim:
#   ./deploy/rollback.sh prod                 # en yeni yedek
#   ./deploy/rollback.sh prod --list          # yedekleri goster, dokunma
#   ./deploy/rollback.sh prod backup-20260914-183012   # belirli yedek
#
# Ne yapar (sirayla): yedegi dogrula -> ortami durdur (PID dosyasiz yetim surecler ve
# :PORT dahil, run.sh korumasi) -> mevcut agacin "rollback-oncesi" yedegini al (geri
# donusten de geri donebilesin) -> yedegi rsync ile uzerine yaz -> start -> status.
set -u
ENV_NAME="${1:-}"
ARG2="${2:-}"
DEPLOY_DIR="${DEPLOY_DIR:-/vhosting8/bmw_portal/deploy}"
APP_ROOT="${APP_ROOT:-/vhosting8/bmw_portal/app/PORTAL-BMW-main}"

case "$ENV_NAME" in dev|test|qa|prod) ;; *) echo "Kullanim: $0 <dev|test|qa|prod> [--list | backup-<zaman>]" >&2; exit 2 ;; esac

list_backups() { ls -1dt "$DEPLOY_DIR"/backup-* 2>/dev/null; }

if [[ "$ARG2" == "--list" ]]; then
  echo "Yedekler (yeniden eskiye):"
  list_backups | while read -r b; do
    rev="$(cd "$b" 2>/dev/null && git rev-parse --short HEAD 2>/dev/null || echo '?')"
    echo "  $(basename "$b")  commit=$rev  $(du -sh "$b" 2>/dev/null | cut -f1)"
  done
  echo "Calisan agac: commit=$(cd "$APP_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?')"
  exit 0
fi

if [[ -n "$ARG2" ]]; then
  BACKUP="$DEPLOY_DIR/$ARG2"
else
  BACKUP="$(list_backups | head -n 1)"
fi
[[ -n "$BACKUP" && -d "$BACKUP" ]] || { echo "HATA: yedek bulunamadi ($DEPLOY_DIR/backup-*)." >&2; exit 1; }
[[ -f "$BACKUP/server/index.cjs" && -f "$BACKUP/dist/index.html" ]] || {
  echo "HATA: $BACKUP eksik gorunuyor (server/index.cjs ya da dist/index.html yok) — bu yedege donulmez." >&2; exit 1; }
command -v rsync >/dev/null 2>&1 || { echo "HATA: rsync yok (dnf install rsync)." >&2; exit 1; }

echo "== Geri donus: $(basename "$BACKUP") (commit $(cd "$BACKUP" && git rev-parse --short HEAD 2>/dev/null || echo '?')) → $APP_ROOT [$ENV_NAME]"
echo "   su anki agac: commit $(cd "$APP_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?')"

# 1) Durdur (run.sh: PID dosyasi + yetim surecler + port korumasi)
"$APP_ROOT/deploy/run.sh" "$ENV_NAME" stop || true
# PID dosyasiz kalintilar (run.sh start'taki korumanin aynisi; burada da temizle)
for pid in $(pgrep -f "node $APP_ROOT/server/index.cjs" 2>/dev/null); do
  echo "   yetim portal sureci PID $pid durduruluyor"; kill "$pid" 2>/dev/null || true
done
sleep 1

# 2) Geri donusten de geri donebilmek icin mevcut agacin kopyasi
TS="$(date +%Y%m%d-%H%M%S)"
PRE="$DEPLOY_DIR/rollback-oncesi-$TS"
mkdir -p "$PRE"
rsync -a --exclude 'logs/' "$APP_ROOT"/ "$PRE"/ && echo "   mevcut agac saklandi: $PRE"
ls -1dt "$DEPLOY_DIR"/rollback-oncesi-* 2>/dev/null | tail -n +3 | xargs rm -rf 2>/dev/null || true

# 3) Yedegi uzerine yaz (logs/ korunur; .env.<env> yedekte de var, yine de mevcut olan korunur)
for envf in "$APP_ROOT"/.env.*; do [[ -f "$envf" ]] && cp -a "$envf" "$PRE/"; done
rsync -a --delete --exclude 'logs/' --exclude '.env.*' "$BACKUP"/ "$APP_ROOT"/
echo "   agac geri yuklendi: commit $(cd "$APP_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?')"

# 4) Baslat
"$APP_ROOT/deploy/run.sh" "$ENV_NAME" start
"$APP_ROOT/deploy/run.sh" "$ENV_NAME" status
echo "== Bitti. Tekrar ileri almak icin: ./deploy/release-git.sh $ENV_NAME  (ya da rollback-oncesi kopyasi: $PRE)"
