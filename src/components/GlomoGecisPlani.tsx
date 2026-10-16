// src/components/GlomoGecisPlani.tsx — Nginx ARK SPA Raporu > "Glomo Geçiş Planı" (2026-10-13).
//
// Kullanici: Glomo production tasimalari baska bir ekibin takvimine gore setler halinde
// yapiliyor. 2026-10-16: Calisma 1-6 bitti, yalniz Set 7 kaldi (bazi uygulama sahipleri
// uygulamalarini Set 7'ye aldirdi; tasima sunucuda tek seferlik goc, girisler korunur).
// Ekipler her uygulama icin "kullanimda mi", kullanimdaysa "calismaya katilacak kisi" girer ve
// kontrol sonrasi "Kontrol Ettim"e basar (aciklama yok); tabloyu dolduranin adi GORUNMEZ.
// Setin calisma zamani ve OCO numarasi Admin'in elle girdigi alanlar.
//
// KOLONLAR (2026-10-16, kullanici: "... kolonlari olsa yeterlidir"): butun tablolar TEK bilesen
// ve AYNI 7 kolon - Uygulama | Ekip / e-posta | Location | Yuk | Kullanimda mi? | Calismaya
// katilacak kisi | Kontrol. Set secimi, gecti / gecis tarihi ve "Setin tumu gecti" ekrandan
// kalkti (sunucu uclari yalniz Admin icin duruyor). Sunucu: server/spa-report/gecis.cjs.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowPathIcon, CheckCircleIcon, ChevronDownIcon, ClipboardDocumentIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { arkSpaApi, type GecisPlani, type GecisSet, type GecisUygulama } from '@/api/arkSpaApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { fmtDateTime } from '@/utils/datetime';

// Kalan calisma ustte; tamamlanmis setlerin uygulamalari katlanir bolumde.
const KALAN_SETLER = [7];
const TAMAMLANAN_SETLER = [1, 2, 3, 4, 5, 6];

