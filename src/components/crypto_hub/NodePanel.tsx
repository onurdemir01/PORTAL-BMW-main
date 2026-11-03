// src/components/crypto_hub/NodePanel.tsx — Crypto Hub > "Indexer / Node" sekmesi (2026-11-02).
//
// Kullanıcı: Metaco indexer'larının node bağlantısı Portal'dan, Smart onayıyla değiştirilsin;
// eski tip zincirler de değiştirilebilsin; İstanbul ve Ankara ayrı talep; yalnız yetkisi olan
// kullanıcılar talep açsın.
//
// İLKELER
//  * DEĞER GÖSTERİLMEZ: sunucu yalnız maskeli gösterim + sha256 verir; kullanıcının yazdığı
//    yeni değer de ekranda yalnız maskeli görünür (sihirbaz).
//  * "Ölçülemedi" ≠ "yok": okuma düştüyse grup "Ölçülemedi" rozetini taşır ve değiştirilemez.
//  * Okuma tazeliği: "Değiştir" okuma 10 dakikadan eskiyse önce okumayı başlatır (kullanıcıya
//    ayrı bir "önce oku" adımı bırakılmaz); okuma sonrası grup değiştirilemez olduysa sihirbaz
//    engel metniyle kapanır.
//  * Talep açıldıktan sonra takip kartı çıkar; ekranda beklemek gerekmez.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import {
  cryptoNodeApi,
  type CryptoNodesResponse,
  type NodeChangeResult,
  type NodeEsTalepOnerisi,
  type NodeGrup,
  type NodeSmartOnizleme,
} from '@/api/cryptoHubApi';
import { Modal } from '@/components/common/Modal';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtDateTime } from '@/utils/datetime';
import {
  METIN,
  BILESENLER,
  DURUM_ETIKETI,
  bekleyenMetni,
  degistirDurumu,
  depEnvAdlari,
  durumTonu,
  grupRozetleri,
  mevcutNodeMetni,
  smartNo,
  talepGrupBasligi,
  uisOzetMetni,
} from './nodeOrtak';
import { NodeDegisiklikModal } from './NodeDegisiklikModal';
import { NodeRozet, NodeTakip, NODE_BTN, nodeBtnStil } from './NodeTakip';

const DEP_DURUM: Record<string, { metin: string; renk: string }> = {
  running: { metin: 'çalışıyor', renk: 'var(--status-success)' },
  degraded: { metin: 'eksik replika', renk: 'var(--status-warning)' },
  stopped: { metin: 'kapalı', renk: 'var(--text-muted)' },
};

