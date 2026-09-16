#!/bin/bash
# fix_permissions.sh - configuration_delivery: sahiplik/izin duzeni + dhparam (YOKSA).
# Onceden playbook'a gomulu shell blogunda her kosuda `openssl dhparam 2048` yeniden
# uretiliyordu (yavas, gereksiz); simdi yalniz dosya yoksa uretilir.
set -u
[ -f /usr/nginx/conf/custom.conf ] || touch /usr/nginx/conf/custom.conf
dzdo chown -R www /usr/nginx/
chmod 740 -R /usr/nginx/*
if [ ! -s /usr/nginx/ssl/dhparam.pem ]; then
  mkdir -p /usr/nginx/ssl
  openssl dhparam -out /usr/nginx/ssl/dhparam.pem 2048
fi
find /usr/nginx -type d -exec chmod 750 {} \;
find /usr/nginx -type f -exec chmod 640 {} \;
chmod 400 /usr/nginx/ssl/*
chmod 755 /usr/nginx/
chmod 740 /usr/nginx/sbin/nginx
exit 0
