// src/components/server_hub/EarEnvanterPlan.tsx — Uygulama Envanteri otomatik tarama planları ve kapsam seçici
// (2026-11-05).
//
// Kullanıcı: "haftada ayda x ayda bir olsun, opsiyonları da olsun ... 2 ayda bir tam, 4 haftada bir özet,
// manuel istenildiği gibi". İki plan kartı (P1 / P2); her biri sıklık, gün, saat, kip, kapsam ve başlangıç
// taşır. "Sonraki çalışmalar" sunucunun hesabıdır: ekran ve zamanlayıcı aynı şeyi görür. Planı açmak onay
// ister. KapsamSecici "Şimdi tara" penceresiyle ortaktır.
import React, { useState } from 'react';
import { earApi, type EarOzet, type EarPlanAlani, type EarOrtamSayisi } from '@/api/earEnvanterApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';
import { Modal } from '@/components/common/Modal';
import LoadError from '@/components/common/LoadError';
import { BTN, btnStil, GIRDI, girdiStil } from './EarEnvanterUi';

export const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const SIRALAR: [string, string][] = [
  ['ILK', 'ilk'],
  ['IKINCI', 'ikinci'],
  ['UCUNCU', 'üçüncü'],
  ['DORDUNCU', 'dördüncü'],
  ['SON', 'son'],
];
export type KapsamTuru = 'FILO' | 'SORUNLU' | 'ORTAM';
export interface KapsamDegeri {
  tur: KapsamTuru;
  ortamlar: string[];
}

/** Sunucunun kapsam dizgisi: FILO | SORUNLU | ORTAM:A,B */
export function kapsamDizgisi(k: KapsamDegeri): string {
  if (k.tur !== 'ORTAM') return k.tur;
  return `ORTAM:${[...new Set(k.ortamlar.map((o) => o.trim().toUpperCase()).filter(Boolean))].sort().join(',')}`;
}
export function kapsamAyristir(s: string | undefined): KapsamDegeri {
  if (s === 'SORUNLU') return { tur: 'SORUNLU', ortamlar: [] };
  if (s && s.startsWith('ORTAM:'))
    return { tur: 'ORTAM', ortamlar: s.slice(6).split(',').filter(Boolean) };
  return { tur: 'FILO', ortamlar: [] };
}

const KAPSAM_ACIKLAMA: Record<KapsamTuru, string> = {
  FILO: 'JBoss uygulama envanterindeki bütün sunucular.',
  SORUNLU: 'Son taraması tam olmayan ya da hiç taranmamış sunucular (kök yok sorun sayılmaz).',
  ORTAM: 'Yalnız seçilen ortamlardaki sunucular.',
};

