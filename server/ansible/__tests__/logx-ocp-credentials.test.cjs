// server/ansible/__tests__/logx-ocp-credentials.test.cjs — LogX OCP kimlik zinciri.
//
// URETIM ARIZASI (AWX #3296360, #3296365, #3296411 — 2026-09-06): LogX'in OCP tarafi
// tamamen calismaz haldeydi; namespace taramasi, uygulama kesfi ve log indirme, ucu de
// su duvari basiyordu:
//
//   Error in configuration: Missing or incomplete configuration info.
//   Please login or point to an existing, complete config file ... ~/.kube/config
//
// Bu mesaj GERCEK HATANIN IKI ADIM SONRASININ belirtisiydi. Zincir soyleydi:
//
//   1. `vars_files` yolu `../../bmw_openshift_jobs/.../credentials.yaml` idi, yani
//      playbook'un AWX reposunda IKI seviye derinde durdugunu varsayiyordu.
//      Playbook `bmw_portal/logx/ocp/` altina (UC seviye) tasininca dosya bulunamadi.
//   2. Ansible bunu HATA SAYMADI — sessizce devam etti (yerel olarak olculdu:
//      eski kod uc seviyede `PAROLA=[]` donuyor, hicbir hata vermiyor).
//   3. `cluster_exists` kapisi kullanici adina bakiyor ama PAROLAYA BAKMIYORDU;
//      bos parolali cluster "gecerli" sayilip ise girdi.
//   4. `oc login ... >/dev/null` hatayi yuttu ve `set -e` olmadigi icin akis surdu.
//   5. Sonraki `oc get` cagrisi kubeconfig'ten sikayet etti — kullanici da yapacak
//      hicbir seyin olmadigi `~/.kube/config`'e yonlendirildi.
//
// Hangi modulun ayakta kaldigi teshisi birebir dogruluyordu: `telnet_openshift/` ve
// `opsx_openshift_dump/` (iki seviye) calisiyor, `logx/ocp/` (uc seviye) kirilmisti.
//
// Bu bekci zincirin BES halkasini birden kilitler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PB = path.join(__dirname, '..', 'playbooks');
const FILES = [
  'logx_ocp_namespace_discovery.yml',
  'logx_ocp_app_discovery.yml',
  'logx_ocp_discover_fetch.yml',
];
const read = (f) => fs.readFileSync(path.join(PB, f), 'utf8');

// Bosluklari tekilleyip tek satira indirger: YAML girintisi ya da satir sarmasi
// degisince bekci kirmiziya donmesin. Olcut BICIM degil KURAL.
const flat = (s) => s.replace(/\s+/g, ' ');

// YAML yorumlarini atar.
//
// GEREKLI: bu bekci ilk yazildiginda C2 kirmizi dondu — cunku duzeltmenin KENDI
// yorumunda "`errors='ignore'` BILEREK YOK" cumlesi geciyordu ve bekci kendi
// aciklamasini KOD sanip esledi. (bkz. bekci korlugu deseni: "bekci kendi
// yorumunu esler".) Olcut artik yalnizca CALISAN metin.
const codeOnly = (s) =>
  s
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');

// `vars_files` blogunu cikarir: `vars_files:` ile bir sonraki ayni-girintili
// anahtar (`vars:`, `tasks:`, `pre_tasks:` ...) arasi.
//
// SATIR TABANLI, BILEREK: ilk denemede `^(\s*)vars_files:\s*$/m` kullandim ve `\s`
// SATIR SONUNU DA esledigi icin blok yanlis yerden basladi — bekci, kimlik
// aramasini hic gormeden "yok" dedi. Girinti karsilastirmasi karakter sayarak
// yapilir; regex'e birakilmaz.
function varsFilesBlock(src) {
  const lines = src.split('\n');
  const at = lines.findIndex((l) => /^[ \t]*vars_files:[ \t]*$/.test(l));
  if (at === -1) return '';
  const indent = lines[at].length - lines[at].trimStart().length;
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      out.push(line);
      continue;
    }
    const ind = line.length - line.trimStart().length;
    // Ayni ya da daha az girintili bir ANAHTAR blogu bitirir (`vars:`, `tasks:` ...).
    if (ind <= indent) break;
    out.push(line);
  }
  return out.join('\n');
}

