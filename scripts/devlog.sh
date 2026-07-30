#!/usr/bin/env bash
# scripts/devlog.sh — npm run dev:log ile calistir.
# Her oturumda logs/YYYYMMDD_HHMMSS/ icine snapshot yazar.
# Durdurmak icin Ctrl+C. Dizini debug icin paylas.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS_BASE="$ROOT/logs"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
SNAP_DIR="$LOGS_BASE/$TIMESTAMP"

mkdir -p "$SNAP_DIR"

LOG_ALL="$SNAP_DIR/all.log"
LOG_INFO="$SNAP_DIR/info.txt"

# all.log'u hemen olustur (bos olsa bile)
touch "$LOG_ALL"

# ── Sistem bilgisi ────────────────────────────────────────────────────────────
{
  echo "=== BMW Portal Debug Snapshot ==="
  echo "Tarih    : $(date)"
  echo "Snapshot : $SNAP_DIR"
  echo ""
  echo "--- Calisma Ortami ---"
  echo "Node     : $(node --version 2>/dev/null || echo N/A)"
  echo "npm      : $(npm  --version 2>/dev/null || echo N/A)"
  echo "OS       : $(uname -s -r   2>/dev/null || echo N/A)"
  echo ""
  echo "--- .env.local Degisken Anahtarlari (degerler gizli) ---"
  if [ -f "$ROOT/.env.local" ]; then
    grep -v '^\s*#' "$ROOT/.env.local" \
      | grep '=' \
      | cut -d'=' -f1 \
      | sort \
      | awk '{print "  " $0 " = [SET]"}'
  else
    echo "  .env.local bulunamadi!"
  fi
  echo ""
  echo "=== SUNUCU LOGU BASLIYOR: $(date) ==="
  echo ""
} | tee "$LOG_INFO" | tee -a "$LOG_ALL"

echo ""
printf '\033[1;34m┌────────────────────────────────────────────────┐\033[0m\n'
printf '\033[1;34m│  BMW Portal  — Dev Log                         │\033[0m\n'
printf '\033[1;34m│  Snapshot : logs/%s/     │\033[0m\n' "$TIMESTAMP"
printf '\033[1;34m│  Durdurmak: Ctrl+C                             │\033[0m\n'
printf '\033[1;34m└────────────────────────────────────────────────┘\033[0m\n'
echo ""

# ── Cikista ozet ─────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  {
    echo ""
    echo "=== DURDURULDU: $(date) ==="
    echo ""
    echo "--- Snapshot Dosyalari ---"
    ls -lh "$SNAP_DIR" 2>/dev/null
  } | tee -a "$LOG_ALL"

  echo ""
  printf '\033[1;32mSnapshot kaydedildi → %s\033[0m\n' "$SNAP_DIR"
  printf '\033[0;37m  all.log  : tüm çıktı\033[0m\n'
  printf '\033[0;37m  info.txt : ortam bilgisi\033[0m\n'
  echo ""
}
trap cleanup EXIT

# ── Sunucu + frontend baslat, her ikisini de dosyaya yaz ──────────────────────
cd "$ROOT"
npm run dev:all 2>&1 | tee -a "$LOG_ALL"
