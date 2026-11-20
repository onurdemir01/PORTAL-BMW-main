#!/bin/bash
# opsx_was.sh - OpsX Legacy WAS (WebSphere ND): TEK host, TEK JVM (application server) kesfi ve
# stop / start / restart. Sozlesme, durum tablosu ve kill politikasi: bmw_portal/opsx_was/README.md.
#
# Kosan kullanici YALNIZ 'was' (play duzeyi become: dzdo -> was). Bu betikte dzdo/su/sudo YOK;
# 'id -un' was degilse hicbir sey yapilmaz (FAIL).
# Kimlik: profilin properties/soap.client.props dosyasi (K2-a). Icerik ASLA basilmaz; yalniz
# loginUserid satiri SAYILIR. Kimlik yoksa serverStatus/stop/start calistirilmaz (OLCULEMEDI).
#
# Girdi (env):
#   MODE=discover  SERVER_FILTER (istege bagli; tek JVM adi, ayni cluster'daki kardesler de olculur)
#   MODE=op        OP=restart|stop|start PROFILE CELL NODE SERVER CONSENT=true CONFIRM (== SERVER)
#   WAS_ROOT       varsayilan /usr/WebSphere/AppServer
#   Sure ayarlari (playbook yalniz OP_BUDGET_S / DISC_DEADLINE_S verir; digerlerini bekci kisaltir):
#   STATUS_TIMEOUT STOP_TIMEOUT START_TIMEOUT CMD_GRACE KILL_AFTER POLL_S STOP_POLLS START_POLLS
#   STABILITY_S KILL_WAIT_S DISC_DEADLINE_S OP_BUDGET_S
#
# Cikti (TAB ayrimli satirlar; son satir HER ZAMAN RESULT):
#   STEP\t<adim>\t<OK|SKIP|FAIL|OLCULEMEDI>\t<mesaj>
#   PROF\t<profil>\t<cell>\t<node>\t<kimlik: var|yok|olculemedi>\t<sebep>                       (discover)
#   SRV\t<profil>\t<cell>\t<node>\t<server>\t<cluster>\t<state>\t<pids>\t<ss>\t<sebep>          (discover)
#   DISCOVER\t<json: {"overall","reason","profiles":[...]}>                                      (discover)
#   RESULT\t<op|discover>\t<OK|SKIP|FAIL|OLCULEMEDI>\t<once>\t<sonra>\t<mesaj>
# rc: OK/SKIP 0, FAIL 1, OLCULEMEDI 3. once/sonra: RUNNING|STOPPED|ASKIDA|COKLU_SUREC|OLCULEMEDI|-
# ('-' = JVM durumu hic olculmedi: girdi/kullanici/hedef/kimlik reddi).
# STEP durumu ADIMIN HEDEFINE ulasip ulasmadigidir: OK = ulasti (olcum adiminda: olculdu),
# SKIP = bilerek yapilmadi, FAIL = ulasilamadi (ornegin stop_dogrulama'da JVM hala RUNNING),
# OLCULEMEDI = olculemedi. Mesaji 'UYARI:' ile baslayan OK satiri: adim tamam ama dikkat
# gerektiren bir durum var (Portal sari gosterir).
#
# Uzun komutlar (serverStatus/stopServer/startServer, bekleme) ARKA PLANDA + `wait` ile kosar:
# dis sinir (playbook'taki timeout) sinyal gonderirse trap HEMEN calisir (komut ikamesi bitene
# kadar ERTELENMEZ), ic timeout'a TERM gider (o da kendi surec grubunu, yani WAS komutunu ve
# cocuklarini sonlandirir) ve RESULT OLCULEMEDI basilir. Yetim WAS komutu kalmaz.
set -u
export LC_ALL=C
umask 077

WAS_USER=was
NAME_RE='^[A-Za-z0-9_.-]+$'
num() { case "${1:-}" in ''|*[!0-9]*) printf '%s' "$2" ;; *) printf '%s' "$1" ;; esac; }
WAS_ROOT="${WAS_ROOT:-/usr/WebSphere/AppServer}"
STATUS_TIMEOUT="$(num "${STATUS_TIMEOUT:-}" 90)"
STOP_TIMEOUT="$(num "${STOP_TIMEOUT:-}" 300)"
START_TIMEOUT="$(num "${START_TIMEOUT:-}" 600)"
CMD_GRACE="$(num "${CMD_GRACE:-}" 30)"
KILL_AFTER="$(num "${KILL_AFTER:-}" 15)"
POLL_S="$(num "${POLL_S:-}" 10)"
STOP_POLLS="$(num "${STOP_POLLS:-}" 6)"
START_POLLS="$(num "${START_POLLS:-}" 30)"
STABILITY_S="$(num "${STABILITY_S:-}" 60)"
KILL_WAIT_S="$(num "${KILL_WAIT_S:-}" 30)"
DISC_DEADLINE_S="$(num "${DISC_DEADLINE_S:-}" 300)"
OP_BUDGET_S="$(num "${OP_BUDGET_S:-}" 1500)"
T0="$(date +%s)"

# Girdiler calisma degiskenleri sifirlanmadan ONCE alinir (CELL/NODE ayni adla is degiskeni de).
IN_PROFILE="${PROFILE:-}"; IN_CELL="${CELL:-}"; IN_NODE="${NODE:-}"; IN_SERVER="${SERVER:-}"
OPNAME=discover
RESULT_DONE=0
PS_OK=0; PIDS=""; NPIDS=-1; SS='?'; SS_NOTE=""; STATE=OLCULEMEDI; WHY=""
PROF=""; CELL=""; NODE=""; SRV=""; ENTRIES=""; PERR=""; PKIND=""
KIMLIK=olculemedi; KNOTE=""; CLMAP=""; CL_OK=1; CL_NOTE=""
BEFORE='-'; STOP_RC=0; START_RC=0; STOP_CODES=""; KILLED=""
CHILD=""; TMPD=""; BG_OUT=""

