#!/bin/bash
# app_hub_fleet.sh - Application Hub hourly fleet scan: ONE cluster, ALL namespaces.
#
# READ ONLY: only `oc login` + `oc get`. Never writes to any object, never scales / rolls out.
#
# Input (environment; the PASSWORD is never in the environment of the Ansible command: Ansible writes
# `environment:` into the remote `/bin/sh -c` line, visible in `ps` and in -vvv job output):
#   FLEET_PASS_FILE  one-shot password file <FLEET_SLOT_DIR>/p.<cluster> (0600, written by the playbook with
#                    no_log). Read and DELETED at once. Not `command` `stdin:` either: ansible-core 2.16 keeps
#                    module arguments (stdin included) in plain text in the async job file ~/.ansible_async/<jid>.
#                    Without FLEET_PASS_FILE (manual run) the first stdin line is the password.
#   OC_BIN  oc binary          OCP_URL  API address      OCP_USER  user name
#   CLUSTER cluster name (summary only)
#   FLEET_JOB  job number; names the private work directory /tmp/app-hub-fleet-w.<job>.XXXXXXXX
#              (0700, mktemp). KUBECONFIG lives INSIDE it, so the token never sits at a guessable
#              /tmp path; the caller removes leftovers of its own job by that name.
#   FLEET_SLOT_DIR  optional /tmp/app-hub-fleet-slots-* created by the caller with mktemp (0700):
#                   flock semaphore shared by the clusters of one bastion (FLEET_SLOTS at a time;
#                   memory of `oc get pods -A`). A directory that is not ours, is a symlink or is
#                   writable by others is refused: a guessable shared path let another local user
#                   plant slot.N -> <victim file> (truncated by `exec 9>`) or hold the locks.
#   FLEET_SLOTS (3)  FLEET_SLOT_WAIT (7200 s)  FLEET_CALL_TIMEOUT (300 s, one -A call)
#   FLEET_SCAN_BUDGET (1800 s; starts AFTER the slot is taken, so queueing never eats the scan time)
#   FLEET_NS_TIMEOUT (60 s, one per-namespace call)  FLEET_PARALLEL (6, per-namespace fallback)
#
# Output (stdout):
#   APPHUB_FLEET_SUMMARY <TAB> objects <TAB> pods <TAB> errors <TAB> seconds
#   @@APPHUB_FLEET_BEGIN@@
#   base64(gzip(records))
#   @@APPHUB_FLEET_END@@
# Records (tab separated; Portal server/app-hub/filo.cjs parses them):
#   OBJ    ns kind name desired ready updated available strategy gitops created
#   CONT   ns kind name container image req_cpu req_mem lim_cpu lim_mem
#   ENV    ns kind name container variable deger|ref masked_value
#   POD    ns owner_kind owner_name pod_template_hash rollouts_hash dc_label pod phase node ready/total restarts start
#   HPA    ns name target_kind target_name min max current
#   NSFAIL kind ns            (this namespace could not be read for this kind)
#   KINDFAIL kind             (this kind could not be read at all)
#   NOTE   text               ERR text
#   END    objects pods       (missing END = incomplete scan)
#
# MASK: identical to app_hub_ocp.sh (SAFE_PREFIX / SECRET_RE / JVM_ENV_RE; the Portal guard
# asserts the three are byte-identical in both scripts). The patterns reach awk through
# ENVIRON, NOT `awk -v`: -v processes escapes and turned `java\.` into `java.` (any char). secretKeyRef / configMapKeyRef VALUES
# are never read, only the reference name. Portal masks again (server-hub/mask.cjs).

set -u
export LC_ALL=C

: "${OC_BIN:?}"

T=$'\t'
CALL_TIMEOUT=${FLEET_CALL_TIMEOUT:-300}
NS_TIMEOUT=${FLEET_NS_TIMEOUT:-60}

# stdin is /dev/null except for `oc login`, which reads the password from stdin (OC_IN=/dev/stdin; never argv).
OC() { timeout --foreground -k 5 "${OC_TIMEOUT:-60}" "$OC_BIN" "$@" <"${OC_IN:-/dev/null}" 9>&-; }

