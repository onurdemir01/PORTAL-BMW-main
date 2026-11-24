#!/bin/bash
# spa_package_host.sh - Intranet SPA paket kurulumu: tek uygulamayi BIR Nginx sunucusuna ilk kez
# kurar (Artifactory'den paket + uygulamanin OCP route'undaki /config'ten application.json). www
# olarak kosar.
#
# Mevcut deployment betikleri YENIDEN YAZILMAZ, cagrilir (/vhosting/HYSUXSCRIPTS):
#   nginx_pre_deployment -> nginx_unzip -> nginx_configuration -> nginx_syntax_check -> nginx_reload
#   -> (dogrulama) -> nginx_cleanup_backup; her biri `prod <ns> <app> <surum> portal / <job_no>`.
# Ilk kurulumda nginx_rollback.sh yedek bulamaz (49): geri alma = nginx_delete.sh <ns> <app>.
#
# Girdi (ortam degiskeni):
#   SPI_MODE plan|apply   SPI_NS   SPI_APP   SPI_VERSION   SPI_JOB_NO (sayisal)
#   SPI_ZIP_URL  https://.../<ns>/<app>/<surum>.zip (sir degil; curl'e komut satirindan verilir)
#   SPI_CONFIG_URLS  bosluk ayrimli 1..3 adres, her biri https://<route host>/config (tekil). OCP'de
#     kosan pod'daki nginx ayni configuration_template ile /config -> config.json (= ConfigMap'teki
#     application.json) sunar. Sirayla denenir; ilk gecerli JSON NESNESI alinir.
#   SPI_MAX_ZIP_MB (512)  SPI_DOWNLOAD_TIMEOUT sn (600)  SPI_INSECURE 1 -> curl -k (paket ve /config)
#   SPI_STEP_TIMEOUT sn (900): her deployment betigi icin sure siniri
#   SPI_PYTHON: JSON denetimi icin yorumlayici (Ansible'in bu sunucuda buldugu); yoksa
#     /usr/libexec/platform-python, python3, python aranir.
# Test icin yollar: SPI_SCRIPTS_DIR SPI_HYS_ROOT SPI_APP_ROOT SPI_CONF_DIR SPI_CURL SPI_UNZIP.
#
# PLAN sunucuya hicbir sey yazmaz (/config icerigi kosuya ozel gecici dizine iner, cikista silinir):
#   - deployment betikleri var mi;
#   - hedef (uygulama dizini, iki conf) YOK mu; biri varsa SKIP "zaten kurulu" (uzerine yazilmaz);
#   - paket dizini /hysdeploy/<ns>/<app> YOK mu; varsa SKIP (pipeline yuklemis olabilir, elle bakilir);
#   - /hysdeploy/<ns> varsa o, yoksa /hysdeploy yazilabilir mi;
#   - paket HEAD 200, Content-Type ZIP (application/zip | application/x-zip-compressed |
#     application/octet-stream; parametre ve harf farki yok sayilir), boyut siniri icinde mi;
#   - /config: HTTP 200, bos degil, en cok 1 MB, HTML degil, gecerli JSON ve JSON NESNESI.
#     Hicbir adres gecmezse FAIL step 'config'. Mesaja adres yazilmaz, yalniz sira numarasi.
# APPLY: plan denetimleri; /hysdeploy/<ns> (yoksa; 777, 1-nginx_pre_deployment.sh ile ayni kural:
# pipeline yukleyicisi orada yeni uygulama dizini acabilsin) ve /hysdeploy/<ns>/<app> acilir;
# indirme (.part -> unzip -t -> kokte index.html -> <surum>.zip), application.json (/config'ten
# cekilen icerik birebir); kurulumdan HEMEN once hedefler yeniden denetlenir; deployment betikleri,
# / (index.html) ve /config 200 (/ready DENETLENMEZ: sablonda dizine alias, nginx her zaman 301 doner;
# job 3590287), cleanup_backup.
#
# Geri alma:
#   - indirme / zip / application.json / yeniden denetim hatasi: yalniz bu betigin yazdigi dosyalar
#     silinir; bu betigin actigi dizinler bos kaldiysa silinir (nginx_delete.sh CAGRILMAZ).
#   - deployment adimi / dogrulama hatasi: nginx_delete.sh YALNIZ hedef bu kosunun ise cagrilir
#     (uygulama dizininde .version == surum; ya da dizin yok ve var olan conf'lar bu uygulamanin
#     dizinini / app conf'unu gosteriyor). Hedef hic olusmadiysa yalniz indirilen dosyalar silinir.
#     Aksi halde hicbir seye dokunulmaz, mesaj elle incelemeyi soyler.
#
# Cikti: log satirlari, en sonda TEK satir `RESULT<TAB>status<TAB>step<TAB>mesaj`.
#   status OK | PLAN_OK | SKIP | FAIL ; exit 0 (OK/PLAN_OK/SKIP) ya da 1 (FAIL).
#   step check|config|download|zip_check|write|pre_deployment|unzip|configuration|syntax_check|reload|
#        verify|cleanup
# Mesajda paket ve /config adresi YAZILMAZ (Portal DB'sine kurum host'u tasinmaz); /config icerigi de
# hicbir satira yazilmaz.
#
# KESINTI (2026-11-24, PR-R; playbook-denetci kaniti): dis `timeout` TERM'u bash'e yollar ama bash on
# plandaki adimi (kendi surec grubundaki ic timeout) bitmeden trap'i calistirmaz; KILL gelince geri alma
# hic kosmaz, sunucuda yarim kurulum kalirdi. Simdi deployment adimlari arka planda baslar ve `wait` ile
# beklenir: TERM / INT trap'i ANINDA calisir, adimi durdurur ve kurulum asamasindaysa undo_install ile
# geri alir (dosya asamasinda undo_files). SIGPIPE ve SIGHUP yok sayilir: ciktiyi okuyan taraf giderse
# (is iptali, SSH kopmasi) betik log satirinda olmez; kurulum ya tamamlanir ya geri alinir.

