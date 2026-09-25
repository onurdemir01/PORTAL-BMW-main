// src/components/crypto_hub/ValuesModal.tsx — koşan sürümün values.yaml'ı (2026-09-26).
//
// Kullanıcı: "çalışan sürüm için values.yaml'ı görüntüleyebildikleri hem de değiştirip işlem
// yapmalarına olanak veren bir yer koyduk mu? Ek olarak upgrade'lerde de mevcut values.yaml
// gösterilip sorulmalı."
//
// ÜÇ KURAL:
//  1) VARSAYILAN MASKELİ. values içinde veritabanı parolası, token, keystore şifresi olur.
//     Sunucu `password`/`secret`/`token`… anahtarlarını `****` yapar. Gerçek değerler ancak
//     kullanıcı açıkça isterse gelir ve bu istek denetim kaydına yazılır.
//  2) MASKELİ METİN KAYDEDİLEMEZ. `****` içeren bir içeriği dosyaya yazmak, gerçek parolayı
//     silmek olurdu; sunucu bunu reddediyor, ekran da baştan engelliyor.
//  3) YAZMADAN ÖNCE FARK GÖSTERİLİR ve dosyanın yedeği alınır. "Ne değişecek" sorusu,
//     onaydan önce cevaplanabilmeli.
import React, { useMemo, useState } from 'react';
import {
  EyeIcon, EyeSlashIcon, PencilSquareIcon, ArrowPathIcon, ExclamationTriangleIcon,
  DocumentCheckIcon, ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import { Modal } from '@/components/common/Modal';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useOps, OpsConfirm, type OpsRequest } from './OpsPanel';
import { toast } from '@/hooks/useToast';

const SM = 'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
const st = (tone?: 'primary' | 'danger'): React.CSSProperties => {
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

export function ValuesModal({ tenantKey, tenantLabel, release, valuesPath, onClose }: {
  tenantKey: string;
  tenantLabel: string;
  release: string;
  /** düzenlenip yazılacak dosya; boş ise ekran salt okunur kalır */
  valuesPath?: string;
  onClose: () => void;
}) {
  const { run, busy } = useOps(tenantKey);
  const [metin, setMetin] = useState<string | null>(null);
  const [maskeli, setMaskeli] = useState(true);
  const [hepsi, setHepsi] = useState(false);
  const [duzenle, setDuzenle] = useState(false);
  const [taslak, setTaslak] = useState('');
  const [hata, setHata] = useState('');
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

  React.useEffect(() => { void getir(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fark = useMemo(() => (duzenle && metin != null ? diffLines(metin, taslak) : null), [duzenle, metin, taslak]);
  const degisti = duzenle && metin != null && taslak !== metin;

  const kaydet = () => {
    if (!valuesPath) return;
    if (/:\s*\*{4}\s*$/m.test(taslak)) {
      toast.error('İçerikte maskelenmiş (****) değer var — önce gerçek değerleri gösterin.');
      return;
    }
    setOnay({ action: 'values_put', targets: [], valuesPath, content: taslak });
  };

  const yaz = async () => {
    if (!onay) return;
    const r = await run(onay);
    setOnay(null);
    if (r) {
      const basarili = r.results.filter((x) => x.ok);
      if (basarili.length) {
        toast.success('values.yaml yazıldı (eski dosyanın yedeği alındı).');
        setDuzenle(false);
        void getir(false);
      } else {
        toast.error(r.results.map((x) => x.message).join(' · ') || 'Yazılamadı.');
      }
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      dismissOnBackdrop={false}
      title="values.yaml"
      subtitle={`${tenantLabel} · release ${release}${hepsi ? ' · chart varsayılanları dahil' : ''}`}
      footer={(
        <div className="flex items-center gap-2 w-full flex-wrap">
          {!duzenle ? (
            <>
              <button type="button" className={SM} style={st()} disabled={!!busy}
                onClick={() => { const y = !maskeli; void getir(!y); }}>
                {maskeli ? <EyeIcon className="h-3.5 w-3.5" /> : <EyeSlashIcon className="h-3.5 w-3.5" />}
                {maskeli ? 'Gerçek değerleri göster' : 'Maskele'}
              </button>
              {valuesPath && (
                <button type="button" className={SM} style={st('primary')} disabled={!!busy}
                  onClick={async () => { await getir(true); setDuzenle(true); }}>
                  <PencilSquareIcon className="h-3.5 w-3.5" /> Düzenle
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" className={SM} style={st('danger')} disabled={!degisti || !!busy} onClick={kaydet}>
                <DocumentCheckIcon className="h-3.5 w-3.5" /> Kaydet ({fark ? fark.eklenen.length + fark.cikarilan.length : 0} satır değişti)
              </button>
              <button type="button" className={SM} style={st()} onClick={() => { setDuzenle(false); setTaslak(metin || ''); }}>
                <ArrowUturnLeftIcon className="h-3.5 w-3.5" /> Vazgeç
              </button>
            </>
          )}
          <label className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={hepsi} disabled={duzenle || !!busy}
              onChange={(e) => { setHepsi(e.target.checked); void getir(!maskeli, e.target.checked); }} />
            chart varsayılanları dahil
          </label>
          <button type="button" className={SM} style={st()} disabled={!!busy} onClick={() => void getir(!maskeli)}>
            <ArrowPathIcon className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Yenile
          </button>
          <span className="flex-1" />
          <button type="button" className="h-8 px-3 text-xs rounded-lg border" style={st()} onClick={onClose}>Kapat</button>
        </div>
      )}
    >
      <div className="space-y-3">
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
                style={{ height: '52vh', background: 'var(--bg-elevated)', color: 'var(--text-primary)', borderColor: 'var(--border)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Değişiklik</div>
              <div className="rounded-lg border overflow-auto text-[12px]"
                style={{ height: '52vh', background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {!fark || (fark.eklenen.length === 0 && fark.cikarilan.length === 0) ? (
                  <div className="p-3" style={{ color: 'var(--text-muted)' }}>Henüz değişiklik yok.</div>
                ) : (
                  <ul className="p-2 space-y-0.5">
                    {fark.cikarilan.map((l, i) => (
                      <li key={`c${i}`} style={{ color: 'var(--status-danger)' }}>- {l}</li>
                    ))}
                    {fark.eklenen.map((l, i) => (
                      <li key={`e${i}`} style={{ color: 'var(--status-success)' }}>+ {l}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                Kaydetmeden önce <b>{valuesPath}</b> dosyasının yedeği alınır. Yazmak tek başına kümeye dokunmaz;
                yeni değerler bir sonraki <b>upgrade</b> ile uygulanır.
              </div>
            </div>
          </div>
        ) : (
          <pre className="text-[12px] leading-relaxed rounded-lg px-3 py-2.5 overflow-auto"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', maxHeight: '58vh', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {metin || '(boş)'}
          </pre>
        )}
      </div>

      {onay && (
        <OpsConfirm req={onay} namespace={valuesPath || ''} tenantLabel={tenantLabel}
          onCancel={() => setOnay(null)} onConfirm={yaz} />
      )}
    </Modal>
  );
}

export default ValuesModal;