# ---------------------------------------------------------------- cikti
# Parola desenleri maskelenir (savunma derinligi; betik dosya icerigi basmaz): tireli arguman
# bicimi (bosluk/= ile deger) ve anahtar=deger / anahtar: deger bicimi.
mask() { sed -E 's/(^|[[:space:]])([-]password)([[:space:]=:]+)[^[:space:]]+/\1\2\3****/Ig; s/(password[[:space:]]*[=:][[:space:]]*)[^[:space:]&;,]+/\1****/Ig'; }
clean() { printf '%s' "${1:-}" | tr '\t\r\n' '   ' | tr -cd '\040-\176' | mask | cut -c1-400; }
jstr() { printf '"%s"' "$(clean "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }
step() { printf 'STEP\t%s\t%s\t%s\n' "$1" "$2" "$(clean "$3")"; }
result() {
  RESULT_DONE=1
  printf 'RESULT\t%s\t%s\t%s\t%s\t%s\n' "$OPNAME" "$1" "$2" "$3" "$(clean "$4")"
  case "$1" in OK|SKIP) exit 0 ;; OLCULEMEDI) exit 3 ;; *) exit 1 ;; esac
}
# Sinyal/zaman asimi ya da beklenmeyen cikis: RESULT yine basilir. Islem yarida kaldiysa son
# durum BILINMIYOR (OLCULEMEDI); hic olculmediyse '-'. Arka planda kosan ic komut (CHILD: bizim
# baslattigimiz `timeout`) TERM alir; timeout bunu kendi surec grubuna (WAS komutu) iletir.
on_exit() {
  local rc=$? after='-' ic=""
  # GNU timeout TERM'u hem dogrudan bash'e hem surec grubuna gonderir: ikinci TERM bu
  # fonksiyonun ORTASINDA gelip RESULT'u yutmasin.
  trap '' TERM INT
  if [ -n "$CHILD" ]; then
    kill -TERM "$CHILD" 2>/dev/null && ic="; ic komut (pid $CHILD) sonlandirildi"
    CHILD=""
  fi
  case "$TMPD" in */.opsx_was_run.*) rm -rf -- "$TMPD" ;; esac
  [ "$RESULT_DONE" = 1 ] && return
  RESULT_DONE=1
  [ "$BEFORE" = '-' ] || after=OLCULEMEDI
  printf 'RESULT\t%s\tOLCULEMEDI\t%s\t%s\tbetik beklenmedik sekilde sona erdi (rc %s)%s; son durum bilinmiyor\n' "$OPNAME" "$BEFORE" "$after" "$rc" "$ic"
  exit 3
}
trap on_exit EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# Uzun komut ARKA PLANDA: cikti gecici dosyaya, `wait` sinyalle hemen kesilir (trap ertelenmez).
# Donus: komutun rc'si; cikti BG_OUT'ta.
bgrun() {
  local rc
  BG_OUT=""
  [ -n "$TMPD" ] || { BG_OUT="gecici dizin yok; komut calistirilmadi"; return 125; }
  "$@" </dev/null >"$TMPD/out" 2>&1 &
  CHILD=$!
  wait "$CHILD"; rc=$?
  CHILD=""
  BG_OUT="$(cat "$TMPD/out" 2>/dev/null)"
  return "$rc"
}
bgsleep() { sleep "$1" & CHILD=$!; wait "$CHILD"; CHILD=""; }
# Gecici dizin (yalniz bu kosuya ozel, 0700): bgrun ciktisi. Olusturulamazsa olcum YAPILMAZ.
need_tmp() {
  [ -n "$TMPD" ] && return 0
  TMPD="$(mktemp -d "${TMPDIR:-/tmp}/.opsx_was_run.XXXXXX" 2>/dev/null)" || TMPD=""
  [ -n "$TMPD" ] && [ -d "$TMPD" ]
}

# Olcum adimi (once): durum olculduyse OK. Dogrulama adimi hedefe ulasamadiysa vstat: FAIL
# (olculemediyse OLCULEMEDI) - "olculdu" ile "hedefe ulasildi" karismasin.
stcode() { case "$1" in RUNNING|STOPPED|ASKIDA) echo OK ;; OLCULEMEDI) echo OLCULEMEDI ;; *) echo FAIL ;; esac; }
vstat() { if [ "$1" = OLCULEMEDI ]; then echo OLCULEMEDI; else echo FAIL; fi; }
cnt() { set -- ${1:-}; printf '%s' "$#"; }
codes_of() { printf '%s\n' "$1" | grep -Eo '(ADMU|ADMN|SECJ|WASX)[0-9]{4}[A-Z]' | sort -u | tr '\n' ' '; }
tail_of() { printf '%s\n' "$1" | grep -v '^[[:space:]]*$' | tail -3 | tr '\n' ' '; }
# "Kesin yok" (0) YALNIZ: yol yok VE ust dizin listelenebiliyor VE listede o ad YOK. Listede
# gorunup [ -e ] ile gorulemeyen (x izni olmayan dizin, cozulemeyen bag) "yok" DEGIL (1):
# izin hatasi "yok" ile karismasin. Ust dizin listelenemiyorsa da "yok" denemez.
surely_absent() {
  local d b l
  [ -e "$1" ] && return 1
  d="$(dirname "$1")"; b="$(basename "$1")"
  l="$(ls -A "$d" 2>/dev/null)" || return 1
  ! printf '%s\n' "$l" | grep -Fxq -- "$b"
}
# Kalan islem butcesi (sn) ve butceye sigdirma: fit <istenen> <ayrilan_pay> <taban>
left() { printf '%s' "$((OP_BUDGET_S - ($(date +%s) - T0)))"; }
fit() { local l; l=$(( $(left) - $2 )); [ "$l" -lt "$3" ] && l="$3"; [ "$1" -lt "$l" ] && l="$1"; printf '%s' "$l"; }

# ---------------------------------------------------------------- olcum
# Surecler: ps argv'sinin SON UC alani <cell> <node> <server> ile TAM eslesme (app1 != app10).
ps_match() {
  local out
  PIDS=""; PS_OK=0
  out="$(ps -eo pid=,args= -ww 2>/dev/null)" || return 0
  [ -n "$out" ] || return 0
  PS_OK=1
  PIDS="$(awk -v c="$1" -v n="$2" -v s="$3" 'NF >= 4 && $NF == s && $(NF-1) == n && $(NF-2) == c { printf "%s ", $1 }' <<< "$out")"
  PIDS="${PIDS% }"
}

# serverStatus ciktisini TEK awk geciste tarar. Cikti: "<up> <un> <td> <sec> <err> [kodlar...]"
#   up : ADMU0508I + "<server>" ayni satirda      un : ADMU0509I + "<server>" ayni satirda
#   td : ADMU0522E                                 sec: kimlik/yetki/istisna izi (HER SECJ kodu dahil)
#   err: ADMU0522E disinda bir ADMU....E kodu
# SECJ/ADMN0022E KODLARI satirin ASLINDA aranir. Serbest metin sozcukleri (DENIED, EXCEPTION...)
# ise sunucu ve profil ADLARI (tam sozcuk olarak) <AD> ile degistirilmis satirda aranir: WAS
# ciktisi adi log yolunda, "for <ad>" ve "<ad>" icinde basar; "AuthorizationWS" adli bir JVM
# kendi adi yuzunden "kimlik hatasi" sayilmasin. Ad bir kodla cakissa bile kod tespiti bozulmaz.
ss_scan() {
  awk -v s="\"$1\"" -v n1="$1" -v n2="${2:-}" '
    function adch(c) { return c != "" && c ~ /[A-Z0-9_.-]/ }
    function adsiz(u, n,   o, q, b, a) {
      if (n == "") return u
      o = ""
      while ((q = index(u, n)) > 0) {
        b = q > 1 ? substr(u, q - 1, 1) : ""
        a = substr(u, q + length(n), 1)
        if (!adch(b) && !adch(a)) o = o substr(u, 1, q - 1) "<AD>"
        else o = o substr(u, 1, q - 1 + length(n))
        u = substr(u, q + length(n))
      }
      return o u
    }
    BEGIN { n1 = toupper(n1); n2 = toupper(n2) }
    { l = $0; u = toupper(l); t = l
      if (u ~ /SECJ[0-9][0-9][0-9][0-9]|ADMN0022E/) sec = 1
      if (adsiz(adsiz(u, n1), n2) ~ /DENIED|AUTHENTICAT|AUTHORIZ|EXCEPTION|PASSWORD|USERNAME:|CREDENTIAL/) sec = 1
      while (match(t, /(ADMU|ADMN|SECJ|WASX)[0-9][0-9][0-9][0-9][A-Z]/)) {
        c = substr(t, RSTART, RLENGTH); t = substr(t, RSTART + RLENGTH)
        if (!(c in seen)) { seen[c] = 1; codes = codes " " c }
        if (c ~ /^ADMU[0-9][0-9][0-9][0-9]E$/ && c != "ADMU0522E") err = 1
      }
      if (index(l, "ADMU0508I") && index(l, s)) up = 1
      if (index(l, "ADMU0509I") && index(l, s)) un = 1
      if (index(l, "ADMU0522E")) td = 1 }
    END { printf "%d %d %d %d %d%s\n", up, un, td, sec, err, codes }'
}

