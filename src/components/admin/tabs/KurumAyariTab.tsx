// src/components/admin/tabs/KurumAyariTab.tsx — Admin > Kurum Ayarı (2026-11-27).
//
// Kullanıcı: "kurum ayarını Portal'da güncellemek mümkün mü? sürekli local bir dosyayı elle mi
// güncellememiz gerekecek?" KURUM_AYAR_DOSYASI'nın gösterdiği JSON dosyası burada okunur,
// bölüm bölüm ya da tümüyle düzenlenir, kaydetmeden önce fark gösterilir, eski hale dönülür.
// Sunucu (server/admin/kurum-ayari-duzenle.cjs) yedek alır, atomik yazar, 409 ile çakışmayı keser;
// okuyan modüller yeniden başlatma olmadan yeni dosyayı görür. Belge: docs/KURUM-AYARI.md.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowPathIcon, EyeIcon } from '@heroicons/react/24/outline';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import LoadError from '@/components/common/LoadError';
import { useOnay } from '@/components/common/OnayPenceresi';
import {
  kurumAyariApi,
  type KaydetGovdesi,
  type KaydetYaniti,
  type KurumAyariDurumu,
  type KurumAyariYedekIcerigi,
} from '@/api/kurumAyariApi';
import FarkOnizleme from './kurumayari/FarkOnizleme';
import YedekGecmisi from './kurumayari/YedekGecmisi';
import {
  ayarVerisi,
  bolumMetni,
  degisenYollar,
  hedefOlustur,
  IHLAL_METNI,
  onizlemeOlustur,
  type Onizleme,
} from './kurumayari/duzenleyici';

type Mesaj = { tur: 'ok' | 'hata' | 'bilgi'; metin: string };

const TON: Record<Mesaj['tur'], React.CSSProperties> = {
  ok: { background: 'var(--status-success-bg)', color: 'var(--status-success)' },
  hata: { background: 'var(--status-danger-bg)', color: 'var(--status-danger-text)' },
  bilgi: { background: 'var(--status-info-bg)', color: 'var(--status-info)' },
};

function MesajKutusu({ mesaj }: { mesaj: Mesaj }) {
  return (
    <div
      role={mesaj.tur === 'hata' ? 'alert' : 'status'}
      className="rounded-lg px-3 py-2 text-sm whitespace-pre-line"
      style={TON[mesaj.tur]}
    >
      {mesaj.metin}
    </div>
  );
}

function SaltOkunur({ durum }: { durum: KurumAyariDurumu }) {
  return (
    <div className="space-y-2 text-sm" data-testid="salt-okunur">
      <MesajKutusu
        mesaj={{
          tur: 'bilgi',
          metin: durum.envTanimli
            ? `${durum.dosyaAdi} okunamadı: ${durum.hata}. Portal dosya oluşturmaz; dosyanın sunucuda var olduğunu ve Portal kullanıcısının okuyabildiğini kontrol edin.`
            : `${durum.envAdi} tanımlı değil: düzenlenecek bir kurum ayar dosyası yok.`,
        }}
      />
      {!durum.envTanimli && (
        <ol className="list-decimal pl-5 space-y-1" style={{ color: 'var(--text-secondary)' }}>
          <li>
            Dosyayı sunucuda, repo dışında oluşturun (biçim:{' '}
            <code>deploy/kurum-ayari.ornek.json</code>).
          </li>
          <li>
            Portal'ın ortam dosyasına <code>{durum.envAdi}=/tam/yol/kurum-ayari.json</code> satırını
            ekleyin.
          </li>
          <li>Portal'ı yeniden başlatın; bu ekran düzenlenebilir hale gelir.</li>
        </ol>
      )}
    </div>
  );
}