set -u
export LC_ALL=C
umask 022

SCRIPTS="${SPI_SCRIPTS_DIR:-/vhosting/HYSUXSCRIPTS}"
HYS_ROOT="${SPI_HYS_ROOT:-/hysdeploy}"
APP_ROOT="${SPI_APP_ROOT:-/usr/nginx/applications}"
CONF_DIR="${SPI_CONF_DIR:-/usr/nginx/conf.d}"
CURL="${SPI_CURL:-curl}"
UNZIP="${SPI_UNZIP:-unzip}"

MODE="${SPI_MODE:-}"
NS="${SPI_NS:-}"
APP="${SPI_APP:-}"
VER="${SPI_VERSION:-}"
JOB="${SPI_JOB_NO:-}"
URL="${SPI_ZIP_URL:-}"
MAX_MB="${SPI_MAX_ZIP_MB:-512}"
DL_TIMEOUT="${SPI_DOWNLOAD_TIMEOUT:-600}"
STEP_TIMEOUT="${SPI_STEP_TIMEOUT:-900}"
CFG_URLS_RAW="${SPI_CONFIG_URLS:-}"
CFG_MAX=1048576
CFG_TIMEOUT=30

STEP=check
STEP_PID=''
DONE=0
PHASE=none
NS_CREATED=0
HYS_CREATED=0
ZIP_WRITTEN=0
APPJSON_WRITTEN=0
UNDO_MSG=''
UNDO_NOTE=''
CLEANUP_NOTE=''
CFG_URLS=()
CFG_DIR=''
CFG_FILE=''
CFG_IDX=''
PY=''
TLS=()
[[ "${SPI_INSECURE:-0}" == 1 ]] && TLS=(-k)
REQUIRED_SCRIPTS=(nginx_pre_deployment.sh nginx_unzip.sh nginx_configuration.sh nginx_syntax_check.sh
  nginx_reload.sh nginx_cleanup_backup.sh nginx_delete.sh)

log() { printf '%s\n' "$*"; }

result() {
  local status="$1" step="$2" msg
  msg=$(printf '%s' "$3" | tr -d '\r' | tr '\n\t' '  ' | head -c 900)
  DONE=1
  printf 'RESULT\t%s\t%s\t%s\n' "$status" "$step" "$msg"
}

finish() {
  result "$1" "$2" "$3"
  case "$1" in
    OK | PLAN_OK | SKIP) exit 0 ;;
    *) exit 1 ;;
  esac
}

# -- Geri alma -------------------------------------------------------------------------------------

undo_ns() {
  [[ $NS_CREATED -eq 1 ]] && rmdir -- "$NS_DIR" 2>/dev/null
  return 0
}

