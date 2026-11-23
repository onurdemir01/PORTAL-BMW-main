#!/bin/bash
# nginx_console_dump.sh — bir nginx sunucusunun konfigurasyon agacini, dosya iceriklerini ve
# sertifikalarini TEK metin olarak doker (Portal > Nginx Hub okur). HICBIR SEY DEGISTIRMEZ.
#
# Cikti bolumleri (Portal tarafi: server/nginx-console/dump-parse.cjs):
#   @@HOST <ad>            @@TIME <ISO>          @@PREFIX <nginx prefix>
#   @@NGINX_T <ok|fail>    (ardindan nginx -t ciktisi, @@END ile biter)
#   @@LOADED               nginx -T'nin GERCEKTEN yukledigi dosyalar (satir basina yol) ... @@END
#                          (2026-09-22: agactaki her dosya nginx'e dahil degil - .bak, eski kopya,
#                          include edilmeyen conf; Portal "Kullanilmayan" sekmesi bu listeyle ayirir)
#   @@SSLDIR               /usr/nginx/ssl altindaki dosyalar: size<TAB>mtime<TAB>yol ... @@END (anahtar OKUNMAZ)
#   @@TREE                 size<TAB>mtime<TAB>sha256<TAB>sahip<TAB>yol  ... @@END   (sahip: stat %U)
#   @@FILE <yol> <sha256> <size>   ...icerik...   @@END
#   @@CERT <yol>           openssl x509 alanlari (key=value)   @@END
#   @@CERTUSE conf<TAB>server_name<TAB>ssl_certificate<TAB>ssl_certificate_key
#   @@SPAPKG               SPA paketleri (2026-11-16), uygulama basina tek satir ... @@END:
#                          ns<TAB>app<TAB>durum<TAB>version<TAB>icerik<TAB>config<TAB>dosya<TAB>version_zamani<TAB>tanimli<TAB>bayat_sikistirma
#                          durum: var | yok (conf.d/conf bu dizini gosteriyor ama dizin yok) |
#                          okunamadi (dizin/dosya okunamadi; ozet YOK, Portal esit saymaz)
#                          icerik: dosya yollari + sha256 ozeti (kokteki config.json, application.json,
#                          .version ve kaynagi yaninda duran .gz/.br HARIC); config: kokteki
#                          application.json + config.json ozeti; tanimli: 1 = bir *.conf bu dizini
#                          gosteriyor; bayat_sikistirma: kaynagindan eski .gz/.br sayisi. Dosya ve
#                          config icerigi DOKULMEZ, yalniz ozet. Bolum yoksa (eski betik) Portal
#                          "olculemedi" der, "esit" demez.
#
# Kapsam: /usr/nginx/conf.d ve /usr/nginx/conf altindaki *.conf dosyalari (kullanici, 2026-09-22:
# "yedek dosyalara bakma, cikti sisiyor" - <conf>_<job>, .bak, .old vb. artik hic dokulmez).
# 512 KB'den buyuk dosyalarin icerigi dokulmez (agacta gorunur). Anahtar (.key) dosyalari ASLA
# okunmaz - yalniz var mi diye bakilir.
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
#### ESTATE STANDARDI (nginx_audit_scan.sh, nginx_deploy_lock.sh, activate.yaml): nginx -t ROOT
#### (dzdo) ile ve -e /web_log/error.log ile kosar. www olarak kosunca anahtar dosyalari (root:600)
#### okunamiyor / varsayilan error.log acilamiyor ve hemen her sunucu "fail" gorunuyordu
#### (kullanici, 2026-09-22). dzdo yoksa/reddederse eski yol denenir; sonuc yine ok/fail.
NGINX_T_CMD=("$BIN" -p "$PREFIX/" -c "$PREFIX/nginx.conf" -e "${NGINX_ERRLOG:-/web_log/error.log}" -t)
if command -v dzdo >/dev/null 2>&1 && out="$(dzdo -n "${NGINX_T_CMD[@]}" 2>&1)"; then
  echo "@@NGINX_T ok"
elif out="$("${NGINX_T_CMD[@]}" 2>&1)"; then
  echo "@@NGINX_T ok"
else
  echo "@@NGINX_T fail"
fi
printf '%s\n' "$out"
echo "@@END"

#### nginx -T: yuklenen dosya listesi ("# configuration file <yol>:" satirlari). -t dustuyse bos kalir.
echo "@@LOADED"
NGINX_TT_CMD=("$BIN" -p "$PREFIX/" -c "$PREFIX/nginx.conf" -e "${NGINX_ERRLOG:-/web_log/error.log}" -T)
{ command -v dzdo >/dev/null 2>&1 && dzdo -n "${NGINX_TT_CMD[@]}" 2>/dev/null || "${NGINX_TT_CMD[@]}" 2>/dev/null; } \
  | sed -nE 's/^# configuration file (.+):$/\1/p' | sort -u
