#!/usr/bin/env node
// scripts/test-tls.cjs — hedef host'lara TLS DOGRULAMA testi (`npm run tls:dene`).
//
// KULLANIM:
//   npm run tls:dene                                            # varsayilan hedefler
//   npm run tls:dene -- --ortam prod                            # .env.prod ile (sunucuda)
//   npm run tls:dene -- --url https://awx2.ornek --entegrasyon awx   # ek AWX sunucusu vb.
//   npm run tls:dene -- --host api.openai.com                   # tek hedef (AI guven deposu)
//   npm run tls:dene -- --ca server/certs/combined-ca-chain.pem # CORP_CA_CERT_PATH'i ez
//
// Varsayilan hedefler: AI saglayicilari ve MCP route'lari (server/ai/ca.cjs guven deposu) + AWX_URL ve
// Nobetci API (server/util/tls-guven.cjs: sunucunun bu entegrasyonlarda KULLANDIGI guven deposunun
// aynisi). Admin ekranindan eklenen diger AWX sunuculari ve OCP cluster API adresleri --url ile denenir.
//
// DOGRULAMA HER ZAMAN ACIK: el sikisma dogrulanamazsa baglanti kurulmaz ve hata kodu basilir
// (<ONEK>_TLS_DOGRULAMA=kapali olsa bile; bu betik "dogrulama acik olsa calisir mi" sorusunu cevaplar).
// Sunulan zinciri gormek / cekmek icin: bash scripts/fetch-ca.sh <host>. Tam rehber: docs/TLS-SETUP.md
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');

// Sunucu (deploy/run.sh, systemd birimi) sistem CA paketini NODE_EXTRA_CA_CERTS ile EKLER; Node bunu
// yalniz surec acilisinda okur. Elle calistirilan teshis ayni kosulu gorsun diye kendini onunla yeniden baslatir.
const SISTEM_CA = '/etc/pki/tls/certs/ca-bundle.crt';
if (!process.env.NODE_EXTRA_CA_CERTS && !process.env.TLS_DENE_IC && fs.existsSync(SISTEM_CA)) {
  const r = spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: SISTEM_CA, TLS_DENE_IC: '1' },
  });
  process.exit(r.status == null ? 1 : r.status);
}

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

// Ortam dosyalari sunucuyla AYNI sirada (server/index.cjs): .env.<ortam> > .env.local > .env
const ortam = String(getArg('--ortam') || process.env.APP_ENV || '').trim();
const kok = path.resolve(__dirname, '..');
const dotenv = require('dotenv');
if (ortam) dotenv.config({ path: path.join(kok, `.env.${ortam}`), quiet: true });
dotenv.config({ path: path.join(kok, '.env.local'), quiet: true });
dotenv.config({ path: path.join(kok, '.env'), quiet: true });

const tlsMod = require('tls');
const { buildCombinedCa } = require('../server/ai/ca.cjs');
const { ENTEGRASYONLAR, guvenBaglami, dogrulamaKapaliMi } = require('../server/util/tls-guven.cjs');

const caOverride = getArg('--ca');
if (caOverride) process.env.CORP_CA_CERT_PATH = caOverride;

