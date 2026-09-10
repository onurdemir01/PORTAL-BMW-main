# -*- coding: utf-8 -*-
"""opsx_openshift_application_rollout: her uygulama KENDI tipine gore mi isleniyor?

NEDEN VAR (2026-09-09): tip tespiti TEK SEFER, tum parti icin yapiliyordu ve tespit
dongusu ilk uygulamada `exit` ediyordu. Ikinci ve sonraki uygulamalara HIC bakilmadan
cikan tek rc butun partiyi tek bir dala yonlendiriyordu. Karisik tipte bir partide:
    uygulama-bir (Deployment)   -> Exist,Success
    uygulama-iki (Argo Rollout) -> "Not Exist,Failed"    <-- restart hic denenmedi
rollout.yaml'daki `oc patch ... restartAt` komutu DOGRUYDU; komuta sira gelmiyordu.

Test uc katmani da AYRI AYRI dogrular:
  [1] detect.yaml kabuk blogu   -> her uygulama kendi satirini uretiyor mu (SAHTE oc ile)
  [2] set_fact ayristirmasi     -> satirlar dogru uc listeye mi dagiliyor (Jinja ile)
  [3] rollout.yaml kabuk blogu  -> patch uygulanmadiysa Success YAZMIYOR mu

Gereksinim: `bash` (Git Bash de olur).
Calistirma:  python bmw_portal/tests/check_rollout_dispatch.py
"""
import io
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile

import jinja2
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
TASKS = os.path.join(os.path.dirname(HERE), "opsx_openshift_application_rollout",
                     "operations", "tasks")

fails = []


def check(cond, label, extra=""):
    print(("  OK   " if cond else "  HATA ") + label + (("  -> " + str(extra)) if extra else ""))
    if not cond:
        fails.append(label)


def task_named(path, prefix):
    for t in yaml.safe_load(io.open(path, encoding="utf-8")):
        if str(t.get("name", "")).startswith(prefix):
            return t
    raise KeyError("%s icinde bulunamadi: %s" % (path, prefix))


def fill(text, **subs):
    for k, v in subs.items():
        text = re.sub(r"\{\{\s*%s\s*\}\}" % k, str(v), text)
    kalan = re.findall(r"\{\{[^}]*\}\}", text)
    assert not kalan, "doldurulmamis Jinja degiskeni: %s" % kalan
    return text


# app-deploy = Deployment | app-argo = Argo Rollout | app-dc = DC | app-yok = hicbiri
FAKE_OC = r"""#!/bin/bash
name="${5:-}"
case "$1 $2" in
  "get deployments") [[ "$name" == "app-deploy" ]] && exit 0 || exit 1 ;;
  "get rollouts")    [[ "$name" == "app-argo"   ]] && exit 0 || exit 1 ;;
  "get dc")          [[ "$name" == "app-dc"     ]] && exit 0 || exit 1 ;;
esac
if [[ "$1" == "patch" ]]; then
  for ((k=1; k<=$#; k++)); do
    if [[ "${!k}" == "-p" ]]; then
      nx=$((k+1)); val="${!nx}"
      PATCH_SINK
    fi
  done
  echo "rollout.argoproj.io/$name patched"; exit 0
fi
if [[ "$1" == "get" && "$2" == "rollout" ]]; then cat "$PATCH_STATE" 2>/dev/null; exit 0; fi
case "$1" in
  login) echo "Login successful."; exit 0 ;;
  logout|rollout) exit 0 ;;
esac
exit 0
"""
# Normal oc: patch'i UYGULAR (geri-okuma ayni degeri dondurur)
OC_UYGULAR = FAKE_OC.replace(
    "PATCH_SINK",
    """echo "$val" | sed 's/.*"restartAt":"\\([^"]*\\)".*/\\1/' > "$PATCH_STATE\"""")
# Yutan oc: cikis kodu 0 ama alan YAZILMIYOR ("unchanged" durumu)
OC_YUTAR = FAKE_OC.replace("PATCH_SINK", ": # BILEREK yazmiyor")


def run_shell(body, fake_oc):
    tmp = tempfile.mkdtemp(prefix="rollout_")
    try:
        binp = os.path.join(tmp, "bin")
        os.makedirs(binp)
        occ = os.path.join(binp, "oc")
        io.open(occ, "w", encoding="utf-8", newline="\n").write(fake_oc)
        os.chmod(occ, os.stat(occ).st_mode | stat.S_IEXEC)
        script = os.path.join(tmp, "run.sh")
        io.open(script, "w", encoding="utf-8", newline="\n").write(body)
        env = dict(os.environ)
        env["PATH"] = binp.replace("\\", "/") + os.pathsep + env["PATH"]
        env["PATCH_STATE"] = os.path.join(tmp, "patch_state").replace("\\", "/")
        return subprocess.run(["bash", script], capture_output=True, text=True, env=env)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


