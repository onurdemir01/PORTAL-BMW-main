#!/usr/bin/env bash
# deploy/stage-lib.sh — release.sh / release-git.sh'in ORTAK "once hazirla, sonra degistir"
# yardimcilari (2026-09-17).
#
# NEDEN: eski akis "stop → unzip → npm ci → build → start" idi; npm ci + build dakikalar
# surdugu icin portal o sure kapaliydi ve o pencerede sayfayi acan/yenileyen HERKES
# login ekranina dusuyordu (oturum DB'de saglamdi ama istemci ~11 sn sonra pes ediyordu:
# "release gecince herkesin session'i kopuyor"). Yeni akis: yeni surum AYRI bir dizinde
# (staging) hazirlanir — npm ci + build ESKI SURUM CALISIRKEN biter; sonra stop → dizin
# degisimi (mv, anlik) → start. Kesinti = stop + node acilisi (saniyeler).
#
# Kullanim: source "$(dirname "$0")/stage-lib.sh"  (release*.sh icinden)
#   stage_carry_persistent  <eski_agac> <yeni_agac>   .env.*, server/data, ocp-clusters.json,
#                                                      sertifikalar, logs (PID/kilit) tasinir
#   stage_swap_and_start    <env> <eski_agac> <yeni_agac> <deploy_dir> <keep_prev>
#                                                      stop → tasima → mv → start; eski agac
#                                                      <eski_agac>.prev-<ts> olarak KALIR (build'siz
#                                                      geri donus: mv ile yer degistir)

# Zip/git'te OLMAYAN ama kalici olan dosyalar: gitignore'daki desenlerle ayni kume.
# rsync varsa onunla (izinler/hardlink), yoksa cp -a ile.
stage_carry_persistent() {
  local src="$1" dst="$2" f
  [[ -d "$src" ]] || return 0
  shopt -s nullglob dotglob
  for f in "$src"/.env.*; do
    [[ "$(basename "$f")" == ".env.example" ]] && continue
    cp -a "$f" "$dst/" 2>/dev/null || true
  done
  shopt -u nullglob dotglob
  [[ -f "$src/server/ansible/ocp-clusters.json" ]] && { mkdir -p "$dst/server/ansible"; cp -a "$src/server/ansible/ocp-clusters.json" "$dst/server/ansible/"; }
  [[ -d "$src/server/data" ]] && { mkdir -p "$dst/server"; cp -a "$src/server/data" "$dst/server/"; }
  # sertifika/anahtar dosyalari (nerede olursa olsun; node_modules/dist/.git haric)
  while IFS= read -r f; do
    local rel="${f#"$src"/}"
    mkdir -p "$dst/$(dirname "$rel")"
    cp -a "$f" "$dst/$rel" 2>/dev/null || true
  done < <(find "$src" \( -path "$src/node_modules" -o -path "$src/dist" -o -path "$src/.git" \) -prune -o \
             -type f \( -name '*.pem' -o -name '*.key' -o -name '*.crt' -o -name '*.cer' \) -print 2>/dev/null)
  # logs: PID/kilit/enabled dosyalari run.sh icin (status/stop bunlara bakar)
  [[ -d "$src/logs" ]] && { mkdir -p "$dst/logs"; cp -a "$src/logs/." "$dst/logs/" 2>/dev/null || true; }
  return 0
}

# stop → kalici dosyalari tasi → dizinleri degistir → start. Basarisiz baslatmada eski
# dizin geri alinip yeniden baslatilir (otomatik geri donus).
stage_swap_and_start() {
  local env="$1" old="$2" new="$3" deploy_dir="$4" keep_prev="${5:-1}"
  local ts; ts="$(date +%Y%m%d-%H%M%S)"
  local prev="${old}.prev-${ts}"

  echo "[stage] yeni surum hazir: $new"
  if [[ -x "$old/deploy/run.sh" ]]; then
    echo "[stage] ortam durduruluyor (kesinti burada baslar)…"
    "$old/deploy/run.sh" "$env" stop || true
  fi
  stage_carry_persistent "$old" "$new"
  if [[ -d "$old" ]]; then
    mv "$old" "$prev"
  fi
  mv "$new" "$old"
  chmod +x "$old"/deploy/*.sh 2>/dev/null || true

  echo "[stage] baslatiliyor: $env"
  if ! "$old/deploy/run.sh" "$env" start; then
    echo "[stage] HATA: yeni surum baslamadi — ESKI surume geri donuluyor." >&2
    mv "$old" "${old}.failed-${ts}"
    mv "$prev" "$old"
    "$old/deploy/run.sh" "$env" start || true
    return 1
  fi
  echo "[stage] tamam. Kesinti bitti. Eski agac: $prev (geri donus: stop → mv ile yer degistir → start)"

  # Eski .prev agaclarindan son keep_prev tanesi kalsin
  ls -1dt "${old}".prev-* 2>/dev/null | tail -n +$((keep_prev + 1)) | xargs rm -rf 2>/dev/null || true
  # Basarisiz denemeler birikmesin
  ls -1dt "${old}".failed-* 2>/dev/null | tail -n +2 | xargs rm -rf 2>/dev/null || true
  return 0
}
