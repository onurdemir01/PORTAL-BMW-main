// src/components/crypto_hub/ValuesEditor.tsx — values.yaml görüntüleme ve düzenleme
// çekirdeği (2026-09-26).
//
// Kullanıcı: "values.yaml'ı Portal üzerinden nasıl değiştirecekler? Upgrade denerken
// values'a dokunamıyorum gibi görünüyor."
//
// Doğruydu: upgrade akışındaki values adımı salt okunurdu ve düzenlemek için başka bir
// sekmeye gitmek gerekiyordu. Düzenleyici artık TEK bileşen; hem Sürümler sekmesindeki
// pencere hem de upgrade/rollout akışının values adımı bunu kullanıyor.
//
// KURALLAR (her iki kullanım yerinde de aynı):
//  * Varsayılan MASKELİ; gerçek değerler ayrı bir istektir ve denetim kaydına yazılır.
//  * Maskeli metin KAYDEDİLEMEZ — `****` yazmak gerçek parolayı silerdi.
//  * Yazmadan önce satır bazlı FARK gösterilir ve dosyanın yedeği alınır.
//  * Hedef dosya AÇIKÇA seçilir: hangi dosyaya yazıldığı hiçbir zaman örtük kalmaz.
import React, { useMemo, useState } from 'react';
import {
  EyeIcon, EyeSlashIcon, PencilSquareIcon, ArrowPathIcon, ExclamationTriangleIcon,
  DocumentCheckIcon, ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useOps, OpsConfirm, type OpsRequest } from './OpsPanel';
import { toast } from '@/hooks/useToast';

