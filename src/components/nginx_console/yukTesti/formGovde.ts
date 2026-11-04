// src/components/nginx_console/yukTesti/formGovde.ts — "Yeni koşu" formu <-> on kontrol govdesi (2026-11-04).
//
// Kullanici: "kaydolan bir senaryoyu modifiye edemiyorum" / "onden bir testi komple kaydedebiliyor muyuz". Duzenleme
// (taslak ya da bekleyen kuyruk ogesi) ve kayitli test ayni yoldan formu doldurur: formGovdeden. Formdan govdeye yon
// YeniKosu'da (sinirlar ve hedef sinifi orada); bu fonksiyon onun tersidir: dolu form ayni govdeyi yeniden uretir.
import type { NlAe, NlKip, NlKuyrukGovde, NlMotor, NlProtokol, NlVarsayilanlar } from '@/api/nginxLoadtestApi';
import { srvDizinOku } from './yukTestiOrtak';

export interface Form {
  senaryoId: string; hedefHost: string; hedefIp: string; yukHost: string; sni: boolean; motor: NlMotor;
  /** null: kullanici yazmadi -> onerilen (senaryonun vhost'u ya da sunucunun tek server_name'i). */
  vhost: string | null;
  /** null: kullanici degistirmedi -> hedef turunun varsayilani (serbestte 50 100 200 / 50). */
  hizlar: string | null; maxvu: string | null;
  baglantilar: string; is_parcacigi: string;
  tekrar: string; isinma: string; sure: string; bosluk: string; bosta: string; kip: NlKip; ae: NlAe; etiket: string;
  /** Kullanicinin secimi; gonderilen deger wrk'de ya da sunucu h2 kabul etmiyorsa h1 (bkz. `protokol`). */
  protokol: NlProtokol;
  /** Sunucuyu kosu oncesi ayarla (yalniz sunucu hedefinde etkili); seviye / dizin metin girdisi. */
  srvAyar: boolean; srvSeviye: string; srvStatic: boolean; srvDizin: string;
}

export const formBaslangic = (v: NlVarsayilanlar, yukHost = '', h2Acik = false): Form => ({
  senaryoId: '', hedefHost: '', hedefIp: '', vhost: null, yukHost, sni: false, motor: v.motor === 'wrk' ? 'wrk' : 'k6',
  hizlar: null, maxvu: null, baglantilar: v.baglantilar.join(' '), is_parcacigi: String(v.is_parcacigi),
  tekrar: String(v.tekrar), isinma: String(v.isinma), sure: String(v.sure), bosluk: String(v.bosluk),
  bosta: String(v.bosta), kip: h2Acik && v.protokol === 'h2' ? 'ka' : v.kip, ae: v.ae, etiket: '',
  protokol: h2Acik && v.protokol === 'h2' ? 'h2' : 'h1',
  srvAyar: false, srvSeviye: '', srvStatic: false, srvDizin: srvDizinOku(),
});

/**
 * Formu govdeden doldurur. Diger motorun alanlari formda kalir (kullanici motoru degistirirse degerler yerinde); sunucu
 * ayari yoksa son dizin kalir. Etiket bos: kayitli testte saklanmaz, kuyruk ogesinin etiketi ayri alandir.
 */
export function formGovdeden(form: Form, g: NlKuyrukGovde): Form {
  const p = g.parametreler;
  const wrk = p.motor === 'wrk';
  const a = p.sunucuAyar ?? null;
  return {
    ...form,
    senaryoId: String(g.senaryoId), hedefHost: g.hedefHost ?? '', hedefIp: g.hedefIp, vhost: g.vhost, yukHost: g.yukHost, sni: g.sni === true,
    motor: wrk ? 'wrk' : 'k6',
    hizlar: !wrk && p.hizlar ? p.hizlar.join(' ') : form.hizlar,
    maxvu: !wrk && p.maxvu != null ? String(p.maxvu) : form.maxvu,
    baglantilar: wrk && p.baglantilar ? p.baglantilar.join(' ') : form.baglantilar,
    is_parcacigi: wrk && p.is_parcacigi != null ? String(p.is_parcacigi) : form.is_parcacigi,
    tekrar: String(p.tekrar), isinma: String(p.isinma), sure: String(p.sure), bosluk: String(p.bosluk), bosta: String(p.bosta),
    kip: p.kip, ae: p.ae, etiket: '', protokol: p.protokol === 'h2' ? 'h2' : 'h1',
    srvAyar: !!a, srvSeviye: a?.seviye != null ? String(a.seviye) : '', srvStatic: a?.static === true, srvDizin: a?.dizin ?? form.srvDizin,
  };
}

/** Formun govdesinden kosu etiketini atar (kuyruk ogesi ve kayitli test etiketsiz saklanir). */
export function etiketsizGovde(g: NlKuyrukGovde & { etiket?: string }): NlKuyrukGovde {
  const kopya = { ...g };
  delete kopya.etiket;
  return kopya;
}
