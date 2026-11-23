#!/bin/bash
# spa_package_ocp.sh - Intranet SPA paket kurulumu: bir uygulamanin OCP'de kosan imaji ve
# application.json ConfigMap'i (tek cluster, tek namespace).
#
# SALT OKUNUR: yalniz `oc login` + `oc get`. Hicbir nesneye yazmaz. Secret ASLA okunmaz:
# `oc get` yalniz workload turlerine ve configmap'e gider.
#
# Girdi (ortam degiskeni):
#   OC_BIN  oc ikilisi          OCP_URL  API adresi       OCP_USER / OCP_PASS  kimlik
#   NS      namespace           APP      workload adi (= Artifactory'deki uygulama adi)
#   SPI_RUN_PREFIX  /tmp/spa-pkg-<is>-<n>: betik `mktemp -d <onek>.XXXXXX` ile kosuya ozel 0700
#           dizin acar; kubeconfig ve oc hata dosyasi oradadir, cikista (trap) dizin silinir.
#           Playbook ayrica /tmp/spa-pkg-<is>-* kalintisini siler ve temizligi dogrular.
# Bilinen sinir (app_hub_ocp.sh ile ayni kalip): parola betige ortam degiskeniyle gelir, ama
# `oc login --password=...` onu oc'nin komut satirina koyar; login suresince ayni sunucudaki
# yerel kullanicilar ps / /proc/<pid>/cmdline ile gorebilir. Login'den sonra OCP_PASS silinir.
#
# Cikti (sekme ayrimli, satir basina bir kayit; spa_package_install.yml play 3 ayristirir):
#   IMG   container  imaj
#   CM    configmap_adi  application.json (base64, tek satir)
#   ERR   metin                    (bu kalemi dusuren hata)
#   END
#
# Workload (Portal anaNesne kurali, server/app-hub/filo.cjs): deployment | deploymentconfig |
# statefulset | rollouts.argoproj.io turlerinin HEPSINDE adi APP olan nesne okunur; spec.replicas
# en buyuk olan secilir (yoksa 0; esitlikte yukaridaki siradaki ilk). Secilen Argo Rollout
# spec.template yerine workloadRef tasiyorsa (kind Deployment) imaj ve volume'lar o Deployment'in
# template'inden okunur; baska tur ise ERR.
# ConfigMap secimi: pod template volumes (configMap ve projected configMap kaynaklari) icinden
# data'sinda `application.json` anahtari OLANLAR; tam 1 -> o. 0 ise yedek: `-l app=APP`
# ConfigMap'lerinden application.json anahtari olanlar; tam 1 -> o. Aksi -> ERR (adlarla).
# application.json en cok SPA_MAX_APPJSON_BYTES (varsayilan 1 MB).

set -u
export LC_ALL=C

: "${OC_BIN:?}" "${NS:?}" "${APP:?}" "${SPI_RUN_PREFIX:?}"
unset KUBECONFIG

MAX_BYTES="${SPA_MAX_APPJSON_BYTES:-1048576}"
TAB=$'\t'

# ERR satirlari fd 3'e (asil stdout) gider: $(...) icindeki yardimcilarin hatasi da yakalanan
# degiskene karismaz.
exec 3>&1
err() { printf 'ERR\t%s\n' "$(printf '%s' "$*" | tr -d '\r' | tr '\n\t' '  ' | head -c 600)" >&3; }
son() { printf 'END\n'; }
oc_hata() { head -c 300 "$ERRF" 2>/dev/null | tr '\n\t' '  '; }