test('C1 kimlik dosyasi EN AZ UC derinlikte aranir (playbook tasinsa da bulunur)', () => {
  for (const f of FILES) {
    const block = flat(varsFilesBlock(read(f)));
    assert.match(
      block,
      /first_found/,
      `${f}: kimlik dosyasi sabit bir yolla araniyor — playbook tasininca SESSIZCE bos parola doner`,
    );
    const depths = (block.match(/credentials\.yaml/g) || []).length;
    assert.ok(
      depths >= 3,
      `${f}: credentials.yaml yalnizca ${depths} derinlikte araniyor; ` +
        'en az 3 olmali (bmw_portal/<mod>/, bmw_portal/<mod>/<alt>/, kok).',
    );
    // Yollar `playbook_dir`e gore olmali: Ansible'in goreli yol cozumu calisma
    // dizinine gore degisebiliyor; `playbook_dir` dosyanin KENDI yerine sabitlenir.
    assert.match(
      block,
      /playbook_dir[^]*credentials\.yaml/,
      `${f}: kimlik yollari playbook_dir'e gore kurulmamis`,
    );
  }
});

test('C2 kimlik dosyasi bulunamazsa is ACIK BIR MESAJLA DURUR', () => {
  // TASARIM NOTU: `vars_files` lookup'inin SERT patlamasi birakilmisti; o zaman bu
  // uc playbook yerel olarak HIC `--syntax-check` edilemiyordu (kimlik dosyasi repo
  // disinda yasiyor). Kontrol acik bir `assert` gorevine tasindi — hem mesaj daha
  // acik (denenen yollar tek tek yazilir) hem playbook dogrulanabilir kaldi.
  //
  // Olcut bu yuzden "errors='ignore' yok mu" DEGIL: "bulunamayinca DURUYOR mu".
  for (const f of FILES) {
    const src = read(f);
    const code = codeOnly(src);

    // 1) Kapi GERCEKTEN VAR ve fail-closed.
    assert.match(
      code,
      /ansible\.builtin\.assert:/,
      `${f}: kimlik dosyasi icin bir kapi yok — dosya yoksa is bos parolayla ilerler`,
    );
    const gate = code.slice(code.indexOf('Kimlik dosyasi bulundu mu'));
    assert.ok(gate.length > 0, `${f}: kimlik kapisi gorevi bulunamadi`);
    assert.match(
      gate.slice(0, 1600),
      /logx_credentials_file \| length > 0/,
      `${f}: kapi dosyanin bulundugunu DOGRULAMIYOR`,
    );

    // 2) Mesaj denenen yollari SOYLUYOR. "Bulunamadi" demek yetmez; kullanici
    //    hangi derinliklerin denendigini gormeden yeri duzeltemez.
    //
    // BU KONTROL BIR KEZ KORDU: `fail_msg:[\s\S]{0,400}logx_credentials_candidates`
    // yaziyordu ve pencere `vars:` blogundaki TANIMA tasiyordu — mesajdan yollari
    // silmek bekciyi yesil birakiyordu. Artik yalnizca fail_msg'in KENDI DEGERI
    // okunur (bir sonraki ayni girintili anahtara kadar).
    const failMsg = (() => {
      const lines = gate.split('\n');
      const at = lines.findIndex((l) => /^\s*fail_msg:/.test(l));
      if (at === -1) return '';
      const ind = lines[at].length - lines[at].trimStart().length;
      const out = [lines[at]];
      for (let i = at + 1; i < lines.length; i++) {
        if (lines[i].trim() === '') break;
        const cur = lines[i].length - lines[i].trimStart().length;
        if (cur <= ind) break;
        out.push(lines[i]);
      }
      return out.join('\n');
    })();
    assert.match(
      failMsg,
      /logx_credentials_candidates/,
      `${f}: hata mesaji denenen yollari yazmiyor — kullanici yeri duzeltemez`,
    );

    // 3) Kapi HER SEYDEN ONCE calismali: bastion'a dokunmadan, hatta girdi
    //    dogrulamasindan bile once. Aksi halde is yarida patlar ve sebep kaybolur.
    const tasksAt = code.indexOf('  tasks:');
    const gateAt = code.indexOf('Kimlik dosyasi bulundu mu');
    const otherTask = code.indexOf('- name:', tasksAt);
    assert.ok(
      gateAt > 0 && gateAt < code.indexOf('- name:', otherTask + 10),
      `${f}: kimlik kapisi ilk gorev degil`,
    );

    // 4) Opsiyonel envanter dosyasi HALA opsiyonel (geriye uyum kirilmasin).
    const block = codeOnly(varsFilesBlock(src));
    const invIdx = block.indexOf('openshift_inventory_vars.yaml');
    if (invIdx >= 0) {
      assert.match(
        flat(block.slice(invIdx)),
        /errors\s*=\s*'ignore'/,
        `${f}: opsiyonel envanter dosyasi zorunlu hale gelmis — eski cagrilar kirilir`,
      );
    }
  }
});

