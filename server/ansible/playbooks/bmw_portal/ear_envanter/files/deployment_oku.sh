# deployment_oku.sh - BMW Portal > Uygulama Envanteri FAZ 2: calisan JVM'lerin deployment durumu.
#
# Kullanici: "JVM ayakta ancak deployment'i incelesin"; komut:
#   timeout 15s "$JBOSS_CLI" -c --controller="$CONTROLLER" --command="/host=$JBOSS_HOST/server=$JVM:read-children-resources(child-type=deployment,include-runtime=true,recursive=false)"
# JBoss 7: jboss-cli.sh, controller $HOSTNAME, host=master. JBoss 8: jboss-cli8.sh, $HOSTNAME:9998, host=primary.
#
# SALT OKUNUR: yalniz ps ve yukaridaki TEK CLI okuma islemi; hedefe dosya yazilmaz (cikti stdout'a).
# Hedefte Ansible 'raw' ile '/bin/bash -s' olarak STDIN'den calisir; ear_envanter.yml yalniz
# ear_deployment_kontrol=true iken calistirir (varsayilan KAPALI: her calisan JVM icin bir CLI sureci).
#
# CALISAN JVM: ps'te '-D[Server:<ad>]' tasiyan surec (domain kipi sunucu sureci); kurulum yolunda
# 'jboss8' geciyorsa JBoss 8. Ad yalniz [A-Za-z0-9._-]; disindaki ad CLI'ya verilmez (GECERSIZ_AD).
#
# CIKTI (Portal ear-envanter-alim.deploymentCoz okur):
#   @@EAR_DEPLOYMENT_BASLA@@
#   surum=1
#   @@JVM@@ <nesil> <ad> <durum> [rc]      durum: OK | CLI_YOK | ZAMAN_ASIMI | HATA | GECERSIZ_AD | BUTCE_DOLDU
#   ... (OK / HATA ise CLI ciktisi, en cok 200000 bayt)
#   @@JVM_SON@@
#   @@EAR_DEPLOYMENT_BITTI@@
# Ayarlar ortam degiskeniyle: EAR_JBOSS (kurulum kokleri, ear_tara.py ile ayni), EAR_DEP_ZAMAN (CLI
# basina sn, varsayilan 15), EAR_DEP_SURE (host butcesi sn, varsayilan 180).

KOKLER=${EAR_JBOSS:-/usr/jboss/AppServer:/usr/jboss8/AppServer}
ZAMAN=${EAR_DEP_ZAMAN:-15}
SURE=${EAR_DEP_SURE:-180}
case "$ZAMAN" in ''|*[!0-9]*) ZAMAN=15 ;; esac
case "$SURE" in ''|*[!0-9]*) SURE=180 ;; esac
BAS=$SECONDS

# Nesle gore CLI: kurulum kokunun bin/ ya da jboss/bin/ dizini (awscp.txt ile ayni arama sirasi).
cli_bul() {
  local nesil=$1 kok ad aday
  if [ "$nesil" = 8 ]; then ad=jboss-cli8.sh; else ad=jboss-cli.sh; fi
  local IFS=:
  for kok in $KOKLER; do
    case "$kok" in
      */jboss8|*/jboss8/*) [ "$nesil" = 8 ] || continue ;;
      *) [ "$nesil" = 8 ] && continue ;;
    esac
    for aday in "$kok/bin/$ad" "$kok/jboss/bin/$ad"; do
      if [ -x "$aday" ]; then
        printf '%s\n' "$aday"
        return 0
      fi
    done
  done
  return 1
}

echo "@@EAR_DEPLOYMENT_BASLA@@"
echo "surum=1"
ps -eo args= 2>/dev/null | grep -- '-D\[Server:' | while IFS= read -r satir; do
  ad=$(printf '%s\n' "$satir" | sed -n 's/.*-D\[Server:\([^]]*\)\].*/\1/p')
  case "$satir" in
    *jboss8*) nesil=8 ;;
    *) nesil=7 ;;
  esac
  printf '%s %s\n' "$nesil" "$ad"
done | sort -u | while read -r nesil ad; do
  [ -n "$ad" ] || continue
  case "$ad" in
    *[!A-Za-z0-9._-]*)
      echo "@@JVM@@ $nesil - GECERSIZ_AD"
      continue
      ;;
  esac
  if [ $((SECONDS - BAS)) -ge "$SURE" ]; then
    echo "@@JVM@@ $nesil $ad BUTCE_DOLDU"
    continue
  fi
  cli=$(cli_bul "$nesil")
  if [ -z "$cli" ]; then
    echo "@@JVM@@ $nesil $ad CLI_YOK"
    continue
  fi
  if [ "$nesil" = 8 ]; then
    ctl="$HOSTNAME:9998"
    hst=primary
  else
    ctl="$HOSTNAME"
    hst=master
  fi
  cikti=$(timeout "${ZAMAN}s" "$cli" -c --controller="$ctl" --command="/host=$hst/server=$ad:read-children-resources(child-type=deployment,include-runtime=true,recursive=false)" </dev/null 2>&1)
  rc=$?
  if [ "$rc" = 124 ]; then
    echo "@@JVM@@ $nesil $ad ZAMAN_ASIMI $rc"
  elif [ "$rc" = 0 ]; then
    echo "@@JVM@@ $nesil $ad OK $rc"
    printf '%s\n' "${cikti:0:200000}"
  else
    echo "@@JVM@@ $nesil $ad HATA $rc"
    printf '%s\n' "${cikti:0:2000}"
  fi
  echo "@@JVM_SON@@"
done
echo "@@EAR_DEPLOYMENT_BITTI@@"
