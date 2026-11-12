// src/components/app_hub/JvmParamDuzenle.tsx — JBoss JVM parametresi değiştir / ekle (2026-11-11).
//
// Akış: parametre yaz (ya da mevcut bir parametreye tıkla) → Önizle (plan; sunucuda hiçbir şey değişmez,
// AWX işi mevcut durumu okuyup ne yapılacağını söyler) → JVM adını yazıp Uygula (production'da Smart
// onayı açılır). Değişiklik host.xml'e yedekle yazılır; çalışan JVM'e YENİDEN BAŞLATMADA yansır.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import { appHubApi, type JvmParamDurum } from '@/api/appHubApi';
import { Modal } from '@/components/common/Modal';
import Button from '@/components/common/Button';
import { argBol } from './ortak';
import { duzenlemeBaslangici, eslesenler, parametreHatasi } from './jvmParam';

interface Props {
  host: string;
  gen: number;
  jvm: string;
  uygulama: string;
  /** Yapılandırmadaki (yoksa çalışan) parametreler; maskeli olabilir. */
  mevcut: string | null;
  onDegisti: () => void;
}

type Asama = 'giris' | 'plan' | 'planHazir' | 'uygulaniyor' | 'bitti';
const BEKLE_MS = 3000;

export default function JvmParamDuzenle({ host, gen, jvm, uygulama, mevcut, onDegisti }: Props) {
  const [acik, setAcik] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAcik(true)}
        className="inline-flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded border focus-visible:outline focus-visible:outline-2"
        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
      >
        <PencilSquareIcon className="w-3.5 h-3.5" /> Parametre değiştir / ekle
      </button>
      {acik && (
        <Pencere
          host={host}
          gen={gen}
          jvm={jvm}
          uygulama={uygulama}
          mevcut={mevcut}
          onKapat={() => setAcik(false)}
          onDegisti={onDegisti}
        />
      )}
    </>
  );
}

