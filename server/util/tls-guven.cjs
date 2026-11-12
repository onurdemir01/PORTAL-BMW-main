// server/util/tls-guven.cjs — ic servislere giden HTTPS isteklerinde sertifika DOGRULAMASI (2026-11-12).
//
// NEDEN: AWX, OCP API ve Nobetci istekleri `rejectUnauthorized: false` ile gidiyordu. AWX'e her
// istekte Bearer / Basic kimlik bilgisi, OCP API'ye cluster token'i gidiyor; dogrulanmayan TLS'te
// araya giren biri bunlari okur. Kurumsal kod analizi bunu zafiyet sayar (teslim 0 zafiyet).
//
// MODEL — dogrulama HER ZAMAN acik; guven deposu uc katmanin birlesimi:
//   1) Node'un VARSAYILAN deposu: gomulu genel kokler + NODE_EXTRA_CA_CERTS (deploy betikleri ve
//      systemd birimi bunu sunucunun sistem CA paketine ayarlar; kurum ici CA oradadir).
//   2) CORP_CA_CERT_PATH (AI / MCP icin zaten kurulu kurumsal zincirler; docs/TLS-SETUP.md).
//   3) Entegrasyona ozel ek CA: <ONEK>_TLS_CA (or. AWX_TLS_CA=/etc/pki/awx-ca.pem).
// DIKKAT: `ca` secenegi verilirse Node VARSAYILAN depoyu (NODE_EXTRA_CA_CERTS dahil) BIRAKIR. Bu
// yuzden 2/3 varsa 1 de acikca eklenir; hicbiri yoksa `ca` hic verilmez (varsayilan depo gecerli).
//
// ACIL CIKIS: <ONEK>_TLS_DOGRULAMA=kapali yalniz o entegrasyonda dogrulamayi kapatir. Her istekte
// process.env'den okunur (Admin > Sistem Ayarlari'ndan kaydedilince restart gerekmez) ve her durum
// degisiminde log'a UYARI duser. Kalici cozum degildir: CA'yi <ONEK>_TLS_CA ile verin.
//
// MALIYET: guven deposu bir kez kurulur ve `tls.createSecureContext` ile ONBELLEKLENIR (anahtar:
// dosya yolu + mtime + boyut; sertifika donusunde yeniden kurulur). Istege `ca` dizisi degil hazir
// `secureContext` verilir; `ca` verilseydi http.Agent havuz anahtari icin her istekte yuzlerce
// PEM'i metne cevirirdi.
//
// AYRI HAVUZ (AJAN): Agent'in havuz anahtari `secureContext`i ICERMEZ. Ortak globalAgent'ta
// keep-alive soketi baska bir guven baglamiyla (ya da dogrulama kapaliyken) kurulmus olabilir ve
// ayni host:port'a giden istek onu DOGRULAMADAN yeniden kullanirdi (TD11 bunu yakaladi). Bu yuzden
// her (entegrasyon, guven baglami, dogrulama) uclusu kendi ajanini kullanir; baglam degisince eski
// ajanin soketleri kapatilir.
'use strict';

const fs = require('fs');
const https = require('https');
const net = require('net');
const tls = require('tls');
const { resolveCaPath, parsePemCertificates } = require('../ai/ca.cjs');

const ENTEGRASYONLAR = Object.freeze({
  awx: { ad: 'AWX', onek: 'AWX' },
  ocp: { ad: 'OCP API', onek: 'OCP' },
  nobetci: { ad: 'Nobetci API', onek: 'NOBETCI' },
});

// Sertifika DOGRULAMASI kaynakli hata kodlari (ag/DNS hatalari burada YOK: onlar sertifika sorunu degil).
const TLS_HATA_KODLARI = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'CERT_REVOKED',
  'CERT_SIGNATURE_FAILURE',
  'INVALID_CA',
  'HOSTNAME_MISMATCH',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function entegrasyon(anahtar) {
  const e = ENTEGRASYONLAR[anahtar];
  if (!e) throw new Error(`tls-guven: bilinmeyen entegrasyon: ${anahtar}`);
  return e;
}

/** <ONEK>_TLS_DOGRULAMA=kapali mi? Yalniz bu tam deger kapatir; bos / baska her deger = acik. */
function dogrulamaKapaliMi(anahtar) {
  const { onek } = entegrasyon(anahtar);
  return (
    String(process.env[`${onek}_TLS_DOGRULAMA`] || '')
      .trim()
      .toLowerCase() === 'kapali'
  );
}

