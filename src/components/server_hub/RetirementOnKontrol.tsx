// src/components/server_hub/RetirementOnKontrol.tsx — STOP / silme / geri alma ön kontrol listesi (2026-10-22).
//
// Kullanıcı: "Ön Kontrol adımında hangi komutların uygulanacağı, hangi uygulamanın, hangi
// konfigürasyonların, filesystem'de hangi dizinlerin etkileneceği açık açık yazdıralım ve bunların
// dışında hiçbir şeye dokunulmadığından emin olalım." Aynı gün: "DELETE ve GERİ AL için de ön kontrol
// listesini yap".
//
// Liste playbook'un ön kontrolde yazdığı `ONKONTROL` satırlarından gelir (app_retirement_stop.sh /
// _delete.sh / _rollback.sh, aynı biçim). Onaylanan ön kontrolün izin listesi işle birlikte betiğe döner;
// betik listede olmayan hiçbir işlemi yapmaz, liste gelmezse hiç başlamaz. Liste yoksa (AWX'teki betik
// eski) onay / silme açılmaz — ekran bunu söyler, boş bir kutu "dokunulacak bir şey yok" diye okunurdu.
import type { RtOnKontrolKaydi, RtTarget } from '@/api/retirementApi';

export type OnKontrolTur = 'uygulama' | 'konfig' | 'komut' | 'dosya' | 'dokunulmaz' | 'ozet';
export interface OnKontrolSatiri { tur: OnKontrolTur; ne: string; ayrinti: string }
/** Hangi işin ön kontrolü: başlıklar ve güvence cümlesi işe göre değişir, liste biçimi aynı. */
export type OnKontrolKip = 'stop' | 'silme' | 'geri-al';

const TURLER: OnKontrolTur[] = ['uygulama', 'konfig', 'komut', 'dosya', 'dokunulmaz', 'ozet'];

/** `ONKONTROL\t<tur>\t<ne>\t<ayrinti>` satırlarını türlerine ayırır; tanınmayan satır atılır. */
export function onKontrolAyristir(satirlar: string[] | undefined | null): Record<OnKontrolTur, OnKontrolSatiri[]> {
  const out = Object.fromEntries(TURLER.map((t) => [t, [] as OnKontrolSatiri[]])) as Record<OnKontrolTur, OnKontrolSatiri[]>;
  for (const x of satirlar || []) {
    const p = String(x).split('\t');
    if (p[0] !== 'ONKONTROL') continue;
    const tur = p[1] as OnKontrolTur;
    if (!TURLER.includes(tur)) continue;
    out[tur].push({ tur, ne: p[2] || '', ayrinti: p.slice(3).join(' ') });
  }
  return out;
}

/** Onay yalnız son ön kontrolün izin listesi varsa açılır (sunucu da aynı kuralı uygular). */
export function onKontrolHazir(t: Pick<RtTarget, 'stopIzin'>): boolean {
  return !!t.stopIzin && Array.isArray(t.stopIzin.izinler) && t.stopIzin.izinler.some((x) => x.startsWith('onay:'));
}
/** Geri alma onayı yalnız hazır (başarılı, kullanılmamış) geri alma ön kontrolüyle açılır. */
export function geriAlHazir(t: Pick<RtTarget, 'geriAlOnKontrol'>): boolean {
  return !!t.geriAlOnKontrol?.hazir && (t.geriAlOnKontrol.izinler || []).some((x) => x.startsWith('onay:geri-al:'));
}
/** Ön kontrol işi sürüyor mu (başlatılıyor ya da AWX'te). 30 dakikadan eskisi TAKILMIŞ sayılır (sunucuyla aynı
 *  kural): ekran yeniden başlatmaya izin verir, canlı tazeleme de sonsuza dek sürmez. */