const INPUT = 'px-2 py-1 text-[12px] border rounded-md';
const inputStyle = { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' };
const anahtar = (a: { namespace: string; application: string }) => `${a.namespace}/${a.application}`;
/** Erisilebilir ad on eki: ayni uygulama adi iki namespace'te olabilir ("web (a-prod) ..."). */
const ad = (a: GecisUygulama) => `${a.application} (${a.namespace})`;
/** Istek hic yanit vermediyse (fetch reddi) sessiz kalma. */
const baglantiHatasi = (e: unknown) => toast.error(`Kaydedilemedi — bağlantı hatası (${e instanceof Error ? e.message : String(e)})`);
// Kontrol kolonu saga yapisik (2026-10-16 denetim: 1440 genislikte sol menu acikken kolon ekran
// disinda kaliyordu); arka plan (sayfa zemini, body = --bg-base) altindan kayan hucreleri orter.
// Sol ayrac border-l DEGIL ic golge: border-collapse tabloda yapisik hucrenin kenarligi kayarken
// cizilmiyor, Kontrol kolonu alttaki kolonlarin ustune ayracsiz biniyordu (denetim tur 2).
const YAPISIK = 'sticky right-0';
const yapisikStil = { background: 'var(--bg-base)', boxShadow: 'inset 1px 0 0 var(--border-subtle)' };

type KullanimFn = (a: GecisUygulama, ku: 'yes' | 'no' | null, kisi: string) => Promise<void>;
type KontrolFn = (a: GecisUygulama, kontrol: boolean) => Promise<void>;

/** 'YYYY-MM-DDTHH:mm' -> '15.10.2026 23:00' (girildigi gibi; saat dilimi donusumu yok). */
function zamanMetni(v: string | null): string {
  const m = v ? /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v) : null;
  if (!m) return '';
  return `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

/** E-postalari panoya kopyalar (Outlook alicisi icin ';' ile). Pano yoksa metin secilebilir kalir. */
async function kopyala(liste: string[], ne: string) {
  const metin = liste.join('; ');
  try {
    await navigator.clipboard.writeText(metin);
    toast.success(`${liste.length} ${ne} kopyalandı`);
  } catch {
    window.prompt('Kopyalayın:', metin);
  }
}

/** Uygulama listesinin benzersiz ekip e-postalari. */
const epostalar = (apps: GecisUygulama[]) => [...new Set(apps.flatMap((a) => a.ekipEposta || []))].sort();

function EkipHucre({ a }: { a: GecisUygulama }) {
  const ep = a.ekipEposta || [];
  return (
    // SABIT GENISLIK + KISALTMA (2026-10-13, kullanici ekran goruntusu: "sol menu acikken satirlar
    // kayiyor"): bosluksuz uzun e-posta hucreye sigmayip Location kutusunun ustune tasiyordu.
    // Hucre sabit genislikte; adres tek satirda kisaltilir (tam hali ipucunda), kopyala dugmesi
    // her zaman gorunur.
    <div className="w-[12rem] space-y-0.5">
      <div className="text-[11px] break-words">{a.ekip.length ? a.ekip.join(', ') : <span style={{ color: 'var(--text-muted)' }}>—</span>}</div>
      {ep.map((e) => (
        <div key={e} className="flex items-center gap-1 text-[11px] min-w-0">
          <a href={`mailto:${e}`} className="flex items-center gap-1 min-w-0 underline decoration-dotted" style={{ color: 'var(--accent)' }} title={`${e} adresine e-posta yaz`}>
            <EnvelopeIcon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" /><span className="truncate" title={e}>{e}</span>
          </a>
          <button onClick={() => kopyala([e], 'adres')} className="p-0.5 rounded flex-shrink-0" style={{ color: 'var(--text-muted)' }} aria-label={`${e} adresini kopyala`} title="Kopyala">
            <ClipboardDocumentIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function YukEtiket({ y }: { y: GecisUygulama['yuk'] }) {
  if (!y) return <span style={{ color: 'var(--text-muted)' }}>ölçüm yok</span>;
  if (y.state === 'active') return <span style={{ color: 'var(--status-success)', fontWeight: 600 }}>yük alıyor · {y.req7}</span>;
  if (y.state === 'idle') return <span style={{ color: 'var(--text-secondary)' }}>yük almıyor</span>;
  return <span style={{ color: 'var(--text-muted)' }} title="Ölçülemedi — “yük yok” demek değildir">ölçülemedi</span>;
}

function SetBaslik({ s, apps, admin, onKaydet }: {
  s: GecisSet; apps: GecisUygulama[]; admin: boolean;
  onKaydet: (s: GecisSet) => Promise<void>;
}) {
  const [at, setAt] = useState(s.calismaAt || '');
  const [oco, setOco] = useState(s.ocoNo || '');
  const kullanimda = apps.filter((a) => a.kullanimda === 'yes').length;
  const kisi = apps.filter((a) => a.kullanimda === 'yes' && a.katilimci.trim()).length;
  const bekleyen = apps.filter((a) => a.kullanimda == null).length;
  const kontrol = apps.filter((a) => a.kontrolAt).length;
  const degisti = at !== (s.calismaAt || '') || oco !== (s.ocoNo || '');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 rounded-t-lg border-b" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
      {/* index.css'teki katmansiz h1..h6 kurali (500, display yazi tipi) Tailwind sinifini ezer. */}
      <h2 className="text-[15px]" style={{ fontWeight: 700, fontFamily: 'inherit', lineHeight: 'inherit' }}>Set {s.no}</h2>
      {admin ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <label className="flex items-center gap-1">Çalışma zamanı
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={INPUT} style={inputStyle} />
          </label>
          <label className="flex items-center gap-1">OCO no
            <input value={oco} onChange={(e) => setOco(e.target.value)} placeholder="OCO numarası" className={`${INPUT} w-36 font-mono`} style={inputStyle} />
          </label>
          <button disabled={!degisti} onClick={() => onKaydet({ no: s.no, calismaAt: at || null, ocoNo: oco.trim() })} className="px-2.5 py-1 text-[12px] rounded-md border font-semibold disabled:opacity-40" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>Kaydet</button>
        </div>
      ) : (
        <div className="text-[13px]">
          {s.calismaAt ? <><b>{zamanMetni(s.calismaAt)}</b></> : <span style={{ color: 'var(--text-muted)' }}>çalışma zamanı henüz girilmedi</span>}
          {' · '}{s.ocoNo ? <>OCO <b className="font-mono">{s.ocoNo}</b></> : <span style={{ color: 'var(--text-muted)' }}>OCO henüz yok</span>}
        </div>
      )}
      <div className="text-[12px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
        {apps.length} uygulama · {kullanimda} kullanımda · {kisi}/{kullanimda} katılımcı girildi · {kontrol}/{apps.length} kontrol edildi{bekleyen ? <> · <b style={{ color: 'var(--status-warning-text)' }}>{bekleyen} yanıt bekliyor</b></> : null}
      </div>
      {epostalar(apps).length > 0 && (
        <div className="flex items-center gap-1.5 text-[12px]">
          <button onClick={() => kopyala(epostalar(apps), 'ekip e-postası')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} title={`Bu setteki ${epostalar(apps).length} ekibin e-postasını kopyala (Outlook alıcı satırına yapıştırılabilir)`}>
            <ClipboardDocumentIcon className="w-4 h-4" /> Ekip e-postaları ({epostalar(apps).length})
          </button>
          <a href={`mailto:?bcc=${encodeURIComponent(epostalar(apps).join(';'))}&subject=${encodeURIComponent(`Glomo geçişi — Set ${s.no}${s.calismaAt ? ` (${zamanMetni(s.calismaAt)})` : ''}`)}`} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }} title="E-posta istemcisinde bu set için yeni ileti aç (ekipler gizli alıcıda)">
            <EnvelopeIcon className="w-4 h-4" /> E-posta yaz
          </a>
        </div>
      )}
    </div>
  );
}

/** KONTROL (2026-10-16): yalniz "Kontrol Ettim" dugmesi; aciklama yok, kimin bastigi tutulmaz.
 *  Basildiysa an gosterilir; yanlislikla basildiysa "geri al". Basilan dugme DOM'dan kalktigi
 *  icin odak karsi dugmeye tasinir (hata olursa ayni dugmeye geri doner) - klavye kullanicisi
 *  40+ satirlik tabloda yerini kaybetmez. */
function KontrolHucre({ a, onKontrol }: { a: GecisUygulama; onKontrol: KontrolFn }) {
  const [mesgul, setMesgul] = useState(false);
  const dugme = useRef<HTMLButtonElement>(null);
  const odakIste = useRef(false);
  useEffect(() => {
    if (mesgul || !odakIste.current) return;
    odakIste.current = false;
    dugme.current?.focus();
  }, [mesgul, a.kontrolAt]);
  // Odak istegi istek BITTIKTEN sonra yazilir: tiklama aninda yazilinca henuz kosmamis bayat bir
  // pasif effect (dugme DOM'a girdigi gorevde tiklama) istegi tuketiyor, odak BODY'ye dusuyordu.
  const bas = async (k: boolean) => {
    setMesgul(true);
    try { await onKontrol(a, k); } finally { odakIste.current = true; setMesgul(false); }
  };
  if (!a.kontrolAt) {
    return (
      <button ref={dugme} disabled={mesgul} onClick={() => bas(true)} className="px-2.5 py-1 text-[12px] rounded-md border font-semibold whitespace-nowrap disabled:opacity-40" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} aria-label={`${ad(a)} kontrol ettim`}>
        Kontrol Ettim
      </button>
    );
  }
  return (
    <div className="text-[11px] space-y-0.5 whitespace-nowrap">
      <div className="flex items-center gap-1 font-semibold" style={{ color: 'var(--status-success)' }}>
        <CheckCircleIcon className="w-4 h-4" aria-hidden="true" /><span>Kontrol edildi</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmtDateTime(a.kontrolAt)}</span>
        <button ref={dugme} disabled={mesgul} onClick={() => bas(false)} className="px-1.5 py-0.5 min-h-6 rounded border disabled:opacity-40" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }} aria-label={`${ad(a)} kontrol işaretini geri al`} title="Yanlışlıkla basıldıysa kontrol işaretini geri al">geri al</button>
      </div>
    </div>
  );
}

function Satir({ a, onKullanim, onKontrol }: { a: GecisUygulama; onKullanim: KullanimFn; onKontrol: KontrolFn }) {
  const [kisi, setKisi] = useState(a.katilimci);
  const kisiKaydet = () => { if (kisi.trim() !== a.katilimci.trim()) onKullanim(a, 'yes', kisi.trim()); };
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
      <td className="px-2 py-1.5">
        <div className="font-semibold text-[12px]">{a.application}</div>
        <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{a.namespace}</div>
        {a.kaynak === 'portal' && <span className="inline-block mt-0.5 text-[10px] px-1.5 rounded-full" style={{ background: 'var(--status-info-bg)', color: 'var(--status-info)' }} title="Canlı Glomo envanterinde var ama takvim Excel'inde yoktu">Excel’de yoktu → eklendi</span>}
        {a.taramadaYok && <span className="inline-block mt-0.5 ml-1 text-[10px] px-1.5 rounded-full" style={{ background: 'var(--status-warning-bg)', color: 'var(--status-warning-text, var(--text-primary))' }} title="Son nginx taramasında Glomo altında görülmedi">canlı envanterde yok</span>}
      </td>
      <td className="px-2 py-1.5"><EkipHucre a={a} /></td>
      <td className="px-2 py-1.5 min-w-[11rem] max-w-[18rem]">
        <div className="flex flex-col gap-1">
          {a.locations.length ? a.locations.map((l) => (
            <code key={l} className="block px-2 py-1 rounded-md border font-mono text-[12.5px] font-semibold leading-snug break-all" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>{l}</code>
          )) : <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</span>}
        </div>
      </td>
      <td className="px-2 py-1.5 text-[11px] whitespace-nowrap"><YukEtiket y={a.yuk} /></td>
      <td className="px-2 py-1.5">
        <div className="inline-flex rounded-md border overflow-hidden text-[12px]" style={{ borderColor: 'var(--border)' }} role="group" aria-label={`${ad(a)} kullanımda mı?`}>
          {(['yes', 'no'] as const).map((v) => (
            <button key={v} aria-pressed={a.kullanimda === v} onClick={() => onKullanim(a, a.kullanimda === v ? null : v, v === 'yes' ? kisi.trim() : '')} className="px-2.5 py-1" style={a.kullanimda === v ? { background: v === 'yes' ? 'var(--status-success)' : 'var(--status-danger)', color: 'var(--text-on-accent)', fontWeight: 600 } : { color: 'var(--text-secondary)' }}>
              {v === 'yes' ? 'Evet' : 'Hayır'}
            </button>
          ))}
        </div>
      </td>
      <td className="px-2 py-1.5">
        {a.kullanimda === 'yes' ? (
          <input value={kisi} onChange={(e) => setKisi(e.target.value)} onBlur={kisiKaydet} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} placeholder="Ad Soyad (birden fazlaysa virgülle)" className={`${INPUT} w-full min-w-[11rem]`} style={{ ...inputStyle, ...(kisi.trim() ? {} : { borderColor: 'var(--status-warning)' }) }} aria-label={`${ad(a)} çalışmaya katılacak kişi`} />
        ) : (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{a.kullanimda === 'no' ? 'kullanılmıyor — katılım gerekmez' : 'önce “kullanımda mı” seçin'}</span>
        )}
      </td>
      <td className={`px-2 py-1.5 ${YAPISIK}`} style={yapisikStil}><KontrolHucre a={a} onKontrol={onKontrol} /></td>
    </tr>
  );
}

/** Sayfadaki BUTUN uygulama tablolari (Set 7, tamamlanan setler, gecenler) bu bilesendir. */
function Tablo({ apps, onKullanim, onKontrol }: { apps: GecisUygulama[]; onKullanim: KullanimFn; onKontrol: KontrolFn }) {
  return (
    <div className="overflow-x-auto">
      {/* Dar ekranda (sol menu acik) kolonlar birbirine binmesin: tablo yatay kayar. */}
      <table className="w-full min-w-[62rem] text-left">
        <thead className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          <tr>
            <th className="px-2 py-1.5">Uygulama</th><th className="px-2 py-1.5">Ekip / e-posta</th><th className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>Location</th><th className="px-2 py-1.5">Yük</th>
            <th className="px-2 py-1.5">Kullanımda mı?</th><th className="px-2 py-1.5">Çalışmaya katılacak kişi</th><th className={`px-2 py-1.5 ${YAPISIK}`} style={yapisikStil}>Kontrol</th>
          </tr>
        </thead>
        <tbody>{apps.map((a) => <Satir key={anahtar(a)} a={a} onKullanim={onKullanim} onKontrol={onKontrol} />)}</tbody>
      </table>
    </div>
  );
}

export default function GlomoGecisPlani() {
  const [data, setData] = useState<GecisPlani | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [ekip, setEkip] = useState('all');
  const [ara, setAra] = useState('');
  const [yalnizBekleyen, setYalnizBekleyen] = useState(false);
  const [eskiAcik, setEskiAcik] = useState(false);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try { setData(await arkSpaApi.gecis()); } catch (e: unknown) { setData({ ok: false, message: e instanceof Error ? e.message : String(e) }); }
    finally { setYukleniyor(false); }
  }, []);
  useAsyncEffect(async () => { await yukle(); }, [yukle]);

  const apps = useMemo(() => data?.apps || [], [data]);
  const ekipler = useMemo(() => [...new Set(apps.flatMap((a) => a.ekip))].sort(), [apps]);
  const suzulmus = useMemo(() => {
    const q = ara.trim().toLowerCase();
    return apps.filter((a) =>
      (ekip === 'all' || a.ekip.includes(ekip)) &&
      (!q || a.application.toLowerCase().includes(q) || a.namespace.toLowerCase().includes(q) || a.locations.some((l) => l.toLowerCase().includes(q))) &&
      (!yalnizBekleyen || a.kullanimda == null || (a.kullanimda === 'yes' && !a.katilimci.trim())));
  }, [apps, ekip, ara, yalnizBekleyen]);

  const guncelle = (a: GecisUygulama, p: Partial<GecisUygulama>) =>
    setData((d) => (d && d.apps ? { ...d, apps: d.apps.map((x) => (anahtar(x) === anahtar(a) ? { ...x, ...p } : x)) } : d));

  const onKullanim = async (a: GecisUygulama, ku: 'yes' | 'no' | null, kisi: string) => {
    let r: Awaited<ReturnType<typeof arkSpaApi.gecisApp>>;
    try { r = await arkSpaApi.gecisApp({ namespace: a.namespace, application: a.application, kullanimda: ku, katilimci: kisi }); } catch (e) { baglantiHatasi(e); return; }
    if (!r.ok) { toast.error(r.message || 'Kaydedilemedi.'); return; }
    guncelle(a, { kullanimda: ku, katilimci: ku === 'yes' ? kisi : '' });
    toast.success('Kaydedildi');
  };
  const onKontrol = async (a: GecisUygulama, kontrol: boolean) => {
    let r: Awaited<ReturnType<typeof arkSpaApi.gecisKontrol>>;
    try { r = await arkSpaApi.gecisKontrol({ namespace: a.namespace, application: a.application, kontrol }); } catch (e) { baglantiHatasi(e); return; }
    if (!r.ok) { toast.error(r.message || 'Kaydedilemedi.'); return; }
    guncelle(a, { kontrolAt: kontrol ? r.kontrolAt || new Date().toISOString() : null });
    toast.success(kontrol ? 'Kontrol kaydedildi' : 'Kontrol işareti geri alındı');
  };
  const onSetKaydet = async (s: GecisSet) => {
    let r: Awaited<ReturnType<typeof arkSpaApi.gecisSet>>;
    try { r = await arkSpaApi.gecisSet(s); } catch (e) { baglantiHatasi(e); return; }
    if (!r.ok) { toast.error(r.message || 'Kaydedilemedi.'); return; }
    setData((d) => (d && d.sets ? { ...d, sets: d.sets.map((x) => (x.no === s.no ? s : x)) } : d));
    toast.success(`Set ${s.no} kaydedildi`);
  };

  const sets = data?.sets || [];
  const setOf = (no: number) => sets.find((s) => s.no === no) || { no, calismaAt: null, ocoNo: '' };
  const bekleyen = suzulmus.filter((a) => !a.gecti);
  const gecen = suzulmus.filter((a) => a.gecti).sort((x, y) => (y.gecisTarihi || '').localeCompare(x.gecisTarihi || '') || x.setNo - y.setNo);
  const eskiSetler = TAMAMLANAN_SETLER.filter((n) => bekleyen.some((a) => a.setNo === n));
  const eskiBekleyen = bekleyen.filter((a) => TAMAMLANAN_SETLER.includes(a.setNo));
  // "Gorunen ekipler": ekranda gercekten gorunen gecmemis satirlar (katlanmis bolum sayilmaz).
  const gorunenBekleyen = [...bekleyen.filter((a) => KALAN_SETLER.includes(a.setNo)), ...(eskiAcik ? eskiBekleyen : [])];
  const admin = !!data?.admin;
  const eksikSayisi = apps.filter((a) => a.kaynak === 'portal').length;
  const eslesmeyen = data?.talepEslesmeyen || [];
  const gocHatasi = admin && data?.goc && !data.goc.uygulandi ? data.goc : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          Glomo production taşımalarında <b>Set 1–6 tamamlandı</b>; kalan çalışma <b>Set 7</b>. Her uygulama için <b>kullanımda mı</b> seçin;
          kullanımdaysa <b>çalışmaya katılacak kişinin adını</b> yazın; kontrol ettikten sonra <b>Kontrol Ettim</b>’e basın.
          Setin çalışma zamanı ve OCO numarası set başlığında.
          {eksikSayisi > 0 && <> Takvimde olmayıp canlı Glomo envanterinde bulunan <b>{eksikSayisi}</b> uygulama Set 7’ye eklendi.</>}
        </div>
        <button onClick={yukle} disabled={yukleniyor} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg" style={{ borderColor: 'var(--border)' }}>
          <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin motion-reduce:animate-none' : ''}`} /> Yenile
        </button>
      </div>

      {data && !data.ok && <div className="text-[12px] rounded-lg px-3 py-2 border" style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}>{data.message || 'Plan alınamadı.'}</div>}
      {data?.ok && !data.raporVar && <div className="text-[12px] rounded-lg px-3 py-2 border" style={{ color: 'var(--status-warning-text, var(--text-primary))', borderColor: 'var(--status-warning)' }}>Canlı SPA raporu okunamadı: ekip / location / yük bilgisi Excel’den gösteriliyor ve eksik uygulamalar kontrol edilemedi.</div>}
      {data?.ok && gocHatasi && (
        <div className="text-[12px] rounded-lg px-3 py-2 border" style={{ color: 'var(--status-warning-text)', borderColor: 'var(--status-warning)' }} role="alert">
          <b>Set 7 taşıması uygulanamadı</b> ({gocHatasi.ad}): listedeki uygulamalar Set 7’ye alınmadı, eski setlerinde (Tamamlanan çalışmalar) görünüyor.
          {gocHatasi.hata ? <> Hata: <span className="font-mono text-[11px]">{gocHatasi.hata}</span>.</> : null} Sayfa her yüklendiğinde yeniden denenir; ayrıntı sunucu logunda.
        </div>
      )}
      {data?.ok && admin && eslesmeyen.length > 0 && (
        <div className="text-[12px] rounded-lg px-3 py-2 border" style={{ color: 'var(--status-warning-text)', borderColor: 'var(--status-warning)' }} role="note">
          Set 7 listesindeki <b>{eslesmeyen.length}</b> uygulama planda bulunamadı: <span className="font-mono text-[11px]">{eslesmeyen.map(anahtar).join(', ')}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input value={ara} onChange={(e) => setAra(e.target.value)} placeholder="uygulama, namespace ya da location ara" className={`${INPUT} w-72`} style={inputStyle} />
        <select value={ekip} onChange={(e) => setEkip(e.target.value)} className={INPUT} style={inputStyle}>
          <option value="all">ekip: hepsi ({ekipler.length})</option>
          {ekipler.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={yalnizBekleyen} onChange={(e) => setYalnizBekleyen(e.target.checked)} /> yalnız yanıt bekleyenler</label>
        {epostalar(gorunenBekleyen).length > 0 && (
          <button onClick={() => kopyala(epostalar(gorunenBekleyen), 'ekip e-postası')} className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md border ml-auto" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} title="Ekranda görünen (geçmemiş) uygulamaların ekip e-postalarını kopyala — süzgeçler uygulanır, katlanmış bölüm sayılmaz">
            <ClipboardDocumentIcon className="w-4 h-4" /> Görünen ekiplerin e-postaları ({epostalar(gorunenBekleyen).length})
          </button>
        )}
      </div>
      {data?.ok && data.epostaVar === false && <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Ekip e-postaları okunamadı (namespace sahibi tablosu); yalnız ekip adları gösteriliyor.</div>}

      {KALAN_SETLER.map((no) => {
        const liste = bekleyen.filter((a) => a.setNo === no);
        return (
          <section key={no} className="rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <SetBaslik key={`${no}-${setOf(no).calismaAt}-${setOf(no).ocoNo}`} s={setOf(no)} apps={liste} admin={admin} onKaydet={onSetKaydet} />
            {liste.length ? <Tablo apps={liste} onKullanim={onKullanim} onKontrol={onKontrol} /> : <div className="px-3 py-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>Bu sette bekleyen uygulama yok.</div>}
          </section>
        );
      })}

      {eskiSetler.length > 0 && (
        <section className="rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
          <button onClick={() => setEskiAcik((x) => !x)} aria-expanded={eskiAcik} className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-left">
            <ChevronDownIcon className={`w-4 h-4 transition-transform motion-reduce:transition-none ${eskiAcik ? 'rotate-180' : ''}`} />
            Tamamlanan çalışmalar (Set 1–6) — {eskiBekleyen.length} uygulama
          </button>
          {eskiAcik && eskiSetler.map((no) => {
            const liste = bekleyen.filter((a) => a.setNo === no);
            return (
              <div key={no} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <SetBaslik key={`${no}-${setOf(no).calismaAt}-${setOf(no).ocoNo}`} s={setOf(no)} apps={liste} admin={admin} onKaydet={onSetKaydet} />
                <Tablo apps={liste} onKullanim={onKullanim} onKontrol={onKontrol} />
              </div>
            );
          })}
        </section>
      )}

      <section className="rounded-lg border" style={{ borderColor: 'var(--status-success)' }}>
        <h2 className="flex items-center gap-2 px-3 py-2.5 border-b text-[14px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--status-success)', fontWeight: 700, fontFamily: 'inherit', lineHeight: 'inherit' }}>
          <CheckCircleIcon className="w-5 h-5" aria-hidden="true" /> Geçen uygulamalar ({gecen.length})
        </h2>
        {gecen.length
          ? <Tablo apps={gecen} onKullanim={onKullanim} onKontrol={onKontrol} />
          : <div className="px-3 py-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>Geçti olarak kayıtlı uygulama yok.</div>}
      </section>
    </div>
  );
}
