// src/components/crypto_hub/NodeDegisiklikModal.tsx — Indexer / Node değişikliği sihirbazı (2026-11-02).
//
// Beş adım: Mevcut → Yeni node → Etki → Gerekçe → Onay → "Talep aç" (Smart bileti). Smart'ın kapalı
// olduğu test kiracısında son adım işin onaysız başlayacağını söyler. Kullanıcı kararı 2026-11-03: node listesi YOK; kullanıcı grubun her rolü için
// yeni değeri kendisi yazar (iş birimi onaylı). Değer YALNIZ bu bileşenin state'inde durur: URL'ye,
// tarayıcı deposuna, console'a, hata metnine ya da `title` niteliğine girmez; ekranda yalnız
// maskeli hâli görünür. Biçim kuralı sunucuyla aynı modülden (shared/cryptoHubNodes.cjs). Bir rol
// boş bırakılabilir: env boş değere yazılır, bu ayrıca onaylanır. Plan, hedefler ve sha'lar
// sunucuda son okumadan kurulur. Bileşen seçimi (2026-11-02): node taşıyan bileşenlerin hepsi
// işaretli gelir; kullanıcı alt küme seçebilir, seçilenler arasında hepsi ya da hiçbiri uygulanır.
//
// Okuma bayatsa sihirbaz kendi başına bir şey yapmaz: üst bileşen okumayı başlatır ve `okunuyor`
// süresince ilerleme kapalıdır. Okuma sonrası grup değiştirilemez olursa üst bileşen sihirbazı
// engel metniyle kapatır.
import React, { useEffect, useRef, useState } from 'react';
import { ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/common/Modal';
import {
  cryptoNodeApi,
  type CryptoNodesResponse,
  type NodeChangeResult,
  type NodeGrup,
  type NodeSmartMod,
} from '@/api/cryptoHubApi';
import { maskele } from '../../../shared/cryptoHubNodes.cjs';
import {
  METIN,
  GEREKCE_EN_COK,
  ayniDegerMi,
  bilesenAdi,
  bosRoller,
  degerHatasi,
  etkilenenDeploymentlar,
  gerekceGecerli,
  mevcutNodeMetni,
  onayMetniEslesir,
  rolMaskeliListesi,
  secilebilirler,
  secimGoster,
  secimTutarsiz,
  yeniGecerli,
  yeniMaskeli,
} from './nodeOrtak';

type Kiraci = NonNullable<CryptoNodesResponse['tenant']>;

/** Sunucu bu kodlarla reddederse kullanıcı "Yeni node" adımına döner. */
const YENI_ADIM_KODLARI = ['node_ayni_node', 'node_deger_bicim', 'node_bos_onay'];
/** Sunucunun kararı ekrandaki metne uymadı: mod yeniden okunur, kullanıcı güncel metni onaylar. */
const SMART_DEGISTI_KODLARI = ['crypto_node_smart_mod_degisti', 'crypto_node_smart_degisti'];

const GIRDI_STIL: React.CSSProperties = {
  borderColor: 'var(--border)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
};

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
      className="text-[13px] rounded-lg px-3 py-2 border flex items-start gap-2"
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
  smartMod = 'onay',
  onSmartDegisti,
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
  /** Ankara talebi: İstanbul talebinin numarası (değer taşınmaz; kullanıcı yeniden yazar) */
  esTalepId?: number | null;
  /** 'kapali' ekran metnidir; karar sunucuda talep anında verilir */
  smartMod?: NodeSmartMod;
  /** sunucu "Smart ayarı değişti" dediyse üst bileşen smartMod'u yeniden okur */
  onSmartDegisti?: () => void;
}) {
  const [adim, setAdim] = useState(0);
  // rol -> yazılan değer. Yalnız burada; kırpılmaz (sır sessizce değişmesin).
  const [yeni, setYeni] = useState<Record<string, string>>({});
  // Onay, onaylandığı andaki BOŞ ROL LİSTESİNE bağlıdır: liste değişirse (başka rol boşaldı)
  // onay kendiliğinden düşer ve kutu yeniden işaretlenmelidir.
  const [bosOnayListe, setBosOnayListe] = useState<string | null>(null);
  // null = bilinmiyor (crypto.subtle yok ya da henüz hesaplanmadı)
  const [ayni, setAyni] = useState<boolean | null>(null);
  // null = kullanıcı dokunmadı: node taşıyan bileşenlerin HEPSİ (varsayılan birlikte).
  const [bilesenSecim, setBilesenSecim] = useState<string[] | null>(null);
  const [tutarsizOnay, setTutarsizOnay] = useState(false);
  const [gerekce, setGerekce] = useState('');
  // Kutu onaylandığı andaki metne bağlıdır (smartMod): metin değişirse onay kendiliğinden düşer.
  const [onayKutusuMod, setOnayKutusuMod] = useState<NodeSmartMod | null>(null);
  const onayKutusu = onayKutusuMod === smartMod;
  const [onayYazi, setOnayYazi] = useState('');
  const [gonderiyor, setGonderiyor] = useState(false);
  const [hata, setHata] = useState('');
  // Çift tıklama iki bilet açmasın: state güncellemesi gelmeden ikinci tıklama da geçerdi.
  const gonderRef = useRef(false);
  // Aynı-değer hesabı yarışı: yalnız SON çağrının sonucu yazılır.
  const ayniSira = useRef(0);

  const prod = tenant.production;
  const onaysiz = smartMod === 'kapali' && !prod;
  const bekle = okunuyor || !grup || grup.okumaBekleniyor;
  const bilesenOf = (dep: string) =>
    grup?.deploymentlar.find((d) => d.ad === dep)?.bilesen || dep;
  const secilebilir = grup ? secilebilirler(grup) : [];
  const secim = bilesenSecim ?? secilebilir.map((d) => d.ad);
  const secimAnahtari = secim.join('\n');
  const cokBilesen = !!grup && secimGoster(grup);
  // Seçilenler şu an farklı node'larda: hepsini tek değere toplamak ek onay ister.
  const tutarsizSecim = !!grup && secimTutarsiz(grup, secim);
  const yeniDeger = (rol: string) => yeni[rol] ?? '';
  const bosListe = grup ? bosRoller(grup, yeni) : [];
  const bosAnahtar = bosListe.join('\n');
  const bosOnay = bosListe.length > 0 && bosOnayListe === bosAnahtar;
  const secimDegistir = (ad: string, acik: boolean) => {
    setBilesenSecim(acik ? Array.from(new Set([...secim, ad])) : secim.filter((x) => x !== ad));
    setTutarsizOnay(false);
  };

  useEffect(() => {
    if (!grup) return;
    const sira = ++ayniSira.current;
    let iptal = false;
    void ayniDegerMi(grup, secimAnahtari ? secimAnahtari.split('\n') : [], yeni).then((s) => {
      if (!iptal && sira === ayniSira.current) setAyni(s);
    });
    return () => {
      iptal = true;
    };
  }, [grup, secimAnahtari, yeni]);

  const ileriAcik = (() => {
    if (bekle || !grup) return false;
    if (adim === 0) return secim.length > 0;
    if (adim === 1) return yeniGecerli(grup, yeni, bosOnay) && ayni !== true;
    if (adim === 2) return !tutarsizSecim || tutarsizOnay;
    if (adim === 3) return gerekceGecerli(gerekce);
    if (adim === 4) return prod ? onayMetniEslesir(onayYazi, grup.id) : onayKutusu;
    return true;
  })();

  async function talepAc() {
    if (!grup || gonderRef.current) return;
    gonderRef.current = true;
    setGonderiyor(true);
    setHata('');
    try {
      const r = await cryptoNodeApi.change({
        tenant: tenant.key,
        grup: grup.id,
        yeni: Object.fromEntries(grup.roller.map((x) => [x.rol, yeniDeger(x.rol)])),
        bosOnay: bosListe.length ? bosOnay : false,
        gerekce: gerekce.trim(),
        bilesenler: secim,
        tutarsizlikOnay: tutarsizSecim ? tutarsizOnay : false,
        ...(prod ? { onayMetni: onayYazi.trim() } : {}),
        ...(esTalepId ? { esTalepId } : {}),
        ...(onaysiz ? { onaysizKabul: true } : {}),
      });
      // Belirsiz launch: iş başlamış olabilir, satır açık. Sihirbazda kalmak ikinci denemeye iterdi.
      if (r.ok || (r.blocked === 'crypto_node_dogrudan_belirsiz' && r.talepId != null)) {
        setYeni({});
        onAcildi(r);
        return;
      }
      const neden = r.blocked === 'node_deger_bicim' && r.neden ? METIN.degerHata[r.neden] : null;
      setHata(neden ? `${r.rol ? r.rol + ': ' : ''}${neden}` : r.message || METIN.talepAcilamadi);
      if (r.blocked === 'node_okuma_bayat') {
        setAdim(0);
        onOkumaGerekli();
      } else if (r.blocked && YENI_ADIM_KODLARI.includes(r.blocked)) {
        setAdim(1);
      } else if (r.blocked && SMART_DEGISTI_KODLARI.includes(r.blocked)) {
        onSmartDegisti?.();
      }
    } catch (e: unknown) {
      // Geçit (Portal yeniden başlıyor) ve sunucunun çevrilmiş reddi (nginxRed: ayar eksik, yetki
      // yok; safeJson fırlatır) metni aynen gösterilir. Diğer hatalar yanıt gövdesi önizlemesi
      // taşıyabilir; değer taşıyabilecek metin gösterilmez.
      const i = (e && typeof e === 'object' ? e : {}) as { gatewayUnavailable?: boolean; nginxRed?: boolean };
      setHata((i.gatewayUnavailable || i.nginxRed) && e instanceof Error ? e.message : METIN.talepBaglantiHatasi);
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
          {onaysiz
            ? gonderiyor
              ? METIN.onaysiz.gonderiliyor
              : METIN.onaysiz.dugme
            : gonderiyor
              ? METIN.dugme.gonderiliyor
              : METIN.dugme.talepAc}
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
      size="wide"
      title={baslik}
      subtitle={`${tenant.label} · ${tenant.lokasyon} · ${tenant.cluster} / ${tenant.namespace}`}
      onClose={onKapat}
      dismissOnBackdrop={false}
      footer={footer}
    >
      <div className="space-y-3 min-w-0 text-[13px]">
        <ol className="flex items-center gap-2 flex-wrap text-[12px]" aria-label="Adımlar">
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
            <legend className="px-1 text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
              {METIN.secimBaslik}
            </legend>
            <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              {METIN.secimAciklama}
            </p>
            {grup.tutarsiz && <Bilgi ton="warn">{METIN.secimFarkli}</Bilgi>}
            <ul className="space-y-1">
              {grup.deploymentlar.map((d) => {
                const secilir = secilebilir.some((x) => x.ad === d.ad);
                const id = `node-bilesen-${d.ad}`;
                return (
                  <li key={d.ad} className="flex items-start gap-2 text-[13px] min-w-0">
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
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                  {METIN.mevcutBasliklar.map((b) => (
                    <th key={b} scope="col" className="text-left font-medium px-3 py-2 whitespace-nowrap">
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
                    <td className="px-3 py-2 break-all" title={e.deployment}>
                      {bilesenOf(e.deployment)}
                    </td>
                    <td className="px-3 py-2 break-all">{e.container}</td>
                    <td className="px-3 py-2 break-all">{e.env}</td>
                    <td className="px-3 py-2 break-all">{e.maskeli}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {grup && !bekle && adim === 1 && (
          <div className="space-y-3">
            <div className="space-y-0.5">
              <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {METIN.yeniBaslik}
              </div>
              <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                {onaysiz ? METIN.yeniAciklamaOnaysiz : METIN.yeniAciklama}
              </p>
            </div>
            {grup.roller.map((r) => {
              const id = `node-yeni-${r.rol}`;
              const deger = yeniDeger(r.rol);
              const hataMetni = deger !== '' ? degerHatasi(deger, r.bicim) : null;
              return (
                <div key={r.rol} className="space-y-1 min-w-0" data-rol={r.rol}>
                  <label htmlFor={id} className="block font-medium" style={{ color: 'var(--text-primary)' }}>
                    {METIN.rolEtiket(r.rol, METIN.bicimEtiketi[r.bicim] || r.bicim)}
                  </label>
                  <div id={`${id}-env`} className="text-[12px] break-all" style={{ color: 'var(--text-muted)' }}>
                    {METIN.rolEnvler(r.envler.join(', '))}
                  </div>
                  <input
                    id={id}
                    type={r.bicim === 'sir' ? 'password' : 'text'}
                    autoComplete="off"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    placeholder={METIN.yerTutucu[r.bicim] || ''}
                    className="w-full max-w-full text-[13px] rounded-lg border px-2 py-1.5 font-mono"
                    style={GIRDI_STIL}
                    aria-invalid={hataMetni ? true : undefined}
                    aria-describedby={`${id}-env ${id}-durum`}
                    value={deger}
                    onChange={(e) => {
                      const v = e.target.value;
                      setYeni((x) => ({ ...x, [r.rol]: v }));
                      // Rol boş/dolu değiştirdi: liste değişti, onay silinir (eski listeye
                      // dönülse de kendiliğinden geri gelmez).
                      if ((deger === '') !== (v === '')) setBosOnayListe(null);
                    }}
                  />
                  {hataMetni ? (
                    <div id={`${id}-durum`} role="alert" className="text-[12px]" style={{ color: 'var(--status-danger)' }}>
                      {hataMetni}
                    </div>
                  ) : deger !== '' ? (
                    <div id={`${id}-durum`} className="text-[12px] break-all" style={{ color: 'var(--text-muted)' }}>
                      {(onaysiz ? METIN.onaysiz.gorunum : METIN.smartGorunum)(maskele(deger, r.bicim))}
                    </div>
                  ) : (
                    <div id={`${id}-durum`} className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                      {METIN.bosRolNotu}
                    </div>
                  )}
                </div>
              );
            })}
            {bosListe.length > 0 && (
              <div className="space-y-1.5">
                <Bilgi ton="warn">{METIN.bosUyari(bosListe.join(', '))}</Bilgi>
                <label className="flex items-start gap-2" style={{ color: 'var(--text-primary)' }}>
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={bosOnay}
                    onChange={(e) => setBosOnayListe(e.target.checked ? bosAnahtar : null)}
                  />
                  <span>{METIN.bosOnayKutusu}</span>
                </label>
              </div>
            )}
            {ayni === true && <Bilgi ton="warn">{METIN.secimAyniNode}</Bilgi>}
          </div>
        )}

        {grup && !bekle && adim === 2 && (
          <div className="space-y-2" style={{ color: 'var(--text-primary)' }}>
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
            {bosListe.length > 0 && <Bilgi ton="warn">{METIN.bosUyari(bosListe.join(', '))}</Bilgi>}
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
              className="block font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              {METIN.gerekceEtiket}
            </label>
            <textarea
              id="node-gerekce"
              rows={4}
              maxLength={GEREKCE_EN_COK}
              className="w-full text-[13px] rounded-lg border px-2 py-1.5"
              style={GIRDI_STIL}
              value={gerekce}
              onChange={(e) => setGerekce(e.target.value)}
            />
            <div
              className="text-[12px] text-right tabular-nums"
              style={{ color: gerekceGecerli(gerekce) ? 'var(--text-muted)' : 'var(--status-warning)' }}
            >
              {METIN.sayac(gerekce.trim().length)}
            </div>
          </div>
        )}

        {grup && !bekle && adim === 4 && (
          <div className="space-y-2" style={{ color: 'var(--text-primary)' }}>
            {onaysiz ? <Bilgi ton="warn">{METIN.onaysiz.onayBilgi}</Bilgi> : <Bilgi ton="info">{METIN.onayBilgi}</Bilgi>}
            <div className="break-all" style={{ color: 'var(--text-secondary)' }}>
              {METIN.yeniNodeEtiket}: {rolMaskeliListesi(yeniMaskeli(grup, yeni), grup.roller)}
            </div>
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
                  className="w-full text-[13px] rounded-lg border px-2 py-1.5"
                  style={GIRDI_STIL}
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
                  onChange={(e) => setOnayKutusuMod(e.target.checked ? smartMod : null)}
                />
                <span>{onaysiz ? METIN.onaysiz.onayKutusu : METIN.onayTest}</span>
              </label>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
