// src/components/nginx_console/yukTesti/MatrisEkle.tsx — "Yeni koşu" Plan kutusunun altinda toplu ekleme (2026-11-04).
//
// Formun gecerli govdesinden protokol x sikistirma x static ogeleri uretir (matris.ts) ve tek seferde taslaga ekler.
// Kapali kosullar nedeniyle yazilir (matrisKapaliNedeni); sinir 30 (MAX_OGE) kalir. Formun bitmis on kontrolu her ogeye baglanir:
// uyari turleri kuyruk olusturulurken onaya gelir (sunucu her ogeyi kendi ayariyla degerlendirir). Yoksa gece ayni uyari "yeni uyari"
// sayilip ogeler atlanabilir: ekran bunu soyler, ekleme kapanmaz.
import React, { useState } from 'react';
import type { NlHedefTuru, NlKuyrukGovde, NlMotor } from '@/api/nginxLoadtestApi';
import { SM_BTN, smBtn } from '@/components/server_hub/retirementStil';
import { UyariKutusu } from '@/components/server_hub/RetirementUi';
import { sureMetni } from '@/components/server_hub/retirementCikti';
import { Alan, Bolum, GIRDI, girdiStili } from './YukUi';
import { BEKLEME_VARSAYILAN_DK, taslakToplamSn, yeniYerelId, type TaslakOge } from './kuyrukTaslak';
import { MATRIS_PROTOKOLLERI, MATRIS_STATIC, MATRIS_VARSAYILAN, matrisKapaliNedeni, matrisUret, ogeOzeti, type MatrisProtokol, type MatrisSecimi } from './matris';

const degistirListe = <T,>(l: T[], x: T, var_: boolean) => (var_ ? [...l, x] : l.filter((y) => y !== x));

export default function MatrisEkle({ govde, motor, hedefTuru, srvAyarli, hedef, taslakSayisi, onKontrolKosuId, onEkle }: {
  /** Formun etiketsiz govdesi; form kuyruga eklenemez durumdaysa null. */
  govde: NlKuyrukGovde | null; motor: NlMotor; hedefTuru: NlHedefTuru | null; srvAyarli: boolean; hedef: string; taslakSayisi: number;
  /** Bu form ayarlariyla bitmis on kontrol (yoksa null). */
  onKontrolKosuId: number | null; onEkle: (ogeler: TaslakOge[]) => void;
}) {
  const [s, setS] = useState<MatrisSecimi>(MATRIS_VARSAYILAN);
  const { ogeler, hatalar } = matrisUret(govde, s);
  const taslakOgeleri = ogeler.map((o) => ({ ...o, ...ogeOzeti(o.govde.parametreler) }));
  // Ogeler uretilemiyorsa (form hazir degil) sayi secimden kestirilmez: neden zaten gorunur.
  const kapali = matrisKapaliNedeni({ motor, hedefTuru, srvAyarli, formHazir: !!govde, taslakSayisi, ogeSayisi: ogeler.length });
  const eklenir = !kapali && ogeler.length > 0;
  const toplamSn = taslakToplamSn(taslakOgeleri, BEKLEME_VARSAYILAN_DK);
  function ekle() {
    if (!eklenir) return;
    onEkle(taslakOgeleri.map((o) => ({ yerelId: yeniYerelId(), etiket: o.etiket, govde: o.govde, hedef, onKontrolKosuId, ozet: o.ozet, butceSn: o.butceSn })));
  }
  return (
    <Bolum baslik="Toplu ekleme" aciklama="Formdaki ayarlar kopyalanır; yalnız protokol, sıkıştırma ve static değişir. Etiketler kendiliğinden yazılır." govdeSinifi="p-4 space-y-3">
      <fieldset className="min-w-0 space-y-1">
        <legend className="mb-1 text-[11px] font-semibold leading-4" style={{ color: 'var(--text-secondary)' }}>Protokol</legend>
        {MATRIS_PROTOKOLLERI.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" className="accent-[var(--accent)]" checked={s.protokoller.includes(p.id)} onChange={(e) => setS((x) => ({ ...x, protokoller: degistirListe<MatrisProtokol>(x.protokoller, p.id, e.target.checked) }))} />
            {p.ad}
          </label>
        ))}
      </fieldset>
      <Alan id="yuk-matris-br" etiket="Brotli seviyeleri" hata={hatalar.br ?? null} yardim="Boşlukla ayırın; boş bırakılırsa Brotli eklenmez.">
        <input id="yuk-matris-br" value={s.brSeviyeler} onChange={(e) => { const v = e.target.value; setS((x) => ({ ...x, brSeviyeler: v })); }} autoComplete="off" spellCheck={false} className={`${GIRDI} font-mono tabular-nums`} style={girdiStili(!!hatalar.br)} aria-invalid={!!hatalar.br} />
      </Alan>
      <Alan id="yuk-matris-gzip" etiket="Gzip seviyeleri" hata={hatalar.gzip ?? null}>
        <input id="yuk-matris-gzip" value={s.gzipSeviyeler} onChange={(e) => { const v = e.target.value; setS((x) => ({ ...x, gzipSeviyeler: v })); }} autoComplete="off" spellCheck={false} className={`${GIRDI} font-mono tabular-nums`} style={girdiStili(!!hatalar.gzip)} aria-invalid={!!hatalar.gzip} />
      </Alan>
      <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-primary)' }}>
        <input type="checkbox" className="accent-[var(--accent)]" checked={s.sikistirmasiz} onChange={(e) => { const v = e.target.checked; setS((x) => ({ ...x, sikistirmasiz: v })); }} />
        Sıkıştırmasız
      </label>
      <fieldset className="min-w-0 space-y-1">
        <legend className="mb-1 text-[11px] font-semibold leading-4" style={{ color: 'var(--text-secondary)' }}>Static</legend>
        {MATRIS_STATIC.map((t) => (
          <label key={t.ad} className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" className="accent-[var(--accent)]" checked={s.staticler.includes(t.deger)} onChange={(e) => { const v = e.target.checked; setS((x) => ({ ...x, staticler: degistirListe(x.staticler, t.deger, v) })); }} />
            {t.ad === 'static açık' ? 'açık' : 'kapalı'}
          </label>
        ))}
      </fieldset>
      <p className="text-[12px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }} aria-live="polite">
        {ogeler.length ? `${ogeler.length} öğe · ≈ ${sureMetni(toplamSn)}` : '0 öğe'}
      </p>
      {ogeler.length > 0 && (
        <details className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <summary className="cursor-pointer">Öğeleri göster</summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">{ogeler.map((o) => <li key={o.etiket}>{o.etiket}</li>)}</ol>
        </details>
      )}
      {kapali && <p className="text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>{kapali}</p>}
      {eklenir && onKontrolKosuId == null && (
        <UyariKutusu ton="uyari" baslik="Bu ayarlarla bitmiş ön kontrol yok.">
          Ön kontrol uyarıları kuyruk oluşturulurken onaya gelmez; gece aynı uyarı çıkarsa öğeler “yeni uyarı” ile atlanır. Önce ön kontrolü çalıştırın.
        </UyariKutusu>
      )}
      <button type="button" onClick={ekle} disabled={!eklenir} className={`${SM_BTN} h-8 w-full justify-center`} style={smBtn()}>Taslağa toplu ekle</button>
    </Bolum>
  );
}
