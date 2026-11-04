// src/components/nginx_console/yukTesti/TopluRapor.tsx — Yük Testi › "Toplu rapor" (2026-11-04).
//
// Kullanici: "30 kosuyu tek raporda isterim." Satir = kosu x hiz; hesap sunucuda (GET /rapor, rapor.cjs). Secim adreste
// (?tab=yuktesti&yt=rapor&kuyruk= ya da kosular=): Gece kuyrugu ayrintisi ve Koşular listesindeki "Toplu rapor" buraya gelir.
// Tablo kendi kabinda yatay kayar, ilk kolon sabit. Hiz suzgeci veriden; sutun secici tarayicida hatirlanir. "CSV indir"
// ekranda gorunen kolon ve satirlari yazar (Excel: UTF-8 BOM, ';', ondalik virgul). Yazilamayan kosu ayri listede, nedeniyle.
import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownTrayIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { nginxLoadtestApi, type NlRapor } from '@/api/nginxLoadtestApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtNumber } from '@/utils/datetime';
import { SM_BTN, TBL_BTN, TH_STIL, smBtn } from '@/components/server_hub/retirementStil';
import { UyariKutusu } from '@/components/server_hub/RetirementUi';
import { Bolum, GIRDI_TABAN, girdiStili } from './YukUi';
import { hataMetni } from './yukTestiOrtak';
import { ATLAMA_METNI, RAPOR_KOLONLARI, TEMEL_KOLONLAR, csvMetni, kolonSecimiOku, kolonSecimiYaz, raporHizlari, urlDurumuOku } from './topluRaporOrtak';

