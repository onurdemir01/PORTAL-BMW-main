// src/components/crypto_hub/NodeDegisiklikModal.tsx — Indexer / Node değişikliği sihirbazı (2026-11-02).
//
// Beş adım: Mevcut → Yeni node → Etki → Gerekçe → Onay → "Talep aç" (Smart bileti; OpsX
// OpenShift flow'u). Sihirbaz HİÇBİR değer göndermez: yalnız grup kimliği, katalog node id'si,
// seçilen bileşenler (deployment adları), gerekçe ve onaylar. Plan, hedefler ve sha'lar sunucuda
// son okumadan kurulur. Bileşen seçimi (2026-11-02): node taşıyan bileşenlerin hepsi işaretli
// gelir; kullanıcı alt küme seçebilir, seçilenler arasında hepsi ya da hiçbiri uygulanır.
//
// Okuma bayatsa sihirbaz kendi başına bir şey yapmaz: üst bileşen okumayı başlatır ve `okunuyor`
// süresince ilerleme kapalıdır. Okuma sonrası grup değiştirilemez olursa üst bileşen sihirbazı
// engel metniyle kapatır.
import React, { useRef, useState } from 'react';
import { ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/common/Modal';
import {
  cryptoNodeApi,
  type CryptoNodesResponse,
  type NodeChangeResult,
  type NodeGrup,
} from '@/api/cryptoHubApi';
import {
  METIN,
  GEREKCE_EN_COK,
  adayEtiketi,
  adaySecilebilir,
  bilesenAdi,
  etkilenenDeploymentlar,
  gerekceGecerli,
  mevcutNodeMetni,
  onayMetniEslesir,
  secilebilirler,
  secimAdaydaMi,
  secimGoster,
  secimTutarsiz,
} from './nodeOrtak';

type Kiraci = NonNullable<CryptoNodesResponse['tenant']>;

function Bilgi({ ton, children }: { ton: 'info' | 'warn' | 'danger'; children: React.ReactNode }) {
  const renk =
    ton === 'danger'
      ? ['var(--status-danger)', 'var(--status-danger-bg)']
      : ton === 'warn'
        ? ['var(--status-warning)', 'var(--status-warning-bg)']
        : ['var(--text-secondary)', 'var(--bg-elevated)'];
  const Icon = ton === 'info' ? InformationCircleIcon : ExclamationTriangleIcon;
  return (
    <div
      className="text-[12px] rounded-lg px-3 py-2 border flex items-start gap-2"
      style={{ color: renk[0], background: renk[1], borderColor: renk[0] }}
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export function NodeDegisiklikModal({
  tenant,
  grupId,
  grup,
  okunuyor,
  onKapat,
  onAcildi,
  onOkumaGerekli,
  esTalepId,
  onSecimNodeId,
}: {
  tenant: Kiraci;
  grupId: string;
  /** null = grup henüz okunmadı (okuma sürüyor) */
  grup: NodeGrup | null;
  okunuyor: boolean;
  onKapat: () => void;
  onAcildi: (r: NodeChangeResult) => void;
  /** sunucu "okuma bayat" dediyse üst bileşen yeniden okur */
  onOkumaGerekli: () => void;
  /** Ankara talebi: İstanbul talebinin numarası */
  esTalepId?: number | null;
  /** Ankara talebi: İstanbul'da seçilen node (yalnız aday listesinde varsa ön seçilir) */
  onSecimNodeId?: string | null;
}) {
  const [adim, setAdim] = useState(0);
  // null = kullanıcı henüz seçmedi: ön seçim (Ankara) okuma bittikten SONRA da uygulanabilsin.
  const [nodeSecim, setNodeId] = useState<string | null>(null);
  // null = kullanıcı dokunmadı: node taşıyan bileşenlerin HEPSİ (varsayılan birlikte).
  const [bilesenSecim, setBilesenSecim] = useState<string[] | null>(null);
  const [tutarsizOnay, setTutarsizOnay] = useState(false);
  const [gerekce, setGerekce] = useState('');
  const [onayKutusu, setOnayKutusu] = useState(false);
  const [onayYazi, setOnayYazi] = useState('');
  const [gonderiyor, setGonderiyor] = useState(false);
  const [hata, setHata] = useState('');
  // Çift tıklama iki bilet açmasın: state güncellemesi gelmeden ikinci tıklama da geçerdi.
  const gonderRef = useRef(false);

  const prod = tenant.production;
  const adaylar = grup?.adaylar || [];
  const onSecim = adaylar.find((x) => x.id === onSecimNodeId);
  const nodeId = nodeSecim ?? (onSecim && adaySecilebilir(onSecim) ? onSecim.id : '');
  const secilen = adaylar.find((a) => a.id === nodeId) || null;
  const bekle = okunuyor || !grup || grup.okumaBekleniyor;
  const katalogAdi = (id: string | null) =>
    id ? adaylar.find((a) => a.id === id)?.ad || id : METIN.katalogdaYok;
  const bilesenOf = (dep: string) =>
    grup?.deploymentlar.find((d) => d.ad === dep)?.bilesen || dep;
  const secilebilir = grup ? secilebilirler(grup) : [];
  const secim = bilesenSecim ?? secilebilir.map((d) => d.ad);
  const cokBilesen = !!grup && secimGoster(grup);
  // Seçilenler şu an farklı node'larda: hepsini tek node'a toplamak ek onay ister.
  const tutarsizSecim = !!grup && secimTutarsiz(grup, secim);
  const ayniNode = !!grup && !!secilen && secimAdaydaMi(grup, secim, secilen.id);
  const secimDegistir = (ad: string, acik: boolean) => {
    setBilesenSecim(acik ? Array.from(new Set([...secim, ad])) : secim.filter((x) => x !== ad));
    setTutarsizOnay(false);
  };

  const ileriAcik = (() => {
    if (bekle || !grup) return false;
    if (adim === 0) return secim.length > 0;
    if (adim === 1) return !!secilen && adaySecilebilir(secilen) && !ayniNode;
    if (adim === 2) return !tutarsizSecim || tutarsizOnay;
    if (adim === 3) return gerekceGecerli(gerekce);
    if (adim === 4) return prod ? onayMetniEslesir(onayYazi, grup.id) : onayKutusu;
    return true;
  })();

  async function talepAc() {
    if (!grup || !secilen || gonderRef.current) return;
    gonderRef.current = true;
    setGonderiyor(true);
    setHata('');
    try {
      const r = await cryptoNodeApi.change({
        tenant: tenant.key,
        grup: grup.id,
        nodeId: secilen.id,
        gerekce: gerekce.trim(),
        bilesenler: secim,
        tutarsizlikOnay: tutarsizSecim ? tutarsizOnay : false,
        ...(prod ? { onayMetni: onayYazi.trim() } : {}),
        ...(esTalepId ? { esTalepId } : {}),
      });
      if (r.ok) {
        onAcildi(r);
        return;
      }
      setHata(r.message || 'Talep açılamadı.');
      if (r.blocked === 'node_okuma_bayat') {
        setAdim(0);
        onOkumaGerekli();
      }
    } catch (e: unknown) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      gonderRef.current = false;
      setGonderiyor(false);
    }
  }

  const baslik = METIN.sihirbazBaslik(grup?.baslik || grupId);
  const footer = (
    <div className="flex items-center gap-2 flex-wrap">
      {adim < 4 ? (
        <button
          type="button"
          className="btn-primary"
          disabled={!ileriAcik}
          onClick={() => setAdim((a) => a + 1)}
        >
          {METIN.dugme.ileri}
        </button>
      ) : (
        <button
          type="button"
          className="btn-primary"
          disabled={!ileriAcik || gonderiyor}
          onClick={() => void talepAc()}
        >
          {gonderiyor ? METIN.dugme.gonderiliyor : METIN.dugme.talepAc}
        </button>
      )}
      {adim > 0 && (
        <button
          type="button"
          className="btn-secondary"
          disabled={gonderiyor}
          onClick={() => setAdim((a) => a - 1)}
        >
          {METIN.dugme.geri}
        </button>
      )}
      <button type="button" className="pf-btn-link" disabled={gonderiyor} onClick={onKapat}>
        {METIN.dugme.iptal}
      </button>
    </div>
  );

  return (
    <Modal
      open
      size="xl"
      title={baslik}
      subtitle={`${tenant.label} · ${tenant.lokasyon} · ${tenant.cluster} / ${tenant.namespace}`}
      onClose={onKapat}
      dismissOnBackdrop={false}
      footer={footer}
    >
      <div className="space-y-3 min-w-0">
        <ol className="flex items-center gap-2 flex-wrap text-[11px]" aria-label="Adımlar">
          {METIN.adimlar.map((a, i) => (
            <li
              key={a}
              aria-current={i === adim ? 'step' : undefined}
              className="px-2 py-0.5 rounded-md border"
              style={
                i === adim
                  ? { color: 'var(--accent)', borderColor: 'var(--accent)', background: 'var(--accent-bg)', fontWeight: 600 }
                  : { color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }
              }
            >
              {i + 1}. {a}
            </li>
          ))}
        </ol>

        {bekle && <Bilgi ton="info">{METIN.okunuyor}</Bilgi>}
        {hata && <Bilgi ton="danger">{hata}</Bilgi>}

        {grup && !bekle && adim === 0 && cokBilesen && (
          <fieldset className="rounded-lg border px-3 py-2 space-y-1.5 min-w-0" style={{ borderColor: 'var(--border-subtle)' }}>
            <legend className="px-1 text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
              {METIN.secimBaslik}
            </legend>
            <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              {METIN.secimAciklama}
            </p>
            {grup.tutarsiz && <Bilgi ton="warn">{METIN.secimFarkli}</Bilgi>}
            <ul className="space-y-1">
              {grup.deploymentlar.map((d) => {
                const secilir = secilebilir.some((x) => x.ad === d.ad);
                const id = `node-bilesen-${d.ad}`;
                return (
                  <li key={d.ad} className="flex items-start gap-2 text-[12px] min-w-0">
                    <input
                      id={id}
                      type="checkbox"
                      className="mt-0.5"
                      disabled={!secilir}
                      checked={secilir && secim.includes(d.ad)}
                      onChange={(e) => secimDegistir(d.ad, e.target.checked)}
                    />
                    <label htmlFor={id} className="min-w-0 break-all" style={{ color: 'var(--text-primary)' }}>
                      <b>{bilesenAdi(d)}</b>{' '}
                      <span style={{ color: 'var(--text-muted)' }}>
                        — {secilir ? METIN.secimMevcut(mevcutNodeMetni(d, grup.roller)) : METIN.secilemez}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {secim.length === 0 && <Bilgi ton="warn">{METIN.secimBos}</Bilgi>}
          </fieldset>
        )}

        {grup && !bekle && adim === 0 && (
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                  {METIN.mevcutBasliklar.map((b) => (
                    <th key={b} className="text-left font-medium px-2 py-1.5 whitespace-nowrap">
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grup.envler.map((e) => (
                  <tr
                    key={e.deployment + '/' + e.container + '/' + e.env}
                    className="border-t"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <td className="px-2 py-1.5 break-all" title={e.deployment}>
                      {bilesenOf(e.deployment)}
                    </td>
                    <td className="px-2 py-1.5 break-all">{e.container}</td>
                    <td className="px-2 py-1.5 break-all">{e.env}</td>
                    <td className="px-2 py-1.5 break-all">{e.maskeli}</td>
                    <td className="px-2 py-1.5 break-all">{katalogAdi(e.katalogId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {grup && !bekle && adim === 1 && (
          <div className="space-y-2">
            {adaylar.length === 0 ? (
              <Bilgi ton="warn">{METIN.adayYok}</Bilgi>
            ) : (
              <>
                <label
                  htmlFor="node-yeni"
                  className="block text-[12px] font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {METIN.yeniNodeEtiket}
                </label>
                <select
                  id="node-yeni"
                  className="w-full max-w-full text-[12px] rounded-lg border px-2 py-1.5"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                  value={nodeId}
                  onChange={(e) => setNodeId(e.target.value)}
                >
                  <option value="">{METIN.yeniNodeYerTutucu}</option>
                  {adaylar.map((a) => (
                    <option key={a.id} value={a.id} disabled={!adaySecilebilir(a)}>
                      {adayEtiketi(a, grup.roller)}
                    </option>
                  ))}
                </select>
                {ayniNode && <Bilgi ton="warn">{METIN.secimAyniNode}</Bilgi>}
              </>
            )}
          </div>
        )}

        {grup && !bekle && adim === 2 && (
          <div className="space-y-2 text-[12px]" style={{ color: 'var(--text-primary)' }}>
            <div>{METIN.etkiListe}</div>
            <ul className="list-disc pl-5 space-y-0.5">
              {etkilenenDeploymentlar(grup, secim).map((d) => (
                <li key={d} className="break-all">
                  {d}
                </li>
              ))}
            </ul>
            <Bilgi ton="info">{METIN.etkiDurustluk}</Bilgi>
            <Bilgi ton="warn">{METIN.etkiHelm}</Bilgi>
            {tutarsizSecim && (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={tutarsizOnay}
                  onChange={(e) => setTutarsizOnay(e.target.checked)}
                />
                <span>{METIN.tutarsizOnay}</span>
              </label>
            )}
            {tenant.esKiraci && <Bilgi ton="warn">{METIN.ankaraUyari(tenant.esKiraci)}</Bilgi>}
          </div>
        )}

        {grup && !bekle && adim === 3 && (
          <div className="space-y-1">
            <label
              htmlFor="node-gerekce"
              className="block text-[12px] font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              {METIN.gerekceEtiket}
            </label>
            <textarea
              id="node-gerekce"
              rows={4}
              maxLength={GEREKCE_EN_COK}
              className="w-full text-[12px] rounded-lg border px-2 py-1.5"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
              }}
              value={gerekce}
              onChange={(e) => setGerekce(e.target.value)}
            />
            <div
              className="text-[11px] text-right tabular-nums"
              style={{ color: gerekceGecerli(gerekce) ? 'var(--text-muted)' : 'var(--status-warning)' }}
            >
              {METIN.sayac(gerekce.trim().length)}
            </div>
          </div>
        )}

        {grup && !bekle && adim === 4 && (
          <div className="space-y-2 text-[12px]" style={{ color: 'var(--text-primary)' }}>
            <Bilgi ton="info">{METIN.onayBilgi}</Bilgi>
            {secilen && (
              <div className="break-all" style={{ color: 'var(--text-secondary)' }}>
                {METIN.yeniNodeEtiket}: {adayEtiketi(secilen, grup.roller)}
              </div>
            )}
            <div className="break-all" style={{ color: 'var(--text-secondary)' }}>
              {METIN.secimBaslik}: {secim.map(bilesenOf).join(', ')}
            </div>
            {prod ? (
              <div className="space-y-1">
                <label htmlFor="node-onay-yazi" className="block font-medium">
                  {METIN.onayProd(grup.id)}
                </label>
                <input
                  id="node-onay-yazi"
                  type="text"
                  autoComplete="off"
                  className="w-full text-[12px] rounded-lg border px-2 py-1.5"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                  value={onayYazi}
                  onChange={(e) => setOnayYazi(e.target.value)}
                />
              </div>
            ) : (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={onayKutusu}
                  onChange={(e) => setOnayKutusu(e.target.checked)}
                />
                <span>{METIN.onayTest}</span>
              </label>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
