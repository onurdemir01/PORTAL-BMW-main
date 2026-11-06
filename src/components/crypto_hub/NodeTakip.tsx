// src/components/crypto_hub/NodeTakip.tsx — Crypto Hub > Indexer / Node: talep takibi (2026-11-02).
//
// Smart kapalı test kiracısında bilet yoktur: yalnız 2. kaynak izlenir, takip "Uygulanıyor"dan başlar.
// Talep açıldıktan sonra iki kaynak izlenir:
//   1) Smart onayı: OpsX'in ortak kancası (useOnaySonrasiTakip) — Smart durum adı AYNEN ve
//      son tarih sayacı. Kanca OpsX'te kalır, buradan yalnız içe aktarılır.
//   2) Portal talep satırı: GET /node-change/:id — onaydan sonra Portal'ın başlattığı işin
//      ÖLÇÜLMÜŞ sonucu (NODESUM). Sonuç satırı gelmediyse ekran "başarılı" UYDURMAZ.
// Kullanıcının ekranda beklemesi gerekmez; kapatılabilir, "Son talepler"den yeniden açılır.
import React, { useEffect, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import {
  cryptoNodeApi,
  type NodeChangeDetail,
  type NodeChangeResult,
  type NodeEsTalepOnerisi,
} from '@/api/cryptoHubApi';
import { useOnaySonrasiTakip } from '@/components/opsx/useOnaySonrasiTakip';
import { fmtDateTime } from '@/utils/datetime';
import {
  METIN,
  DURUM_ETIKETI,
  GEREKCE_EN_COK,
  gerekceGecerli,
  acikMi,
  durumTonu,
  esOneriGoster,
  kalanSure,
  smartNo,
  sonucMetni,
  sonucSatirlari,
  type Ton,
} from './nodeOrtak';

const TON_RENK: Record<Ton, [string, string]> = {
  ok: ['var(--status-success)', 'var(--status-success-bg)'],
  warn: ['var(--status-warning)', 'var(--status-warning-bg)'],
  danger: ['var(--status-danger)', 'var(--status-danger-bg)'],
  muted: ['var(--text-muted)', 'var(--bg-elevated)'],
  accent: ['var(--accent)', 'var(--accent-bg)'],
};

export function NodeRozet({
  ton,
  children,
  title,
}: {
  ton: Ton;
  children: React.ReactNode;
  title?: string;
}) {
  const [color, bg] = TON_RENK[ton];
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium leading-tight"
      style={{ color, background: bg, border: '1px solid ' + color }}
    >
      {children}
    </span>
  );
}

export const NODE_BTN =
  'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed';
export const nodeBtnStil = (): React.CSSProperties => ({
  borderColor: 'var(--border)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
});