export default function TopluRapor() {
  const [sp] = useSearchParams();
  const { kuyruk, kosular } = urlDurumuOku(sp);
  const anahtar = kuyruk != null ? `q${kuyruk}` : kosular.join(',');
  const [veri, setVeri] = useState<NlRapor | null>(null);
  const [hata, setHata] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);
  const [tazele, setTazele] = useState(0);
  const [hiz, setHiz] = useState('');
  const [secili, setSeciliDurum] = useState<string[]>(() => kolonSecimiOku());

  useAsyncEffect(async (alive) => {
    if (kuyruk == null && !kosular.length) {
      setVeri(null);
      setHata('');
      return;
    }
    setYukleniyor(true);
    try {
      const r = await nginxLoadtestApi.rapor(kuyruk != null ? { kuyruk } : { kosular });
      if (!alive()) return;
      setVeri(r);
      setHata('');
    } catch (e) {
      if (!alive()) return;
      setVeri(null);
      setHata(hataMetni(e));
    } finally {
      if (alive()) setYukleniyor(false);
    }
  }, [anahtar, tazele]);

  const setSecili = (l: string[]) => {
    setSeciliDurum(l);
    kolonSecimiYaz(l);
  };
  const hizlar = useMemo(() => raporHizlari(veri?.satirlar ?? []), [veri]);
  const satirlar = useMemo(() => (veri?.satirlar ?? []).filter((s) => !hiz || s.hiz === Number(hiz)), [veri, hiz]);
  const kolonlar = RAPOR_KOLONLARI.filter((k) => secili.includes(k.id));
  const kosuSayisi = new Set((veri?.satirlar ?? []).map((s) => s.kosuNo)).size;

  function csvIndir() {
    const metin = csvMetni(satirlar, kolonlar);
    try {
      const url = URL.createObjectURL(new Blob([metin], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `yuk-testi-toplu-rapor-${kuyruk != null ? `K${kuyruk}` : `${kosular.length}-kosu`}${hiz ? `-${hiz}` : ''}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch { /* tarayici indirmeyi desteklemiyor */ }
  }

  if (kuyruk == null && !kosular.length) {
    return (
      <Bolum baslik="Toplu rapor">
        <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          Gece kuyruğu ayrıntısındaki “Toplu rapor” düğmesini kullanın ya da Koşular listesinde kayıtları seçip “Toplu rapor”a basın.
        </p>
      </Bolum>
    );
  }
  return (
    <div className="space-y-3" data-toplu-rapor>
      <Bolum govdeSinifi="p-3"
        baslik={kuyruk != null ? `Toplu rapor · gece kuyruğu #${kuyruk}` : 'Toplu rapor'}
        aciklama={veri ? `${fmtNumber(kosuSayisi)} koşu · ${fmtNumber(veri.satirlar.length)} satır. Satır = koşu × hız; tekrar varsa ölçüler ortalama, sayaçlar toplamdır.` : undefined}
        eylem={(
          <>
            <select aria-label="Hız süzgeci" value={hiz} onChange={(e) => setHiz(e.target.value)} className={`${GIRDI_TABAN} h-8 w-32`} style={girdiStili()}>
              <option value="">Tüm hızlar</option>
              {hizlar.map((h) => <option key={h} value={h}>{fmtNumber(h)}</option>)}
            </select>
            <details className="relative">
              <summary className={`${SM_BTN} cursor-pointer list-none`} style={smBtn()}>{`Sütunlar (${kolonlar.length}/${RAPOR_KOLONLARI.length})`}</summary>
              <div role="group" aria-label="Sütun seçici" className="absolute right-0 z-20 mt-1 max-h-80 w-64 overflow-y-auto rounded-lg border p-2 shadow-lg" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                <div className="mb-1.5 flex gap-1.5">
                  <button type="button" className={TBL_BTN} style={smBtn()} onClick={() => setSecili(RAPOR_KOLONLARI.map((k) => k.id))}>Tümü</button>
                  <button type="button" className={TBL_BTN} style={smBtn()} onClick={() => setSecili(TEMEL_KOLONLAR)}>Temel</button>
                </div>
                {RAPOR_KOLONLARI.map((k, i) => (
                  <label key={k.id} className="flex items-center gap-2 py-0.5 text-[11px]" style={{ color: 'var(--text-primary)' }}>
                    <input type="checkbox" checked={secili.includes(k.id)} disabled={i === 0}
                      onChange={(e) => setSecili(e.target.checked ? [...secili, k.id] : secili.filter((x) => x !== k.id))} />
                    {k.ad}
                  </label>
                ))}
              </div>
            </details>
            <button type="button" className={SM_BTN} style={smBtn()} disabled={yukleniyor} onClick={() => setTazele((x) => x + 1)}>
              <ArrowPathIcon className={`h-3.5 w-3.5 ${yukleniyor ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden /> Yenile
            </button>
            <button type="button" className={SM_BTN} style={smBtn()} disabled={!satirlar.length} onClick={csvIndir} title="Görünen sütun ve satırları yazar">
              <ArrowDownTrayIcon className="h-3.5 w-3.5" aria-hidden /> CSV indir
            </button>
          </>
        )}>
        {hata ? <UyariKutusu ton="hata" rol="alert" baslik="Rapor okunamadı">{hata}</UyariKutusu>
          : !veri ? <div className="skeleton h-24 rounded-lg" aria-busy="true"><span className="sr-only">Rapor yükleniyor…</span></div>
            : !satirlar.length ? <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>Rapora yazılacak ölçüm yok.</p>
              : (
                <div className="max-h-[70vh] overflow-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }} tabIndex={0} role="region" aria-label="Rapor tablosu, yatay kaydırılabilir">
                  <table className="w-max border-separate border-spacing-0 text-[12px]" aria-label="Toplu rapor">
                    <thead>
                      <tr>
                        {kolonlar.map((k, i) => (
                          <th key={k.id} scope="col" title={k.ipucu} className={`sticky top-0 whitespace-nowrap border-b px-2.5 py-2 text-[11px] font-semibold ${k.sayisal ? 'text-right' : 'text-left'} ${i === 0 ? 'left-0 z-20' : 'z-10'}`}
                            style={{ ...TH_STIL, background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>{k.ad}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody style={{ color: 'var(--text-primary)' }}>
                      {satirlar.map((s) => (
                        <tr key={`${s.kosuNo}-${s.hiz}`}>
                          {kolonlar.map((k, i) => {
                            const m = k.metin(s);
                            const uzun = k.id === 'nedenler' || k.id === 'olasiNeden' || k.id === 'diskKanit';
                            return (
                              <td key={k.id} title={uzun && m !== '—' ? m : undefined}
                                className={`border-b px-2.5 py-1.5 ${k.sayisal ? 'text-right tabular-nums' : ''} ${uzun ? 'max-w-[22rem] truncate' : 'whitespace-nowrap'} ${i === 0 ? 'sticky left-0 z-[5] font-mono font-semibold' : ''}`}
                                style={{ borderColor: 'var(--border-subtle)', ...(i === 0 ? { background: 'var(--bg-surface)' } : {}) }}>{m}</td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
      </Bolum>
      {veri && veri.atlananlar.length > 0 && (
        <UyariKutusu ton="uyari" baslik={`Rapora yazılmayan kayıt: ${fmtNumber(veri.atlananlar.length)}`}>
          <ul className="space-y-0.5">
            {veri.atlananlar.map((a, i) => (
              <li key={`${a.kosuId ?? 'oge'}-${i}`}>{`${a.kosuId != null ? `#${a.kosuId}` : 'Kuyruk öğesi'}${a.etiket ? ` ${a.etiket}` : ''}: ${ATLAMA_METNI[a.neden] ?? a.neden}`}</li>
            ))}
          </ul>
        </UyariKutusu>
      )}
    </div>
  );
}
