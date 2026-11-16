// src/components/server_hub/RebootKontroluTab.tsx — Server Hub > Reboot Kontrolü (2026-10-08).
//
// Kullanıcı: "Çalışma öncesi ve sonrası çalıştıralım, sunucunun sorunsuz olduğundan emin olalım."
// Kural (kullanıcı, "mesele çok basit"): Nginx / Red Hat Apache / IBM Apache / CTG / JBoss 7 / JBoss 8 / WAS
// reboot öncesi çalışıyorduysa sonra da çalışmalı (kapalıysa açılır). JBoss ve WAS JVM'lerinde önce çalışıp
// kapanan açılır, önce yokken çalışan kapatılır — tek JVM. 2026-11-15 ("nasıl bulduysan öyle bırak"): reboot öncesi
// çalışmayan ÜRÜN de kapatılır (onay penceresi bunu kalın uyarıyla söyler). Python vb. izlenmez. Ekran ürün başına:
// "çalışıyordu → çalışıyor ✓". Ölçülemeyen sunucu sorunsuz SAYILMAZ.
// v4 (2026-11-16, rapor yöneticiye gidiyor): tek nedeni önce-boş olan sunucu uyarı değil, nötr "Karşılaştırma dışı";
// yönetici özeti ve sunucu↔komut köprüsü sunucudan (reboot-check.cjs yoneticiOzeti / komutSayaci) gelir.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, CameraIcon, WrenchScrewdriverIcon, CheckCircleIcon, ExclamationTriangleIcon, DocumentTextIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { rebootCheckApi, type RcKayit, type RcSunucuSonuc, type RcDegerlendirme, type RcOtomasyon, type RcYonetici } from '@/api/rebootCheckApi';
import { serverHubApi } from '@/api/serverHubApi';
import { useJobTracker } from '@/contexts/JobTrackerContext';
import { Modal } from '@/components/common/Modal';
import { fmtDateTime } from '@/utils/datetime';
import { toast } from '@/hooks/useToast';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { useSunucuLimiti, LimitNotu, limitAsildi } from './sunucuLimiti';
import { useSekmeGorunur } from './sekmeGorunurlugu';
import { DURUM, SONRA_ACIK, URUN_ADI, betikEskiMetni, betikSurumu, bilgiAyristir, goruntuAyristir, islemAyristir, kapatmaKorunan, nedenListesi, onceBos, onceNesilCevir, onceOzeti, rebootOldu, sunucuListesi, urunTablosu, type Durum, type IslemSatiri } from './rebootKontrolu';

// 2026-11-14 (ilk gerçek koşu): önce görüntüsü boş sunucu yeşil gösteriliyordu ve sonra "Sorunsuz" çıkıyordu.
// v3 (2026-11-15 akşam): boş önce görüntüsünde web ürünleri (Nginx/Apache/IHS) yine kapatılır.
// v4 (2026-11-16, kullanıcı seçimi "Her yerde kapat"): boş önce görüntüsünde çalışan HER ürün kapatılır (prod dahil).
const ONCE_BOS_METNI = 'Önce görüntüsünde izlenen ürün yok — uygulamalar zaten kapalıyken mi alındı? Reboot sonrası kontrol bu sunucuda çalışan her ürünü (Nginx/Apache/IHS/CTG/JBoss/WAS, prod dahil) kapatır; kapatılan her ürün kontrol edilecek.';
/** Kaydın önce görüntüsü boş (BOOT var, izlenen satır yok) sunucuları. */
function bosOnceSunuculari(k: RcKayit): string[] {
  const s = k.once.sonuc?.sunucular || {};
  return k.hosts.filter((h) => !!s[h]?.goruntu_ok && onceBos(goruntuAyristir(s[h]?.goruntu)));
}

const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const TON: Record<string, { renk: string; zemin: string }> = {
  ok: { renk: 'var(--status-success)', zemin: 'var(--status-success-bg)' },
  warning: { renk: 'var(--status-warning)', zemin: 'var(--status-warning-bg)' },
  danger: { renk: 'var(--status-danger)', zemin: 'var(--status-danger-bg)' },
  info: { renk: 'var(--status-info)', zemin: 'var(--status-info-bg)' },
  muted: { renk: 'var(--text-muted)', zemin: 'var(--bg-elevated)' },
};
const BTN = 'inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border whitespace-nowrap disabled:opacity-40';

function Rozet({ ton, children }: { ton: string; children: React.ReactNode }) {
  const t = TON[ton] || TON.muted;
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ color: t.renk, background: t.zemin }}>{children}</span>;
}

