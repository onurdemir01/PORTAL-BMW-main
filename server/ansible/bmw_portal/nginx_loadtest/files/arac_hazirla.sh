#!/bin/bash
# arac_hazirla.sh - Portal Nginx Hub "Yuk Testi" araclar kipi: k6 arsivinden ikiliyi cikarir, wrk'yi derler, dogrular.
# Kullanim: arac_hazirla.sh <dizin>      (www ile, Play 8; dizin <www ev>/.portal_yuktesti/arac_<id>, /tmp DEGIL)
# Girdi   : <dizin>/indir/k6.tar.gz (resmi k6-<K6_SURUM>-linux-amd64 arsivi; Play 8 resmi checksums satiriyla dogruladi)
#           ve <dizin>/indir/wrk.tar.gz (wg/wrk <WRK_SURUM> etiket arsivi). Ortam: K6_SURUM, WRK_SURUM, TMPDIR.
# Cikti   : <dizin>/cikti/k6 ve <dizin>/cikti/wrk (0700); stdout'a anahtar<TAB>deger satirlari (derleme_rhel derleme_glibc
#           derleme_os k6_surum_satiri k6_statik k6_glibc_gerekli wrk_surum_satiri wrk_kutuphaneler wrk_glibc_gerekli
#           wrk_openssl wrk_luajit; olculemeyen '-'), son satir SONUC<TAB><OK|FAIL><TAB><mesaj>.
# Kural   : ag erisimi YOK (indirme yalniz Play 8'in get_url gorevlerinde); vekil ortami silinir; wrk arsivdeki
#           varsayilan Makefile ile derlenir (deps/ altindaki paketli OpenSSL ve LuaJIT statik baglanir: ikili yalniz
#           glibc'ye bagli; sistem OpenSSL'i ve islemciye ozgu bayrak verilmez), 'make VER=<WRK_SURUM>' (arsivde .git yok).
#           Arsiv uyesi kosu dizini disina yazamaz: liste once denetlenir, cikarma --no-same-owner --no-same-permissions.
# Cikis   : 0 tamam, 2 girdi hatasi, 3 derleme araci yok, 4 arsiv / derleme / dogrulama hatasi. derleme/ ve tmp/ cikista
#           silinir (Play 8 always tum dizini siler).
set -u
export LC_ALL=C
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

temiz() { printf '%s' "$1" | tr '\t\r\n' '   ' | tr -c ' -~' '?' | cut -c1-"$2"; }
sonuc() { printf 'SONUC\t%s\t%s\n' "$1" "$(temiz "$2" 300)"; }
bilgi() { printf '%s\t%s\n' "$1" "$(temiz "$2" 200)"; }
dur() { sonuc FAIL "$2"; exit "$1"; }

D="${1:-}"
D="${D%/}"
[[ "$D" =~ ^/[A-Za-z0-9._/-]+/[.]portal_yuktesti/arac_[0-9]{1,10}$ ]] || dur 2 "derleme dizini gecersiz: $D"
[[ "$D" != *"/../"* ]] || dur 2 "derleme dizininde .. var"
K6_SURUM="${K6_SURUM:-}"
W="${WRK_SURUM:-}"
[[ "$K6_SURUM" =~ ^v0[.](4[5-9]|5[0-9])[.][0-9]{1,2}$ ]] || dur 2 "K6_SURUM gecersiz: $K6_SURUM"
[ "$W" = 4.2.0 ] || dur 2 "WRK_SURUM gecersiz: $W (yalniz 4.2.0)"
for f in "$D/indir/k6.tar.gz" "$D/indir/wrk.tar.gz"; do
  [ -f "$f" ] && [ ! -L "$f" ] && [ -s "$f" ] || dur 2 "arsiv yok ya da bos: ${f##*/}"
done
for a in tar gzip gcc make perl objdump ldd getconf sha256sum strings nproc; do
  command -v "$a" >/dev/null 2>&1 || dur 3 "derleme araci yok: $a"
done
trap 'rm -rf "$D/derleme" "$D/tmp"' EXIT
mkdir -p "$D/derleme" "$D/cikti" "$D/tmp" || dur 4 "derleme dizinleri olusturulamadi"

RHEL=-; OS=-
if [ -r /etc/os-release ]; then
  OS_ID="$(sed -n 's/^ID=//p' /etc/os-release | tr -d '"' | head -1)"
  OS_VID="$(sed -n 's/^VERSION_ID=//p' /etc/os-release | tr -d '"' | head -1)"
  OS_AD="$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release | tr -d '"' | head -1)"
  case "$OS_ID" in rhel|centos|rocky|almalinux) RHEL="${OS_VID%%.*}" ;; esac
  [ -n "$OS_AD" ] && OS="$OS_AD"
fi
[[ "$RHEL" =~ ^[0-9]+$ ]] || RHEL=-
GLIBC="$(getconf GNU_LIBC_VERSION 2>/dev/null)"
GLIBC="${GLIBC#* }"
[[ "$GLIBC" =~ ^[0-9]+[.][0-9]+$ ]] || GLIBC=-
bilgi derleme_rhel "$RHEL"
bilgi derleme_glibc "$GLIBC"
bilgi derleme_os "$(temiz "$OS" 60)"