# serverStatus: yalniz bilinen kodlar (ADMU0508I UP, ADMU0509I ULASILAMIYOR, ADMU0522E TANIMSIZ).
# Zaman asimi, HER SECJ kodu (WAS kimlik/yetki hatasinda da "appears to be stopped" basabilir),
# ADMU0522E disindaki her ADMU....E, yetki/kimlik/istisna metni, bos ya da celiskili cikti -> '?'.
# UP/ULASILAMIYOR ayrica rc 0 ister (rc != 0 iken "durmus gorunuyor" OLCUM sayilmaz).
ss_measure() {
  local out rc codes up=0 un=0 td=0 sec=0 err=0
  SS='?'; SS_NOTE=""
  if [ ! -x "$1/bin/serverStatus.sh" ]; then SS_NOTE="serverStatus.sh yok ya da calistirilamaz"; return 0; fi
  bgrun timeout -k 5 "$STATUS_TIMEOUT" "$1/bin/serverStatus.sh" "$2" </dev/null; rc=$?; out="$BG_OUT"
  case "$rc" in
    124|137) SS_NOTE="serverStatus zaman asimi (${STATUS_TIMEOUT}s)"; return 0 ;;
    126|127) SS_NOTE="serverStatus calistirilamadi (rc $rc)"; return 0 ;;
  esac
  read -r up un td sec err codes <<< "$(ss_scan "$2" "$(basename "$1")" <<< "$out")"
  if ! [[ "$up$un$td$sec$err" =~ ^[01]{5}$ ]]; then SS_NOTE="serverStatus ciktisi ayristirilamadi (rc $rc)"; return 0; fi
  if [ "$sec" != 0 ]; then
    SS_NOTE="serverStatus kimlik/yetki hatasi ya da istisna (rc $rc; kodlar: ${codes:-yok})"; return 0
  fi
  if [ "$err" != 0 ]; then
    SS_NOTE="serverStatus hata kodu (rc $rc; kodlar: ${codes:-yok})"; return 0
  fi
  if [ "$rc" != 0 ] && [ "$up$un$td" != 001 ]; then
    SS_NOTE="serverStatus rc $rc (kodlar: ${codes:-yok}); rc 0 olmadan UP/ULASILAMIYOR sayilmaz"; return 0
  fi
  case "$up$un$td" in
    100) SS=UP ;;
    010) SS=ULASILAMIYOR ;;
    001) SS=TANIMSIZ ;;
    000) SS_NOTE="serverStatus bilinen kod basmadi (rc $rc; kodlar: ${codes:-yok})"; return 0 ;;
    *) SS_NOTE="serverStatus celiskili kodlar (rc $rc; kodlar: ${codes:-yok})"; return 0 ;;
  esac
  SS_NOTE="serverStatus rc $rc, ${codes:-kod yok}"
}

# Durum tablosu (README): PS ve SS iki bagimsiz olcum; olculemeyen durum ASLA STOPPED olmaz.
classify() {
  local n
  if [ "$PS_OK" != 1 ]; then STATE=OLCULEMEDI; NPIDS=-1; WHY="ps olculemedi (rc != 0 ya da bos cikti)"; return 0; fi
  n="$(cnt "$PIDS")"; NPIDS="$n"
  if [ "$n" -ge 2 ]; then STATE=COKLU_SUREC; WHY="$n surec ayni cell/node/server uclusuyle eslesti (pid: $PIDS)"; return 0; fi
  case "$SS" in
    UP)
      if [ "$n" -eq 1 ]; then STATE=RUNNING; WHY="pid $PIDS; $SS_NOTE"
      else STATE=OLCULEMEDI; WHY="celiski: surec yok ama serverStatus UP ($SS_NOTE)"; fi ;;
    ULASILAMIYOR)
      if [ "$n" -eq 0 ]; then STATE=STOPPED; WHY="surec yok; $SS_NOTE"
      else STATE=ASKIDA; WHY="surec var (pid $PIDS) ama serverStatus ulasamiyor ($SS_NOTE)"; fi ;;
    TANIMSIZ) STATE=OLCULEMEDI; WHY="tutarsizlik: serverindex.xml'de tanimli ama serverStatus ADMU0522E ($SS_NOTE)" ;;
    *) STATE=OLCULEMEDI; WHY="${SS_NOTE:-serverStatus olculemedi} (surec sayisi $n)" ;;
  esac
}

measure() { ps_match "$CELL" "$NODE" "$SRV"; ss_measure "$PROF" "$SRV"; classify; }

# ---------------------------------------------------------------- yapilandirma (salt okunur)
kv() {
  printf '%s\n' "$2" | grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" | tail -1 | sed -E "s/^[^=]*=//; s/[\"']//g; s/[[:space:]].*$//"
}