# Per-namespace worker (xargs fallback): bash <self> __ns <resource> <namespace> <workdir>
if [[ "${1:-}" == "__ns" ]]; then
  res=$2; ns=$3; w=$4
  [[ "$w" =~ ^/tmp/app-hub-fleet-w\.[A-Za-z0-9._-]+$ ]] || exit 2
  [[ "$ns" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || exit 2
  f="$w/ns/$res.$ns"
  if (( $(date +%s) >= ${FLEET_DEADLINE:-0} )); then printf 'NSFAIL\t%s\t%s\n' "$res" "$ns" >"$f"; exit 0; fi
  if OC_TIMEOUT=$NS_TIMEOUT OC get "$res" -n "$ns" -o go-template="$FLEET_TPL" >"$f" 2>"$f.err"; then
    rm -f -- "$f.err"
  else
    printf 'NSFAIL\t%s\t%s\n' "$res" "$ns" >"$f"
  fi
  exit 0
fi

: "${OCP_URL:=}"
OCP_PASS=''
START=$(date +%s)
W=''
JOB_TAG=${FLEET_JOB:-x}
[[ "$JOB_TAG" =~ ^[A-Za-z0-9]{1,20}$ ]] || JOB_TAG=x

if [[ -n "${FLEET_SLOT_DIR:-}" ]]; then
  if [[ ! "$FLEET_SLOT_DIR" =~ ^/tmp/app-hub-fleet-slots-[A-Za-z0-9._-]+$ ]]; then
    printf 'APPHUB_FLEET_SUMMARY\t0\t0\t1\t0\nERR\tinvalid slot directory\n'; exit 2
  fi
  if [[ ! -d "$FLEET_SLOT_DIR" || -L "$FLEET_SLOT_DIR" || ! -O "$FLEET_SLOT_DIR" ]] \
     || [[ -n "$(find "$FLEET_SLOT_DIR" -maxdepth 0 \( -perm -020 -o -perm -002 \) 2>/dev/null)" ]]; then
    printf 'APPHUB_FLEET_SUMMARY\t0\t0\t1\t0\nERR\tunsafe slot directory (missing, not owned, symlink or writable by others)\n'; exit 2
  fi
fi
if [[ -n "${FLEET_PASS_FILE:-}" ]]; then
  if [[ -z "${FLEET_SLOT_DIR:-}" || ! "$FLEET_PASS_FILE" =~ ^/tmp/app-hub-fleet-slots-[A-Za-z0-9._-]+/p\.[A-Za-z0-9._-]+$ \
        || "${FLEET_PASS_FILE%/*}" != "$FLEET_SLOT_DIR" || ! -f "$FLEET_PASS_FILE" || -L "$FLEET_PASS_FILE" \
        || ! -O "$FLEET_PASS_FILE" ]]; then
    printf 'APPHUB_FLEET_SUMMARY\t0\t0\t1\t0\nERR\tinvalid password file\n'; exit 2
  fi
  IFS= read -r OCP_PASS <"$FLEET_PASS_FILE" || true
  rm -f -- "$FLEET_PASS_FILE"
else
  IFS= read -r OCP_PASS || true
fi

cleanup() {
  [[ -n "$W" && -d "$W" ]] && rm -rf -- "$W"
}
trap cleanup EXIT
trap 'exit 143' TERM INT

W=$(mktemp -d "/tmp/app-hub-fleet-w.$JOB_TAG.XXXXXXXX") || { printf 'APPHUB_FLEET_SUMMARY\t0\t0\t1\t0\nERR\tmktemp failed\n'; exit 3; }
chmod 700 "$W"
export KUBECONFIG="$W/kubeconfig"
mkdir -p "$W/ns"
OUT="$W/records"
: >"$OUT"

err() { printf 'ERR\t%s\n' "$(printf '%s' "$*" | tr '\n\t\r' '   ' | head -c 600)" >>"$OUT"; }
note() { printf 'NOTE\t%s\n' "$*" >>"$OUT"; }

emit() {
  local secs objs pods errs
  secs=$(( $(date +%s) - START ))
  objs=$(grep -c '^OBJ	' "$OUT")
  pods=$(grep -c '^POD	' "$OUT")
  errs=$(grep -c -E '^(ERR|KINDFAIL)	' "$OUT")
  printf 'APPHUB_FLEET_SUMMARY\t%s\t%s\t%s\t%s\n' "$objs" "$pods" "$errs" "$secs"
  printf '@@APPHUB_FLEET_BEGIN@@\n'
  gzip -c "$OUT" | base64 | tr -d '\n'
  printf '\n@@APPHUB_FLEET_END@@\n'
}

if [[ -z "$OCP_URL" ]]; then err "cluster API address / credentials could not be resolved"; emit; exit 3; fi

# Slot: at most FLEET_SLOTS clusters of this bastion scan at the same time (flock semaphore).
slot_take() {
  [[ -z "${FLEET_SLOT_DIR:-}" ]] && return 0
  command -v flock >/dev/null 2>&1 || { note "flock missing, no slot limit"; return 0; }
  local n=${FLEET_SLOTS:-3} waited=0 i
  while (( waited < ${FLEET_SLOT_WAIT:-7200} )); do
    for (( i = 0; i < n; i++ )); do
      [[ -L "$FLEET_SLOT_DIR/slot.$i" ]] && continue
      exec 9>"$FLEET_SLOT_DIR/slot.$i" || continue
      if flock -n 9; then return 0; fi
      exec 9>&-
    done
    sleep 3; waited=$(( waited + 3 ))
  done
  return 1
}
if ! slot_take; then err "no free scan slot on this bastion within the wait limit"; emit; exit 5; fi
DEADLINE=$(( $(date +%s) + ${FLEET_SCAN_BUDGET:-1800} ))
# Remaining scan budget, capped by the per-call limit (at least 5 s so a call can still fail cleanly).
budget() { local r=$(( DEADLINE - $(date +%s) )); (( r > $1 )) && r=$1; (( r < 5 )) && r=5; echo "$r"; }

# Password on stdin, NOT --password: argv is visible in `ps` to every local user for the whole login. oc reads a
# non-tty stdin for the password (verified with oc 4.22 against a fake OAuth server, 2026-11-22). If a bastion's
# oc does not, login fails with an empty password and the scan reports "oc login failed" (canary: first hourly run).
if ! printf '%s\n' "${OCP_PASS:-}" | OC_IN=/dev/stdin OC_TIMEOUT=60 OC login --server="$OCP_URL" --username="${OCP_USER:-}" \
     --insecure-skip-tls-verify=true >/dev/null 2>"$W/login.err"; then
  err "oc login failed: $(head -c 300 "$W/login.err")"
  unset OCP_PASS
  emit; exit 4
fi
unset OCP_PASS

SAFE_PREFIX='^(java\.|javax\.management\.|sun\.|jboss\.|org\.jboss\.|org\.wildfly\.|file\.encoding|user\.timezone|user\.language|user\.country|user\.region|logging\.configuration|java\.util\.logging\.manager|com\.sun\.management\.jmxremote\.port|com\.sun\.management\.jmxremote\.ssl|com\.sun\.management\.jmxremote\.authenticate|networkaddress\.cache\.ttl|jdk\.tls\.client\.protocols|https\.protocols|spring\.profiles\.active|server\.port|management\.server\.port)'
SECRET_RE='(pass|pwd|secret|token|credential|apikey|api[-_]key|private|keystore|truststore|auth)'
JVM_ENV_RE='^(JAVA_OPTS|JAVA_OPTIONS|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS|JAVA_OPTS_APPEND|JAVA_ARGS|JVM_OPTS|JVM_ARGS|CATALINA_OPTS|JAVA_MAX_MEM_RATIO|JAVA_INITIAL_MEM_RATIO|JAVA_MAX_INITIAL_MEM|JAVA_GC_OPTS|GC_[A-Z_]+|[A-Z0-9_]*_JAVA_OPTS)$'

# go-template per kind (@K@ = kind label). `or (index . "k") ""` keeps a missing label EMPTY
# instead of printing "<no value>".
obj_tpl() {
  local k=$1
  printf '%s' "{{range .items}}{{\$ns := .metadata.namespace}}{{\$n := .metadata.name}}OBJ${T}{{\$ns}}${T}${k}${T}{{\$n}}${T}{{if .spec.replicas}}{{.spec.replicas}}{{else}}0{{end}}${T}{{or .status.readyReplicas 0}}${T}{{or .status.updatedReplicas 0}}${T}{{or .status.availableReplicas 0}}${T}{{if .spec.strategy}}{{or .spec.strategy.type \"canary/bluegreen\"}}{{end}}${T}{{with .metadata.labels}}{{or (index . \"argocd.argoproj.io/instance\") \"\"}}{{end}}{{with .metadata.annotations}}{{or (index . \"argocd.argoproj.io/tracking-id\") \"\"}}{{end}}${T}{{.metadata.creationTimestamp}}
{{if .spec.template}}{{range .spec.template.spec.containers}}CONT${T}{{\$ns}}${T}${k}${T}{{\$n}}${T}{{.name}}${T}{{.image}}${T}{{with .resources}}{{with .requests}}{{or (index . \"cpu\") \"\"}}{{end}}{{end}}${T}{{with .resources}}{{with .requests}}{{or (index . \"memory\") \"\"}}{{end}}{{end}}${T}{{with .resources}}{{with .limits}}{{or (index . \"cpu\") \"\"}}{{end}}{{end}}${T}{{with .resources}}{{with .limits}}{{or (index . \"memory\") \"\"}}{{end}}{{end}}
{{\$c := .name}}{{range .env}}ENVRAW${T}{{\$ns}}${T}${k}${T}{{\$n}}${T}{{\$c}}${T}{{.name}}${T}{{if .valueFrom}}ref${T}{{if .valueFrom.secretKeyRef}}secret:{{.valueFrom.secretKeyRef.name}}{{else if .valueFrom.configMapKeyRef}}configmap:{{.valueFrom.configMapKeyRef.name}}{{else}}alan{{end}}{{else}}deger${T}{{.value}}{{end}}
{{end}}{{end}}{{end}}{{end}}"
}
POD_TPL="{{range .items}}PODRAW${T}{{.metadata.namespace}}${T}{{with .metadata.ownerReferences}}{{range \$i, \$o := .}}{{if eq \$i 0}}{{\$o.kind}}${T}{{\$o.name}}{{end}}{{end}}{{else}}-${T}-{{end}}${T}{{with .metadata.labels}}{{or (index . \"pod-template-hash\") \"-\"}}${T}{{or (index . \"rollouts-pod-template-hash\") \"-\"}}${T}{{or (index . \"deploymentconfig\") \"-\"}}{{else}}-${T}-${T}-{{end}}${T}{{.metadata.name}}${T}{{.status.phase}}${T}{{or .spec.nodeName \"-\"}}${T}{{range .status.containerStatuses}}{{if .ready}}R{{end}}C{{end}}${T}{{range .status.containerStatuses}}{{.restartCount}},{{end}}${T}{{or .status.startTime \"-\"}}
{{end}}"
HPA_TPL="{{range .items}}HPA${T}{{.metadata.namespace}}${T}{{.metadata.name}}${T}{{.spec.scaleTargetRef.kind}}${T}{{.spec.scaleTargetRef.name}}${T}{{or .spec.minReplicas 1}}${T}{{.spec.maxReplicas}}${T}{{or .status.currentReplicas 0}}
{{end}}"

NS_LIST=''
ns_list() {
  [[ -n "$NS_LIST" ]] && return 0
  if OC_TIMEOUT=$(budget "$CALL_TIMEOUT") OC get projects -o go-template='{{range .items}}{{.metadata.name}}{{"\n"}}{{end}}' >"$W/projects" 2>"$W/projects.err"; then
    NS_LIST="$W/projects"; return 0
  fi
  return 1
}

# One resource, all namespaces. -A first; if that fails (Forbidden, timeout, 410, ...) the
# same template per namespace in parallel. A missing CRD is a NOTE, not an error.
read_kind() {
  local res=$1 tpl=$2
  local f="$W/all.$res"
  if (( $(date +%s) >= DEADLINE )); then
    printf 'KINDFAIL\t%s\n' "$res" >>"$OUT"
    err "$res was not read: scan budget (${FLEET_SCAN_BUDGET:-1800} s) exhausted"
    return 1
  fi
  if OC_TIMEOUT=$(budget "$CALL_TIMEOUT") OC get "$res" -A -o go-template="$tpl" >"$f" 2>"$f.err"; then
    cat "$f" >>"$OUT"; return 0
  fi
  if grep -qiE "the server doesn't have a resource type|no matches for kind|could not find the requested resource" "$f.err"; then
    note "$res is not defined on this cluster"; return 0
  fi
  note "$res -A failed, reading per namespace: $(head -c 160 "$f.err" | tr '\n\t' '  ')"
  if ! ns_list; then
    printf 'KINDFAIL\t%s\n' "$res" >>"$OUT"
    err "$res could not be read and the project list is not readable: $(head -c 200 "$W/projects.err" | tr '\n\t' '  ')"
    return 1
  fi
  rm -f -- "$W"/ns/"$res".*
  grep -vE '^(openshift|kube)(-|$)' "$NS_LIST" | grep -E '^[a-z0-9]([-a-z0-9]*[a-z0-9])?$' \
    | FLEET_TPL="$tpl" FLEET_DEADLINE="$DEADLINE" xargs -r -P "${FLEET_PARALLEL:-6}" -I{} bash "$SELF" __ns "$res" {} "$W" 9>&-
  local x
  for x in "$W"/ns/"$res".*; do
    [[ -f "$x" && "$x" != *.err ]] && cat "$x" >>"$OUT"
  done
  return 0
}

SELF=$(readlink -f "$0")
read_kind deployment "$(obj_tpl Deployment)"
read_kind deploymentconfig "$(obj_tpl DeploymentConfig)"
read_kind statefulset "$(obj_tpl StatefulSet)"
read_kind rollouts.argoproj.io "$(obj_tpl Rollout)"
read_kind pods "$POD_TPL"
read_kind hpa "$HPA_TPL"

# Post-processing in ONE awk pass: drop system namespaces, mask JVM env values, keep only JVM
# env variables, pod ready / restart counts. Lines that do not start with a known record
# (e.g. a multi-line env value) are dropped.
MASK_SAFE="$SAFE_PREFIX" MASK_SEC="$SECRET_RE" MASK_JVM="$JVM_ENV_RE" awk -F'\t' -v OFS='\t' '
  BEGIN { safe = ENVIRON["MASK_SAFE"]; sec = ENVIRON["MASK_SEC"]; jvm = ENVIRON["MASK_JVM"] }
  function mask(v,   out, n, t, i, tok, eq, k, lk, o) {
    out = ""
    n = split(v, t, /[ ]+/)
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
    return out
  }
  $1 == "OBJ" || $1 == "CONT" || $1 == "HPA" || $1 == "PODRAW" || $1 == "ENVRAW" || $1 == "NSFAIL" {
    ns = ($1 == "NSFAIL") ? $3 : $2
    if (ns ~ /^(openshift|kube)(-|$)/) next
  }
  $1 == "OBJ" || $1 == "CONT" || $1 == "HPA" || $1 == "NSFAIL" || $1 == "KINDFAIL" || $1 == "NOTE" || $1 == "ERR" { print; next }
  $1 == "ENVRAW" {
    if ($6 !~ jvm) next
    val = $8
    for (i = 9; i <= NF; i++) val = val " " $i
    if ($7 == "deger") print "ENV", $2, $3, $4, $5, $6, "deger", mask(val)
    else print "ENV", $2, $3, $4, $5, $6, "ref", val
    next
  }
  $1 == "PODRAW" {
    rc = gsub(/R/, "", $11); tc = gsub(/C/, "", $11)
    m = split($12, r, ","); s = 0; for (i = 1; i <= m; i++) s += r[i]
    print "POD", $2, $3, $4, $5, $6, $7, $8, $9, $10, rc "/" tc, s, $13
    next
  }
' "$OUT" >"$OUT.final"
mv -f -- "$OUT.final" "$OUT"
printf 'END\t%s\t%s\n' "$(grep -c '^OBJ	' "$OUT")" "$(grep -c '^POD	' "$OUT")" >>"$OUT"

emit
exit 0
