// src/components/admin/tabs/SelfServisTasimaDetay.tsx — Self Servis Taşıma detay çekmecesi
// (2026-11-10): template karşılaştırması, survey farkı, etkilenecek ayarlar, engeller, kayıtlar.
// Portal template ayarlarını DÜZELTMEZ; yalnız gösterir (survey yazımı hariç, o ayrı pencerede).
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { fmtDateTime } from '@/utils/datetime';
import { ssTasimaApi, type SsTasimaDetay, type SurveyFarkSatiri, type SsTasimaKaydi } from '@/api/ssTasimaApi';

const ETIKET: Record<SurveyFarkSatiri['etiket'], string> = {
  yalniz_kaynakta: 'yalnız kaynakta',
  yalniz_hedefte: 'yalnız hedefte',
  farkli: 'farklı',
  ayni: 'aynı',
};

function hucre(v: unknown, olculemedi?: boolean): string {
  if (olculemedi) return 'ölçülemedi';
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'açık' : 'kapalı';
  return String(v);
}

function alanHucre(a: SurveyFarkSatiri['kaynak'], alan: string): string {
  if (!a) return '—';
  if (alan === 'default') return a.parola ? 'gizli – kopyalanamaz' : a.default || '—';
  if (alan === 'choices') return a.choices.join(', ') || '—';
  if (alan === 'required') return a.required ? 'evet' : 'hayır';
  if (alan === 'minmax') return a.min === null && a.max === null ? '—' : `${a.min ?? ''}–${a.max ?? ''}`;
  return String((a as unknown as Record<string, unknown>)[alan] ?? '—');
}

