#!/bin/bash
# app_hub_ocp.sh - Application Hub: tek uygulamanin bir (cluster, namespace)'teki canli durumu.
#
# SALT OKUNUR: yalniz `oc login` + `oc get`. Hicbir nesneye yazmaz, scale / rollout yapmaz.
#
# Girdi (ortam degiskeni; komut satirina SIR konmaz):
#   OC_BIN  oc ikilisi          OCP_URL  API adresi       OCP_USER / OCP_PASS  kimlik
#   NS      namespace           APP      nesne adi (Openshift_Inventory.application)
#   KUBECONFIG  kosuya ozel gecici dosya (cagiran olusturur ve siler)
#
# Cikti (sekme ayrimli, satir basina bir kayit; Portal server/app-hub/canli.cjs ayristirir):
#   OBJ   kind  ad  istenen  hazir  guncel  mevcut  strateji  gitops  olusturma
#   CONT  kind  ad  container  imaj  istek_cpu  istek_bellek  limit_cpu  limit_bellek
#   ENV   kind  ad  container  degisken  kaynak(deger|ref)  maskeli_deger
#   POD   ad  faz  node  hazir/toplam  restart  baslama
#   HPA   ad  hedef  min  max  guncel
#   NOTE  metin                    (bilgi; or. "rollout CRD yok")
#   ERR   metin                    (bu cifti dusuren hata)
#   END   obj_sayisi  pod_sayisi
#
# MASKE: yalniz JVM ile ilgili env degiskenleri yazilir (JAVA_OPTS ailesi). Degerde -X* acik,
# -Dk=v yalniz k beyaz listede ve sir kalibina uymuyorsa acik, digerleri '-Dk=***'; sir
# kalibina uyan serbest belirtec '***'. Portal okurken ayrica server-hub/mask.cjs maskJvmArgs
# uygular (iki katman). secretKeyRef / configMapKeyRef DEGERI HIC okunmaz: yalniz referans.

set -u
export LC_ALL=C

: "${OC_BIN:?}" "${NS:?}" "${APP:?}"

err() { printf 'ERR\t%s\n' "$*" | tr -d '\r' | head -c 600; echo; }
note() { printf 'NOTE\t%s\n' "$*"; }

if [[ ! "$NS" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]]; then err "gecersiz namespace"; exit 2; fi
if [[ ! "$APP" =~ ^[A-Za-z0-9]([-A-Za-z0-9._]*[A-Za-z0-9])?$ ]]; then err "gecersiz uygulama adi"; exit 2; fi
if [[ -z "${OCP_URL:-}" ]]; then err "Cluster icin API adresi / kimlik bilgisi cozulemedi."; exit 3; fi

OC() { timeout -k 5 60 "$OC_BIN" "$@" 2>/tmp/.apphub_err.$$ </dev/null; }
trap 'rm -f /tmp/.apphub_err.$$' EXIT

if ! OC login --server="$OCP_URL" --username="${OCP_USER:-}" --password="${OCP_PASS:-}" \
     --insecure-skip-tls-verify=true >/dev/null; then
  err "oc login basarisiz: $(head -c 300 /tmp/.apphub_err.$$ | tr '\n\t' '  ')"
  exit 4
fi
unset OCP_PASS

SAFE_PREFIX='^(java\.|javax\.management\.|sun\.|jboss\.|org\.jboss\.|org\.wildfly\.|file\.encoding|user\.timezone|user\.language|user\.country|user\.region|logging\.configuration|java\.util\.logging\.manager|com\.sun\.management\.jmxremote\.port|com\.sun\.management\.jmxremote\.ssl|com\.sun\.management\.jmxremote\.authenticate|networkaddress\.cache\.ttl|jdk\.tls\.client\.protocols|https\.protocols|spring\.profiles\.active|server\.port|management\.server\.port)'
SECRET_RE='(pass|pwd|secret|token|credential|apikey|api[-_]key|private|keystore|truststore|auth)'

