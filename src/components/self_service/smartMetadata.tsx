// src/components/self_service/smartMetadata.tsx — Smart metadata esleme araclari.
//
// NEDEN AYRI DOSYA: bu uc parca (`buildMetadataTemplate`, `SmartFieldExtra`,
// `SmartFieldsTable`) FieldOverridesModal'in ICINDE yerel tanimlardi. OpsX'in kendi Smart
// yapilandirma penceresi de AYNI uc seye ihtiyac duyuyor ve ikinci bir kopya cikarmak, bu
// depoda tekrar tekrar yasanan sinifa girerdi: biri duzelince oteki sessizce eski kalir
// (bkz. server/ansible/change-gates.cjs dosya basi — Smart bileti acma blogu runner.cjs
// icinde UC KEZ kopyalanmisti ve uc kopya ince farklarla ayrilmisti).
//
// Smart alan listesinin KAYNAGI: GetMetaDataOperationalRequestByFlowName. Gonderilecek
// anahtar `ElementName` ile BIREBIR eslesmeli; sabit {application, requestedBy} govdesi
// hicbir gercek flow'un ElementName'iyle eslesmedigi icin Smart onu "400 Invalid Request"
// ile reddediyor.
import React, { useState } from 'react';

/** Smart'in bir flow icin dondurdugu tek alan kaydi (sema serbest — kasa degisebiliyor). */
export type SmartField = Record<string, unknown>;

/** Alan adini iki kasadan da okur (Smart bazen camelCase donduruyor). */
export function elementName(f: SmartField): string {
  return String(f.ElementName ?? f.elementName ?? '').trim();
}

// Smart'ın hemen hemen tüm RFF flow'larında tekrar eden bir ElementName seti var (KONU,
// ACIKLAMA, SERVERNAME, APPLICATIONURL, IMPORTANCE, ENVIRONMENT, OPERATION, ...) — bu
// yüzden "Alanları Getir" sonucundan GENEL, tekrar kullanılabilir bir Metadata Eşlemesi
// taslağı üretilebilir. TEXTBOX/EDITOR/ALERT gibi serbest metin tipleri için makul bir
// yer tutucu değer YAZILIR; PARAMETER_DROPDOWN/CONFIGURATION_SELECT_CMS gibi Smart'ta
// ÖNCEDEN TANIMLI bir seçenek/kayıt adı bekleyen tipler için değer TAHMİN EDİLMEZ (yanlış
// bir tahmin, boş bırakmaktan daha kötü bir "400 Invalid Request" yerine SESSİZCE yanlış
// bir talep açabilir) — bunun yerine satır "#" ile YORUMA alınır, admin gerçek Smart
// değerini yazıp yorumdan çıkarana kadar gönderilmez (parseSimpleYaml "#" satırlarını atlar).
export function buildMetadataTemplate(fields: SmartField[]): string {
  const lines: string[] = [];
  for (const f of fields) {
    const name = elementName(f);
    if (!name) continue;
    const type = String(f.ComponentType ?? f.componentType ?? '').toUpperCase();
    const requiredRaw = String(f.IsRequired ?? f.isRequired ?? '').toLowerCase();
    const isRequired = ['true', 'evet', '1', 'yes'].includes(requiredRaw);
    const needsRealValue = /DROPDOWN|SELECT|CMS/.test(type);
    const reqTag = isRequired ? 'ZORUNLU' : 'opsiyonel';

    if (needsRealValue) {
      lines.push(
        `# ${name}: <${reqTag} — Smart'ta tanımlı GERÇEK bir seçenek/kayıt adı YA DA {{extraVars.ALAN_ADI}} (survey'deki değişken adı) yazıp bu satırı yorumdan çıkarın>`,
      );
      continue;
    }

    let value = '';
    if (/KONU|SUBJECT|TITLE|ACIKLAMA_1|SHORTDEF/i.test(name)) value = '{{templateName}} talebi';
    else if (/^ACIKLAMA$|DESCRIPTION|EXPLAIN|DETAY/i.test(name))
      value = '{{username}} tarafından Portal üzerinden açıldı';
    else if (/URL/i.test(name)) value = '{{templateName}}';
    else if (/SERVER|HOST/i.test(name)) value = '{{templateName}}';
    else if (isRequired) value = '{{templateName}}';

    if (value) lines.push(`${name}: ${value}`);
    else lines.push(`# ${name}: <${reqTag} — uygun bir değer girin>`);
  }
  return lines.join('\n');
}