COMMON = dict(url="https://api.test.local", username="uxmid", password="GIZLI", name="ARK-TEST")
BATCH = "ns1,app-deploy;ns2,app-argo;ns3,app-dc;ns4,app-yok"

try:
    print("[1] detect.yaml — her uygulama KENDI satirini uretiyor (dongu durmuyor)")
    body = fill(task_named(os.path.join(TASKS, "detect.yaml"),
                           "--- [Task] Her uygulamanin tipini")["shell"],
                oc_input=BATCH, **COMMON)
    res = run_shell(body, OC_UYGULAR)
except FileNotFoundError:
    print("ATLANDI: `bash` bulunamadi (Git Bash gerekir).")
    sys.exit(0)

lines = [l.strip() for l in res.stdout.strip().split("\n") if l.strip()]
check(len(lines) == 4, "4 uygulama -> 4 tespit satiri", lines)
check("deployment,ns1,app-deploy" in lines, "Deployment tespit edildi")
check("rollout,ns2,app-argo" in lines, "Argo Rollout tespit edildi (eskiden HIC bakilmiyordu)")
check("dc,ns3,app-dc" in lines, "DeploymentConfig tespit edildi")
check("none,ns4,app-yok" in lines, "hicbir tipte olmayan isaretlendi")
check("TESPIT-YOK ns4/app-yok" in res.stderr, "bulunamayanin NEDENI stderr'de")
check("TESPIT-YOK" not in res.stdout, "teshis stdout'a SIZMIYOR (stdout ayristiriliyor)")

print("\n[2] set_fact — satirlar dogru listelere ayriliyor")
env = jinja2.Environment(undefined=jinja2.ChainableUndefined)
# `match` ANSIBLE testidir, duz Jinja'da YOKTUR - birebir taklit edilir (re.match).
env.tests["match"] = lambda v, p: re.match(p, str(v)) is not None
env.filters["regex_replace"] = lambda v, p, r="": re.sub(p, r, str(v))
facts = task_named(os.path.join(TASKS, "detect.yaml"),
                   "--- [Task] Uygulamalari tipe gore ayir")["ansible.builtin.set_fact"]
ctx = {"app_types": {"stdout_lines": lines}}
for k, expr in facts.items():
    ctx[k] = env.from_string(expr).render(**ctx)
    ctx[k] = eval(ctx[k]) if ctx[k].startswith("[") else ctx[k]  # Jinja liste -> python
check(ctx["apps_deployment"] == ["ns1,app-deploy"], "apps_deployment", ctx["apps_deployment"])
check(ctx["apps_rollout"] == ["ns2,app-argo"], "apps_rollout", ctx["apps_rollout"])
check(ctx["apps_dc"] == ["ns3,app-dc"], "apps_dc", ctx["apps_dc"])
check(ctx["apps_none"] == ["ns4,app-yok"], "apps_none", ctx["apps_none"])
check("app-argo" not in str(ctx["apps_deployment"]),
      "Argo uygulamasi deployment listesine SIZMIYOR (eski hatanin ozu)")

print("\n[3] Her tip dosyasi KENDI listesini isliyor")
for fname, prefix, target, beklenen in [
    ("deployment.yaml", "--- [Task] Execute rollout for DEPLOYMENT", "ns1,app-deploy",
     "app-deploy,ns1,ARK-TEST,Exist,Success"),
    ("rollout.yaml", "--- [Task] Execute rollout for ARGO", "ns2,app-argo",
     "app-argo,ns2,ARK-TEST,Exist,Success"),
    ("deploymentconfig.yaml", "--- [Task] Execute rollout for DEPLOYMENTCONFIG", "ns3,app-dc",
     "app-dc,ns3,ARK-TEST,Exist,Success"),
]:
    b = fill(task_named(os.path.join(TASKS, fname), prefix)["shell"],
             target_input=target, **COMMON)
    r = run_shell(b, OC_UYGULAR)
    got = [l.strip() for l in r.stdout.strip().split("\n") if l.strip()]
    check(got == [beklenen], fname, got)

print("\n[4] rollout.yaml — patch UYGULANMADIYSA Success yazilmiyor")
# `oc patch` degisiklik olmasa da 0 doner; yalniz cikis koduna guvenmek yaniltirdi.
b = fill(task_named(os.path.join(TASKS, "rollout.yaml"),
                    "--- [Task] Execute rollout for ARGO")["shell"],
         target_input="ns2,app-argo", **COMMON)
r = run_shell(b, OC_YUTAR)
got = [l.strip() for l in r.stdout.strip().split("\n") if l.strip()]
check(got == ["app-argo,ns2,ARK-TEST,Exist,Failed"], "geri-okuma tutmayinca Failed", got)
check("HATA rollout ns2/app-argo" in r.stderr, "sebep stderr'de")

print("\n" + ("TUM KONTROLLER GECTI" if not fails else "BASARISIZ (%d): %s" % (len(fails), fails)))
sys.exit(1 if fails else 0)
