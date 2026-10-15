// src/components/admin/tabs/SystemConfigTab.tsx — Admin > Sistem (yalniz kompozisyon).
//
// Yerlesim: giris metni, durum kutulari (ayni zamanda suzgec), restart bandi, onbellekler,
// yapiskan arama cubugu ve 4 bolum altinda 17 katlanir grup karti. Satirda okuma, satirda
// duzenleme; riskli degisiklik onay penceresinden gecer. Veri ve durum `sistem/useSistemAyarlari`,
// kurallar `sistem/ayarKurallari`, meta veri `sistem/ortamDegiskenleri`.
//
// YOL VE VARSAYILAN DISA AKTARIM DEGISMEZ: AdminPage, AdminDayaniklilik mock'u ve HY4 bu
// dosyayi bu adla ice aktarir.
//
// HY4 (src/components/__tests__/HataYokDegil.test.tsx) KILITLEDIKLERI — bozmayin:
//   (a) Butun satirlar her zaman monte: sanal liste yok; kapali grup `inert` ama DOM'da.
//   (b) Deger `<input value>` degil metin; '3000' kendi span'inda.
//   (c) Ayrintilar kosullu cizilir: ornek deger kapaliyken DOM'da yok.
//   (d) Hata aninda "yükleniyor…" metni yok; kutular "—".
//   (e) LoadError kutusundaki ILK dugme "Tekrar dene".
//   (f) Basarida hicbir oge tam olarak "okunamadı" yazmaz.
//
// KOK KAP `relative` (SD1): AppLayout'ta `main` konumlandirilmamis; sr-only/absolute ogeler
// aksi halde main'in DISINA yerlesir ve overflow-hidden kok kabi kaydirir (bos ekran).
// KAYDIRMA yalniz en yakin kaydirma kabinda (sistem/kaydir.ts); scrollIntoView YOK (SD2).
//
// HOOK'LAR EN USTTE, ERKEN RETURN YOK (hook-order bekcisi).
import React, { useRef, useState } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import LoadError from '@/components/common/LoadError';
import EmptyState from '@/components/common/EmptyState';
import { toast } from '@/hooks/useToast';
import { ENV_VARS, type EnvVarMeta } from './sistem/ortamDegiskenleri';
import { BOLUMLER, GRUPLAR, type Grup } from './sistem/gruplar';
import {
  eslesir,
  onayGerekce,
  ozet,
  suzgectenGecer,
  uygulanma,
  type Suzgec,
} from './sistem/ayarKurallari';
import { useSistemAyarlari } from './sistem/useSistemAyarlari';
import OzetSeridi from './sistem/OzetSeridi';
import YenidenBaslatmaBandi from './sistem/YenidenBaslatmaBandi';
import OnbellekPaneli from './sistem/OnbellekPaneli';
import AyarAracCubugu from './sistem/AyarAracCubugu';
import AyarGrubu from './sistem/AyarGrubu';
import AyarSatiri from './sistem/AyarSatiri';
import KritikDegisiklikOnayi, { type OnayIstegi } from './sistem/KritikDegisiklikOnayi';
import { ogeyeKaydir } from './sistem/kaydir';

const tercihAnahtari = (id: string) => `admin.sistem.grup.${id}`;

/** Grup acik/kapali tercihi. Varsayilan KAPALI. Depolama kapaliysa yalniz bu ziyaret. */
function tercihleriOku(): Record<string, boolean> {
  const t: Record<string, boolean> = {};
  for (const g of GRUPLAR) {
    try {
      t[g.id] = window.localStorage.getItem(tercihAnahtari(g.id)) === '1';
    } catch {
      t[g.id] = false;
    }
  }
  return t;
}

function tercihYaz(id: string, acik: boolean) {
  try {
    window.localStorage.setItem(tercihAnahtari(id), acik ? '1' : '0');
  } catch {
    /* depolama yoksa tercih bu ziyaretle sinirli kalir */
  }
}

