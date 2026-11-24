// src/components/nginx_console/yukTesti/KosuCiktisi.tsx — kosunun canli AWX ciktisi (2026-10-27).
//
// Retirement "İş çıktısı" goruntuleyicisinin (server_hub/RetirementIsCiktisi.tsx) yuk testine uyarlanmis hali:
// oradaki kanca retirementApi'ye bagli; saf yardimcilar (retirementCikti.ts), stil (retirementStil.ts) ve gorunum
// parcalari (common/IsCiktisiParcalari.tsx, 2026-11-24) ortak. Fark: is KOSU KAYDINDAN cozulur (GET /kosular/:id/durum) - sunucu ve is
// numarasi istemciden gitmez; cikti artimli gelir (`since`) ve `ciktiBirlestir` ile eklenir.
//
// YOKLAMA: seri (yanit gelmeden yeni istek yok), AbortController ile iptal, cikti uzadiysa 1,5 sn yoksa 3 sn,
// gecici hatada 3-6-12-24-30 sn geri cekilme ve 6. hatada durma, kalici retde (401/403/404/409) hemen durma,
// sekme gizliyken istek yok. `onBitti` yalniz canli gorulen is bitince BIR kez cagrilir (kaydi yeniden oku).
import React, { useEffect, useRef, useState } from 'react';
import AnsibleLogTerminal from '@/components/common/AnsibleLogTerminal';
import { nginxLoadtestApi, type NlDurumYaniti } from '@/api/nginxLoadtestApi';
import { fmtDateTime } from '@/utils/datetime';
import { Cip, UyariKutusu } from '@/components/server_hub/RetirementUi';
import {
  BuyukKatman,
  CanliGosterge,
  CiktiAlani,
  CiktiDugmeleri,
  HataOzeti,
  OkumaHatasiBandi,
  useCiktiGorunumu,
} from '@/components/common/IsCiktisiParcalari';
import {
  EN_COK_DENEME,
  ciktiSonucu,
  geriCekilme,
  hataOzeti,
  redBilgisi,
  sureMetni,
  yoklamaGecikmesi,
} from '@/components/server_hub/retirementCikti';
import { ciktiBirlestir, nedenMetni } from './yukTestiOrtak';

export interface KosuCiktisiDurumu {
  status: string | null;
  bitti: boolean;
  output: string;
  kosuDurum: string | null;
  /** AWX isi tutmuyor / sunucu kapali: cikti Portal arsivinden (ansible_job_output). */
  arsiv: boolean;
  red: { code: string; message: string } | null;
  hata: { deneme: number; sonraSn: number | null; mesaj: string } | null;
  durdu: boolean;
  gizli: boolean;
  sonOkuma: number | null;
  duyuru: string;
}
const BOS: KosuCiktisiDurumu = {
  status: null,
  bitti: false,
  output: '',
  kosuDurum: null,
  arsiv: false,
  red: null,
  hata: null,
  durdu: false,
  gizli: false,
  sonOkuma: null,
  duyuru: '',
};

/** Kalici retin ekran metni (sunucu mesaji once). */
export function kaliciCiktiMesaji(code: string, message?: string): string {
  if (message) return message;
  switch (code) {
    case 'http_401':
      return 'Oturum sona erdi — sayfayı yenileyin.';
    case 'http_403':
      return 'İş çıktısı yalnız yöneticilere açık.';
    case 'http_404':
      return 'Koşu bulunamadı ya da Portal sunucusu bu ucu sunmuyor.';
    default:
      return nedenMetni(code) || 'İş çıktısı okunamadı.';
  }
}

