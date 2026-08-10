#!/usr/bin/env bash
# scripts/fetch-ca.sh — Bir HTTPS hedefinin sundugu TLS sertifika zincirini yakalar.
# Linux/macOS (openssl gerektirir). Windows eslenigi: scripts/fetch-ca.ps1
#
# KULLANIM (kurumsal agda):
#   bash scripts/fetch-ca.sh api.openai.com
#   bash scripts/fetch-ca.sh dynatrace-mcp.apps-3rd-t.fw.garanti.com.tr 443 server/certs/mcp
#   # Hedefe SADECE bir proxy uzerinden ulasiliyorsa (ör. SMART_PROXY_URL gibi
#   # servise-ozel proxy'ler) 4. argumana proxy host:port verin — openssl CONNECT
#   # tuneli kurar, uygulamanin gerctekte gordugu AYNI zinciri (proxy SSL inspection
#   # yapiyorsa onun enjekte ettigi sertifika dahil) yakalamis olursunuz:
#   bash scripts/fetch-ca.sh gbca.fw.garanti.com.tr 8443 server/certs/smart tekprxv2.fw.garanti.com.tr:80
#
# CIKTILAR (<outdir> altinda):
#   certificate-N.pem      → zincirdeki her sertifika (0 = leaf)
#   <host>-ca-chain.pem    → leaf HARIC CA zinciri (CORP_CA_CERT_PATH icin)
#
# Sonraki adimlar: node scripts/build-ca-bundle.cjs  →  node scripts/test-tls.cjs
# Tam rehber: docs/TLS-SETUP.md
set -euo pipefail

HOST="${1:?Kullanım: fetch-ca.sh <host> [port] [outdir] [proxy_host:port]}"
PORT="${2:-443}"
SAFE_NAME=$(echo "$HOST" | tr -c 'a-zA-Z0-9.-' '_' | sed 's/_$//')
OUTDIR="${3:-server/certs/$SAFE_NAME}"
PROXY="${4:-}"

mkdir -p "$OUTDIR"
echo "── Hedef: $HOST:$PORT"
[ -n "$PROXY" ] && echo "── Proxy: $PROXY"
echo "── Cikti dizini: $OUTDIR"

# -showcerts: sunucunun sundugu TUM zinciri doker (leaf + intermediate'ler;
# kok genelde gonderilmez — eksikse IT'den alinip zincire elle eklenir)
if [ -n "$PROXY" ]; then
  RAW=$(echo | openssl s_client -proxy "$PROXY" -showcerts -servername "$HOST" -connect "$HOST:$PORT" 2>/dev/null) \
    || { echo "✗ Bağlantı başarısız (proxy/ağ/VPN?)"; exit 1; }
else
  RAW=$(echo | openssl s_client -showcerts -servername "$HOST" -connect "$HOST:$PORT" 2>/dev/null) \
    || { echo "✗ Bağlantı başarısız (ağ/VPN?)"; exit 1; }
fi

# Zinciri tek tek dosyalara ayir
COUNT=$(grep -c 'BEGIN CERTIFICATE' <<< "$RAW" || true)
[ "$COUNT" -eq 0 ] && { echo "✗ Sertifika dönmedi"; exit 1; }
echo "── Yakalanan zincir ($COUNT sertifika):"

awk -v dir="$OUTDIR" '
  /-----BEGIN CERTIFICATE-----/ { f = dir "/certificate-" n ".pem"; n++ }
  f { print > f }
  /-----END CERTIFICATE-----/ { f = "" }
' <<< "$RAW"

CHAIN="$OUTDIR/$SAFE_NAME-ca-chain.pem"
: > "$CHAIN"
for i in $(seq 0 $((COUNT - 1))); do
  PEM="$OUTDIR/certificate-$i.pem"
  SUBJ=$(openssl x509 -in "$PEM" -noout -subject 2>/dev/null | sed 's/^subject=//')
  ISSU=$(openssl x509 -in "$PEM" -noout -issuer 2>/dev/null | sed 's/^issuer=//')
  VALID=$(openssl x509 -in "$PEM" -noout -enddate 2>/dev/null | sed 's/^notAfter=//')
  echo ""
  echo "[$i] Subject: $SUBJ"
  echo "    Issuer : $ISSU"
  echo "    ValidTo: $VALID"
  # 0 = leaf → zincire girmez
  if [ "$i" -gt 0 ]; then
    { echo "# [$i] $SUBJ"; cat "$PEM"; } >> "$CHAIN"
  fi
done

echo ""
if [ -s "$CHAIN" ]; then
  echo "✓ CA zinciri yazildi: $CHAIN"
else
  echo "⚠ Zincirde leaf disinda sertifika yok — sunucu intermediate gondermiyor olabilir."
  echo "  Kurumsal kok CA'yi IT/sertifika portalindan alip elle ekleyin."
fi

echo ""
echo "Sonraki adimlar:"
echo "  1) node scripts/build-ca-bundle.cjs      # tum zincirleri public koklerle birlestir"
echo "  2) node scripts/test-tls.cjs             # hedefleri dogrula"
echo "  3) .env.local: CORP_CA_CERT_PATH=server/certs/combined-ca-chain.pem"