export const ONKONTROL_TAKILDI_MS = 30 * 60000;
export function onKontrolSuruyor(k: RtOnKontrolKaydi | null | undefined, simdi: number = Date.now()): boolean {
  if (!k || (k.durum !== 'running' && k.durum !== 'baslatiliyor')) return false;
  const t = k.at ? Date.parse(k.at) : NaN;
  return !Number.isFinite(t) || simdi - t < ONKONTROL_TAKILDI_MS;
}
/** Geri alma onayı açılabilecek hedef durumu (sunucunun kapısıyla aynı). */
export function geriAlinabilir(t: Pick<RtTarget, 'status' | 'deletedAt' | 'webSonuc'>): boolean {
  if (t.deletedAt) return false;
  return t.status === 'stopped' || t.status === 'rollback_failed' || (t.status === 'failed' && (t.webSonuc || []).some((w) => w.status === 'ok'));
}

const BASLIK: Record<OnKontrolKip, { konfig: string; dosya: string; okBos: string; guvence: React.ReactNode; hazirDegil: string; listeYok: string }> = {
  stop: {
    konfig: 'Değişecek konfigürasyon',
    dosya: 'Etkilenecek dosyalar (önce → sonra)',
    okBos: 'yeniden adlandırılacak paket yok',
    guvence: <>Onaydan sonra <b>yalnız bu listedeki</b> işlemler yapılır. Liste dışında bir işlem gerekirse (örneğin bu arada yeni bir paket belirdiyse) iş <b>HİÇBİR ŞEY YAPMADAN</b> durur ve ön kontrol yeniden çalıştırılmalıdır.</>,
    hazirDegil: 'Bu ön kontrolün izin listesi yok — onay açılmaz; ön kontrolü yeniden çalıştırın.',
    listeYok: 'Hangi komutların, konfigürasyonların ve dizinlerin etkileneceği gösterilemediği için onay açılmaz: önce betikler yüklenmeli, sonra “Retirement’ı başlat” ile ön kontrol yeniden çalıştırılmalı.',
  },
  silme: {
    konfig: 'Kaldırılacak JBoss tanımları',
    dosya: 'Silinecek dosyalar (KALICI)',
    okBos: 'silinecek paket yok',
    guvence: <>Silme <b>yalnız bu listedeki</b> işlemleri yapar. Liste dışında bir işlem gerekirse (örneğin bu arada yeni bir paket, deployment ya da grup üyesi belirdiyse) silme <b>HİÇBİR ŞEY SİLMEDEN</b> durur. Zamanlayıcı ön kontrolü silme saatinden bir saat önce yeniden koşar; silme yalnız taze listeyle yapılır.</>,
    hazirDegil: 'Bu liste silmede kullanılamaz (başarısız, bayat ya da kullanılmış) — zamanlayıcı silmeden önce yeni ön kontrol koşar.',
    listeYok: 'Neyin silineceği gösterilemediği için silme yapılmaz: önce betikler yüklenmeli; zamanlayıcı ön kontrolü yeniden koşar.',
  },
  'geri-al': {
    konfig: 'Değişecek konfigürasyon',
    dosya: 'Geri adlandırılacak dosyalar (önce → sonra)',
    okBos: 'geri adlandırılacak paket yok',
    guvence: <>Onaydan sonra <b>yalnız bu listedeki</b> işlemler yapılır. Liste dışında bir işlem gerekirse (örneğin bu arada yeni bir <code>.old</code> paketi belirdiyse) iş <b>HİÇBİR ŞEY YAPMADAN</b> durur ve ön kontrol yeniden çalıştırılmalıdır.</>,
    hazirDegil: 'Bu ön kontrol onaya verilemez (başarısız ya da kullanılmış) — onay açılmaz; ön kontrolü yeniden çalıştırın.',
    listeYok: 'Hangi komutların, konfigürasyonların ve dizinlerin etkileneceği gösterilemediği için onay açılmaz: önce betikler yüklenmeli, sonra ön kontrol yeniden çalıştırılmalı.',
  },
};