# serverindex.xml -> "<serverName>\t<serverType>" satirlari
srv_entries() {
  tr '\r\n\t' '   ' | sed 's/<serverEntries[[:space:]]/\n&/g' | awk '
    /^<serverEntries[[:space:]]/ {
      t = $0; sub(/>.*/, "", t); n = ""; ty = ""
      if (match(t, /[[:space:]]serverName="[^"]*"/)) { n = substr(t, RSTART, RLENGTH); sub(/^[[:space:]]serverName="/, "", n); sub(/"$/, "", n) }
      if (match(t, /[[:space:]]serverType="[^"]*"/)) { ty = substr(t, RSTART, RLENGTH); sub(/^[[:space:]]serverType="/, "", ty); sub(/"$/, "", ty) }
      print n "\t" ty
    }'
}

# cluster.xml -> "<nodeName>\t<memberName>" satirlari
cl_members() {
  tr '\r\n\t' '   ' | sed 's/<members[[:space:]]/\n&/g' | awk '
    /^<members[[:space:]]/ {
      t = $0; sub(/>.*/, "", t); m = ""; nn = ""
      if (match(t, /[[:space:]]memberName="[^"]*"/)) { m = substr(t, RSTART, RLENGTH); sub(/^[[:space:]]memberName="/, "", m); sub(/"$/, "", m) }
      if (match(t, /[[:space:]]nodeName="[^"]*"/)) { nn = substr(t, RSTART, RLENGTH); sub(/^[[:space:]]nodeName="/, "", nn); sub(/"$/, "", nn) }
      if (m != "") print nn "\t" m
    }'
}

# Profili cozer: setupCmdLine.sh'ten WAS_CELL/WAS_NODE (kaynaklanmaz, yalniz okunur), sonra YALNIZ
# kendi node'unun serverindex.xml'i (Dmgr01'in ana deposu tum node'lari icerir; okunmaz).
# PKIND: degil (setupCmdLine.sh kesin yok: profil degil) | yok (serverindex.xml kesin yok)
#        | okunamadi (olculemedi) | bicim (WAS_CELL/WAS_NODE cozulemedi)
prof_resolve() {
  local p="$WAS_ROOT/profiles/$1" setup xml f
  PROF="$p"; CELL=""; NODE=""; ENTRIES=""; PERR=""; PKIND=""
  if [ ! -e "$p/bin/setupCmdLine.sh" ]; then
    if surely_absent "$p/bin/setupCmdLine.sh" || surely_absent "$p/bin"; then PERR="bin/setupCmdLine.sh yok (profil degil)"; PKIND=degil
    else PERR="bin/ okunamadi (setupCmdLine.sh olculemedi)"; PKIND=okunamadi; fi
    return 1
  fi
  if ! setup="$(cat "$p/bin/setupCmdLine.sh" 2>/dev/null)"; then PERR="bin/setupCmdLine.sh okunamadi"; PKIND=okunamadi; return 1; fi
  CELL="$(kv WAS_CELL "$setup")"; NODE="$(kv WAS_NODE "$setup")"
  if ! [[ "$CELL" =~ $NAME_RE ]] || ! [[ "$NODE" =~ $NAME_RE ]]; then
    PERR="setupCmdLine.sh'den WAS_CELL/WAS_NODE cozulemedi"; PKIND=bicim; CELL=""; NODE=""; return 1
  fi
  f="$p/config/cells/$CELL/nodes/$NODE/serverindex.xml"
  if [ ! -e "$f" ]; then
    if surely_absent "$f"; then PERR="kendi node'unun serverindex.xml'i yok (cells/$CELL/nodes/$NODE)"; PKIND=yok
    else PERR="cells/$CELL/nodes/$NODE okunamadi (serverindex.xml olculemedi)"; PKIND=okunamadi; fi
    return 1
  fi
  if ! xml="$(cat "$f" 2>/dev/null)"; then PERR="serverindex.xml okunamadi (cells/$CELL/nodes/$NODE)"; PKIND=okunamadi; return 1; fi
  ENTRIES="$(printf '%s' "$xml" | srv_entries)"
  return 0
}

# Cluster uyelikleri: config/cells/<cell>/clusters/*/cluster.xml (memberName + nodeName).
# Okunamayan cluster bilgisi '' (uye degil) DEGIL '?' (olculemedi) olur. Liste `ls`ten alinir:
# listede olup [ -e ] ile gorulemeyen giris (x izni olmayan clusters dizini) olculemedi sayilir,
# sessizce atlanmaz.
load_clusters() {
  local d="$1/config/cells/$2/clusters" c x names
  CLMAP=""; CL_OK=1; CL_NOTE=""
  if [ ! -e "$d" ]; then
    surely_absent "$d" || { CL_OK=0; CL_NOTE="clusters dizini olculemedi"; }
    return 0
  fi
  if ! names="$(ls -A "$d" 2>/dev/null)"; then CL_OK=0; CL_NOTE="clusters dizini okunamadi"; return 0; fi
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    if [ ! -e "$d/$c" ]; then CL_OK=0; CL_NOTE="clusters/$c listede var ama erisilemiyor"; continue; fi
    [ -d "$d/$c" ] || continue
    if ! x="$(cat "$d/$c/cluster.xml" 2>/dev/null)"; then CL_OK=0; CL_NOTE="$c/cluster.xml okunamadi"; continue; fi
    CLMAP="${CLMAP}$(printf '%s' "$x" | cl_members | awk -F'\t' -v c="$c" '{ print $1 "\t" $2 "\t" c }')"$'\n'
  done <<< "$names"
}

cluster_of() {
  local c
  c="$(printf '%s' "$CLMAP" | awk -F'\t' -v n="$1" -v s="$2" '$1 == n && $2 == s { print $3 }' | sort -u | paste -sd, -)"
  if [ -n "$c" ]; then printf '%s' "$c"; elif [ "$CL_OK" = 1 ]; then printf ''; else printf '?'; fi
}

# Kimlik (K2-a): soap.client.props icerigi basilmaz; yalniz loginUserid satiri sayilir.
kimlik_of() {
  local f="$1/properties/soap.client.props" n rc
  if [ ! -e "$f" ]; then
    if surely_absent "$f"; then KIMLIK=yok; KNOTE="properties/soap.client.props yok"
    else KIMLIK=olculemedi; KNOTE="properties/ okunamadi (soap.client.props olculemedi)"; fi
    return 0
  fi
  n="$(grep -Ec '^[[:space:]]*com\.ibm\.SOAP\.loginUserid[[:space:]]*=[[:space:]]*[^[:space:]]' "$f" 2>/dev/null)"; rc=$?
  case "$rc" in
    0) KIMLIK=var; KNOTE="soap.client.props loginUserid satiri: $n" ;;
    1) KIMLIK=yok; KNOTE="soap.client.props loginUserid satiri: 0" ;;
    *) KIMLIK=olculemedi; KNOTE="soap.client.props okunamadi" ;;
  esac
}

# ---------------------------------------------------------------- kesif (salt okunur)
disc_fail() {
  printf 'DISCOVER\t{"overall":"olculemedi","reason":%s,"profiles":[]}\n' "$(jstr "$2")"
  result "$1" - - "$2"
}

discover() {
  OPNAME=discover
  local now overall=ok oreason="" pj="" sj="" pnames p s sel fc cl reason preason names bad np=0 ns=0 nb=0 bnote=""
  local -a PLIST
  if [ "$ME" != "$WAS_USER" ]; then
    step kullanici FAIL "betik $WAS_USER olarak kosmuyor (id -un=${ME:-?})"
    disc_fail FAIL "betik $WAS_USER olarak kosmuyor (id -un=${ME:-?}); olcum yapilmadi"
  fi
  step kullanici OK "$ME"
  need_tmp || disc_fail OLCULEMEDI "gecici dizin olusturulamadi (mktemp); olcum yapilmadi"
  if [ -n "${SERVER_FILTER:-}" ] && ! [[ "$SERVER_FILTER" =~ $NAME_RE ]]; then
    disc_fail FAIL "gecersiz SERVER_FILTER; olcum yapilmadi"
  fi
  if [ ! -e "$WAS_ROOT" ]; then
    surely_absent "$WAS_ROOT" || disc_fail OLCULEMEDI "$WAS_ROOT ust dizini okunamadi; WAS varligi olculemedi"
    printf 'DISCOVER\t{"overall":"ok","reason":%s,"profiles":[]}\n' "$(jstr "WAS kurulu degil ($WAS_ROOT yok)")"
    result OK - - "WAS kurulu degil ($WAS_ROOT yok)"
  fi
  if [ ! -e "$WAS_ROOT/profiles" ]; then
    surely_absent "$WAS_ROOT/profiles" || disc_fail OLCULEMEDI "$WAS_ROOT okunamadi; profil dizini olculemedi"
    printf 'DISCOVER\t{"overall":"ok","reason":%s,"profiles":[]}\n' "$(jstr "profil dizini yok ($WAS_ROOT/profiles)")"
    result OK - - "profil dizini yok"
  fi
  if ! pnames="$(ls -1 "$WAS_ROOT/profiles" 2>/dev/null)"; then
    disc_fail OLCULEMEDI "$WAS_ROOT/profiles listelenemedi; liste olculemedi"
  fi
  mapfile -t PLIST <<< "$pnames"
  for p in "${PLIST[@]}"; do
    [ -n "$p" ] || continue
    if [ ! -d "$WAS_ROOT/profiles/$p" ]; then
      [ -e "$WAS_ROOT/profiles/$p" ] && continue
      overall=olculemedi; oreason="$oreason $(clean "$p"): listede var ama erisilemiyor;"
      printf 'PROF\t%s\t\t\tolculemedi\t%s\n' "$(clean "$p")" "listede var ama erisilemiyor (izin ya da cozulemeyen bag); olculmedi"
      pj="$pj${pj:+,}{\"profile\":$(jstr "$p"),\"cell\":\"\",\"node\":\"\",\"kimlik\":\"olculemedi\",\"reason\":$(jstr "listede var ama erisilemiyor (izin ya da cozulemeyen bag); olculmedi"),\"servers\":[]}"
      continue
    fi
    sj=""
    if ! [[ "$p" =~ $NAME_RE ]]; then
      overall=olculemedi; oreason="$oreason gecersiz adli profil olculmedi;"
      printf 'PROF\t%s\t\t\tolculemedi\t%s\n' "$(clean "$p")" "gecersiz profil adi; olculmedi"
      pj="$pj${pj:+,}{\"profile\":$(jstr "$p"),\"cell\":\"\",\"node\":\"\",\"kimlik\":\"olculemedi\",\"reason\":$(jstr "gecersiz profil adi; olculmedi"),\"servers\":[]}"
      continue
    fi
    if ! prof_resolve "$p"; then
      if [ "$PKIND" = degil ]; then
        printf 'PROF\t%s\t\t\tolculemedi\t%s\n' "$p" "$(clean "$PERR; atlandi")"
        pj="$pj${pj:+,}{\"profile\":$(jstr "$p"),\"cell\":\"\",\"node\":\"\",\"kimlik\":\"olculemedi\",\"reason\":$(jstr "$PERR; atlandi"),\"servers\":[]}"
        continue
      fi
      np=$((np + 1))
      kimlik_of "$WAS_ROOT/profiles/$p"
      if [ "$PKIND" = yok ]; then preason="$PERR; bu profilde JVM tanimi yok"
      else overall=olculemedi; oreason="$oreason $p: $PERR;"; preason="$PERR; JVM listesi olculemedi"; fi
      printf 'PROF\t%s\t%s\t%s\t%s\t%s\n' "$p" "$CELL" "$NODE" "$KIMLIK" "$(clean "$preason")"
      pj="$pj${pj:+,}{\"profile\":$(jstr "$p"),\"cell\":$(jstr "$CELL"),\"node\":$(jstr "$NODE"),\"kimlik\":\"$KIMLIK\",\"reason\":$(jstr "$preason"),\"servers\":[]}"
      continue
    fi
    np=$((np + 1))
    kimlik_of "$PROF"
    load_clusters "$PROF" "$CELL"
    names=""; bad=0
    for s in $(printf '%s\n' "$ENTRIES" | awk -F'\t' '$2 == "APPLICATION_SERVER" && !seen[$1]++ { print $1 }'); do
      if [[ "$s" =~ $NAME_RE ]]; then names="$names $s"; else bad=$((bad + 1)); fi
    done
    preason="$KNOTE"
    [ "$CL_OK" = 1 ] || preason="$preason; cluster bilgisi olculemedi ($CL_NOTE)"
    if [ "$bad" -gt 0 ]; then
      overall=olculemedi; oreason="$oreason $p: $bad gecersiz adli JVM olculmedi;"
      preason="$preason; $bad gecersiz adli JVM listelenmedi"
    fi
    printf 'PROF\t%s\t%s\t%s\t%s\t%s\n' "$p" "$CELL" "$NODE" "$KIMLIK" "$(clean "$preason")"
    sel=""
    if [ -n "${SERVER_FILTER:-}" ]; then
      case " $names " in
        *" $SERVER_FILTER "*)
          fc="$(cluster_of "$NODE" "$SERVER_FILTER")"
          for s in $names; do
            if [ "$s" = "$SERVER_FILTER" ]; then sel="$sel $s"
            elif [ -n "$fc" ] && [ "$fc" != '?' ] && [ "$(cluster_of "$NODE" "$s")" = "$fc" ]; then sel="$sel $s"; fi
          done ;;
      esac
    else
      sel="$names"
    fi
    for s in $sel; do
      SRV="$s"; ns=$((ns + 1))
      now="$(date +%s)"
      if [ $((now - T0)) -ge "$DISC_DEADLINE_S" ]; then
        nb=$((nb + 1))
        ps_match "$CELL" "$NODE" "$SRV"; SS='?'; SS_NOTE="kesif sure butcesi (${DISC_DEADLINE_S}s) asildi; serverStatus calistirilmadi"; classify
      elif [ "$KIMLIK" != var ]; then
        ps_match "$CELL" "$NODE" "$SRV"; SS='?'; SS_NOTE="kimlik $KIMLIK ($KNOTE); serverStatus calistirilmadi"; classify
      else
        measure
      fi
      cl="$(cluster_of "$NODE" "$s")"
      reason="$WHY"
      [ "$cl" = '?' ] && reason="$reason; cluster bilgisi olculemedi ($CL_NOTE)"
      printf 'SRV\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$p" "$CELL" "$NODE" "$s" "$cl" "$STATE" "$NPIDS" "$SS" "$(clean "$reason")"
      sj="$sj${sj:+,}{\"server\":$(jstr "$s"),\"cluster\":$(jstr "$cl"),\"state\":\"$STATE\",\"pids\":$NPIDS,\"ss\":\"$SS\",\"reason\":$(jstr "$reason")}"
    done
    pj="$pj${pj:+,}{\"profile\":$(jstr "$p"),\"cell\":$(jstr "$CELL"),\"node\":$(jstr "$NODE"),\"kimlik\":\"$KIMLIK\",\"reason\":$(jstr "$preason"),\"servers\":[$sj]}"
  done
  # Sure butcesi asildiysa JVM LISTESI yine tamdir (overall ok); asilan JVM'ler OLCULEMEDI ve
  # bu durum hem RESULT mesajinda hem DISCOVER reason'inda acikca yazilir.
  [ "$nb" -gt 0 ] && bnote="$nb JVM kesif sure butcesi (${DISC_DEADLINE_S}s) asildigi icin OLCULMEDI"
  if [ "$overall" = ok ]; then
    printf 'DISCOVER\t{"overall":"ok","reason":%s,"profiles":[%s]}\n' "$(jstr "$bnote")" "$pj"
    result OK - - "kesif tamam: $np profil, $ns JVM listelendi${bnote:+; $bnote}"
  fi
  printf 'DISCOVER\t{"overall":"%s","reason":%s,"profiles":[%s]}\n' "$overall" "$(jstr "${oreason# }${bnote:+ $bnote}")" "$pj"
  result OLCULEMEDI - - "kesif eksik (liste tam degil):$oreason${bnote:+ $bnote}"
}

# ---------------------------------------------------------------- islem (tek JVM)
run_stop() {
  local out
  bgrun timeout -k "$KILL_AFTER" "$((STOP_TIMEOUT + CMD_GRACE))" "$PROF/bin/stopServer.sh" "$SRV" -timeout "$STOP_TIMEOUT" </dev/null; STOP_RC=$?; out="$BG_OUT"
  STOP_CODES="$(codes_of "$out")"; STOP_CODES="${STOP_CODES% }"
  case "$STOP_RC" in
    0) step stop_komutu OK "stopServer.sh $SRV -timeout $STOP_TIMEOUT: rc 0 $STOP_CODES" ;;
    124|137) step stop_komutu FAIL "stopServer.sh zaman asimi ($((STOP_TIMEOUT + CMD_GRACE))s)" ;;
    *) step stop_komutu FAIL "stopServer.sh rc $STOP_RC: $(tail_of "$out")" ;;
  esac
}