function DosyaOzeti({ durum }: { durum: KurumAyariDurumu }) {
  const yazilamaz = durum.dosyaYazilabilir === false || durum.dizinYazilabilir === false;
  return (
    <div className="space-y-2">
      <dl
        className="grid gap-x-6 gap-y-1 text-sm"
        style={{ gridTemplateColumns: 'max-content 1fr' }}
      >
        <dt style={{ color: 'var(--text-muted)' }}>Dosya</dt>
        <dd>
          <code>{durum.dosyaAdi}</code>{' '}
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            ({durum.envAdi})
          </span>
        </dd>
        <dt style={{ color: 'var(--text-muted)' }}>Durum</dt>
        <dd
          style={{ color: durum.gecerli ? 'var(--status-success)' : 'var(--status-danger-text)' }}
        >
          {durum.gecerli ? 'Geçerli JSON' : `Hatalı: ${durum.hata}`}
        </dd>
        <dt style={{ color: 'var(--text-muted)' }}>Değişiklik</dt>
        <dd>
          {fmtDateTime(durum.mtime)} · {fmtNumber(durum.boyut ?? 0)} bayt ·{' '}
          <code title={durum.sha ?? ''}>{durum.sha?.slice(0, 12)}</code>
        </dd>
      </dl>
      {yazilamaz && (
        <MesajKutusu
          mesaj={{
            tur: 'hata',
            metin:
              durum.dosyaYazilabilir === false
                ? 'Portal kullanıcısının bu dosyaya yazma izni yok (dosya salt okunur ya da başkasına ait); kayıt reddedilir. Dosyaya VE bulunduğu dizine yazma izni gerekir.'
                : 'Portal kullanıcısının dosyanın bulunduğu dizine yazma izni yok; kayıt izin hatası verir. Dosyaya VE dizine yazma izni gerekir (yedek alt dizini ve geçici dosya aynı dizinde oluşur).',
          }}
        />
      )}
      {durum.repoIci && (
        <MesajKutusu
          mesaj={{
            tur: 'bilgi',
            metin: `${durum.dosyaAdi} repo çalışma ağacının içinde (izlenen dosya): Portal'dan kaydedilmez. Denemek için dosyayı repo dışına kopyalayıp ${durum.envAdi} ile gösterin.`,
          }}
        />
      )}
    </div>
  );
}

function sonucMesaji(r: KaydetYaniti): Mesaj {
  if (r.code === 'sunucu-adi')
    return {
      tur: 'hata',
      metin: `${r.error}\n${(r.ihlaller ?? []).map((x) => `• ${x.yol}: ${IHLAL_METNI[x.neden] ?? x.neden}`).join('\n')}`,
    };
  return { tur: 'hata', metin: r.error || `Kaydedilemedi (HTTP ${r._httpStatus ?? '?'}).` };
}

