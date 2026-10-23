// server/__tests__/node-ca.test.cjs — resmi Node ikilisi kurumsal CA'yi tanir (2026-10-23).
//
// Uretim: install-node.sh ile Node 22.23.4'e (nodejs.org ikilisi) gecince tum girisler "Kimlik dogrulama
// sunucusuna su an ulasilamiyor" verdi. RHEL nodejs RPM'i sistemin sertifika deposunu (kurumsal CA dahil)
// kullaniyordu; resmi ikili yalniz gomulu kok listesine guvenir - LDAPS servis hesabi bind'i TLS'te dustu
// (ldap.cjs bunu ag hatasi sayar). NODE_EXTRA_CA_CERTS surec ACILISINDA okunur; .env ile verilemez.
//   NC1 run.sh / release-git.sh / release.sh sistem deposunu node'dan ONCE ekler; disaridan verileni ezmez
//   NC2 systemd birimi de ekler
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const oku = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
const kod = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const SATIR = 'if [[ -z "${NODE_EXTRA_CA_CERTS:-}" && -r "$SISTEM_CA" ]]; then export NODE_EXTRA_CA_CERTS="$SISTEM_CA"; fi';

test('NC1 betikler sistem CA deposunu node dan ONCE ekler, disaridan verileni ezmez', () => {
  for (const [dosya, ilkNode] of [['deploy/run.sh', 'nohup $SETSID_BIN node'], ['deploy/release-git.sh', 'npm ci'], ['deploy/release.sh', 'npm ci']]) {
    const k = kod(oku(dosya));
    assert.match(k, /SISTEM_CA="\/etc\/pki\/tls\/certs\/ca-bundle\.crt"/, `${dosya}: sistem deposu yolu yok`);
    const i = k.indexOf(SATIR);
    assert.ok(i >= 0, `${dosya}: NODE_EXTRA_CA_CERTS sistem deposuyla ayarlanmiyor`);
    const j = k.indexOf(ilkNode);
    assert.ok(j > i, `${dosya}: ayar ilk '${ilkNode}' cagrisindan once degil`);
  }
});

test('NC2 systemd birimi sistem CA deposunu ekler', () => {
  assert.match(oku('deploy/bmw-portal@.service'), /^Environment=NODE_EXTRA_CA_CERTS=\/etc\/pki\/tls\/certs\/ca-bundle\.crt$/m);
});
