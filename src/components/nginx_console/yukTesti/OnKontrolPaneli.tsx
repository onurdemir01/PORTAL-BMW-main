// src/components/nginx_console/yukTesti/OnKontrolPaneli.tsx — on kontrol sonucu (2026-10-27).
//
// On kontrol yuk URETMEZ: hedefte IP / server_name / tek master / /web_log / log bicimi, yuk sunucusunda k6 ve
// senaryodaki her yola tek HTTP/1.1 istegi. Burada her kontrol tek satir (gecti / kaldi / olculemedi - uc durum
// AYRI: "olculemedi" basarisiz sayilmaz ama gecti de sayilmaz), sonra engeller (Baslat kapali), onay isteyen
// uyarilar ve 200 donmeyen ilk yollar.
// `baglam`: 'sihirbaz' (Yeni koşu; "başlatılabilir / başlatılamaz" cagrisi) ya da 'kayit' (baslamis kosunun
// dayandigi on kontrol: cagri YOK, uyarilar "Onaylanan uyarılar" - kosu ancak onaylanarak baslayabildi).
//
// TUR 3 (2026-10-28): satirlar hedef turu ve motora gore. Serbest hedefe SSH yoktur: hedef satirlari yerine yuk
// sunucusunun satirlari (IP orada yerel degil, izin dosyasinda eslesen ag). wrk satiri uc durumlu: gecti / "wrk
// çalışıyor, sürüm okunamadı" (kaldi; VER'siz derleme) / olculemedi. D7: server_name satiri UYARI tonunda kalir
// (Host basligi listede olmamak engel degil; sunucu onay isteyen uyari verir).
// Inceleme UI1 (2026-10-28): hic yol denenmediyse (0 / 0) yollar satiri "hiçbir yol denenmedi · kaldı" (geçti DEGIL);
// izin dosyasi IP'yi kapsamiyorsa satir "kaldı" (dosya okundu ve reddetti).
// Dogrulama UV1 (2026-10-28): bos serbest_ag tek basina "reddetti" DEMEK DEGIL. "kaldı" YALNIZ is hatasi Play 3'un ret
// metnini ("serbest izin listesi: <neden>") tasiyorsa; izin bloguna hic gelinmediyse (SSH erisilemedi, dzdo hatasi,
// kopya kapisi: Play 8 ayni null'u yayinlar) satir "ölçülemedi".
import React from 'react';
import { CheckCircleIcon, ExclamationTriangleIcon, MinusCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import type { NlKosuAyrinti, NlMotor, NlOnKontrol } from '@/api/nginxLoadtestApi';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtNumber } from '@/utils/datetime';
import { TabloIskelet, UyariKutusu, type Kolon } from '@/components/server_hub/RetirementUi';
import { motorOf, onKontrolDegerlendir } from './yukTestiOrtak';

type Sonuc = 'gecti' | 'kaldi' | 'uyari' | 'yok';
const IKON: Record<Sonuc, { Ikon: React.ComponentType<React.SVGProps<SVGSVGElement>>; renk: string; ad: string }> = {
  gecti: { Ikon: CheckCircleIcon, renk: 'var(--status-success)', ad: 'geçti' },
  kaldi: { Ikon: XCircleIcon, renk: 'var(--status-danger)', ad: 'kaldı' },
  uyari: { Ikon: ExclamationTriangleIcon, renk: 'var(--status-warning)', ad: 'uyarı' },
  yok: { Ikon: MinusCircleIcon, renk: 'var(--text-muted)', ad: 'ölçülemedi' },
};
const ikili = (v: boolean | null, kotu: Sonuc = 'kaldi'): Sonuc => (v == null ? 'yok' : v ? 'gecti' : kotu);
type Kontrol = { ad: string; sonuc: Sonuc; deger?: string };

