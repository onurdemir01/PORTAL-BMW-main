#!/usr/bin/env bash
# deploy/install-cron.sh — Root GEREKTIRMEYEN kalicilik kurulumu (tek seferlik).
#
# Kullanim:
#   ./deploy/install-cron.sh <dev|test|qa|prod>
#
# Ne yapar (mevcut kullanicinin crontab'ina, idempotent — tekrar calistirilirsa
# ayni satirlari IKINCI KEZ eklemez):
#   1. @reboot   → VM yeniden baslarsa deploy/run.sh <env> start ile ortami acar
#                  (run.sh zaten "zaten calisiyor" kontrolu yapar; enabled-marker
#                  yoksa yine de acar — reboot sonrasi "hep acik olsun" istenir).
#   2. */2 * * * * (2 dk'da bir) → deploy/watchdog.sh <env> ile crash kontrolu.
#
# Kaldirmak icin: crontab -e  (asagidaki iki satiri elle silin)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_NAME="${1:-}"
case "$ENV_NAME" in dev|test|qa|prod) ;; *) echo "Kullanim: $0 <dev|test|qa|prod>" >&2; exit 2 ;; esac

command -v crontab >/dev/null 2>&1 || { echo "HATA: crontab bulunamadi." >&2; exit 1; }

REBOOT_LINE="@reboot $SCRIPT_DIR/run.sh $ENV_NAME start >> $ROOT_DIR/logs/$ENV_NAME.reboot.log 2>&1"
WATCHDOG_LINE="*/2 * * * * $SCRIPT_DIR/watchdog.sh $ENV_NAME"

mkdir -p "$ROOT_DIR/logs"

current="$(crontab -l 2>/dev/null || true)"
added=0

if ! grep -qF "$REBOOT_LINE" <<<"$current"; then
  current="$current"$'\n'"$REBOOT_LINE"
  added=1
  echo "+ eklendi: $REBOOT_LINE"
else
  echo "~ zaten var: @reboot satiri ($ENV_NAME)"
fi

if ! grep -qF "$WATCHDOG_LINE" <<<"$current"; then
  current="$current"$'\n'"$WATCHDOG_LINE"
  added=1
  echo "+ eklendi: $WATCHDOG_LINE"
else
  echo "~ zaten var: watchdog satiri ($ENV_NAME)"
fi

if [[ "$added" -eq 1 ]]; then
  # Bastaki bos satirlari temizle, sonra yaz.
  printf '%s\n' "$current" | sed '/^$/d' | crontab -
  echo "OK crontab guncellendi. Kontrol: crontab -l"
else
  echo "OK crontab zaten guncel, degisiklik yapilmadi."
fi

echo
echo "Simdi baslatmak icin: $SCRIPT_DIR/run.sh $ENV_NAME start"
echo "Kaldirmak icin: crontab -e  (ilgili iki satiri elle silin)"