# Bir JVM argumani dizisini belirtec bazinda maskeler (stdin -> stdout, tek satir).
mask_args() {
  awk -v safe="$SAFE_PREFIX" -v sec="$SECRET_RE" '
    {
      out = ""
      n = split($0, t, /[ ]+/)
      for (i = 1; i <= n; i++) {
        tok = t[i]
        if (tok == "") continue
        if (tok ~ /^-X/) { o = tok }
        else if (tok ~ /^-D/) {
          eq = index(tok, "=")
          if (eq == 0) { o = tok }
          else {
            k = substr(tok, 3, eq - 3)
            lk = tolower(k)
            if (lk ~ sec || lk !~ safe) o = "-D" k "=***"; else o = tok
          }
        }
        else if (tolower(tok) ~ sec) { o = "***" }
        else { o = tok }
        out = (out == "" ? o : out " " o)
      }
      print out
    }'
}

JVM_ENV_RE='^(JAVA_OPTS|JAVA_OPTIONS|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS|JAVA_OPTS_APPEND|JAVA_ARGS|JVM_OPTS|JVM_ARGS|CATALINA_OPTS|JAVA_MAX_MEM_RATIO|JAVA_INITIAL_MEM_RATIO|JAVA_MAX_INITIAL_MEM|JAVA_GC_OPTS|GC_[A-Z_]+|[A-Z0-9_]*_JAVA_OPTS)$'

# go-template: <no value> yerine bos yazilsin diye her alan `or` ile korunur.
OBJ_TPL='OBJ	{{.kind}}	{{.metadata.name}}	{{if .spec.replicas}}{{.spec.replicas}}{{else}}0{{end}}	{{or .status.readyReplicas 0}}	{{or .status.updatedReplicas 0}}	{{or .status.availableReplicas 0}}	{{if .spec.strategy}}{{or .spec.strategy.type "canary/bluegreen"}}{{end}}	{{with .metadata.labels}}{{index . "argocd.argoproj.io/instance"}}{{end}}{{with .metadata.annotations}}{{index . "argocd.argoproj.io/tracking-id"}}{{end}}	{{.metadata.creationTimestamp}}
{{if .spec.template}}{{range .spec.template.spec.containers}}CONT	-	-	{{.name}}	{{.image}}	{{with .resources}}{{with .requests}}{{index . "cpu"}}{{end}}{{end}}	{{with .resources}}{{with .requests}}{{index . "memory"}}{{end}}{{end}}	{{with .resources}}{{with .limits}}{{index . "cpu"}}{{end}}{{end}}	{{with .resources}}{{with .limits}}{{index . "memory"}}{{end}}{{end}}
{{$c := .name}}{{range .env}}ENVRAW	{{$c}}	{{.name}}	{{if .valueFrom}}ref	{{if .valueFrom.secretKeyRef}}secret:{{.valueFrom.secretKeyRef.name}}{{else if .valueFrom.configMapKeyRef}}configmap:{{.valueFrom.configMapKeyRef.name}}{{else}}alan{{end}}{{else}}deger	{{.value}}{{end}}
{{end}}{{end}}{{else}}NOTE	{{.kind}} spec.template yok (workloadRef olabilir)
{{end}}SEL	{{with .spec.selector}}{{if .matchLabels}}{{range $k, $v := .matchLabels}}{{$k}}={{$v}},{{end}}{{else}}{{range $k, $v := .}}{{$k}}={{$v}},{{end}}{{end}}{{end}}
'