// Node 22.15+ `tls.getCACertificates('default')`: gomulu kokler + NODE_EXTRA_CA_CERTS. Daha eski
// surumlerde ayni kumeyi elle kurariz (NODE_EXTRA_CA_CERTS surec acilisinda okunur, sonra degismez).
function varsayilanDepo() {
  if (typeof tls.getCACertificates === 'function') return tls.getCACertificates('default');
  const liste = [...tls.rootCertificates];
  const ek = process.env.NODE_EXTRA_CA_CERTS;
  if (ek) {
    try {
      liste.push(...parsePemCertificates(fs.readFileSync(ek, 'utf8')));
    } catch {
      // Node da okunamayan NODE_EXTRA_CA_CERTS'i yalniz uyarip gecer.
    }
  }
  return liste;
}

function dosyaAnahtari(yol) {
  const st = fs.statSync(yol);
  return `${yol}|${st.mtimeMs}|${st.size}`;
}

const _baglamlar = new Map(); // entegrasyon -> { anahtar, baglam }
const _ajanlar = new Map(); // entegrasyon -> { kimlik, ajan }

function ajan(anahtar, kimlik) {
  const onceki = _ajanlar.get(anahtar);
  if (onceki && onceki.kimlik === kimlik) return onceki.ajan;
  if (onceki) onceki.ajan.destroy();
  // https.globalAgent ile ayni ayarlar (Node 19+): bos soket 5 sn sonra kapanir, surec cikisini tutmaz.
  const yeni = new https.Agent({ keepAlive: true, scheduling: 'lifo', timeout: 5000 });
  _ajanlar.set(anahtar, { kimlik, ajan: yeni });
  return yeni;
}
const _sonDurum = new Map(); // entegrasyon -> son loglanan durum metni

// `konu`: ayni entegrasyonda birbirinden bagimsiz loglanan durumlar (or. paylasilan CA uyarisi).
function durumuLogla(anahtar, metin, uyari, konu = '') {
  const k = `${anahtar}|${konu}`;
  if (_sonDurum.get(k) === metin) return;
  _sonDurum.set(k, metin);
  (uyari ? console.warn : console.log)(`[TLS] ${entegrasyon(anahtar).ad}: ${metin}`);
}

// Ek CA dosyalari: [{ etiket, yol, zorunlu }]. Entegrasyonun kendi dosyasi ZORUNLUDUR (yanlis yol
// acik bir yapilandirma hatasi, sessizce yok sayilmaz); CORP_CA_CERT_PATH paylasilan bir ektir,
// okunamazsa uyarilir ve atlanir (AI / MCP kendi yolunda bunu zaten hata olarak bildirir).
function ekDosyalar(anahtar) {
  const { onek } = entegrasyon(anahtar);
  const liste = [];
  const ozel = String(process.env[`${onek}_TLS_CA`] || '').trim();
  if (ozel) liste.push({ etiket: `${onek}_TLS_CA`, yol: resolveCaPath(ozel), zorunlu: true });
  const kurum = String(process.env.CORP_CA_CERT_PATH || '').trim();
  if (kurum) liste.push({ etiket: 'CORP_CA_CERT_PATH', yol: resolveCaPath(kurum), zorunlu: false });
  return liste;
}

// Okunabilen ek dosyalar (yol + mtime + boyut anahtariyla). Zorunlu olan okunamazsa firlatir.
function okunabilirEkler(anahtar) {
  const dosyalar = [];
  for (const d of ekDosyalar(anahtar)) {
    try {
      dosyalar.push({ ...d, anahtar: dosyaAnahtari(d.yol) });
    } catch {
      if (d.zorunlu) {
        throw new Error(
          `${d.etiket} okunamadi: ${d.yol} (dosya yok ya da izin yok; docs/TLS-SETUP.md)`,
        );
      }
      durumuLogla(anahtar, `${d.etiket} okunamadi (${d.yol}); bu ek atlandi.`, true, d.etiket);
    }
  }
  return dosyalar;
}

// Varsayilan depo + ek dosyalarin PEM bloklari -> tek guven baglami.
function baglamKur(anahtar, dosyalar) {
  const pemler = new Set(varsayilanDepo().map((p) => p.trim()));
  const varsayilanSayi = pemler.size;
  const ekler = [];
  for (const d of dosyalar) {
    const bloklar = parsePemCertificates(fs.readFileSync(d.yol, 'utf8'));
    if (!bloklar.length && d.zorunlu) {
      throw new Error(`${d.etiket} dosyasinda PEM sertifikasi yok: ${d.yol}`);
    }
    for (const b of bloklar) pemler.add(b.trim());
    if (bloklar.length) ekler.push(`${d.etiket}=${bloklar.length}`);
  }
  const ozet = ekler.join(', ') || 'ek yok';
  durumuLogla(anahtar, `sertifika dogrulamasi ACIK (varsayilan depo ${varsayilanSayi} + ${ozet}).`);
  return tls.createSecureContext({ ca: [...pemler] });
}

