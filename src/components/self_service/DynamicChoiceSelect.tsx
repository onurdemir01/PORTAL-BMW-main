// src/components/self_service/DynamicChoiceSelect.tsx — VERİTABANINDAN beslenen seçim kutusu.
//
// NEDEN VAR (2026-09-15): rate_limit_change'de `chosen_api` serbest metindi; kullanıcı
// "/x/y/v0/" yazdı, sunucudaki zone "/x/y/v0" idi ve iş durdu. Alan bir seçenek
// kaynağına bağlıysa (SurveyField.choicesSource) seçenekler /ss/choices/:source'tan
// gelir, serbest metin GİRİLEMEZ. Bağımlı alan (ör. env) değişince liste yeniden
// çekilir; eski değer yeni listede yoksa temizlenir ki geçersiz bir değer sessizce
// gönderilmesin (sunucu zaten reddeder, ama kullanıcı bunu formda görmeli).
import React, { useEffect, useMemo, useState } from 'react';
import { ansibleApi, type ChoicesSource, type DynamicChoice } from '@/api/ansibleApi';
import { Select, TextInput } from '@/components/ui/Form';

interface Props {
  id: string;
  source: ChoicesSource;
  /** Formdaki tüm değerler — kaynak parametreleri buradan okunur. */
  values: Record<string, string>;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: boolean;
}

/** Kaynak parametrelerini form değerlerinden kurar (sunucudaki paramsFromValues ile aynı). */
export function paramsFor(source: ChoicesSource, values: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [param, fieldName] of Object.entries(source.params || {})) {
    out[param] = String(values[fieldName] ?? '').trim();
  }
  for (const [k, v] of Object.entries(source.options || {})) {
    if (String(v ?? '').trim()) out[k] = String(v).trim();
  }
  return out;
}

export default function DynamicChoiceSelect({ id, source, values, value, onChange, onBlur, error }: Props) {
  const params = paramsFor(source, values);
  const paramsKey = JSON.stringify(params);
  const optional = new Set(source.optional || []);
  const bound = new Set(Object.keys(source.params || {}));
  const missingParam = Object.entries(params).some(([k, v]) => bound.has(k) && !v && !optional.has(k));
  const [choices, setChoices] = useState<DynamicChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (missingParam) {
      setChoices([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr('');
    ansibleApi
      .choices(source.source, params)
      .then((r) => {
        if (!alive) return;
        if (!r.ok) {
          setErr(r.message || 'Seçenekler yüklenemedi.');
          setChoices([]);
          return;
        }
        setChoices(r.choices || []);
        // Bağımlı alan değişti ve eski seçim yeni listede yok -> temizle.
        if (value && !(r.choices || []).some((c) => c.value === value)) onChange('');
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : String(e));
        setChoices([]);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.source, paramsKey, missingParam]);

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? choices.filter((c) => c.label.toLowerCase().includes(f) || c.value.toLowerCase().includes(f)) : choices;
    const m = new Map<string, DynamicChoice[]>();
    for (const c of list) {
      const g = c.group || '';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(c);
    }
    return [...m.entries()];
  }, [choices, filter]);

  const missingNames = Object.entries(source.params || {})
    .filter(([p]) => !params[p] && !optional.has(p))
    .map(([, fieldName]) => fieldName);

  return (
    <div className="space-y-1.5">
      {choices.length > 12 && (
        <TextInput
          value={filter}
          placeholder="Listede ara…"
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Seçeneklerde ara"
        />
      )}
      <Select
        id={id}
        error={error}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        disabled={missingParam || loading}
      >
        <option value="">
          {missingParam
            ? `Önce ${missingNames.join(', ')} seçin…`
            : loading
              ? 'Yükleniyor…'
              : choices.length === 0
                ? 'Envanterde kayıt yok'
                : `Seçin… (${choices.length})`}
        </option>
        {/* Seçili değer filtre dışında kalsa bile listede kalsın; yoksa <select> onu boşa çeker. */}
        {value && !groups.some(([, cs]) => cs.some((c) => c.value === value)) && (
          <option value={value}>{value}</option>
        )}
        {groups.map(([g, cs]) =>
          g ? (
            <optgroup key={g} label={g}>
              {cs.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          ) : (
            cs.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))
          ),
        )}
      </Select>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {!err && !missingParam && !loading && choices.length === 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          Bu ortam için envanterde kayıt bulunamadı — envanter taraması güncel değilse listeyi
          yöneticiye bildirin.
        </p>
      )}
    </div>
  );
}