echo "@@END"

#### ssl dizini (sertifika/anahtar dosyalari; anahtar icerigi hicbir zaman okunmaz)
SSLDIR="${NGINX_SSLDIR:-$PREFIX/ssl}"
echo "@@SSLDIR"
if [ -d "$SSLDIR" ]; then
  find "$SSLDIR" -maxdepth 3 -type f 2>/dev/null | sort | while IFS= read -r f; do
    printf '%s\t%s\t%s\n' "$(stat -c %s "$f" 2>/dev/null || echo 0)" "$(stat -c %y "$f" 2>/dev/null | cut -d. -f1)" "$f"
  done
fi
echo "@@END"

#### Agac
echo "@@TREE"
for d in "$PREFIX/conf.d" "$PREFIX/conf"; do
  [ -d "$d" ] || continue
  find "$d" -type f -name '*.conf' 2>/dev/null | sort | while IFS= read -r f; do
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
  find "$d" -type f -name '*.conf' 2>/dev/null | sort | while IFS= read -r f; do
    case "$f" in *.key|*.pem_key|*private*) continue ;; esac
    sz="$(stat -c %s "$f" 2>/dev/null || echo 0)"
    [ "$sz" -le "$MAX_FILE" ] || continue
    echo "@@FILE $f $(sha_of "$f") $sz"
    cat "$f" 2>/dev/null
    [ -n "$(tail -c1 "$f" 2>/dev/null)" ] && echo
    echo "@@END"
  done
done