# arsiv uyeleri: bos olmayan liste, her uye <onek>/ ile baslar, '..' parcasi ve mutlak yol yok
uyeler_temiz() {
  local liste u
  liste="$(tar -tzf "$1" 2>/dev/null)" || return 1
  [ -n "$liste" ] || return 1
  while IFS= read -r u; do
    case "$u" in "$2"/*) ;; *) return 1 ;; esac
    case "/$u/" in */../*) return 1 ;; esac
  done <<< "$liste"
  return 0
}
glibc_gerekli() {
  local v
  v="$(objdump -T "$1" 2>/dev/null | grep -o 'GLIBC_[0-9][0-9.]*' | sed 's/GLIBC_//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
  if [ -n "$v" ]; then printf '%s' "$v"; else printf -; fi
}

K6_ONEK="k6-${K6_SURUM}-linux-amd64"
uyeler_temiz "$D/indir/k6.tar.gz" "$K6_ONEK" || dur 4 "k6 arsivi beklenmeyen uye iceriyor"
tar -xzf "$D/indir/k6.tar.gz" -C "$D/derleme" --no-same-owner --no-same-permissions "$K6_ONEK/k6" 2>/dev/null \
  || dur 4 "k6 arsivinde k6 ikilisi yok"
[ -f "$D/derleme/$K6_ONEK/k6" ] && [ ! -L "$D/derleme/$K6_ONEK/k6" ] || dur 4 "k6 arsivinde k6 ikilisi yok"
install -m 0700 "$D/derleme/$K6_ONEK/k6" "$D/cikti/k6" || dur 4 "k6 ikilisi cikti dizinine konamadi"
K6_SATIR="$(timeout 30 "$D/cikti/k6" version 2>&1 | head -1)"
case "$K6_SATIR" in "k6 $K6_SURUM"|"k6 $K6_SURUM "*) ;; *) dur 4 "k6 surumu beklenen degil: $K6_SATIR" ;; esac
if ldd "$D/cikti/k6" 2>&1 | grep -q 'not a dynamic executable'; then K6_STATIK=1; else K6_STATIK=0; fi
bilgi k6_surum_satiri "$K6_SATIR"
bilgi k6_statik "$K6_STATIK"
bilgi k6_glibc_gerekli "$(glibc_gerekli "$D/cikti/k6")"

WRK_ONEK="wrk-$W"
uyeler_temiz "$D/indir/wrk.tar.gz" "$WRK_ONEK" || dur 4 "wrk kaynak arsivi beklenmeyen uye iceriyor"
tar -xzf "$D/indir/wrk.tar.gz" -C "$D/derleme" --no-same-owner --no-same-permissions 2>/dev/null \
  || dur 4 "wrk kaynak arsivi acilamadi"
OSSL=0; LJ=0
for e in "$D/derleme/$WRK_ONEK/deps"/*; do
  [ -e "$e" ] || continue
  n="${e##*/}"
  case "$n" in openssl-*) OSSL=1 ;; esac
  case "$(printf '%s' "$n" | tr 'A-Z' 'a-z')" in *luajit*) LJ=1 ;; esac
done
[ "$OSSL" = 1 ] && [ "$LJ" = 1 ] || dur 4 "kaynak arsivinde deps/ (OpenSSL / LuaJIT) eksik"
J="$(nproc 2>/dev/null)"
[[ "$J" =~ ^[0-9]+$ ]] && [ "$J" -ge 1 ] || J=1
[ "$J" -le 4 ] || J=4
make -C "$D/derleme/$WRK_ONEK" -j "$J" VER="${WRK_SURUM}" > "$D/derleme.log" 2>&1
rc=$?
if [ "$rc" -ne 0 ]; then
  dur 4 "make basarisiz (rc $rc): $(temiz "$(tail -3 "$D/derleme.log" 2>/dev/null)" 200)"
fi
[ -f "$D/derleme/$WRK_ONEK/wrk" ] && [ ! -L "$D/derleme/$WRK_ONEK/wrk" ] || dur 4 "make wrk ikilisini uretmedi"
install -m 0700 "$D/derleme/$WRK_ONEK/wrk" "$D/cikti/wrk" || dur 4 "wrk ikilisi cikti dizinine konamadi"
WRK_SATIR="$(timeout 30 "$D/cikti/wrk" -v 2>&1 | head -5 | grep -m1 '^wrk ')"
case "$WRK_SATIR" in "wrk $W "*) ;; *) dur 4 "wrk surumu beklenen degil: $WRK_SATIR" ;; esac
LIBS="$(ldd "$D/cikti/wrk" 2>/dev/null | sed -n 's/^[[:space:]]*\([^[:space:]][^[:space:]]*\).*/\1/p' | tr '\n' ',')"
LIBS="${LIBS%,}"
IFS=',' read -r -a LIB_DIZI <<< "$LIBS"
for l in ${LIB_DIZI[@]+"${LIB_DIZI[@]}"}; do
  case "$l" in *libssl*|*libcrypto*|*libluajit*|*liblua*)
    dur 4 "wrk sistem kutuphanesine bagli ($l): paketli OpenSSL/LuaJIT ile derlenmedi" ;;
  esac
done
OPENSSL="$(strings "$D/cikti/wrk" 2>/dev/null | grep -m1 -E '^OpenSSL [0-9]+[.][0-9]+[.][0-9]+[a-z]? ')"
LUAJIT="$(strings "$D/cikti/wrk" 2>/dev/null | grep -m1 -E '^LuaJIT [0-9]')"
bilgi wrk_surum_satiri "$WRK_SATIR"
bilgi wrk_kutuphaneler "${LIBS:--}"
bilgi wrk_glibc_gerekli "$(glibc_gerekli "$D/cikti/wrk")"
bilgi wrk_openssl "$(temiz "${OPENSSL:--}" 40)"
bilgi wrk_luajit "$(temiz "${LUAJIT:--}" 40)"
sonuc OK "k6 $K6_SURUM ve wrk $W hazir"
exit 0