obj=0
sel=''
for kind in deployment deploymentconfig statefulset rollouts.argoproj.io; do
  out=$(OC get "$kind" "$APP" -n "$NS" --ignore-not-found -o go-template="$OBJ_TPL")
  rc=$?
  if [[ $rc -ne 0 ]]; then
    msg=$(head -c 200 /tmp/.apphub_err.$$ | tr '\n\t' '  ')
    if [[ "$kind" == rollouts.argoproj.io || "$kind" == deploymentconfig ]] && grep -qiE "the server doesn't have a resource type|no matches for kind|could not find the requested resource" /tmp/.apphub_err.$$; then
      note "$kind bu cluster'da tanimli degil"
    else
      err "$kind okunamadi: $msg"
    fi
    continue
  fi
  [[ -z "$out" ]] && continue
  obj=$((obj + 1))
  k=$(printf '%s\n' "$out" | awk -F'\t' '$1=="OBJ"{print $2; exit}')
  while IFS= read -r line; do
    case "$line" in
      OBJ$'\t'*) printf '%s\n' "$line" ;;
      CONT$'\t'*) printf '%s\n' "$line" | awk -F'\t' -v OFS='\t' -v k="$k" -v a="$APP" '{ $2=k; $3=a; print }' ;;
      ENVRAW$'\t'*)
        c=$(printf '%s' "$line" | cut -f2); v=$(printf '%s' "$line" | cut -f3)
        src=$(printf '%s' "$line" | cut -f4); val=$(printf '%s' "$line" | cut -f5-)
        if [[ "$v" =~ $JVM_ENV_RE ]]; then
          if [[ "$src" == deger ]]; then
            printf 'ENV\t%s\t%s\t%s\t%s\tdeger\t%s\n' "$k" "$APP" "$c" "$v" "$(printf '%s' "$val" | tr '\t\n' '  ' | mask_args)"
          else
            printf 'ENV\t%s\t%s\t%s\t%s\tref\t%s\n' "$k" "$APP" "$c" "$v" "$val"
          fi
        fi
        ;;
      SEL$'\t'*) s=${line#SEL$'\t'}; s=${s%,}; [[ -z "$sel" && -n "$s" ]] && sel=$s ;;
      NOTE$'\t'*) printf '%s\n' "$line" ;;
    esac
  done <<< "$out"
done

if [[ $obj -eq 0 ]]; then
  note "Bu namespace'te $APP adli deployment / deploymentconfig / statefulset / rollout yok"
fi

pods=0
if [[ -n "$sel" ]]; then
  POD_TPL='{{range .items}}POD	{{.metadata.name}}	{{.status.phase}}	{{or .spec.nodeName "-"}}	{{range .status.containerStatuses}}{{if .ready}}R{{end}}C{{end}}	{{range .status.containerStatuses}}{{.restartCount}},{{end}}	{{or .status.startTime "-"}}
{{end}}'
  pout=$(OC get pods -n "$NS" -l "$sel" -o go-template="$POD_TPL")
  if [[ $? -ne 0 ]]; then
    err "pod listesi okunamadi: $(head -c 200 /tmp/.apphub_err.$$ | tr '\n\t' '  ')"
  else
    while IFS= read -r line; do
      [[ "$line" == POD$'\t'* ]] || continue
      pods=$((pods + 1))
      [[ $pods -gt 200 ]] && continue
      printf '%s\n' "$line" | awk -F'\t' -v OFS='\t' '{
        rc = gsub(/R/, "", $5); tc = gsub(/C/, "", $5); $5 = rc "/" tc
        n = split($6, r, ","); s = 0; for (i = 1; i <= n; i++) s += r[i]; $6 = s
        print }'
    done <<< "$pout"
  fi
fi

hpa=$(OC get hpa -n "$NS" -o go-template='{{range .items}}{{if eq .spec.scaleTargetRef.name "'"$APP"'"}}HPA	{{.metadata.name}}	{{.spec.scaleTargetRef.kind}}	{{or .spec.minReplicas 1}}	{{.spec.maxReplicas}}	{{or .status.currentReplicas 0}}
{{end}}{{end}}')
[[ $? -eq 0 && -n "$hpa" ]] && printf '%s\n' "$hpa"

printf 'END\t%s\t%s\n' "$obj" "$pods"
exit 0