function Bant({ ton, children }: { ton: 'info' | 'warn' | 'danger'; children: React.ReactNode }) {
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

function Etiket({ ad, children }: { ad: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {ad}
      </div>
      <div className="text-[12px] break-all" style={{ color: 'var(--text-primary)' }}>
        {children}
      </div>
    </div>
  );
}

// ── Grup kartı ───────────────────────────────────────────────────────────────────────
function GrupKarti({
  g,
  degistir,
  onDegistir,
  onBekleyen,
  admin,
  onOnizle,
}: {
  g: NodeGrup;
  degistir: { acik: boolean; neden: string | null };
  onDegistir: () => void;
  onBekleyen: (talepId: number) => void;
  admin: boolean;
  onOnizle: () => void;
}) {
  const rozetler = grupRozetleri(g);
  const okundu = g.envler.length > 0;
  // Yeni tip tablo: okuma yapildiysa (okumaBekleniyor false) env'i olmayan grup da "okundu"dur;
  // degiskenYok grubunda envler bos gelir ama "Henüz okunmadı" yanlis olurdu.
  const uisOkundu = okundu || g.okumaBekleniyor === false;
  const roller = g.roller.map((r) => r.rol);
  const uisTablo = g.tur === 'uis' && !!g.bilesenler;
  const uisOzet = uisTablo && uisOkundu ? uisOzetMetni(g) : null;
  return (
    <article
      className="rounded-xl border p-3 space-y-2 min-w-0"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      data-grup={g.id}
    >
      <header className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold break-all" style={{ color: 'var(--text-primary)' }}>
            {g.baslik}
          </div>
          <div className="text-[11px] break-all" style={{ color: 'var(--text-muted)' }}>
            {g.id}
          </div>
        </div>
        <NodeRozet ton="muted">{g.tur === 'uis' ? METIN.rozet.yeniTip : METIN.rozet.eskiTip}</NodeRozet>
        {admin && g.roller.length > 0 && g.envler.length > 0 && (
          <button type="button" className={NODE_BTN} style={nodeBtnStil()} onClick={onOnizle}>
            {METIN.smartOnizle}
          </button>
        )}
        <button
          type="button"
          className={NODE_BTN}
          style={nodeBtnStil()}
          disabled={!degistir.acik}
          title={degistir.acik ? undefined : degistir.neden || undefined}
          onClick={onDegistir}
        >
          <PencilSquareIcon className="h-3.5 w-3.5" /> {METIN.degistir}
        </button>
      </header>

      {g.bekleyen && (
        <button
          type="button"
          className="w-full text-left text-[12px] rounded-lg px-3 py-1.5 border"
          style={{
            color: 'var(--accent)',
            background: 'var(--accent-bg)',
            borderColor: 'var(--accent)',
          }}
          onClick={() => g.bekleyen && onBekleyen(g.bekleyen.talepId)}
        >
          {bekleyenMetni(g.bekleyen)}
        </button>
      )}

      {uisTablo ? (
        <div className="space-y-1 min-w-0">
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
            <table className="w-full text-[12px]" data-uis-tablo="">
              <thead>
                <tr style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                  {METIN.uisBasliklar.map((b) => (
                    <th key={b} scope="col" className="text-left font-medium px-2 py-1.5 whitespace-nowrap">
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BILESENLER.map((b) => {
                  const d = g.bilesenler ? g.bilesenler[b] : null;
                  const st = d ? DEP_DURUM[d.durum] : null;
                  return (
                    <tr
                      key={b}
                      data-bilesen={b}
                      className="border-t align-top"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <td className="px-2 py-1.5 font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {b}
                      </td>
                      {!d ? (
                        <td colSpan={4} className="px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>
                          {METIN.bilesenYok}
                        </td>
                      ) : (
                        <>
                          <td className="px-2 py-1.5 break-all" style={{ color: 'var(--text-primary)' }} title={d.ad}>
                            {d.ad}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: st?.renk }}>
                            {st?.metin} · {d.hazir ?? '—'} / {d.istenen ?? '—'}
                          </td>
                          <td className="px-2 py-1.5 break-all" style={{ color: 'var(--text-primary)' }}>
                            {depEnvAdlari(g, d.ad)}
                          </td>
                          <td className="px-2 py-1.5 break-all">
                            {!uisOkundu ? (
                              <span style={{ color: 'var(--text-muted)' }}>{METIN.okumaYok}</span>
                            ) : !d.nodeBagli ? (
                              <span style={{ color: 'var(--text-muted)' }}>{METIN.baglantiYok}</span>
                            ) : (
                              <span style={{ color: 'var(--text-primary)' }}>{mevcutNodeMetni(d, g.roller)}</span>
                            )}
                            {d.envFrom && (
                              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                {d.envFrom === 'olculemedi' ? METIN.envFromOlculemedi : METIN.envFromVar}
                              </div>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {uisOzet && (
            <div className="text-[12px] break-all" style={{ color: 'var(--text-secondary)' }}>
              {uisOzet}
            </div>
          )}
        </div>
      ) : (
        <ul className="space-y-0.5">
          {g.deploymentlar.map((d) => {
            const st = DEP_DURUM[d.durum];
            return (
              <li key={d.ad} className="text-[11px] break-all" style={{ color: 'var(--text-primary)' }}>
                {d.ad}{' '}
                <span style={{ color: st?.renk }}>
                  · {st?.metin} · {d.hazir ?? '—'} / {d.istenen ?? '—'}
                </span>
                {okundu && !d.nodeBagli && (
                  <span style={{ color: 'var(--text-muted)' }}> · {METIN.baglantiYok}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Eski tip kartın node satırları (yeni tip kartta tablo kapsar; eski tip görünümü aynen). */}
      {!uisTablo && (
        <div className="space-y-0.5">
          {!okundu ? (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {METIN.okumaYok}
            </div>
          ) : g.mevcutNode && !g.tutarsiz ? (
            roller.map((r) => (
              <div key={r} className="text-[12px] break-all" style={{ color: 'var(--text-primary)' }}>
                <b>{r}</b>: {g.mevcutNode?.maskeli[r] ?? '—'}
              </div>
            ))
          ) : (
            g.envler.map((e) => (
              <div
                key={e.deployment + '/' + e.container + '/' + e.env}
                className="text-[12px] break-all"
                style={{ color: 'var(--text-primary)' }}
              >
                <b>{e.rol}</b>: {e.maskeli}{' '}
                <span style={{ color: 'var(--text-muted)' }}>
                  ({e.deployment} / {e.env})
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {rozetler.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rozetler.map((r) => (
            <NodeRozet key={r.metin} ton={r.ton}>
              {r.metin}
            </NodeRozet>
          ))}
        </div>
      )}
    </article>
  );
}

// ── Admin: Smart önizleme (Smart'a GİTMEZ) ───────────────────────────────────────────
function SmartOnizlemeModal({
  tenantKey,
  g,
  onKapat,
}: {
  tenantKey: string;
  g: NodeGrup;
  onKapat: () => void;
}) {
  const [sonuc, setSonuc] = useState<NodeSmartOnizleme | null>(null);
  const [mesgul, setMesgul] = useState(false);
  const onizle = async () => {
    setMesgul(true);
    try {
      setSonuc(await cryptoNodeApi.smartOnizle({ tenant: tenantKey, grup: g.id }));
    } catch (e: unknown) {
      setSonuc({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setMesgul(false);
    }
  };
  return (
    <Modal
      open
      size="xl"
      title={`${METIN.smartOnizle} — ${g.baslik}`}
      subtitle="OpsX OpenShift Smart şablonu bu talep için nasıl doldurulur (Smart'a gönderilmez)"
      onClose={onKapat}
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={mesgul}
            onClick={() => void onizle()}
          >
            Önizle
          </button>
          <button type="button" className="pf-btn-link" onClick={onKapat}>
            {METIN.dugme.kapat}
          </button>
        </div>
      }
    >
      <div className="space-y-2 min-w-0">
        {sonuc && !sonuc.ok && <Bant ton="danger">{sonuc.message || sonuc.hata || 'Önizleme yapılamadı.'}</Bant>}
        {sonuc?.ok && (
          <div className="space-y-1">
            <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              Flow key: <b>{sonuc.flowKey || '—'}</b>
            </div>
            {sonuc.hata && <Bant ton="danger">{sonuc.hata}</Bant>}
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                    <th scope="col" className="text-left font-medium px-2 py-1.5">ElementName</th>
                    <th scope="col" className="text-left font-medium px-2 py-1.5">Değer</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(sonuc.metadata || {}).map(([k, v]) => (
                    <tr key={k} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-2 py-1.5 break-all font-medium">{k}</td>
                      <td className="px-2 py-1.5 break-all whitespace-pre-wrap">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────────────
export interface NodeBaslangic {
  grup: string;
  esTalepId: number | null;
}

interface Sihirbaz {
  grupId: string;
  esTalepId: number | null;
}

export function NodePanel({
  tenantKey,
  nodeAcik = true,
  baslangic,
  onBaslangicTuketildi,
  onAnkara,
  okumaAralikMs = 4000,
  takipAralikMs,
}: {
  tenantKey: string;
  /** /tenants `nodeOpen`: false ise istek atılmaz (sunucu da 403 döner) */
  nodeAcik?: boolean;
  /** Ankara önerisinden gelindiyse: sihirbaz bu grupla açılır */
  baslangic?: NodeBaslangic | null;
  onBaslangicTuketildi?: () => void;
  onAnkara?: (o: NodeEsTalepOnerisi) => void;
  okumaAralikMs?: number;
  takipAralikMs?: number;
}) {
  const [data, setData] = useState<CryptoNodesResponse | null>(null);
  const [hata, setHata] = useState('');
  const [uyari, setUyari] = useState('');
  const [okumaIs, setOkumaIs] = useState<{ serverId: number; jobId: number } | null>(null);
  const [okumaHata, setOkumaHata] = useState('');
  const [sihirbaz, setSihirbaz] = useState<Sihirbaz | null>(null);
  const [takip, setTakip] = useState<{ talepId: number; yeni: NodeChangeResult | null } | null>(
    null,
  );
  const [onizle, setOnizle] = useState<NodeGrup | null>(null);
  // PS6: Ankara önerisinden gelen İstanbul bağı, sihirbaz kapanıp yeniden açılsa da talep
  // açılana kadar grup başına tutulur (sunucu da bağı kendisi kurar; bu yalnız ilk tercih).
  const [esBag, setEsBag] = useState<Record<string, number>>({});

  // Okuma bitince açık sihirbazın grubu yeniden değerlendirilir; geri çağrı en güncel hâli görsün.
  const sihirbazRef = useRef<Sihirbaz | null>(null);
  useEffect(() => {
    sihirbazRef.current = sihirbaz;
  }, [sihirbaz]);
  const okumaIsRef = useRef<typeof okumaIs>(null);
  useEffect(() => {
    okumaIsRef.current = okumaIs;
  }, [okumaIs]);
  const baslangicRef = useRef<NodeBaslangic | null | undefined>(baslangic);

  const okumaBaslat = useCallback(async () => {
    if (okumaIsRef.current) return;
    setOkumaHata('');
    try {
      const r = await cryptoNodeApi.read(tenantKey);
      if (!r.ok || r.jobId == null || r.awxServerId == null) {
        setOkumaHata(r.message || 'Okuma başlatılamadı.');
        return;
      }
      const is = { serverId: r.awxServerId, jobId: r.jobId };
      okumaIsRef.current = is;
      setOkumaIs(is);
    } catch (e: unknown) {
      setOkumaHata(e instanceof Error ? e.message : String(e));
    }
  }, [tenantKey]);

  const yukle = useCallback(
    async (okumaSonrasi = false) => {
      try {
        const r = await cryptoNodeApi.nodes(tenantKey);
        if (!r.ok) {
          setHata(r.message || 'Node bilgisi alınamadı.');
          setData(null);
          return;
        }
        setHata('');
        setData(r);
        const ok = r.okuma;
        if (ok?.durum === 'suruyor' && ok.jobId != null && ok.awxServerId != null && !okumaIsRef.current) {
          setOkumaIs({ serverId: ok.awxServerId, jobId: ok.jobId });
        }
        // Ankara önerisinden gelindi: sihirbaz bu grupla bir kez açılır.
        const b = baslangicRef.current;
        if (b && b.grup) {
          baslangicRef.current = null;
          const es = b.esTalepId;
          if (es != null) setEsBag((x) => ({ ...x, [b.grup]: es }));
          setSihirbaz({ grupId: b.grup, esTalepId: b.esTalepId });
          onBaslangicTuketildi?.();
          if (ok?.durum !== 'taze') void okumaBaslat();
        }
        // Okuma bitti: sihirbazdaki grup artık değiştirilemiyorsa engel metniyle kapanır.
        const s = sihirbazRef.current;
        if (okumaSonrasi && s) {
          const g = (r.gruplar || []).find((x) => x.id === s.grupId);
          if (!g) {
            setSihirbaz(null);
            setUyari(`Grup bu kiracıda bulunamadı: ${s.grupId}`);
          } else if (!g.degistirilebilir) {
            setSihirbaz(null);
            setUyari(g.engel || METIN.rozet.olculemedi);
          }
        }
      } catch (e: unknown) {
        setHata(e instanceof Error ? e.message : String(e));
      }
    },
    // okumaBaslat ve geri çağrılar bilerek dışarıda: ref'lerle okunuyorlar.
    [tenantKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useAsyncEffect(
    async (alive) => {
      if (!nodeAcik || !alive()) return;
      await yukle();
    },
    [tenantKey, nodeAcik],
  );

  // Okuma işi: bitene dek aralıkla sorulur.
  useEffect(() => {
    if (!okumaIs) return;
    let iptal = false;
    let t: number | undefined;
    async function tur() {
      if (!okumaIs) return;
      try {
        const r = await cryptoNodeApi.readStatus(okumaIs.serverId, okumaIs.jobId);
        if (iptal) return;
        if (!r.ok) {
          setOkumaHata(r.message || 'Okuma durumu alınamadı.');
          okumaIsRef.current = null;
          setOkumaIs(null);
          return;
        }
        if (r.bitti) {
          if (r.status && r.status !== 'successful') {
            setOkumaHata(`Okuma işi ${r.status} ile bitti.`);
          }
          okumaIsRef.current = null;
          setOkumaIs(null);
          await yukle(true);
          return;
        }
      } catch (e: unknown) {
        if (iptal) return;
        setOkumaHata(e instanceof Error ? e.message : String(e));
        okumaIsRef.current = null;
        setOkumaIs(null);
        return;
      }
      if (!iptal) t = window.setTimeout(tur, okumaAralikMs);
    }
    t = window.setTimeout(tur, okumaAralikMs);
    return () => {
      iptal = true;
      if (t) window.clearTimeout(t);
    };
  }, [okumaIs, okumaAralikMs, yukle]);

  if (!nodeAcik) return <Bant ton="warn">{METIN.prodKapali}</Bant>;
  if (hata && !data) return <Bant ton="danger">{hata}</Bant>;
  if (!data) return <LoadingLogo compact />;

  const t = data.tenant;
  const yetki = data.yetki || { okuma: true, talep: false, admin: false };
  const okuma = data.okuma;
  const okunuyor = !!okumaIs || okuma?.durum === 'suruyor';
  const okumaTaze = okuma?.durum === 'taze';
  const gruplar = data.gruplar || [];
  const uis = gruplar.filter((g) => g.tur === 'uis');
  const eski = gruplar.filter((g) => g.tur === 'eski');
  const gecmis = data.gecmis || [];
  const basliklar = new Map(gruplar.map((g) => [g.id, g.baslik]));
  const sihirbazGrup = sihirbaz ? gruplar.find((g) => g.id === sihirbaz.grupId) || null : null;

  const degistirAc = (g: NodeGrup) => {
    setUyari('');
    setSihirbaz({ grupId: g.id, esTalepId: esBag[g.id] ?? null });
    if (!okumaTaze) void okumaBaslat();
  };

  const kartlar = (liste: NodeGrup[]) => (
    <div className="grid gap-3 xl:grid-cols-2">
      {liste.map((g) => (
        <GrupKarti
          key={g.id}
          g={g}
          degistir={degistirDurumu(g, {
            talep: yetki.talep,
            nodeAcik: t?.nodeAcik !== false,
            okumaTaze,
          })}
          onDegistir={() => degistirAc(g)}
          onBekleyen={(id) => setTakip({ talepId: id, yeni: null })}
          admin={yetki.admin}
          onOnizle={() => setOnizle(g)}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-4 min-w-0">
      <section
        className="rounded-xl border p-4 space-y-3"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold flex-1 min-w-0" style={{ color: 'var(--text-primary)' }}>
            {METIN.baslik}
          </h2>
          <button
            type="button"
            className={NODE_BTN}
            style={nodeBtnStil()}
            disabled={okunuyor}
            onClick={() => void okumaBaslat()}
          >
            <ArrowPathIcon className={'h-3.5 w-3.5 ' + (okunuyor ? 'animate-spin' : '')} />{' '}
            {METIN.okuDugme}
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Etiket ad={METIN.etiket.kiraci}>{t ? `${t.label} (${t.key})` : tenantKey}</Etiket>
          <Etiket ad={METIN.etiket.lokasyon}>{t?.lokasyon || '—'}</Etiket>
          <Etiket ad={METIN.etiket.cluster}>{t?.cluster || '—'}</Etiket>
          <Etiket ad={METIN.etiket.namespace}>{t?.namespace || '—'}</Etiket>
          <Etiket ad={METIN.etiket.tarama}>
            {data.tarama?.scanDate ? fmtDateTime(data.tarama.scanDate) : '—'}
          </Etiket>
          <Etiket ad={METIN.etiket.sonOkuma}>
            {okunuyor
              ? METIN.okunuyor
              : okuma?.at
                ? `${fmtDateTime(okuma.at)} · ${okuma.username || '—'}`
                : METIN.okumaYok}
            {!okunuyor && okuma?.durum === 'bayat' && (
              <span className="block text-[11px]" style={{ color: 'var(--status-warning)' }}>
                {METIN.okumaBayat}
              </span>
            )}
          </Etiket>
        </div>
      </section>

      {t && !t.nodeAcik && <Bant ton="warn">{METIN.prodKapali}</Bant>}
      {!yetki.talep && <Bant ton="info">{METIN.yetkiYok}</Bant>}
      {data.tarama?.eski && (
        <Bant ton="warn">
          {METIN.taramaEski(data.tarama.scanDate ? fmtDateTime(data.tarama.scanDate) : '—')}
        </Bant>
      )}
      {okuma?.eksik && <Bant ton="warn">{METIN.okumaEksik}</Bant>}
      {okumaHata && <Bant ton="danger">{okumaHata}</Bant>}
      {hata && <Bant ton="danger">{hata}</Bant>}
      {uyari && <Bant ton="warn">{uyari}</Bant>}

      {takip && (
        <NodeTakip
          key={takip.talepId}
          tenantKey={tenantKey}
          talepId={takip.talepId}
          yeniAcildi={takip.yeni}
          onAnkara={onAnkara}
          onKapat={() => setTakip(null)}
          onDegisti={() => void yukle()}
          aralikMs={takipAralikMs}
          admin={yetki.admin}
        />
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {METIN.bolumUis}
        </h3>
        {uis.length === 0 ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            —
          </div>
        ) : (
          kartlar(uis)
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {METIN.bolumEski}
        </h3>
        {eski.length === 0 ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {!okuma || okuma.durum === 'yok' || okunuyor ? METIN.eskiOkumaYok : '—'}
          </div>
        ) : (
          kartlar(eski)
        )}
      </section>

      <section
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      >
        <div
          className="px-3 py-2 text-[11px] uppercase tracking-wide border-b"
          style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}
        >
          {METIN.gecmisBaslik}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                {METIN.gecmisBasliklar.map((b) => (
                  <th key={b} scope="col" className="text-left font-medium px-3 py-2 whitespace-nowrap">
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gecmis.length === 0 && (
                <TableEmptyRow colSpan={6} title="Talep yok" description="Bu kiracıda henüz node değişikliği talebi açılmamış." />
              )}
              {gecmis.map((h) => (
                <tr key={h.talepId} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(h.createdAt)}</td>
                  <td className="px-3 py-2 break-all">{basliklar.get(h.grup) || talepGrupBasligi(h)}</td>
                  <td className="px-3 py-2 break-all">{h.yeniOzet || '—'}</td>
                  <td className="px-3 py-2 break-all">{h.username}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className={NODE_BTN}
                      style={nodeBtnStil()}
                      onClick={() => setTakip({ talepId: h.talepId, yeni: null })}
                    >
                      {smartNo(h.externalTicketId, h.talepId)}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <NodeRozet ton={durumTonu(h.durum)}>{DURUM_ETIKETI[h.durum] || h.durum}</NodeRozet>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {sihirbaz && t && (
        <NodeDegisiklikModal
          key={sihirbaz.grupId}
          tenant={t}
          grupId={sihirbaz.grupId}
          grup={sihirbazGrup}
          okunuyor={okunuyor || !okumaTaze}
          onKapat={() => setSihirbaz(null)}
          onOkumaGerekli={() => void okumaBaslat()}
          esTalepId={sihirbaz.esTalepId}
          onAcildi={(r) => {
            const gid = sihirbaz.grupId;
            setEsBag((x) => {
              const y = { ...x };
              delete y[gid];
              return y;
            });
            setSihirbaz(null);
            if (r.talepId != null) setTakip({ talepId: r.talepId, yeni: r });
            void yukle();
          }}
        />
      )}

      {onizle && <SmartOnizlemeModal tenantKey={tenantKey} g={onizle} onKapat={() => setOnizle(null)} />}
    </div>
  );
}