// CANLI GOSTERGE (2026-10-09, kullanici: "is calisiyorsa ekranda donen bir simge istiyorum; 'Suruyor'
// kelimesi isin gercekten calisip calismadigini anlamaya yetmiyor"). Donen simge + AWX'in ANLIK durumu
// (kuyrukta / calisiyor / okunamadi) + is numarasi + saniye saniye gecen sure.
function Doner({ renk = 'var(--status-info)' }: { renk?: string }) {
  return <span aria-hidden className="inline-block w-3.5 h-3.5 rounded-full border-2 animate-spin motion-reduce:animate-none" style={{ borderColor: renk, borderTopColor: 'transparent' }} />;
}
const AWX_DURUM: Record<string, string> = {
  new: 'AWX\'te oluşturuldu', pending: 'AWX kuyruğunda bekliyor', waiting: 'başlamak üzere', running: 'AWX\'te çalışıyor', okunamadi: 'AWX okunamadı — yeniden deneniyor',
};
function gecen(bas: string | null | undefined, simdi: number): string {
  if (!bas) return '';
  const s = Math.max(0, Math.floor((simdi - new Date(bas).getTime()) / 1000));
  return s < 60 ? `${s} sn` : `${Math.floor(s / 60)} dk ${String(s % 60).padStart(2, '0')} sn`;
}
function IsCanli({ k }: { k: RcKayit }) {
  const [simdi, setSimdi] = useState(() => Date.now());
  useEffect(() => {
    const z = window.setInterval(() => setSimdi(Date.now()), 1000);
    return () => window.clearInterval(z);
  }, []);
  const once = k.durum === 'once_kosuyor';
  const jobId = once ? k.once.jobId : k.sonra.jobId;
  const okunamadi = k.awxDurum === 'okunamadi';
  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12px]"
      style={{ borderColor: okunamadi ? 'var(--status-warning)' : 'var(--status-info)', background: okunamadi ? 'var(--status-warning-bg)' : 'var(--status-info-bg)' }}>
      <Doner renk={okunamadi ? 'var(--status-warning)' : 'var(--status-info)'} />
      <b>{once ? 'Reboot öncesi görüntü alınıyor' : 'Reboot sonrası kontrol ve düzeltme çalışıyor'}</b>
      <span>· {k.awxDurum ? AWX_DURUM[k.awxDurum] || `AWX: ${k.awxDurum}` : 'AWX durumu okunuyor…'}</span>
      {jobId ? <span style={{ color: 'var(--text-muted)' }}>· iş #{jobId}</span> : null}
      {k.fazBasladi && <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>· {gecen(k.fazBasladi, simdi)}</span>}
      <span className="ml-auto text-[11px]" style={{ color: 'var(--text-muted)' }}>5 sn'de bir tazelenir</span>
    </div>
  );
}

/** Kayit durumu; kosan fazda donen simgeyle (liste ve ayrinti basligi). */
function DurumRozeti({ durum }: { durum: string }) {
  const d = DURUM[durum];
  return (
    <Rozet ton={d?.ton || 'muted'}>
      <span className="inline-flex items-center gap-1">{/_kosuyor$/.test(durum) && <Doner />}{d?.etiket || durum}</span>
    </Rozet>
  );
}

function sunucuRozeti(d: RcDegerlendirme | undefined) {
  if (!d) return <Rozet ton="muted">—</Rozet>;
  if (d.durum === 'sorunsuz') return <Rozet ton="ok">Sorunsuz</Rozet>;
  if (d.durum === 'sorunlu') return <Rozet ton="danger">{d.kalan} fark kaldı</Rozet>;
  if (d.durum === 'kontrol') return <Rozet ton="warning">Kontrol gerekli</Rozet>;
  // v4: önce görüntüsü boş (tek neden) — uyarı değil, nötr.
  if (d.durum === 'kapsam_disi') return <Rozet ton="muted">Karşılaştırma dışı</Rozet>;
  return <Rozet ton="warning">Ölçülemedi</Rozet>;
}

const DURUM_RENK: Record<Durum, string> = { ok: 'var(--status-success)', sorun: 'var(--status-danger)', bilgi: 'var(--status-warning)' };
const DURUM_ISARET: Record<Durum, string> = { ok: '✓', sorun: '✗', bilgi: 'i' };

function IslemNotu({ x }: { x?: IslemSatiri }) {
  if (!x) return null;
  const renk = x.sonuc === 'OK' ? 'var(--status-success)' : x.sonuc === 'FAIL' ? 'var(--status-danger)' : 'var(--text-muted)';
  const ne = x.islem === 'baslat' ? 'açma' : 'kapatma';
  const sonuc = x.sonuc === 'OK' ? 'yapıldı' : x.sonuc === 'FAIL' ? 'BAŞARISIZ' : x.sonuc === 'SKIP' ? 'gerek kalmadı' : '?';
  return (
    <span className="text-[11px]" style={{ color: renk }} title={x.mesaj}>
      {ne} {sonuc}{x.sonuc === 'FAIL' && x.mesaj ? ` — ${x.mesaj}` : ''}
    </span>
  );
}