# Stop GERCEKTEN sure doldurdu mu: dis timeout (rc 124/137) ya da WAS'in kendi zaman asimi kodu
# (ADMU3060E). Hizli ret (ornegin ADMN0022E yetki reddi) ya da calistirilamayan stopServer
# (rc 126/127) sure dolmasi DEGILDIR (K3-a: kill -9 yalniz "stop suresi dolarsa").
stop_timed_out() {
  case "$STOP_RC" in 124|137) return 0 ;; esac
  case " $STOP_CODES " in *" ADMU3060E "*) return 0 ;; esac
  return 1
}

# start komutu kalan butceye sigdirilir (restart'in sonunda): dogrulama + pay ayrilir, en az 60 sn.
run_start() {
  local out st
  st="$(fit "$START_TIMEOUT" "$((CMD_GRACE + KILL_AFTER + STATUS_TIMEOUT + 30))" 60)"
  bgrun timeout -k "$KILL_AFTER" "$((st + CMD_GRACE))" "$PROF/bin/startServer.sh" "$SRV" -timeout "$st" </dev/null; START_RC=$?; out="$BG_OUT"
  case "$START_RC" in
    0) step start_komutu OK "startServer.sh $SRV -timeout $st: rc 0 $(codes_of "$out")" ;;
    124|137) step start_komutu FAIL "startServer.sh zaman asimi ($((st + CMD_GRACE))s)" ;;
    *) step start_komutu FAIL "startServer.sh rc $START_RC: $(tail_of "$out")" ;;
  esac
}

