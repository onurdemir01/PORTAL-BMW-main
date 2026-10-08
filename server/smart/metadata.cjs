// server/smart/metadata.cjs — Smart metadata sablonu: YAML ayristirma + nunjucks render.
//
// NEDEN AYRI MODUL (2026-10-08): isleyici runner.cjs icinde bir fonksiyonun ICINDE tanimliydi;
// OpsX'in production Smart onayi onu CAGIRAMADI ve kendi sabit nesnesini gonderdi
// ({islem, platform, uretimSebebi, ...}). Bu adlar hicbir Smart flow'unun ElementName'iyle
// eslesmedigi icin bilet acilamazdi; OpsX Smart penceresindeki sablon kaydediliyor, Onizle
// dogru gosteriyor ama GERCEK talepte KULLANILMIYORDU. Artik Self Servis ve OpsX AYNI kodu
// kullanir (bkz. smartMetadata.tsx dosya basi: kopyalar zamanla sessizce ayrisir).
'use strict';

// ── Simple YAML key:value parser (extra_vars fallback icin, frontend AnsiblePage.tsx
// ile ayni mantik — AWX Survey tanimli olmayan template'lerin extra_vars default'larini
// self-service akisinda da gostermek icin kullanilir) ─────────────────────────
// COK SATIRLI DEGER (2026-09-18, kullanici: Smart ACIKLAMA'si satir satir gorunsun):
// YAML blok skaleri desteklenir - `ALAN: |` (ya da `|-`) satirinin altindaki GIRINTILI
// satirlar, ortak girinti atilarak '\n' ile birlestirilir; ilk girintisiz satirda biter.
// Tek satirli anahtar: deger davranisi birebir korunur (AWX extra_vars da buradan gecer).
function parseSimpleYaml(src) {
  const out = {};
  const lines = String(src || '').split('\n');
  for (let li = 0; li < lines.length; li++) {
    const t = lines[li].trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf(':');
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (key && (val === '|' || val === '|-')) {
      const block = [];
      while (li + 1 < lines.length && (/^[ \t]/.test(lines[li + 1]) || lines[li + 1].trim() === '')) {
        block.push(lines[li + 1]);
        li++;
      }
      while (block.length && block[block.length - 1].trim() === '') block.pop();
      const indents = block.filter((b) => b.trim()).map((b) => b.match(/^[ \t]*/)[0].length);
      const indent = indents.length ? Math.min(...indents) : 0;
      out[key] = block.map((b) => b.slice(indent).replace(/[ \t]+$/, '')).join('\n');
      continue;
    }
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

// Smart metadata alanlari nunjucks (Jinja2'nin JS portu - Ansible'daki AYNI {{ }} / {% if %}
// sozdizimi) ile render edilir. Kullanilabilir degiskenler:
//   username / email / templateName  -> oturumdan/servis tanimindan, HER launch'ta talebi
//                                        acan kisiye gore degisir
//   extraVars.ALAN_ADI               -> o SPESIFIK launch'ta kullanicinin survey'e
//                                        girdigi/sectigi DEGER (2026-08-20 eklendi)
// KOSULLU MANTIK (2026-08-20 eklendi, kullanici talebi): tek satirlik {% if %}...{% else %}
// ...{% endif %} desteklenir - orn. "Production ortaminda farkli mesaj/OCO iste" ihtiyaci.
// throwOnUndefined:true SADECE bir degisken GERCEKTEN CIKTIYA YAZILMAYA calisilirken
// (interpolasyon aninda) hata firlatir - {% if extraVars.env == "Production" %} gibi bir
// KARSILASTIRMADA kullanilan tanimsiz degisken hataya SEBEP OLMAZ (once test edildi), yani
// "extraVars.oco sadece Production dalinda kullaniliyor" gibi kosullu-opsiyonel alanlar
// guvenle yazilabilir. Render HATA verirse (gercekten kullanilan bir alan eksikse) artik
// Smart talebi hic ACILMAZ - onceki "literal {{...}} birak" davranisindan BILEREK
// degistirildi: kosullu mantik eklenince "yanlis dalin sessizce calismasi" ihtimali
// "gorunur ama bozuk metin" ihtimalinden daha tehlikeli hale geldi - launch NET bir
// hata mesajiyla durmasi, garip bir Smart talebinin acilmasindan daha guvenli.
const nunjucks = require('nunjucks');
const smartMetaEnv = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: true,
});

function buildSmartMetadata(
  metadataFieldsRaw,
  { username, email, templateName, templateId, extraVars, opsx },
) {
  if (!metadataFieldsRaw) {
    return { application: templateName || String(templateId), requestedBy: username };
  }
  const ctx = {
    username,
    email: email || '',
    templateName: templateName || String(templateId),
    extraVars: extraVars || {},
    // OpsX (2026-10-08): islem/platform/uygulama/sunucular gibi isin COZULMUS ozeti. Yalniz OpsX
    // verir; Self Servis'te tanimsizdir ({{opsx.x}} orada render hatasi verir - bilerek).
    ...(opsx && typeof opsx === 'object' ? { opsx } : {}),
  };
  const parsed = parseSimpleYaml(metadataFieldsRaw);
  const metadata = {};
  for (const [key, rawValue] of Object.entries(parsed)) {
    try {
      // Cok satirli deger (2026-09-18): `\n` kacisi gercek satir sonuna cevrilir; kosullu
      // ({% if %}) satirlar bos kalinca ardisik bos satirlar tek satira iner, uc bosluk atilir.
      metadata[key] = String(smartMetaEnv.renderString(rawValue, ctx))
        .replace(/\\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
    } catch (renderErr) {
      console.warn(
        `[SmartMetadata] "${key}" render hatasi - mevcut extraVars anahtarlari:`,
        JSON.stringify(Object.keys(ctx.extraVars)),
      );
      throw Object.assign(
        new Error(
          `Smart metadata alanı "${key}" oluşturulamadı: ${renderErr.message} ` +
            `(kullanılan bir {{...}}/{% %} ifadesi geçersiz ya da o dalda kullanılan bir ` +
            `değişken bu launch'ta boş — alanın değerini kontrol edin: "${rawValue}")`,
        ),
        { status: 400 },
      );
    }
  }
  // TESHIS EVET, DEGER HAYIR (2026-08-28): bu log 2026-08-20'de "eslesme dogru mu"
  // sorusunu Smart tarafina bakmadan cevaplamak icin eklendi ve o degeri koruyoruz —
  // ama `JSON.stringify(metadata)` render edilmis DEGERLERI de yaziyordu. Metadata
  // sablonu `{{extraVars.ALAN}}` ile herhangi bir survey alanini cekebiliyor; password
  // tipli bir alan eslendiginde parola duz metin stdout'a dusuyordu. DB yolunda ayni
  // veri `redactExtraVarsForHistory` ile maskeleniyor; log yolunda eksikti.
  // Artik yalnizca ANAHTAR + doldu/bos bilgisi yaziliyor: "hangi alan render edildi mi"
  // sorusu hala cevaplanabilir, degerin kendisi hicbir yere yazilmaz.
  const metadataShape = Object.fromEntries(
    Object.entries(metadata).map(([k, v]) => [
      k,
      String(v ?? '').length > 0 ? `<dolu:${String(v).length}>` : '<bos>',
    ]),
  );
  console.log(
    `[SmartMetadata] extraVars anahtarlari:`,
    JSON.stringify(Object.keys(ctx.extraVars)),
    `-> render edilen metadata (degerler maskeli):`,
    JSON.stringify(metadataShape),
  );
  return metadata;
}

module.exports = { parseSimpleYaml, buildSmartMetadata };