# Indirme / zip / application.json / yeniden denetim: yalniz bu betigin yazdiklari silinir; bu
# betigin actigi dizinler yalniz bos kaldiysa silinir (rmdir). Not UNDO_NOTE'a.
undo_files() {
  if [[ $HYS_CREATED -eq 1 ]]; then
    rm -f -- "${HYS_DIR}/.${VER}.zip.part" "${HYS_DIR}/.application.json.spi-new"
    [[ $ZIP_WRITTEN -eq 1 ]] && rm -f -- "${HYS_DIR}/${VER}.zip"
    [[ $APPJSON_WRITTEN -eq 1 ]] && rm -f -- "${HYS_DIR}/application.json"
    ZIP_WRITTEN=0
    APPJSON_WRITTEN=0
    if rmdir -- "$HYS_DIR" 2>/dev/null; then
      HYS_CREATED=0
    else
      UNDO_NOTE=" (uyari: ${HYS_DIR} bos degil, birakildi)"
    fi
  fi
  undo_ns
}

# Hedef bu kosunun mu? ours | none | <neden>.
install_owner() {
  local v c d found=0
  # Baska bir isin unzip yedegi (<app>_<job>, job bizim degil) varsa ayni surumu kuran baska bir
  # deployment araya girmistir: .version esit olsa da hedef bizim sayilmaz.
  for d in "${APP_DIR}"_*; do
    [[ -d "$d" ]] || continue
    v="${d##*_}"
    if [[ "$v" =~ ^[0-9]+$ && "$v" != "$JOB" ]]; then
      printf 'baska bir isin yedegi var: %s' "${d##*/}"
      return 0
    fi
  done
  if [[ -d "$APP_DIR" && ! -L "$APP_DIR" ]]; then
    v=$(head -c 200 -- "${APP_DIR}/.version" 2>/dev/null | tr -d '\r\n')
    if [[ "$v" == "$VER" ]]; then
      printf 'ours'
    else
      printf '.version %s' "${v:-yok}"
    fi
    return 0
  fi
  if [[ -e "$APP_DIR" || -L "$APP_DIR" ]]; then
    printf 'uygulama yolu dizin degil'
    return 0
  fi
  for c in "$SERVER_CONF" "$APP_CONF"; do
    [[ -e "$c" || -L "$c" ]] || continue
    found=1
    if grep -qF -- "${APP_ROOT}/${NS}/${APP}/" "$c" 2>/dev/null; then
      continue
    fi
    if [[ "$c" == "$SERVER_CONF" ]] && grep -qF -- "application-confs/${APP}-${NS}.conf" "$c" 2>/dev/null; then
      continue
    fi
    printf 'conf baska yeri gosteriyor: %s' "${c##*/}"
    return 0
  done
  if [[ $found -eq 1 ]]; then printf 'ours'; else printf 'none'; fi
}

# Deployment adimi / dogrulama: ilk kurulum oldugu icin geri alma uygulamayi bu sunucudan
# kaldirmaktir, ama YALNIZ hedef bu kosunun ise. Sonuc UNDO_MSG'de.
undo_install() {
  local rc owner
  owner=$(install_owner)
  case "$owner" in
    ours)
      log "== geri alma: nginx_delete.sh ${NS} ${APP}"
      bounded_script "${SCRIPTS}/nginx_delete.sh" "$NS" "$APP"
      rc=$?
      if [[ $rc -eq 0 ]]; then
        undo_ns
        UNDO_MSG='geri alma: nginx_delete.sh rc=0 (uygulama bu sunucudan kaldirildi)'
      else
        UNDO_MSG="geri alma BASARISIZ: nginx_delete.sh rc=${rc} - elle inceleyin (nginx_delete.sh ${NS} ${APP})"
      fi
      ;;
    none)
      undo_files
      UNDO_MSG="geri alma: hedef olusmamisti, indirilen dosyalar silindi${UNDO_NOTE}"
      ;;
    *)
      UNDO_MSG="geri alma yapilmadi: hedef baska bir surec tarafindan degistirilmis (${owner}) - elle inceleyin"
      ;;
  esac
}

on_exit() {
  local rc=$?
  [[ -n "$CFG_DIR" ]] && rm -rf -- "$CFG_DIR"
  [[ $DONE -eq 1 ]] && return 0
  case "$PHASE" in
    files) undo_files ;;
  esac
  local extra=''
  [[ "$PHASE" == install ]] && extra=" - kurulum yarim kalmis olabilir: nginx_delete.sh ${NS} ${APP} ile geri alin"
  result FAIL "$STEP" "beklenmeyen cikis (rc=${rc})${extra}"
}

