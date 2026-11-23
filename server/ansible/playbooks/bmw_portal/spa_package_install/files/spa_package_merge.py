#!/usr/bin/env python3
# spa_package_merge.py - Intranet SPA paket kurulumu: bastion OCP okumalarini kalemlerle birlestirir
# ve kalem gecerliligine karar verir (spa_package_install.yml play 3, localhost).
#
# Neden Jinja degil: imaj yolu eslesmesi, digest / etiketsiz, etiket == surum, birden cok etiket,
# application.json JSON nesnesi ve boyut kurallari Jinja'da test edilemiyordu. Bu betik node
# testinde (server/ansible/__tests__/spa-package-install.test.js) gercekten kosar.
#
# Kosum: `<ansible_playbook_python> -I spa_package_merge.py` ; yalniz Python standart kitapligi.
# Girdi (stdin, JSON):
#   {"items": [{"id", "namespace", "application", "version", "cluster",
#               "catalog": bool,            # cluster Portal OCP katalogunda var mi
#               "owner": "<bastion>",       # kalemin cluster'ini okuyan bastion
#               "blocked": "<metin>",       # bastion'in rescue nedeni (varsa)
#               "report": null | {"ok": bool, "unreachable": bool, "error": str,
#                                 "lines": ["IMG\t<container>\t<imaj>", "CM\t<ad>\t<b64>",
#                                           "ERR\t<metin>", "END"]}}]}
# Cikti (stdout, JSON):
#   {"items": [{"id", "ok", "image", "tag", "configmap", "error", "appjson_b64"}]}
#   ok false ise error dolu, appjson_b64 null. Cikti ConfigMap icerigi tasir: cagiran no_log.
# Cikis kodu: 0 (karar verildi; kalem hatalari JSON icinde), 2 (girdi okunamadi).

import base64
import binascii
import json
import re
import sys

MAX_APPJSON_BYTES = 1048576
TAG_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$")


def _text(value, limit=600):
    return " ".join(str(value or "").split())[:limit]


def parse_image(image):
    """Imaj -> (yol, etiket, digest). Etiket yoksa None; digest varsa digest metni."""
    image = str(image or "").strip()
    digest = None
    if "@" in image:
        image, digest = image.split("@", 1)
    slash = image.rfind("/")
    colon = image.rfind(":")
    tag = None
    if colon > slash:
        tag = image[colon + 1:]
        image = image[:colon]
    return image, tag, digest


def path_matches(path, namespace, application):
    """Yol `.../<namespace>/<application>` ile bitiyor mu (harf duyarsiz)."""
    want = (namespace + "/" + application).lower()
    have = path.lower()
    return have == want or have.endswith("/" + want)


def fields(lines, kind):
    out = []
    for line in lines:
        parts = str(line).split("\t")
        if parts[0] == kind:
            out.append(parts[1:])
    return out


def ocp_error(item, report):
    if not item.get("catalog"):
        return "cluster Portal OCP katalogunda yok: " + _text(item.get("cluster"))
    owner = _text(item.get("owner")) or "?"
    if report is None:
        blocked = _text(item.get("blocked"), 300)
        return _text("Bastion sonuc bildirmedi (erisilemedi ya da erken dustu): " + owner + " " + blocked)
    if report.get("unreachable"):
        return "bastion erisilemedi: " + owner
    lines = report.get("lines") or []
    errs = [_text(f[0] if f else "") for f in fields(lines, "ERR")]
    if not report.get("ok"):
        return _text((report.get("error") or "OCP okumasi basarisiz") + " " + "; ".join(errs))
    if errs:
        return _text("; ".join(errs))
    if "END" not in [str(x) for x in lines]:
        return "OCP okumasi tamamlanmadi (END satiri yok)"
    return ""


def check_image(lines, namespace, application, version):
    """Uygulama imaji kurallari -> (hata, imaj, etiket). Hata yoksa bos dize."""
    images = [f[1] for f in fields(lines, "IMG") if len(f) >= 2 and f[1]]
    matching = []
    for image in images:
        path, tag, digest = parse_image(image)
        if path_matches(path, namespace, application):
            matching.append((image, tag, digest))
    if not matching:
        return _text("imaj yolu uygulamayla eslesmiyor: " + ", ".join(images)), None, None
    bad = [m[0] for m in matching if m[2] is not None or m[1] is None or not TAG_RE.match(m[1])]
    if bad:
        return _text("imaj etiketsiz ya da digest ile: " + ", ".join(bad)), None, None
    tags = sorted({m[1] for m in matching})
    if len(tags) != 1:
        return _text("uygulama imaji birden cok etiketle kosuyor: " + ", ".join(tags)), None, None
    image, tag = matching[0][0], tags[0]
    if tag != version:
        msg = "OCP'de kosan surum " + tag + ", planlanan " + version + " (Portal verisi eski olabilir)"
        return _text(msg), image, tag
    return "", image, tag


def check_appjson(lines):
    """ConfigMap ve application.json kurallari -> (hata, configmap, base64)."""
    cms = [f for f in fields(lines, "CM") if len(f) >= 2 and f[0] and f[1]]
    if not cms:
        return "application.json ConfigMap'i okunamadi", None, None
    if len(cms) > 1:
        return _text("birden cok ConfigMap satiri: " + ", ".join(c[0] for c in cms)), None, None
    cm_name, b64 = cms[0][0], cms[0][1].strip()
    where = " (ConfigMap " + cm_name + ")"
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        return "application.json base64 cozulemedi" + where, cm_name, None
    if len(raw) > MAX_APPJSON_BYTES:
        return "application.json cok buyuk (%d bayt > %d)%s" % (len(raw), MAX_APPJSON_BYTES, where), cm_name, None
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return "application.json gecersiz JSON" + where, cm_name, None
    if not isinstance(data, dict):
        return "application.json JSON nesnesi degil" + where, cm_name, None
    return "", cm_name, base64.b64encode(raw).decode("ascii")


def decide(item):
    result = {
        "id": item.get("id"),
        "ok": False,
        "image": None,
        "tag": None,
        "configmap": None,
        "error": None,
        "appjson_b64": None,
    }
    report = item.get("report")
    err = ocp_error(item, report)
    if err:
        result["error"] = err
        return result
    lines = report.get("lines") or []
    err, result["image"], result["tag"] = check_image(
        lines,
        str(item.get("namespace") or ""),
        str(item.get("application") or ""),
        str(item.get("version") or ""),
    )
    if err:
        result["error"] = err
        return result
    err, result["configmap"], b64 = check_appjson(lines)
    if err:
        result["error"] = err
        return result
    result["ok"] = True
    result["appjson_b64"] = b64
    return result


def main():
    try:
        doc = json.loads(sys.stdin.read())
        items = doc["items"]
        if not isinstance(items, list):
            raise ValueError("items liste degil")
    except (ValueError, KeyError, TypeError) as exc:
        sys.stderr.write("girdi okunamadi: %s\n" % exc)
        return 2
    out = []
    for item in items:
        if not isinstance(item, dict):
            sys.stderr.write("girdi okunamadi: kalem nesne degil\n")
            return 2
        out.append(decide(item))
    sys.stdout.write(json.dumps({"items": out}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