export function KayitListesi({ kayitlar }: { kayitlar: SsTasimaKaydi[] }) {
  if (!kayitlar.length) return <p className="text-gray-400">Kayıt yok.</p>;
  return (
    <ul className="space-y-1">
      {kayitlar.map((k) => (
        <li key={k.id} className="border border-gray-100 rounded-lg px-2 py-1">
          <b>{k.status}</b> · #{k.fromServer}/{k.fromTemplate} → #{k.toServer}/{k.toTemplate} ({k.eslesme === 'ad' ? 'ad eşleşti' : 'elle seçildi'})
          <span className="block text-gray-500">
            açan {k.createdBy || '—'} {k.createdAt ? fmtDateTime(k.createdAt) : ''}
            {k.tasiyan ? ` · taşıyan ${k.tasiyan} ${k.tasindiAt ? fmtDateTime(k.tasindiAt) : ''}` : ''}
            {k.geriAlan ? ` · geri alan ${k.geriAlan} ${k.geriAlindiAt ? fmtDateTime(k.geriAlindiAt) : ''}` : ''}
            {k.denemeJobId ? ` · deneme işi #${k.denemeJobId}` : ''}
            {k.surveyYazildi ? ' · survey yazıldı' : ''}
            {k.denemesizGerekce ? ` · denemesiz: ${k.denemesizGerekce}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function SelfServisTasimaDetay({
  itemId,
  to,
  toT,
  onKapat,
}: {
  itemId: string;
  to: number;
  toT: number | null;
  onKapat: () => void;
}) {
  const [d, setD] = useState<SsTasimaDetay | null>(null);
  const [hata, setHata] = useState('');
  const [ayniAcik, setAyniAcik] = useState(false);

  // Çekmece servis başına yeniden kurulur (çağıran `key` verir): durum sıfırlamaya gerek yok.
  useEffect(() => {
    let canli = true;
    if (!toT) return;
    ssTasimaApi
      .detay(itemId, to, toT)
      .then((r) => canli && setD(r))
      .catch((e: unknown) => canli && setHata(e instanceof Error ? e.message : String(e)));
    return () => {
      canli = false;
    };
  }, [itemId, to, toT]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onKapat();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onKapat]);

  const s = d?.satir;
  const farklar = (d?.surveyFarki || []).filter((x) => ayniAcik || x.etiket !== 'ayni');
  const ayniSayisi = (d?.surveyFarki || []).filter((x) => x.etiket === 'ayni').length;

  const icerik = (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Taşıma detayı">
      <div className="absolute inset-0 bg-black/30" onClick={onKapat} />
      <aside className="relative w-full max-w-3xl h-full overflow-y-auto bg-white shadow-xl p-4 text-xs space-y-4" style={{ background: 'var(--bg-surface, #fff)' }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{s ? s.title : 'Taşıma detayı'}</h3>
          <button onClick={onKapat} aria-label="Kapat" className="p-1 rounded hover:bg-gray-100">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
        {!toT && <p role="alert" className="text-red-600">Önce hedef template seçin.</p>}
        {hata && <p role="alert" className="text-red-600">{hata}</p>}
        {toT && !d && !hata && <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />}
        {d && d.tasindi && (
          <section>
            {d.tutarsiz ? (
              <p className="text-red-700">
                Taşıma kaydı "taşındı" diyor ama kart hedefe bağlı değil (elle ya da eski bir liste yazımıyla değişmiş). Satırdaki
                "Kaydı kapat" düğmesiyle kaydı kapatın; kart değişmez.
              </p>
            ) : (
              <p className="text-blue-700">Bu servis taşınmış. Geri almak için satırdaki "Geri al" düğmesini kullanın.</p>
            )}
            <h4 className="font-semibold mt-3 mb-1">Taşıma kayıtları</h4>
            <KayitListesi kayitlar={d.kayitlar} />
          </section>
        )}
        {d && !d.tasindi && s && (
          <>
            <section>
              <h4 className="font-semibold mb-1">1. Template karşılaştırması</h4>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-1 pr-2">Alan</th>
                    <th className="py-1 pr-2">Kaynak #{s.kaynakTemplate.id}</th>
                    <th className="py-1">Hedef #{s.hedefTemplate?.id}</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.templateKarsilastirma || []).map((r) => (
                    <tr key={r.alan} className={r.farkli ? 'bg-amber-50' : ''}>
                      <td className="py-0.5 pr-2">{r.etiket}</td>
                      <td className="py-0.5 pr-2 font-mono break-all">{hucre(r.kaynak, r.kaynakOlculemedi)}</td>
                      <td className="py-0.5 font-mono break-all">{hucre(r.hedef, r.hedefOlculemedi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-gray-500 mt-1">Template ayarlarını AWX ekibi düzeltmeli; Portal bunları değiştirmez.</p>
            </section>

            <section>
              <h4 className="font-semibold mb-1">
                2. Survey farkı{' '}
                <span className="font-normal text-gray-500">
                  (kaynak: {s.kaynakSurveyModu || '—'}, hedef: {s.hedefSurveyModu || '—'})
                </span>
              </h4>
              {farklar.length === 0 && ayniSayisi === 0 && <p className="text-gray-400">Survey sorusu yok.</p>}
              {(farklar.length > 0 || ayniSayisi > 0) && (
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-1 pr-2">Değişken</th>
                      <th className="py-1 pr-2">Durum</th>
                      {['question_name', 'type', 'required', 'default', 'choices', 'minmax'].map((a) => (
                        <th key={a} className="py-1 pr-2">
                          {a === 'question_name' ? 'Soru' : a === 'type' ? 'Tip' : a === 'required' ? 'Zorunlu' : a === 'default' ? 'Varsayılan' : a === 'choices' ? 'Seçenekler' : 'Min/Max'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {farklar.map((r) => (
                      <tr key={r.variable} className={r.kritik ? 'text-red-700' : r.etiket === 'ayni' ? 'text-gray-400' : 'text-gray-700'}>
                        <td className="py-0.5 pr-2 font-mono">{r.variable}</td>
                        <td className="py-0.5 pr-2">{ETIKET[r.etiket]}</td>
                        {['question_name', 'type', 'required', 'default', 'choices', 'minmax'].map((a) => {
                          const farkli = r.farklar.includes(a) || (a === 'minmax' && (r.farklar.includes('min') || r.farklar.includes('max')));
                          return (
                            <td key={a} className={'py-0.5 pr-2 break-all ' + (farkli ? 'font-semibold bg-amber-50' : '')}>
                              {alanHucre(r.kaynak, a)}
                              {r.etiket === 'farkli' && farkli ? ` → ${alanHucre(r.hedef, a)}` : ''}
                              {r.etiket === 'yalniz_hedefte' ? alanHucre(r.hedef, a) : ''}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {ayniSayisi > 0 && (
                <button onClick={() => setAyniAcik((v) => !v)} className="mt-1 text-blue-700 hover:underline">
                  {ayniAcik ? 'Aynı olanları gizle' : `Aynı olan ${ayniSayisi} soruyu göster`}
                </button>
              )}
            </section>

            <section>
              <h4 className="font-semibold mb-1">3. Etkilenecek ayarlar</h4>
              {d.uyum && d.uyum.hatalar.length === 0 && d.uyum.uyarilar.length === 0 && <p className="text-green-700">Ayarlar hedefe uyumlu.</p>}
              <ul className="space-y-0.5">
                {(d.uyum?.hatalar || []).map((h) => (
                  <li key={h} className="text-red-700">
                    {h}
                  </li>
                ))}
                {(d.uyum?.uyarilar || []).map((h) => (
                  <li key={h} className="text-amber-800">
                    {h}
                  </li>
                ))}
              </ul>
              {s.tahminSurveyYazilirsa && (
                <p className="mt-1 text-gray-600">
                  Survey yazılırsa: <b>{s.tahminSurveyYazilirsa}</b>
                  {d.uyumTahmin && d.uyumTahmin.hatalar.length > 0 ? ` (${d.uyumTahmin.hatalar.join(' · ')})` : ''}
                </p>
              )}
              {d.hedefAyarFarkli && <p className="mt-1 text-amber-800">Hedefte farklı bir ayar satırı var; deneme koşusu onu onayla ezer (geçmişe arşivlenir).</p>}
            </section>

            <section>
              <h4 className="font-semibold mb-1">4. Engeller ve uyarılar</h4>
              {s.engeller.length > 0 && (
                <div>
                  <p className="font-semibold text-red-700">Önce bitmesi gerekenler</p>
                  <ul>
                    {s.engeller.map((k) => (
                      <li key={k.anahtar} className="text-red-700">
                        <b>{k.adet}</b> × {k.baslik} <span className="text-gray-500">— {k.ipucu}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {s.okunamayan.length > 0 && (
                <div>
                  <p className="font-semibold text-red-700">Kontrol edilemeyenler</p>
                  <ul>
                    {s.okunamayan.map((k, i) => (
                      <li key={`${k.anahtar}-${i}`} className="text-red-700">
                        {k.baslik} <span className="text-gray-500 break-all">— {k.hata}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {s.uyarilar.length > 0 && (
                <div>
                  <p className="font-semibold text-amber-800">Uyarılar</p>
                  <ul>
                    {s.uyarilar.map((u) => (
                      <li key={u} className="text-amber-800">
                        {u}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!s.engeller.length && !s.okunamayan.length && !s.uyarilar.length && <p className="text-green-700">Engel ya da uyarı yok.</p>}
              <p className="text-gray-500 mt-1">Self Servis başlatma yolu kilit almaz; kilit engeli bu ekranda yoktur.</p>
            </section>

            <section>
              <h4 className="font-semibold mb-1">5. Taşıma kayıtları</h4>
              {d.kayitHatasi && <p className="text-red-700">Kayıtlar okunamadı: {d.kayitHatasi}</p>}
              <KayitListesi kayitlar={d.kayitlar} />
            </section>
          </>
        )}
      </aside>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(icerik, document.body) : icerik;
}
