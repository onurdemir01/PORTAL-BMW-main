// src/components/admin/tabs/SelfServisTasimaPencereleri.tsx — Self Servis Taşıma işlem pencereleri
// (2026-11-10): Survey'i hedefe yaz, Deneme koşusu (iki adım), Taşı, Geri al.
// Her pencerede birincil düğme ve "İptal" var. Sunucu her kuralı yeniden denetler; buradaki
// kilitler yalnız kullanıcıya yol gösterir.
import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { ansibleApi } from '@/api/ansibleApi';
import { generateScenarios } from '@/utils/ssTestScenarios';
import {
  ssTasimaApi,
  type AlanFarki,
  type GeriAlOnizleme,
  type SsTasimaDetay,
  type SsTasimaSatiri,
} from '@/api/ssTasimaApi';
import { toast } from '@/hooks/useToast';

const GEREKCE_EN_AZ = 10;
const IZLEME_ARALIK_MS = 5000;
const IZLEME_SURE_MS = 10 * 60 * 1000;
const BITTI = ['successful', 'failed', 'error', 'canceled'];

function deger(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v || '""';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function AlanFarkListesi({ farklar }: { farklar: AlanFarki[] }) {
  if (!farklar.length) return <p className="text-gray-400">Alan farkı yok.</p>;
  return (
    <ul className="space-y-0.5 font-mono text-[11px] break-all">
      {farklar.map((f) => (
        <li key={f.alan}>
          <b>{f.alan}</b>: {deger(f.once)} → {deger(f.simdi)}
        </li>
      ))}
    </ul>
  );
}

function Dugmeler({
  onIptal,
  onTamam,
  tamamMetni,
  pasif,
  tehlikeli,
  testId,
}: {
  onIptal: () => void;
  onTamam: () => void;
  tamamMetni: string;
  pasif: boolean;
  tehlikeli?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-2 w-full">
      <button onClick={onIptal} className="px-3 py-1.5 text-sm rounded-lg text-gray-600 hover:text-gray-800">
        İptal
      </button>
      <button
        onClick={onTamam}
        disabled={pasif}
        data-testid={testId}
        className={
          'px-3 py-1.5 text-sm rounded-lg border disabled:opacity-40 ' +
          (tehlikeli ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-blue-200 text-blue-700 hover:bg-blue-50')
        }
      >
        {tamamMetni}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Survey'i hedefe yaz
// ---------------------------------------------------------------------------
export function SurveyYazPenceresi({
  satir,
  to,
  onKapat,
  onBitti,
}: {
  satir: SsTasimaSatiri;
  to: number;
  onKapat: () => void;
  onBitti: () => void;
}) {
  const [detay, setDetay] = useState<SsTasimaDetay | null>(null);
  const [hata, setHata] = useState('');
  const [onay, setOnay] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const [geriFark, setGeriFark] = useState<unknown[] | null>(null);
  const [parolaElle, setParolaElle] = useState<string[] | null>(null);
  const toT = satir.hedefTemplate?.id ?? 0;
  const kapat = satir.surveyEylemi === 'kapat';

  useEffect(() => {
    let canli = true;
    ssTasimaApi
      .detay(satir.itemId, to, toT)
      .then((d) => canli && setDetay(d))
      .catch((e: unknown) => canli && setHata(e instanceof Error ? e.message : String(e)));
    return () => {
      canli = false;
    };
  }, [satir.itemId, to, toT]);

  const silinecek = (detay?.surveyFarki || []).filter((s) => s.etiket === 'yalniz_hedefte');
  const ozet = detay?.surveyOzet;

  async function yaz() {
    setMesgul(true);
    try {
      if (!detay?.hedefSurveyHash) {
        toast.error("Hedef survey'i okunamadı; raporu yenileyin.");
        return;
      }
      const r = await ssTasimaApi.surveyYaz(satir.itemId, to, toT, detay.hedefSurveyHash);
      if (!r.ok) {
        if (Array.isArray(r.fark)) setGeriFark(r.fark as unknown[]);
        toast.error(r.message || 'Survey yazılamadı.');
        return;
      }
      const elle = Array.isArray(r.parolaElle) ? (r.parolaElle as string[]) : [];
      if (elle.length) {
        setParolaElle(elle);
        toast.success(`Survey yazıldı. Parola varsayılanı AWX'te elle girilmeli: ${elle.join(', ')}`);
        return;
      }
      toast.success(kapat ? 'Hedef survey kapatıldı ve doğrulandı.' : 'Survey hedefe yazıldı ve geri okunarak doğrulandı.');
      onBitti();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMesgul(false);
    }
  }

  return (
    <Modal
      open
      onClose={onKapat}
      dismissOnBackdrop={false}
      size="lg"
      title={kapat ? "Hedef survey'ini kapat" : "Survey'i hedefe yaz"}
      subtitle={`${satir.title} → #${toT} ${satir.hedefTemplate?.name || ''}`}
      footer={
        <Dugmeler
          onIptal={parolaElle ? onBitti : onKapat}
          onTamam={() => void yaz()}
          tamamMetni={mesgul ? 'Yazılıyor…' : kapat ? "Hedef survey'ini kapat" : "Survey'i yaz"}
          pasif={!onay || mesgul || !detay || !!parolaElle}
          testId="survey-yaz-onay"
        />
      }
    >
      <div className="space-y-3 text-sm">
        {hata && <p role="alert" className="text-red-600">{hata}</p>}
        {!detay && !hata && <p className="text-gray-400">Fark okunuyor…</p>}
        {detay && kapat && (
          <p>
            Kaynak servis Portal Survey Tasarımcısı kullanıyor (AWX survey kapalı). Hedefte survey açık: tasarımcı alanları
            görünmez. Spec yazılmaz; yalnız hedef template'te <span className="font-mono">survey_enabled=false</span> yapılır.
          </p>
        )}
        {detay && !kapat && ozet && (
          <>
            <p>
              Kaynak survey'i (<b>{ozet.kaynakSoru}</b> soru) hedef template'e yazılacak; hedefte şu an <b>{ozet.hedefSoru}</b> soru var.
              Önce spec yazılır, sonra survey açılır, sonra geri okunup karşılaştırılır.
            </p>
            {silinecek.length > 0 && (
              <p className="text-red-700">
                Hedefte silinecek sorular: <span className="font-mono">{silinecek.map((s) => s.variable).join(', ')}</span>
              </p>
            )}
            {ozet.parolaSoru > 0 && (
              <p className="text-amber-800">
                Parola varsayılanları kaynaktan kopyalanamaz. Hedefte aynı parola sorusunun varsayılanı varsa korunur; yoksa boş
                yazılır ve AWX'te elle girilmelidir (yazımdan sonra liste gösterilir).
              </p>
            )}
          </>
        )}
        {parolaElle && (
          <div className="text-amber-800" data-testid="parola-elle">
            <p className="font-semibold">Survey yazıldı. Şu parola sorularının varsayılanı AWX'te elle girilmeli:</p>
            <p className="font-mono">{parolaElle.join(', ')}</p>
          </div>
        )}
        {geriFark && (
          <div className="text-red-700">
            <p className="font-semibold">Yazıldı ama geri okunan survey beklenenle aynı değil:</p>
            <pre className="text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(geriFark, null, 1)}</pre>
          </div>
        )}
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={onay} onChange={(e) => setOnay(e.target.checked)} />
          <span>Hedef template'in mevcut survey'inin üzerine yazılacağını anladım. (Önceki hâli taşıma kaydında saklanır.)</span>
        </label>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Deneme koşusu (iki adım)
// ---------------------------------------------------------------------------
export function DenemePenceresi({
  satir,
  to,
  onKapat,
  onBitti,
}: {
  satir: SsTasimaSatiri;
  to: number;
  onKapat: () => void;
  onBitti: () => void;
}) {
  const toT = satir.hedefTemplate?.id ?? 0;
  const [metin, setMetin] = useState('{}');
  const [dogrulama, setDogrulama] = useState<{ valid: boolean; message?: string; resolvedExtraVars?: unknown } | null>(null);
  const [uzerineYazOnay, setUzerineYazOnay] = useState<AlanFarki[] | null>(null);
  const [uzerineYaz, setUzerineYaz] = useState(false);
  const [gercekOnay, setGercekOnay] = useState(false);
  const [mesgul, setMesgul] = useState(false);
  const [is, setIs] = useState<{ jobId?: number; durum?: string; bilgi?: string } | null>(null);
  const iptalRef = useRef(false);

  useEffect(() => {
    let canli = true;
    // Başlangıç değeri hedef survey'den (mekanik varsayılan senaryo); okunamazsa {} kalır.
    ansibleApi
      .surveySpecAdmin(to, toT)
      .then((r) => {
        if (!canli || !r || !r.ok || !Array.isArray(r.fields)) return;
        const s = generateScenarios(r.fields, r.surveyEnabled !== false)[0];
        if (s) setMetin(JSON.stringify(s.extraVars, null, 2));
      })
      .catch(() => {});
    return () => {
      canli = false;
      iptalRef.current = true;
    };
  }, [to, toT]);

  function extraVarsOku(): Record<string, unknown> | null {
    try {
      const v = JSON.parse(metin || '{}');
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('nesne değil');
      return v as Record<string, unknown>;
    } catch {
      toast.error('extraVars geçerli bir JSON nesnesi olmalı.');
      return null;
    }
  }

  async function dogrula() {
    const extraVars = extraVarsOku();
    if (!extraVars) return;
    setMesgul(true);
    try {
      const r = await ssTasimaApi.deneme(satir.itemId, { to, toT, extraVars, sadeceDogrula: true, hedefAyarUzerineYaz: uzerineYaz });
      if (!r.ok && r.onayGerekli) {
        setUzerineYazOnay((r.degisiklikler as AlanFarki[]) || []);
        return;
      }
      if (!r.ok) {
        toast.error(r.message || 'Doğrulama yapılamadı.');
        return;
      }
      setDogrulama({ valid: !!r.valid, message: r.message, resolvedExtraVars: r.resolvedExtraVars });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMesgul(false);
    }
  }

  async function izle(jobId: number) {
    const bas = Date.now();
    while (!iptalRef.current && Date.now() - bas < IZLEME_SURE_MS) {
      try {
        const s = await ansibleApi.ssJobStatus(to, jobId);
        setIs({ jobId, durum: s.status });
        if (BITTI.includes(s.status)) {
          onBitti();
          return;
        }
      } catch {
        /* geçici hata: sonraki turda yeniden dene */
      }
      await new Promise((r) => setTimeout(r, IZLEME_ARALIK_MS));
    }
    if (!iptalRef.current) setIs({ jobId, durum: 'bilinmiyor', bilgi: 'Bekleme süresi doldu; durumu sonra raporu yenileyerek kontrol edin.' });
  }

  async function kostur() {
    const extraVars = extraVarsOku();
    if (!extraVars) return;
    setMesgul(true);
    try {
      const r = await ssTasimaApi.deneme(satir.itemId, { to, toT, extraVars, sadeceDogrula: false, confirm: true, hedefAyarUzerineYaz: uzerineYaz });
      if (!r.ok) {
        toast.error(r.message || 'Deneme başlatılamadı.');
        return;
      }
      if (r.pendingApproval) {
        // Sunucu Smart gerektiren denemeyi reddeder; bu dal yalnız beklenmeyen durum içindir.
        setIs({ bilgi: `Gerçek bir Smart talebi açıldı (#${String(r.ticketId ?? '')}). Onaydan sonraki iş deneme sayılmaz; talebi Smart'ta iptal edin ve gerekçeyle taşıyın.` });
        onBitti();
        return;
      }
      if (typeof r.jobId === 'number') {
        setIs({ jobId: r.jobId, durum: 'pending' });
        void izle(r.jobId);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMesgul(false);
    }
  }

  return (
    <Modal
      open
      onClose={onKapat}
      dismissOnBackdrop={false}
      size="xl"
      title="Deneme koşusu (hedefte, kart bağlanmadan)"
      subtitle={`${satir.title} → #${toT} ${satir.hedefTemplate?.name || ''}`}
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <button onClick={onKapat} className="px-3 py-1.5 text-sm rounded-lg text-gray-600 hover:text-gray-800">
            İptal
          </button>
          <button
            onClick={() => void dogrula()}
            disabled={mesgul || (!!uzerineYazOnay && !uzerineYaz)}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
          >
            Hazırla ve doğrula
          </button>
          <button
            onClick={() => void kostur()}
            disabled={mesgul || !dogrulama?.valid || !gercekOnay || !!is?.jobId}
            data-testid="deneme-kostur"
            className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-40"
          >
            Koştur
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">
          Kaynak servis ayarları (Smart onayı, alan ayarları, koşullar) hedef template'e kopyalanır; kart hâlâ kaynağa bağlıdır,
          servis kullanıcıları bu işi kendi geçmişlerinde görmez. Servis Smart onayı istiyorsa deneme yalnız Admin "Smart onayını
          atla" tercihiniz açıkken koşar; kapalıysa reddedilir ve Smart'ta talep açılmaz.
        </p>
        <label className="block">
          <span className="text-xs text-gray-500">extraVars (JSON)</span>
          <textarea
            value={metin}
            onChange={(e) => {
              setMetin(e.target.value);
              setDogrulama(null);
            }}
            rows={8}
            className="mt-1 w-full font-mono text-xs border border-gray-200 rounded-lg p-2"
          />
        </label>
        {uzerineYazOnay && (
          <div className="border border-amber-200 bg-amber-50 rounded-lg p-2 text-amber-900">
            <p className="font-semibold">Hedefte mevcut ayar var, üzerine yazılacak (geçmişe arşivlenir).</p>
            <AlanFarkListesi farklar={uzerineYazOnay} />
            <label className="flex items-center gap-2 mt-1">
              <input type="checkbox" checked={uzerineYaz} onChange={(e) => setUzerineYaz(e.target.checked)} />
              <span>Hedefteki ayarın üzerine yazılsın.</span>
            </label>
          </div>
        )}
        {dogrulama && (
          <div className={dogrulama.valid ? 'text-green-700' : 'text-red-700'}>
            {dogrulama.valid ? 'Doğrulama geçti: hedefte iş bu parametrelerle başlatılabilir.' : `Doğrulama başarısız: ${dogrulama.message || ''}`}
            {dogrulama.valid && dogrulama.resolvedExtraVars !== undefined && (
              <pre className="mt-1 text-[11px] text-gray-600 whitespace-pre-wrap break-all">{JSON.stringify(dogrulama.resolvedExtraVars, null, 1)}</pre>
            )}
          </div>
        )}
        {dogrulama?.valid && (
          <label className="flex items-start gap-2 text-red-700">
            <input type="checkbox" checked={gercekOnay} onChange={(e) => setGercekOnay(e.target.checked)} />
            <span>
              Bu, hedef sunucuda GERÇEK bir iştir ve bu yolda OCO değişiklik penceresi kontrolü YOKTUR: iş pencere dışında da koşar.
              Zararsız parametrelerle koşturuyorum.
            </span>
          </label>
        )}
        {is && (
          <p data-testid="deneme-durum">
            {is.jobId ? (
              <>
                İş <b>#{is.jobId}</b>: <b>{is.durum}</b>
              </>
            ) : null}
            {is.bilgi ? <span className="block text-gray-600">{is.bilgi}</span> : null}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Taşı
// ---------------------------------------------------------------------------
export function TasiPenceresi({
  satir,
  to,
  onKapat,
  onBitti,
}: {
  satir: SsTasimaSatiri;
  to: number;
  onKapat: () => void;
  onBitti: () => void;
}) {
  const denemeVar = !!satir.deneme?.gecerli;
  const [denemesiz, setDenemesiz] = useState(false);
  const [gerekce, setGerekce] = useState('');
  const [mesgul, setMesgul] = useState(false);
  const gerekceGecerli = gerekce.trim().length >= GEREKCE_EN_AZ;
  const hazir = satir.durum === 'HAZIR' && !!satir.planHash && (denemeVar || (denemesiz && gerekceGecerli));

  async function tasi() {
    if (!satir.hedefTemplate || !satir.planHash) return;
    setMesgul(true);
    try {
      const r = await ssTasimaApi.tasi(satir.itemId, {
        to,
        toT: satir.hedefTemplate.id,
        planHash: satir.planHash,
        ...(denemeVar ? {} : { denemesizGerekce: gerekce.trim() }),
      });
      if (!r.ok) {
        toast.error(r.message || 'Taşınamadı.');
        return;
      }
      if (r.yarisUyarisi) toast.error(String(r.yarisUyarisi));
      else toast.success(`${satir.title} hedefe taşındı.`);
      onBitti();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMesgul(false);
    }
  }

  return (
    <Modal
      open
      onClose={onKapat}
      dismissOnBackdrop={false}
      size="lg"
      title="Servisi taşı"
      subtitle={`${satir.title} → #${satir.hedefTemplate?.id ?? ''} ${satir.hedefTemplate?.name || ''}`}
      footer={
        <Dugmeler onIptal={onKapat} onTamam={() => void tasi()} tamamMetni={mesgul ? 'Taşınıyor…' : 'Taşı'} pasif={!hazir || mesgul} testId="tasi-onay" />
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          Kart <b>{satir.title}</b> hedefe bağlanacak. Kart kimliği, başlık, bağlantı, erişim ayarları ve açık/kapalı durumu
          değişmez.
        </p>
        <p>Kaynaktaki ayarlar hedefe kopyalanır; kaynak satır silinmez. Geçmiş işler kaynakta salt-okunur kalır.</p>
        {denemeVar ? (
          <p className="text-green-700">Geçerli deneme koşusu: iş #{satir.deneme?.jobId} başarılı.</p>
        ) : (
          <div className="border border-amber-200 bg-amber-50 rounded-lg p-2 space-y-1">
            <p className="text-amber-900">
              Geçerli bir deneme koşusu yok{satir.deneme?.neden ? ` (${satir.deneme.neden})` : ''}.
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={denemesiz} onChange={(e) => setDenemesiz(e.target.checked)} />
              <span>Deneme koşusu olmadan taşı</span>
            </label>
            {denemesiz && (
              <textarea
                value={gerekce}
                onChange={(e) => setGerekce(e.target.value)}
                rows={2}
                placeholder={`Gerekçe (en az ${GEREKCE_EN_AZ} karakter; denetime yazılır)`}
                className="w-full text-xs border border-gray-200 rounded-lg p-2"
                aria-label="Denemesiz taşıma gerekçesi"
              />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Geri al
// ---------------------------------------------------------------------------
export function GeriAlPenceresi({
  satir,
  onKapat,
  onBitti,
}: {
  satir: SsTasimaSatiri;
  onKapat: () => void;
  onBitti: () => void;
}) {
  const [o, setO] = useState<GeriAlOnizleme | null>(null);
  const [hata, setHata] = useState('');
  const [onay, setOnay] = useState(false);
  const [mesgul, setMesgul] = useState(false);

  useEffect(() => {
    let canli = true;
    ssTasimaApi
      .geriAlOnizleme(satir.itemId)
      .then((r) => canli && setO(r))
      .catch((e: unknown) => canli && setHata(e instanceof Error ? e.message : String(e)));
    return () => {
      canli = false;
    };
  }, [satir.itemId]);

  // Kart başka bir bağa dönmüşse geri alma yapılmaz; yalnız tutarsız kayıt kapatılır (kart değişmez).
  const kapatKipi = !!o && !o.bagUygun;
  const engelli = !o || (!kapatKipi && (o.engeller.length > 0 || o.okunamayan.length > 0));
  const onayGerekli = !!o && o.onayGerekenDegisiklikler.length > 0;

  async function geriAl() {
    if (!o) return;
    setMesgul(true);
    try {
      const kaydiKapat = !o.bagUygun;
      const r = await ssTasimaApi.geriAl(satir.itemId, o.kayit.id, onay, kaydiKapat);
      if (!r.ok) {
        toast.error(r.message || 'Geri alınamadı.');
        return;
      }
      toast.success(kaydiKapat ? `${satir.title}: taşıma kaydı kapatıldı (kart değişmedi).` : `${satir.title} kaynağa geri alındı.`);
      onBitti();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMesgul(false);
    }
  }

  return (
    <Modal
      open
      onClose={onKapat}
      dismissOnBackdrop={false}
      size="lg"
      title="Taşımayı geri al"
      subtitle={satir.title}
      footer={
        <Dugmeler
          onIptal={onKapat}
          onTamam={() => void geriAl()}
          tamamMetni={mesgul ? 'İşleniyor…' : kapatKipi ? 'Kaydı kapat' : 'Geri al'}
          pasif={engelli || (!kapatKipi && onayGerekli && !onay) || (kapatKipi && !onay) || mesgul}
          tehlikeli
          testId="geri-al-onay"
        />
      }
    >
      <div className="space-y-3 text-sm">
        {hata && <p role="alert" className="text-red-600">{hata}</p>}
        {!o && !hata && <p className="text-gray-400">Kontrol ediliyor…</p>}
        {o && (
          <>
            <p>
              Kart #{o.kayit.toTemplate} bağından kaynağa ({o.kaynakSunucuAdi || `#${o.kayit.fromServer}, Portal'da yok`}, template #
              {o.kayit.fromTemplate}) döner. Hedef ayar satırı ve hedef AWX survey'i olduğu gibi kalır.
            </p>
            {kapatKipi && (
              <div className="text-red-700 space-y-1">
                <p className="font-semibold">Kart taşıma sonrası başka bir template'e bağlanmış; otomatik geri alma güvenli değil.</p>
                <p>Kartı değiştirmeden yalnız taşıma kaydını kapatabilirsiniz; servis daha sonra yeniden hazırlanıp taşınabilir.</p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={onay} onChange={(e) => setOnay(e.target.checked)} />
                  <span>Kartın bugünkü bağı korunsun, yalnız kayıt kapatılsın</span>
                </label>
              </div>
            )}
            {!kapatKipi && (o.engeller.length > 0 || o.okunamayan.length > 0) && (
              <div className="text-red-700">
                <p className="font-semibold">Önce bitmesi gerekenler</p>
                <ul>
                  {o.engeller.map((e) => (
                    <li key={e.anahtar}>
                      <b>{e.adet}</b> × {e.baslik} <span className="text-gray-500">— {e.ipucu}</span>
                    </li>
                  ))}
                  {o.okunamayan.map((e) => (
                    <li key={`o-${e.anahtar}`}>
                      Kontrol edilemedi: {e.baslik} <span className="text-gray-500">— {e.hata}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {o.bilgiDegisiklikleri.length > 0 && (
              <div>
                <p className="font-semibold text-gray-700">Taşımadan sonra kartta değişenler (korunur)</p>
                <AlanFarkListesi farklar={o.bilgiDegisiklikleri} />
              </div>
            )}
            {!kapatKipi && onayGerekli && (
              <div className="border border-amber-200 bg-amber-50 rounded-lg p-2 text-amber-900 space-y-1">
                {o.onayGerekenDegisiklikler.map((d) => (
                  <div key={d.tur}>
                    <p className="font-semibold">{d.baslik}</p>
                    <AlanFarkListesi farklar={d.farklar} />
                  </div>
                ))}
                <p>Bu değişiklikler kaynağa taşınmaz. Geri alınca servis, taşıma öncesi kaynak ayarlarıyla çalışır.</p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={onay} onChange={(e) => setOnay(e.target.checked)} />
                  <span>Değişiklikleri gördüm, yine de geri al</span>
                </label>
              </div>
            )}
            {o.uyarilar.length > 0 && (
              <ul className="text-amber-800 list-disc pl-5">
                {o.uyarilar.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
