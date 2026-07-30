#!/usr/bin/env bash
# scripts/fetch-mcp-ca.sh — MCP route'larinin CA zincirlerini ceker (geriye uyumlu sarmalayici).
# Asil is generic script'te: scripts/fetch-ca.sh (tek host icin onu dogrudan kullanin).
#
# Kullanim (kurumsal agda):  bash scripts/fetch-mcp-ca.sh
# Sonrasi:                   node scripts/build-ca-bundle.cjs && node scripts/test-tls.cjs
# Tam rehber:                docs/TLS-SETUP.md
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

HOSTS=(
  "dynatrace-mcp.apps-3rd-t.fw.garanti.com.tr"
  "instana-mcp.apps-3rd-t.fw.garanti.com.tr"
)

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