/**
 * Entegrasyonun guven baglami. Ek CA yoksa `null` (Node'un varsayilan deposu kullanilir).
 * Zorunlu ek CA okunamazsa ACIK hata firlatir (istek gitmez).
 */
function guvenBaglami(anahtar) {
  const dosyalar = okunabilirEkler(anahtar);
  if (!dosyalar.length) {
    durumuLogla(
      anahtar,
      'sertifika dogrulamasi ACIK (Node varsayilan deposu + NODE_EXTRA_CA_CERTS).',
    );
    return null;
  }
  const anahtarMetni = dosyalar.map((d) => d.anahtar).join('||');
  const onceki = _baglamlar.get(anahtar);
  if (onceki && onceki.anahtar === anahtarMetni) return onceki.baglam;
  const baglam = baglamKur(anahtar, dosyalar);
  _baglamlar.set(anahtar, { anahtar: anahtarMetni, baglam });
  return baglam;
}

/**
 * `https.request` seceneklerine yayilacak TLS alanlari.
 *   hedef     : URL nesnesi (parsed). http: ise bos nesne doner.
 *   sunucuAdi : baglanilan adres IP / farkli bir host ise sertifikanin dogrulanacagi gercek ad (SNI).
 */
function tlsSecenekleri(anahtar, hedef, { sunucuAdi } = {}) {
  entegrasyon(anahtar);
  if (!hedef || hedef.protocol !== 'https:') return {};
  const ad = sunucuAdi && !net.isIP(sunucuAdi) ? { servername: sunucuAdi } : {};
  const dogrula = !dogrulamaKapaliMi(anahtar);
  if (!dogrula) {
    durumuLogla(
      anahtar,
      `sertifika dogrulamasi KAPALI (${entegrasyon(anahtar).onek}_TLS_DOGRULAMA=kapali). Kimlik bilgileri ` +
        `dogrulanmamis baglantidan gidiyor; CA'yi ${entegrasyon(anahtar).onek}_TLS_CA ile verip bu ayari kaldirin.`,
      true,
    );
    return { rejectUnauthorized: dogrula, ...ad, agent: ajan(anahtar, 'dogrulama-kapali') };
  }
  const baglam = guvenBaglami(anahtar);
  const kimlik = baglam ? `baglam:${_baglamlar.get(anahtar).anahtar}` : 'varsayilan';
  return {
    rejectUnauthorized: dogrula,
    ...ad,
    ...(baglam ? { secureContext: baglam } : {}),
    agent: ajan(anahtar, kimlik),
  };
}

function tlsHatasiMi(err) {
  return Boolean(err && TLS_HATA_KODLARI.has(err.code));
}

/**
 * Sertifika hatasina cozum yolunu ekler (ayni Error nesnesi; `code` korunur). Diger hatalar aynen doner.
 */
function tlsHatasiAcikla(err, anahtar, host) {
  if (!tlsHatasiMi(err)) return err;
  const { ad, onek } = entegrasyon(anahtar);
  const ilk = err.message;
  const yer = host ? ` (${host})` : '';
  err.message =
    `${ad} TLS sertifikasi dogrulanamadi${yer}: ${err.code}. ` +
    `Cozum: sunucunun CA zincirini ${onek}_TLS_CA ile verin ya da sunucunun sistem CA paketine ekleyin ` +
    `(once: npm run tls:dene; docs/TLS-SETUP.md). Acil gecici cikis: ${onek}_TLS_DOGRULAMA=kapali. [${ilk}]`;
  return err;
}

/** Test icin: onbellekleri ve log durumunu sifirlar. Uretim yolunda CAGRILMAZ. */
function _sifirla() {
  _baglamlar.clear();
  _sonDurum.clear();
  for (const { ajan: a } of _ajanlar.values()) a.destroy();
  _ajanlar.clear();
}

module.exports = {
  ENTEGRASYONLAR,
  tlsSecenekleri,
  tlsHatasiAcikla,
  tlsHatasiMi,
  dogrulamaKapaliMi,
  guvenBaglami,
  _sifirla,
};
