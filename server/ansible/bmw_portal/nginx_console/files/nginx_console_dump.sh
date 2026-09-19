#!/bin/bash
# nginx_console_dump.sh — bir nginx sunucusunun konfigurasyon agacini, dosya iceriklerini ve
# sertifikalarini TEK metin olarak doker (Portal > Nginx Hub okur). HICBIR SEY DEGISTIRMEZ.
#
# Cikti bolumleri (Portal tarafi: server/nginx-console/dump-parse.cjs):
#   @@HOST <ad>            @@TIME <ISO>          @@PREFIX <nginx prefix>
#   @@NGINX_T <ok|fail>    (ardindan nginx -t ciktisi, @@END ile biter)
#   @@TREE                 size<TAB>mtime<TAB>sha256<TAB>sahip<TAB>yol  ... @@END   (sahip: stat %U)
#   @@FILE <yol> <sha256> <size>   ...icerik...   @@END
#   @@CERT <yol>           openssl x509 alanlari (key=value)   @@END
#   @@CERTUSE conf<TAB>server_name<TAB>ssl_certificate<TAB>ssl_certificate_key
#
# Kapsam: /usr/nginx/conf.d ve /usr/nginx/conf altindaki DUZ dosyalar (sembolik baglar
# haric). 512 KB'den buyuk dosyalarin icerigi dokulmez (agacta gorunur). Anahtar (.key)
# dosyalari ASLA okunmaz - yalniz var mi diye bakilir.
set -u
PREFIX="${NGINX_PREFIX:-/usr/nginx}"
BIN="${NGINX_BIN:-$PREFIX/sbin/nginx}"
MAX_FILE=524288
HOST_UP="$(hostname | awk -F "." '{print $1}' | tr '[:lower:]' '[:upper:]')"

sha_of() { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }

echo "@@HOST $HOST_UP"
echo "@@TIME $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "@@PREFIX $PREFIX"

#### nginx -t (salt okunur syntax testi)
if out="$($BIN -p "$PREFIX/" -c "$PREFIX/nginx.conf" -t 2>&1)"; then
  echo "@@NGINX_T ok"
else
  echo "@@NGINX_T fail"
fi
printf '%s\n' "$out"
echo "@@END"

#### Agac
echo "@@TREE"
for d in "$PREFIX/conf.d" "$PREFIX/conf"; do
  [ -d "$d" ] || continue
  find "$d" -type f 2>/dev/null | sort | while IFS= read -r f; do
    sz="$(stat -c %s "$f" 2>/dev/null || echo 0)"
    mt="$(stat -c %y "$f" 2>/dev/null | cut -d. -f1)"
    ow="$(stat -c %U "$f" 2>/dev/null)"
    printf '%s\t%s\t%s\t%s\t%s\n' "$sz" "$mt" "$(sha_of "$f")" "${ow:-?}" "$f"
  done
done
echo "@@END"

#### Dosya icerikleri
for d in "$PREFIX/conf.d" "$PREFIX/conf"; do
  [ -d "$d" ] || continue
  find "$d" -type f 2>/dev/null | sort | while IFS= read -r f; do
    case "$f" in *.key|*.pem_key|*private*) continue ;; esac
    sz="$(stat -c %s "$f" 2>/dev/null || echo 0)"
    [ "$sz" -le "$MAX_FILE" ] || continue
    echo "@@FILE $f $(sha_of "$f") $sz"
    cat "$f" 2>/dev/null
    [ -n "$(tail -c1 "$f" 2>/dev/null)" ] && echo
    echo "@@END"
  done
done

#### Sertifika kullanimlari (conf dosyasi -> server_name -> cert/key) ve sertifika ayrintilari
for d in "$PREFIX/conf.d" "$PREFIX/conf"; do
  [ -d "$d" ] || continue
  grep -rl --include='*' -E '^\s*ssl_certificate\s' "$d" 2>/dev/null | sort | while IFS= read -r conf; do
    sn="$(grep -m1 -E '^\s*server_name\s' "$conf" 2>/dev/null | sed -E 's/^\s*server_name\s+//; s/;.*$//' | awk '{print $1}')"
    crt="$(grep -m1 -E '^\s*ssl_certificate\s' "$conf" | sed -E 's/^\s*ssl_certificate\s+//; s/;.*$//' | tr -d "\"'")"
    key="$(grep -m1 -E '^\s*ssl_certificate_key\s' "$conf" | sed -E 's/^\s*ssl_certificate_key\s+//; s/;.*$//' | tr -d "\"'")"
    case "$crt" in /*) ;; *) crt="$PREFIX/$crt" ;; esac
    [ -n "$key" ] && case "$key" in /*) ;; *) key="$PREFIX/$key" ;; esac
    keystate="missing"; [ -n "$key" ] && [ -f "$key" ] && keystate="present"
    printf '@@CERTUSE %s\t%s\t%s\t%s\t%s\n' "$conf" "${sn:-?}" "$crt" "${key:-?}" "$keystate"
  done
done | tee /tmp/.nginx_console_certuse.$$

#### Ayrintilar - her sertifika bir kez
cut -f3 /tmp/.nginx_console_certuse.$$ 2>/dev/null | sed 's/^@@CERTUSE //' | sort -u | while IFS= read -r crt; do
  [ -n "$crt" ] || continue
  echo "@@CERT $crt"
  if [ -f "$crt" ]; then
    echo "exists=1"
    echo "sha256=$(sha_of "$crt")"
    echo "size=$(stat -c %s "$crt" 2>/dev/null || echo 0)"
    echo "mtime=$(stat -c %y "$crt" 2>/dev/null | cut -d. -f1)"
    openssl x509 -in "$crt" -noout -subject -issuer -serial -dates -fingerprint -sha256 2>/dev/null | sed -E 's/^(SHA256|sha256) Fingerprint=/fingerprint=/; s/^([a-zA-Z]+)= */\1=/'
    echo "sigalg=$(openssl x509 -in "$crt" -noout -text 2>/dev/null | grep -m1 'Signature Algorithm' | sed 's/.*Algorithm: //')"
    echo "keybits=$(openssl x509 -in "$crt" -noout -text 2>/dev/null | grep -m1 -E 'Public-Key' | grep -oE '[0-9]+')"
    echo "san=$(openssl x509 -in "$crt" -noout -ext subjectAltName 2>/dev/null | tail -n +2 | tr -d ' \n' | sed 's/DNS://g')"
    echo "chain=$(grep -c 'BEGIN CERTIFICATE' "$crt" 2>/dev/null)"
    #### ana sertifikanin (ilk blok) disinda zincirde ne var
    n=$(grep -c 'BEGIN CERTIFICATE' "$crt" 2>/dev/null); i=1
    while [ "$i" -lt "${n:-0}" ] && [ "$i" -lt 5 ]; do
      i=$((i+1))
      blk="$(awk -v k="$i" '/BEGIN CERTIFICATE/{c++} c==k{print} /END CERTIFICATE/{if(c==k)exit}' "$crt")"
      echo "chain${i}=$(printf '%s\n' "$blk" | openssl x509 -noout -subject 2>/dev/null | sed 's/^subject= *//')"
    done
  else
    echo "exists=0"
  fi
  echo "@@END"
done
rm -f /tmp/.nginx_console_certuse.$$
exit 0