export function NodeTakip({
  tenantKey,
  talepId,
  yeniAcildi,
  onAnkara,
  onKapat,
  onDegisti,
  aralikMs = 5000,
  admin = false,
}: {
  tenantKey: string;
  talepId: number;
  /** talep bu oturumda açıldıysa POST /node-change yanıtı */
  yeniAcildi?: NodeChangeResult | null;
  onAnkara?: (o: NodeEsTalepOnerisi) => void;
  onKapat: () => void;
  /** talep kapandığında (bir kez): liste yenilensin */
  onDegisti?: () => void;
  aralikMs?: number;
  /** Admin: takılı açık talebi gerekçeyle kapatabilir (PS2) */
  admin?: boolean;
}) {
  const [detay, setDetay] = useState<NodeChangeDetail | null>(null);
  const [kapatAcik, setKapatAcik] = useState(false);
  const [kapatGerekce, setKapatGerekce] = useState('');
  const [kapatiliyor, setKapatiliyor] = useState(false);
  const [hata, setHata] = useState('');
  const [basladi, setBasladi] = useState(false);
  const [simdi, setSimdi] = useState(() => Date.now());

  const talep = detay?.talep || null;
  // Smart kapalı yolda bilet yok: takip CALISIYOR'dan başlar. Belirsiz launch da satırı orada bırakır.
  const onaysiz = !!yeniAcildi?.onaysiz || yeniAcildi?.blocked === 'crypto_node_dogrudan_belirsiz';
  const durum = talep?.durum || (onaysiz ? 'CALISIYOR' : yeniAcildi?.ok ? 'BEKLIYOR' : 'ACILIYOR');
  const kapali = talep ? !acikMi(talep.durum) || !!talep.kapandiAt : false;

  // Portal talep satırı: kapanana dek aralıkla sorulur. Geçici ağ hatası takibi DURDURMAZ.
  useEffect(() => {
    if (kapali) return;
    let iptal = false;
    let zamanlayici: number | undefined;
    async function tur() {
      try {
        const r = await cryptoNodeApi.changeDetail(talepId);
        if (iptal) return;
        if (r.ok && r.talep) {
          setDetay(r);
          setHata('');
          if (!acikMi(r.talep.durum) || r.talep.kapandiAt) {
            onDegisti?.();
            return;
          }
        } else if (!r.ok) {
          setHata(r.message || 'Talep durumu okunamadı.');
        }
      } catch (e: unknown) {
        if (iptal) return;
        setHata(e instanceof Error ? e.message : String(e));
      }
      if (!iptal) zamanlayici = window.setTimeout(tur, aralikMs);
    }
    zamanlayici = window.setTimeout(tur, 0);
    return () => {
      iptal = true;
      if (zamanlayici) window.clearTimeout(zamanlayici);
    };
    // onDegisti bilerek bağımlılık dışı: satır içi geri çağrı her render'da yenilenir.
  }, [talepId, kapali, aralikMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Smart onayı: yalnız talep onay beklerken.
  const smartId =
    !kapali && durum === 'BEKLIYOR' ? talep?.smartTicketId || yeniAcildi?.ticketId || null : null;
  const { sonDurum, sonDurumAlindiMs } = useOnaySonrasiTakip(smartId, () => setBasladi(true));

  // Son tarih sayacı dakikada bir tazelenir.
  useEffect(() => {
    if (kapali) return;
    const t = window.setInterval(() => setSimdi(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, [kapali]);

  const no = smartNo(
    talep?.externalTicketId ?? yeniAcildi?.externalTicketId ?? null,
    talep?.talepId ?? yeniAcildi?.talepId,
  );
  // Smart durumu önce ortak kancadan (canlı), yoksa Portal'ın talep yanıtındaki kayıttan.
  const smart = detay?.smart || null;
  const durumAdi = sonDurum?.smartStateName || smart?.statusName || sonDurum?.status || smart?.status || '…';
  const kalan = sonDurum?.deadline
    ? kalanSure(sonDurum.deadline, sonDurum.serverNow, sonDurumAlindiMs, simdi)
    : kalanSure(smart?.sonTarih, null, null, simdi);
  const pencereBekliyor = durum === 'BEKLIYOR' && !!smart?.pencereBekliyor;
  const ocoNo = talep?.ocoNo ?? yeniAcildi?.oco?.ocoNumber ?? null;
  const ocoBas = talep?.ocoPencereBas ?? yeniAcildi?.oco?.windowStartIso ?? null;
  const ocoSon = talep?.ocoPencereSon ?? yeniAcildi?.oco?.windowEndIso ?? null;
  const oneri = yeniAcildi?.esTalepOnerisi ?? detay?.esTalepOnerisi ?? null;
  const sonucVeri = detay?.sonuc ?? talep?.sonuc ?? null;
  const satirlar = sonucSatirlari(sonucVeri);
  const sonuc = talep && kapali ? sonucMetni(talep.durum, talep.sonucKod, sonucVeri, !!talep.ocoNo) : null;

  async function adminKapat() {
    if (kapatiliyor || !gerekceGecerli(kapatGerekce)) return;
    setKapatiliyor(true);
    setHata('');
    try {
      const r = await cryptoNodeApi.kapat(talepId, kapatGerekce.trim());
      if (r.ok && r.talep) {
        setDetay((d) => ({ ...(d || { ok: true }), ok: true, talep: r.talep }));
        setKapatAcik(false);
        onDegisti?.();
      } else {
        setHata(r.message || 'Talep kapatılamadı.');
      }
    } catch (e: unknown) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setKapatiliyor(false);
    }
  }

  return (
    <section
      className="rounded-xl border p-4 space-y-3 min-w-0"
      style={{ borderColor: 'var(--accent)', background: 'var(--bg-surface)' }}
      aria-live="polite"
    >
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {METIN.takipBaslik} — {no}
          </div>
          {talep && (
            <div className="text-[11px] break-all" style={{ color: 'var(--text-muted)' }}>
              {talep.grupBaslik ? `${talep.grupBaslik} [${talep.grup}]` : talep.grup} · {talep.lokasyon} · {talep.username} ·{' '}
              {fmtDateTime(talep.createdAt)}
            </div>
          )}
          {ocoNo && (
            <div className="text-[11px] break-words" style={{ color: 'var(--text-muted)' }}>
              {METIN.oco.takip(ocoNo, fmtDateTime(ocoBas), fmtDateTime(ocoSon))}
            </div>
          )}
        </div>
        <NodeRozet ton={durumTonu(durum)}>{pencereBekliyor ? METIN.oco.onayliBekliyor : DURUM_ETIKETI[durum]}</NodeRozet>
        <button
          type="button"
          className={NODE_BTN}
          style={nodeBtnStil()}
          onClick={onKapat}
          aria-label={METIN.dugme.kapat}
          title={METIN.dugme.kapat}
        >
          <XMarkIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {yeniAcildi?.ok && !kapali && (
        <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          {yeniAcildi.onaysiz
            ? METIN.onaysiz.basladi(yeniAcildi.jobId ?? '?')
            : yeniAcildi.oco
              ? METIN.talepAcildiOco(yeniAcildi.externalTicketId || no, fmtDateTime(yeniAcildi.oco.sonBaslamaIso))
              : METIN.talepAcildi(yeniAcildi.externalTicketId || no)}
        </p>
      )}
      {yeniAcildi && !yeniAcildi.ok && yeniAcildi.message && !kapali && (
        <p className="text-[12px]" style={{ color: 'var(--status-warning)' }}>
          {yeniAcildi.message}
        </p>
      )}

      {admin && !kapali && talep && (
        <div className="space-y-1.5">
          {!kapatAcik ? (
            <button type="button" className={NODE_BTN} style={nodeBtnStil()} onClick={() => setKapatAcik(true)}>
              {METIN.adminKapatDugme}
            </button>
          ) : (
            <div
              className="rounded-lg border px-3 py-2 space-y-1.5"
              style={{ borderColor: 'var(--status-warning)', background: 'var(--status-warning-bg)' }}
            >
              <p className="text-[11px]" style={{ color: 'var(--text-primary)' }}>
                {METIN.adminKapatBilgi}
              </p>
              <label htmlFor={`node-kapat-${talepId}`} className="block text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>
                {METIN.adminKapatGerekce}
              </label>
              <input
                id={`node-kapat-${talepId}`}
                type="text"
                maxLength={GEREKCE_EN_COK}
                className="w-full text-[12px] rounded-lg border px-2 py-1"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                value={kapatGerekce}
                onChange={(e) => setKapatGerekce(e.target.value)}
              />
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  className={NODE_BTN}
                  style={nodeBtnStil()}
                  disabled={kapatiliyor || !gerekceGecerli(kapatGerekce)}
                  onClick={() => void adminKapat()}
                >
                  {kapatiliyor ? METIN.adminKapatiliyor : METIN.adminKapatOnay}
                </button>
                <button
                  type="button"
                  className={NODE_BTN}
                  style={nodeBtnStil()}
                  disabled={kapatiliyor}
                  onClick={() => setKapatAcik(false)}
                >
                  {METIN.dugme.iptal}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!kapali && (
        <div className="text-[12px] space-y-0.5" style={{ color: 'var(--text-primary)' }}>
          {durum === 'ACILIYOR' && <div>{METIN.aciliyor}</div>}
          {durum === 'BEKLIYOR' && !basladi && (
            <div>
              {pencereBekliyor ? METIN.oco.onayliBekliyor : METIN.onayBekliyor(durumAdi)}
              {kalan && (
                <span className="ml-2" style={{ color: 'var(--text-muted)' }}>
                  {METIN.sonTarih(kalan)}
                </span>
              )}
            </div>
          )}
          {(durum === 'CALISIYOR' || (durum === 'BEKLIYOR' && basladi)) && (
            <div>{METIN.uygulaniyor}</div>
          )}
        </div>
      )}

      {sonuc && (
        <p
          className="text-[13px] font-medium break-words"
          style={{ color: TON_RENK[durumTonu(durum)][0] }}
        >
          {sonuc}
        </p>
      )}

      {hata && (
        <p className="text-[11px]" style={{ color: 'var(--status-warning)' }}>
          {hata}
        </p>
      )}

      {satirlar.length > 0 && (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                {METIN.sonucBasliklar.map((b) => (
                  <th key={b} scope="col" className="text-left font-medium px-2 py-1.5 whitespace-nowrap">
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {satirlar.map((s) => (
                <tr
                  key={s.deployment + '/' + s.container + '/' + s.env}
                  className="border-t"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <td className="px-2 py-1.5 break-all">{s.deployment}</td>
                  <td className="px-2 py-1.5 break-all">{s.container}</td>
                  <td className="px-2 py-1.5 break-all">{s.env}</td>
                  <td className="px-2 py-1.5 break-all">{s.eski}</td>
                  <td className="px-2 py-1.5 break-all">{s.yeni}</td>
                  <td className="px-2 py-1.5">{s.yazildi}</td>
                  <td className="px-2 py-1.5">{s.rollout}</td>
                  <td className="px-2 py-1.5">{s.geriOkuma}</td>
                  <td className="px-2 py-1.5">{s.durum}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {oneri && esOneriGoster(tenantKey, oneri) && (
        <div
          className="rounded-lg border px-3 py-2 flex items-center gap-3 flex-wrap"
          style={{ borderColor: 'var(--status-warning)', background: 'var(--status-warning-bg)' }}
        >
          <span className="text-[12px] flex-1 min-w-0" style={{ color: 'var(--text-primary)' }}>
            {METIN.ankaraDegismedi(oneri.tenant)}
          </span>
          <button
            type="button"
            className={NODE_BTN}
            style={nodeBtnStil()}
            disabled={!oneri.acik}
            title={oneri.acik ? undefined : METIN.ankaraKapali}
            onClick={() => onAnkara?.(oneri)}
          >
            {METIN.ankaraDugme}
          </button>
        </div>
      )}
    </section>
  );
}
