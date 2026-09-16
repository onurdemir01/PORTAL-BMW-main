#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""configuration_delivery: secimli dosya dagitimi (2026-09-16, Portal'dan tikleyerek secim).

Kilitlenen iddialar (playbook metni + Jinja gercekten kosturulur):
  1. files liste ya da virgul/satir ayrimli dizge -> tek liste; bos -> assert durdurur
  2. yalniz taninan 6 dosya; nginx.conf kaynagi surume gore (version > nginx -v)
  3. copy backup:yes + check_mode dry_run + diff; dry_run'da reload/izin adimi yok
  4. nginx -t duserse yedekten geri alma + fail; reload yalniz degisiklik varsa
  5. gomulu shell yok: izinler ve nginx -t/reload files/ altinda; dhparam yalniz yoksa
  6. hosts target_hosts'tan (Portal coklu secimi), yoksa all
"""
import io, os, re, sys
try:
    import jinja2
except ImportError:
    print("ATLANDI: jinja2 yok"); sys.exit(0)

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(os.path.dirname(HERE), "configuration_delivery")
pb = io.open(os.path.join(D, "configuration_delivery.yaml"), encoding="utf-8").read()
fixp = io.open(os.path.join(D, "files", "fix_permissions.sh"), encoding="utf-8").read()
problems = []

# 1) normalize ifadesi
m = re.search(r"cd_files: >-\n\s+(\{\{[\s\S]*?\}\})", pb)
if not m:
    problems.append("1: cd_files set_fact bulunamadi")
else:
    e = jinja2.Environment()
    e.filters['trim'] = lambda s: str(s).strip(); e.filters['unique'] = lambda l: list(dict.fromkeys(l)); e.filters['split'] = lambda s, sep=',': str(s).split(sep)
    expr = re.sub(r"\s+", " ", m.group(1))
    t = e.from_string(expr)
    if t.render(files=["a.conf", "b.conf"]) != "['a.conf', 'b.conf']": problems.append("1: liste girdisi bozuldu")
    if t.render(files="a.conf, b.conf\nc.conf,,") != "['a.conf', 'b.conf', 'c.conf']": problems.append("1: dizge girdisi (virgul+satir) bolunmedi")
    if t.render(files="") != "[]": problems.append("1: bos dizge [] olmali")
if "(cd_files | length) > 0" not in pb: problems.append("1: bos secim assert'i yok")
# 2
for f in ("bmw_defaults.conf", "proxy_settings.conf", "rate_limits.conf", "log_format.conf", "gt-error-page.html", "nginx.conf"):
    if ("%s:" % f) not in pb: problems.append("2: cd_targets'ta yok: " + f)
if "difference(cd_targets.keys() | list)" not in pb: problems.append("2: bilinmeyen dosya assert'i yok")
if "'nginx_plus.conf'" not in pb or "'nginx_opensource.conf'" not in pb or "nginx -v" not in pb: problems.append("2: nginx.conf kaynak secimi yok")
# 3
if not re.search(r"backup: yes[\s\S]{0,200}check_mode: \"\{\{ dry_run \| bool \}\}\"[\s\S]{0,40}diff: yes", pb): problems.append("3: copy backup/check_mode/diff eksik")
if "meta: end_host" not in pb or "when: dry_run | bool" not in pb: problems.append("3: dry_run'da erken bitis yok")
# 4
if "selectattr('backup_file', 'defined')" not in pb or "remote_src: yes" not in pb: problems.append("4: yedekten geri alma yok")
if "when: cd_test.rc != 0" not in pb: problems.append("4: -t sonucu rollback'i tetiklemiyor")
if "nginx_test_or_reload.sh reload" not in pb or "selectattr('changed') | list | length > 0" not in pb: problems.append("4: reload yalniz degisiklikte olmali")
# 5
if "shell: |" in pb: problems.append("5: gomulu cok satirli shell var")
if "files/fix_permissions.sh" not in pb: problems.append("5: izin betigi files/ altindan cagrilmiyor")
if "if [ ! -s /usr/nginx/ssl/dhparam.pem ]" not in fixp: problems.append("5: dhparam her kosuda yeniden uretiliyor")
if not os.path.exists(os.path.join(D, "files", "nginx_test_or_reload.sh")): problems.append("5: nginx_test_or_reload.sh yok")
# 6
if 'hosts: "{{ target_hosts | default(\'all\') }}"' not in pb: problems.append("6: hosts target_hosts'tan gelmiyor")
# README
if "check_configuration_delivery" not in io.open(os.path.join(D, "README.md"), encoding="utf-8").read(): problems.append("README yok/eksik")

if problems:
    print("HATALAR:"); [print(" -", p) for p in problems]; sys.exit(1)
print("OK: configuration_delivery secimli dagitim - normalize, taninan dosyalar, dry_run, rollback, files/ betikleri")
