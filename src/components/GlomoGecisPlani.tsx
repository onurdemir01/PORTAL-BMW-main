// src/components/GlomoGecisPlani.tsx — Nginx ARK SPA Raporu > "Glomo Geçiş Planı" (2026-10-13).
//
// Kullanici: Glomo production tasimalari baska bir ekibin takvimine gore setler halinde
// yapiliyor (Calisma 1-5 bitti, 6 ve 7 kaldi). Ekipler her uygulama icin "kullanimda mi" ve
// kullanimdaysa "calismaya katilacak kisi" girer; tabloyu dolduranin adi GORUNMEZ. Setin calisma
// zamani, OCO numarasi, uygulamanin gecti isareti ve gecis tarihi Admin'in elle girdigi alanlar.
// Gecen uygulamalar listenin en altinda durur. Sunucu: server/spa-report/gecis.cjs.
import { useCallback, useMemo, useState } from 'react';
import { ArrowPathIcon, CheckCircleIcon, ChevronDownIcon, ClipboardDocumentIcon, EnvelopeIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { arkSpaApi, type GecisPlani, type GecisSet, type GecisUygulama } from '@/api/arkSpaApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';

// Kalan calismalar ustte; tamamlanmis setlerin "gecti" isaretlenmemis uygulamalari altta.
const KALAN_SETLER = [6, 7];

const INPUT = 'px-2 py-1 text-[12px] border rounded-md';
const inputStyle = { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' };
const anahtar = (a: { namespace: string; application: string }) => `${a.namespace}/${a.application}`;

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
    <div className="space-y-0.5">
      <div className="text-[11px]">{a.ekip.length ? a.ekip.join(', ') : <span style={{ color: 'var(--text-muted)' }}>—</span>}</div>
      {ep.map((e) => (
        <div key={e} className="flex items-center gap-1 text-[11px]">
          <a href={`mailto:${e}`} className="inline-flex items-center gap-1 underline decoration-dotted" style={{ color: 'var(--accent)' }} title={`${e} adresine e-posta yaz`}>
            <EnvelopeIcon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />{e}
          </a>
          <button onClick={() => kopyala([e], 'adres')} className="p-0.5 rounded" style={{ color: 'var(--text-muted)' }} aria-label={`${e} adresini kopyala`} title="Kopyala">
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

function SetBaslik({ s, apps, admin, onKaydet, onTopluGecti }: {
  s: GecisSet; apps: GecisUygulama[]; admin: boolean;
  onKaydet: (s: GecisSet) => Promise<void>; onTopluGecti: (no: number, tarih: string | null) => Promise<void>;
}) {
  const [at, setAt] = useState(s.calismaAt || '');
  const [oco, setOco] = useState(s.ocoNo || '');
  const [tarih, setTarih] = useState((s.calismaAt || '').slice(0, 10));
  const kullanimda = apps.filter((a) => a.kullanimda === 'yes').length;
  const kisi = apps.filter((a) => a.kullanimda === 'yes' && a.katilimci.trim()).length;
  const bekleyen = apps.filter((a) => a.kullanimda == null).length;
  const degisti = at !== (s.calismaAt || '') || oco !== (s.ocoNo || '');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 rounded-t-lg border-b" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
      <div className="text-[15px] font-bold">Set {s.no}</div>
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
        {apps.length} uygulama · {kullanimda} kullanımda · {kisi}/{kullanimda} katılımcı girildi{bekleyen ? <> · <b style={{ color: 'var(--status-warning-text)' }}>{bekleyen} yanıt bekliyor</b></> : null}
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
      {admin && apps.length > 0 && (
        <div className="flex items-center gap-1.5 text-[12px] ml-auto">
          <input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} className={INPUT} style={inputStyle} aria-label="Toplu geçiş tarihi" />
          <button onClick={() => onTopluGecti(s.no, tarih || null)} className="px-2.5 py-1 rounded-md border" style={{ borderColor: 'var(--status-success)', color: 'var(--status-success)' }} title="Bu setteki geçmemiş tüm uygulamaları “geçti” yapar; geçiş tarihi boş olanlara bu tarih yazılır">Setin tümü geçti</button>
        </div>
      )}
    </div>
  );
}

function Satir({ a, admin, onKullanim, onAdmin }: {
  a: GecisUygulama; admin: boolean;
  onKullanim: (a: GecisUygulama, ku: 'yes' | 'no' | null, kisi: string) => Promise<void>;
  onAdmin: (a: GecisUygulama, p: { setNo?: number; gecti?: boolean; gecisTarihi?: string | null }) => Promise<void>;
}) {
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
      <td className="px-2 py-1.5 max-w-[16rem]"><EkipHucre a={a} /></td>
      <td className="px-2 py-1.5 max-w-[22rem]">
        <div className="flex flex-col gap-1">
          {a.locations.length ? a.locations.map((l) => (
            <code key={l} className="block px-2 py-1 rounded-md border font-mono text-[12.5px] font-semibold leading-snug break-all" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>{l}</code>
          )) : <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</span>}
        </div>
      </td>
      <td className="px-2 py-1.5 text-[11px] whitespace-nowrap"><YukEtiket y={a.yuk} /></td>
      <td className="px-2 py-1.5">
        <div className="inline-flex rounded-md border overflow-hidden text-[12px]" style={{ borderColor: 'var(--border)' }} role="group" aria-label="Uygulama kullanımda mı?">
          {(['yes', 'no'] as const).map((v) => (
            <button key={v} aria-pressed={a.kullanimda === v} onClick={() => onKullanim(a, a.kullanimda === v ? null : v, v === 'yes' ? kisi.trim() : '')} className="px-2.5 py-1" style={a.kullanimda === v ? { background: v === 'yes' ? 'var(--status-success)' : 'var(--status-danger)', color: '#fff', fontWeight: 600 } : { color: 'var(--text-secondary)' }}>
              {v === 'yes' ? 'Evet' : 'Hayır'}
            </button>
          ))}
        </div>
      </td>
      <td className="px-2 py-1.5">
        {a.kullanimda === 'yes' ? (
          <input value={kisi} onChange={(e) => setKisi(e.target.value)} onBlur={kisiKaydet} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} placeholder="Ad Soyad (birden fazlaysa virgülle)" className={`${INPUT} w-full min-w-[14rem]`} style={{ ...inputStyle, ...(kisi.trim() ? {} : { borderColor: 'var(--status-warning)' }) }} aria-label={`${a.application} çalışmaya katılacak kişi`} />
        ) : (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{a.kullanimda === 'no' ? 'kullanılmıyor — katılım gerekmez' : 'önce “kullanımda mı” seçin'}</span>
        )}
      </td>
      {admin && (
        <td className="px-2 py-1.5 whitespace-nowrap text-[12px]">
          <div className="flex items-center gap-1.5">
            <select value={a.setNo} onChange={(e) => onAdmin(a, { setNo: Number(e.target.value) })} className={INPUT} style={inputStyle} aria-label="Set">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>Set {n}</option>)}
            </select>
            <label className="flex items-center gap-1"><input type="checkbox" checked={a.gecti} onChange={(e) => onAdmin(a, { gecti: e.target.checked })} /> geçti</label>
            <input type="date" value={a.gecisTarihi || ''} onChange={(e) => onAdmin(a, { gecisTarihi: e.target.value || null })} className={INPUT} style={inputStyle} aria-label="Geçiş tarihi" />
          </div>
        </td>
      )}
    </tr>
  );
}