export function useKosuCiktisi(kosuId: number, o: { onBitti?: () => void; etiket?: string } = {}) {
  const [d, setD] = useState<KosuCiktisiDurumu>(BOS);
  const [tetik, setTetik] = useState(0);
  const metin = useRef('');
  const canliGoruldu = useRef(false);
  const bildirildi = useRef(false);
  const geri = useRef({ onBitti: o.onBitti, etiket: o.etiket });
  useEffect(() => {
    geri.current = { onBitti: o.onBitti, etiket: o.etiket };
  });

  useEffect(() => {
    let canli = true;
    let zaman: number | undefined;
    let ac: AbortController | null = null;
    let deneme = 0;
    let gizliBekliyor = false;
    const planla = (ms: number) => {
      zaman = window.setTimeout(oku, ms);
    };
    async function oku() {
      if (!canli) return;
      if (typeof document !== 'undefined' && document.hidden) {
        gizliBekliyor = true;
        setD((x) => ({ ...x, gizli: true }));
        return;
      }
      gizliBekliyor = false;
      ac = new AbortController();
      const since = metin.current.length;
      let r: unknown;
      try {
        r = await nginxLoadtestApi.durum(kosuId, since, ac.signal);
      } catch (e) {
        r = e;
      }
      if (!canli) return;
      const sinif = ciktiSonucu(r);
      if (sinif === 'iptal') return;
      if (sinif === 'veri') {
        const v = r as NlDurumYaniti;
        deneme = 0;
        const onceki = metin.current;
        metin.current = ciktiBirlestir(onceki, v.output, since, v.outputOffset);
        const uzadi = metin.current.length > onceki.length;
        if (!v.finished) canliGoruldu.current = true;
        const sonuc =
          v.status === 'successful'
            ? 'başarılı'
            : v.status === 'canceled'
              ? 'iptal edildi'
              : v.status
                ? 'başarısız'
                : 'bitti';
        const duyuru =
          v.finished && canliGoruldu.current
            ? `${geri.current.etiket || 'AWX'} işi bitti: ${sonuc}`
            : '';
        setD((x) => ({
          ...x,
          status: v.status || null,
          bitti: !!v.finished,
          output: metin.current,
          kosuDurum: v.kosuDurum ?? x.kosuDurum,
          arsiv: v.kaynak === 'arsiv',
          red: null,
          hata: null,
          durdu: false,
          gizli: false,
          sonOkuma: Date.now(),
          duyuru: duyuru || x.duyuru,
        }));
        if (v.finished) {
          if (canliGoruldu.current && !bildirildi.current) {
            bildirildi.current = true;
            geri.current.onBitti?.();
          }
          return;
        }
        planla(yoklamaGecikmesi(uzadi, v.status));
        return;
      }
      const b = redBilgisi(r);
      if (sinif === 'kalici') {
        setD((x) => ({ ...x, red: b, hata: null, durdu: false, gizli: false }));
        return;
      }
      deneme += 1;
      if (deneme >= EN_COK_DENEME) {
        setD((x) => ({
          ...x,
          hata: { deneme, sonraSn: null, mesaj: b.message },
          durdu: true,
          gizli: false,
        }));
        return;
      }
      const ms = geriCekilme(deneme);
      setD((x) => ({
        ...x,
        hata: { deneme, sonraSn: Math.round(ms / 1000), mesaj: b.message },
        durdu: false,
        gizli: false,
      }));
      planla(ms);
    }
    const gorunurluk = () => {
      if (!canli || document.hidden || !gizliBekliyor) return;
      window.clearTimeout(zaman);
      planla(0);
    };
    document.addEventListener('visibilitychange', gorunurluk);
    planla(0);
    return () => {
      canli = false;
      window.clearTimeout(zaman);
      ac?.abort();
      document.removeEventListener('visibilitychange', gorunurluk);
    };
  }, [kosuId, tetik]);

  /** "Yenile" / "Yeniden dene": ciktiyi bastan okur, deneme sayacini sifirlar. */
  const yenile = () => {
    metin.current = '';
    setD((x) => ({ ...x, hata: null, durdu: false, red: null }));
    setTetik((n) => n + 1);
  };
  return { ...d, yenile };
}

