#!/usr/bin/env bash
# deploy/run.sh — BMW Portal cok-ortamli baslatici (RHEL 8/9, systemd GEREKTIRMEZ).
#
# Kullanim:
#   ./deploy/run.sh <dev|test|qa|prod> [start|stop|restart|status|logs]
#   (aksiyon verilmezse "start" varsayilir)
#
# Ornekler:
#   ./deploy/run.sh test           # test ortamini nohup ile baslat
#   ./deploy/run.sh test status    # durum + PID + PORT + son loglar
#   ./deploy/run.sh test logs      # canli log (tail -f)
#   ./deploy/run.sh test stop      # kolayca durdur (PID'den kill)
#   ./deploy/run.sh prod restart   # yeniden baslat
#
# Topoloji (tek :3000 semasi):
#   • Kurumsal nginx (BMW_Portal-D.conf) 443'u 127.0.0.1:3000'e proxy'ler.
#   • TUM ortamlar (dev/test/qa/prod) PORT=3000 kullanir → ayni hostta ayni anda
#     YALNIZ BIR ortam aktif olabilir. Yeni ortam baslatilirken 3000'i tutan
#     diger ortam otomatik durdurulur.
#
# On kosul: YOK — node_modules/dist eksikse start_env otomatik `npm ci` + `npm run
# build` calistirir (temiz checkout'ta tek komut yeterli).
#
# Kalici calisma (crash/reboot kurtarma): bu script TEK BASINA crash sonrasi otomatik
# yeniden baslamaz. Iki secenek (bkz. docs/DEPLOYMENT.md "Kalici Calisma"):
#   - Root YOKSA: ./deploy/install-cron.sh <env>  (cron watchdog + @reboot, bu script'i kullanir)
#   - Root VARSA: systemd sablon birimi deploy/bmw-portal@.service (bu script'i KULLANMAZ,
#     dogrudan node calistirir — ikisini AYNI ortam icin birlikte calistirmayin)
#
# NOT: `-e` KULLANILMAZ — launcher bircok komutun (grep/kill) non-zero donmesini normal
# karsilar; `-u` (unset) + pipefail ile guvenli tutulur (bash 3.2+ uyumlu).
set -uo pipefail

# ── Repo kokunu script konumundan coz (unzip dizininden bagimsiz calisir) ────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
ALL_ENVS=(dev test qa prod)
LOG_ROTATE_MAX_BYTES=$((20 * 1024 * 1024)) # 20MB
LOG_ROTATE_KEEP=3

usage() {
  echo "Kullanim: $0 <dev|test|qa|prod> [start|stop|restart|status|logs]" >&2
  exit 2
}

ENV_NAME="${1:-}"
ACTION="${2:-start}"
[[ -z "$ENV_NAME" ]] && usage
case "$ENV_NAME" in dev|test|qa|prod) ;; *) echo "HATA: gecersiz ortam '$ENV_NAME' (dev|test|qa|prod)" >&2; usage ;; esac
case "$ACTION"   in start|stop|restart|status|logs) ;; *) echo "HATA: gecersiz aksiyon '$ACTION'" >&2; usage ;; esac

ENV_FILE="$ROOT_DIR/.env.$ENV_NAME"
PID_FILE="$LOG_DIR/$ENV_NAME.pid"
OUT_FILE="$LOG_DIR/$ENV_NAME.out"
ENABLED_FILE="$LOG_DIR/$ENV_NAME.enabled"
LOCK_FILE="$LOG_DIR/.start.lock"

# ── .env.<env> icinden bir anahtar oku (PORT/SESSION_SECRET vb.) ────────────────
read_env_key() {
  local f="$1" key="$2"
  [[ -f "$f" ]] || { echo ""; return; }
  grep -E "^${key}=" "$f" | tail -n1 | cut -d= -f2- | tr -d '[:space:]'
}

read_port() { read_env_key "$1" "PORT"; }

