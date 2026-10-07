// src/components/server_hub/retirementAdim.ts — hedef satirinin TEK birincil eylemi (2026-10-08).
//
// Kullanici: "plan ve akis butonlari bir garip gozukuyor... retirement'i baslatma desek?"
// Eskiden satirda HER ZAMAN bir "Plan" dugmesi vardi, STOP ise plan bittikten sonra nedeni
// belli olmadan beliriyordu. Simdi tek giris noktasi var ve adim durumdan TURETILIR:
//
//   bekliyor / basarisiz / geri alinmis  ->  "Retirement'i baslat"  (1. adim: ON KONTROL)
//   on kontrol suruyor                   ->  (dugme yok, satir "on kontrol suruyor")
//   on kontrol hazir                     ->  "Sonucu gor ve onayla" (2. adim: ONAY penceresi)
//                                            + ikincil "On kontrolu yenile"
//   OCO'ya zamanlandi / durduruluyor / durduruldu / siliniyor / silindi / geri aliniyor
//                                        ->  bu dugme YOK (o durumlarin kendi dugmeleri var)
//
// GUVENLIK KAPISI DEGISMEDI: geri alinamaz adim (STOP) yine yalniz on kontrol BASARIYLA
// donduyse acilir ve onay penceresi dokunulacak dosyalari gosterir. Sunucu da ayni kapiyi
// uygular (server/retirement/index.cjs: onayli STOP yalniz 'planned' hedefte).
//
// 'stop_scheduled'DA ON KONTROL YOK: sunucu on kontrol baslatinca hedefi 'planning'e ceker
// ve OCO penceresine zamanlanmis STOP SESSIZCE dusuyordu (eski "Plan" dugmesi o durumda da
// gorunuyordu). Sunucu artik bunu reddediyor; ekran da sunmuyor.
import type { RtTargetStatus } from '@/api/retirementApi';

export type RtAdimTur = 'baslat' | 'onayla' | 'suruyor' | 'yok';
export interface RtAdim {
  tur: RtAdimTur;
  /** Birincil dugme metni; 'yok'/'suruyor'da bos. */
  etiket: string;
  /** Dugmenin ne yapacagini SOYLEYEN ipucu - ozellikle "hicbir sey degismez" bilgisi. */
  ipucu: string;
  /** 'onayla'da ikincil eylem: on kontrolu tazele. */
  yenile: boolean;
}

const BASLATILABILIR: ReadonlySet<RtTargetStatus> = new Set(['pending', 'failed', 'skipped', 'active']);

export function retirementAdimi(status: RtTargetStatus, kayitKapali: boolean): RtAdim {
  const yok: RtAdim = { tur: 'yok', etiket: '', ipucu: '', yenile: false };
  if (kayitKapali) return yok;
  if (status === 'planning') return { ...yok, tur: 'suruyor' };
  if (status === 'planned')
    return {
      tur: 'onayla',
      etiket: 'Sonucu gör ve onayla',
      ipucu: 'Ön kontrol tamamlandı: dokunulacak dosyaları gör, onaylarsan uygulama durdurulur',
      yenile: true,
    };
  if (BASLATILABILIR.has(status))
    return {
      tur: 'baslat',
      etiket: status === 'failed' ? "Retirement'ı yeniden başlat" : "Retirement'ı başlat",
      ipucu: '1. adım: sunucuda ön kontrol — ne yapılacağını okur, HİÇBİR ŞEY DEĞİŞMEZ. Bitince onay penceresi açılır.',
      yenile: false,
    };
  return yok;
}
