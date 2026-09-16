#!/bin/bash
# nginx_test_or_reload.sh <test|reload> - nginx (plus ya da OSS) icin -t / -s reload.
# Diger playbook'lardaki (nginx_ops, api_generator) gomulu blogun files/ altina alinmis hali.
set -u
MODE="${1:-test}"
BIN=/usr/nginx/sbin/nginx
ver="$(dzdo "$BIN" -v 2>&1 | awk -F "/" '{print $2}')"
if [ "$MODE" = "reload" ]; then
  if [[ "$ver" == *plus* ]]; then
    dzdo "$BIN" -p /usr/nginx/ -c /usr/nginx/nginx.conf -e /web_log/error.log -s reload
  else
    dzdo "$BIN" -s reload
  fi
else
  if [[ "$ver" == *plus* ]]; then
    dzdo "$BIN" -p /usr/nginx/ -c /usr/nginx/nginx.conf -e /web_log/error.log -t
  else
    dzdo "$BIN" -t
  fi
fi