function Pencere({ host, gen, jvm, uygulama, mevcut, onKapat, onDegisti }: Omit<Props, never> & { onKapat: () => void }) {
  const [parametre, setParametre] = useState('');
  const [asama, setAsama] = useState<Asama>('giris');
  const [planMetni, setPlanMetni] = useState('');
  const [planParametresi, setPlanParametresi] = useState('');
  const [sonuc, setSonuc] = useState<{ ton: 'iyi' | 'uyari' | 'kritik' | 'bilgi'; metin: string } | null>(null);
  const [onay, setOnay] = useState('');
  const [hata, setHata] = useState('');
  const canli = useRef(true);
  // Basarili degisiklikten sonra sayfa yenilemesi PENCERE KAPANINCA (inceleme 2026-11-11): yenileme
  // JbossGorunum'u yeniden kurar ve pencere OK mesaji okunamadan kapanirdi.
  const degisti = useRef(false);
  useEffect(
    () => () => {
      canli.current = false;
    },
    [],
  );
  const kapat = () => {
    canli.current = false;
    onKapat();
    if (degisti.current) onDegisti();
  };

  const tokenlar = useMemo(() => argBol(mevcut).filter((t) => t.startsWith('-') && !t.startsWith('...')), [mevcut]);
  const temiz = parametre.trim();
  const dogrulamaHatasi = temiz ? parametreHatasi(temiz) : null;
  const eslesen = temiz && !dogrulamaHatasi ? eslesenler(tokenlar, temiz) : [];
  const planGecerli = asama === 'planHazir' && planParametresi === temiz;

  /** Is bitene kadar yoklar; GECICI okuma hatasini 3 kez tolere eder (tek 502 isi "basarisiz" gostermesin). */
  async function izle(serverId: number, jobId: number): Promise<JvmParamDurum | null> {
    let hataSay = 0;
    for (let i = 0; i < 200 && canli.current; i += 1) {
      try {
        const d = await appHubApi.jvmParamDurum(serverId, jobId);
        hataSay = 0;
        if (d.finished) return d;
      } catch (e) {
        hataSay += 1;
        if (hataSay >= 3) throw e;
      }
      await new Promise((r) => setTimeout(r, BEKLE_MS));
    }
    return null;
  }

  async function onizle() {
    setHata('');
    setSonuc(null);
    setAsama('plan');
    try {
      const r = await appHubApi.jvmParam({ host, gen, jvm, parametre: temiz, uygulama });
      if (!r.jobId || r.serverId == null) throw new Error('İş başlatılamadı.');
      const d = await izle(r.serverId, r.jobId);
      if (!canli.current) return;
      if (!d) throw new Error('İş zamanında bitmedi; AWX iş çıktısına bakın.');
      if (d.sonuc === 'PLAN') {
        setPlanMetni(d.mesaj || '');
        setPlanParametresi(temiz);
        setAsama('planHazir');
      } else if (d.sonuc === 'SKIP') {
        setSonuc({ ton: 'bilgi', metin: `Değişiklik gerekmiyor: ${d.mesaj || ''}` });
        setAsama('giris');
      } else {
        setSonuc({ ton: 'kritik', metin: d.mesaj || `İş başarısız (${d.status}).` });
        setAsama('giris');
      }
    } catch (e) {
      if (!canli.current) return;
      setHata(e instanceof Error ? e.message : String(e));
      setAsama('giris');
    }
  }

  async function uygula() {
    setHata('');
    setAsama('uygulaniyor');
    let isNo: number | null = null;
    try {
      const r = await appHubApi.jvmParam({ host, gen, jvm, parametre: temiz, uygulama, apply: true, onayMetni: onay.trim() });
      if (r.pendingApproval) {
        setSonuc({ ton: 'bilgi', metin: r.message || `Production değişikliği için Smart talebi açıldı (${r.externalTicketId || ''}). Onaydan sonra iş kendiliğinden başlar.` });
        setAsama('bitti');
        return;
      }
      if (!r.jobId || r.serverId == null) throw new Error(r.message || 'İş başlatılamadı.');
      isNo = r.jobId;
      const d = await izle(r.serverId, r.jobId);
      if (!canli.current) return;
      if (!d) throw new Error('İş zamanında bitmedi.');
      if (d.sonuc === 'OK') {
        degisti.current = true;
        setSonuc({ ton: 'iyi', metin: `${d.mesaj || 'Kaydedildi.'} Değişiklik JVM yeniden başlatıldığında yürürlüğe girer (yeniden başlatma: OpsX). Bu ekrandaki liste Server Hub sunucuyu yeniden taradığında güncellenir.` });
      } else if (d.sonuc === 'SKIP') setSonuc({ ton: 'bilgi', metin: d.mesaj || 'Değişiklik gerekmedi.' });
      else setSonuc({ ton: 'kritik', metin: d.mesaj || `İş başarısız (${d.status}).` });
      setAsama('bitti');
    } catch (e) {
      if (!canli.current) return;
      const m = e instanceof Error ? e.message : String(e);
      // Is BASLADIYSA "Uygula" yeniden acilmaz: ayni degisiklik ikinci kez baslatilabilirdi.
      if (isNo != null) {
        setSonuc({ ton: 'uyari', metin: `İş başlatıldı (AWX #${isNo}) ama sonucu okunamadı (${m}). AWX’ten kontrol edin; tekrar denemeden önce sayfayı yenileyin.` });
        setAsama('bitti');
      } else {
        setHata(m);
        setAsama('planHazir');
      }
    }
  }

  const mesgul = asama === 'plan' || asama === 'uygulaniyor';
  const TON: Record<string, string> = {
    iyi: 'var(--status-success)',
    uyari: 'var(--status-warning-text)',
    kritik: 'var(--status-danger)',
    bilgi: 'var(--status-info)',
  };

  return (
    <Modal
      open
      onClose={kapat}
      title="JVM parametresi değiştir / ekle"
      subtitle={`${jvm} · JBoss ${gen} · ${host}`}
      size="lg"
      dismissOnBackdrop={!mesgul}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={kapat}>
            {asama === 'bitti' ? 'Kapat' : mesgul ? 'Kapat (iş sürer)' : 'İptal'}
          </Button>
          {asama !== 'bitti' && !planGecerli && (
            <Button variant="secondary" onClick={onizle} disabled={mesgul || !temiz || !!dogrulamaHatasi}>
              {asama === 'plan' ? 'Önizleniyor…' : 'Önizle'}
            </Button>
          )}
          {planGecerli && (
            <Button variant="primary" onClick={uygula} disabled={mesgul || onay.trim() !== jvm}>
              Uygula
            </Button>
          )}
          {asama === 'uygulaniyor' && (
            <Button variant="primary" disabled>
              Uygulanıyor…
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4 text-[13px]" style={{ color: 'var(--text-primary)' }}>
        <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          Değişiklik bu JVM’in sunucu düzeyindeki tanımına (host.xml) yazılır; öncesinde yedek alınır. Çalışan JVM’e ancak
          <b> yeniden başlatıldığında</b> yansır. Production sunucuda uygulama Smart onayından geçer.
        </p>

        <div className="space-y-1.5">
          <label htmlFor="jvm-param-giris" className="block text-[12px] font-semibold">
            Parametre
          </label>
          <input
            id="jvm-param-giris"
            value={parametre}
            onChange={(e) => {
              setParametre(e.target.value);
              setSonuc(null);
              if (asama === 'planHazir') setAsama('giris');
            }}
            disabled={mesgul || asama === 'bitti'}
            placeholder="-Dozellik=deger   ·   -Xmx2g   ·   -XX:+UseG1GC"
            spellCheck={false}
            autoComplete="off"
            className="w-full h-9 px-3 rounded border text-[13px]"
            style={{ borderColor: dogrulamaHatasi ? 'var(--status-danger)' : 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
            aria-invalid={!!dogrulamaHatasi}
            aria-describedby="jvm-param-ipucu"
          />
          <p id="jvm-param-ipucu" className="text-[12px]" style={{ color: dogrulamaHatasi ? 'var(--status-danger)' : 'var(--text-muted)' }}>
            {dogrulamaHatasi ||
              (temiz
                ? eslesen.length
                  ? `Mevcut ${eslesen.join(', ')} yerine yazılacak.`
                  : 'Yeni parametre olarak eklenecek (grup düzeyinde aynısı varsa onu ezer).'
                : 'Değiştirmek için aşağıdan mevcut bir parametreye tıklayın ya da yeni parametreyi yazın.')}
          </p>
        </div>

        {tokenlar.length > 0 && asama !== 'bitti' && (
          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold">Mevcut parametreler</p>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {tokenlar.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={mesgul}
                  onClick={() => {
                    setParametre(duzenlemeBaslangici(t));
                    setSonuc(null);
                    if (asama === 'planHazir') setAsama('giris');
                  }}
                  className="px-2 py-0.5 rounded border text-[11px] text-left break-all focus-visible:outline focus-visible:outline-2"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-inset)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
                  title="Bu parametreyi değiştir"
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              *** ile gizlenen değerler gösterilmez; değiştirirken yeni değeri tam yazın.
            </p>
          </div>
        )}

        {planGecerli && (
          <div className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-inset)' }} data-testid="jvm-param-plan">
            <p className="text-[12px] font-semibold">Önizleme (sunucuda okunan duruma göre)</p>
            <p className="text-[12px] break-all" style={{ fontFamily: 'var(--font-mono)' }}>
              {planMetni}
            </p>
            <label htmlFor="jvm-param-onay" className="block text-[12px]">
              Uygulamak için JVM adını yazın: <b style={{ fontFamily: 'var(--font-mono)' }}>{jvm}</b>
            </label>
            <input
              id="jvm-param-onay"
              value={onay}
              onChange={(e) => setOnay(e.target.value)}
              disabled={mesgul}
              autoComplete="off"
              className="w-64 h-8 px-2 rounded border text-[13px]"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
            />
          </div>
        )}

        {mesgul && (
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }} role="status">
            {asama === 'plan' ? 'AWX işi sunucudaki mevcut durumu okuyor…' : 'AWX işi değişikliği uyguluyor…'}
          </p>
        )}
        {sonuc && (
          <p className="text-[13px]" style={{ color: TON[sonuc.ton] }} role="status" data-testid="jvm-param-sonuc">
            {sonuc.metin}
          </p>
        )}
        {hata && (
          <p className="text-[13px]" style={{ color: 'var(--status-danger)' }} role="alert">
            {hata}
          </p>
        )}
      </div>
    </Modal>
  );
}