# TERM / INT (dis sure siniri, is iptali): suren adimi durdur, asamaya gore geri al, TEK RESULT yaz.
# Ikinci sinyal handler'i bolmesin diye sinyaller burada yok sayilir; dis `timeout -k` payi geri almaya
# yetecek kadar genistir (playbook: indirme + adim suresi + 60 sn).
on_term() {
  trap '' TERM INT
  if [[ -n "$STEP_PID" ]]; then
    kill -TERM "$STEP_PID" 2>/dev/null
    wait "$STEP_PID" 2>/dev/null
    STEP_PID=''
  fi
  case "$PHASE" in
    install) fail_install "$STEP" "kesildi (TERM/INT: sure siniri ya da is iptali)" ;;
    files) fail_files "$STEP" "kesildi (TERM/INT: sure siniri ya da is iptali)" ;;
    *) finish FAIL "$STEP" "kesildi (TERM/INT: sure siniri ya da is iptali)" ;;
  esac
}
trap on_exit EXIT
trap on_term TERM INT
trap '' PIPE HUP

# Sure sinirli deployment betigi ARKA PLANDA + wait: TERM trap'i adim bitmeden calisabilsin. Deployment
# betikleri SIGPIPE'i varsayilan haliyle alir (bu betigin yok saymasi miras kalmasin); SIGHUP yok sayili kalir:
# kopan baglanti adimi yarida kesmez.
bounded_script() {
  local rc
  (
    trap - PIPE
    exec timeout -k 10 "$STEP_TIMEOUT" bash "$@"
  ) </dev/null 2>&1 &
  STEP_PID=$!
  wait "$STEP_PID"
  rc=$?
  STEP_PID=''
  return $rc
}

# -- Girdi -----------------------------------------------------------------------------------------