# wait_for <hedef> <pencere_sn>: pencere boyunca POLL_S aralikla yoklar; hedefe ulasinca 0.
# serverStatus yalniz surec sayisi hedefe uyuyorsa calistirilir. Pencere DUVAR SAATIdir (deneme
# sayisi degil): yavas serverStatus pencereyi uzatmaz. Donuste STATE son TAM olcumdur.
wait_for() {
  local end n full=0
  end=$(( $(date +%s) + $2 ))
  while :; do
    full=0
    ps_match "$CELL" "$NODE" "$SRV"
    if [ "$PS_OK" = 1 ]; then
      n="$(cnt "$PIDS")"
      if { [ "$1" = STOPPED ] && [ "$n" -eq 0 ]; } || { [ "$1" = RUNNING ] && [ "$n" -eq 1 ]; }; then
        ss_measure "$PROF" "$SRV"; classify; full=1
        [ "$STATE" = "$1" ] && return 0
      fi
    fi
    [ "$(date +%s)" -ge "$end" ] && break
    bgsleep "$POLL_S"
  done
  [ "$full" = 1 ] || measure
  [ "$STATE" = "$1" ]
}

stability() {
  bgsleep "$STABILITY_S"
  measure
}

# K3-a: YALNIZ restart'ta, stop GERCEKTEN sure doldurduysa (stop_timed_out) ya da pencere
# sonunda JVM ASKIDA ise (surec var, yanit yok); cell+node+server uclusuyle TEK PID
# eslesiyorsa kill -9. Iki ve fazlasi -> kill YOK, FAIL. Stop isleminde bu fonksiyon HIC
# cagrilmaz. $1 = kill sebebi (adim mesajina ve RESULT'a aynen yazilir).
kill_one() {
  local pid n i=0 why="$1"
  ps_match "$CELL" "$NODE" "$SRV"
  if [ "$PS_OK" != 1 ]; then
    step kill OLCULEMEDI "$why; ps olculemedi, kill -9 yapilmadi"
    result OLCULEMEDI "$BEFORE" OLCULEMEDI "$why; ps olculemedi, kill -9 yapilmadi; gercek durum bilinmiyor"
  fi
  n="$(cnt "$PIDS")"
  if [ "$n" -eq 0 ]; then step kill SKIP "eslesen surec kalmadi; kill gerekmedi"; return 0; fi
  if [ "$n" -ge 2 ]; then
    step kill FAIL "$n PID eslesti (pid: $PIDS); kill -9 YAPILMADI"
    result FAIL "$BEFORE" COKLU_SUREC "durdurulamadi; $n PID eslestigi icin kill -9 YAPILMADI (pid: $PIDS)"
  fi
  pid="$PIDS"
  case "$pid" in ''|*[!0-9]*) step kill FAIL "gecersiz pid ($pid)"; result FAIL "$BEFORE" "$STATE" "durdurulamadi; gecersiz pid, kill yapilmadi" ;; esac
  if ! kill -9 "$pid" 2>/dev/null; then
    step kill FAIL "kill -9 $pid basarisiz"
    result FAIL "$BEFORE" "$STATE" "durdurulamadi; kill -9 $pid basarisiz"
  fi
  KILLED="$pid"
  step kill OK "$why; cell/node/server uclusuyle TEK PID ($pid) eslesti; kill -9 gonderildi"
  while :; do
    ps_match "$CELL" "$NODE" "$SRV"
    if [ "$PS_OK" = 1 ]; then case " $PIDS " in *" $pid "*) ;; *) return 0 ;; esac; fi
    i=$((i + 1))
    [ "$i" -gt "$KILL_WAIT_S" ] && break
    bgsleep 1
  done
  result FAIL "$BEFORE" OLCULEMEDI "kill -9 sonrasi pid $pid ${KILL_WAIT_S}s icinde kaybolmadi"
}

