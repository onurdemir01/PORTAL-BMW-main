#!/usr/bin/env bash
# deploy/install-node.sh — resmi nodejs.org Linux ikilisini Portal'a OZEL kurar (root GEREKMEZ).
#
# NEDEN (2026-10-23): sunucunun dnf deposu yamali Node'u getirmedi ("Nothing to do"; depo
# 22.22.2'de, Ekim guvenlik yayini 22.23.4). Resmi ikili tek dizine acilir, RPM'e dokunmaz,
# sistemdeki /usr/bin/node yerinde kalir. run.sh / release*.sh / systemd birimi
# <BASE_DIR>/runtime/node varsa onu ONCE kullanir; yoksa davranis degismez.
#
# Kullanim (was kullanicisiyla):
#   ./deploy/install-node.sh <node-vX.Y.Z-linux-x64.tar.xz|.tar.gz> [SHASUMS256.txt]
#   SHASUMS256.txt verilmezse tarball'un yanindaki aranir. Checksum DOGRULANAMAZSA KURULMAZ.
#
# Sonuc:
#   <BASE_DIR>/runtime/node-vX.Y.Z-linux-x64/   (surum dizini, silinmez)
#   <BASE_DIR>/runtime/node -> o dizin           (symlink, atomik degisir)
# Geri donus: ln -sfn <onceki-surum-dizini> <BASE_DIR>/runtime/node && ./deploy/run.sh <env> restart
# Tamamen RPM'e donus: rm <BASE_DIR>/runtime/node && ./deploy/run.sh <env> restart
set -euo pipefail

BASE_DIR="${PORTAL_BASE_DIR:-/vhosting8/bmw_portal}"
RUNTIME_DIR="$BASE_DIR/runtime"

hata() { echo "HATA: $*" >&2; exit 1; }

TARBALL="${1:-}"
SUMS="${2:-}"
[[ -n "$TARBALL" ]] || { echo "Kullanim: $0 <node-vX.Y.Z-linux-x64.tar.xz> [SHASUMS256.txt]" >&2; exit 2; }
[[ -f "$TARBALL" ]] || hata "dosya yok: $TARBALL"

AD="$(basename "$TARBALL")"
case "$AD" in
  node-v*-linux-x64.tar.xz|node-v*-linux-x64.tar.gz) ;;
  *) hata "beklenen ad node-vX.Y.Z-linux-x64.tar.xz (ya da .tar.gz); gelen: $AD" ;;
esac
SURUM_DIZINI="${AD%.tar.*}"

[[ -n "$SUMS" ]] || SUMS="$(dirname "$TARBALL")/SHASUMS256.txt"
[[ -f "$SUMS" ]] || hata "SHASUMS256.txt yok ($SUMS) — tarball ile AYNI surum dizininden indirin (nodejs.org/dist/vX.Y.Z/)"

BEKLENEN="$(awk -v f="$AD" '$2 == f { print $1 }' "$SUMS")"
[[ -n "$BEKLENEN" ]] || hata "$SUMS icinde $AD satiri yok (farkli surumun SHASUMS dosyasi olabilir)"
GERCEK="$(sha256sum "$TARBALL" | awk '{ print $1 }')"
[[ "$GERCEK" == "$BEKLENEN" ]] || hata "sha256 UYUSMUYOR — dosya bozuk ya da degistirilmis, kurulmadi (beklenen $BEKLENEN, gelen $GERCEK)"
echo "[install-node] sha256 dogrulandi: $AD"

mkdir -p "$RUNTIME_DIR"
HEDEF="$RUNTIME_DIR/$SURUM_DIZINI"
if [[ -d "$HEDEF" ]]; then
  echo "[install-node] zaten acilmis: $HEDEF (yeniden acilmadi)"
else
  GECICI="$(mktemp -d "$RUNTIME_DIR/.kurulum-XXXXXX")"
  trap 'rm -rf "$GECICI"' EXIT
  tar -xf "$TARBALL" -C "$GECICI"
  [[ -x "$GECICI/$SURUM_DIZINI/bin/node" ]] || hata "arsivde $SURUM_DIZINI/bin/node yok"
  # Bu makinede calismayan ikili (glibc / mimari) symlink'e HIC baglanmaz.
  "$GECICI/$SURUM_DIZINI/bin/node" -v >/dev/null || hata "ikili bu sunucuda calismadi (glibc/mimari?) — kurulmadi"
  mv "$GECICI/$SURUM_DIZINI" "$HEDEF"
fi

ONCEKI="$(readlink "$RUNTIME_DIR/node" 2>/dev/null || true)"
# Goreli hedef: BASE_DIR tasinsa da baglanti bozulmaz. mv -T ile degisim atomik (yarim baglanti yok).
ln -sfn "$SURUM_DIZINI" "$RUNTIME_DIR/.node.yeni"
mv -Tf "$RUNTIME_DIR/.node.yeni" "$RUNTIME_DIR/node"

echo "[install-node] etkin: $("$RUNTIME_DIR/node/bin/node" -v) -> $RUNTIME_DIR/node ($SURUM_DIZINI)"
if [[ -n "$ONCEKI" && "$ONCEKI" != "$SURUM_DIZINI" ]]; then
  echo "[install-node] onceki: $ONCEKI (geri donus: ln -sfn $ONCEKI $RUNTIME_DIR/node)"
fi
echo "[install-node] simdi: ./deploy/run.sh <env> restart  (run.sh bu node'u PATH'te one alir; acilista surumu yazar)"