validate_inputs() {
  [[ "$MODE" == plan || "$MODE" == apply ]] || finish FAIL check "gecersiz mod"
  [[ "$NS" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ && ${#NS} -le 63 ]] || finish FAIL check "gecersiz namespace"
  [[ "$APP" =~ ^[A-Za-z0-9]([-A-Za-z0-9._]*[A-Za-z0-9])?$ && ${#APP} -le 253 ]] || finish FAIL check "gecersiz uygulama adi"
  [[ "$VER" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || finish FAIL check "gecersiz surum"
  [[ "$JOB" =~ ^[0-9]{1,18}$ ]] || finish FAIL check "gecersiz job numarasi"
  [[ "$MAX_MB" =~ ^[1-9][0-9]{0,4}$ ]] || finish FAIL check "gecersiz paket boyut siniri"
  [[ "$DL_TIMEOUT" =~ ^[1-9][0-9]{0,4}$ ]] || finish FAIL check "gecersiz indirme suresi"
  [[ "$STEP_TIMEOUT" =~ ^[1-9][0-9]{0,4}$ ]] || finish FAIL check "gecersiz adim suresi"
  [[ "$URL" =~ ^https://[^[:space:]]+$ ]] || finish FAIL check "paket adresi https:// ile baslamiyor"
  [[ "$URL" == *"/${NS}/${APP}/${VER}.zip" ]] || finish FAIL check "paket adresi namespace / uygulama / surumle bitmiyor"
  validate_config_urls
}

# SPI_CONFIG_URLS: 1..3 tekil https://<host>/config, TEK bosluk ayrimli, satir sonu yok. Host deseni
# Portal (paket-kurulum.cjs ROUTE_HOST_RE) ve playbook (spi_config_url_re) ile ayni: en az bir nokta,
# harfle baslayan son etiket (IP literal'i, localhost, tek etiketli ad gecmez), en cok 253 karakter.
CFG_URL_RE='https://([A-Za-z0-9-]{1,63}[.])+[A-Za-z][A-Za-z0-9-]{0,62}/config'
validate_config_urls() {
  local u seen=' ' all_re="^${CFG_URL_RE}( ${CFG_URL_RE}){0,2}\$" one_re="^${CFG_URL_RE}\$"
  # Tum deger tek seferde: read -a yalniz ilk satiri okur, satir sonundan sonraki adres sessizce dusmesin.
  [[ "$CFG_URLS_RAW" =~ $all_re ]] || finish FAIL check "config adresleri 1..3 adet, tek bosluk ayrimli https://<host>/config olmali"
  read -r -a CFG_URLS <<<"$CFG_URLS_RAW"
  [[ ${#CFG_URLS[@]} -ge 1 && ${#CFG_URLS[@]} -le 3 ]] || finish FAIL check "config adresi sayisi 1..3 olmali (${#CFG_URLS[@]})"
  for u in "${CFG_URLS[@]}"; do
    [[ "$u" =~ $one_re && ${#u} -le 268 ]] || finish FAIL check "config adresi https://<host>/config bicimine uymuyor"
    [[ "$seen" != *" ${u} "* ]] || finish FAIL check "config adresi tekrarli"
    seen+="${u} "
  done
}

# -- PLAN ------------------------------------------------------------------------------------------

check_scripts() {
  local s missing=()
  for s in "${REQUIRED_SCRIPTS[@]}"; do
    [[ -f "${SCRIPTS}/${s}" ]] || missing+=("$s")
  done
  [[ ${#missing[@]} -eq 0 ]] || finish FAIL check "eksik deployment betigi (${SCRIPTS}): ${missing[*]}"
}

# Var olan hedefler (bosluk ayrimli); yoksa bos.
present_targets() {
  local t out=''
  for t in "$APP_DIR" "$SERVER_CONF" "$APP_CONF"; do
    [[ -e "$t" || -L "$t" ]] && out+="${t} "
  done
  printf '%s' "${out% }"
}

check_targets() {
  local p
  p=$(present_targets)
  [[ -z "$p" ]] || finish SKIP check "zaten kurulu (${p})"
}

check_hys() {
  if [[ -e "$HYS_DIR" || -L "$HYS_DIR" ]]; then
    finish SKIP check "paket dizini zaten var (pipeline yuklemis olabilir); elle bakin (${HYS_DIR})"
  fi
  [[ -L "$NS_DIR" ]] && finish FAIL check "${NS_DIR} sembolik bag"
  if [[ -e "$NS_DIR" ]]; then
    [[ -d "$NS_DIR" ]] || finish FAIL check "${NS_DIR} dizin degil"
    [[ -w "$NS_DIR" && -x "$NS_DIR" ]] || finish FAIL check "${NS_DIR} yazilabilir degil"
  else
    [[ -d "$HYS_ROOT" && -w "$HYS_ROOT" && -x "$HYS_ROOT" ]] || finish FAIL check "${HYS_ROOT} yazilabilir degil"
  fi
}

# HEAD: 200, Content-Type ZIP, Content-Length (varsa) siniri icinde. Yonlendirmede (-L) her
# basliklar blogu kendi degerlerini sifirlar; son blok sayilir. PKG_BYTES'a boyut (bilinmiyorsa bos).
PKG_BYTES=''
check_package() {
  local hdr rc code len ct ct_base
  hdr=$("$CURL" -sSI -g -L --max-redirs 3 --proto '=https' --proto-redir '=https' --max-time 60 \
    ${TLS[@]+"${TLS[@]}"} "$URL" 2>&1 </dev/null)
  rc=$?
  [[ $rc -eq 0 ]] || finish FAIL check "paket adresine erisilemedi (curl rc=${rc})"
  hdr=$(printf '%s\n' "$hdr" | tr -d '\r')
  code=$(printf '%s\n' "$hdr" | awk '/^HTTP\//{c=$2} END{print c}')
  [[ "$code" == 200 ]] || finish FAIL check "paket bulunamadi ya da erisilemiyor (HTTP ${code:-?})"
  ct=$(printf '%s\n' "$hdr" | awk '/^HTTP\//{t=""} tolower($1)=="content-type:"{sub(/^[^:]*:[ \t]*/, ""); t=$0} END{print t}')
  ct=$(printf '%s' "$ct" | head -c 100)
  ct_base=${ct%%;*}
  ct_base=$(printf '%s' "$ct_base" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
  case "$ct_base" in
    application/zip | application/x-zip-compressed | application/octet-stream) ;;
    *) finish FAIL check "paket ZIP degil (Content-Type: ${ct:-yok})" ;;
  esac
  len=$(printf '%s\n' "$hdr" | awk '/^HTTP\//{l=""} tolower($1)=="content-length:"{l=$2} END{print l}')
  if [[ "$len" =~ ^[0-9]{1,15}$ ]]; then
    PKG_BYTES=$len
    [[ $len -le $((MAX_MB * 1048576)) ]] || finish FAIL check "paket cok buyuk (${len} bayt > ${MAX_MB} MB)"
  fi
}

# JSON denetimi icin python: SPI_PYTHON (mutlak yol), sonra bilinen adlar. Ansible bu sunucuda
# modul kosturdugu icin bir yorumlayici vardir; bulunamazsa FAIL (yapisal tahmine dusulmez).
find_python() {
  local c
  for c in "${SPI_PYTHON:-}" /usr/libexec/platform-python python3 python; do
    [[ -n "$c" ]] || continue
    if [[ "$c" == /* ]]; then
      [[ -x "$c" ]] || continue
    else
      command -v -- "$c" >/dev/null 2>&1 || continue
    fi
    if "$c" -E -s -c 'import json' </dev/null >/dev/null 2>&1; then
      PY="$c"
      return 0
    fi
  done
  return 1
}

# stdin'deki icerik: 0 JSON nesnesi, 3 JSON ama nesne degil, 2 gecersiz JSON / UTF-8 degil.
JSON_CHECK='import json, sys
data = getattr(sys.stdin, "buffer", sys.stdin).read()
try:
    doc = json.loads(data.decode("utf-8-sig"))
except Exception:
    sys.exit(2)
sys.exit(0 if isinstance(doc, dict) else 3)'

# Tek /config adresi: gecerliyse 0; degilse CFG_WHY'a neden (adres YAZILMAZ).
# Govde stdout'tan head -c ile en cok CFG_MAX+1 bayt alinir: --max-filesize yalniz bilinen boyutta
# (Content-Length) isler, eski curl (8.4 oncesi) chunked yanitta govdeyi kesmez; siniri asan yanit
# boru kapaninca durur (curl rc=23) ve '1 MB ustu' sayilir. Durum kodu -D basliklarindan (son blok).
CFG_WHY=''
fetch_one_config() {
  local url="$1" out="$2" hdr="${2}.hdr" code rc size first
  rm -f -- "$out" "$hdr"
  "$CURL" -sS -g -L --max-redirs 3 --proto '=https' --proto-redir '=https' --max-time "$CFG_TIMEOUT" \
    --max-filesize "$CFG_MAX" ${TLS[@]+"${TLS[@]}"} -D "$hdr" -o - "$url" </dev/null 2>/dev/null \
    | head -c "$((CFG_MAX + 1))" >"$out"
  rc=${PIPESTATUS[0]}
  size=$(wc -c <"$out" 2>/dev/null | tr -d '[:space:]')
  code=$(tr -d '\r' <"$hdr" 2>/dev/null | awk '/^HTTP\//{c=$2} END{print c}')
  rm -f -- "$hdr"
  if [[ $rc -eq 63 || ("$size" =~ ^[0-9]+$ && "$size" -gt "$CFG_MAX") ]]; then
    CFG_WHY='1 MB ustu'
    return 1
  fi
  if [[ $rc -ne 0 ]]; then
    CFG_WHY="erisilemedi (curl rc=${rc})"
    return 1
  fi
  if [[ "$code" != 200 ]]; then
    CFG_WHY="HTTP ${code:-?}"
    return 1
  fi
  if [[ ! "$size" =~ ^[0-9]+$ || "$size" -eq 0 ]]; then
    CFG_WHY='bos yanit'
    return 1
  fi
  first=$(head -c 512 -- "$out" | tr -d '[:space:]' | head -c 1)
  if [[ "$first" == '<' ]]; then
    CFG_WHY='HTML dondu (JSON degil)'
    return 1
  fi
  "$PY" -E -s -c "$JSON_CHECK" <"$out" >/dev/null 2>&1
  rc=$?
  case $rc in
    0) return 0 ;;
    3) CFG_WHY='JSON nesnesi degil (dizi ya da tek deger)' ;;
    *) CFG_WHY='gecerli JSON degil' ;;
  esac
  return 1
}

# /config adresleri sirayla; ilk gecerli JSON nesnesi CFG_FILE'a. Hicbiri gecmezse FAIL config.
check_config() {
  STEP=config
  local i=0 u notes=''
  find_python || finish FAIL config "JSON denetimi icin python bulunamadi"
  CFG_DIR=$(mktemp -d "${TMPDIR:-/tmp}/.spa_package_cfg.XXXXXX" 2>/dev/null) || {
    CFG_DIR=''
    finish FAIL config "gecici dizin acilamadi"
  }
  for u in "${CFG_URLS[@]}"; do
    i=$((i + 1))
    if fetch_one_config "$u" "${CFG_DIR}/config.json"; then
      CFG_FILE="${CFG_DIR}/config.json"
      CFG_IDX=$i
      return 0
    fi
    notes+="${notes:+; }${i}. adres: ${CFG_WHY}"
  done
  rm -f -- "${CFG_DIR}/config.json"
  finish FAIL config "application.json /config'ten alinamadi (${notes})"
}

plan_checks() {
  check_scripts
  check_targets
  check_hys
  check_package
  check_config
}

size_text() {
  if [[ -n "$PKG_BYTES" ]]; then
    printf '%s MB' "$(((PKG_BYTES + 1048575) / 1048576))"
  else
    printf 'boyut bilinmiyor'
  fi
}

# -- APPLY -----------------------------------------------------------------------------------------

fail_files() {
  undo_files
  finish FAIL "$1" "$2${UNDO_NOTE}"
}

prepare_dirs() {
  STEP=download
  PHASE=files
  if [[ ! -d "$NS_DIR" ]]; then
    if mkdir -- "$NS_DIR" 2>/dev/null; then
      NS_CREATED=1
      chmod 0777 -- "$NS_DIR" || fail_files download "${NS_DIR} yukleyiciye yazilabilir yapilamadi"
    elif [[ ! -d "$NS_DIR" ]]; then
      fail_files download "dizin olusturulamadi: ${NS_DIR}"
    fi
  fi
  [[ -L "$NS_DIR" ]] && fail_files download "${NS_DIR} sembolik bag"
  mkdir -- "$HYS_DIR" 2>/dev/null \
    || fail_files download "paket dizini acilamadi ya da kurulum sirasinda baska bir surec acti: ${HYS_DIR}"
  HYS_CREATED=1
}

# Govde stdout'tan head -c ile en cok siniri + 1 bayt alinir (config ile ayni koruma): --max-filesize yalniz
# Content-Length bilinirken isler; eski curl (RHEL 8: 7.61) chunked yanitta govdeyi kesmez, /hysdeploy
# indirme boyunca dolabilirdi. Siniri asan yanit boru kapaninca durur (curl rc=23) ve 'boyut siniri' sayilir.
download() {
  local part="${HYS_DIR}/.${VER}.zip.part" rc lim=$((MAX_MB * 1048576)) size
  prepare_dirs
  "$CURL" -fsS -g -L --max-redirs 3 --proto '=https' --proto-redir '=https' --max-time "$DL_TIMEOUT" \
    --max-filesize "$lim" ${TLS[@]+"${TLS[@]}"} -o - "$URL" </dev/null | head -c "$((lim + 1))" >"$part"
  rc=${PIPESTATUS[0]}
  size=$(wc -c <"$part" 2>/dev/null | tr -d '[:space:]')
  if [[ $rc -eq 63 || ("$size" =~ ^[0-9]+$ && "$size" -gt "$lim") ]]; then
    fail_files download "paket boyut siniri asildi (${MAX_MB} MB)"
  elif [[ $rc -ne 0 ]]; then
    fail_files download "paket indirilemedi (curl rc=${rc})"
  fi
  [[ -s "$part" ]] || fail_files download "indirilen paket bos"
}

zip_check() {
  STEP=zip_check
  local part="${HYS_DIR}/.${VER}.zip.part" target="${HYS_DIR}/${VER}.zip"
  "$UNZIP" -tq "$part" </dev/null >/dev/null 2>&1 || fail_files zip_check "paket bozuk (unzip -t basarisiz)"
  "$UNZIP" -Z1 "$part" </dev/null 2>/dev/null | tr -d '\r' | grep -qxE '(\./)?index\.html' \
    || fail_files zip_check "arsiv kokunde index.html yok"
  if [[ -e "$target" || -L "$target" ]]; then
    fail_files zip_check "hedef paket zaten var, uzerine yazilmadi: ${VER}.zip"
  fi
  mv -n -- "$part" "$target" 2>/dev/null
  [[ ! -e "$part" && -f "$target" ]] || fail_files zip_check "paket yerine konamadi"
  ZIP_WRITTEN=1
}

write_appjson() {
  STEP=write
  local target="${HYS_DIR}/application.json" tmp="${HYS_DIR}/.application.json.spi-new"
  [[ -s "$CFG_FILE" ]] || fail_files write "application.json (/config icerigi) bos"
  cp -- "$CFG_FILE" "$tmp" 2>/dev/null || fail_files write "application.json gecici dosyaya yazilamadi"
  [[ "$(wc -c <"$tmp")" == "$(wc -c <"$CFG_FILE")" ]] || fail_files write "application.json kopyasi eksik yazildi"
  if [[ -e "$target" || -L "$target" ]]; then
    fail_files write "application.json zaten var, uzerine yazilmadi"
  fi
  chmod 0644 -- "$tmp" || fail_files write "application.json izni verilemedi"
  mv -n -- "$tmp" "$target" 2>/dev/null
  [[ ! -e "$tmp" && -f "$target" ]] || fail_files write "application.json yazilamadi"
  APPJSON_WRITTEN=1
}

# Indirme sirasinda baska bir deployment hedefi olusturduysa kurulum baslamaz.
recheck_targets() {
  STEP=check
  local p
  p=$(present_targets)
  [[ -z "$p" ]] || fail_files check "kurulum sirasinda baska bir deployment hedefi olusturdu (${p}); indirilen dosyalar silindi"
}

run_step() {
  local name="$1" rc
  STEP="$name"
  log "== ${name}: nginx_${name}.sh prod ${NS} ${APP} ${VER} portal / ${JOB}"
  bounded_script "${SCRIPTS}/nginx_${name}.sh" prod "$NS" "$APP" "$VER" portal / "$JOB"
  rc=$?
  [[ $rc -eq 0 ]] && return 0
  fail_install "$name" "nginx_${name}.sh rc=${rc}"
}

fail_install() {
  undo_install
  finish FAIL "$1" "$2; ${UNDO_MSG}"
}

http_code() {
  "$CURL" -sk -o /dev/null -w '%{http_code}' --max-time 20 --resolve "${1}:443:${2}" "https://${1}${3}" </dev/null 2>/dev/null
}

verify() {
  STEP=verify
  local name ip code path
  name=$(sed -n -E 's/^[[:space:]]*server_name[[:space:]]+([^;[:space:]]+).*/\1/p' "$SERVER_CONF" 2>/dev/null | head -n 1)
  ip=$(sed -n -E 's/^[[:space:]]*listen[[:space:]]+([0-9]{1,3}(\.[0-9]{1,3}){3}):443([^0-9].*)?$/\1/p' "$SERVER_CONF" 2>/dev/null | head -n 1)
  [[ "$name" =~ ^[A-Za-z0-9]([-A-Za-z0-9.]*[A-Za-z0-9])?$ ]] || fail_install verify "server_name okunamadi (${SERVER_CONF})"
  [[ -n "$ip" ]] || fail_install verify "listen IP okunamadi (${SERVER_CONF})"
  for path in / /config; do
    code=$(http_code "$name" "$ip" "$path")
    [[ "$code" == 200 ]] || fail_install verify "${path} HTTP ${code:-?} (beklenen 200)"
  done
}

cleanup_backup() {
  STEP=cleanup
  local rc
  log "== cleanup_backup: nginx_cleanup_backup.sh prod ${NS} ${APP} ${VER} portal / ${JOB}"
  bounded_script "${SCRIPTS}/nginx_cleanup_backup.sh" prod "$NS" "$APP" "$VER" portal / "$JOB"
  rc=$?
  [[ $rc -eq 0 ]] || CLEANUP_NOTE=" (uyari: nginx_cleanup_backup.sh rc=${rc})"
}

apply() {
  download
  zip_check
  write_appjson
  recheck_targets
  PHASE=install
  local s
  for s in pre_deployment unzip configuration syntax_check reload; do
    run_step "$s"
  done
  verify
  PHASE=done
  cleanup_backup
  finish OK cleanup "kuruldu: surum ${VER}, application.json ${CFG_IDX}. config adresinden, / ve /config 200${CLEANUP_NOTE}"
}

main() {
  validate_inputs
  NS_DIR="${HYS_ROOT}/${NS}"
  HYS_DIR="${NS_DIR}/${APP}"
  APP_DIR="${APP_ROOT}/${NS}/${APP}"
  SERVER_CONF="${CONF_DIR}/${APP}-${NS}.conf"
  APP_CONF="${CONF_DIR}/application-confs/${APP}-${NS}.conf"
  plan_checks
  if [[ "$MODE" == plan ]]; then
    finish PLAN_OK check "kurulabilir: paket erisilebilir ($(size_text)), application.json ${CFG_IDX}. config adresinden alindi (JSON nesnesi), hedef ve paket dizini bos"
  fi
  apply
}

main
