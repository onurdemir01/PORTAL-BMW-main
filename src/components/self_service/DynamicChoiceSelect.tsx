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
import { TextInput } from '@/components/ui/Form';

interface Props {
  id: string;
  source: ChoicesSource;
  /** Formdaki tüm değerler — kaynak parametreleri buradan okunur. */
  values: Record<string, string>;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: boolean;
  /** Çoklu seçim: onay kutuları; değer satır sonu ile birleştirilir (sunucu listeye çevirir). */
  multiple?: boolean;
}

export const MULTI_SEP = '\n';
export function splitMulti(v: string): string[] {
  return String(v || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
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

export default function DynamicChoiceSelect({ id, source, values, value, onChange, onBlur, error, multiple = false }: Props) {
  const params = paramsFor(source, values);
  const paramsKey = JSON.stringify(params);
  const optional = new Set(source.optional || []);
  const bound = new Set(Object.keys(source.params || {}));
  const missingParam = Object.entries(params).some(([k, v]) => bound.has(k) && !v && !optional.has(k));
  const [choices, setChoices] = useState<DynamicChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');
  // tekli secim combobox'inin acik/kapali durumu (hook sirasi: erken donuslerden ONCE)
  const [open, setOpen] = useState(false);

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
        // Bağımlı alan değişti ve eski seçim yeni listede yok -> temizle (çokluda: yalnız listede olmayanlar düşer).
        if (multiple) {
          const keep = splitMulti(value).filter((v) => (r.choices || []).some((c) => c.value === v));
          if (keep.length !== splitMulti(value).length) onChange(keep.join(MULTI_SEP));
        } else if (value && !(r.choices || []).some((c) => c.value === value)) onChange('');
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

  if (multiple) {
    const picked = new Set(splitMulti(value));
    const toggle = (v: string) => {
      const next = new Set(picked);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      onChange(choices.filter((c) => next.has(c.value)).map((c) => c.value).join(MULTI_SEP));
    };
    const visible = groups.flatMap(([, cs]) => cs);
    return (
      <div className={`space-y-1.5 rounded-lg border p-2 ${error ? 'border-red-400' : 'border-[var(--border)]'}`} id={id} onBlur={onBlur}>
        <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
          <span>
            {missingParam ? `Önce ${missingNames.join(', ')} seçin…` : loading ? 'Yükleniyor…' : `${picked.size} / ${choices.length} seçili`}
          </span>
          {choices.length > 0 && (
            <span className="flex gap-2">
              <button type="button" className="underline decoration-dotted" onClick={() => onChange(visible.map((c) => c.value).join(MULTI_SEP))}>
                {filter ? 'görünenlerin tümü' : 'tümü'}
              </button>
              <button type="button" className="underline decoration-dotted" onClick={() => onChange('')}>
                hiçbiri
              </button>
            </span>
          )}
        </div>
        {choices.length > 8 && (
          <TextInput value={filter} placeholder="Listede ara…" onChange={(e) => setFilter(e.target.value)} aria-label="Seçeneklerde ara" />
        )}
        <div className="max-h-72 overflow-y-auto space-y-0.5">
          {groups.map(([g, cs]) => (
            <div key={g || '_'}>
              {g && <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mt-1">{g}</div>}
              {cs.map((c) => (
                <label key={c.value} className="flex items-center gap-2 text-[12px] cursor-pointer py-0.5" title={c.label}>
                  <input type="checkbox" checked={picked.has(c.value)} onChange={() => toggle(c.value)} />
                  <span className="font-mono whitespace-nowrap overflow-hidden text-ellipsis">{c.label}</span>
                </label>
              ))}
            </div>
          ))}
          {!loading && !missingParam && choices.length === 0 && (
            <div className="text-[11px] text-[var(--text-muted)]">Envanterde kayıt yok.</div>
          )}
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
    );
  }

  // TEKLI SECIM = COMBOBOX (kullanici, 2026-09-16): "arama kutusuna yazinca liste
  // kendiliginden acilmiyor, tiklamak gerekiyor; kullanici sorgunun calistigini anlamiyor".
  // Yerel <select> arama sonucunu gostermez; simdi yazdikca eslesenler HEMEN altta listelenir,
  // tiklayinca (ya da Enter ile ilk eslesen) secilir, secim rozet olarak gorunur.
  const selected = choices.find((c) => c.value === value) || (value ? { value, label: value } : null);
  const visible = groups.flatMap(([g, cs]) => cs.map((c) => ({ ...c, g })));
  const showList = !missingParam && !loading && (open || (!selected && filter.trim().length > 0));
  const pick = (v: string) => {
    onChange(v);
    setFilter('');
    setOpen(false);
  };
  return (
    <div className="space-y-1.5" id={id} onBlur={onBlur}>
      {selected && !open ? (
        <div className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] ${error ? 'border-red-400' : 'border-[var(--border)]'} bg-[var(--bg-surface)]`}>
          <span className="font-mono truncate" title={selected.label}>{selected.label}</span>
          <span className="flex gap-2 shrink-0">
            <button type="button" className="text-[11px] underline decoration-dotted text-[var(--text-muted)]" onClick={() => setOpen(true)}>
              değiştir
            </button>
            <button type="button" className="text-[11px] text-[var(--text-muted)]" aria-label="Seçimi temizle" onClick={() => onChange('')}>
              ✕
            </button>
          </span>
        </div>
      ) : (
        <TextInput
          value={filter}
          error={error}
          disabled={missingParam || loading}
          placeholder={
            missingParam
              ? `Önce ${missingNames.join(', ')} seçin…`
              : loading
                ? 'Yükleniyor…'
                : choices.length === 0
                  ? 'Envanterde kayıt yok'
                  : `Ara ve seç… (${choices.length} kayıt)`
          }
          onChange={(e) => {
            setFilter(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && visible.length > 0) {
              e.preventDefault();
              pick(visible[0].value);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          aria-label="Ara ve seç"
          autoComplete="off"
        />
      )}
      {showList && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] max-h-72 overflow-y-auto" role="listbox">
          <div className="px-2 py-1 text-[10px] text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
            {filter.trim() ? `${visible.length} / ${choices.length} eşleşme` : `${choices.length} kayıt — yazarak daraltın`}
            {selected && (
              <button type="button" className="ml-2 underline decoration-dotted" onClick={() => setOpen(false)}>
                vazgeç
              </button>
            )}
          </div>
          {visible.length === 0 && <div className="px-2 py-2 text-[12px] text-[var(--text-muted)]">Eşleşen kayıt yok.</div>}
          {groups.map(([g, cs]) => (
            <div key={g || '_'}>
              {g && <div className="px-2 pt-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{g}</div>}
              {cs.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  role="option"
                  aria-selected={c.value === value}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c.value)}
                  className={`block w-full text-left px-2 py-1 text-[12px] font-mono whitespace-nowrap overflow-hidden text-ellipsis hover:bg-[var(--bg-elevated)] ${c.value === value ? 'bg-[var(--bg-elevated)] font-semibold' : ''}`}
                  title={c.label}
                >
                  {c.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
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