function hareketAzalt(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const META = new Map(ENV_VARS.map((m) => [m.key, m]));
const META_GRUBU = new Map<string, Grup>();
for (const m of ENV_VARS) {
  const g = GRUPLAR.find((x) => x.ad === m.group);
  if (g) META_GRUBU.set(m.key, g);
}

export default function SystemConfigTab() {
  const s = useSistemAyarlari();
  const [arama, setArama] = useState('');
  const [suzgec, setSuzgec] = useState<Suzgec>('tumu');
  const [tercih, setTercih] = useState<Record<string, boolean>>(tercihleriOku);
  // Gecici acilis (Gruba git, restart bandi): tercihe YAZILMAZ.
  const [gecici, setGecici] = useState<ReadonlySet<string>>(new Set());
  // Kullanicinin ELLE kapattigi gruplar: otomatik acilisi (eksik, taslak, arama) bastirir.
  const [kapatilan, setKapatilan] = useState<ReadonlySet<string>>(new Set());
  const [odaklanacak, setOdaklanacak] = useState<string | null>(null);
  const [onay, setOnay] = useState<OnayIstegi | null>(null);
  const duzenleDugmeleri = useRef(new Map<string, HTMLButtonElement>());
  const grupBasliklari = useRef(new Map<string, HTMLButtonElement>());
  const aracCubugu = useRef<HTMLDivElement>(null);
  // Duzenleyici kapaninca odak bu anahtarin "Duzenle" dugmesine doner (dugme yeniden monte
  // olurken ref geri cagrisi odaklar — effect'e gerek yok).
  const odakBekleyen = useRef<string | null>(null);

  const durum = s.durum;
  const hazir = durum === 'tamam';
  const suzmeVar = arama.trim() !== '' || suzgec !== 'tumu';
  const ozetSayilari = ozet(ENV_VARS, s.degerler, s.restartBekleyen);

  const gorunurMu = (m: EnvVarMeta, g: Grup) =>
    eslesir(m, s.degerler[m.key], g.ad, arama) &&
    suzgectenGecer(suzgec, m, s.degerler[m.key], s.kirliMi(m.key), s.restartBekleyen.has(m.key));

  const grupVerisi = GRUPLAR.map((g) => {
    const metalar = ENV_VARS.filter((m) => m.group === g.ad);
    const gorunen = suzmeVar ? metalar.filter((m) => gorunurMu(m, g)) : metalar;
    const bildirilen = metalar.filter((m) => m.saltOkunur !== 'ortam');
    const tanimli = bildirilen.filter((m) => s.degerler[m.key]?.defined).length;
    const eksik = hazir
      ? metalar.filter((m) => m.required && s.degerler[m.key] && !s.degerler[m.key].defined).length
      : 0;
    const kirli = metalar.filter((m) => s.kirliMi(m.key)).length;
    const uygulanmalar = new Set(
      metalar.map((m) => uygulanma(s.degerler[m.key])).filter((u): u is 'canli' | 'restart' => u !== null),
    );
    const grupUygulanma =
      uygulanmalar.size === 0 ? null : uygulanmalar.size > 1 ? 'karisik' : [...uygulanmalar][0];
    const ilgiIstiyor =
      eksik > 0 ||
      kirli > 0 ||
      metalar.some((m) => s.alanHatasi[m.key] || s.bayat[m.key] !== undefined) ||
      (suzmeVar && gorunen.length > 0);
    const acik = kapatilan.has(g.id) ? false : !!tercih[g.id] || gecici.has(g.id) || ilgiIstiyor;
    return {
      grup: g,
      gorunen,
      acik,
      ozet: { tanimli, toplam: bildirilen.length, eksik, kirli },
      uygulanma: grupUygulanma as 'canli' | 'restart' | 'karisik' | null,
    };
  });
  const gorunenGruplar = grupVerisi.filter((v) => v.gorunen.length > 0);
  const gorunenSayi = gorunenGruplar.reduce((n, v) => n + v.gorunen.length, 0);
  const tumuAcik = gorunenGruplar.length > 0 && gorunenGruplar.every((v) => v.acik);

  function aramaDegisti(v: string) {
    setArama(v);
    setKapatilan(new Set());
  }

  function suzgecDegisti(v: Suzgec) {
    setSuzgec(v);
    setKapatilan(new Set());
  }

  function acKapat(id: string, simdiAcik: boolean) {
    tercihYaz(id, !simdiAcik);
    setTercih((t) => ({ ...t, [id]: !simdiAcik }));
    setKapatilan((k) => {
      const n = new Set(k);
      if (simdiAcik) n.add(id);
      else n.delete(id);
      return n;
    });
    if (simdiAcik) {
      setGecici((gc) => {
        const n = new Set(gc);
        n.delete(id);
        return n;
      });
    }
  }

  function tumunuAcKapat() {
    const ac = !tumuAcik;
    const t: Record<string, boolean> = {};
    for (const g of GRUPLAR) {
      t[g.id] = ac;
      tercihYaz(g.id, ac);
    }
    setTercih(t);
    setGecici(new Set());
    setKapatilan(ac ? new Set() : new Set(GRUPLAR.map((g) => g.id)));
  }

  /** Grubu gecici acar, gerekirse suzmeyi kaldirir; `sonra` yerlesim oturunca calisir. */
  function grubuGoster(id: string, gorunur: boolean, sonra: () => void) {
    if (!gorunur) {
      setArama('');
      setSuzgec('tumu');
    }
    setGecici((gc) => new Set(gc).add(id));
    setKapatilan((k) => {
      const n = new Set(k);
      n.delete(id);
      return n;
    });
    window.requestAnimationFrame(() => window.requestAnimationFrame(sonra));
  }

  function grubaGit(id: string) {
    const gorunur = gorunenGruplar.some((v) => v.grup.id === id);
    grubuGoster(id, gorunur, () => {
      const el = grupBasliklari.current.get(id);
      if (!el) return;
      ogeyeKaydir(el, aracCubugu.current, hareketAzalt());
      el.focus({ preventScroll: true });
    });
  }

  function ayaraGit(key: string) {
    const g = META_GRUBU.get(key);
    if (!g) return;
    const satirGorunur = gorunenGruplar.some((v) => v.gorunen.some((m) => m.key === key));
    grubuGoster(g.id, satirGorunur, () => {
      const satir = document.getElementById(`ayar-${key}`);
      if (satir) ogeyeKaydir(satir, aracCubugu.current, hareketAzalt());
      duzenleDugmeleri.current.get(key)?.focus({ preventScroll: true });
    });
  }

  function duzenle(key: string) {
    s.duzenlemeyiAc(key);
    setOdaklanacak(key);
  }

  function iptal(key: string) {
    odakBekleyen.current = key;
    s.duzenlemeyiKapat(key);
    setOdaklanacak(null);
  }

  /**
   * Sunucu kaydi reddetti; hata satirin altinda (role=alert) ama satir gorunmeyebilir
   * (denetim 2026-10-15). Kayit surerken grup elle kapatildiysa grup yeniden acilir — hata
   * elle kapatmayi ezer; gecici acilis, Iptal'den sonra grup kullanicinin altindan kapanmasin
   * (odak "Duzenle"ye inert bir grupta donemezdi). Arama/suzgec satiri listeden dusurduyse
   * satir DOM'da yok: hata bildirim balonuyla da soylenir.
   */
  function kayitHatasiniGoster(key: string, hata: string) {
    const g = META_GRUBU.get(key);
    if (g) {
      setKapatilan((k) => {
        if (!k.has(g.id)) return k;
        const n = new Set(k);
        n.delete(g.id);
        return n;
      });
      setGecici((gc) => (gc.has(g.id) ? gc : new Set(gc).add(g.id)));
    }
    if (!document.getElementById(`ayar-${key}`)) {
      toast.error(`${META.get(key)?.label ?? key} kaydedilemedi: ${hata}`);
    }
  }

  async function kaydet(key: string, deger: string) {
    odakBekleyen.current = key;
    const sonuc = await s.kaydet(key, deger);
    if (sonuc.ok) {
      setOdaklanacak(null);
      return true;
    }
    odakBekleyen.current = null;
    if (sonuc.hata) kayitHatasiniGoster(key, sonuc.hata);
    return false;
  }

  function gonder(m: EnvVarMeta, ham: string) {
    const cv = s.degerler[m.key];
    if (!cv) return;
    // Yalniz bosluk = BOS (SA17): sunucu '   ' yazip ayari "Tanimli" gosterirdi; onay penceresi
    // "Silinecek" / "bos" derken sunucuya baska bir sey gitmesin.
    const deger = ham.trim() === '' ? '' : ham;
    const g = onayGerekce(m, cv, deger);
    if (g) setOnay({ meta: m, cv, yeni: deger, ...g });
    else void kaydet(m.key, deger);
  }

  async function onayla() {
    if (!onay) return;
    await kaydet(onay.meta.key, onay.yeni);
    setOnay(null);
  }

  return (
    <div className="@container/sistem relative space-y-6">
      <p className="max-w-3xl text-xs leading-relaxed text-[var(--text-secondary)]">
        Değerler Portal veritabanına kaydedilir ve çalışan sunucuya hemen aktarılır. “Canlı uygulanır”
        etiketli gruplar kaydedildiği anda, diğerleri sunucu yeniden başlatılınca geçerli olur. Gizli
        değerler bu ekranda hiçbir zaman tam gösterilmez.
      </p>

      <section aria-labelledby="sistem-durum">
        <h3 id="sistem-durum" className="sr-only">
          Durum
        </h3>
        <OzetSeridi durum={durum} ozet={ozetSayilari} aktif={suzgec} onSec={suzgecDegisti} />
      </section>

      <YenidenBaslatmaBandi
        liste={s.restartBekleyen}
        onAyaraGit={ayaraGit}
        onTemizle={s.restartListesiniTemizle}
      />

      <OnbellekPaneli />

      <section aria-labelledby="sistem-ayarlar" className="space-y-4">
        <h3 id="sistem-ayarlar" className="sr-only">
          Ayarlar
        </h3>
        <AyarAracCubugu
          arama={arama}
          onArama={aramaDegisti}
          suzgec={suzgec}
          onSuzgecKaldir={() => suzgecDegisti('tumu')}
          bolumler={BOLUMLER}
          gruplar={GRUPLAR}
          onGrubaGit={grubaGit}
          kirliSayisi={s.kirliSayisi}
          onTaslaklariGoster={() => suzgecDegisti('taslak')}
          gorunenSayi={gorunenSayi}
          suzmeVar={suzmeVar}
          tumuAcik={tumuAcik}
          onTumunuAcKapat={tumunuAcKapat}
          kokRef={aracCubugu}
        />

        <div id="sistem-ayar-listesi" aria-busy={durum === 'yukleniyor'} className="space-y-6">
          {durum === 'hata' && (
            <LoadError
              compact
              title="Ortam değişkenleri okunamadı"
              message={s.hata}
              onRetry={s.tekrarDene}
              testId="sistem-ayar-hatasi"
            />
          )}

          {suzmeVar && gorunenSayi === 0 && (
            <EmptyState
              icon={<MagnifyingGlassIcon aria-hidden="true" className="w-9 h-9" />}
              title="Eşleşen ayar yok"
              description="Aramayı ya da süzgeci değiştirin. Gizli değerlerin içeriğinde arama yapılmaz."
              action={
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    aramaDegisti('');
                    suzgecDegisti('tumu');
                  }}
                >
                  Aramayı ve süzgeci temizle
                </button>
              }
            />
          )}

          {BOLUMLER.map((b) => {
            const gruplar = gorunenGruplar.filter((v) => v.grup.bolum === b.id);
            if (gruplar.length === 0) return null;
            return (
              <section key={b.id} aria-labelledby={`sistem-bolum-${b.id}`} className="space-y-3">
                <h3
                  id={`sistem-bolum-${b.id}`}
                  className="text-[11px] !font-semibold uppercase !tracking-wider !text-[var(--text-muted)]"
                >
                  {b.ad}
                </h3>
                {gruplar.map((v) => (
                  <AyarGrubu
                    key={v.grup.id}
                    grup={v.grup}
                    acik={v.acik}
                    onAcKapat={() => acKapat(v.grup.id, v.acik)}
                    ozet={v.ozet}
                    uygulanma={v.uygulanma}
                    baslikRef={(el) => {
                      if (el) grupBasliklari.current.set(v.grup.id, el);
                      else grupBasliklari.current.delete(v.grup.id);
                    }}
                  >
                    {v.gorunen.map((m) => (
                      <AyarSatiri
                        key={m.key}
                        meta={m}
                        grup={v.grup}
                        cv={s.degerler[m.key]}
                        durum={durum}
                        taslak={s.taslaklar[m.key]}
                        kirli={s.kirliMi(m.key)}
                        bayatDeger={s.bayat[m.key]}
                        kaydediliyor={s.kaydediliyor.has(m.key)}
                        hata={s.alanHatasi[m.key]}
                        yeniKaydedildi={!!s.yeniKaydedilen[m.key]}
                        restartBekliyor={s.restartBekleyen.has(m.key)}
                        odakla={odaklanacak === m.key}
                        duzenleRef={(el) => {
                          if (!el) {
                            duzenleDugmeleri.current.delete(m.key);
                            return;
                          }
                          duzenleDugmeleri.current.set(m.key, el);
                          if (odakBekleyen.current === m.key) {
                            odakBekleyen.current = null;
                            el.focus();
                          }
                        }}
                        onDuzenle={() => duzenle(m.key)}
                        onTaslak={(val) => s.taslakYaz(m.key, val)}
                        onIptal={() => iptal(m.key)}
                        onGonder={(val) => gonder(m, val)}
                        onSil={() => gonder(m, '')}
                      />
                    ))}
                  </AyarGrubu>
                ))}
              </section>
            );
          })}
        </div>
      </section>

      <KritikDegisiklikOnayi
        istek={onay}
        kaydediliyor={!!onay && s.kaydediliyor.has(onay.meta.key)}
        onIptal={() => setOnay(null)}
        onOnayla={() => void onayla()}
      />
    </div>
  );
}