function Tablo({ apps, admin, onKullanim, onAdmin }: {
  apps: GecisUygulama[]; admin: boolean;
  onKullanim: (a: GecisUygulama, ku: 'yes' | 'no' | null, kisi: string) => Promise<void>;
  onAdmin: (a: GecisUygulama, p: { setNo?: number; gecti?: boolean; gecisTarihi?: string | null }) => Promise<void>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          <tr>
            <th className="px-2 py-1.5">Uygulama</th><th className="px-2 py-1.5">Ekip / e-posta</th><th className="px-2 py-1.5" style={{ color: 'var(--text-primary)' }}>Location</th><th className="px-2 py-1.5">Yük</th>
            <th className="px-2 py-1.5">Kullanımda mı?</th><th className="px-2 py-1.5">Çalışmaya katılacak kişi</th>
            {admin && <th className="px-2 py-1.5">Set / geçiş (Admin)</th>}
          </tr>
        </thead>
        <tbody>{apps.map((a) => <Satir key={anahtar(a)} a={a} admin={admin} onKullanim={onKullanim} onAdmin={onAdmin} />)}</tbody>
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

  const guncelle = (a: GecisUygulama, p: Partial<GecisUygulama>) =>
    setData((d) => (d && d.apps ? { ...d, apps: d.apps.map((x) => (anahtar(x) === anahtar(a) ? { ...x, ...p } : x)) } : d));

  const onKullanim = async (a: GecisUygulama, ku: 'yes' | 'no' | null, kisi: string) => {
    const r = await arkSpaApi.gecisApp({ namespace: a.namespace, application: a.application, kullanimda: ku, katilimci: kisi });
    if (!r.ok) { toast.error(r.message || 'Kaydedilemedi.'); return; }
    guncelle(a, { kullanimda: ku, katilimci: ku === 'yes' ? kisi : '' });
    toast.success('Kaydedildi');
  };
  const onAdmin = async (a: GecisUygulama, p: { setNo?: number; gecti?: boolean; gecisTarihi?: string | null }) => {
    const r = await arkSpaApi.gecisAppAdmin({ namespace: a.namespace, application: a.application, ...p });
    if (!r.ok) { toast.error(r.message || 'Kaydedilemedi.'); return; }
    guncelle(a, p);
  };
  const onSetKaydet = async (s: GecisSet) => {
    const r = await arkSpaApi.gecisSet(s);
    if (!r.ok) { toast.error(r.message || 'Kaydedilemedi.'); return; }
    setData((d) => (d && d.sets ? { ...d, sets: d.sets.map((x) => (x.no === s.no ? s : x)) } : d));
    toast.success(`Set ${s.no} kaydedildi`);
  };
  const onTopluGecti = async (no: number, tarih: string | null) => {
    const r = await arkSpaApi.gecisSetGecti(no, tarih);
    if (!r.ok) { toast.error(r.message || 'Kaydedilemedi.'); return; }
    toast.success(`Set ${no}: ${r.guncellenen ?? 0} uygulama geçti olarak işaretlendi`);
    await yukle();
  };

  const apps = data?.apps || [];
  const ekipler = useMemo(() => [...new Set(apps.flatMap((a) => a.ekip))].sort(), [apps]);
  const suzulmus = useMemo(() => {
    const q = ara.trim().toLowerCase();
    return apps.filter((a) =>
      (ekip === 'all' || a.ekip.includes(ekip)) &&
      (!q || a.application.toLowerCase().includes(q) || a.namespace.toLowerCase().includes(q) || a.locations.some((l) => l.toLowerCase().includes(q))) &&
      (!yalnizBekleyen || a.kullanimda == null || (a.kullanimda === 'yes' && !a.katilimci.trim())));
  }, [apps, ekip, ara, yalnizBekleyen]);
  const sets = data?.sets || [];
  const setOf = (no: number) => sets.find((s) => s.no === no) || { no, calismaAt: null, ocoNo: '' };
  const bekleyen = suzulmus.filter((a) => !a.gecti);
  const gecen = suzulmus.filter((a) => a.gecti).sort((x, y) => (y.gecisTarihi || '').localeCompare(x.gecisTarihi || '') || x.setNo - y.setNo);
  const eskiSetler = [1, 2, 3, 4, 5].filter((n) => bekleyen.some((a) => a.setNo === n));
  const admin = !!data?.admin;
  const eksikSayisi = apps.filter((a) => a.kaynak === 'portal').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          Glomo production taşımaları setler halinde yapılıyor. Her uygulama için <b>kullanımda mı</b> seçin; kullanımdaysa
          <b> çalışmaya katılacak kişinin adını</b> yazın. Setin çalışma zamanı ve OCO numarası set başlığında.
          {eksikSayisi > 0 && <> Takvimde olmayıp canlı Glomo envanterinde bulunan <b>{eksikSayisi}</b> uygulama Set 7’ye eklendi.</>}
        </div>
        <button onClick={yukle} disabled={yukleniyor} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-lg" style={{ borderColor: 'var(--border)' }}>
          <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin motion-reduce:animate-none' : ''}`} /> Yenile
        </button>
      </div>

      {data && !data.ok && <div className="text-[12px] rounded-lg px-3 py-2 border" style={{ color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}>{data.message || 'Plan alınamadı.'}</div>}
      {data?.ok && !data.raporVar && <div className="text-[12px] rounded-lg px-3 py-2 border" style={{ color: 'var(--status-warning-text, var(--text-primary))', borderColor: 'var(--status-warning)' }}>Canlı SPA raporu okunamadı: ekip / location / yük bilgisi Excel’den gösteriliyor ve eksik uygulamalar kontrol edilemedi.</div>}

      <div className="flex flex-wrap items-center gap-2">
        <input value={ara} onChange={(e) => setAra(e.target.value)} placeholder="uygulama, namespace ya da location ara" className={`${INPUT} w-72`} style={inputStyle} />
        <select value={ekip} onChange={(e) => setEkip(e.target.value)} className={INPUT} style={inputStyle}>
          <option value="all">ekip: hepsi ({ekipler.length})</option>
          {ekipler.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={yalnizBekleyen} onChange={(e) => setYalnizBekleyen(e.target.checked)} /> yalnız yanıt bekleyenler</label>
        {epostalar(suzulmus.filter((a) => !a.gecti)).length > 0 && (
          <button onClick={() => kopyala(epostalar(suzulmus.filter((a) => !a.gecti)), 'ekip e-postası')} className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md border ml-auto" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} title="Listede görünen (geçmemiş) uygulamaların ekip e-postalarını kopyala — süzgeçler uygulanır">
            <ClipboardDocumentIcon className="w-4 h-4" /> Görünen ekiplerin e-postaları ({epostalar(suzulmus.filter((a) => !a.gecti)).length})
          </button>
        )}
      </div>
      {data?.ok && data.epostaVar === false && <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Ekip e-postaları okunamadı (namespace sahibi tablosu); yalnız ekip adları gösteriliyor.</div>}

      {KALAN_SETLER.map((no) => {
        const liste = bekleyen.filter((a) => a.setNo === no);
        return (
          <section key={no} className="rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <SetBaslik key={`${no}-${setOf(no).calismaAt}-${setOf(no).ocoNo}`} s={setOf(no)} apps={liste} admin={admin} onKaydet={onSetKaydet} onTopluGecti={onTopluGecti} />
            {liste.length ? <Tablo apps={liste} admin={admin} onKullanim={onKullanim} onAdmin={onAdmin} /> : <div className="px-3 py-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>Bu sette bekleyen uygulama yok.</div>}
          </section>
        );
      })}

      {eskiSetler.length > 0 && (
        <section className="rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
          <button onClick={() => setEskiAcik((x) => !x)} aria-expanded={eskiAcik} className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-left">
            <ChevronDownIcon className={`w-4 h-4 transition-transform motion-reduce:transition-none ${eskiAcik ? 'rotate-180' : ''}`} />
            Tamamlanan çalışmalar (Set 1–5) — “geçti” işaretlenmemiş {bekleyen.filter((a) => a.setNo <= 5).length} uygulama
          </button>
          {eskiAcik && eskiSetler.map((no) => {
            const liste = bekleyen.filter((a) => a.setNo === no);
            return (
              <div key={no} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <SetBaslik key={`${no}-${setOf(no).calismaAt}-${setOf(no).ocoNo}`} s={setOf(no)} apps={liste} admin={admin} onKaydet={onSetKaydet} onTopluGecti={onTopluGecti} />
                <Tablo apps={liste} admin={admin} onKullanim={onKullanim} onAdmin={onAdmin} />
              </div>
            );
          })}
        </section>
      )}

      <section className="rounded-lg border" style={{ borderColor: 'var(--status-success)' }}>
        <div className="flex items-center gap-2 px-3 py-2.5 border-b text-[14px] font-bold" style={{ borderColor: 'var(--border-subtle)', color: 'var(--status-success)' }}>
          <CheckCircleIcon className="w-5 h-5" /> Geçen uygulamalar ({gecen.length})
        </div>
        {gecen.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                <tr><th className="px-2 py-1.5">Uygulama</th><th className="px-2 py-1.5">Ekip</th><th className="px-2 py-1.5">Set</th><th className="px-2 py-1.5">Geçiş tarihi</th><th className="px-2 py-1.5"><UserGroupIcon className="inline w-3.5 h-3.5" /> Katılan</th>{admin && <th className="px-2 py-1.5">Admin</th>}</tr>
              </thead>
              <tbody>
                {gecen.map((a) => (
                  <tr key={anahtar(a)} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-2 py-1.5"><div className="font-semibold">{a.application}</div><div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{a.namespace}</div></td>
                    <td className="px-2 py-1.5 max-w-[16rem]"><EkipHucre a={a} /></td>
                    <td className="px-2 py-1.5 tabular-nums">Set {a.setNo}</td>
                    <td className="px-2 py-1.5 tabular-nums">{a.gecisTarihi ? zamanMetni(a.gecisTarihi) : <span style={{ color: 'var(--text-muted)' }}>tarih girilmedi</span>}</td>
                    <td className="px-2 py-1.5 text-[11px]">{a.katilimci || '—'}</td>
                    {admin && (
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <input type="date" value={a.gecisTarihi || ''} onChange={(e) => onAdmin(a, { gecisTarihi: e.target.value || null })} className={INPUT} style={inputStyle} aria-label="Geçiş tarihi" />
                          <button onClick={() => onAdmin(a, { gecti: false })} className="px-2 py-1 rounded-md border text-[11px]" style={{ borderColor: 'var(--border)' }} title="Geçti işaretini geri al">geri al</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="px-3 py-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>Henüz “geçti” işaretlenmiş uygulama yok.</div>}
      </section>
    </div>
  );
}