function hedefUrl(metin) {
  try {
    const u = new URL(metin);
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

// Hedef: { etiket, host, port, entegrasyon? } — entegrasyon yoksa AI / MCP guven deposu.
function hedefler() {
  const tekUrl = getArg('--url');
  if (tekUrl) {
    const ent = getArg('--entegrasyon') || 'awx';
    if (!ENTEGRASYONLAR[ent]) {
      console.error(`--entegrasyon su degerlerden biri olmali: ${Object.keys(ENTEGRASYONLAR).join(', ')}`);
      process.exit(2);
    }
    const u = hedefUrl(tekUrl);
    if (!u) {
      console.error(`--url https:// ile baslayan gecerli bir adres olmali: ${tekUrl}`);
      process.exit(2);
    }
    return [{ etiket: ENTEGRASYONLAR[ent].ad, host: u.hostname, port: Number(u.port) || 443, entegrasyon: ent }];
  }
  const tekHost = getArg('--host');
  if (tekHost) return [{ etiket: 'AI / MCP', host: tekHost, port: 443 }];

  const liste = [
    { etiket: 'AI', host: 'api.openai.com', port: 443 },
    { etiket: 'AI', host: 'api.anthropic.com', port: 443 },
  ];
  for (const anahtar of ['DT_MANAGED_MCP_URL', 'INSTANA_MCP_URL']) {
    const u = hedefUrl(process.env[anahtar] || '');
    if (u) liste.push({ etiket: `MCP (${anahtar})`, host: u.hostname, port: Number(u.port) || 443 });
  }
  // AWX: eski tek-sunucu AWX_URL + coklu AWX_<1-9>_URL (server/ansible/runner.cjs getServers ile ayni).
  for (const anahtar of ['AWX_URL', ...Array.from({ length: 9 }, (_, i) => `AWX_${i + 1}_URL`)]) {
    const u = hedefUrl(process.env[anahtar] || '');
    if (u) liste.push({ etiket: `AWX (${anahtar})`, host: u.hostname, port: Number(u.port) || 443, entegrasyon: 'awx' });
  }
  const nobetci = hedefUrl(process.env.NOBETCI_API_URL || '');
  if (nobetci) {
    const baglan = String(process.env.NOBETCI_API_HOST || '').trim();
    liste.push({
      etiket: 'Nobetci API',
      host: nobetci.hostname,
      baglan: baglan || nobetci.hostname,
      port: Number(nobetci.port) || 443,
      entegrasyon: 'nobetci',
    });
  }
  return liste;
}

function guvenSecenegi(h) {
  if (!h.entegrasyon) return { ca: buildCombinedCa().ca };
  const baglam = guvenBaglami(h.entegrasyon);
  return baglam ? { secureContext: baglam } : {};
}

function testHost(h) {
  return new Promise((resolve) => {
    let guven;
    try {
      guven = guvenSecenegi(h);
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }
    const socket = tlsMod.connect(
      {
        host: h.baglan || h.host,
        port: h.port,
        ...(net.isIP(h.host) ? {} : { servername: h.host }),
        ...guven,
        rejectUnauthorized: true,
        timeout: 8000,
      },
      () => {
        const cert = socket.getPeerCertificate();
        const sonuc = {
          ok: true,
          issuer: cert?.issuer ? Object.entries(cert.issuer).map(([k, v]) => `${k}=${v}`).join(', ') : null,
          validTo: cert?.valid_to || null,
        };
        socket.destroy();
        resolve(sonuc);
      },
    );
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, error: 'TIMEOUT' });
    });
    socket.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
  });
}

(async () => {
  const liste = hedefler();
  console.log('── TLS dogrulama testi ───────────────────────────────');
  console.log(`Ortam dosyasi: ${ortam ? `.env.${ortam} + ` : ''}.env.local + .env (Admin ekranindan kaydedilen degerler burada YOK)`);
  console.log(`NODE_EXTRA_CA_CERTS: ${process.env.NODE_EXTRA_CA_CERTS || '(yok)'}`);
  console.log(`CORP_CA_CERT_PATH: ${process.env.CORP_CA_CERT_PATH || '(yok)'}`);
  for (const [anahtar, e] of Object.entries(ENTEGRASYONLAR)) {
    const ek = process.env[`${e.onek}_TLS_CA`];
    const kapali = dogrulamaKapaliMi(anahtar) ? '  [UYARI: dogrulama su an KAPALI]' : '';
    console.log(`${e.onek}_TLS_CA: ${ek || '(yok)'}${kapali}`);
  }
  console.log('');

  let hatali = 0;
  for (const h of liste) {
    const r = await testHost(h);
    const ad = `${h.etiket}: ${h.host}${h.baglan && h.baglan !== h.host ? ` (baglanilan ${h.baglan})` : ''}:${h.port}`;
    if (r.ok) {
      console.log(`✓ ${ad}`);
      console.log(`    issuer : ${r.issuer}`);
      console.log(`    validTo: ${r.validTo}`);
    } else {
      hatali++;
      console.log(`✗ ${ad} — ${r.error}`);
      const onek = h.entegrasyon ? ENTEGRASYONLAR[h.entegrasyon].onek : null;
      if (/UNABLE_TO|SELF_SIGNED|CERT_|INVALID_CA/.test(String(r.error))) {
        console.log(`    → Zincir bu guven deposunda yok. Zinciri gormek / cekmek icin: bash scripts/fetch-ca.sh ${h.host}`);
        console.log(
          onek
            ? `    → CA'yi ${onek}_TLS_CA=<pem yolu> ile verin ya da sunucunun sistem CA paketine ekleyin.`
            : '    → build-ca-bundle ile CORP_CA_CERT_PATH paketine ekleyin (docs/TLS-SETUP.md).',
        );
      } else if (/ALTNAME|HOSTNAME/.test(String(r.error))) {
        console.log('    → Sertifika bu adi kapsamiyor: adresin sertifikadaki ad(lar)la yazildigini kontrol edin.');
      } else if (/ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|ECONNREFUSED|TIMEOUT/.test(String(r.error))) {
        console.log('    → Ag/DNS erisimi yok (VPN/kurumsal ag gerekebilir) — sertifika sorunu DEGIL.');
      }
    }
    console.log('');
  }
  console.log(hatali === 0 ? '✓ TUM HEDEFLER DOGRULANDI' : `⚠ ${hatali}/${liste.length} hedef basarisiz`);
  process.exit(hatali === 0 ? 0 : 1);
})();
