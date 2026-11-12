// src/components/admin/tabs/SmartRetriggerModal.tsx — Admin > Smart Talepleri: zaman aşımına
// uğramış talebi yeniden tetikle (2026-11-11). Kurallar sunucuda (server/smart/yeniden-tetikle.cjs):
// Smart reddettiyse / okunamadıysa tetiklenmez; onay yoksa admin gerekçeyle atlar; OCO'lu talepte
// yeni OCO numarası ya da ayrı onay kutusuyla "pencere dışında hemen çalıştır".
import { useState } from 'react';
import { ArrowPathIcon, ExclamationTriangleIcon, PlayIcon } from '@heroicons/react/24/outline';
import {
  ansibleApi,
  type AdminSmartTicket,
  type SmartRetriggerCheck,
} from '@/api/ansibleApi';
import { toast } from '@/hooks/useToast';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtDateTime as fmt } from '@/utils/datetime';

const SMART_ROZET: Record<string, { label: string; className: string }> = {
  onayli: { label: 'Smart onaylı', className: 'bg-green-50 text-green-700 border-green-200' },
  bekliyor: { label: 'Smart onayı yok', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  bilinmiyor: { label: 'Smart onaylı değil', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  reddedildi: { label: 'Smart reddetti', className: 'bg-red-50 text-red-700 border-red-200' },
  okunamadi: { label: 'Smart okunamadı', className: 'bg-red-50 text-red-700 border-red-200' },
};

interface Props {
  ticket: AdminSmartTicket;
  onClose: () => void;
  onDone: () => void;
}

export default function SmartRetriggerModal({ ticket, onClose, onDone }: Props) {
  const [check, setCheck] = useState<SmartRetriggerCheck | null>(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<'oco' | 'pencereDisi'>('oco');
  const [ocoNumber, setOcoNumber] = useState('');
  const [confirmOutside, setConfirmOutside] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  async function loadCheck() {
    setChecking(true);
    try {
      setCheck(await ansibleApi.smartTicketRetriggerCheck(ticket.id));
    } catch (e: unknown) {
      setCheck({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setChecking(false);
    }
  }

  // useAsyncEffect: loadCheck ilk satirinda setChecking(true) cagiriyor; effect icinde senkron
  // setState (set-state-in-effect) olmasin diye is bir mikro-goreve ertelenir.
  useAsyncEffect(async () => {
    await loadCheck();
  }, [ticket.id]);

  const notEnAz = check?.notEnAz ?? 10;
  const ocoLu = !!check?.oco?.kapsamli;
  const smart = check?.smart;
  const engel = !check?.ok || !!smart?.engel;
  const ocoGecerli = /^\d{4,12}$/.test(ocoNumber.trim());
  const hazir =
    !engel &&
    !checking &&
    note.trim().length >= notEnAz &&
    (!ocoLu || (mode === 'oco' ? ocoGecerli : confirmOutside));

  async function gonder() {
    if (!hazir) return;
    setSending(true);
    try {
      const r = await ansibleApi.smartTicketRetrigger(ticket.id, {
        note: note.trim(),
        ...(ocoLu
          ? mode === 'oco'
            ? { mode, ocoNumber: ocoNumber.trim() }
            : { mode, outsideWindowConfirm: true }
          : {}),
      });
      if (r.ok && r.warning) {
        // İş AWX'te başladı/zamanlandı ama talep kaydı yazılamadı: başarı gibi gösterilmez.
        toast.warning(r.message || 'İş başlatıldı ancak talep kaydı güncellenemedi.', 12000);
        onDone();
      } else if (r.ok) {
        toast.success(
          r.scheduled
            ? `İş ${r.runAtText || 'kesinti penceresine'} zamanlandı.`
            : r.jobId
              ? `İş tetiklendi: AWX job #${r.jobId}.`
              : r.message || 'İş tetiklendi.',
        );
        onDone();
      } else {
        toast.error(r.message || 'Tetiklenemedi.');
        if (r.smart) setCheck((c) => (c ? { ...c, smart: r.smart } : c));
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const rozet = smart ? SMART_ROZET[smart.durum] : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ss-retrigger-baslik"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div>
          <h3 id="ss-retrigger-baslik" className="text-sm font-bold text-gray-900">
            Zaman aşımına uğrayan talebi tetikle
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            <span className="font-mono">{ticket.username}</span> kullanıcısının{' '}
            <span className="font-semibold">{ticket.templateName || `#${ticket.id}`}</span> talebi
            {ticket.externalTicketId && (
              <>
                {' '}
                · Smart kaydı <span className="font-mono">#{ticket.externalTicketId}</span>
              </>
            )}
            . İş, talep sahibinin gönderdiği parametrelerle çalışır.
          </p>
        </div>

        {/* SMART DURUMU */}
        <div className="border border-gray-200 rounded-xl px-3 py-2 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-gray-700">Smart kaydının şimdiki durumu</span>
            <button
              onClick={loadCheck}
              disabled={checking || sending}
              className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              <ArrowPathIcon className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} /> Yeniden sorgula
            </button>
          </div>
          {checking && <p className="text-xs text-gray-400">Smart sorgulanıyor…</p>}
          {!checking && check && !check.ok && (
            <p className="text-xs text-red-600" data-testid="ss-retrigger-hata">
              {check.message || 'Kontrol yapılamadı.'}
            </p>
          )}
          {!checking && smart && rozet && (
            <div className="space-y-0.5" data-testid="ss-retrigger-smart">
              <span
                className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-lg border ${rozet.className}`}
              >
                {rozet.label}
              </span>
              {smart.stateName && (
                <span className="text-[11px] text-gray-400 ml-2">{smart.stateName}</span>
              )}
              {smart.statusCode && (
                <span className="text-[11px] text-gray-400 ml-1 font-mono">(kod {smart.statusCode})</span>
              )}
              <p className={`text-xs ${smart.engel ? 'text-red-600' : 'text-gray-600'}`}>
                {smart.message}
              </p>
            </div>
          )}
        </div>

        {/* OCO PENCERESI */}
        {!checking && check?.ok && ocoLu && !engel && (
          <div className="border border-gray-200 rounded-xl px-3 py-2 space-y-2">
            <div className="text-xs font-semibold text-gray-700">Kesinti penceresi</div>
            <p className="text-xs text-gray-500">
              Talebin OCO kaydı{' '}
              <span className="font-mono">{check.oco?.ocoNumber || '—'}</span>
              {check.oco?.windowEndIso && <> · pencere {fmt(check.oco.windowEndIso)} tarihinde kapandı</>}.
            </p>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                name="ss-retrigger-mod"
                checked={mode === 'oco'}
                onChange={() => setMode('oco')}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold text-gray-800">Yeni OCO numarası ile</span>
                <span className="block text-gray-500">
                  Pencere açıksa hemen çalışır, henüz açılmadıysa başlangıcına zamanlanır, geçmişse
                  reddedilir.
                </span>
              </span>
            </label>
            {mode === 'oco' && (
              <input
                value={ocoNumber}
                onChange={(e) => setOcoNumber(e.target.value)}
                inputMode="numeric"
                placeholder="OCO numarası"
                aria-label="Yeni OCO numarası"
                className="ml-6 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg font-mono w-48"
              />
            )}
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                name="ss-retrigger-mod"
                checked={mode === 'pencereDisi'}
                onChange={() => setMode('pencereDisi')}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold text-gray-800">Pencere dışında hemen çalıştır</span>
                <span className="block text-gray-500">Production'da OCO penceresi dışında değişiklik demektir.</span>
              </span>
            </label>
            {mode === 'pencereDisi' && (
              <label className="ml-6 flex gap-2 items-start bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmOutside}
                  onChange={(e) => setConfirmOutside(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-xs text-amber-800">
                  <ExclamationTriangleIcon className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                  İşin onaylı kesinti penceresi dışında production'da çalışacağını biliyorum.
                </span>
              </label>
            )}
          </div>
        )}

        {/* GEREKCE */}
        {!checking && check?.ok && !engel && (
          <div>
            <label htmlFor="ss-retrigger-not" className="block text-xs font-semibold text-gray-700 mb-1">
              Gerekçe <span className="font-normal text-gray-400">(zorunlu, en az {notEnAz} karakter)</span>
            </label>
            <textarea
              id="ss-retrigger-not"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Örn: onaycı izinde, ekip lideri telefonla onay verdi."
              className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg resize-y"
            />
            <div className="text-[10px] text-gray-400 text-right mt-0.5">{note.length}/1000</div>
            <p className="text-[11px] text-gray-500">
              Gerekçe ve adınız talep kaydına ve denetim günlüğüne yazılır.
              {smart?.durum !== 'onayli' && ' Smart onayı sizin adınıza atlanmış sayılır.'}
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={sending}
            className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            İptal
          </button>
          <button
            onClick={gonder}
            disabled={!hazir || sending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <PlayIcon className="w-3.5 h-3.5" />
            {sending ? 'Tetikleniyor…' : 'İşi tetikle'}
          </button>
        </div>
      </div>
    </div>
  );
}