do_stop() {
  run_stop
  if ! wait_for STOPPED "$((STOP_POLLS * POLL_S))"; then
    step stop_dogrulama "$(vstat "$STATE")" "$STATE: $WHY"
    [ "$STATE" = OLCULEMEDI ] && result OLCULEMEDI "$BEFORE" OLCULEMEDI "stop sonrasi durum olculemedi: $WHY"
    result FAIL "$BEFORE" "$STATE" "durdurulamadi (stop'ta kill YOK); pid: ${PIDS:-yok}; $WHY"
  fi
  step stop_dogrulama OK "STOPPED: $WHY"
  stability
  case "$STATE" in
    STOPPED)
      step stabilite OK "${STABILITY_S}s sonra hala STOPPED"
      if [ "$STOP_RC" = 0 ]; then result OK "$BEFORE" STOPPED "durduruldu; ${STABILITY_S}s sonra hala STOPPED"; fi
      result FAIL "$BEFORE" STOPPED "JVM durdu ama stopServer rc $STOP_RC" ;;
    OLCULEMEDI)
      step stabilite OLCULEMEDI "${STABILITY_S}s sonra: $WHY"
      result OLCULEMEDI "$BEFORE" OLCULEMEDI "stabilite olcumu olculemedi: $WHY" ;;
    *)
      step stabilite FAIL "${STABILITY_S}s sonra $STATE: $WHY"
      result FAIL "$BEFORE" "$STATE" "JVM durduktan sonra ${STABILITY_S}s icinde geri geldi (nodeagent?): $WHY" ;;
  esac
}

do_start() {
  local w
  if [ "$1" = 1 ]; then run_start; else START_RC=0; fi
  w="$(fit "$((START_POLLS * POLL_S))" "$((STATUS_TIMEOUT + 5))" 0)"
  if wait_for RUNNING "$w"; then
    step start_dogrulama OK "RUNNING: $WHY"
    if [ "$START_RC" = 0 ]; then result OK "$BEFORE" RUNNING "$2"; fi
    result FAIL "$BEFORE" RUNNING "JVM RUNNING ama startServer rc $START_RC"
  fi
  step start_dogrulama "$(vstat "$STATE")" "$STATE: $WHY"
  case "$STATE" in
    OLCULEMEDI) result OLCULEMEDI "$BEFORE" OLCULEMEDI "start sonrasi durum olculemedi: $WHY" ;;
    ASKIDA) result FAIL "$BEFORE" ASKIDA "surec var, e-business acilmadi (serverStatus ulasamiyor): $WHY" ;;
    *) result FAIL "$BEFORE" "$STATE" "JVM baslatilamadi: $WHY" ;;
  esac
}

do_restart() {
  local nasil="stop"
  run_stop
  if wait_for STOPPED "$((STOP_POLLS * POLL_S))"; then
    step stop_dogrulama OK "STOPPED: $WHY"
  else
    step stop_dogrulama "$(vstat "$STATE")" "$STATE: $WHY"
    case "$STATE" in
      OLCULEMEDI) result OLCULEMEDI "$BEFORE" OLCULEMEDI "stop sonrasi durum olculemedi (kill yapilmadi): $WHY" ;;
      COKLU_SUREC)
        step kill FAIL "$(cnt "$PIDS") PID eslesti (pid: $PIDS); kill -9 YAPILMADI"
        result FAIL "$BEFORE" COKLU_SUREC "durdurulamadi; birden cok PID eslestigi icin kill -9 YAPILMADI (pid: $PIDS)" ;;
    esac
    # K3-a: kill -9 YALNIZ stop suresi GERCEKTEN dolduysa ya da JVM ASKIDA ise. Stop hizli
    # reddedildiyse (yetki, calistirilamayan betik) ve JVM yanit veriyorsa graceful stop hic
    # olmamistir: saglikli JVM'e kill -9 atilmaz, sonuc FAIL.
    if stop_timed_out; then
      kill_one "stop suresi doldu (stopServer rc $STOP_RC; kodlar: ${STOP_CODES:-yok})"
    elif [ "$STATE" = ASKIDA ]; then
      kill_one "stop basarisiz (stopServer rc $STOP_RC; kodlar: ${STOP_CODES:-yok}) ve JVM ASKIDA (surec var, yanit yok)"
    else
      step kill SKIP "stop suresi DOLMADI (stopServer rc $STOP_RC; kodlar: ${STOP_CODES:-yok}) ve JVM $STATE: kill -9 YAPILMADI (K3-a)"
      result FAIL "$BEFORE" "$STATE" "stop basarisiz (stopServer rc $STOP_RC; kodlar: ${STOP_CODES:-yok}); JVM yanit veriyor, kill -9 YAPILMADI; start calistirilmadi"
    fi
    if [ -n "$KILLED" ]; then nasil="stop tamamlanamadi, kill -9 ile (pid $KILLED)"; else nasil="stop (surec pencere sonrasi kayboldu, kill gerekmedi)"; fi
  fi
  stability
  case "$STATE" in
    STOPPED)
      step stabilite OK "${STABILITY_S}s sonra hala STOPPED; start"
      do_start 1 "yeniden baslatildi ($nasil + ${STABILITY_S}s stabilite + start)" ;;
    RUNNING|ASKIDA)
      step stabilite OK "UYARI: JVM ${STABILITY_S}s icinde kendiliginden geri geldi (pid $PIDS; nodeagent?); startServer calistirilmadi, RUNNING beklenir"
      do_start 0 "yeniden baslatildi ($nasil; durdurulduktan sonra kendiliginden geri geldi, startServer calistirilmadi)" ;;
    COKLU_SUREC)
      step stabilite FAIL "$WHY"
      result FAIL "$BEFORE" COKLU_SUREC "stop sonrasi birden cok surec: $WHY" ;;
    *)
      step stabilite OLCULEMEDI "$WHY"
      result OLCULEMEDI "$BEFORE" OLCULEMEDI "stabilite olcumu olculemedi: $WHY" ;;
  esac
}

