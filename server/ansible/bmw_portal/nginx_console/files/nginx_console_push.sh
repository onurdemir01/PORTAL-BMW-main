#!/bin/bash
# nginx_console_push.sh — Portal > Nginx Hub'ndan gelen TEK dosya degisikligini uygular.
# Ortam degiskenleri (playbook verir):
#   CS_PATH          hedef dosya (yalniz /usr/nginx/conf.d/... veya /usr/nginx/conf/...)
#   CS_MODE          create | update
#   CS_CONTENT_B64   yeni icerik (base64)
#   CS_EXPECTED_SHA  update: Portal'in gordugu sha256 (dosya o arada degistiyse durur)
#   CS_FORCE         1 -> sha uyusmazligini yoksay
#   CS_JOB           AWX job no (yedek adi + kilit)
#   CS_REQUESTER     kim (gunluk)
# Cikis kodlari: 0 ok | 50 yol yasak | 51 mod/icerik hatasi | 59 kilit alinamadi
#   60 dosya Portal'dan sonra degismis | 61 create: dosya zaten var | 62 nginx -t dustu (geri alindi)
#   63 reload dustu (dosya yeni haliyle kaldi, -t temizdi)
# Son satir: RESULT|<durum>|<mesaj> — playbook bunu okur.
set -u
PREFIX="${NGINX_PREFIX:-/usr/nginx}"
BIN="${NGINX_BIN:-$PREFIX/sbin/nginx}"
BACKUP_DIR="$PREFIX/conf.d/.console_backup"
LOCK_LIB="/vhosting/HYSUXSCRIPTS/nginx_deploy_lock.sh"
JOURNAL="$PREFIX/conf.d/.console_journal.log"

log() { printf '%s %s job=%s user=%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" "${CS_JOB:-?}" "${CS_REQUESTER:-?}" "$2" >> "$JOURNAL" 2>/dev/null; }
die() { log "FAIL" "$2 ($CS_PATH)"; echo "RESULT|fail|$2"; exit "$1"; }

#### 1) Yol beyaz listesi: yalniz konfigurasyon dizinleri, ".." yok, sembolik bag yok
case "$CS_PATH" in
  "$PREFIX/conf.d/"*|"$PREFIX/conf/"*) ;;
  *) die 50 "yol izin verilen dizinlerde degil (conf.d / conf)";;
esac
case "$CS_PATH" in *..*|*/.console_backup/*) die 50 "yol gecersiz";; esac
[ -L "$CS_PATH" ] && die 50 "hedef sembolik bag"
parent="$(dirname "$CS_PATH")"
[ -d "$parent" ] || die 50 "ust dizin yok: $parent"

#### 2) Icerik
[ -n "${CS_CONTENT_B64:-}" ] || die 51 "icerik bos"
tmp="$(mktemp "$parent/.console_new.XXXXXX")" || die 51 "gecici dosya acilamadi"
trap 'rm -f "$tmp"' EXIT
printf '%s' "$CS_CONTENT_B64" | base64 -d > "$tmp" 2>/dev/null || die 51 "base64 cozulemedi"

#### 3) Kilit (SPA deployment'larla ayni kilit; kutuphane yoksa kilitsiz devam)
if [ -f "$LOCK_LIB" ]; then
  # shellcheck disable=SC1090
  . "$LOCK_LIB"
  deploy_lock_acquire "${CS_JOB:-console}" "console_push" || die 59 "deployment kilidi alinamadi (baska is calisiyor)"
fi

#### 4) Mod kontrolleri
case "${CS_MODE:-update}" in
  update)
    [ -f "$CS_PATH" ] || die 60 "dosya yok (update): $CS_PATH"
    cur="$(sha256sum "$CS_PATH" | awk '{print $1}')"
    if [ "${CS_FORCE:-0}" != "1" ] && [ -n "${CS_EXPECTED_SHA:-}" ] && [ "$cur" != "$CS_EXPECTED_SHA" ]; then
      die 60 "dosya Portal'in gordugunden sonra degismis (sha $cur) - yenileyip tekrar deneyin"
    fi
    ;;
  create)
    [ -e "$CS_PATH" ] && die 61 "dosya zaten var (create): $CS_PATH"
    ;;
  *) die 51 "gecersiz mod: ${CS_MODE:-}";;
esac

#### 5) Yedek + yaz (sahiplik/mod korunur)
mkdir -p "$BACKUP_DIR" 2>/dev/null
bak=""
if [ -f "$CS_PATH" ]; then
  bak="$BACKUP_DIR/$(basename "$CS_PATH").$(date '+%Y%m%d_%H%M%S').${CS_JOB:-x}"
  cp -p "$CS_PATH" "$bak" || die 51 "yedek alinamadi"
  chmod --reference="$CS_PATH" "$tmp" 2>/dev/null
  chown --reference="$CS_PATH" "$tmp" 2>/dev/null
else
  chmod 644 "$tmp"
fi
mv -f "$tmp" "$CS_PATH" || die 51 "dosya yazilamadi"
trap - EXIT
log "WRITE" "mode=${CS_MODE:-update} backup=${bak:-none}"

#### 6) nginx -t ; dusserse geri al
if ! tout="$($BIN -p "$PREFIX/" -c "$PREFIX/nginx.conf" -t 2>&1)"; then
  if [ -n "$bak" ]; then cp -p "$bak" "$CS_PATH"; else rm -f "$CS_PATH"; fi
  log "ROLLBACK" "nginx -t dustu"
  printf '%s\n' "$tout"
  die 62 "nginx -t basarisiz, degisiklik GERI ALINDI: $(printf '%s' "$tout" | tr '\n' ' ' | cut -c1-300)"
fi
printf '%s\n' "$tout"

#### 7) reload
if ! rout="$($BIN -p "$PREFIX/" -c "$PREFIX/nginx.conf" -s reload 2>&1)"; then
  printf '%s\n' "$rout"
  log "RELOAD_FAIL" "$rout"
  echo "RESULT|partial|dosya yazildi ve -t temiz ama reload dustu: $(printf '%s' "$rout" | tr '\n' ' ' | cut -c1-200)"
  exit 63
fi
log "OK" "reload tamam backup=${bak:-none}"
echo "RESULT|ok|${CS_MODE:-update} tamam, nginx reload edildi; yedek: ${bak:-yok}"
exit 0