/** Satirda yalniz surum numarasi ("k6 v0.49.0 (go1.21.6, linux/amd64)" -> v0.49.0); tamami bilgi satirinda. */
function motorSatiri(o: NlOnKontrol, motor: NlMotor): Kontrol {
  if (motor === 'wrk') {
    const surum = o.wrkSurum ? (/\d+\.\d+(?:\.\d+)?/.exec(o.wrkSurum)?.[0] ?? o.wrkSurum) : undefined;
    // Uc durum: calisan ve surumu okunan ikili / calisiyor ama surum satiri yok ya da < 4 (kaldi) / olculemedi.
    if (o.wrkVar === true) return { ad: 'Yük sunucusunda wrk', sonuc: 'gecti', deger: surum };
    if (o.wrkCalisiyor === true) return { ad: 'Yük sunucusunda wrk', sonuc: 'kaldi', deger: 'wrk çalışıyor, sürüm okunamadı' };
    return { ad: 'Yük sunucusunda wrk', sonuc: o.wrkVar === false ? 'kaldi' : 'yok' };
  }
  return { ad: 'Yük sunucusunda k6', sonuc: ikili(o.k6Var), deger: o.k6Surum ? (/v\d+\.\d+\.\d+/.exec(o.k6Surum)?.[0] ?? o.k6Surum) : undefined };
}
/** Hic yol denenmediyse (izin reddi, IP yuk sunucusunda yerel, IP hedefte yerel degil: playbook yollari atlar ve 0 / 0
 *  yayinlar) "kaldı": sunucunun `!(toplam > 0)` engeliyle ayni anlam; 0 === 0 "geçti" sayilmaz. */
function yollarSatiri(o: NlOnKontrol): Kontrol {
  return {
    ad: 'Senaryo yolları 200', sonuc: o.yollarToplam == null ? 'yok' : !(o.yollarToplam > 0) ? 'kaldi' : o.yollar200 == null ? 'yok' : o.yollar200 === o.yollarToplam ? 'gecti' : 'uyari',
    deger: o.yollarToplam == null ? undefined : !(o.yollarToplam > 0) ? 'hiçbir yol denenmedi' : `${fmtNumber(o.yollar200)} / ${fmtNumber(o.yollarToplam)}`,
  };
}
function kontroller(o: NlOnKontrol, serbest: boolean, motor: NlMotor, isHatasi: string | null): Kontrol[] {
  if (serbest) {
    return [
      // Hedef IP yuk sunucusunun kendisi olamaz (istek gonderilmez): yerel DEGIL = gecti.
      { ad: 'IP yük sunucusunda yerel değil', sonuc: o.ipYukMakinesinde == null ? 'yok' : o.ipYukMakinesinde ? 'kaldi' : 'gecti' },
      // serbest_ag yalniz izin dosyasi IP'yi kapsadiginda dolu (yoksa yollar atlanir, kayit FAILED). Bos iken kaldi YALNIZ
      // Play 3 ret metniyle (dosya okundu ve reddetti); izin bloguna hic gelinmediyse olculemedi (UV1).
      { ad: 'Yük sunucusu izin dosyası', sonuc: o.serbestAg ? 'gecti' : /serbest izin listesi/.test(isHatasi ?? '') ? 'kaldi' : 'yok', deger: o.serbestAg || undefined },
      motorSatiri(o, motor),
      yollarSatiri(o),
    ];
  }
  const df = o.webLogDf;
  return [
    { ad: 'IP hedefte yerel', sonuc: ikili(o.ipYerel) },
    // D7: Host basligi listede olmayabilir (joker / regex ad): kaldi degil uyari.
    { ad: 'server_name nginx -T’de', sonuc: ikili(o.serverNameVar, 'uyari') },
    { ad: 'Tek nginx master', sonuc: o.masterSayisi == null ? 'yok' : o.masterSayisi === 1 ? 'gecti' : 'kaldi', deger: o.masterSayisi == null ? undefined : `${fmtNumber(o.masterSayisi)} master` },
    { ad: '/web_log doluluğu < %65', sonuc: df == null ? 'yok' : df < 65 ? 'gecti' : 'uyari', deger: df == null ? undefined : `%${fmtNumber(df)}` },
    { ad: 'Log dizini okunur', sonuc: ikili(o.logDiziniOkunur) },
    { ad: 'log_format “user-agent=” yazıyor', sonuc: ikili(o.logFormatUa, 'uyari') },
    motorSatiri(o, motor),
    yollarSatiri(o),
  ];
}

