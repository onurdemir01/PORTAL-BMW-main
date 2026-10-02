#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""update_wasapp_status.py - dbo.WASAppsInventory.status TEK SATIR guncelleyici (OpsX WAS islemi).

NEDEN VAR: WAS envanteri (bmw_inventory/middleware_applications_inventory/was) yalniz gece taramasiyla
tazelenir. OpsX'ten bir JVM durdurulup/baslatildiginda Portal ertesi geceye kadar bayat durumu
gosterirdi (JBoss'taki update_mwapp_status.py ile ayni sorun).

KURALLAR (TBMWANS: FULL recovery + AG):
  - YALNIZ tek deyim: UPDATE dbo.WASAppsInventory SET status=?, updated_at=SYSUTCDATETIME()
    WHERE host=? AND app=?   (UNIQUE (host, app); DELETE/INSERT/MERGE/TRUNCATE YOK).
  - Yalniz OLCULMUS durum yazilir: running | stopped. 'olculemedi' ya da baska bir deger yazilmaz
    (playbook zaten yalniz OK/SKIP + RUNNING/STOPPED iken cagirir; burada ikinci kapi).
  - 1'den fazla satir eslesirse geri alinir (beklenmez; tekil indeks var).
  - Etkilenen satir sayisi BILINMIYORSA (pyodbc rowcount -1/None: oturumda NOCOUNT acik ya da
    surucu sayiyi vermedi) geri alinir ve FAIL yazilir; "OK (1 satir)" ancak sayi gercekten 1
    iken basilir. Bu yuzden UPDATE'ten once ayni oturumda SET NOCOUNT OFF calistirilir.
  - PAROLA KODDA YOK. Playbook parolayi STDIN'den verir (--pwd-stdin; AWX credential tbmwans_pwd,
    gorev no_log). Ortam degiskeni (TBMWANS_PWD) yalniz elle kosum icin yedek yoldur: Ansible
    `environment:` degerleri become (dzdo) komut satirina yazilir ve ps/dzdo denetim kaydinda
    gorunur; stdin modulun kendi girdisidir, komut satirina girmez.
    Parola hicbir ciktiya basilmaz; hata metninden de silinir.

Cikti: tek satir  WASAPP_UPDATE\t<OK|NOROW|FAIL>\t<mesaj>
Cikis kodu: 0 = OK/NOROW, 1 = DB hatasi, 2 = girdi/ortam hatasi (DB'ye baglanilmadi).
"""
import argparse
import os
import re
import sys

try:
    import pyodbc
except ImportError:  # GBLABT02'de kurulu; yoksa acik FAIL
    pyodbc = None

CONN_SABLON = (
    "DRIVER={ODBC Driver 18 for SQL Server};"
    "SERVER=TBMWANSALS.fw.garanti.com.tr,1453;"
    "DATABASE=TBMWANS;"
    "UID=TBMWANS_usr;"
    "PWD={%s};"
    "TrustServerCertificate=yes;"
)
LOCK_SQL = "SET LOCK_TIMEOUT 10000"
NOCOUNT_SQL = "SET NOCOUNT OFF"
UPDATE_SQL = (
    "UPDATE dbo.WASAppsInventory SET status = ?, updated_at = SYSUTCDATETIME() "
    "WHERE host = ? AND app = ?"
)
AD = re.compile(r"\A[A-Za-z0-9_.-]{1,200}\Z")
DURUMLAR = ("running", "stopped")


def gizle(metin, parola):
    s = str(metin)
    if parola:
        s = s.replace(parola, "***")
    s = re.sub(r"(?i)(pwd\s*=\s*)[^;]*", r"\1***", s)
    s = re.sub(r"(?i)(password\s*[=:]\s*)\S+", r"\1***", s)
    return s.replace("\t", " ").replace("\r", " ").replace("\n", " ")[:300]


def satir(durum, mesaj):
    print("WASAPP_UPDATE\t%s\t%s" % (durum, mesaj))
    sys.stdout.flush()


def parola_al(stdin_mi):
    if stdin_mi:
        try:
            return sys.stdin.readline().rstrip("\r\n")
        except Exception:  # noqa: BLE001 - okunamayan stdin = parola yok
            return ""
    return os.environ.get("TBMWANS_PWD", "")


def main(argv=None):
    p = argparse.ArgumentParser(description="dbo.WASAppsInventory.status tek satir guncelleyici")
    p.add_argument("--host", required=True)
    p.add_argument("--app", required=True)
    p.add_argument("--status", required=True)
    p.add_argument("--pwd-stdin", action="store_true", help="parolayi stdin'in ilk satirindan oku")
    try:
        a = p.parse_args(argv)
    except SystemExit:
        satir("FAIL", "arguman hatasi (--host --app --status gerekli)")
        return 2
    if not AD.match(a.host) or not AD.match(a.app):
        satir("FAIL", "gecersiz host/app (yalniz ^[A-Za-z0-9_.-]+$); DB'ye baglanilmadi")
        return 2
    if a.status not in DURUMLAR:
        satir("FAIL", "status yalniz running|stopped olabilir (olculmus durum); DB'ye baglanilmadi")
        return 2
    parola = parola_al(a.pwd_stdin)
    if not parola:
        satir("FAIL", "parola bos (AWX credential tbmwans_pwd -> stdin); DB'ye baglanilmadi")
        return 2
    if pyodbc is None:
        satir("FAIL", "pyodbc yok; DB'ye baglanilmadi")
        return 2
    conn = None
    cur = None
    try:
        conn = pyodbc.connect(CONN_SABLON % parola.replace("}", "}}"), autocommit=False)
        cur = conn.cursor()
        cur.execute(LOCK_SQL)
        cur.execute(NOCOUNT_SQL)
        cur.execute(UPDATE_SQL, (a.status, a.host, a.app))
        n = cur.rowcount
        if not isinstance(n, int) or isinstance(n, bool) or n < 0:
            conn.rollback()
            satir("FAIL", "%s/%s: etkilenen satir sayisi bilinmiyor (rowcount %r); GERI ALINDI" % (a.host, a.app, n))
            return 1
        if n > 1:
            conn.rollback()
            satir("FAIL", "%s/%s icin %d satir eslesti (en cok 1 beklenir); GERI ALINDI" % (a.host, a.app, n))
            return 1
        conn.commit()
        if n == 0:
            satir("NOROW", "%s/%s dbo.WASAppsInventory'de yok (henuz taranmamis olabilir); guncellenecek satir yok" % (a.host, a.app))
            return 0
        satir("OK", "%s/%s -> status=%s (%d satir)" % (a.host, a.app, a.status, n))
        return 0
    except Exception as e:  # noqa: BLE001 - pyodbc.Error dahil her hata FAIL + geri alma
        if conn is not None:
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                pass
        satir("FAIL", "dbo.WASAppsInventory guncellenemedi: %s" % gizle(e, parola))
        return 1
    finally:
        for nesne in (cur, conn):
            if nesne is not None:
                try:
                    nesne.close()
                except Exception:  # noqa: BLE001
                    pass


if __name__ == "__main__":
    sys.exit(main())
