#!/usr/bin/env bash
# scripts/fetch-mcp-ca.sh — MCP route'larinin CA zincirlerini ceker (geriye uyumlu sarmalayici).
# Asil is generic script'te: scripts/fetch-ca.sh (tek host icin onu dogrudan kullanin).
#
# Kullanim (kurumsal agda):  bash scripts/fetch-mcp-ca.sh [host ...]
#   Host verilmezse .env'deki DT_MANAGED_MCP_URL ve INSTANA_MCP_URL adreslerinin host'lari kullanilir
#   (kurum adresleri repoya yazilmaz).
# Sonrasi:                   node scripts/build-ca-bundle.cjs && node scripts/test-tls.cjs
# Tam rehber:                docs/TLS-SETUP.md
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

HOSTS=("$@")
if [ "${#HOSTS[@]}" -eq 0 ]; then
  ENV_DOSYA="$DIR/../.env"
  for AD in DT_MANAGED_MCP_URL INSTANA_MCP_URL; do
    URL="${!AD:-}"
    if [ -z "$URL" ] && [ -f "$ENV_DOSYA" ]; then
      URL="$(sed -n "s/^${AD}=//p" "$ENV_DOSYA" | tail -n 1 | tr -d '\r\"')"
    fi
    H="$(printf '%s' "$URL" | sed -E 's#^[a-z]+://##; s#[/:].*$##')"
    [ -n "$H" ] && HOSTS+=("$H")
  done
fi
if [ "${#HOSTS[@]}" -eq 0 ]; then
  echo "Host yok: arguman verin ya da .env'de DT_MANAGED_MCP_URL / INSTANA_MCP_URL tanimlayin." >&2
  exit 2
fi

FAIL=0
for HOST in "${HOSTS[@]}"; do
  echo "════ $HOST ════"
  bash "$DIR/fetch-ca.sh" "$HOST" 443 "server/certs/mcp" || FAIL=1
  echo ""
done

if [ "$FAIL" -eq 0 ]; then
  echo "✓ MCP zincirleri cekildi → simdi: node scripts/build-ca-bundle.cjs"
else
  echo "⚠ Bazi hostlara ulasilamadi — kurumsal agda oldugunuzdan emin olun."
  exit 1
fi