is_alive() { # $1=pid → 0 yasiyor
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

pid_of() { # pidfile'dan canli PID doner (yoksa bos)
  local pf="$1"
  [[ -f "$pf" ]] || return 0
  local pid; pid="$(cat "$pf" 2>/dev/null || true)"
  if is_alive "$pid"; then echo "$pid"; else rm -f "$pf"; fi
}

stop_env() { # $1=env — o ortami durdur (best-effort, TERM → KILL)
  # NOT: bash 3.2'de `local a=$1 b=$a` ayni satirda guvenilmez → ayri satirlar.
  local env pf pid
  env="$1"
  pf="$LOG_DIR/$env.pid"
  pid="$(pid_of "$pf")"
  # Enabled-marker HER ZAMAN silinir (kasitli stop VEYA mutual-exclusion devri) — bu,
  # watchdog'un "coktu → yeniden baslat" ile "kasitli durduruldu → dokunma" ayrimini
  # yapmasini saglar. Bir sonraki start_env cagrisi yeniden olusturur.
  rm -f "$LOG_DIR/$env.enabled"
  if [[ -z "$pid" ]]; then
    [[ "$ACTION" == "stop" ]] && echo "[$env] zaten calismiyor."
    return 0
  fi
  echo "[$env] durduruluyor (PID $pid)…"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do is_alive "$pid" || break; sleep 0.5; done
  if is_alive "$pid"; then
    echo "[$env] TERM'e yanit yok → KILL."
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$pf"
  echo "[$env] durduruldu."
}

# ── Log rotasyonu: $OUT_FILE 20MB'i gecerse timestamp'li kopyaya tasi, eskileri sil ──
rotate_log_if_needed() {
  [[ -f "$OUT_FILE" ]] || return 0
  local size
  size="$(wc -c < "$OUT_FILE" 2>/dev/null | tr -d '[:space:]')"
  [[ -n "$size" && "$size" -gt "$LOG_ROTATE_MAX_BYTES" ]] || return 0
  local rotated="$OUT_FILE.$(date +%Y%m%d%H%M%S)"
  mv "$OUT_FILE" "$rotated"
  echo "[$ENV_NAME] log donduruldu: $rotated"
  # Bu env icin son LOG_ROTATE_KEEP rotasyon disindakileri sil.
  ls -1t "$OUT_FILE".* 2>/dev/null | tail -n +$((LOG_ROTATE_KEEP + 1)) | xargs -r rm -f
}

# ── Onkosul otomatik onarim: node_modules/dist eksikse kur/insa et ──────────────
ensure_dependencies_and_build() {
  command -v node >/dev/null 2>&1 || { echo "HATA: node bulunamadi (RHEL: dnf module enable nodejs:20)." >&2; exit 1; }
  command -v npm  >/dev/null 2>&1 || { echo "HATA: npm bulunamadi." >&2; exit 1; }

  if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
    echo "[$ENV_NAME] node_modules yok → npm ci calistiriliyor (ilk kurulum)…"
    (cd "$ROOT_DIR" && npm ci --no-audit --no-fund) || { echo "HATA: npm ci basarisiz." >&2; exit 1; }
  fi

  if [[ ! -f "$ROOT_DIR/dist/index.html" ]]; then
    echo "[$ENV_NAME] dist/index.html yok → npm run build calistiriliyor (ilk kurulum)…"
    (cd "$ROOT_DIR" && npm run build) || { echo "HATA: npm run build basarisiz." >&2; exit 1; }
  fi
}

# ── On-ucus dogrulamasi: SESSION_SECRET production'da bos kalamaz ───────────────
preflight_check_env_file() {
  [[ -f "$ENV_FILE" ]] || { echo "HATA: $ENV_FILE yok — once .env.example'dan turetin." >&2; exit 1; }

  local secret; secret="$(read_env_key "$ENV_FILE" "SESSION_SECRET")"
  if [[ -z "$secret" ]]; then
    echo "HATA: $ENV_FILE icinde SESSION_SECRET bos." >&2
    echo "      Uretmek icin: openssl rand -hex 32" >&2
    echo "      Sonra $ENV_FILE icine SESSION_SECRET=<uretilen> yazin." >&2
    exit 1
  fi

  local dbpass mssqlpass
  dbpass="$(read_env_key "$ENV_FILE" "PORTAL_DB_PASSWORD")"
  mssqlpass="$(read_env_key "$ENV_FILE" "MSSQL_PASSWORD")"
  if [[ -z "$dbpass" && -z "$mssqlpass" ]]; then
    echo "UYARI: [$ENV_NAME] PORTAL_DB_PASSWORD/MSSQL_PASSWORD bos — DB'ye baglanamazsa" >&2
    echo "       oturumlar MemoryStore'a duser (restart'ta logout olur)." >&2
  fi
}

start_env() {
  mkdir -p "$LOG_DIR"
  preflight_check_env_file
  ensure_dependencies_and_build

  # Ayni ortam zaten calisiyorsa uyar.
  local running; running="$(pid_of "$PID_FILE")"
  if [[ -n "$running" ]]; then
    echo "[$ENV_NAME] zaten calisiyor (PID $running). 'restart' kullanin." ; exit 0
  fi

  # Mutual-exclusion: tum ortamlar :3000'u paylasir → calisan diger ortami durdur.
  for other in "${ALL_ENVS[@]}"; do
    [[ "$other" == "$ENV_NAME" ]] && continue
    if [[ -n "$(pid_of "$LOG_DIR/$other.pid")" ]]; then
      echo "[$ENV_NAME] port (:3000) '$other' tarafindan tutuluyor → devraliniyor."
      stop_env "$other"
    fi
  done

  rotate_log_if_needed

  local port; port="$(read_port "$ENV_FILE")"
  echo "[$ENV_NAME] baslatiliyor (PORT=${port:-?}) …"
  # NODE_ENV=production ACIKCA export edilir — dotenv zaten-set edilen degeri EZMEZ,
  # bu yuzden kabuktaki her turlu NODE_ENV kirliligine (nvm, onceki dev oturumu, vb.)
  # karsi TEK kesin garanti budur. .env.<env> icindeki NODE_ENV=production satiri
  # yalniz belge/yedek amaclidir, yuklenme sirasindaki zaten-set deger kazanir.
  # setsid + < /dev/null: terminal/SSH oturumu kapansa da surec tam kopmus kalir.
  # setsid RHEL'de (util-linux) standarttir; yoksa (ör. macOS'ta yerel test) sessizce atlanir.
  # APP_ENV argumani server/index.cjs'e ilk arguman olarak gider → .env.<env> yuklenir.
  # bash 3.2 (RHEL/macOS eski surumler) + set -u altinda bos array expansion "unbound
  # variable" hatasi verir — bu yuzden array yerine duz string + kasitli word-splitting
  # kullanilir (SETSID_BIN yalniz "setsid" ya da "" olur, bosluk/glob riski yok).
  local SETSID_BIN=""
  command -v setsid >/dev/null 2>&1 && SETSID_BIN="setsid"
  NODE_ENV=production nohup $SETSID_BIN node "$ROOT_DIR/server/index.cjs" "$ENV_NAME" \
    < /dev/null >> "$OUT_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"
  sleep 1
  if is_alive "$pid"; then
    touch "$ENABLED_FILE"
    echo "[$ENV_NAME] calisiyor (PID $pid) · log: $OUT_FILE"
  else
    echo "HATA: [$ENV_NAME] baslatilamadi — son loglar:" >&2
    tail -n 20 "$OUT_FILE" >&2 || true
    rm -f "$PID_FILE"; exit 1
  fi
}

restart_env() {
  stop_env "$ENV_NAME"
  start_env
}

status_env() {
  local pid port; pid="$(pid_of "$PID_FILE")"; port="$(read_port "$ENV_FILE")"
  if [[ -n "$pid" ]]; then
    echo "[$ENV_NAME] CALISIYOR · PID $pid · PORT ${port:-?}"
  else
    echo "[$ENV_NAME] durmus · PORT ${port:-?}"
  fi
  if [[ -f "$OUT_FILE" ]]; then
    echo "── son 12 log satiri ($OUT_FILE) ──"
    tail -n 12 "$OUT_FILE"
  fi
}

# ── start/restart icin yaris kilidi (TOCTOU onlemi) ──────────────────────────────
# Iki eszamanli 'start' cagrisi ayni anda calisan-yok kontrolunu gecip cift baslatabilir.
# flock (RHEL'de util-linux ile hazir gelir) bunu tek instance'a serilestirir. flock
# yoksa (beklenmeyen ortam) sessizce kilitsiz devam eder — bu script'in tek amaci
# guvenilirlik oldugu icin eksik arac yuzunden tumden calismamasi tercih edilmez.
run_locked() {
  mkdir -p "$LOG_DIR"
  if command -v flock >/dev/null 2>&1; then
    exec 200>"$LOCK_FILE"
    if ! flock -n 200; then
      echo "[$ENV_NAME] baska bir start/restart suruyor (kilit: $LOCK_FILE) — bekleyin." >&2
      exit 1
    fi
  fi
  "$@"
}

case "$ACTION" in
  start)   run_locked start_env ;;
  stop)    stop_env "$ENV_NAME" ;;
  restart) run_locked restart_env ;;
  status)  status_env ;;
  logs)    [[ -f "$OUT_FILE" ]] || { echo "log yok: $OUT_FILE"; exit 0; }; tail -f "$OUT_FILE" ;;
esac
