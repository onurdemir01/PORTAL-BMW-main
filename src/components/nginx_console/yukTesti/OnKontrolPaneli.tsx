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
// TUR 4 (2026-11-02): aracli satirda (aracId != null) motor satirindan once "Araç kopyası (sha256)" (iki hedef turunde);
// eski satirda bu satir YOK. Yuk sunucusunun glibc'si bilgi satirinda.
// HTTP/2 (2026-11-02, h2_sozlesme.md 5.2): h2 kosusunun on kontrolunde son satir "HTTP/2 (ALPN)" (gecti: her yanitli yol h2;
// kaldi: hedef h2 sunmuyor; olculemedi: curl h2'siz / yanitli yol yok / eski playbook). h1'de satir YOK (gorunum BIREBIR).
// TEK HEDEF MODELI (2026-11-13): sunucu hedefinde `hedefNginx` false ise nginx'e ozgu satirlar (server_name, master,
// /web_log, log_format) yerine tek "Nginx" satiri (uyari: bulunamadi, genel CPU olculur); null ise "Nginx" satiri kaldi
// (belirlenemedi) ve nginx satirlari durur; alan yoksa (eski playbook) satirlar BIREBIR eskisi.
import React from 'react';
import { CheckCircleIcon, ExclamationTriangleIcon, MinusCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import type { NlKosuAyrinti, NlMotor, NlOnKontrol } from '@/api/nginxLoadtestApi';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtNumber } from '@/utils/datetime';
import { TabloIskelet, UyariKutusu, type Kolon } from '@/components/server_hub/RetirementUi';
import { kosuProtokolu, motorOf, onKontrolDegerlendir } from './yukTestiOrtak';

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
/** Tur 4: yuk sunucusundaki arac kopyasi (Portal'in sha256'siyla dogrulama). Dogrulandi ve hata yok: gecti (ilk 12 hane);
 *  dogrulanmadi ya da dogrulandi ama calistirilamadi (glibc uyumsuz ...): kaldi (hata metni); blok kosmadi: olculemedi. */
function aracSatiri(o: NlOnKontrol): Kontrol {
  const ad = 'Araç kopyası (sha256)';
  if (o.aracDogrulandi === true && !o.aracHata) return { ad, sonuc: 'gecti', deger: o.aracSha256 ? `${o.aracSha256.slice(0, 12)}…` : undefined };
  if (o.aracDogrulandi === false || (o.aracDogrulandi === true && o.aracHata)) return { ad, sonuc: 'kaldi', deger: o.aracHata || undefined };
  return { ad, sonuc: 'yok' };
}
/** HTTP/2 (ALPN) satiri: n2 / ny sayilari bilinmiyorsa '?'. On kontrol h2 icin yapilmadiysa (protokol h1) ya da curl h2'siz
 *  ya da yanitli yol yoksa olculemedi (gecti DEGIL). alpnKaynak 'openssl' (curl h2'siz, ALPN openssl ile): gecti / kaldi
 *  openssl metniyle; olculemediyse asagidaki 'yok' yolu. */
