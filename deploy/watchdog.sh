#!/usr/bin/env bash
# deploy/watchdog.sh — BMW Portal crash-kurtarma nabzi (root GEREKTIRMEZ, cron ile calisir).
#
# Kullanim:
#   ./deploy/watchdog.sh <dev|test|qa|prod>
#
# Mantik: logs/<env>.enabled VARSA (yani operator bu ortami bilerek "start" etmis,
# "stop" ile durdurmamis) AMA logs/<env>.pid'deki surec OLU ise → run.sh <env> start
# ile yeniden ayaga kaldirir ve olayi logs/<env>.watchdog.log'a yazar. enabled dosyasi
# YOKSA (operator "stop" demis) hicbir sey yapmaz — kasitli durdurmayi asla bozmaz.
#
# Kurulum (tek seferlik, root gerekmez): ./deploy/install-cron.sh <env>
# Bu script cron'dan birkac dakikada bir cagrilacak sekilde tasarlanmistir; elle de
# calistirilabilir (idempotent — surec zaten canliysa hicbir sey yapmaz).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"

ENV_NAME="${1:-}"
case "$ENV_NAME" in dev|test|qa|prod) ;; *) echo "Kullanim: $0 <dev|test|qa|prod>" >&2; exit 2 ;; esac

ENABLED_FILE="$LOG_DIR/$ENV_NAME.enabled"
PID_FILE="$LOG_DIR/$ENV_NAME.pid"
WATCHDOG_LOG="$LOG_DIR/$ENV_NAME.watchdog.log"

# enabled-marker yoksa operator kasitli durdurmus — dokunma.
[[ -f "$ENABLED_FILE" ]] || exit 0

is_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

pid=""
[[ -f "$PID_FILE" ]] && pid="$(cat "$PID_FILE" 2>/dev/null || true)"

if is_alive "$pid"; then
  exit 0  # zaten calisiyor, yapilacak bir sey yok
fi

mkdir -p "$LOG_DIR"
echo "$(date '+%Y-%m-%d %H:%M:%S') [watchdog] [$ENV_NAME] surec olu (PID dosyasi: ${pid:-yok}) — yeniden baslatiliyor." >> "$WATCHDOG_LOG"

"$SCRIPT_DIR/run.sh" "$ENV_NAME" start >> "$WATCHDOG_LOG" 2>&1
echo "$(date '+%Y-%m-%d %H:%M:%S') [watchdog] [$ENV_NAME] yeniden baslatma denemesi tamamlandi (exit=$?)." >> "$WATCHDOG_LOG"
