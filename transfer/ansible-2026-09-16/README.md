# GECICI TASIMA — gar_bmt_ansible_scripts (ac4ae406d sonrasi 22 commit) + commit'lenmemis conf'lar

Ansible deposuna (gtgit) elle tasinmak uzere. Kopyalandiktan sonra bu dizin Portal
deposundan SILINMELIDIR (public repo). Icerikte gizli bilgi yok (tarandi: token / webhook /
parola / sha256~ / PWD= — eslesen satirlar yalnizca maskeleme kodu ve test fixture'lari).

## 1) patches/ — 22 commit, sirali (git am ile uygulanir, mesajlar korunur)

Ofisteki gtgit klonunda, `master` `ac4ae406d`'de (son tasinan) iken:

    git am --3way patches/*.patch

Bir patch'te catisma olursa: `git am --show-current-patch`, dosyayi duzelt, `git add`, `git am --continue`.
Sira:

| # | commit | konu |
|---|---|---|
| 0001 | 5c5a0305e | metaco Teams: gercek requester + degisiklik detayi |
| 0002-0004 | 22b00dc35, b9343c7dd, d93380c20 | nginx_ops webc_locales.json blogu (sablon + backfill, dosya sonu) |
| 0005 | 643edc1eb | nginx denetim: gurultu suzgeci + 30 gun saklama |
| 0006 | 95f0b9bb9 | nginx_metadata: ortam hostname kalibindan |
| 0007 | 75b86537f | api_generator rate_limit_change: yol->zone cozumleme |
| 0008 | 835b9287d | nginx_ops delete: old_input_path |
| 0009-0010 | 9a1102c0b, a159bbfa5 | api_generator location_limit_backfill (+ limit-zones siralama) |
| 0011-0019 | 4393aa427 … ba774b17e | nginx_legacy_sync (eslenik esitleme, upstream, format, reference/scope) |
| 0020 | 22a9231cf | configuration_delivery secimli dagitim (zaten alindiysa `git am --skip`) |
| 0021 | 1a87f3b4b | nginx_deployment_spa intranet non-prod vhost |
| 0022 | 2ed01dc33 | intranet prod vhost kurali + nginx_intranet_vhost_backfill.yml |

## 2) uncommitted/ — Onur'un commit'lenmemis conf degisiklikleri (evdeki klondan)

`uncommitted/bmw_nginx/...` icerigini depo koku uzerine kopyala (DOSYALAR.txt listesi),
`proxy_settings.conf` CRLF ise `perl -pi -e 's/\r\n/\n/g'`, sonra kendi commit'in:

    cp -r uncommitted/bmw_nginx/. bmw_nginx/
    git add bmw_nginx/configuration_delivery/files bmw_nginx/nginx_installation/operations/files \
            bmw_nginx/nginx_deployment_spa/files/configuration_template.conf bmw_nginx/nginx_upgrade/operations/files
    git commit -m "nginx conf: hash boyutlari, X-Frame-Options/Referrer-Policy kaldirildi, proxy_settings/log_format guncel"

NOT: nginx_deployment_spa/files/configuration_template.conf icindeki `alias …/$application/`
(dizin) satiri daha once suphe olarak not edilmisti — kopyalamadan once bir bak.