function h2Satiri(o: NlOnKontrol): Kontrol {
  const ad = 'HTTP/2 (ALPN)';
  const s = (v: number | null | undefined) => (v == null ? '?' : fmtNumber(v));
  const yapilmadi = typeof o.protokol === 'string' && o.protokol !== 'h2';
  // curl HTTP/2'siz yuk makinesi: ALPN openssl ile olculdu (yollar HTTP/1.1 ile denendi, h2 yol sayisi yok).
  if (!yapilmadi && o.alpnKaynak === 'openssl') {
    if (o.alpnH2 === true) return { ad, sonuc: 'gecti', deger: 'Hedef ALPN ile HTTP/2 sunuyor (openssl ile ölçüldü; curl HTTP/2’siz, yollar HTTP/1.1 ile denendi)' };
    if (o.alpnH2 === false) return { ad, sonuc: 'kaldi', deger: 'Hedef bu Host için HTTP/2 sunmuyor (openssl ile ölçüldü)' };
    return { ad, sonuc: 'yok', deger: 'curl HTTP/2’siz; ALPN openssl ile ölçülemedi' };
  }
  if (!yapilmadi && o.alpnH2 === true) return { ad, sonuc: 'gecti', deger: `${s(o.yollarH2)}/${s(o.yollarYanitli)} yol HTTP/2 ile yanıt verdi` };
  if (!yapilmadi && o.alpnH2 === false && o.curlH2 !== false) return { ad, sonuc: 'kaldi', deger: `Hedef bu Host için HTTP/2 sunmuyor (${s(o.yollarH2)}/${s(o.yollarYanitli)} yol)` };
  return { ad, sonuc: 'yok', deger: o.curlH2 === false ? 'curl HTTP/2 desteklemiyor' : undefined };
}
function kontroller(o: NlOnKontrol, serbest: boolean, motor: NlMotor, isHatasi: string | null, aracli: boolean, h2: boolean): Kontrol[] {
  // Eski (aracsiz) satirda arac satiri YOK: gorunum degismez. h1'de HTTP/2 satiri YOK.
  const arac = aracli ? [aracSatiri(o)] : [];
  const h2Satirlari = h2 ? [h2Satiri(o)] : [];
  if (serbest) {
    return [
      // Hedef IP yuk sunucusunun kendisi olamaz (istek gonderilmez): yerel DEGIL = gecti.
      { ad: 'IP yük sunucusunda yerel değil', sonuc: o.ipYukMakinesinde == null ? 'yok' : o.ipYukMakinesinde ? 'kaldi' : 'gecti' },
      // serbest_ag yalniz izin dosyasi IP'yi kapsadiginda dolu (yoksa yollar atlanir, kayit FAILED). Bos iken kaldi YALNIZ
      // Play 3 ret metniyle (dosya okundu ve reddetti); izin bloguna hic gelinmediyse olculemedi (UV1).
      { ad: 'Yük sunucusu izin dosyası', sonuc: o.serbestAg ? 'gecti' : /serbest izin listesi/.test(isHatasi ?? '') ? 'kaldi' : 'yok', deger: o.serbestAg || undefined },
      ...arac,
      motorSatiri(o, motor),
      yollarSatiri(o),
      ...h2Satirlari,
    ];
  }
  const df = o.webLogDf;
  if (o.hedefNginx === false) {
    return [
      { ad: 'IP hedefte yerel', sonuc: ikili(o.ipYerel) },
      { ad: 'Nginx', sonuc: 'uyari', deger: 'bulunamadı — genel CPU ölçülür' },
      ...arac,
      motorSatiri(o, motor),
      yollarSatiri(o),
      ...h2Satirlari,
    ];
  }
  return [
    { ad: 'IP hedefte yerel', sonuc: ikili(o.ipYerel) },
    ...(o.hedefNginx === null ? [{ ad: 'Nginx', sonuc: 'kaldi' as const, deger: 'belirlenemedi' }] : o.hedefNginx === true ? [{ ad: 'Nginx', sonuc: 'gecti' as const }] : []),
    // D7: Host basligi listede olmayabilir (joker / regex ad): kaldi degil uyari.
    { ad: 'server_name nginx -T’de', sonuc: ikili(o.serverNameVar, 'uyari') },
    { ad: 'Tek nginx master', sonuc: o.masterSayisi == null ? 'yok' : o.masterSayisi === 1 ? 'gecti' : 'kaldi', deger: o.masterSayisi == null ? undefined : `${fmtNumber(o.masterSayisi)} master` },
    { ad: '/web_log doluluğu < %65', sonuc: df == null ? 'yok' : df < 65 ? 'gecti' : 'uyari', deger: df == null ? undefined : `%${fmtNumber(df)}` },
    { ad: 'Log dizini okunur', sonuc: ikili(o.logDiziniOkunur) },
    { ad: 'log_format “user-agent=” yazıyor', sonuc: ikili(o.logFormatUa, 'uyari') },
    ...arac,
    motorSatiri(o, motor),
    yollarSatiri(o),
    ...h2Satirlari,
  ];
}

const HATA_KOLONLARI: Kolon[] = [{ anahtar: 'yol', baslik: 'Yol' }, { anahtar: 'status', baslik: 'HTTP', genislik: '5rem' }];

export type OnKontrolBaglami = 'sihirbaz' | 'kayit';
export default function OnKontrolPaneli({ kosu, baglam = 'sihirbaz' }: {
  kosu: Pick<NlKosuAyrinti, 'durum' | 'onKontrol'> & Partial<Pick<NlKosuAyrinti, 'sunucuDegerlendirmesi' | 'isDurumu' | 'isHatasi' | 'hedefTuru' | 'motor' | 'parametreler' | 'aracId' | 'protokol'>>;
  baglam?: OnKontrolBaglami;
}) {
  const o = kosu.onKontrol;
  const d = onKontrolDegerlendir(kosu);
  const kayit = baglam === 'kayit';
  const motor: NlMotor = kosu.motor === 'wrk' || kosu.motor === 'k6' ? kosu.motor : motorOf(kosu.parametreler);
  const h2 = motor !== 'wrk' && kosuProtokolu(kosu) === 'h2';
  return (
    <div className="space-y-3">
      {o ? (
        <ul className="grid gap-x-4 gap-y-1.5 @lg/yuk:grid-cols-2" aria-label="Ön kontrol maddeleri">
          {kontroller(o, kosu.hedefTuru === 'serbest', motor, kosu.isHatasi ?? null, kosu.aracId != null, h2).map((k) => {
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