#### SPA paketleri (2026-11-16, kullanici: "Glomo sunucularinin her zaman ve her sartta esit oldugunu
#### bilmek istiyorum"). Uygulama basina tek satir ozet; Portal > Nginx Hub > Tutarlilik > Paketler.
#### OKUNAMADI ASLA ESIT DEGILDIR: dizine girilemiyor, bir dosya/alt dizin okunamiyor ya da hata
#### dosyasi kurulamiyorsa satir durum=okunamadi basar (ozet uretilmez, onbellege yazilmaz).
#### Icerik ozeti: dosya yollari ("./" onekli) + sha256; HARIC yalniz KOKTEKI config.json,
#### application.json, .version (config ozeti ayrica) ve kaynagi yaninda duran <dosya>.gz/.br
#### (sikistirma ciktisi; pakette kaynaksiz gelen .gz/.br icerige DAHIL). Kaynagi kendisinden 5 sn'den
#### fazla yeni olan .gz/.br "bayat sikistirma" sayilir (gzip_static eski icerigi sunar).
#### Agir is (sha256) yalniz degisen uygulamada: tum dosyalarin (yol, boyut, mtime, ctime) izi
#### onbellektekiyle ayniysa onceki ozet kullanilir; ctime cp -p ile geri alinamaz. Onbellek yalniz
#### bu kullanicinin kendi dosyasiysa okunur. Deployment yedegi (<app>_<job>, kardes <app> varken)
#### yalniz hicbir conf onu gostermiyorsa atlanir.
#### SYMLINK (2026-11-23, PR-R, kullanici karari "hedefi izle"): paket icindeki bag IZLENIR (find -L): hedef
#### dosyanin icerigi ozete, hedef agacin (yol, boyut, mtime, ctime) satirlari ize girer; bagin hedef METNI de
#### ize girer (yeniden yonlendirme). Eskiden `find -type f` bagi hic gormuyordu: farkli kutuphaneye giden ayni
#### adli bag iki sunucuyu "esit" gosteriyordu. Kirik bag ya da dongu -> okunamadi (esit degil). Disari giden
#### bag cok buyuk bir agaca gidebilir: uygulama basina PKG_DOSYA_SINIRI dosya; asilirsa okunamadi.
APPS="${NGINX_APPS:-$PREFIX/applications}"
PKG_CACHE="${NGINX_PKG_CACHE:-/var/tmp/.nginx_console_pkg_cache.v2}"
PKG_DOSYA_SINIRI="${NGINX_PKG_DOSYA_SINIRI:-50000}"
echo "@@SPAPKG"
(
  export LC_ALL=C
  set -o pipefail
  hataf="$(mktemp "${TMPDIR:-/tmp}/.nginx_console_pkg_err.XXXXXX" 2>/dev/null)" || hataf=""
  yeni=""
  trap '[ -n "$hataf" ] && rm -f -- "$hataf"; [ -n "$yeni" ] && rm -f -- "$yeni"' EXIT
  declare -A REF=() OLD=()
  while IFS= read -r r; do [ -n "$r" ] && REF["$r"]=1; done < <(
    find "$PREFIX/conf.d" "$PREFIX/conf" -type f -name '*.conf' -exec cat {} + 2>/dev/null \
      | sed 's/#.*$//' | grep -oE "$APPS/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+" | sort -u)
  okunur() { [ -r "$1" ] && [ -x "$1" ]; }
  satir() { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@"; }
  if [ -d "$APPS" ] && okunur "$APPS"; then
    if [ -f "$PKG_CACHE" ] && [ -O "$PKG_CACHE" ] && [ -r "$PKG_CACHE" ]; then
      while IFS=$'\t' read -r k v; do [ -n "$k" ] && OLD["$k"]="$v"; done < "$PKG_CACHE"
    fi
    yeni="$(mktemp "${PKG_CACHE}.XXXXXX" 2>/dev/null)" || yeni=""
    for nsd in "$APPS"/*/; do
      [ -d "$nsd" ] || continue
      ns="${nsd%/}"; ns="${ns##*/}"
      case "$ns" in .*|*[!A-Za-z0-9._-]*) continue ;; esac
      okunur "$nsd" || continue
      for ad in "$nsd"*/; do
        [ -d "$ad" ] || continue
        d="${ad%/}"; app="${d##*/}"
        case "$app" in .*|*[!A-Za-z0-9._-]*) continue ;; esac
        tanimli=0; [ -n "${REF[$d]:-}" ] && tanimli=1
        unset 'REF[$d]'
        if [ "$tanimli" = 0 ] && [[ "$app" =~ ^(.+)_[0-9]+$ ]] && [ -d "$nsd${BASH_REMATCH[1]}" ]; then continue; fi
        if [ -z "$hataf" ] || ! okunur "$d"; then
          satir "$ns" "$app" okunamadi - - - - - "$tanimli" -
          continue
        fi
        : > "$hataf"
        ver="-"; vt="-"
        if [ -f "$d/.version" ]; then
          if [ -r "$d/.version" ]; then
            ver="$(head -n 1 "$d/.version" | tr -d '\r[:space:]')"
            [ -n "$ver" ] || ver="(bos)"
            vt="$(stat -c %y "$d/.version" 2>/dev/null | cut -c1-16)"
          else
            echo "okunamadi: .version" >> "$hataf"
          fi
        fi
        liste="$(cd "$d" && find -L . -type f -printf '%P\t%s\t%T@\t%C@\n' 2>>"$hataf" \
          | head -n "$((PKG_DOSYA_SINIRI + 1))" | sort)" || echo "find" >> "$hataf"
        if [ -n "$liste" ] && [ "$(printf '%s\n' "$liste" | wc -l)" -gt "$PKG_DOSYA_SINIRI" ]; then
          echo "dosya siniri $PKG_DOSYA_SINIRI asildi (bag buyuk bir agaca gidiyor olabilir)" >> "$hataf"
        fi
        # -L altinda yalniz KIRIK bag 'l' kalir (dongu find hatasidir, yukarida hataf'a gider).
        kirik="$(cd "$d" && find -L . -type l -printf '%P\n' 2>/dev/null | head -n 1)"
        [ -n "$kirik" ] && echo "kirik bag: $kirik" >> "$hataf"
        baglar="$(cd "$d" && find . -type l -printf '%P\t%l\n' 2>>"$hataf" | sort)" || echo "find bag" >> "$hataf"
        # Bagsiz uygulamada iz eskisiyle ayni (onbellek isabeti korunur); bagliysa hedef metni de ize girer.
        if [ -n "$baglar" ]; then
          iz="$(printf '%s\n@@BAG\n%s\n' "$liste" "$baglar" | sha256sum | cut -c1-16)"
        else
          iz="$(printf '%s\n' "$liste" | sha256sum | cut -c1-16)"
        fi
        k="$ns/$app"
        onceki="${OLD[$k]:-}"
        if [ ! -s "$hataf" ] && [ -n "$onceki" ] && [ "${onceki%%$'\t'*}" = "$iz" ]; then
          ozet="${onceki#*$'\t'}"
        else
          secim="$(printf '%s\n' "$liste" | awk -F'\t' '
            NF >= 4 { ad[$1] = 1; ct[$1] = $4; n[++m] = $1 }
            END {
              b = 0
              for (i = 1; i <= m; i++) {
                f = n[i]
                if (f ~ /\.(gz|br)$/) {
                  k = f; sub(/\.(gz|br)$/, "", k)
                  if (k in ad) { if (ct[k] + 0 > ct[f] + 5) b++; continue }
                }
                if (f == "config.json" || f == "application.json" || f == ".version") continue
                print "./" f
              }
              print "\tBAYAT " b
            }')" || echo "awk" >> "$hataf"
          bayat="$(printf '%s\n' "$secim" | tail -n 1 | sed 's/^\tBAYAT //')"
          dosyalar="$(printf '%s\n' "$secim" | sed '$d' | sort)"
          sayi=0; [ -n "$dosyalar" ] && sayi="$(printf '%s\n' "$dosyalar" | wc -l | tr -d ' ')"
          icerik="$(cd "$d" && printf '%s\n' "$dosyalar" | sed '/^$/d' | tr '\n' '\0' | xargs -0 -r sha256sum 2>>"$hataf" | sha256sum | cut -c1-12)" || echo "sha256sum" >> "$hataf"
          config="$(cd "$d" && for x in application.json config.json; do
              if [ -f "$x" ]; then
                if [ -r "$x" ]; then printf '%s ' "$x"; sha256sum < "$x"; else echo "okunamadi: $x" >> "$hataf"; fi
              else echo "$x yok"; fi
            done | sha256sum | cut -c1-12)" || echo "config" >> "$hataf"
          ozet="${icerik}"$'\t'"${config}"$'\t'"${sayi}"$'\t'"${bayat:-0}"
        fi
        if [ -s "$hataf" ]; then
          satir "$ns" "$app" okunamadi "$ver" - - - "$vt" "$tanimli" -
          continue
        fi
        [ -n "$yeni" ] && printf '%s\t%s\t%s\n' "$k" "$iz" "$ozet" >> "$yeni"
        IFS=$'\t' read -r o_ic o_cf o_n o_b <<< "$ozet"
        satir "$ns" "$app" var "$ver" "$o_ic" "$o_cf" "$o_n" "$vt" "$tanimli" "${o_b:-0}"
      done
    done
    if [ -n "$yeni" ] && mv -f -- "$yeni" "$PKG_CACHE" 2>/dev/null; then yeni=""; fi
  fi
  for r in "${!REF[@]}"; do
    rel="${r#"$APPS"/}"; rns="${rel%%/*}"
    durum=yok
    if [ -e "$APPS" ] && ! okunur "$APPS"; then durum=okunamadi
    elif [ -d "$APPS/$rns" ] && ! okunur "$APPS/$rns"; then durum=okunamadi
    elif [ -e "$r" ] && [ ! -d "$r" ]; then durum=yok
    fi
    satir "$rns" "${rel#*/}" "$durum" - - - - - 1 -
  done | sort
)
echo "@@END"

