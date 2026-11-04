// src/components/server_hub/EarEnvanterTab.tsx — Server Hub › Uygulama Envanteri (2026-11-04).
//
// Kullanıcı: "/vhosting ve /vhosting8 altındaki EAR/WAR uygulamalarını ... ansible joblarla tarayıp db'ye
// yazarak ... server hub altında bir ek sayfa ... detay çıktı görünüm ui". Tarama SALT OKUNURDUR
// (bmw_portal/ear_envanter); sonuç haftalık otomatik ya da "Şimdi tara" ile gelir.
//
// Ekran: özet şeridi (son koşu, çalışan koşunun partileri, haftalık zaman, sayılar), görünümler
// (Uygulamalar · Eşlenikler · Kütüphaneler · Sunucular · Koşular · Ayarlar) ve uygulama ayrıntısı.
// Çalışan koşu varken özet 15 sn'de bir tazelenir. Haftalık tarama varsayılan KAPALI: pilot sonrası açılır.
import React, { useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, PlayIcon, StopIcon } from '@heroicons/react/24/outline';
import { earApi, earIndir, type EarOzet, type EarKip, type EarKapsam } from '@/api/earEnvanterApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { fmtNumber, fmtDateTime } from '@/utils/datetime';
import { Modal } from '@/components/common/Modal';
import LoadError from '@/components/common/LoadError';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { kosuDurumu, partiDurumu, partiIlerleme, hostListesiAyristir } from './earEnvanter';
import { Rozet, Kart, IndirBag, BTN, btnStil, GIRDI, girdiStil } from './EarEnvanterUi';
import {
  UygulamalarGorunum,
  EsleniklerGorunum,
  KutuphanelerGorunum,
  SunucularGorunum,
  KosularGorunum,
} from './EarEnvanterGorunumler';
import EarEnvanterDetay from './EarEnvanterDetay';

