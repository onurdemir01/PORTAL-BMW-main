// src/components/server_hub/RetirementOnKontrol.tsx — STOP ön kontrol listesi (2026-10-22).
//
// Kullanıcı: "Ön Kontrol adımında hangi komutların uygulanacağı, hangi uygulamanın, hangi
// konfigürasyonların, filesystem'de hangi dizinlerin etkileneceği açık açık yazdıralım ve bunların
// dışında hiçbir şeye dokunulmadığından emin olalım."
//
// Liste playbook'un ön kontrolde yazdığı `ONKONTROL` satırlarından gelir (app_retirement_stop.sh).
// Onaylanan ön kontrolün izin listesi onayla birlikte betiğe döner; betik listede olmayan hiçbir
// işlemi yapmaz, liste gelmezse hiç başlamaz. Liste yoksa (AWX'teki betik eski) onay açılmaz —
// ekran bunu söyler, boş bir kutu "dokunulacak bir şey yok" diye okunurdu.
import type { RtTarget } from '@/api/retirementApi';

export type OnKontrolTur = 'uygulama' | 'konfig' | 'komut' | 'dosya' | 'dokunulmaz' | 'ozet';
export interface OnKontrolSatiri { tur: OnKontrolTur; ne: string; ayrinti: string }

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

function Baslik({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{children}</div>;
}

export default function OnKontrolListesi({ t }: { t: RtTarget }) {
  const g = onKontrolAyristir(t.detail?.onkontrol);
  const bos = TURLER.every((x) => g[x].length === 0);
  if (bos) {
    return (
      <div role="alert" className="text-[12px] rounded-lg border px-3 py-2" style={{ borderColor: 'var(--status-warning)', color: 'var(--status-warning-text)' }}>
        <b>Ön kontrol listesi gelmedi.</b> AWX’teki retirement betikleri bu listeyi üretmiyor (eski sürüm). Hangi komutların,
        konfigürasyonların ve dizinlerin etkileneceği gösterilemediği için onay açılmaz: önce betikler yüklenmeli, sonra
        “Retirement’ı başlat” ile ön kontrol yeniden çalıştırılmalı.
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
          <Baslik>Değişecek konfigürasyon</Baslik>
          {g.konfig.map((k, i) => (
            <div key={i} className="flex gap-2"><code className="shrink-0">{k.ne}</code><span>{k.ayrinti}</span></div>
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
        <Baslik>Etkilenecek dosyalar (önce → sonra)</Baslik>
        {g.dosya.map((d, i) => (
          d.ne === '-'
            ? <div key={i} style={{ color: 'var(--text-muted)' }}>{d.ayrinti}</div>
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
        Onaydan sonra <b>yalnız bu listedeki</b> işlemler yapılır. Liste dışında bir işlem gerekirse (örneğin bu arada yeni bir
        paket belirdiyse) iş <b>HİÇBİR ŞEY YAPMADAN</b> durur ve ön kontrol yeniden çalıştırılmalıdır.
        {!onKontrolHazir(t) && <> <b style={{ color: 'var(--status-danger-text)' }}>Bu ön kontrolün izin listesi yok — onay açılmaz; ön kontrolü yeniden çalıştırın.</b></>}
      </div>
      {t.detail?.kisaltildi && <div style={{ color: 'var(--status-warning-text)' }}>Ayrıntı çok uzundu, adım listesi kısaltıldı.</div>}
    </div>
  );
}
