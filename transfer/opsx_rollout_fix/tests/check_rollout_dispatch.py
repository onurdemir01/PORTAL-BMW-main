# -*- coding: utf-8 -*-
"""opsx_openshift_application_rollout: her uygulama KENDI tipine gore mi isleniyor?

NEDEN VAR (2026-09-09): tip tespiti TEK SEFER, tum parti icin yapiliyordu ve tespit
dongusu ilk uygulamada `exit` ediyordu. Ikinci ve sonraki uygulamalara HIC bakilmadan
cikan tek rc butun partiyi tek bir dala yonlendiriyordu. Karisik tipte bir partide:
    uygulama-bir (Deployment)   -> Exist,Success
    uygulama-iki (Argo Rollout) -> "Not Exist,Failed"    <-- restart hic denenmedi
Argo Rollout'un `oc patch ... restartAt` komutu DOGRUYDU; komuta sira gelmiyordu.

Bu test restart_all.yaml icindeki KABUK BLOGUNU dosyadan cikarip SAHTE bir `oc` ile
gercekten calistirir - yani iddiayi metin uzerinden degil, davranis uzerinden dogrular.

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

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
TASKS = os.path.join(os.path.dirname(HERE), "opsx_openshift_application_rollout",
                     "operations", "tasks")

fails = []


def check(cond, label, extra=""):
    print(("  OK   " if cond else "  HATA ") + label + (("  -> " + str(extra)) if extra else ""))
    if not cond:
        fails.append(label)


def shell_of(path, task_index=0):
    """Gorev dosyasindaki shell blogunu, Jinja degiskenleri doldurulmus halde dondurur."""
    tasks = yaml.safe_load(io.open(path, encoding="utf-8"))
    body = tasks[task_index]["shell"]
    subs = {
        "url": "https://api.test.local",
        "username": "uxmid",
        "password": "GIZLI",
        "name": "ARK-TEST",
        "oc_input": "ns1,app-deploy;ns2,app-argo;ns3,app-dc;ns4,app-yok",
    }
    for k, v in subs.items():
        body = re.sub(r"\{\{\s*%s\s*\}\}" % k, v, body)
    kalan = re.findall(r"\{\{[^}]*\}\}", body)
    assert not kalan, "doldurulmamis Jinja degiskeni: %s" % kalan
    return body


FAKE_OC = r"""#!/bin/bash
# app-deploy = Deployment | app-argo = Argo Rollout | app-dc = DeploymentConfig
# app-yok    = hicbiri.   PATCH_STATE dosyasi restartAt geri-okumasini taklit eder.
name="${5:-}"
case "$1 $2" in
  "get deployments") [[ "$name" == "app-deploy" ]] && exit 0 || exit 1 ;;
  "get rollouts")    [[ "$name" == "app-argo"   ]] && exit 0 || exit 1 ;;
  "get dc")          [[ "$name" == "app-dc"     ]] && exit 0 || exit 1 ;;
esac
if [[ "$1" == "patch" ]]; then
  # -p'den sonraki JSON'daki restartAt degerini sakla (geri-okuma bunu dondurur)
  for ((k=1; k<=$#; k++)); do
    if [[ "${!k}" == "-p" ]]; then
      nx=$((k+1)); val="${!nx}"
      echo "$val" | sed 's/.*"restartAt":"\([^"]*\)".*/\1/' > "$PATCH_STATE"
    fi
  done
  echo "rollout.argoproj.io/$name patched"
  exit 0
fi
if [[ "$1" == "get" && "$2" == "rollout" ]]; then
  # jsonpath geri-okumasi
  cat "$PATCH_STATE" 2>/dev/null
  exit 0
fi
case "$1" in
  login) echo "Login successful."; exit 0 ;;
  logout) exit 0 ;;
  rollout) exit 0 ;;
esac
exit 0
"""


def run(fake_oc=FAKE_OC):
    tmp = tempfile.mkdtemp(prefix="rollout_")
    try:
        binp = os.path.join(tmp, "bin")
        os.makedirs(binp)
        occ = os.path.join(binp, "oc")
        io.open(occ, "w", encoding="utf-8", newline="\n").write(fake_oc)
        os.chmod(occ, os.stat(occ).st_mode | stat.S_IEXEC)

        script = os.path.join(tmp, "run.sh")
        io.open(script, "w", encoding="utf-8", newline="\n").write(
            shell_of(os.path.join(TASKS, "restart_all.yaml")))

        env = dict(os.environ)
        env["PATH"] = binp.replace("\\", "/") + os.pathsep + env["PATH"]
        env["PATCH_STATE"] = os.path.join(tmp, "patch_state").replace("\\", "/")
        out = subprocess.run(["bash", script], capture_output=True, text=True, env=env)
        return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


try:
    res = run()
except FileNotFoundError:
    print("ATLANDI: `bash` bulunamadi (Git Bash gerekir).")
    sys.exit(0)

lines = [l.strip() for l in res.stdout.strip().split("\n") if l.strip()]

print("[1] Parti KOMPLE isleniyor - dongu ilk uygulamada durmuyor")
check(len(lines) == 4, "4 uygulama -> 4 CSV satiri", lines)

print("\n[2] Her uygulama KENDI tipine gore islendi")
check("app-deploy,ns1,ARK-TEST,Exist,Success" in lines, "Deployment -> Success")
check("app-argo,ns2,ARK-TEST,Exist,Success" in lines,
      "Argo Rollout -> Success (eski halde 'Not Exist,Failed' oluyordu)")
check("app-dc,ns3,ARK-TEST,Exist,Success" in lines, "DeploymentConfig -> Success")
check("app-yok,ns4,ARK-TEST,Not Exist,Failed" in lines, "hicbir tipte olmayan -> Not Exist")

print("\n[3] Bulunamayan uygulamanin NEDENI stderr'e yaziliyor")
check("TESPIT-YOK ns4/app-yok" in res.stderr, "teshis satiri var")
check("TESPIT-YOK" not in res.stdout, "teshis CSV'ye SIZMIYOR (stdout dogrudan rapora gider)")

print("\n[4] restartAt GERI OKUNUYOR - `oc patch` degisiklik olmasa da 0 doner")
# Patch'i sessizce yutan bir oc: cikis kodu 0 ama alan YAZILMIYOR.
YUTAN_OC = FAKE_OC.replace(
    """      echo "$val" | sed 's/.*"restartAt":"\\([^"]*\\)".*/\\1/' > "$PATCH_STATE\"""",
    """      : # BILEREK yazmiyor - "unchanged" durumunu taklit eder""")
res2 = run(YUTAN_OC)
lines2 = [l.strip() for l in res2.stdout.strip().split("\n") if l.strip()]
check("app-argo,ns2,ARK-TEST,Exist,Failed" in lines2,
      "patch uygulanmadiysa Success YAZILMIYOR", [l for l in lines2 if "app-argo" in l])
check("HATA rollout ns2/app-argo" in res2.stderr, "sebep stderr'de raporlaniyor")

print("\n" + ("TUM KONTROLLER GECTI" if not fails else "BASARISIZ (%d): %s" % (len(fails), fails)))
sys.exit(1 if fails else 0)