type Gorunum = 'uygulamalar' | 'eslenikler' | 'kutuphaneler' | 'sunucular' | 'kosular' | 'ayarlar';
const GORUNUMLER: { id: Gorunum; etiket: string }[] = [
  { id: 'uygulamalar', etiket: 'Uygulamalar' },
  { id: 'eslenikler', etiket: 'Eşlenikler' },
  { id: 'kutuphaneler', etiket: 'Kütüphaneler' },
  { id: 'sunucular', etiket: 'Sunucular' },
  { id: 'kosular', etiket: 'Koşular' },
  { id: 'ayarlar', etiket: 'Ayarlar' },
];
const YOKLAMA_MS = 15000;
const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const hataMetni = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── ŞİMDİ TARA ──────────────────────────────────────────────────────────────────────────────────
export function TaraPenceresi({
  onClose,
  onBasladi,
}: {
  onClose: () => void;
  onBasladi: () => void;
}) {
  const [kip, setKip] = useState<EarKip>('TAM');
  const [kapsam, setKapsam] = useState<EarKapsam>('SECILI');
  const [metin, setMetin] = useState('');
  const [filoOnay, setFiloOnay] = useState(false);
  const [hata, setHata] = useState('');
  const [mesgul, setMesgul] = useState(false);
  // Çift tıklama iki AWX işi açmasın: state render'da yakalanır, ref anında (double-submit bekçisi deseni).
  const busyRef = useRef(false);
  const { hostlar, gecersiz } = hostListesiAyristir(metin);
  const hazir = kapsam === 'FILO' ? filoOnay : hostlar.length > 0 && gecersiz.length === 0;
  const baslat = async () => {
    if (busyRef.current || !hazir) return;
    busyRef.current = true;
    setMesgul(true);
    setHata('');
    try {
      const r = await earApi.tara({
        kip,
        kapsam,
        ...(kapsam === 'SECILI' ? { hostlar: hostlar.join(' ') } : {}),
      });
      toast.success(
        `Tarama #${r.id} başladı: ${fmtNumber(r.beklenen)} sunucu, ${fmtNumber(r.partiSayisi)} parti.`,
      );
      onBasladi();
      onClose();
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      busyRef.current = false;
      setMesgul(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      dismissOnBackdrop={false}
      title="Uygulama Envanteri · Şimdi tara"
      subtitle="Salt okunur: hedefte hiçbir şey yazılmaz"
      footer={
        <>
          <button
            type="button"
            className={BTN}
            style={btnStil(true)}
            disabled={!hazir || mesgul}
            onClick={baslat}
          >
            <PlayIcon className="w-3.5 h-3.5" aria-hidden /> {mesgul ? 'Başlatılıyor…' : 'Başlat'}
          </button>
          <button type="button" className={BTN} style={btnStil()} onClick={onClose}>
            İptal
          </button>
        </>
      }
    >
      <div className="space-y-3 text-xs">
        <fieldset className="space-y-1">
          <legend className="font-semibold">Kip</legend>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="ear-kip"
              checked={kip === 'OZET'}
              onChange={() => setKip('OZET')}
            />
            <span>
              <b>ÖZET</b> — dosya başına stat yok; uygulama, WAR, kütüphane, sayılar. Hızlı.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="ear-kip"
              checked={kip === 'TAM'}
              onChange={() => setKip('TAM')}
            />
            <span>
              <b>TAM</b> — ÖZET + ls -lrtiR benzeri dosya ağacı ve .ear arşivinin içindeki WAR'lar.
            </span>
          </label>
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="font-semibold">Kapsam</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="ear-kapsam"
              checked={kapsam === 'SECILI'}
              onChange={() => setKapsam('SECILI')}
            />
            Seçili sunucular
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="ear-kapsam"
              checked={kapsam === 'FILO'}
              onChange={() => setKapsam('FILO')}
            />
            Tüm filo (JBoss uygulama envanterindeki bütün sunucular)
          </label>
        </fieldset>
        {kapsam === 'SECILI' ? (
          <div className="space-y-1">
            <textarea
              aria-label="Sunucu listesi"
              rows={5}
              className="w-full px-2 py-1 text-xs rounded-lg border font-mono"
              style={girdiStil}
              placeholder="her satıra bir sunucu (boşluk / virgül de olur)"
              value={metin}
              onChange={(e) => setMetin(e.target.value)}
            />
            <div
              style={{ color: gecersiz.length ? 'var(--status-danger-text)' : 'var(--text-muted)' }}
            >
              {fmtNumber(hostlar.length)} sunucu
              {gecersiz.length > 0 && ` · geçersiz ad: ${gecersiz.slice(0, 5).join(', ')}`}
            </div>
          </div>
        ) : (
          <label
            className="flex items-start gap-2 rounded-lg border px-3 py-2"
            style={{ borderColor: 'var(--status-warning)', background: 'var(--status-warning-bg)' }}
          >
            <input
              type="checkbox"
              checked={filoOnay}
              onChange={(e) => setFiloOnay(e.target.checked)}
            />
            <span style={{ color: 'var(--text-primary)' }}>
              Bütün filo partilere bölünüp sırayla taranacak (bin+ sunucuda saatler sürebilir). İlk
              kez çalıştırıyorsanız önce 1–5 sunucuyla deneyin. Onaylıyorum.
            </span>
          </label>
        )}
        {hata && <LoadError title="Tarama başlatılamadı" message={hata} compact />}
      </div>
    </Modal>
  );
}

// ── AYARLAR ─────────────────────────────────────────────────────────────────────────────────────
function AyarSatiri({
  anahtar,
  ad,
  deger,
  varsayilan,
  kayit,
  kilitli,
  onKaydedildi,
}: {
  anahtar: string;
  ad: string;
  deger: string;
  varsayilan: string;
  kayit?: { updatedBy: string | null; updatedAt: string | null };
  kilitli: boolean;
  onKaydedildi: () => void;
}) {
  const [taslak, setTaslak] = useState(deger);
  const [mesgul, setMesgul] = useState(false);
  const [onay, setOnay] = useState(false);
  const kaydet = async () => {
    setMesgul(true);
    try {
      await earApi.ayarYaz(anahtar, taslak);
      toast.success(`${ad} kaydedildi.`);
      onKaydedildi();
    } catch (e) {
      toast.error(hataMetni(e));
    } finally {
      setMesgul(false);
      setOnay(false);
    }
  };
  const iste = () =>
    anahtar === 'zamanlayici' && taslak === 'ACIK' && deger !== 'ACIK' ? setOnay(true) : kaydet();
  const secim = (secenekler: [string, string][]) => (
    <select
      aria-label={ad}
      className={GIRDI}
      style={girdiStil}
      value={taslak}
      disabled={kilitli}
      onChange={(e) => setTaslak(e.target.value)}
    >
      {secenekler.map(([v, e]) => (
        <option key={v} value={v}>
          {e}
        </option>
      ))}
    </select>
  );
  const denetim =
    anahtar === 'zamanlayici' ? (
      secim([
        ['KAPALI', 'kapalı'],
        ['ACIK', 'açık'],
      ])
    ) : anahtar === 'gun' ? (
      secim(GUNLER.map((g, i) => [String(i), g]))
    ) : anahtar === 'kip' ? (
      secim([
        ['TAM', 'TAM'],
        ['OZET', 'ÖZET'],
      ])
    ) : (
      <input
        aria-label={ad}
        className={`${GIRDI} w-48`}
        style={girdiStil}
        value={taslak}
        disabled={kilitli}
        onChange={(e) => setTaslak(e.target.value)}
      />
    );
  return (
    <tr className="border-t" style={{ borderColor: 'var(--border)' }}>
      <td className="px-2 py-1.5 text-xs">{ad}</td>
      <td className="px-2 py-1.5">{denetim}</td>
      <td className="px-2 py-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        varsayılan: {varsayilan === '' ? '(boş)' : varsayilan}
        {kayit &&
          kayit.updatedBy &&
          ` · ${kayit.updatedBy}${kayit.updatedAt ? `, ${fmtDateTime(kayit.updatedAt)}` : ''}`}
      </td>
      <td className="px-2 py-1.5">
        <button
          type="button"
          className={BTN}
          style={btnStil(true)}
          disabled={kilitli || mesgul || taslak === deger}
          onClick={iste}
        >
          Kaydet
        </button>
        {onay && (
          <Modal
            open
            onClose={() => setOnay(false)}
            size="sm"
            title="Haftalık filo taraması açılsın mı?"
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
              Her hafta seçilen gün ve saatte JBoss envanterindeki bütün sunucular taranır (salt
              okunur). Elle pilot taramayı yaptıysanız açın.
            </p>
          </Modal>
        )}
      </td>
    </tr>
  );
}

function AyarlarGorunum({ ozet, onKaydedildi }: { ozet: EarOzet; onKaydedildi: () => void }) {
  const a = ozet.ayarlar;
  return (
    <div className="space-y-2">
      {a.okunamadi && (
        <LoadError
          title="Ayarlar okunamadı; varsayılanlar geçerli, değişiklik kapalı"
          message={a.hata}
          compact
        />
      )}
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full">
          <tbody>
            {a.tanimlar.map((t) => (
              <AyarSatiri
                // Kaydedilen deger degisince satir yeniden kurulur (taslak sifirlanir; effect'te setState yok).
                key={`${t.anahtar}=${a.deger[t.anahtar] ?? t.varsayilan}`}
                anahtar={t.anahtar}
                ad={t.ad}
                deger={a.deger[t.anahtar] ?? t.varsayilan}
                varsayilan={t.varsayilan}
                kayit={a.kayitlar[t.anahtar]}
                kilitli={a.okunamadi}
                onKaydedildi={onKaydedildi}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Çıktı dizini: <span className="font-mono">{ozet.dizin}</span> (Admin › Sistem ›
        EAR_ENVANTER_DIR). AWX template: Admin › Playbook Kayıtları ›{' '}
        <span className="font-mono">{ozet.template.anahtar}</span>.
      </p>
    </div>
  );
}

// ── SEKME ───────────────────────────────────────────────────────────────────────────────────────
export default function EarEnvanterTab() {
  const [ozet, setOzet] = useState<EarOzet | null>(null);
  const [hata, setHata] = useState('');
  const [tazele, setTazele] = useState(0);
  const [gorunum, setGorunum] = useState<Gorunum>('uygulamalar');
  const [taraAcik, setTaraAcik] = useState(false);
  const [iptalAcik, setIptalAcik] = useState(false);
  const [iptalMesgul, setIptalMesgul] = useState(false);
  const [detay, setDetay] = useState<{ kosu: number; host: string; uyg: number } | null>(null);
  useAsyncEffect(
    async (alive) => {
      try {
        const r = await earApi.ozet();
        if (!alive()) return;
        setOzet(r);
        setHata('');
      } catch (e) {
        if (alive()) setHata(hataMetni(e));
      }
    },
    [tazele],
  );
  const aktifId = ozet && ozet.aktif ? ozet.aktif.id : null;
  useEffect(() => {
    if (aktifId == null) return undefined;
    const t = setInterval(() => setTazele((n) => n + 1), YOKLAMA_MS);
    return () => clearInterval(t);
  }, [aktifId]);
  const yenile = () => setTazele((n) => n + 1);
  const iptalEt = async () => {
    if (!ozet || !ozet.aktif) return;
    setIptalMesgul(true);
    try {
      await earApi.iptal(ozet.aktif.id);
      toast.info('Koşu iptal edildi; çalışan partinin sonuçları yine alınacak.');
      yenile();
    } catch (e) {
      toast.error(hataMetni(e));
    } finally {
      setIptalMesgul(false);
      setIptalAcik(false);
    }
  };

  if (hata && !ozet)
    return <LoadError title="Uygulama Envanteri okunamadı" message={hata} onRetry={yenile} />;
  if (!ozet)
    return (
      <div className="py-16 flex justify-center">
        <LoadingLogo />
      </div>
    );
  const { aktif, son, sayilar, zamanlayici, template } = ozet;
  const ilerleme = aktif ? partiIlerleme(aktif.partiler) : null;
  return (
    <div className="space-y-3">
      {!template.tanimli && (
        <div
          role="alert"
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: 'var(--status-warning)',
            background: 'var(--status-warning-bg)',
            color: 'var(--text-primary)',
          }}
        >
          AWX template'i tanımlı değil: Admin › Playbook Kayıtları ›{' '}
          <span className="font-mono">{template.anahtar}</span> satırına Template ID girilmeden
          tarama başlamaz (haftalık tarama da açılmaz). Template'te Variables için prompt on launch
          açık, Forks 50 olmalı.
        </div>
      )}
      {hata && (
        <LoadError
          title="Özet tazelenemedi (ekrandaki veri eski olabilir)"
          message={hata}
          onRetry={yenile}
          compact
        />
      )}
      <div className="flex flex-wrap items-stretch gap-2">
        <Kart baslik="Sunucu (veri var)" deger={sayilar ? fmtNumber(sayilar.host) : '—'} />
        <Kart baslik="Uygulama" deger={sayilar ? fmtNumber(sayilar.uygulama) : '—'} />
        <Kart
          baslik="Eksik taranan uygulama"
          deger={sayilar ? fmtNumber(sayilar.eksikUygulama) : '—'}
          ton={sayilar && sayilar.eksikUygulama > 0 ? 'uyari' : undefined}
        />
        <Kart baslik="WAR" deger={sayilar ? fmtNumber(sayilar.war) : '—'} />
        <Kart
          baslik="Son koşu"
          deger={son ? <Rozet d={kosuDurumu(son.durum)} /> : '—'}
          alt={
            son
              ? `#${son.id} · ${son.kip === 'TAM' ? 'TAM' : 'ÖZET'} · ${fmtNumber(son.tam)} tam, ${fmtNumber(son.kismi)} kısmi, ${fmtNumber(son.basarisiz)} başarısız · ${fmtDateTime(son.finished_at || son.created_at)}`
              : 'henüz tarama yok'
          }
        />
        <Kart
          baslik="Haftalık tarama"
          deger={zamanlayici.acik ? 'açık' : 'kapalı'}
          ton={zamanlayici.acik ? undefined : 'notr'}
          alt={
            zamanlayici.acik
              ? `${zamanlayici.metin}${zamanlayici.sonraki ? ` · sonraki ${fmtDateTime(zamanlayici.sonraki)}` : ''}`
              : 'Ayarlar sekmesinden açılır'
          }
        />
        <div className="ml-auto flex items-start gap-1">
          <button type="button" className={BTN} style={btnStil()} onClick={yenile} title="Tazele">
            <ArrowPathIcon className="w-3.5 h-3.5" aria-hidden /> Tazele
          </button>
          <button
            type="button"
            className={BTN}
            style={btnStil(true)}
            disabled={!!aktif || !template.tanimli}
            title={
              aktif
                ? 'Çalışan bir tarama var'
                : !template.tanimli
                  ? 'AWX template tanımlı değil'
                  : 'Salt okunur tarama başlat'
            }
            onClick={() => setTaraAcik(true)}
          >
            <PlayIcon className="w-3.5 h-3.5" aria-hidden /> Şimdi tara
          </button>
          <IndirBag href={earIndir.zip()} title="Son durum: 5 CSV + açıklama">
            Filo ZIP
          </IndirBag>
        </div>
      </div>
      {aktif && ilerleme && (
        <div
          className="rounded-lg border px-3 py-2 space-y-1.5"
          style={{ borderColor: 'var(--status-info)', background: 'var(--status-info-bg)' }}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Rozet d={kosuDurumu(aktif.durum)} />
            <span>
              Koşu #{aktif.id} · {aktif.kip === 'TAM' ? 'TAM' : 'ÖZET'} ·{' '}
              {aktif.kapsam === 'FILO' ? 'filo' : 'seçili'} · {fmtNumber(aktif.alinan ?? 0)} /{' '}
              {fmtNumber(aktif.beklenen)} sunucunun sonucu alındı
            </span>
            {ilerleme.calisan && (
              <span style={{ color: 'var(--text-muted)' }}>
                · parti {ilerleme.calisan.parti_no}/{aktif.parti_sayisi}
                {ilerleme.calisan.awx_job_id != null
                  ? ` (AWX ${ilerleme.calisan.awx_job_id}, ${ilerleme.calisan.awx_durum || '…'})`
                  : ''}
              </span>
            )}
            <button
              type="button"
              className={`${BTN} ml-auto`}
              style={btnStil()}
              onClick={() => setIptalAcik(true)}
            >
              <StopIcon className="w-3.5 h-3.5" aria-hidden /> İptal et
            </button>
          </div>
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: 'var(--bg-elevated)' }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={ilerleme.toplamHost}
            aria-valuenow={ilerleme.bitenHost}
          >
            <div
              className="h-full"
              style={{
                width: `${ilerleme.toplamHost ? Math.round((100 * ilerleme.bitenHost) / ilerleme.toplamHost) : 0}%`,
                background: 'var(--status-info)',
              }}
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {aktif.partiler.map((p) => (
              <span key={p.parti_no} title={p.hata || `${p.host_sayisi} sunucu`}>
                <Rozet
                  d={{
                    ...partiDurumu(p.durum),
                    etiket: `#${p.parti_no} ${partiDurumu(p.durum).etiket}`,
                  }}
                  kucuk
                />
              </span>
            ))}
          </div>
        </div>
      )}
      <div
        className="flex gap-1 rounded-lg p-0.5 w-fit"
        style={{ background: 'var(--bg-elevated)' }}
      >
        {GORUNUMLER.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGorunum(g.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border ${gorunum === g.id ? 'shadow-sm' : ''}`}
            style={{
              background: gorunum === g.id ? 'var(--bg-surface)' : 'transparent',
              borderColor: gorunum === g.id ? 'var(--border)' : 'transparent',
              color: gorunum === g.id ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {g.etiket}
          </button>
        ))}
      </div>
      {gorunum === 'uygulamalar' && (
        <UygulamalarGorunum onAc={(kosu, host, uyg) => setDetay({ kosu, host, uyg })} />
      )}
      {gorunum === 'eslenikler' && <EsleniklerGorunum />}
      {gorunum === 'kutuphaneler' && (
        <KutuphanelerGorunum onAc={(kosu, host, uyg) => setDetay({ kosu, host, uyg })} />
      )}
      {gorunum === 'sunucular' && <SunucularGorunum />}
      {gorunum === 'kosular' && <KosularGorunum tazeleme={tazele} />}
      {gorunum === 'ayarlar' && <AyarlarGorunum ozet={ozet} onKaydedildi={yenile} />}
      {taraAcik && <TaraPenceresi onClose={() => setTaraAcik(false)} onBasladi={yenile} />}
      {detay && <EarEnvanterDetay hedef={detay} onClose={() => setDetay(null)} />}
      {iptalAcik && aktif && (
        <Modal
          open
          onClose={() => setIptalAcik(false)}
          size="sm"
          title={`Koşu #${aktif.id} iptal edilsin mi?`}
          footer={
            <>
              <button
                type="button"
                className={BTN}
                style={btnStil(true)}
                disabled={iptalMesgul}
                onClick={iptalEt}
              >
                İptal et
              </button>
              <button
                type="button"
                className={BTN}
                style={btnStil()}
                onClick={() => setIptalAcik(false)}
              >
                Kapat
              </button>
            </>
          }
        >
          <p className="text-xs">
            Bekleyen partiler başlamaz; çalışan AWX işine iptal gönderilir. O ana kadar gelen
            sonuçlar saklanır.
          </p>
        </Modal>
      )}
    </div>
  );
}
