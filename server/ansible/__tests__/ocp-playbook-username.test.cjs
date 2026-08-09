// server/ansible/__tests__/ocp-playbook-username.test.cjs
//
// GERCEK HATA (2026-08-09, uretim): uc LogX OCP playbook'u da
// `oc login --username={{ username | quote }}` yaziyordu. `username` degiskeni YALNIZCA
// AWX'teki `bmw_openshift_jobs/global_variables/openshift_inventory_vars.yaml` icinde
// tanimliydi; o dosya AWX projesinde YOK ve `first_found ... errors='ignore'` ile
// sessizce atlaniyordu. Sonuc: her bastion "'username' is undefined" ile rescue'ya dustu,
// UC CLUSTER'IN UCU DE `status: error` dondu, kullanici bos bir namespace ekrani gordu.
//
// Bu testler sozlesmeyi kilitler: kullanici adi PORTALDAN gelir (cluster satiri veya
// genel varsayilan) ve playbook cozulmus degeri kullanir — cikplak `{{ username }}` bir
// daha `oc login` satirina girmemeli.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'playbooks');
const OCP_PLAYBOOKS = [
  'logx_ocp_namespace_discovery.yml',
  'logx_ocp_discover_fetch.yml',
  'logx_ocp_app_discovery.yml',
];

function read(file) {
  return fs.readFileSync(path.join(DIR, file), 'utf8');
}

for (const file of OCP_PLAYBOOKS) {
  test(`${file}: oc login CIPLAK {{ username }} kullanmaz`, () => {
    const loginArgs = read(file).split('\n').filter((l) => /--username=/.test(l));
    assert.ok(loginArgs.length > 0, 'playbook oc login yapmali');
    for (const line of loginArgs) {
      // Cozulmus deger bir loop degiskeninden gelmeli (cluster. / unit. / target.).
      assert.match(
        line,
        /--username=\{\{\s*(cluster|unit|target)\.username\s*\|\s*quote\s*\}\}/,
        `AWX inventory dosyasina bagimli ciplak degisken: ${line.trim()}`
      );
    }
  });

  test(`${file}: kullanici adi portaldan cozulur (cluster > ocp_username > eski username)`, () => {
    const text = read(file);
    assert.ok(text.includes('resolved_username'), 'resolved_username tanimlanmali');
    // Oncelik sirasi: cluster satiri, sonra portalin genel varsayilani, en son eski
    // inventory degiskeni. Sira bozulursa admin\'in cluster\'a ozel girdigi deger ezilirdi.
    const order = /item\.username[\s\S]{0,120}?ocp_username[\s\S]{0,120}?username \| default/;
    assert.match(text, order, 'oncelik sirasi cluster → genel varsayilan → eski degisken olmali');
  });

  test(`${file}: kullanici adi bossa cluster ELENIR (tum bastion dusmez)`, () => {
    // cluster_exists kosuluna girmezse cozulmemis deger `oc login`e gider ve Jinja
    // tum bastion'i rescue'ya dusururdu — uretimdeki tam davranis buydu.
    assert.match(
      read(file),
      /cluster_exists:[\s\S]{0,400}?resolved_username \| trim \| length > 0/,
      'cluster_exists kullanici adini kontrol etmeli'
    );
  });

  test(`${file}: portal metadata'si (api_url + credential_key + username) belgelenmis`, () => {
    const header = read(file).split('\n').filter((l) => l.startsWith('#')).join('\n');
    assert.match(header, /username/, 'baslikta username alani gecmeli');
    assert.match(header, /ASIL KAYNAK PORTALDIR|api_url/, 'portal metadata sozlesmesi belgelenmeli');
  });
}