const HATA_KOLONLARI: Kolon[] = [{ anahtar: 'yol', baslik: 'Yol' }, { anahtar: 'status', baslik: 'HTTP', genislik: '5rem' }];

export type OnKontrolBaglami = 'sihirbaz' | 'kayit';
export default function OnKontrolPaneli({ kosu, baglam = 'sihirbaz' }: {
  kosu: Pick<NlKosuAyrinti, 'durum' | 'onKontrol'> & Partial<Pick<NlKosuAyrinti, 'sunucuDegerlendirmesi' | 'isDurumu' | 'isHatasi' | 'hedefTuru' | 'motor' | 'parametreler'>>;
  baglam?: OnKontrolBaglami;
}) {
  const o = kosu.onKontrol;
  const d = onKontrolDegerlendir(kosu);
  const kayit = baglam === 'kayit';
  const motor: NlMotor = kosu.motor === 'wrk' || kosu.motor === 'k6' ? kosu.motor : motorOf(kosu.parametreler);
  return (
    <div className="space-y-3">
      {o ? (
        <ul className="grid gap-x-4 gap-y-1.5 @lg/yuk:grid-cols-2" aria-label="Ön kontrol maddeleri">
          {kontroller(o, kosu.hedefTuru === 'serbest', motor, kosu.isHatasi ?? null).map((k) => {
            const i = IKON[k.sonuc];
            return (
              <li key={k.ad} className="flex min-w-0 items-center gap-2 text-[12px] leading-5">
                <i.Ikon className="h-4 w-4 shrink-0" style={{ color: i.renk }} aria-hidden />
                <span className="min-w-0 shrink-0 truncate" style={{ color: 'var(--text-primary)', maxWidth: '65%' }} title={k.ad}>{k.ad}</span>
                <span className="ml-auto min-w-0 truncate text-right tabular-nums text-[11px]" style={{ color: 'var(--text-secondary)' }} title={`${k.deger ? `${k.deger} · ` : ''}${i.ad}`}>{`${k.deger ? `${k.deger} · ` : ''}${i.ad}`}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {d.engeller.length > 0 && (
        <UyariKutusu ton="hata" rol={kayit ? undefined : 'alert'} baslik={kayit ? 'Ön kontrol engelleri' : 'Koşu başlatılamaz'}>
          <ul className="list-disc space-y-0.5 pl-4">{d.engeller.map((e) => <li key={e}>{e}</li>)}</ul>
        </UyariKutusu>
      )}
      {d.uyarilar.length > 0 && (
        <UyariKutusu ton="uyari" baslik={kayit ? 'Onaylanan uyarılar' : `${d.uyarilar.length} uyarı — başlatırken açıkça onaylamanız gerekir`}>
          <ul className="list-disc space-y-0.5 pl-4">{d.uyarilar.map((e) => <li key={e}>{e}</li>)}</ul>
        </UyariKutusu>
      )}
      {o && !d.engeller.length && !d.uyarilar.length && (
        <UyariKutusu ton="bilgi" baslik={kayit ? 'Ön kontrol temiz — engel ya da uyarı yoktu.' : 'Ön kontrol temiz — koşu başlatılabilir.'} />
      )}
      {d.bilgiler.length > 0 && <p className="text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>{d.bilgiler.join(' · ')}</p>}
      {o && o.ilkHatalar.length > 0 && (
        <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full table-fixed border-collapse" aria-label="200 dönmeyen ilk yollar">
            <TabloIskelet kolonlar={HATA_KOLONLARI} />
            <tbody className="text-[12px]" style={{ color: 'var(--text-primary)' }}>
              {o.ilkHatalar.length === 0 ? <TableEmptyRow colSpan={2} title="Hatalı yol yok." /> : o.ilkHatalar.map((h, i) => (
                <tr key={`${h.yol}-${i}`} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="truncate px-2.5 py-1 font-mono text-[11px]" title={h.yol}>{h.yol}</td>
                  <td className="px-2.5 py-1 font-mono tabular-nums" style={{ color: 'var(--status-danger-text)' }}>{h.status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