const SM = 'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
export const vbtn = (tone?: 'primary' | 'danger'): React.CSSProperties => {
  if (tone === 'primary') return { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-fg, #fff)' };
  if (tone === 'danger') return { borderColor: 'var(--status-danger)', background: 'var(--status-danger-bg)', color: 'var(--status-danger)' };
  return { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' };
};

/** Satır bazlı basit fark: eklenen / çıkarılan. Amaç "ne değişecek"i göstermek. */
export function diffLines(eski: string, yeni: string) {
  const a = eski.split('\n');
  const b = yeni.split('\n');
  const setA = new Map<string, number>();
  for (const l of a) setA.set(l, (setA.get(l) || 0) + 1);
  const setB = new Map<string, number>();
  for (const l of b) setB.set(l, (setB.get(l) || 0) + 1);
  const eklenen = b.filter((l) => {
    const n = setA.get(l) || 0;
    if (n > 0) { setA.set(l, n - 1); return false; }
    return l.trim().length > 0;
  });
  const cikarilan = a.filter((l) => {
    const n = setB.get(l) || 0;
    if (n > 0) { setB.set(l, n - 1); return false; }
    return l.trim().length > 0;
  });
  return { eklenen, cikarilan };
}

export interface ValuesFileOption { path: string; label: string }

export function ValuesEditor({ tenantKey, tenantLabel, release, files = [], compact = false, onSaved }: {
  tenantKey: string;
  tenantLabel: string;
  release: string;
  /** yazılabilecek values dosyaları (bastion arşivinden); boşsa ekran salt okunur kalır */
  files?: ValuesFileOption[];
  compact?: boolean;
  onSaved?: () => void;
}) {
  const { run, busy } = useOps(tenantKey);
  const [metin, setMetin] = useState<string | null>(null);
  const [maskeli, setMaskeli] = useState(true);
  const [hepsi, setHepsi] = useState(false);
  const [duzenle, setDuzenle] = useState(false);
  const [taslak, setTaslak] = useState('');
  const [hata, setHata] = useState('');
  const [hedef, setHedef] = useState(files[0]?.path || '');
  const [onay, setOnay] = useState<OpsRequest | null>(null);

  const getir = async (reveal: boolean, all = hepsi) => {
    setHata('');
    const r = await run({ action: 'values_get', targets: [], release, valuesAll: all, reveal });
    if (!r) return;
    if (r.errors?.length) { setHata(r.errors.map((e) => `${e.stage}: ${e.message}`).join(' · ')); return; }
    const t = (r.values || []).join('\n');
    setMetin(t);
    setMaskeli(r.masked !== false);
    if (reveal) setTaslak(t);
  };

  React.useEffect(() => { void getir(false); }, [tenantKey, release]); // eslint-disable-line react-hooks/exhaustive-deps

  const fark = useMemo(() => (duzenle && metin != null ? diffLines(metin, taslak) : null), [duzenle, metin, taslak]);
  const degisti = duzenle && metin != null && taslak !== metin;

  const kaydet = () => {
    if (!hedef) { toast.error('Hedef values dosyasını seçin.'); return; }
    if (/:\s*\*{4}\s*$/m.test(taslak)) {
      toast.error('İçerikte maskelenmiş (****) değer var — önce gerçek değerleri gösterin.');
      return;
    }
    setOnay({ action: 'values_put', targets: [], valuesPath: hedef, content: taslak });
  };

  const yaz = async () => {
    if (!onay) return;
    const r = await run(onay);
    setOnay(null);
    if (r && r.results.some((x) => x.ok)) {
      toast.success('values.yaml yazıldı (eski dosyanın yedeği alındı).');
      setDuzenle(false);
      void getir(false);
      onSaved?.();
    } else if (r) {
      toast.error(r.results.map((x) => x.message).join(' · ') || 'Yazılamadı.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!duzenle ? (
          <>
            <button type="button" className={SM} style={vbtn()} disabled={!!busy}
              onClick={() => void getir(maskeli)}>
              {maskeli ? <EyeIcon className="h-3.5 w-3.5" /> : <EyeSlashIcon className="h-3.5 w-3.5" />}
              {maskeli ? 'Gerçek değerleri göster' : 'Maskele'}
            </button>
            <button type="button" className={SM} style={vbtn('primary')} disabled={!!busy || files.length === 0}
              title={files.length === 0 ? 'Yazılabilecek values dosyası bulunamadı (bastion arşivi taranmamış olabilir)' : undefined}
              onClick={async () => { await getir(true); setDuzenle(true); }}>
              <PencilSquareIcon className="h-3.5 w-3.5" /> Düzenle
            </button>
          </>
        ) : (
          <>
            <button type="button" className={SM} style={vbtn('danger')} disabled={!degisti || !!busy || !hedef} onClick={kaydet}>
              <DocumentCheckIcon className="h-3.5 w-3.5" />
              Kaydet ({fark ? fark.eklenen.length + fark.cikarilan.length : 0} satır)
            </button>
            <button type="button" className={SM} style={vbtn()} onClick={() => { setDuzenle(false); setTaslak(metin || ''); }}>
              <ArrowUturnLeftIcon className="h-3.5 w-3.5" /> Vazgeç
            </button>
            <select
              value={hedef}
              onChange={(e) => setHedef(e.target.value)}
              className="h-7 text-[11px] rounded-lg border px-1.5 max-w-[26rem]"
              style={{ borderColor: hedef ? 'var(--border)' : 'var(--status-danger)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            >
              <option value="">— hedef dosya seçin —</option>
              {files.map((f) => <option key={f.path} value={f.path}>{f.label}</option>)}
            </select>
          </>
        )}
        <label className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={hepsi} disabled={duzenle || !!busy}
            onChange={(e) => { setHepsi(e.target.checked); void getir(!maskeli, e.target.checked); }} />
          chart varsayılanları dahil
        </label>
        <button type="button" className={SM} style={vbtn()} disabled={!!busy} onClick={() => void getir(!maskeli)}>
          <ArrowPathIcon className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Yenile
        </button>
      </div>

      {maskeli && !duzenle && (
        <div className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
          <EyeSlashIcon className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Parola/token içerebilecek alanlar <b>****</b> ile gizlendi. Gerçek değerleri görmek denetim kaydına yazılır.</span>
        </div>
      )}
      {!maskeli && (
        <div className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
          style={{ color: 'var(--status-warning)', background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning)' }}>
          <ExclamationTriangleIcon className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Gerçek değerler görünüyor — ekran paylaşımında dikkat edin. Bu görüntüleme denetim kaydına yazıldı.</span>
        </div>
      )}
      {hata && (
        <div className="text-sm rounded-lg px-3 py-2 border"
          style={{ color: 'var(--status-danger)', background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}>{hata}</div>
      )}

      {busy && metin == null ? <LoadingLogo compact /> : duzenle ? (
        <div className="grid lg:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Düzenlenen içerik</div>
            <textarea
              value={taslak}
              onChange={(e) => setTaslak(e.target.value)}
              spellCheck={false}
              className="w-full text-[12px] rounded-lg border px-3 py-2"
              style={{ height: compact ? '38vh' : '52vh', background: 'var(--bg-elevated)', color: 'var(--text-primary)', borderColor: 'var(--border)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Değişiklik</div>
            <div className="rounded-lg border overflow-auto text-[12px]"
              style={{ height: compact ? '38vh' : '52vh', background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {!fark || (fark.eklenen.length === 0 && fark.cikarilan.length === 0) ? (
                <div className="p-3" style={{ color: 'var(--text-muted)' }}>Henüz değişiklik yok.</div>
              ) : (
                <ul className="p-2 space-y-0.5">
                  {fark.cikarilan.map((l, i) => <li key={`c${i}`} style={{ color: 'var(--status-danger)' }}>- {l}</li>)}
                  {fark.eklenen.map((l, i) => <li key={`e${i}`} style={{ color: 'var(--status-success)' }}>+ {l}</li>)}
                </ul>
              )}
            </div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Kaydetmeden önce hedef dosyanın yedeği alınır. Yazmak tek başına ortama dokunmaz;
              değerler <b>upgrade</b> ya da <b>rollout</b> ile uygulanır.
            </div>
          </div>
        </div>
      ) : (
        <pre className="text-[12px] leading-relaxed rounded-lg px-3 py-2.5 overflow-auto"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', maxHeight: compact ? '42vh' : '58vh', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {metin || '(boş)'}
        </pre>
      )}

      {onay && (
        <OpsConfirm req={onay} namespace={hedef} tenantLabel={tenantLabel}
          onCancel={() => setOnay(null)} onConfirm={yaz} />
      )}
    </div>
  );
}

export default ValuesEditor;