test('overall_status bastan/sondan bosluk BIRAKMAZ ({% set %} sizintisi)', () => {
  // Uretimde `"      failed"` yayinlandi: katlamali skalerde `{% set %}` satirlari
  // ciktiya bosluk sizdiriyor. Portal bu alani es-esitlikle karsilastiriyor.
  for (const file of OCP_PLAYBOOKS) {
    const text = read(file);
    const idx = text.indexOf('overall_status:');
    assert.ok(idx > 0, `${file}: overall_status yayinlanmali`);
    const block = text.slice(idx, idx + 1200);
    if (!block.includes('{% set ')) continue;   // tek satirlik ifade — sizinti yok
    assert.match(block, /\|\s*trim/, `${file}: {% set %} kullanan blok | trim ile bitmeli`);
  }
});

// ── Jinja apostrof tuzagi (2026-08-09 uretim arizasi #2) ─────────────────────
// Hata mesajina eklenen `Ayarlari\'nda` ifadesi, TEK TIRNAKLI bir Jinja string'i
// icinde ters-boluyle kacirilmis apostrof tasiyordu. AWX'teki ansible-core 2.16.11 /
// jinja 3.1.4 bunu YAML gibi yorumlamadi: string apostrofta bitti, kalan `nda`
// sozdizimi sanildi ve UC PLAYBOOK DA uretimde su hatayla dustu:
//   template error while templating string: expected token ')', got 'nda'
//
// NEDEN GREP TESTI: bu sinif `ansible-playbook --syntax-check`ten GECER (YAML
// gecerlidir, ifade ancak calisma aninda derlenir) ve davranis ansible/jinja
// SURUMUNE gore degisir — yerelde daha yeni bir surumde sessizce calisabilir.
// Tek guvenli kural: bu playbook'larda kacirilmis apostrof HIC kullanilmasin;
// apostrof gereken metin CIFT TIRNAKLI string icine yazilsin.

test('OCP playbook\'larinda kacirilmis apostrof (\\\') YOK', () => {
  for (const file of OCP_PLAYBOOKS) {
    const bad = read(file).split('\n')
      .map((line, i) => ({ line, no: i + 1 }))
      .filter(({ line }) => line.includes("\\'"));
    assert.deepEqual(
      bad.map((b) => `${file}:${b.no}: ${b.line.trim()}`),
      [],
      'apostrof iceren metin cift tirnakli string icine alinmali'
    );
  }
});

test('hata mesajindaki apostrof CIFT TIRNAKLI string icinde', () => {
  // Mesajin kendisi hala uretiliyor mu (fix sirasinda silinmedigini kilitler).
  for (const file of OCP_PLAYBOOKS) {
    assert.match(
      read(file),
      /~ "alanini doldurun ya da OCP Calistirma Ayarlari'nda genel varsayilani girin: "/,
      `${file}: kullanici adi hata mesaji cift tirnakli olarak durmali`
    );
  }
});

test('Jinja ifadelerinin ICINE `#` yorum satiri konmamis', () => {
  // `>-` katlamali skaler icinde `#` YAML yorumu DEGILDIR — ifadenin parcasi olur ve
  // Jinja'yi bozar. Aciklamalar gorevin USTUNE, gercek YAML yorumu olarak yazilmali.
  for (const file of OCP_PLAYBOOKS) {
    // Katlamali skaler, ANAHTARDAN daha derin girintili satirlar boyunca surer.
    // Sabit bir girinti esigi kullanmak ic ice bloklarda (vars: altindaki anahtarlar)
    // yanlis pozitif verirdi.
    let keyIndent = null;
    read(file).split('\n').forEach((line, i) => {
      const m = /^(\s*)\S.*:\s*>-\s*$/.exec(line);
      if (m) { keyIndent = m[1].length; return; }
      if (keyIndent === null) return;
      if (line.trim() === '') return;
      const indent = line.length - line.trimStart().length;
      if (indent <= keyIndent) { keyIndent = null; return; }
      assert.ok(!/^\s*#/.test(line), `${file}:${i + 1}: katlamali skaler icinde '#' yorum satiri`);
    });
  }
});
