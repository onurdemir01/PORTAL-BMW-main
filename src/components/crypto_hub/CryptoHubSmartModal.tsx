// src/components/crypto_hub/CryptoHubSmartModal.tsx — Crypto Hub node talebinin kendi Smart ayarı.
//
// OpsXSmartConfigModal soyutlanmadı: platform sekmesi yok, kaynak göstergesi ve kapatma onayı var;
// o dosyanın metnini kilitleyen bekçiler de korunur. "Alanları Getir" tablosu ve "Otomatik Doldur"
// taslağı aynı koddan gelir (smartMetadata.tsx); kopyası zamanla sessizce ayrışırdı.
//
// Düğme kozmetik kapıdır; gerçek kapı sunucudaki requireAdmin. Smart'ı kapatma yalnız test
// kiracılarında etkilidir ve sunucuda kiracının sabit listesinden hesaplanır. Bu pencere bu kararı
// vermez, yalnız metin gösterir.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { TextInput, Textarea } from '@/components/ui/Form';
import { toast } from '@/hooks/useToast';
import { ansibleApi } from '@/api/ansibleApi';
import { cryptoNodeApi, type CryptoSmartAyarYaniti } from '@/api/cryptoHubApi';
import {
  buildMetadataTemplate,
  SmartFieldsTable,
  type SmartField,
} from '@/components/self_service/smartMetadata';
import { METIN } from './nodeOrtak';

const M = METIN.smartAyar;

const ETIKET = 'block text-[11px] font-semibold mb-1';
const KUCUK_BTN = 'text-[11px] px-2 py-1 rounded-lg border disabled:opacity-50 flex-shrink-0';
const btnStil: React.CSSProperties = { borderColor: 'var(--border)', color: 'var(--text-secondary)' };
const ikincil: React.CSSProperties = { color: 'var(--text-secondary)' };
const soluk: React.CSSProperties = { color: 'var(--text-muted)' };
const tehlike: React.CSSProperties = { color: 'var(--status-danger)' };

interface Props {
  open: boolean;
  onClose: () => void;
  /** Kayıt sonrası: açık ekranlar smartMod'u yeniden okusun. */
  onKaydedildi?: () => void;
}