#### Sertifika kullanimlari (conf dosyasi -> server_name -> cert/key) ve sertifika ayrintilari
for d in "$PREFIX/conf.d" "$PREFIX/conf"; do
  [ -d "$d" ] || continue
  grep -rl --include='*.conf' -E '^[[:space:]]*ssl_certificate[[:space:]]' "$d" 2>/dev/null | sort | while IFS= read -r conf; do
    sn="$(grep -m1 -E '^[[:space:]]*server_name[[:space:]]' "$conf" 2>/dev/null | sed -E 's/^[[:space:]]*server_name[[:space:]]+//; s/;.*$//' | awk '{print $1}')"
    crt="$(grep -m1 -E '^[[:space:]]*ssl_certificate[[:space:]]' "$conf" | sed -E 's/^[[:space:]]*ssl_certificate[[:space:]]+//; s/;.*$//' | tr -d "\"'")"
    key="$(grep -m1 -E '^[[:space:]]*ssl_certificate_key[[:space:]]' "$conf" | sed -E 's/^[[:space:]]*ssl_certificate_key[[:space:]]+//; s/;.*$//' | tr -d "\"'")"
    case "$crt" in /*) ;; *) crt="$PREFIX/$crt" ;; esac
    [ -n "$key" ] && case "$key" in /*) ;; *) key="$PREFIX/$key" ;; esac
    keystate="missing"; [ -n "$key" ] && [ -f "$key" ] && keystate="present"
    printf '@@CERTUSE %s\t%s\t%s\t%s\t%s\n' "$conf" "${sn:-?}" "$crt" "${key:-?}" "$keystate"
  done
done | tee /tmp/.nginx_console_certuse.$$

#### Ayrintilar - her sertifika bir kez: conf'larda gecenler + ssl/ altinda HIC gecmeyen sertifika
#### dosyalari (2026-09-22; Portal "kullanilmayan sertifika" bunlari da gorsun). Anahtarlar haric.
{
  cut -f3 /tmp/.nginx_console_certuse.$$ 2>/dev/null | sed 's/^@@CERTUSE //'
  if [ -d "$SSLDIR" ]; then
    find "$SSLDIR" -maxdepth 3 -type f \( -iname '*.crt' -o -iname '*.pem' -o -iname '*.cer' \) 2>/dev/null | grep -viE 'key|private' | head -300
  fi
} | grep -v '^$' | sort -u | while IFS= read -r crt; do
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