function SunucuSonra({ host, once, r, d }: { host: string; once: string[] | undefined; r: RcSunucuSonuc | undefined; d: RcDegerlendirme | undefined }) {
  const [acik, setAcik] = useState(d?.durum !== 'sorunsuz' && d?.durum !== 'kapsam_disi');
  // Eski sürüm önce görüntüsünün JBoss satırları yeni nesil kuralına çevrilir (2026-11-15; sunucu ve betikle aynı).
  const karsi = r?.son_olculdu ? r?.son_goruntu : r?.goruntu;
  const og = goruntuAyristir(onceNesilCevir(once, karsi).satirlar);
  const ig = goruntuAyristir(r?.goruntu);
  const sg = r?.son_olculdu ? goruntuAyristir(r?.son_goruntu) : null;
  const islem = islemAyristir(r?.islemler);
  // 2026-11-15: önce çalışmayan ürün kapatılır; yalnız kapatma kapısının koruduğu ürün "dokunulmadı" der.
  const tablo = urunTablosu(og, ig, sg, islem, new Set(), kapatmaKorunan(once), betikSurumu(r));
  const hata = bilgiAyristir(r?.plan).filter((b) => b.tur === 'HATA');
  const uyari = d?.neden || [];
  const bilgi = d?.bilgi || [];
  // Boş önce / eski sürüm zaten uyarı satırında yazılıysa plan notlarında tekrar edilmez.
  const neden = nedenListesi(r?.plan, uyari.length || bilgi.length ? ['BOS', 'ESKI', 'BELIRSIZ'] : []);
  const reboot = rebootOldu(og, ig);
  return (
    <div className="rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
      <button type="button" onClick={() => setAcik((x) => !x)} className="w-full flex items-center gap-3 px-3 py-2 text-left">
        <span className="font-mono text-sm font-semibold">{host}</span>
        {sunucuRozeti(d)}
        {reboot === false && <Rozet ton="warning">reboot olmamış görünüyor</Rozet>}
        {d?.otomasyon && <Rozet ton={OTOMASYON[d.otomasyon.sinif].ton}>{OTOMASYON[d.otomasyon.sinif].etiket}</Rozet>}
        <TeknolojiCipleri o={d?.otomasyon} />
        {d?.sebep && d.durum !== 'kontrol' && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>· {d.sebep}</span>}
        <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>{acik ? '▴' : '▾'}</span>
      </button>
      {acik && (
        <div className="px-3 pb-3 space-y-2 text-[12px]">
          {reboot !== null && (
            <div style={{ color: reboot ? 'var(--text-muted)' : 'var(--status-warning)' }}>
              {reboot ? 'Reboot doğrulandı (açılış kimliği değişmiş).' : 'Açılış kimliği reboot öncesiyle aynı — sunucu yeniden başlamamış olabilir.'}
            </div>
          )}
          {hata.map((b, i) => <div key={i} style={{ color: 'var(--status-danger)' }}>{b.mesaj}</div>)}
          {uyari.map((x, i) => (
            <div key={`k${i}`} className="flex items-start gap-1" style={{ color: 'var(--status-warning)' }}>
              <ExclamationTriangleIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{x}</span>
            </div>
          ))}
          {bilgi.map((x, i) => (
            <div key={`b${i}`} className="flex items-start gap-1" style={{ color: 'var(--text-muted)' }}>
              <InformationCircleIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{x}</span>
            </div>
          ))}
          {!r?.son_olculdu && <div style={{ color: 'var(--status-warning)' }}>Son durum ölçülemedi — sorunsuz sayılmadı.</div>}
          {r?.durulma === 'timeout' && (
            <div style={{ color: 'var(--text-muted)' }}>JVM planından önce süreç listesi beklenen sürede durulmadı; plan son görüntüyle yapıldı.</div>
          )}
          {r?.durulma === 'error' && (
            <div style={{ color: 'var(--status-warning)' }}>Durulma beklemesinde süreç listesi hiç okunamadı; JVM planı çalışmadı — JVM'ler açılıp kapatılmadı.</div>
          )}
          {neden.length > 0 && (
            <div className="rounded border px-2 py-1" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Plan notları — neden dokunulmadı / nasıl sayıldı</div>
              <ul className="list-disc pl-4 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                {neden.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          )}
          {tablo.length === 0 ? <div style={{ color: 'var(--text-muted)' }}>Bu sunucuda izlenen ürün (Nginx, Apache, IHS, CTG, JBoss, WAS) yok.</div> : (
            <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
              {tablo.map((u) => (
                <li key={u.urun} className="py-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="w-4 text-center font-semibold" style={{ color: DURUM_RENK[u.durum] }}>{DURUM_ISARET[u.durum]}</span>
                    <span className="font-semibold w-36">{u.ad}</span>
                    <span style={{ color: u.durum === 'ok' ? 'var(--text-secondary)' : DURUM_RENK[u.durum] }}>{u.metin}</span>
                    <IslemNotu x={u.islem} />
                    {u.onceCikarim && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>(önce görüntüsünde ürün satırı yoktu — JVM'inden çalışıyor sayıldı)</span>}
                  </div>
                  {(u.jvmAyni > 0 || u.jvmDegisim.length > 0) && (
                    <div className="pl-[10.5rem] mt-0.5 space-y-0.5">
                      {u.jvmAyni > 0 && <div style={{ color: 'var(--text-muted)' }}>{u.jvmAyni} JVM önceki gibi çalışıyor</div>}
                      {u.jvmDegisim.map((j) => (
                        <div key={j.ad} className="flex flex-wrap items-baseline gap-x-2">
                          <span className="w-4 text-center" style={{ color: DURUM_RENK[j.durum] }}>{DURUM_ISARET[j.durum]}</span>
                          <span className="font-mono text-[11px]">{j.ad}</span>
                          <span style={{ color: j.durum === 'ok' ? 'var(--text-secondary)' : DURUM_RENK[j.durum] }}>{j.metin}</span>
                          <IslemNotu x={j.islem} />
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// OTOMASYON + SON DURUM FİLTRESİ (v3, kullanıcı: "otomasyon başarılı ve başarısızı net ayırmıyor, dokunmayı da ayırmıyor;
// sunucuda hangi teknolojiyi çalıştırdın çalıştırmadın belirt"). Otomasyon sınıfı ve teknoloji listesi SUNUCUDAN gelir
// (reboot-check.cjs otomasyonOzeti; rapor aynı kaynağı kullanır) — istemci yeniden hesaplamaz. İki grup AND ile uygulanır.
type OFiltre = 'tum' | 'basarili' | 'basarisiz' | 'dokunmadi';
type SFiltre = 'tum' | 'sorunsuz' | 'kontrol' | 'sorunlu' | 'kapsam_disi';
const O_ADI: Record<OFiltre, string> = { tum: 'Tümü', basarili: 'Başarılı', basarisiz: 'Başarısız', dokunmadi: 'Dokunmadı' };
const S_ADI: Record<SFiltre, string> = { tum: 'Tümü', sorunsuz: 'Sorunsuz', kontrol: 'Kontrol gerekli', sorunlu: 'Sorun kaldı', kapsam_disi: 'Karşılaştırma dışı' };
const OTOMASYON: Record<RcOtomasyon['sinif'], { etiket: string; ton: string; renk: string }> = {
  basarili: { etiket: 'Otomasyon başarılı', ton: 'ok', renk: 'var(--status-success)' },
  basarisiz: { etiket: 'Otomasyon başarısız', ton: 'danger', renk: 'var(--status-danger)' },
  dokunmadi: { etiket: 'Otomasyon dokunmadı', ton: 'muted', renk: 'var(--text-secondary)' },
};
const SON_RENK: Record<Exclude<SFiltre, 'tum'>, string> = { sorunsuz: 'var(--status-success)', kontrol: 'var(--status-warning)', sorunlu: 'var(--status-danger)', kapsam_disi: 'var(--text-secondary)' };
/** Son durum grubu: ölçülemeyen "Sorun kaldı" sayılır (sorunsuz SAYILMAZ); v4 karşılaştırma dışı ayrı grup. */
function sonDurum(d: RcDegerlendirme | undefined): Exclude<SFiltre, 'tum'> {
  if (d?.durum === 'sorunsuz' || d?.durum === 'kontrol' || d?.durum === 'kapsam_disi') return d.durum;
  return 'sorunlu';
}

/** Sunucu başlığındaki teknoloji çipleri: çalıştırılanlar (✓/✗ özetiyle) ve "çalıştırılmadı: … (neden)". */
function TeknolojiCipleri({ o }: { o?: RcOtomasyon }) {
  if (!o) return <span className="text-[11px]" style={{ color: 'var(--text-muted)' }} title="Kayıt otomasyon özeti olmadan hesaplanmış">—</span>;
  const ad = (u: string, yedek: string) => URUN_ADI[u] || yedek;
  const calisan = o.teknoloji.filter((t) => t.calistirildi);
  const calismayan = o.teknoloji.filter((t) => !t.calistirildi);
  return (
    <span className="flex flex-wrap items-center gap-1 text-[11px]">
      {o.not && <span style={{ color: 'var(--status-danger)' }}>{o.not}</span>}
      {calisan.map((t) => (
        <span key={t.urun} className="px-1.5 py-0.5 rounded"
          style={t.sonuc === 'hata' ? { color: 'var(--status-danger)', background: 'var(--status-danger-bg)' } : { color: 'var(--status-success)', background: 'var(--status-success-bg)' }}>
          {ad(t.urun, t.ad)}: {t.ozet}
        </span>
      ))}
      {calismayan.length > 0 && (
        <span style={{ color: 'var(--text-muted)' }}>çalıştırılmadı: {calismayan.map((t) => `${ad(t.urun, t.ad)} (${t.ozet})`).join(', ')}</span>
      )}
    </span>
  );
}

function FiltreGrubu<F extends string>({ etiket, adlar, secili, sec, say }: { etiket: string; adlar: Record<F, string>; secili: F; sec: (f: F) => void; say: (f: F) => number }) {
  return (
    <div role="group" aria-label={`${etiket} filtresi`} className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold w-20" style={{ color: 'var(--text-muted)' }}>{etiket}</span>
      {(Object.keys(adlar) as F[]).map((f) => (
        <button key={f} type="button" aria-pressed={secili === f} onClick={() => sec(f)}
          className="h-7 px-2.5 rounded-full border text-[11px] font-medium"
          style={secili === f ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--text-on-accent)' } : { borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
          {adlar[f]} <span className="tabular-nums">({say(f)})</span>
        </button>
      ))}
    </div>
  );
}

// YÖNETİCİ ÖZETİ (v4, kullanıcı: "%'sel olarak işin öncesi/sonrası ne kadar karşılandı … executive summary gibi"). Sayılar
// sunucudan (reboot-check.cjs yoneticiOzeti; Durum Raporu aynı kaynağı kullanır) — istemci yeniden hesaplamaz.
function YoneticiOzeti({ y }: { y: RcYonetici }) {
  // İnceleme Y7: ana metrik (bırakılan) kontrol notlu sunucuyu da sayar; altında kontrol notlu / gerçekten kontrol bekleyen /
  // sorun kalan yazılır (Durum Raporu anaEk ile aynı). Alan yoksa (eski kayıt) satır yazılmaz.
  const sn = y.sunucu;
  const anaEk = sn.birakilanKontrolNotlu === undefined || sn.kontrolBekleyen === undefined
    ? ''
    : `kontrol notlu ${sn.birakilanKontrolNotlu} · kontrol bekleyen ${sn.kontrolBekleyen} · sorun kalan ${sn.sorunlu}`;
  const kutular: [string, RcYonetici['oran']['birakildi'], string][] = [
    ['Bulunduğu gibi bırakıldı', y.oran.birakildi, 'sunucu'],
    ['Reboot öncesi hale dönüş', y.oran.donus, 'öğe'],
    // İnceleme Y10: payda komut sayısıdır (ürün kapatma tek komutla JVM'lerini de kapatır).
    ['Otomasyon başarı oranı', y.oran.otomasyon, 'komut'],
    ['İlk sapmalardan kapatılan', y.oran.kapanan, 'öğe'],
  ];
  return (
    <div role="group" aria-label="Yönetici özeti" className="rounded-lg border px-3 py-2 space-y-1.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
      <div className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Yönetici özeti</div>
      <div className="grid gap-1.5 text-[12px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(9.5rem, 1fr))' }}>
        {kutular.map(([etiket, o, birim], i) => (
          <div key={etiket} className="rounded-lg border px-3 py-1.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
            <div className="text-lg font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{o.metin}</div>
            <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{o.pay} / {o.payda} {birim}</div>
            <div style={{ color: 'var(--text-secondary)' }}>{etiket}</div>
            {i === 0 && anaEk && <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{anaEk}</div>}
          </div>
        ))}
      </div>
      <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{y.metin}</p>
    </div>
  );
}

function Kutu({ sayi, etiket, renk }: { sayi: number; etiket: string; renk: string }) {
  return (
    <div className="rounded-lg border px-3 py-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="text-lg font-semibold tabular-nums" style={{ color: renk }}>{sayi}</div>
      <div style={{ color: 'var(--text-muted)' }}>{etiket}</div>
    </div>
  );
}

/** "x / y sunucu sorunsuz": karşılaştırma dışı sunucular paydadan çıkarılır (v4). */
function SorunsuzOzeti({ s }: { s: NonNullable<NonNullable<RcKayit['ozet']>['sonra']> }) {
  const payda = s.toplam - (s.kapsamDisi || 0);
  let renk = 'var(--status-danger)';
  if (payda === 0) renk = 'var(--text-muted)';
  else if (s.sorunsuz === payda) renk = 'var(--status-success)';
  else if (s.sorunsuz + (s.kontrol || 0) === payda) renk = 'var(--status-warning)';
  return <span className="ml-2" style={{ color: renk }}>{s.sorunsuz} / {payda} sunucu sorunsuz</span>;
}

/** Sunucu sayan kutular ile komut sayan Otomatik Düzeltme arasındaki köprü (v4; sayılar sunucu komutSayaci'ndan). */
function KomutKoprusu({ c }: { c: RcYonetici['komut'] }) {
  return (
    <span className="block mt-0.5 tabular-nums">
      Komut bazında: <b>{c.ok}</b> başarılı · <b>{c.fail}</b> başarısız · <b>{c.skip}</b> gerek kalmadı ({c.sunucu} sunucuda {c.komut} komut). Bir sunucuda birden çok komut olabilir; "gerek kalmadı" komutları otomasyonun dokunduğu sayılmaz; komutu başarılı dönüp son kontrolde hedefte olmayan öğe (<b>{c.okHedefteDegil}</b>) sunucuyu "otomasyon başarısız" yapar.
      {c.okOlculemedi ? <> Komutu başarılı dönüp son durumu ölçülemediği için doğrulanamayan: <b>{c.okOlculemedi}</b>.</> : null}
    </span>
  );
}

function Ayrinti({ k, onSonra, busy }: { k: RcKayit; onSonra: () => void; busy: boolean }) {
  const onceS = k.once.sonuc?.sunucular || {};
  const sonraS = k.sonra.sonuc?.sunucular || {};
  const deg = k.ozet?.sonra?.sunucu || {};
  const sonraHazir = SONRA_ACIK.includes(k.durum);
  const [oFiltre, setOFiltre] = useState<OFiltre>('tum');
  const [sFiltre, setSFiltre] = useState<SFiltre>('tum');
  const tumHosts = Object.keys(deg);
  const oUyar = (h: string, f: OFiltre) => f === 'tum' || deg[h]?.otomasyon?.sinif === f;
  const sUyar = (h: string, f: SFiltre) => f === 'tum' || sonDurum(deg[h]) === f;
  // Düğme sayıları diğer grubun seçimiyle daraltılır (iki grup AND); kutular tüm sunucuları sayar.
  const oSay = (f: OFiltre) => tumHosts.filter((h) => oUyar(h, f) && sUyar(h, sFiltre)).length;
  const sSay = (f: SFiltre) => tumHosts.filter((h) => sUyar(h, f) && oUyar(h, oFiltre)).length;
  const oToplam = (f: OFiltre) => tumHosts.filter((h) => oUyar(h, f)).length;
  const sToplam = (f: SFiltre) => tumHosts.filter((h) => sUyar(h, f)).length;
  const sonraHosts = tumHosts.filter((h) => oUyar(h, oFiltre) && sUyar(h, sFiltre));
  // SÜRÜM BANDI (v3 B3): AWX'teki betik eskiyse kayıt düzeyinde TEK bant (sunucu kartlarında ayrıca neden olarak yazılır).
  const eskiHosts = k.durum === 'sonra_kosuyor' ? [] : tumHosts.filter((h) => sonraS[h] && !sonraS[h].sonuc_yok && !betikSurumu(sonraS[h]).guncel);
  const eskiEtiket = [...new Set(eskiHosts.map((h) => betikSurumu(sonraS[h]).etiket))];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Kayıt #{k.id}</span>
        <DurumRozeti durum={k.durum} />
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{k.olusturan} · {fmtDateTime(k.olusturuldu)}{k.not ? ` · ${k.not}` : ''}</span>
        {/* DURUM RAPORU: ekip arkadasinin patch-aggregate-report.py tasarimi (server/server-hub/reboot-rapor.cjs). */}
        <a href={`/api/server-hub/reboot-check/${k.id}/rapor`} target="_blank" rel="noopener noreferrer" className={`${BTN} ml-auto no-underline`}
          style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }} title="Patch Reboot Durum Raporu — yeni sekmede açılır, e-postaya yapıştırılabilir">
          <DocumentTextIcon className="w-4 h-4" /> Durum raporu
        </a>
        <button type="button" disabled={!sonraHazir || busy} onClick={onSonra} className={BTN}
          style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--text-on-accent)' }}
          title={sonraHazir ? 'Reboot yapıldıktan sonra çalıştırın' : 'Önce görüntüsü hazır değil'}>
          <WrenchScrewdriverIcon className="w-4 h-4" /> Reboot sonrası kontrol et ve düzelt
        </button>
      </div>

      {k.durum === 'once_kosuyor' && <IsCanli k={k} />}
      {eskiHosts.length > 0 && (
        <div role="alert" className="flex items-start gap-1.5 rounded-lg border px-3 py-2 text-[12px]"
          style={{ borderColor: 'var(--status-danger)', background: 'var(--status-danger-bg)', color: 'var(--status-danger)' }}>
          <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 shrink-0" />
          <span><b>{betikEskiMetni(eskiEtiket)}</b> ({eskiHosts.length} sunucu)</span>
        </div>
      )}

      <section className="space-y-1.5">
        <div className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>1 · Reboot öncesi görüntü {k.once.at ? `(${fmtDateTime(k.once.at)})` : ''}</div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(18rem, 1fr))' }}>
          {k.hosts.map((h) => {
            const r = onceS[h];
            const g = goruntuAyristir(r?.goruntu);
            const oz = onceOzeti(g);
            const alindi = !!r?.goruntu_ok && g.bicimTamam;
            const bos = alindi && onceBos(g);
            return (
              <details key={h} open={bos || undefined} className="rounded-lg border px-3 py-2" style={{ borderColor: bos ? 'var(--status-warning)' : 'var(--border-subtle)' }}>
                <summary className="cursor-pointer flex items-center gap-2 text-sm">
                  <span className="font-mono font-semibold">{h}</span>
                  {k.durum === 'once_kosuyor' ? <Rozet ton="info"><span className="inline-flex items-center gap-1"><Doner /> alınıyor</span></Rozet>
                    : bos ? <Rozet ton="warning">izlenen ürün yok</Rozet>
                    : alindi ? <Rozet ton="ok">{`${oz.length} ürün kaydedildi`}</Rozet>
                      : r?.goruntu_ok ? (
                        // BOOT satiri yok = gorutuyu ESKI playbook (patch-snapshot.sh) aldi. Yeni kayitta
                        // gorunuyorsa AWX projesindeki reboot_check.yml guncel degildir (2026-10-09, job 3391026).
                        <span title="Görüntüyü eski playbook aldı (patch-snapshot.sh). AWX projesindeki reboot_check.yml ve scripts/reboot_goruntu.sh güncel değil — ZIP'i uygulayıp projeyi Sync edin, sonra yeniden alın.">
                          <Rozet ton="warning">eski playbook — AWX güncel değil</Rozet>
                        </span>
                      )
                        : <Rozet ton="danger">alınamadı</Rozet>}
                </summary>
                {bos ? (
                  <div className="mt-1 flex items-start gap-1 text-[12px]" style={{ color: 'var(--status-warning)' }}>
                    <ExclamationTriangleIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{ONCE_BOS_METNI}</span>
                  </div>
                ) : alindi && oz.length > 0 ? (
                  <ul className="mt-1 text-[12px] space-y-0.5">
                    {oz.map((o) => (
                      <li key={o.urun}>
                        {o.ad}{o.jvm !== null ? <span style={{ color: 'var(--text-muted)' }}> · {o.jvm} JVM</span> : null}
                        {o.urunSatiriYok && <span style={{ color: 'var(--status-warning)' }}> · ürün satırı yok (JVM'inden çalışıyor sayılır)</span>}
                      </li>
                    ))}
                  </ul>
                ) : r?.goruntu_hata ? <div className="mt-1 text-[11px]" style={{ color: 'var(--status-danger)' }}>{r.goruntu_hata}</div> : null}
              </details>
            );
          })}
        </div>
      </section>

      <section className="space-y-1.5">
        <div className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          2 · Reboot sonrası kontrol ve düzeltme {k.sonra.at ? `(${fmtDateTime(k.sonra.at)})` : ''}
          {k.ozet?.sonra && <SorunsuzOzeti s={k.ozet.sonra} />}
          {k.ozet?.sonra?.kontrol ? <span className="ml-2" style={{ color: 'var(--status-warning)' }}>{k.ozet.sonra.kontrol} sunucuda kontrol gerekli</span> : null}
          {k.ozet?.sonra?.kapsamDisi ? <span className="ml-2" style={{ color: 'var(--text-muted)' }}>{k.ozet.sonra.kapsamDisi} sunucu karşılaştırma dışı</span> : null}
        </div>
        {k.durum === 'sonra_kosuyor' ? <IsCanli k={k} />
          : tumHosts.length === 0 ? <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Henüz çalıştırılmadı. Reboot'u yaptıktan sonra yukarıdaki düğmeyi kullanın.</div>
            : (
              <div className="space-y-2">
                {k.ozet?.sonra?.yonetici && <YoneticiOzeti y={k.ozet.sonra.yonetici} />}
                <div className="grid gap-1.5 text-[12px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(9.5rem, 1fr))' }}>
                  {(['basarili', 'basarisiz', 'dokunmadi'] as const).map((f) => <Kutu key={f} sayi={oToplam(f)} etiket={OTOMASYON[f].etiket} renk={OTOMASYON[f].renk} />)}
                </div>
                <div className="grid gap-1.5 text-[12px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(9.5rem, 1fr))' }}>
                  {(['sorunsuz', 'kontrol', 'sorunlu', 'kapsam_disi'] as const).map((f) => <Kutu key={f} sayi={sToplam(f)} etiket={S_ADI[f]} renk={SON_RENK[f]} />)}
                </div>
                <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Sayılar <b>sunucu</b> sayısıdır. Otomasyon: <b>dokunmadı</b> = hiç açma/kapatma komutu çalışmadı (gerek kalmayanlar sayılmaz); <b>başarılı</b> = çalışan her komut başarılı ve dokunduğu her öğe son kontrolde hedef durumda; <b>başarısız</b> = bir komut başarısız ya da dokunduğu öğe son kontrolde hedefte değil / ölçülemedi. Alt satır son kontroldeki durumdur; <b>karşılaştırma dışı</b> = reboot öncesi izlenen uygulama çalışmıyordu (uyarı değildir).
                  {k.ozet?.sonra?.yonetici && <KomutKoprusu c={k.ozet.sonra.yonetici.komut} />}
                </div>
                <FiltreGrubu etiket="Otomasyon" adlar={O_ADI} secili={oFiltre} sec={setOFiltre} say={oSay} />
                <FiltreGrubu etiket="Son durum" adlar={S_ADI} secili={sFiltre} sec={setSFiltre} say={sSay} />
                {sonraHosts.length === 0 ? <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Bu filtrede sunucu yok.</div>
                  : <div className="space-y-1.5">{sonraHosts.map((h) => <SunucuSonra key={h} host={h} once={onceS[h]?.goruntu} r={sonraS[h]} d={deg[h]} />)}</div>}
              </div>
            )}
      </section>
    </div>
  );
}

export default function RebootKontroluTab() {
  const { addJob } = useJobTracker();
  const [kayitlar, setKayitlar] = useState<RcKayit[]>([]);
  const [secili, setSecili] = useState<RcKayit | null>(null);
  const [metin, setMetin] = useState('');
  const [not, setNot] = useState('');
  const [busy, setBusy] = useState(false);
  const [onay, setOnay] = useState(false);
  const [bilinen, setBilinen] = useState<Set<string> | null>(null);
  const gorunur = useSekmeGorunur();
  const seciliId = useRef<number | null>(null);

  const yukle = useCallback(async () => {
    try {
      const r = await rebootCheckApi.list();
      if (r.ok) setKayitlar(r.kayitlar || []);
      else toast.error(r.message || 'Kayıtlar alınamadı.');
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); }
  }, []);
  const ac = useCallback(async (id: number) => {
    seciliId.current = id;
    try {
      const r = await rebootCheckApi.get(id);
      if (r.ok && r.kayit && seciliId.current === id) setSecili(r.kayit);
      else if (!r.ok) toast.error(r.message || 'Kayıt alınamadı.');
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); }
  }, []);
  useAsyncEffect(async (alive) => { if (alive()) await yukle(); }, [yukle]);
  useEffect(() => {
    // Yalniz sunucu adlari: tum filo degerlendirmesini (/overview) indirmez.
    serverHubApi.hostAdlari().then((o) => { if (o.ok) setBilinen(new Set(o.hosts)); }).catch(() => {});
  }, []);
  // Koşan kayıt açıksa 10 sn'de bir tazele (sunucu AWX sonucunu okuyup kayda yazar).
  useEffect(() => {
    if (!secili || !/_kosuyor$/.test(secili.durum) || !gorunur) return;
    const t = window.setInterval(() => { void ac(secili.id); void yukle(); }, 5000);
    return () => window.clearInterval(t);
  }, [secili, ac, yukle, gorunur]);

  const izle = (baslik: string, serverId: number | undefined, jobId: number | null | undefined, id: number) => {
    if (!jobId) return;
    let bitti = false;
    addJob({
      title: baslik,
      fetchStatus: async () => {
        const s = await serverHubApi.jobStatus(Number(serverId ?? 0), jobId);
        if (!s.ok) throw new Error(s.message || 'Durum okunamadı.');
        if (TERMINAL.has(s.status) && !bitti) { bitti = true; window.setTimeout(() => { void ac(id); void yukle(); }, 1500); }
        return { status: s.status, output: s.output || '', result: s.result };
      },
    });
  };

  const hosts = sunucuListesi(metin);
  // Tek seferde sunucu sayisi (2026-10-20): Admin Server Hub > Kurallar & Limitler'den degistirir.
  const rebootLimiti = useSunucuLimiti('reboot');
  const bilinmeyen = bilinen ? hosts.filter((h) => !bilinen.has(h)) : [];

  const onceAl = async () => {
    if (!hosts.length) return;
    setBusy(true);
    try {
      const r = await rebootCheckApi.once(hosts, not);
      if (!r.ok || !r.id) { toast.error(r.message || 'İş başlatılamadı.'); return; }
      toast.success(`Reboot öncesi görüntü alınıyor (#${r.jobId}).`);
      izle(`Reboot kontrolü: ÖNCE ${hosts.length} sunucu`, r.awxServerId, r.jobId, r.id);
      setMetin(''); setNot('');
      await yukle(); await ac(r.id);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const sonraBaslat = async () => {
    if (!secili) return;
    setOnay(false); setBusy(true);
    try {
      const r = await rebootCheckApi.sonra(secili.id);
      if (!r.ok) { toast.error(r.message || 'İş başlatılamadı.'); return; }
      toast.success(`Reboot sonrası kontrol ve düzeltme başladı (#${r.jobId})${r.disarida?.length ? ` — önce görüntüsü olmayan ${r.disarida.length} sunucu dahil edilmedi` : ''}.`);
      izle(`Reboot kontrolü: SONRA #${secili.id}`, r.awxServerId, r.jobId, secili.id);
      await ac(secili.id); await yukle();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const onayBos = secili ? bosOnceSunuculari(secili) : [];
  const inputStil: React.CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="text-sm font-semibold">Yeni reboot kontrolü</div>
        <ol className="text-[12px] space-y-0.5 list-decimal pl-5" style={{ color: 'var(--text-secondary)' }}>
          <li><b>Reboot öncesi</b> görüntüyü alın — Nginx, Red Hat Apache, IBM Apache, CTG, JBoss 7/8, WAS ve JVM'leri; Portal'da saklanır.</li>
          <li>Reboot'u (patch) yapın.</li>
          <li><b>Reboot sonrası kontrol et ve düzelt</b> — sunucu reboot öncesi nasılsa öyle bırakılır: önce çalışan ürün kapalıysa açılır, <b>önce çalışmayan ürün çalışıyorsa kapatılır</b>; JBoss/WAS'ta önce çalışan JVM açılır, önce olmayan JVM kapatılır.</li>
        </ol>
        <div className="grid gap-2 md:grid-cols-[1fr_16rem]">
          <textarea value={metin} onChange={(e) => setMetin(e.target.value)} rows={2} placeholder="Sunucular (virgül, boşluk ya da satır): GBJBOP18, GBJBOAP18 …"
            className="w-full px-3 py-2 text-xs font-mono border rounded-lg" style={inputStil} />
          <input value={not} onChange={(e) => setNot(e.target.value)} placeholder="Not (ör. Ekim patch'i)" className="w-full px-3 py-2 text-xs border rounded-lg h-fit" style={inputStil} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={!hosts.length || limitAsildi(rebootLimiti, hosts.length) || busy} onClick={onceAl} className={BTN}
            style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--text-on-accent)' }}>
            <CameraIcon className="w-4 h-4" /> Reboot öncesi görüntüyü al ({hosts.length})
          </button>
          <LimitNotu limit={rebootLimiti} sayi={hosts.length} />
          {bilinmeyen.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--status-warning)' }}>
              <ExclamationTriangleIcon className="w-3.5 h-3.5" /> Server Hub'da bilinmeyen: {bilinmeyen.join(', ')} — adı kontrol edin
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div className="flex items-center px-3 py-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <span className="text-xs font-semibold">Kayıtlar</span>
            <button type="button" onClick={yukle} className="ml-auto text-xs inline-flex items-center gap-1" style={{ color: 'var(--accent)' }}><ArrowPathIcon className="w-3.5 h-3.5" /> Yenile</button>
          </div>
          {kayitlar.length === 0 ? <div className="p-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>Henüz kayıt yok.</div> : (
            <ul>
              {kayitlar.map((k) => (
                <li key={k.id}>
                  <button type="button" onClick={() => ac(k.id)} className="w-full text-left px-3 py-2 border-b hover:bg-[var(--bg-elevated)]"
                    style={{ borderColor: 'var(--border-subtle)', background: secili?.id === k.id ? 'var(--bg-elevated)' : undefined }}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">#{k.id}</span>
                      <DurumRozeti durum={k.durum} />
                    </div>
                    <div className="text-[11px] font-mono truncate" style={{ color: 'var(--text-secondary)' }} title={k.hosts.join(', ')}>{k.hosts.join(', ')}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{k.olusturan} · {fmtDateTime(k.olusturuldu)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          {secili ? <Ayrinti k={secili} onSonra={() => setOnay(true)} busy={busy} /> : (
            <div className="text-[12px] flex items-center gap-2" style={{ color: 'var(--text-muted)' }}><CheckCircleIcon className="w-4 h-4" /> Ayrıntı için soldan bir kayıt seçin.</div>
          )}
        </div>
      </div>

      <Modal open={onay} onClose={() => setOnay(false)} title="Reboot sonrası kontrol et ve düzelt" size="md"
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOnay(false)} className={BTN} style={inputStil}>İptal</button>
            <button type="button" onClick={sonraBaslat} disabled={busy} className={BTN} style={{ background: 'var(--status-danger)', borderColor: 'var(--status-danger)', color: '#fff' }}>Onayla ve başlat</button>
          </div>
        )}>
        <div className="space-y-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          <p>Sunucuların reboot'u <b>tamamlandıysa</b> devam edin. Her sunucuda:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>Reboot öncesi çalışan <b>Nginx / Red Hat Apache / IBM Apache / CTG / JBoss / WAS</b> kapalıysa estate başlatma yoluyla <b>açılır</b>.</li>
            <li>Reboot öncesi <b>çalışmayan</b> ürün şimdi çalışıyorsa estate durdurma komutuyla <b>kapatılır</b> (önce açmalar, sonra kapatmalar).</li>
            <li>JBoss ve WAS'ta, ürünü reboot öncesi çalışıyor olan JVM'ler için: önce çalışıp şimdi kapalı olan JVM <b>açılır</b>; önce çalışmayıp şimdi çalışan JVM <b>kapatılır</b>. Ürünü reboot öncesi çalışmayanın JVM'leri ürünle birlikte kapanır.</li>
            <li>JVM'lere geçmeden önce süreç listesinin durulması beklenir (sunucu başına en çok ~5 dk); bu sırada geç kalkan, reboot öncesi çalışmayan ürün de <b>kapatılır</b>.</li>
            <li>Kalan JVM'ler tek tek işlenir; süreç öldürülmez (kill yok).</li>
          </ul>
          <div role="alert" className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--status-danger)', background: 'var(--status-danger-bg)', color: 'var(--status-danger)' }}>
            <b>Dikkat: reboot öncesi çalışmayan ürün KAPATILIR.</b> JBoss domain'i (Host Controller), WAS (uygulama sunucuları, nodeagent, dmgr) ya da CTG kapatılınca <b>üzerindeki her şey kapanır</b>. Karar tamamen "önce" görüntüsüne dayanır; "önce"den sonra bilerek açılmış bir ürün varsa devam etmeyin. Önce görüntüsü boş olan sunucularda çalışan her ürün (Nginx/Apache/IHS/CTG/JBoss/WAS, prod dahil) kapatılır; önce görüntüsü eski betik sürümüyle alınmış sunucularda JBoss 7/8 kapatılmaz. Otomasyonun kapattığı her ürün sonuçta <b>kontrol edilecek</b> olarak işaretlenir.
          </div>
          <p>Yalnız "önce" görüntüsü alınmış sunucular işlenir.</p>
          {onayBos.length > 0 && (
            <div role="alert" className="rounded-lg border px-3 py-2 space-y-1" style={{ borderColor: 'var(--status-warning)', background: 'var(--status-warning-bg)', color: 'var(--status-warning)' }}>
              <div className="flex items-center gap-1 font-semibold"><ExclamationTriangleIcon className="w-4 h-4" /> Önce görüntüsü boş sunucular ({onayBos.length})</div>
              <div className="font-mono">{onayBos.join(', ')}</div>
              <div>{ONCE_BOS_METNI} Başka bir neden yoksa sonuç "Karşılaştırma dışı" olur (uyarı değil).</div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