export default function KurumAyariTab() {
  const { onayla, onayPenceresi } = useOnay();
  const [durum, setDurum] = useState<KurumAyariDurumu | null>(null);
  const [yukHata, setYukHata] = useState<string | null>(null);
  const [bolum, setBolum] = useState('');
  const [metin, setMetin] = useState('');
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null);
  const [mesaj, setMesaj] = useState<Mesaj | null>(null);
  const [cakisma, setCakisma] = useState(false);
  const [yedekSurumu, setYedekSurumu] = useState(0);
  const [mesgul, setMesgul] = useState(false);
  const mesgulRef = useRef(false);
  // Çakışmadan sonra yeniden yüklemede başkasının değiştirdiği yollar (üç yollu uyarı için).
  const [baskasininYollari, setBaskasininYollari] = useState<string[]>([]);

  const veri = useMemo(() => (durum?.gecerli ? ayarVerisi(durum.icerik) : null), [durum]);

  /** Durumu okur; `metniKoru` çakışmadan sonra admin'in yazdığını silmez. */
  const yukle = useCallback(async (metniKoru = false): Promise<KurumAyariDurumu | null> => {
    try {
      const d = await kurumAyariApi.durum();
      setDurum(d);
      setYukHata(null);
      setOnizleme(null);
      setCakisma(false);
      if (!metniKoru) {
        setBolum('');
        setMetin(d.icerik ?? '');
        setBaskasininYollari([]);
      }
      return d;
    } catch (e) {
      setYukHata((e as Error).message);
      return null;
    }
  }, []);
  useAsyncEffect(
    async (alive) => {
      if (alive()) await yukle();
    },
    [yukle],
  );

  const hedef = useMemo(() => hedefOlustur(veri, bolum, metin), [veri, bolum, metin]);

  const bolumSec = (b: string) => {
    setBolum(b);
    setMetin(bolumMetni(veri, b, durum?.icerik ?? null));
    setOnizleme(null);
    setMesaj(null);
    // Metin güncel dosyadan geldi: çakışma uyarısının dayanağı kalmadı.
    setBaskasininYollari([]);
  };

  const farkiGoster = () => {
    if (!hedef.ok) return;
    setOnizleme(
      onizlemeOlustur(bolum ? `“${bolum}” bölümü` : 'Tüm dosya', veri, hedef.metin, hedef.veri, {
        mevcutMetin: durum?.icerik,
        baskasininYollari,
        maksBayt: durum?.sinirlar.maksBayt,
      }),
    );
    setMesaj(null);
  };

  const yedegiOnizle = (y: KurumAyariYedekIcerigi) => {
    const yv = ayarVerisi(y.icerik);
    if (!yv) {
      setMesaj({ tur: 'hata', metin: `${y.ad} geçerli bir JSON nesnesi değil; geri yüklenemez.` });
      return;
    }
    // Yedek adı, dosyanın DEĞİŞTİRİLDİĞİ an; içerik o andan önceki hal.
    setOnizleme(
      onizlemeOlustur(`Yedeğe dönüş: ${fmtDateTime(y.zaman)} öncesindeki hal`, veri, y.icerik, yv, {
        geriYuklenenYedek: y.ad,
        mevcutMetin: durum?.icerik,
        maksBayt: durum?.sinirlar.maksBayt,
      }),
    );
    setMesaj(null);
  };

  const sonucuIsle = async (r: KaydetYaniti) => {
    if (r.ok && r.degisiklikYok) {
      setMesaj({ tur: 'bilgi', metin: 'Değişiklik yok: dosya zaten bu içerikte.' });
      return;
    }
    if (r.ok) {
      // Kayittan sonra ayni bolumde kalinir; bolum silindiyse tum dosyaya donulur.
      const d = await yukle(true);
      setBaskasininYollari([]);
      if (d) {
        const yeniVeri = ayarVerisi(d.icerik);
        const kalanBolum = yeniVeri && Object.hasOwn(yeniVeri, bolum) ? bolum : '';
        setBolum(kalanBolum);
        setMetin(bolumMetni(yeniVeri, kalanBolum, d.icerik));
      }
      setYedekSurumu((n) => n + 1);
      setMesaj({
        tur: 'ok',
        metin: `Kaydedildi; yeniden başlatmadan geçerli. Eski hal yedeklendi (${r.yedek}).`,
      });
      return;
    }
    if (r.code === 'cakisma') setCakisma(true);
    setMesaj(sonucMesaji(r));
  };

  const kaydet = async () => {
    if (!onizleme || !durum?.sha || mesgulRef.current) return;
    mesgulRef.current = true;
    setMesgul(true);
    try {
      const govde: KaydetGovdesi = { icerik: onizleme.hedefMetin, oncekiSha: durum.sha };
      if (onizleme.geriYuklenenYedek) govde.geriYuklenenYedek = onizleme.geriYuklenenYedek;
      const { silinenBolumler, silinenSunucuAlanlari } = onizleme;
      if (silinenBolumler.length || silinenSunucuAlanlari.length) {
        const satirlar = [
          silinenBolumler.length
            ? `Silinen ya da boşaltılan bölüm: ${silinenBolumler.join(', ')}`
            : '',
          silinenSunucuAlanlari.length
            ? `Silinen sunucu alanı: ${silinenSunucuAlanlari.join(', ')}`
            : '',
        ].filter(Boolean);
        const evet = await onayla({
          baslik: 'Bölüm ya da sunucu listesi silinecek',
          metin: `${satirlar.join('\n')}\n\nOnları okuyan ekranlar "kurum ayarı yok" der.`,
          onayMetni: 'Sil ve kaydet',
          tehlikeli: true,
        });
        if (!evet) return;
        govde.bolumSilmeOnayi = true;
      }
      await sonucuIsle(await kurumAyariApi.kaydet(govde));
    } catch (e) {
      setMesaj({ tur: 'hata', metin: (e as Error).message });
    } finally {
      mesgulRef.current = false;
      setMesgul(false);
    }
  };

  const yenidenYukle = async () => {
    const eskiVeri = veri;
    const d = await yukle(true);
    if (!d) return;
    const baskasi = degisenYollar(eskiVeri, ayarVerisi(d.icerik));
    setBaskasininYollari(baskasi);
    const ek = bolum
      ? ' Bölüm kipinde diğer bölümler güncel halden alınır.'
      : ' Tüm dosya kipindesiniz: editördeki metin dosyanın ESKİ haline dayanıyor; kaydederseniz başkasının değişikliği geri alınır. Fark ön izlemesi bu yolları ayrıca işaretler; emin değilseniz "Değişiklikleri at" ile güncel dosyadan başlayın.';
    setMesaj({
      tur: bolum ? 'bilgi' : 'hata',
      metin: `Dosyanın güncel hali yüklendi; editördeki metniniz korundu. Farkı yeniden gösterip kaydedin.${ek}`,
    });
  };

  const kaydetEtiketi = onizleme?.geriYuklenenYedek ? 'Bu yedeğe geri dön' : 'Kaydet';

  if (yukHata && !durum)
    return (
      <LoadError title="Kurum ayarı okunamadı" message={yukHata} onRetry={() => void yukle()} />
    );
  if (!durum) return <LoadingLogo />;
  if (!durum.okunabilir) return <SaltOkunur durum={durum} />;

  return (
    <div className="space-y-5">
      {onayPenceresi}
      <DosyaOzeti durum={durum} />

      <section className="space-y-2" aria-label="Düzenleyici">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="kurum-bolum" className="text-sm font-medium">
            Bölüm
          </label>
          <select
            id="kurum-bolum"
            className="input-modern text-sm"
            value={bolum}
            onChange={(e) => bolumSec(e.target.value)}
          >
            <option value="">Tüm dosya</option>
            {veri &&
              durum.bolumler.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
          </select>
          <span
            className="text-xs"
            style={{ color: hedef.ok ? 'var(--status-success)' : 'var(--status-danger-text)' }}
            data-testid="json-durumu"
          >
            {hedef.ok ? 'Geçerli JSON' : hedef.hata}
          </span>
          <button
            type="button"
            onClick={() => bolumSec(bolum)}
            className="btn-secondary text-xs ml-auto inline-flex items-center gap-1"
          >
            <ArrowPathIcon className="w-3.5 h-3.5" /> Değişiklikleri at
          </button>
        </div>
        <textarea
          aria-label="Kurum ayarı JSON"
          className="input-modern w-full text-xs"
          style={{ fontFamily: 'var(--font-mono)', minHeight: '22rem' }}
          spellCheck={false}
          value={metin}
          onChange={(e) => {
            setMetin(e.target.value);
            setOnizleme(null);
          }}
        />
        <button
          type="button"
          disabled={!hedef.ok}
          onClick={farkiGoster}
          className="btn-primary flex items-center gap-2 px-3 py-2 text-sm rounded-lg disabled:opacity-50"
        >
          <EyeIcon className="w-4 h-4" /> Farkı göster
        </button>
      </section>

      {mesaj && <MesajKutusu mesaj={mesaj} />}
      {cakisma && (
        <button type="button" onClick={() => void yenidenYukle()} className="btn-secondary">
          Yeniden yükle
        </button>
      )}

      {onizleme && (
        <section
          className="rounded-lg border p-4 space-y-3"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
          aria-label="Fark ön izlemesi"
        >
          <h3 className="text-sm font-semibold">Kaydedilecek değişiklik: {onizleme.baslik}</h3>
          {onizleme.bos ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {onizleme.yalnizBicim
                ? 'Yalnız biçim değişti (girinti, boşluk ya da anahtar sırası); değerler aynı. Kaydedilebilir.'
                : 'Değişiklik yok.'}
            </p>
          ) : (
            <FarkOnizleme fark={onizleme.fark} />
          )}
          {!!onizleme.cakisanYollar.length && (
            <MesajKutusu
              mesaj={{
                tur: 'hata',
                metin: `Bu yolları siz düzenlerken başkası değiştirdi; kaydederseniz onun değişikliği ezilir:\n${onizleme.cakisanYollar.map((y) => `• ${y}`).join('\n')}`,
              }}
            />
          )}
          {onizleme.boyutAsimi && (
            <MesajKutusu
              mesaj={{
                tur: 'hata',
                metin: `Dosya en çok ${fmtNumber(durum.sinirlar.maksBayt)} bayt olabilir; kayıt reddedilir.`,
              }}
            />
          )}
          {!!onizleme.ihlaller.length && (
            <MesajKutusu
              mesaj={{
                tur: 'hata',
                metin: `Sunucu adı kuralı (harfle başlar; harf, rakam, tire) ihlali — kayıt reddedilir:\n${onizleme.ihlaller.map((x) => `• ${x.yol}: ${IHLAL_METNI[x.neden] ?? x.neden}`).join('\n')}`,
              }}
            />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={
                mesgul ||
                (onizleme.bos && !onizleme.yalnizBicim) ||
                !!onizleme.ihlaller.length ||
                onizleme.boyutAsimi ||
                !!durum.repoIci
              }
              onClick={() => void kaydet()}
              className="btn-primary flex items-center gap-2 px-3 py-2 text-sm rounded-lg disabled:opacity-50"
            >
              {mesgul ? 'Kaydediliyor…' : kaydetEtiketi}
            </button>
            <button type="button" onClick={() => setOnizleme(null)} className="btn-secondary">
              İptal
            </button>
          </div>
        </section>
      )}

      <YedekGecmisi
        surum={yedekSurumu}
        maksYedek={durum.sinirlar.maksYedek}
        onSec={yedegiOnizle}
        pasif={mesgul}
      />
    </div>
  );
}