/** Kapsam seçici: tür + (ORTAM için) envanterdeki ortamlar, sunucu sayısıyla. */
export function KapsamSecici({
  ad,
  deger,
  onChange,
  disabled = false,
  secimYok = false,
  radioAdi,
}: {
  ad: string;
  deger: KapsamDegeri;
  onChange: (k: KapsamDegeri) => void;
  disabled?: boolean;
  /** Dışarıdaki başka bir seçenek (ör. "Seçili sunucular") seçiliyken hiçbir tür işaretli görünmez. */
  secimYok?: boolean;
  /** Dışarıdaki radyolarla aynı grup (klavye ile gezinme). */
  radioAdi?: string;
}) {
  const [liste, setListe] = useState<EarOrtamSayisi[] | null>(null);
  const [hata, setHata] = useState('');
  const [ara, setAra] = useState('');
  const ortamGerek = !secimYok && deger.tur === 'ORTAM';
  useAsyncEffect(
    async (alive) => {
      if (!ortamGerek || liste) return;
      try {
        const r = await earApi.ortamlar();
        if (alive()) setListe(r.ortamlar);
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [ortamGerek, liste],
  );
  const secili = new Set(deger.ortamlar);
  const gorunen = (liste || []).filter(
    (o) => !ara || o.ortam.toLowerCase().includes(ara.toLowerCase()),
  );
  return (
    <div className="space-y-1">
      {(['FILO', 'SORUNLU', 'ORTAM'] as KapsamTuru[]).map((t) => (
        <label key={t} className="flex items-start gap-2 text-xs">
          <input
            type="radio"
            name={radioAdi || `${ad}-kapsam`}
            checked={!secimYok && deger.tur === t}
            disabled={disabled}
            onChange={() => onChange({ tur: t, ortamlar: t === 'ORTAM' ? deger.ortamlar : [] })}
          />
          <span>
            <b>{t === 'FILO' ? 'Tüm filo' : t === 'SORUNLU' ? 'Yalnız sorunlular' : 'Ortam seç'}</b>
            <span style={{ color: 'var(--text-muted)' }}> — {KAPSAM_ACIKLAMA[t]}</span>
          </span>
        </label>
      ))}
      {ortamGerek && (
        <div className="ml-5 space-y-1">
          {hata ? (
            <LoadError title="Ortam listesi okunamadı" message={hata} compact />
          ) : !liste ? (
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Ortamlar okunuyor…
            </div>
          ) : (
            <>
              {liste.length > 12 && (
                <input
                  aria-label={`${ad} ortam ara`}
                  className={`${GIRDI} w-44`}
                  style={girdiStil}
                  placeholder="ortam ara"
                  value={ara}
                  onChange={(e) => setAra(e.target.value)}
                />
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-1 max-h-32 overflow-y-auto">
                {gorunen.map((o) => (
                  <label key={o.ortam} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      aria-label={`${ad} ortam ${o.ortam}`}
                      checked={secili.has(o.ortam)}
                      disabled={disabled}
                      onChange={(e) =>
                        onChange({
                          tur: 'ORTAM',
                          ortamlar: e.target.checked
                            ? [...deger.ortamlar, o.ortam]
                            : deger.ortamlar.filter((x) => x !== o.ortam),
                        })
                      }
                    />
                    {o.ortam}
                    <span style={{ color: 'var(--text-muted)' }}>({fmtNumber(o.sunucu)})</span>
                  </label>
                ))}
              </div>
              {!deger.ortamlar.length && (
                <div className="text-[11px]" style={{ color: 'var(--status-warning-text)' }}>
                  En az bir ortam seçin.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const ALANLAR: EarPlanAlani[] = [
  'acik',
  'birim',
  'aralik',
  'gun',
  'sira',
  'saat',
  'kip',
  'kapsam',
  'baslangic',
];

function Alan({
  baslik,
  aciklama,
  children,
}: {
  baslik: string;
  aciklama: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 items-start py-1">
      <div className="text-xs font-medium pt-1">{baslik}</div>
      <div className="space-y-0.5">
        {children}
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {aciklama}
        </div>
      </div>
    </div>
  );
}

/** Tek plan kartı. Kaydet yalnız değişen alanları tek istekte gönderir. */
export function PlanKarti({
  plan,
  ozet,
  onKaydedildi,
}: {
  plan: 'p1' | 'p2';
  ozet: EarOzet;
  onKaydedildi: () => void;
}) {
  const a = ozet.ayarlar;
  const varsayilan = (k: EarPlanAlani) =>
    a.tanimlar.find((t) => t.anahtar === `${plan}_${k}`)?.varsayilan ?? '';
  const kayitli = Object.fromEntries(
    ALANLAR.map((k) => [k, a.deger[`${plan}_${k}`] ?? varsayilan(k)]),
  ) as Record<EarPlanAlani, string>;
  const [t, setT] = useState(kayitli);
  const [mesgul, setMesgul] = useState(false);
  const [onay, setOnay] = useState(false);
  const ozetPlan = (ozet.planlar || []).find((p) => p.ad === plan.toUpperCase());
  const degisen = ALANLAR.filter((k) => t[k] !== kayitli[k]);
  const kapsam = kapsamAyristir(t.kapsam);
  const kapsamEksik = kapsam.tur === 'ORTAM' && !kapsam.ortamlar.length;
  const kilitli = a.okunamadi;
  const ad = `Plan ${plan.slice(1)}`;
  const kaydet = async () => {
    setMesgul(true);
    try {
      await earApi.planYaz(plan, Object.fromEntries(degisen.map((k) => [k, t[k]])));
      toast.success(`${ad} kaydedildi.`);
      onKaydedildi();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMesgul(false);
      setOnay(false);
    }
  };
  const iste = () => (t.acik === 'ACIK' && kayitli.acik !== 'ACIK' ? setOnay(true) : kaydet());
  const sec = (k: EarPlanAlani, secenekler: [string, string][], etiket: string) => (
    <select
      aria-label={`${ad} ${etiket}`}
      className={GIRDI}
      style={girdiStil}
      value={t[k]}
      disabled={kilitli}
      onChange={(e) => setT({ ...t, [k]: e.target.value })}
    >
      {secenekler.map(([v, e]) => (
        <option key={v} value={v}>
          {e}
        </option>
      ))}
    </select>
  );
  const gunSecimi = sec(
    'gun',
    GUNLER.map((g, i) => [String(i), g]),
    'gün',
  );
  return (
    <section
      aria-label={ad}
      className="rounded-lg border px-3 py-2 space-y-1"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">
          {ad}{' '}
          <span
            className="font-normal"
            style={{
              color: kayitli.acik === 'ACIK' ? 'var(--text-secondary)' : 'var(--text-muted)',
            }}
          >
            · {kayitli.acik === 'ACIK' ? 'açık' : 'kapalı'}
          </span>
        </h3>
        <button
          type="button"
          className={BTN}
          style={btnStil(true)}
          disabled={kilitli || mesgul || !degisen.length || kapsamEksik}
          onClick={iste}
        >
          Kaydet
        </button>
      </div>
      {ozetPlan && (
        <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {ozetPlan.metin}
        </div>
      )}
      <Alan baslik="Durum" aciklama="Kapalıyken hiç çalışmaz; elle tarama her zaman yapılabilir.">
        {sec(
          'acik',
          [
            ['KAPALI', 'kapalı'],
            ['ACIK', 'açık'],
          ],
          'durum',
        )}
      </Alan>
      <Alan
        baslik="Sıklık"
        aciklama="Aralık başlangıç tarihinden sayılır (ör. her 2 ayda bir: başlangıç ayı, 2 ay sonrası …)."
      >
        <span className="flex items-center gap-1 text-xs">
          Her{' '}
          {sec(
            'aralik',
            Array.from({ length: 12 }, (_, i) => [String(i + 1), String(i + 1)]),
            'aralık',
          )}
          {sec(
            'birim',
            [
              ['HAFTA', 'haftada'],
              ['AY', 'ayda'],
            ],
            'birim',
          )}{' '}
          bir
        </span>
      </Alan>
      <Alan
        baslik="Gün"
        aciklama={
          t.birim === 'AY'
            ? 'Ayın ilk / son … günü: ağır tarama hep aynı hafta gününe denk gelir.'
            : 'Haftanın hangi günü çalışacağı.'
        }
      >
        {t.birim === 'AY' ? (
          <span className="flex items-center gap-1 text-xs">
            ayın {sec('sira', SIRALAR, 'sıra')} {gunSecimi}
          </span>
        ) : (
          gunSecimi
        )}
      </Alan>
      <Alan
        baslik="Saat (TR)"
        aciklama="Türkiye saati (UTC+3). Portal o an kapalıysa 24 saat içinde telafi edilir."
      >
        <input
          type="time"
          aria-label={`${ad} saat`}
          className={GIRDI}
          style={girdiStil}
          value={t.saat}
          disabled={kilitli}
          onChange={(e) => setT({ ...t, saat: e.target.value })}
        />
      </Alan>
      <Alan
        baslik="Kip"
        aciklama="ÖZET hızlıdır; TAM dosya ağacını ve .ear arşivinin içini de toplar."
      >
        {sec(
          'kip',
          [
            ['OZET', 'ÖZET'],
            ['TAM', 'TAM'],
          ],
          'kip',
        )}
      </Alan>
      <Alan baslik="Kapsam" aciklama="Hangi sunucuların taranacağı.">
        <KapsamSecici
          ad={ad}
          deger={kapsam}
          disabled={kilitli}
          onChange={(k) => setT({ ...t, kapsam: kapsamDizgisi(k) })}
        />
      </Alan>
      <Alan baslik="Başlangıç" aciklama="İlk çalışma bu gün ya da sonrasında olur.">
        <input
          type="date"
          aria-label={`${ad} başlangıç`}
          className={GIRDI}
          style={girdiStil}
          value={t.baslangic}
          disabled={kilitli}
          onChange={(e) => setT({ ...t, baslangic: e.target.value })}
        />
      </Alan>
      <div className="text-[11px] pt-1" style={{ color: 'var(--text-secondary)' }}>
        <b>Sonraki çalışmalar:</b>{' '}
        {ozetPlan && ozetPlan.sonraki.length
          ? ozetPlan.sonraki.map((s) => fmtDateTime(s)).join(' · ')
          : 'plan kapalı'}
        {degisen.length > 0 && ' (kaydedince güncellenir)'}
      </div>
      {onay && (
        <Modal
          open
          onClose={() => setOnay(false)}
          size="sm"
          title={`${ad} açılsın mı?`}
          footer={
            <>
              <button
                type="button"
                className={BTN}
                style={btnStil(true)}
                disabled={mesgul}
                onClick={kaydet}
              >
                Aç
              </button>
              <button
                type="button"
                className={BTN}
                style={btnStil()}
                onClick={() => setOnay(false)}
              >
                İptal
              </button>
            </>
          }
        >
          <p className="text-xs">
            Seçilen sıklıkta kapsamdaki bütün sunucular kendiliğinden taranır (salt okunur). Elle
            pilot taramayı yaptıysanız açın.
          </p>
        </Modal>
      )}
    </section>
  );
}

/** İki plan + öncelik notu. */
export function PlanlarGorunum({
  ozet,
  onKaydedildi,
}: {
  ozet: EarOzet;
  onKaydedildi: () => void;
}) {
  const d = ozet.ayarlar.deger;
  // Kaydedilen değer değişince kart yeniden kurulur (taslak sıfırlanır; effect'te setState yok).
  const anahtar = (p: string) =>
    Object.keys(d)
      .filter((k) => k.startsWith(`${p}_`))
      .map((k) => `${k}=${d[k]}`)
      .join('|');
  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        İki otomatik plan. Aynı güne bir ÖZET ve onu kapsayan bir TAM denk gelirse yalnız TAM
        çalışır (TAM, ÖZET'in topladığı her şeyi toplar). Aynı anda tek tarama koşar; sıradaki
        bekler.
      </p>
      <div className="grid gap-2 lg:grid-cols-2">
        <PlanKarti key={`p1:${anahtar('p1')}`} plan="p1" ozet={ozet} onKaydedildi={onKaydedildi} />
        <PlanKarti key={`p2:${anahtar('p2')}`} plan="p2" ozet={ozet} onKaydedildi={onKaydedildi} />
      </div>
    </div>
  );
}