op_mode() {
  local v val ty cl PROFILE="$IN_PROFILE" SERVER="$IN_SERVER" in_cell="$IN_CELL" in_node="$IN_NODE"
  case "${OP:-}" in restart|stop|start) OPNAME="$OP" ;; *) OPNAME=op ;; esac
  if [ "$ME" != "$WAS_USER" ]; then
    step kullanici FAIL "betik $WAS_USER olarak kosmuyor (id -un=${ME:-?})"
    result FAIL - - "betik $WAS_USER olarak kosmuyor (id -un=${ME:-?}); islem yapilmadi"
  fi
  step kullanici OK "$ME"
  if ! need_tmp; then step hazirlik OLCULEMEDI "gecici dizin olusturulamadi (mktemp)"; result OLCULEMEDI - - "gecici dizin olusturulamadi (mktemp); olcum ve islem yapilmadi"; fi
  if [ "$OPNAME" = op ]; then step girdi FAIL "OP restart|stop|start degil"; result FAIL - - "OP restart|stop|start olmali; islem yapilmadi"; fi
  if [ "${CONSENT:-}" != true ]; then step girdi FAIL "CONSENT=true yok"; result FAIL - - "acik onay (CONSENT=true) yok; islem yapilmadi"; fi
  for v in "PROFILE=$PROFILE" "CELL=$in_cell" "NODE=$in_node" "SERVER=$SERVER"; do
    val="${v#*=}"
    if ! [[ "$val" =~ $NAME_RE ]]; then step girdi FAIL "${v%%=*} bos ya da gecersiz"; result FAIL - - "${v%%=*} bos ya da ^[A-Za-z0-9_.-]+\$ disi; islem yapilmadi"; fi
  done
  if [ "${CONFIRM:-}" != "$SERVER" ]; then step girdi FAIL "onay metni JVM adi ile ayni degil"; result FAIL - - "onay metni JVM adi ($SERVER) ile ayni degil; islem yapilmadi"; fi
  step girdi OK "$OPNAME $PROFILE/$in_cell/$in_node/$SERVER"
  if [ ! -e "$WAS_ROOT/profiles/$PROFILE" ]; then
    if surely_absent "$WAS_ROOT/profiles/$PROFILE"; then step hedef FAIL "profil yok: $PROFILE"; result FAIL - - "profil yok ($WAS_ROOT/profiles/$PROFILE); islem yapilmadi"; fi
    step hedef OLCULEMEDI "$WAS_ROOT/profiles okunamadi"
    result OLCULEMEDI - - "$WAS_ROOT/profiles okunamadi; hedef dogrulanamadi, islem yapilmadi"
  fi
  if ! prof_resolve "$PROFILE"; then
    if [ "$PKIND" = okunamadi ]; then step hedef OLCULEMEDI "$PERR"; result OLCULEMEDI - - "$PERR; hedef dogrulanamadi, islem yapilmadi"; fi
    step hedef FAIL "$PERR"; result FAIL - - "$PERR; islem yapilmadi"
  fi
  if [ "$CELL" != "$in_cell" ] || [ "$NODE" != "$in_node" ]; then
    step hedef FAIL "profil cell/node $CELL/$NODE, istenen $in_cell/$in_node"
    result FAIL - - "profil $PROFILE cell/node ($CELL/$NODE) istenenle ($in_cell/$in_node) ayni degil; islem yapilmadi"
  fi
  ty="$(printf '%s\n' "$ENTRIES" | awk -F'\t' -v s="$SERVER" '$1 == s { print $2 }' | sort -u | paste -sd, -)"
  if [ -z "$ty" ]; then step hedef FAIL "$SERVER serverindex.xml'de yok"; result FAIL - - "$SERVER kendi node'unun serverindex.xml'inde tanimli degil; islem yapilmadi"; fi
  if [ "$ty" != APPLICATION_SERVER ]; then step hedef FAIL "$SERVER tipi $ty"; result FAIL - - "$SERVER bir APPLICATION_SERVER degil ($ty); islem yapilmadi"; fi
  load_clusters "$PROF" "$CELL"; cl="$(cluster_of "$NODE" "$SERVER")"
  step hedef OK "$PROFILE/$CELL/$NODE/$SERVER APPLICATION_SERVER; cluster=${cl:-yok}"
  kimlik_of "$PROF"
  if [ "$KIMLIK" != var ]; then step kimlik OLCULEMEDI "$KNOTE"; result OLCULEMEDI - - "kimlik $KIMLIK ($KNOTE); serverStatus/stop/start calistirilmadi, islem yapilmadi"; fi
  step kimlik OK "$KNOTE"
  ps_match "$CELL" "$NODE" nodeagent
  if [ "$PS_OK" != 1 ]; then step nodeagent OLCULEMEDI "nodeagent sureci olculemedi (ps)"
  elif [ -n "$PIDS" ]; then step nodeagent OK "nodeagent calisiyor (pid $PIDS)"
  else step nodeagent OK "UYARI: nodeagent sureci yok; JVM baslar ama nodeagent tarafindan izlenmez"; fi
  SRV="$SERVER"
  measure
  BEFORE="$STATE"
  step once "$(stcode "$STATE")" "$STATE: $WHY"
  case "$BEFORE" in
    OLCULEMEDI) result OLCULEMEDI OLCULEMEDI OLCULEMEDI "baslangic durumu olculemedi: $WHY; islem yapilmadi" ;;
    COKLU_SUREC) result FAIL COKLU_SUREC COKLU_SUREC "ret: $WHY; islem yapilmadi" ;;
  esac
  case "$OPNAME:$BEFORE" in
    stop:RUNNING|stop:ASKIDA|restart:RUNNING|restart:ASKIDA|start:STOPPED) ;;
    stop:STOPPED) result SKIP STOPPED STOPPED "zaten STOPPED; stopServer calistirilmadi" ;;
    start:RUNNING) result SKIP RUNNING RUNNING "zaten RUNNING; startServer calistirilmadi" ;;
    start:ASKIDA) result SKIP ASKIDA ASKIDA "ASKIDA (surec var, yanit yok): start uygun degil, stop ya da restart kullanin; komut calistirilmadi" ;;
    restart:STOPPED) result SKIP STOPPED STOPPED "STOPPED: restart uygun degil, start kullanin; komut calistirilmadi" ;;
    *) result FAIL "$BEFORE" "$BEFORE" "beklenmeyen durum/islem: $OPNAME/$BEFORE; islem yapilmadi" ;;
  esac
  [ "$BEFORE" = ASKIDA ] && step uyari OK "UYARI: JVM ASKIDA (surec var, serverStatus ulasamiyor); $OPNAME yine de denenir"
  case "$OPNAME" in
    stop) do_stop ;;
    start) do_start 1 "baslatildi" ;;
    restart) do_restart ;;
  esac
}

ME="$(id -un 2>/dev/null)"
case "${MODE:-}" in
  discover) discover ;;
  op) op_mode ;;
  *) OPNAME=mode; step girdi FAIL "MODE discover|op degil"; result FAIL - - "MODE discover ya da op olmali" ;;
esac
result OLCULEMEDI - - "betik sonuc uretmeden bitti"