/** Smart alan kaydinin bilinen dort alan disindaki her seyi: secenek listeleri (dizi) satir satir,
 *  digerleri "ad: deger". Secenek nesnelerinde ad/deger/TechValue benzeri alanlar one cikarilir. */
export function SmartFieldExtra({ f }: { f: SmartField }) {
  const KNOWN = new Set(['ElementName', 'elementName', 'ComponentType', 'componentType', 'IsRequired', 'isRequired', 'DataType', 'dataType']);
  const rest = Object.entries(f).filter(([k, v]) => !KNOWN.has(k) && v !== null && v !== undefined && v !== '');
  const [open, setOpen] = useState(false);
  if (rest.length === 0) return <span className="text-[var(--text-muted)]">—</span>;
  const pick = (o: Record<string, unknown>) => {
    const keys = Object.keys(o);
    const label = keys.find((k) => /^(name|label|text|value|displayvalue|displayname|parametername|itemname)$/i.test(k));
    const tech = keys.find((k) => /tech|code|id$/i.test(k));
    return `${label ? String(o[label]) : JSON.stringify(o)}${tech && tech !== label ? ` [${tech}=${String(o[tech])}]` : ''}`;
  };
  return (
    <div className="text-[10px] space-y-0.5 max-w-[26rem]">
      {rest.map(([k, v]) => (
        <div key={k}>
          <span className="font-semibold">{k}:</span>{' '}
          {Array.isArray(v) ? (
            <span className="font-mono break-all">
              {(open ? v : v.slice(0, 6)).map((o, i) => (
                <span key={i} className="inline-block mr-1.5 px-1 rounded bg-[var(--bg-elevated)]">{o && typeof o === 'object' ? pick(o as Record<string, unknown>) : String(o)}</span>
              ))}
              {v.length > 6 && (
                <button type="button" onClick={() => setOpen(!open)} className="underline decoration-dotted text-[var(--accent)]">{open ? 'daha az' : `+${v.length - 6}`}</button>
              )}
            </span>
          ) : typeof v === 'object' ? (
            <span className="font-mono break-all">{JSON.stringify(v)}</span>
          ) : (
            <span className="font-mono break-all">{String(v)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** "Alanlari Getir" sonucunun tablosu. Ilk sutun GONDERILECEK ANAHTARdir (ElementName). */
export function SmartFieldsTable({ fields }: { fields: SmartField[] }) {
  if (fields.length === 0) {
    return (
      <p className="text-[11px] text-[var(--text-muted)] p-2">
        Smart bu flow için hiçbir alan döndürmedi.
      </p>
    );
  }
  return (
    <table className="text-[11px] w-full">
      <thead>
        <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
          <th className="p-1.5">ElementName (gönderilecek "key" budur)</th>
          <th className="p-1.5">
            ComponentType (alan tipi — dropdown/select ise değer Smart'ta tanımlı bir seçenek
            olmalı)
          </th>
          <th className="p-1.5">Zorunlu</th>
          <th className="p-1.5">Tip</th>
          <th
            className="p-1.5"
            title="Smart'ın bu alan için döndürdüğü diğer her şey (seçenek listesi, TechValue, varsayılan…) — dropdown eşlemesi bunlardan yazılır"
          >
            Seçenekler / ayrıntı
          </th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f, i) => (
          <tr key={i} className="border-b border-[var(--border)] last:border-0 align-top">
            <td className="p-1.5 font-mono">{elementName(f) || '-'}</td>
            <td className="p-1.5 font-mono">
              {String(f.ComponentType ?? f.componentType ?? '-')}
            </td>
            <td className="p-1.5">{String(f.IsRequired ?? f.isRequired ?? '-')}</td>
            <td className="p-1.5">{String(f.DataType ?? f.dataType ?? '-')}</td>
            <td className="p-1.5">
              {/* Dropdown alanlarinda "Belirtilmemis" gelmesinin sebebi (2026-09-18): Smart
                  GERCEK secenek adini / TechValue'yu bekler; o ad ancak bu ayrintida gorunur. */}
              <SmartFieldExtra f={f} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
