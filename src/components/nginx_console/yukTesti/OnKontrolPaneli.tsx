// src/components/nginx_console/yukTesti/OnKontrolPaneli.tsx — on kontrol sonucu (2026-10-27).
//
// On kontrol yuk URETMEZ: hedefte IP / server_name / tek master / /web_log / log bicimi, yuk sunucusunda k6 ve
// senaryodaki her yola tek HTTP/1.1 istegi. Burada her kontrol tek satir (gecti / kaldi / olculemedi - uc durum
// AYRI: "olculemedi" basarisiz sayilmaz ama gecti de sayilmaz), sonra engeller (Baslat kapali), onay isteyen
// uyarilar ve 200 donmeyen ilk yollar.
// `baglam`: 'sihirbaz' (Yeni koşu; "başlatılabilir / başlatılamaz" cagrisi) ya da 'kayit' (baslamis kosunun
// dayandigi on kontrol: cagri YOK, uyarilar "Onaylanan uyarılar" - kosu ancak onaylanarak baslayabildi).
import React from 'react';
import { CheckCircleIcon, ExclamationTriangleIcon, MinusCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import type { NlKosuAyrinti, NlOnKontrol } from '@/api/nginxLoadtestApi';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtNumber } from '@/utils/datetime';
import { TabloIskelet, UyariKutusu, type Kolon } from '@/components/server_hub/RetirementUi';
import { onKontrolDegerlendir } from './yukTestiOrtak';

type Sonuc = 'gecti' | 'kaldi' | 'uyari' | 'yok';
const IKON: Record<Sonuc, { Ikon: React.ComponentType<React.SVGProps<SVGSVGElement>>; renk: string; ad: string }> = {
  gecti: { Ikon: CheckCircleIcon, renk: 'var(--status-success)', ad: 'geçti' },
  kaldi: { Ikon: XCircleIcon, renk: 'var(--status-danger)', ad: 'kaldı' },
  uyari: { Ikon: ExclamationTriangleIcon, renk: 'var(--status-warning)', ad: 'uyarı' },
  yok: { Ikon: MinusCircleIcon, renk: 'var(--text-muted)', ad: 'ölçülemedi' },
};
const ikili = (v: boolean | null, kotu: Sonuc = 'kaldi'): Sonuc => (v == null ? 'yok' : v ? 'gecti' : kotu);

function kontroller(o: NlOnKontrol): { ad: string; sonuc: Sonuc; deger?: string }[] {
  const df = o.webLogDf;
  return [
    { ad: 'IP hedefte yerel', sonuc: ikili(o.ipYerel) },
    { ad: 'server_name nginx -T’de', sonuc: ikili(o.serverNameVar) },
    { ad: 'Tek nginx master', sonuc: o.masterSayisi == null ? 'yok' : o.masterSayisi === 1 ? 'gecti' : 'kaldi', deger: o.masterSayisi == null ? undefined : `${fmtNumber(o.masterSayisi)} master` },
    { ad: '/web_log doluluğu < %65', sonuc: df == null ? 'yok' : df < 65 ? 'gecti' : 'uyari', deger: df == null ? undefined : `%${fmtNumber(df)}` },
    { ad: 'Log dizini okunur', sonuc: ikili(o.logDiziniOkunur) },
    { ad: 'log_format “user-agent=” yazıyor', sonuc: ikili(o.logFormatUa, 'uyari') },
    // Satirda yalniz surum numarasi ("k6 v0.49.0 (go1.21.6, linux/amd64)" -> v0.49.0); tamami asagidaki bilgi satirinda.
    { ad: 'Yük sunucusunda k6', sonuc: ikili(o.k6Var), deger: o.k6Surum ? (/v\d+\.\d+\.\d+/.exec(o.k6Surum)?.[0] ?? o.k6Surum) : undefined },
    {
      ad: 'Senaryo yolları 200', sonuc: o.yollarToplam == null || o.yollar200 == null ? 'yok' : o.yollar200 === o.yollarToplam ? 'gecti' : 'uyari',
      deger: o.yollarToplam == null ? undefined : `${fmtNumber(o.yollar200)} / ${fmtNumber(o.yollarToplam)}`,
    },
  ];
}

const HATA_KOLONLARI: Kolon[] = [{ anahtar: 'yol', baslik: 'Yol' }, { anahtar: 'status', baslik: 'HTTP', genislik: '5rem' }];

export type OnKontrolBaglami = 'sihirbaz' | 'kayit';
export default function OnKontrolPaneli({ kosu, baglam = 'sihirbaz' }: {
  kosu: Pick<NlKosuAyrinti, 'durum' | 'onKontrol'> & Partial<Pick<NlKosuAyrinti, 'sunucuDegerlendirmesi' | 'isDurumu' | 'isHatasi'>>;
  baglam?: OnKontrolBaglami;
}) {
  const o = kosu.onKontrol;
  const d = onKontrolDegerlendir(kosu);
  const kayit = baglam === 'kayit';
  return (
    <div className="space-y-3">
      {o ? (
        <ul className="grid gap-x-4 gap-y-1.5 @lg/yuk:grid-cols-2" aria-label="Ön kontrol maddeleri">
          {kontroller(o).map((k) => {
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