const CryptoHubSmartModal: React.FC<Props> = ({ open, onClose, onKaydedildi }) => {
  const [meta, setMeta] = useState<CryptoSmartAyarYaniti | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [flowKey, setFlowKey] = useState('');
  const [metadataFields, setMetadataFields] = useState('');
  const [integrationKey, setIntegrationKey] = useState('');
  const [kapatOnay, setKapatOnay] = useState(false);
  const [kaydediyor, setKaydediyor] = useState(false);
  const kaydetRef = useRef(false);

  const [alanlar, setAlanlar] = useState<SmartField[] | null>(null);
  const [alanHata, setAlanHata] = useState('');
  const [alanYukleniyor, setAlanYukleniyor] = useState(false);

  const [onizleme, setOnizleme] = useState<Record<string, string> | null>(null);
  const [onizlemeHata, setOnizlemeHata] = useState('');
  const [onizlemeBusy, setOnizlemeBusy] = useState(false);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata('');
    try {
      const r = await cryptoNodeApi.smartAyar();
      if (!r.ok || !r.smart) throw new Error(r.message || M.okunamadi);
      setMeta(r);
      setEnabled(r.smart.enabled);
      setFlowKey(r.smart.flowKey);
      setMetadataFields(r.smart.metadataFields);
      setIntegrationKey('');
      setKapatOnay(false);
    } catch (e) {
      setMeta(null);
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void yukle();
    setAlanlar(null);
    setAlanHata('');
    setOnizleme(null);
    setOnizlemeHata('');
  }, [open, yukle]);

  const kapatiyor = !!meta?.smart?.enabled && !enabled;
  const kaydedilebilir = !!meta && !yukleniyor && !kaydediyor && (!kapatiyor || kapatOnay);
  // Sunucuyla aynı kural (smart-ayar.cjs kaydet): yöneticinin sessizce anahtar kaybetmemesi için.
  const tokenSilinir =
    !!meta?.smart?.integrationKeySet &&
    !!flowKey.trim() &&
    flowKey.trim() !== meta.smart.flowKey &&
    !integrationKey.trim();

  async function alanlariGetir() {
    const k = flowKey.trim();
    if (!k) return;
    setAlanYukleniyor(true);
    setAlanHata('');
    setAlanlar(null);
    try {
      const r = await ansibleApi.smartFlowMetadata(k);
      if (!r.ok) throw new Error(r.message || M.alanHata);
      setAlanlar((r.fields || []) as SmartField[]);
    } catch (e) {
      setAlanHata(e instanceof Error ? e.message : String(e));
    } finally {
      setAlanYukleniyor(false);
    }
  }

  function otomatikDoldur() {
    if (alanlar && alanlar.length) setMetadataFields(buildMetadataTemplate(alanlar));
  }

  async function onizle() {
    if (onizlemeBusy) return;
    setOnizlemeBusy(true);
    setOnizlemeHata('');
    setOnizleme(null);
    try {
      const r = await cryptoNodeApi.smartAyarOnizle(metadataFields);
      if (!r.ok) throw new Error(r.message || M.onizlemeHata);
      if (r.hata) setOnizlemeHata(r.hata);
      else setOnizleme(r.metadata || {});
    } catch (e) {
      setOnizlemeHata(e instanceof Error ? e.message : String(e));
    } finally {
      setOnizlemeBusy(false);
    }
  }

  async function kaydet() {
    if (kaydetRef.current || !kaydedilebilir) return;
    kaydetRef.current = true;
    setKaydediyor(true);
    setHata('');
    try {
      const r = await cryptoNodeApi.smartAyarKaydet({
        // Dokunulmadıysa gönderilmez: bayat pencere başka yöneticinin kararını ezip Smart'ı onaysız
        // kapatamasın. Kapatma her zaman yukarıdaki kapatOnay kapısından geçer.
        ...(enabled !== meta?.smart?.enabled ? { enabled } : {}),
        flowKey: flowKey.trim(),
        metadataFields,
        // Boş = "değiştirmedim"; sunucu mevcut değeri korur.
        integrationKey: integrationKey.trim(),
      });
      if (!r.ok) throw new Error(r.message || M.kaydedilemedi);
      toast.success(M.kaydedildi);
      await yukle();
      onKaydedildi?.();
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      kaydetRef.current = false;
      setKaydediyor(false);
    }
  }

  const durum = meta?.durum;
  const kaynakMetni =
    meta?.kaynak === 'crypto' ? M.kaynakKendi : meta?.kaynak === 'opsx' ? M.kaynakOpsx : M.kaynakYok;
  const flowBos = !flowKey.trim();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={M.baslik}
      subtitle={M.altBaslik}
      size="wide"
      dismissOnBackdrop={false}
      footer={
        <div className="flex items-center gap-2">
          <button type="button" className="btn-primary" disabled={!kaydedilebilir} onClick={() => void kaydet()}>
            {kaydediyor ? M.kaydediliyor : M.kaydet}
          </button>
          <button type="button" className="pf-btn-link" disabled={kaydediyor} onClick={onClose}>
            {METIN.dugme.kapat}
          </button>
        </div>
      }
    >
      <div className="space-y-4 min-w-0">
        {hata && (
          <p
            className="text-xs rounded-lg border p-2"
            style={{ ...tehlike, borderColor: 'var(--status-danger)', background: 'var(--status-danger-bg)' }}
            role="alert"
          >
            {hata}
          </p>
        )}
        {yukleniyor && (
          <p className="text-xs" style={soluk}>
            {M.yukleniyor}
          </p>
        )}
        {meta && !yukleniyor && (
          <>
            <div
              className="rounded-xl border p-3 text-xs space-y-1"
              style={{ ...ikincil, borderColor: 'var(--border)' }}
              aria-live="polite"
            >
              <p>
                <strong>{durum ? M.durum[durum] : ''}</strong>
              </p>
              <p>
                {kaynakMetni}
                {meta.kaynak === 'opsx' && meta.opsxFlowKey ? ` (Flow Key: ${meta.opsxFlowKey})` : ''}
              </p>
              <p style={soluk}>{M.blokKurali}</p>
            </div>

            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-xs font-semibold" style={ikincil}>
                  {M.acKapa}
                </span>
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              </label>
              <p className="text-[11px] mt-1.5" style={soluk}>
                {M.acKapaNot}
              </p>
              {!enabled && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-[11px] leading-relaxed" style={tehlike}>
                    {M.kapaliUyari}
                  </p>
                  {kapatiyor && (
                    <label className="flex items-start gap-2 text-[11px]" style={{ color: 'var(--text-primary)' }}>
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={kapatOnay}
                        onChange={(e) => setKapatOnay(e.target.checked)}
                      />
                      <span>{M.kapatOnay}</span>
                    </label>
                  )}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="ch-smart-flow" className={ETIKET} style={ikincil}>
                {M.flowKey}
              </label>
              <div className="flex items-center gap-2">
                <TextInput
                  id="ch-smart-flow"
                  className="font-mono text-xs flex-1"
                  value={flowKey}
                  placeholder={M.flowYerTutucu}
                  onChange={(e) => setFlowKey(e.target.value)}
                />
                <button
                  type="button"
                  className={KUCUK_BTN}
                  style={btnStil}
                  disabled={flowBos || alanYukleniyor}
                  onClick={() => void alanlariGetir()}
                >
                  {alanYukleniyor ? M.sorgulaniyor : M.alanlariGetir}
                </button>
              </div>
              <p className="text-[11px] mt-1" style={soluk}>
                {M.alanNot}
              </p>
              {alanHata && (
                <p className="text-[11px] mt-1" style={tehlike}>
                  {alanHata}
                </p>
              )}
              {alanlar && (
                <div className="mt-2 rounded-lg border overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
                  <SmartFieldsTable fields={alanlar} />
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label htmlFor="ch-smart-sablon" className="block text-[11px] font-semibold" style={ikincil}>
                  {M.sablon}
                </label>
                <button
                  type="button"
                  className={KUCUK_BTN}
                  style={btnStil}
                  disabled={!alanlar || alanlar.length === 0}
                  onClick={otomatikDoldur}
                >
                  {M.otomatikDoldur}
                </button>
              </div>
              <p className="text-[11px] mb-1" style={soluk}>
                {M.sablonNot}
              </p>
              <Textarea
                id="ch-smart-sablon"
                rows={8}
                className="text-xs font-mono"
                value={metadataFields}
                onChange={(e) => setMetadataFields(e.target.value)}
              />
              <div className="mt-2 space-y-1.5">
                <button
                  type="button"
                  className={KUCUK_BTN}
                  style={btnStil}
                  disabled={onizlemeBusy || !metadataFields.trim()}
                  onClick={() => void onizle()}
                >
                  {onizlemeBusy ? M.onizleniyor : M.onizle}
                </button>
                {onizlemeHata && (
                  <p className="text-[11px]" style={tehlike}>
                    {onizlemeHata}
                  </p>
                )}
                {onizleme && (
                  <div
                    className="text-[11px] font-mono rounded p-2 space-y-1 break-words"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                  >
                    {Object.entries(onizleme).map(([k, v]) => (
                      <div key={k}>
                        <span className="font-semibold">{k}</span>: <span className="whitespace-pre-wrap">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px]" style={soluk}>
                  {M.onizlemeNot}
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="ch-smart-token" className={ETIKET} style={ikincil}>
                {M.token}
              </label>
              <TextInput
                id="ch-smart-token"
                className="font-mono text-xs"
                type="password"
                autoComplete="off"
                value={integrationKey}
                disabled={!meta.sifrelemeVar}
                placeholder={meta.smart?.integrationKeySet ? M.tokenTanimli : M.tokenBos}
                onChange={(e) => setIntegrationKey(e.target.value)}
              />
              <p className="text-[11px] mt-1" style={soluk}>
                {meta.sifrelemeVar ? M.tokenNot : M.tokenSifrelemeYok}
              </p>
              {tokenSilinir && (
                <p className="text-[11px] mt-1" style={tehlike}>
                  {M.tokenSilinir}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default CryptoHubSmartModal;
