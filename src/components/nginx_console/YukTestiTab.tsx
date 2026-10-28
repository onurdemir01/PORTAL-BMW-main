// src/components/nginx_console/YukTestiTab.tsx — Nginx Hub > "Yük Testi" (2026-10-27).
//
// Kullanici: el kitiyle (glomo_yuk_testi/har_yuk_testi: har_senaryo.py, kos.sh, yuk_k6.js, cpu_kaydedici.sh,
// karsilastir.py) sahada yapilan nginx yuk testini Portal'a tasi. Akis AWX ile: bir playbook, uc kip
// (on_kontrol / kosu / durdur); hedefte CPU kaydedici + access log, yuk sunucusunda k6; sonuclar /sw'ye
// kopyalanir, Portal okuyup adim adim degerlendirir (GECERLI / DOYMA / GECERSIZ) ve iki kosu arasinda karar verir.
//
// Alt gorunumler: Koşular | Yeni koşu (yalniz Admin) | Senaryolar | Karşılaştır. Admin olmayan (sekme yetkisi
// olan) kullanici sonuclari okur; is baslatan / silen dugme ona HIC cizilmez (sunucu da reddeder).
// Yerlesim kapsayici sorgulariyla (@container/yuk): sol menu ve "Taleplerim" paneli acikken icerik 600 px'e
// iniyor; ekran genisligine gore kirilim yanlis yerde iki kolona gecerdi.
// Tur 3 (2026-10-28): hedef IP elle yazilir (sunucu hedefi ya da izinli agdaki LB VIP'i / yonetilmeyen sunucu =
// serbest hedef, yalniz istemci olcumu); yuk araci k6 (acik dongu) ya da wrk (kapali dongu, hiz tavanli).
import React, { useState } from 'react';
import { BeakerIcon, ChartBarSquareIcon, DocumentTextIcon, PlayCircleIcon, ArrowsRightLeftIcon } from '@heroicons/react/24/outline';
import KosuListesi from './yukTesti/KosuListesi';
import KosuAyrinti from './yukTesti/KosuAyrinti';
import YeniKosu from './yukTesti/YeniKosu';
import Senaryolar from './yukTesti/Senaryolar';
import Karsilastir from './yukTesti/Karsilastir';

type Gorunum = 'kosular' | 'yeni' | 'senaryolar' | 'karsilastir';
const GORUNUMLER: { id: Gorunum; ad: string; ikon: React.ComponentType<React.SVGProps<SVGSVGElement>>; yalnizAdmin?: boolean }[] = [
  { id: 'kosular', ad: 'Koşular', ikon: ChartBarSquareIcon },
  { id: 'yeni', ad: 'Yeni koşu', ikon: PlayCircleIcon, yalnizAdmin: true },
  { id: 'senaryolar', ad: 'Senaryolar', ikon: DocumentTextIcon },
  { id: 'karsilastir', ad: 'Karşılaştır', ikon: ArrowsRightLeftIcon },
];

export function YukTestiTab({ isAdmin }: { isAdmin: boolean }) {
  const [gorunum, setGorunum] = useState<Gorunum>('kosular');
  const [kosuId, setKosuId] = useState<number | null>(null);
  const gorunur = GORUNUMLER.filter((g) => isAdmin || !g.yalnizAdmin);
  const etkin: Gorunum = gorunur.some((g) => g.id === gorunum) ? gorunum : 'kosular';
  // Alt sekmeye tiklamak ayrintiyi da kapatir: ayrintidayken "Koşular"a basan kullanici listeyi bekler.
  const git = (g: Gorunum) => { setGorunum(g); setKosuId(null); };

  return (
    <div className="@container/yuk space-y-4" data-yuk-testi>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            <BeakerIcon className="h-5 w-5" style={{ color: 'var(--nginx-green)' }} aria-hidden /> Yük Testi
          </h2>
          <p className="mt-0.5 text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
            DEV / TEST / QA nginx sunucusuna ya da izinli ağdaki bir LB VIP’ine k6 (sabit istek/sn) ya da wrk (sabit bağlantı, hız tavanlı) ile yük: sunucu hedefinde
            istek başına CPU (nginx worker), p95 ve kapasite ölçülür; serbest hedefte (LB / envanterde olmayan sunucu) yalnız istemci ölçümü yapılır. İki koşu
            karşılaştırılıp bir ayar değişikliğinin kalıp kalmayacağına karar verilir. Önce ön kontrol (yük üretmez), sonra onaylı koşu.
            {!isAdmin && <> Salt okunur: koşu başlatma ve senaryo yönetimi yöneticilere açıktır.</>}
          </p>
        </div>
        <div role="tablist" aria-label="Yük Testi bölümleri" className="flex flex-wrap gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)' }}>
          {gorunur.map((x) => {
            const secili = etkin === x.id;
            return (
              <button key={x.id} type="button" role="tab" aria-selected={secili} onClick={() => git(x.id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${secili ? 'shadow-sm' : ''}`}
                style={secili ? { background: 'var(--bg-surface)', color: 'var(--text-primary)', boxShadow: 'inset 0 0 0 1px var(--border)' } : { color: 'var(--text-muted)' }}>
                <x.ikon className="h-4 w-4" aria-hidden /> {x.ad}
              </button>
            );
          })}
        </div>
      </div>

      {etkin === 'kosular' && (kosuId != null
        ? <KosuAyrinti key={kosuId} kosuId={kosuId} isAdmin={isAdmin} onGeri={() => setKosuId(null)} />
        : <KosuListesi onAc={setKosuId} />)}
      {etkin === 'yeni' && isAdmin && <YeniKosu onBasladi={(id) => { setGorunum('kosular'); setKosuId(id); }} onSenaryolar={() => git('senaryolar')} />}
      {etkin === 'senaryolar' && <Senaryolar isAdmin={isAdmin} />}
      {etkin === 'karsilastir' && <Karsilastir />}
    </div>
  );
}

export default YukTestiTab;
