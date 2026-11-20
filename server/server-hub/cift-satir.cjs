'use strict';
// server/server-hub/cift-satir.cjs - Server_Hub_* son tarama satirlarinda CIFT SATIR ayiklama.
//
// URETIM (2026-11-14, TBMWANS): dbo.Server_Hub_Jvms ayni (host, gen, jvm, scan_date=2026-11-14) icin
// BIREBIR ayni iki satir tuttu, yalniz id farkli (GBSTPQ01/8/GBSTPMAINWEB 408954 + 408983; GBSTPQ02
// 28 satir arayla). Etki: degerlendirme her JVM'i iki kez listeledi, Toplu Auto-Start ikisini birden
// gonderdi ve sunucu "Ayni JVM iki kez secilmis" diye reddetti.
// Kok neden Ansible tarafinda (server_hub_merge.py ayni makineyi iki envanter adiyla tek segmente
// katlar - bilerek; yukleyici artik ayni anahtarla ayiklar, bkz. server_hub README "Cift satir").
// Portal yine de SAVUNMA olarak ayiklar (eski gunler + temizlik oncesi):
//   - her tablo DOGAL ANAHTARINA gore (host + scan_date zaten sorgunun JOIN'inde) tekillestirilir,
//   - en BUYUK id (en son yukleme) kalir; id secilemediyse (eski sema) son gorulen satir kalir,
//   - atilan satir SAYILIR ve yukari tasinir (summary.ciftSatir) - sessiz degil.
// Dogal anahtari olmayan tablo burada YOK: bilinmeyen tabloya dokunulmaz.

const ID_KOLON = '__sh_id';

// Anahtar kolonlari (scan_date haric: loadLatest her host icin tek gun okur). Deger karsilastirmasi
// trim + kucuk harf (SQL Server varsayilan harmanlamasi da buyuk/kucuk harf duyarsizdir).
const DOGAL_ANAHTAR = Object.freeze({
  'dbo.Server_Hub_Hosts': ['host'],
  'dbo.Server_Hub_Init': ['host', 'root', 'file'],
  'dbo.Server_Hub_Jboss': ['host', 'gen'],
  'dbo.Server_Hub_Jvms': ['host', 'gen', 'jvm'],
  'dbo.Server_Hub_Web': ['host', 'product'],
  // aliases SART: nginx satirinda conf_file hep bos ve server_name yalniz ILK ad; 'server_name a b' ile
  // 'server_name a c' iki ayri bloktur (ikisi de trafik alir). Yukleyici VHOST anahtari ile birebir.
  'dbo.Server_Hub_Vhosts': ['host', 'product', 'listen', 'server_name', 'aliases', 'conf_file'],
  'dbo.Server_Hub_Ips': ['host', 'ip', 'iface'],
  'dbo.Server_Hub_Sshd': ['host'],
});

function anahtarDegeri(v) {
  return v == null ? '' : String(v).trim().toLowerCase();
}

/**
 * Satirlari dogal anahtara gore tekillestirir; en buyuk id kalir. Satirlardaki ID_KOLON alani
 * HER durumda silinir (ust katmana sizmaz). Sira korunur (kalan satirin ilk gorulme yeri).
 * @param {string} tablo  'dbo.Server_Hub_Jvms' gibi
 * @param {object[]} satirlar
 * @returns {{ satirlar: object[], atilan: number }}
 */
function tekillestir(tablo, satirlar) {
  const liste = Array.isArray(satirlar) ? satirlar : [];
  const kolonlar = DOGAL_ANAHTAR[tablo];
  const idAl = (r) => {
    const v = r ? r[ID_KOLON] : undefined;
    const n = Number(v);
    return v == null || !Number.isFinite(n) ? null : n;
  };
  const temizle = (r) => {
    if (r && Object.hasOwn(r, ID_KOLON)) delete r[ID_KOLON];
    return r;
  };
  if (!kolonlar) return { satirlar: liste.map(temizle), atilan: 0 };
  const yer = new Map(); // anahtar -> cikti dizisindeki konum
  const kalan = [];
  const kalanId = [];
  let atilan = 0;
  for (const r of liste) {
    const k = kolonlar.map((c) => anahtarDegeri(r?.[c])).join('\u0001');
    const id = idAl(r);
    if (!yer.has(k)) {
      yer.set(k, kalan.length);
      kalan.push(r);
      kalanId.push(id);
      continue;
    }
    atilan += 1;
    const j = yer.get(k);
    const eskiId = kalanId[j];
    // en buyuk id kazanir; id bilinmiyorsa SON gorulen (yukleyici sirasi) kazanir
    if (id == null || eskiId == null || id > eskiId) {
      kalan[j] = r;
      kalanId[j] = id;
    }
  }
  return { satirlar: kalan.map(temizle), atilan };
}

/**
 * loadLatest okumalarinin hepsine uygulanir.
 * @param {Record<string, object[]>} tablolar  { 'dbo.Server_Hub_Jvms': rows, ... }
 * @returns {{ tablolar: Record<string, object[]>, ciftSatir: { toplam: number, tablolar: Record<string, number> } }}
 */
function tumunuTekillestir(tablolar) {
  const out = {};
  const sayim = {};
  let toplam = 0;
  for (const [t, rows] of Object.entries(tablolar || {})) {
    const r = tekillestir(t, rows);
    out[t] = r.satirlar;
    if (r.atilan > 0) {
      sayim[t.replace(/^dbo\./, '')] = r.atilan;
      toplam += r.atilan;
    }
  }
  return { tablolar: out, ciftSatir: { toplam, tablolar: sayim } };
}

module.exports = { ID_KOLON, DOGAL_ANAHTAR, tekillestir, tumunuTekillestir };