if [[ ! "$NS" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ || ${#NS} -gt 63 ]]; then err "gecersiz namespace"; exit 2; fi
if [[ ! "$APP" =~ ^[A-Za-z0-9]([-A-Za-z0-9._]*[A-Za-z0-9])?$ || ${#APP} -gt 253 ]]; then err "gecersiz uygulama adi"; exit 2; fi
if [[ ! "$SPI_RUN_PREFIX" =~ ^/tmp/spa-pkg-[A-Za-z0-9._-]+$ ]]; then err "gecersiz gecici dizin oneki"; exit 2; fi
if [[ ! "$MAX_BYTES" =~ ^[1-9][0-9]{0,8}$ ]]; then err "gecersiz application.json siniri"; exit 2; fi
if [[ -z "${OCP_URL:-}" ]]; then err "Cluster icin API adresi / kimlik bilgisi cozulemedi."; exit 3; fi

RUN_DIR=''
temizle() { [[ -n "$RUN_DIR" ]] && rm -rf -- "$RUN_DIR"; }
trap temizle EXIT
trap 'exit 143' TERM INT
umask 077
if ! RUN_DIR=$(mktemp -d "${SPI_RUN_PREFIX}.XXXXXX") || [[ ! -d "$RUN_DIR" ]] || ! chmod 0700 -- "$RUN_DIR"; then
  err "kosuya ozel gecici dizin acilamadi (${SPI_RUN_PREFIX}.*)"
  exit 5
fi
ERRF="${RUN_DIR}/oc.err"
export KUBECONFIG="${RUN_DIR}/kubeconfig"

OC() { timeout -k 5 60 "$OC_BIN" "$@" 2>"$ERRF" </dev/null; }

if ! OC login --server="$OCP_URL" --username="${OCP_USER:-}" --password="${OCP_PASS:-}" \
     --insecure-skip-tls-verify=true >/dev/null; then
  err "oc login basarisiz: $(oc_hata)"
  exit 4
fi
unset OCP_PASS

# go-template: imajlar, ConfigMap volume adlari, workloadRef. <no value> yazilmasin diye her
# alan if / with ile korunur.
WL_TPL='KIND	{{.kind}}
REPL	{{if .spec.replicas}}{{.spec.replicas}}{{else}}0{{end}}
{{if .spec.template}}{{range .spec.template.spec.containers}}IMG	{{.name}}	{{.image}}
{{end}}{{range .spec.template.spec.volumes}}{{if .configMap}}VOL	{{.configMap.name}}
{{end}}{{if .projected}}{{range .projected.sources}}{{if .configMap}}VOL	{{.configMap.name}}
{{end}}{{end}}{{end}}{{end}}{{else}}{{with .spec.workloadRef}}REF	{{.kind}}	{{.name}}
{{end}}{{end}}'
HAS_TPL='{{with .data}}{{with index . "application.json"}}Y{{end}}{{end}}'
LBL_TPL='{{range .items}}{{$n := .metadata.name}}{{with .data}}{{with index . "application.json"}}CAND	{{$n}}
{{end}}{{end}}{{end}}'
DATA_TPL='{{index .data "application.json"}}'

kind_yok_mu() {
  grep -qiE "the server doesn't have a resource type|no matches for kind|could not find the requested resource" "$ERRF"
}

# Workload'u bulur: dort turun hepsi okunur, REPL'i en buyuk olan (esitlikte ilk) WL'ye yazilir.
# 0 bulundu, 1 yok, 2 okuma hatasi.
WL=''
workload_bul() {
  local kind out repl best=-1
  for kind in deployment deploymentconfig statefulset rollouts.argoproj.io; do
    if ! out=$(OC get "$kind" "$APP" -n "$NS" --ignore-not-found -o go-template="$WL_TPL"); then
      if [[ "$kind" == deploymentconfig || "$kind" == rollouts.argoproj.io ]] && kind_yok_mu; then
        continue
      fi
      err "$kind okunamadi: $(oc_hata)"
      return 2
    fi
    [[ -z "$out" ]] && continue
    repl=$(printf '%s\n' "$out" | awk -F'\t' '$1=="REPL"{print $2; exit}')
    [[ "$repl" =~ ^[0-9]{1,9}$ ]] || repl=0
    if ((repl > best)); then
      best=$repl
      WL=$out
    fi
  done
  [[ -n "$WL" ]] && return 0
  return 1
}

# Rollout workloadRef -> Deployment. Basariliysa WL yeniden yazilir.
workload_ref_coz() {
  local ref ref_kind ref_name out
  ref=$(printf '%s\n' "$WL" | awk -F'\t' '$1=="REF"{print $2 "\t" $3; exit}')
  [[ -z "$ref" ]] && return 0
  ref_kind=${ref%%"$TAB"*}
  ref_name=${ref#*"$TAB"}
  if [[ "$ref_kind" != Deployment || ! "$ref_name" =~ ^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$ ]]; then
    err "rollout workloadRef desteklenmiyor: ${ref_kind}/${ref_name}"
    return 1
  fi
  if ! out=$(OC get deployment "$ref_name" -n "$NS" -o go-template="$WL_TPL"); then
    err "workloadRef deployment okunamadi: ${ref_name}: $(oc_hata)"
    return 1
  fi
  WL=$out
  return 0
}

# Adlar listesinden data'sinda application.json olanlar (satir satir).
anahtarli_adlar() {
  local ad has
  while IFS= read -r ad; do
    [[ -z "$ad" ]] && continue
    if ! has=$(OC get configmap "$ad" -n "$NS" --ignore-not-found -o go-template="$HAS_TPL"); then
      err "configmap okunamadi: ${ad}: $(oc_hata)"
      return 1
    fi
    [[ "$has" == Y ]] && printf '%s\n' "$ad"
  done
  return 0
}

etiketli_adlar() {
  local out
  if ! out=$(OC get configmap -n "$NS" -l "app=${APP}" -o go-template="$LBL_TPL"); then
    err "app=${APP} etiketli configmap listesi okunamadi: $(oc_hata)"
    return 1
  fi
  printf '%s\n' "$out" | awk -F'\t' '$1=="CAND" && $2!=""{print $2}' | sort -u
  return 0
}

adlari_birlestir() { tr '\n' ' ' | sed -e 's/ *$//' -e 's/ /, /g'; }

# Secilen ConfigMap'in application.json'unu CM satiri olarak yazar.
cm_yaz() {
  local ad="$1" veri
  if ! veri=$(OC get configmap "$ad" -n "$NS" -o go-template="$DATA_TPL"); then
    err "configmap okunamadi: ${ad}: $(oc_hata)"
    return 1
  fi
  if [[ -z "$veri" ]]; then
    err "configmap ${ad} application.json bos"
    return 1
  fi
  if [[ ${#veri} -gt $MAX_BYTES ]]; then
    err "configmap ${ad} application.json cok buyuk (${#veri} bayt > ${MAX_BYTES})"
    return 1
  fi
  printf 'CM\t%s\t%s\n' "$ad" "$(printf '%s' "$veri" | base64 -w0)"
  return 0
}

configmap_sec() {
  local vols adaylar sayi
  vols=$(printf '%s\n' "$WL" | awk -F'\t' '$1=="VOL" && $2!=""{print $2}' | sort -u)
  adaylar=$(printf '%s\n' "$vols" | anahtarli_adlar) || return 1
  sayi=$(printf '%s\n' "$adaylar" | grep -c .)
  if [[ $sayi -eq 0 ]]; then
    adaylar=$(etiketli_adlar) || return 1
    sayi=$(printf '%s\n' "$adaylar" | grep -c .)
    if [[ $sayi -eq 0 ]]; then
      err "application.json tasiyan configmap yok (volume: $(printf '%s\n' "$vols" | adlari_birlestir); etiket app=${APP}: yok)"
      return 1
    fi
  fi
  if [[ $sayi -gt 1 ]]; then
    err "application.json tasiyan birden cok configmap: $(printf '%s\n' "$adaylar" | adlari_birlestir)"
    return 1
  fi
  cm_yaz "$(printf '%s\n' "$adaylar" | grep -m1 .)"
}

main() {
  local rc
  workload_bul
  rc=$?
  if [[ $rc -eq 1 ]]; then
    err "Bu namespace'te ${APP} adli deployment / deploymentconfig / statefulset / rollout yok"
  fi
  [[ $rc -ne 0 ]] && return 0
  workload_ref_coz || return 0
  printf '%s\n' "$WL" | awk -F'\t' -v OFS='\t' '$1=="IMG"{print $1, $2, $3}'
  if ! printf '%s\n' "$WL" | grep -q "^IMG${TAB}"; then
    err "workload'ta container imaji okunamadi"
    return 0
  fi
  configmap_sec || return 0
  return 0
}

main
son
exit 0