/** Kosunun AWX ciktisi: bilgi seridi, hata ozeti, terminal; "Büyüt" ayni durumla tam ekran (odak tuzagi). */
export default function KosuCiktisi({
  kosuId,
  etiket,
  awxJobId,
  basladi,
  onBitti,
  yukseklik = 'min(28rem, calc(100dvh - 22rem))',
}: {
  kosuId: number;
  etiket: string;
  awxJobId?: number | null;
  basladi?: string | null;
  onBitti?: () => void;
  yukseklik?: string;
}) {
  const c = useKosuCiktisi(kosuId, { onBitti, etiket });
  const suruyor = !!c.sonOkuma && !c.bitti;
  const g = useCiktiGorunumu({ suruyor, gizli: c.gizli });

  const bas = basladi ? Date.parse(basladi) : Number.NaN;
  const gecen = Number.isFinite(bas) ? (g.simdi - bas) / 1000 : null;
  const terminalDurumu = !c.status || c.status === 'new' ? 'pending' : c.status;
  const hataliBitti = c.bitti && (c.status === 'failed' || c.status === 'error');
  const ozet = hataliBitti ? hataOzeti(c.output) : [];
  const baslik = `yuk-testi-${kosuId}${awxJobId ? `-${awxJobId}` : ''}`;

  const serit = (katmanda: boolean) => (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-5"
      style={{ color: 'var(--text-secondary)' }}
    >
      <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
        {etiket}
      </span>
      {awxJobId != null && <span className="font-mono tabular-nums">AWX iş #{awxJobId}</span>}
      {basladi && <span className="tabular-nums">başladı {fmtDateTime(basladi)}</span>}
      {suruyor && gecen != null && <span className="tabular-nums">{sureMetni(gecen)} geçti</span>}
      <CanliGosterge g={g} suruyor={suruyor} sonOkuma={c.sonOkuma} gizli={c.gizli} />
      {c.arsiv && (
        <Cip title="AWX işi artık tutmuyor ya da sunucu kapalı; çıktı Portal arşivinden">
          arşivden
        </Cip>
      )}
      <CiktiDugmeleri
        g={g}
        suruyor={suruyor}
        yenile={c.yenile}
        yenileIpucu="Çıktıyı baştan yeniden oku"
        katmanda={katmanda}
      />
    </div>
  );

  const bantlar = (
    <>
      {c.red && (
        <UyariKutusu ton="hata" rol="alert" baslik={kaliciCiktiMesaji(c.red.code, c.red.message)} />
      )}
      <OkumaHatasiBandi hata={c.hata} durdu={c.durdu} yenile={c.yenile} />
      {hataliBitti && <HataOzeti ozet={ozet} />}
    </>
  );

  const govde =
    c.red && !c.output ? null : !c.sonOkuma && !c.output ? (
      <div className="skeleton h-full rounded-xl" aria-busy="true">
        <span className="sr-only">İş çıktısı yükleniyor…</span>
      </div>
    ) : (
      <AnsibleLogTerminal
        size="fill"
        className="h-full"
        output={c.output}
        status={terminalDurumu}
        autoScroll={g.takip}
        title={baslik}
        placeholder={
          c.bitti
            ? 'AWX bu iş için stdout döndürmedi.'
            : 'AWX henüz çıktı üretmedi — iş kuyrukta ya da başlıyor…'
        }
      />
    );

  return (
    <div className="min-w-0 space-y-2" data-yuk-cikti>
      {serit(false)}
      {!g.buyuk && bantlar}
      {govde && <CiktiAlani g={g} yukseklik={yukseklik} enAz="13rem" govde={govde} />}
      <p className="sr-only" aria-live="polite">
        {c.duyuru}
      </p>
      <BuyukKatman g={g} etiket={etiket} serit={serit(true)} bantlar={bantlar} govde={govde} />
      {!c.red && (
        <p className="text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>
          Çıktı Portal’da maskelenir. Sayfadan ayrılsanız da iş sürer; Portal sonuçları iş bitince
          kendisi okur.
        </p>
      )}
    </div>
  );
}
