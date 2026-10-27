#!/usr/bin/env python3
"""karsilastir_referans.py - analiz.cjs farkli-gerceklesim testinin BEKLENEN degerlerini uretir.

Amac    : el kitinin karsilastir.py'sini (degistirmeden) modul olarak yukler, fikstur adimlarini onun
          kendi fonksiyonlariyla (Adim.yukle, adim_hesapla, grupla, karar_ver) hesaplar ve sonucu TAM
          hassasiyetle JSON'a yazar (kosular.csv 4 haneye yuvarlar; karsilastirma icin yetmez).
Kullanim: python3 -I karsilastir_referans.py <karsilastir.py> <python_duzeni_kok> <durumlar.json> <cikti.json>
          (beklenen-uret.cjs cagirir; test kosusunda python GEREKMEZ.)
"""
import hashlib
import importlib.util
import json
import os
import re
import sys
from types import SimpleNamespace


def yukle(yol):
    spec = importlib.util.spec_from_file_location("karsilastir_ref", yol)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main(argv):
    betik, kok, durumlar_yolu, cikti = argv
    k = yukle(betik)
    with open(betik, "rb") as f:
        betik_sha = hashlib.sha256(f.read()).hexdigest()
    with open(durumlar_yolu, encoding="utf-8") as f:
        durumlar = json.load(f)
    adimlar = {}
    kosular = []
    for d in sorted(os.listdir(kok)):
        yol = os.path.join(kok, d)
        if not (os.path.isdir(yol) and re.match(r"^[A-Za-z0-9-]+$", d)):
            continue
        ad = k.Adim(d, yol).yukle()
        if ad.bos_mu():
            adimlar[d] = {"bos": True}
            continue
        ks, tls, arka = k.adim_hesapla(ad)
        nproc = None
        for kes in ad.kesitler:
            v = k.sayi(kes["bilgi"].get("nproc"))
            if v:
                nproc = v
                break
        adimlar[d] = {"bos": False, "kosular": ks, "arka": arka, "nproc": nproc, "not": ad.not_}
        kosular.extend(ks)
    gruplar = k.grupla(kosular)
    gruplar_cikti = []
    for (ad, sen, kip, ae, hiz), o in gruplar.items():
        g = {kk: v for kk, v in o.items() if kk != "kosular"}
        g.update(adim=ad, senaryo=sen, kip=kip, ae=ae, hiz=hiz, turlar=[r["tur"] for r in o["kosular"]])
        np_ = adimlar.get(ad, {}).get("nproc")
        g["kapasite_tahmini_rps"] = (np_ * 1000 * 0.8 / o["cpu_ms_istek"]) if (np_ and o["cpu_ms_istek"]) else None
        gruplar_cikti.append(g)
    kararlar = []
    for dz in durumlar:
        a = SimpleNamespace(esik_cpu=float(dz.get("esik_cpu", 10.0)), esik_p95=float(dz.get("esik_p95", 10.0)),
                            esik_zarar=float(dz.get("esik_zarar", 5.0)), kademe_cpu=int(dz.get("kademe_cpu", 250)),
                            kademe_p95=int(dz.get("kademe_p95", 400)))
        karar, satirlar = k.karar_ver(gruplar, {}, dz["ref"], dz["aday"], a)
        kararlar.append({"durum": dz, "karar": karar, "satirlar": satirlar})
    ayr = {}
    for ad in adimlar:
        if not adimlar[ad].get("bos"):
            ayr[ad] = k.ayristirma(gruplar, ad, 250)
    sonuc = {"python": sys.version.split()[0], "karsilastir_sha256": betik_sha, "adimlar": adimlar,
             "gruplar": gruplar_cikti, "kararlar": kararlar, "ayristirma": ayr}
    with open(cikti, "w", encoding="utf-8", newline="\n") as f:
        json.dump(sonuc, f, ensure_ascii=True, allow_nan=False, indent=1, sort_keys=True)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