test('C3 `cluster_exists` kapisi PAROLAYA da bakar', () => {
  for (const f of FILES) {
    const src = read(f);
    // Ifadenin TAMAMI cikarilir. "Dosyada resolved_password geciyor mu" demek
    // YETMEZDI: o degisken zaten `vars:` blogunda TANIMLI. Olcut, kapinin
    // KARAR ifadesinde kullanilmasi.
    const blocks = [...src.matchAll(/cluster_exists:\s*>-\s*\n([\s\S]*?)\n\s*\}\}/g)];
    assert.ok(blocks.length >= 2, `${f}: cluster_exists ${blocks.length} yerde (>=2 bekleniyor)`);
    for (const b of blocks) {
      const expr = flat(b[1]);
      assert.match(
        expr,
        /resolved_password \| trim \| length > 0/,
        `${f}: kapi parolaya bakmiyor — bos parolali cluster ise giriyor ve ` +
          '`oc login` iki adim sonra yaniltici bir kubeconfig hatasi uretiyor',
      );
      // Kullanici adi kontrolu de KAYBOLMAMALI (eski kapi geri gelmesin diye).
      assert.match(
        expr,
        /resolved_username \| trim \| length > 0/,
        `${f}: kullanici adi kapisi dusmus`,
      );
    }
  }
});

test('C4 `oc login` hatasi YUTULMAZ (stderr yakalanir, akis durur)', () => {
  for (const f of FILES) {
    const src = read(f);
    const logins = [...src.matchAll(/"\{\{ oc_bin \}\}" login[\s\S]{0,400}?\n\n/g)];
    assert.ok(logins.length >= 1, `${f}: oc login cagrisi bulunamadi`);
    for (const l of logins) {
      const snippet = flat(l[0]);
      // stdout hala bastirilabilir (token sizmasin) AMA stderr yakalanmali.
      assert.match(
        snippet,
        /2>&1 >\/dev\/null/,
        `${f}: login hatasi yutuluyor — kullanici gercek sebebi ("401 Unauthorized" gibi) goremez`,
      );
      assert.match(snippet, /LOGIN_FAILED/, `${f}: login hatasi raporlanmiyor`);
      assert.match(
        snippet,
        /exit 1/,
        `${f}: login patlayinca akis DURMUYOR — sonraki oc cagrisi yaniltici hata uretir`,
      );
    }
  }
});

test('C5 parola sizintisi kapisi acilmadi (no_log korunuyor)', () => {
  // Hata metnini stderr'den okumak, parolayi log'a dusurmenin bahanesi olamaz.
  // Bu gorevlerdeki `no_log: true` sayisi AZALMAMALI.
  const EXPECTED_MIN = {
    'logx_ocp_namespace_discovery.yml': 4,
    'logx_ocp_app_discovery.yml': 4,
    'logx_ocp_discover_fetch.yml': 6,
  };
  for (const f of FILES) {
    const n = (read(f).match(/no_log:\s*true/g) || []).length;
    assert.ok(
      n >= EXPECTED_MIN[f],
      `${f}: no_log sayisi ${n}, en az ${EXPECTED_MIN[f]} olmali — parola log'a dusebilir`,
    );
  }
});
