# ARSIV — bu script artik kullanilmiyor
#
# Bu, /opt/bmw-portal + port 5055 + JSON-store (server/data) surumleme varsayan
# eski Jenkins CI/CD deploy modelidir. Gercek deploy yolu artik farklidir:
#   /vhosting8/bmw_portal + port 3000 + tum kalici veri MSSQL'de (TBMWANS).
# Guncel, gercekten kullanilan deploy scripti: deploy/release.sh (bkz. docs/DEPLOYMENT.md).
# Bu dosya yalniz referans/tarihce icin saklanir — CALISTIRILMAMALIDIR.
#
# ============================================================================

#!/usr/bin/env bash
# scripts/deploy.sh — Hedef sunucuda (RHEL) calisan deploy adimi.
# Jenkins bunu artifact ile birlikte kopyalayip SSH uzerinden calistirir;
# elle deploy icin de kullanilabilir.
#
# Kullanim (hedef sunucuda):
#   bash scripts/deploy.sh /tmp/bmw-portal-<BUILD>.tar.gz
#
# Yapi: surumlu dizinler + current symlink → hizli rollback:
#   /opt/bmw-portal/releases/20260710-153000_42/   (her deploy)
#   /opt/bmw-portal/current -> releases/...         (aktif surum)
#   /opt/bmw-portal/shared/.env.local               (ortak env — surumler arasi korunur)
#   /opt/bmw-portal/shared/data/                    (JSON store'lar — surumler arasi korunur)
#
# Rollback:  bash scripts/deploy.sh --rollback
set -euo pipefail

APP_DIR="/opt/bmw-portal"
RELEASES="$APP_DIR/releases"
SHARED="$APP_DIR/shared"
SERVICE="bmw-portal"
HEALTH_URL="http://127.0.0.1:5055/api/logx/health"
KEEP_RELEASES=5

log() { echo "[deploy] $*"; }

health_check() {
  local tries=15
  for i in $(seq 1 $tries); do
    if curl -sf -o /dev/null "$HEALTH_URL"; then
      log "✓ health check geçti ($i. deneme)"
      return 0
    fi
    sleep 2
  done
  log "✗ health check $((tries*2))s içinde geçmedi"
  return 1
}

switch_to() {
  local target="$1"
  ln -sfn "$target" "$APP_DIR/current"
  sudo systemctl restart "$SERVICE"
  log "servis yeniden başlatıldı → $(basename "$target")"
}

# ── Rollback modu ─────────────────────────────────────────────────────────────
if [ "${1:-}" = "--rollback" ]; then
  current=$(readlink -f "$APP_DIR/current")
  prev=$(ls -1dt "$RELEASES"/*/ | grep -v "$current" | head -1 || true)
  [ -z "$prev" ] && { log "✗ rollback için önceki sürüm yok"; exit 1; }
  log "rollback: $(basename "$current") → $(basename "$prev")"
  switch_to "$prev"
  health_check || { log "✗ rollback sonrası health de başarısız — elle müdahale gerekli"; exit 1; }
  exit 0
fi

# ── Normal deploy ─────────────────────────────────────────────────────────────
ARTIFACT="${1:?Kullanım: deploy.sh <artifact.tar.gz> | --rollback}"
[ -f "$ARTIFACT" ] || { log "✗ artifact bulunamadı: $ARTIFACT"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
NEW_RELEASE="$RELEASES/$STAMP"
PREV_RELEASE=$(readlink -f "$APP_DIR/current" 2>/dev/null || true)

log "sürüm dizini: $NEW_RELEASE"
mkdir -p "$NEW_RELEASE"
tar -xzf "$ARTIFACT" -C "$NEW_RELEASE"

log "prod bağımlılıkları kuruluyor (npm ci --omit=dev)…"
cd "$NEW_RELEASE"
npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -1

# Ortak dosyalari bagla (env + kalici JSON store'lar + sertifikalar)
mkdir -p "$SHARED/data" "$SHARED/certs"
ln -sfn "$SHARED/.env.local" "$NEW_RELEASE/.env.local"
rm -rf "$NEW_RELEASE/server/data" && ln -sfn "$SHARED/data" "$NEW_RELEASE/server/data"
[ -d "$SHARED/certs" ] && { rm -rf "$NEW_RELEASE/server/certs"; ln -sfn "$SHARED/certs" "$NEW_RELEASE/server/certs"; }

[ -f "$SHARED/.env.local" ] || log "⚠ $SHARED/.env.local YOK — .env.example'dan oluşturun!"

switch_to "$NEW_RELEASE"

if ! health_check; then
  if [ -n "$PREV_RELEASE" ] && [ -d "$PREV_RELEASE" ]; then
    log "otomatik rollback → $(basename "$PREV_RELEASE")"
    switch_to "$PREV_RELEASE"
    health_check || true
  fi
  exit 1
fi

# Eski surumleri temizle (son $KEEP_RELEASES kalsin)
ls -1dt "$RELEASES"/*/ | tail -n +$((KEEP_RELEASES+1)) | xargs -r rm -rf
log "✓ deploy tamam: $STAMP"