function Baslik({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{children}</div>;
}

/** Ön kontrol listesi — üç iş için aynı görünüm. `hazir`: liste onaya / silmeye verilebilir mi. */
export function OnKontrolGorunumu({ satirlar, hazir, kip, kisaltildi }: { satirlar: string[] | undefined | null; hazir: boolean; kip: OnKontrolKip; kisaltildi?: boolean }) {
  const g = onKontrolAyristir(satirlar);
  const b = BASLIK[kip];
  const bos = TURLER.every((x) => g[x].length === 0);
  if (bos) {
    return (
      <div role="alert" className="text-[12px] rounded-lg border px-3 py-2" style={{ borderColor: 'var(--status-warning)', color: 'var(--status-warning-text)' }}>
        <b>Ön kontrol listesi gelmedi.</b> AWX’teki retirement betikleri bu listeyi üretmiyor (eski sürüm). {b.listeYok}
      </div>
    );
  }
  const degistiren = g.komut.filter((k) => /^DEGISTIRIR/.test(k.ayrinti));
  return (
    <div className="text-[11px] rounded-lg border px-3 py-2 space-y-2" style={{ borderColor: 'var(--border-subtle)' }} aria-label="Ön kontrol listesi">
      {g.uygulama.map((u) => (
        <div key={u.ne}>
          <Baslik>Uygulama</Baslik>
          <div><b className="font-mono">{u.ne}</b> <span style={{ color: 'var(--text-secondary)' }}>— {u.ayrinti}</span></div>
        </div>
      ))}
      {g.konfig.length > 0 && (
        <div>
          <Baslik>{b.konfig}</Baslik>
          {g.konfig.map((k, i) => (
            <div key={i} className="flex gap-2"><code className="shrink-0 break-all">{k.ne}</code><span>{k.ayrinti}</span></div>
          ))}
        </div>
      )}
      <div>
        <Baslik>Çalışacak komutlar ({degistiren.length} değiştiren, {g.komut.length - degistiren.length} salt okunur)</Baslik>
        {g.komut.map((k, i) => {
          const yazar = /^DEGISTIRIR/.test(k.ayrinti);
          return (
            <div key={i} className="flex gap-2 items-start">
              <span className="shrink-0 rounded px-1 text-[10px] font-semibold"
                style={yazar ? { background: 'var(--status-danger-bg, var(--bg-elevated))', color: 'var(--status-danger-text)' } : { background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                {yazar ? 'değiştirir' : 'salt okunur'}
              </span>
              <code className="break-all">{k.ne}</code>
              <span style={{ color: 'var(--text-muted)' }}>{k.ayrinti.replace(/^DEGISTIRIR\s*-\s*/, '').replace(/^salt okunur\s*-\s*/, '')}</span>
            </div>
          );
        })}
      </div>
      <div>
        <Baslik>{b.dosya}</Baslik>
        {g.dosya.length === 0 && <div style={{ color: 'var(--text-muted)' }}>{b.okBos}</div>}
        {g.dosya.map((d, i) => (
          d.ne === '-'
            ? <div key={i} style={{ color: 'var(--text-muted)' }}>{d.ayrinti}</div>
            : kip === 'silme'
              ? <div key={i} className="font-mono break-all">{d.ne} <b style={{ color: 'var(--status-danger-text)' }}>— SİLİNECEK</b></div>
              : <div key={i} className="font-mono break-all">{d.ne} <span style={{ color: 'var(--text-muted)' }}>→</span> {d.ayrinti}</div>
        ))}
      </div>
      {g.dokunulmaz.length > 0 && (
        <div>
          <Baslik>Dokunulmayacaklar</Baslik>
          {g.dokunulmaz.map((d, i) => (
            <div key={i} className="flex gap-2"><code className="shrink-0 break-all">{d.ne}</code><span style={{ color: 'var(--text-secondary)' }}>{d.ayrinti}</span></div>
          ))}
        </div>
      )}
      <div className="rounded border px-2 py-1 text-[12px]" style={{ borderColor: 'var(--status-info)', background: 'var(--status-info-bg)' }}>
        {b.guvence}
        {!hazir && <> <b style={{ color: 'var(--status-danger-text)' }}>{b.hazirDegil}</b></>}
      </div>
      {kisaltildi && <div style={{ color: 'var(--status-warning-text)' }}>Ayrıntı çok uzundu, liste kısaltıldı.</div>}
    </div>
  );
}

/** STOP onay penceresindeki liste (hedefin son STOP ön kontrolü). */
export default function OnKontrolListesi({ t }: { t: RtTarget }) {
  return <OnKontrolGorunumu satirlar={t.detail?.onkontrol} hazir={onKontrolHazir(t)} kip="stop" kisaltildi={t.detail?.kisaltildi} />;
}
