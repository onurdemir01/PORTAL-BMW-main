// src/components/server_hub/RebootKontroluTab.tsx — Server Hub > Reboot Kontrolü (2026-10-08).
//
// Kullanıcı: "Çalışma öncesi ve sonrası çalıştıralım, sunucunun sorunsuz olduğundan emin olalım."
// Akış: (1) reboot ÖNCESİ görüntü alınır ve Portal'da saklanır, (2) reboot yapılır, (3) reboot SONRASI
// görüntü önceki ile karşılaştırılır; önce çalışıp şimdi kapalı olan (DOWN) başlatılır, önce olmayıp
// şimdi çalışan (NEW) durdurulur — TEK JVM / TEK web sunucusu bazında. Son görüntüde fark kalmadıysa
// sunucu "Sorunsuz". Ölçülemeyen sunucu sorunsuz SAYILMAZ.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, CameraIcon, WrenchScrewdriverIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { rebootCheckApi, type RcKayit, type RcSunucuSonuc, type RcDegerlendirme } from '@/api/rebootCheckApi';
import { serverHubApi } from '@/api/serverHubApi';
import { useJobTracker } from '@/contexts/JobTrackerContext';
import { Modal } from '@/components/common/Modal';
import { fmtDateTime } from '@/utils/datetime';
import { toast } from '@/hooks/useToast';
import { DURUM, bilgiAyristir, farkAyristir, goruntuAyristir, islemAyristir, sunucuListesi } from './rebootKontrolu';

const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const TON: Record<string, { renk: string; zemin: string }> = {
  ok: { renk: 'var(--status-success)', zemin: 'var(--status-success-bg)' },
  warning: { renk: 'var(--status-warning)', zemin: 'var(--status-warning-bg)' },
  danger: { renk: 'var(--status-danger)', zemin: 'var(--status-danger-bg)' },
  info: { renk: 'var(--status-info)', zemin: 'var(--status-info-bg)' },
  muted: { renk: 'var(--text-muted)', zemin: 'var(--bg-elevated)' },
};
const BTN = 'inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border whitespace-nowrap disabled:opacity-40';

function Rozet({ ton, children }: { ton: string; children: React.ReactNode }) {
  const t = TON[ton] || TON.muted;
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ color: t.renk, background: t.zemin }}>{children}</span>;
}

function sunucuRozeti(d: RcDegerlendirme | undefined) {
  if (!d) return <Rozet ton="muted">—</Rozet>;
  if (d.durum === 'sorunsuz') return <Rozet ton="ok">Sorunsuz</Rozet>;
  if (d.durum === 'sorunlu') return <Rozet ton="danger">{d.kalan} fark kaldı</Rozet>;
  return <Rozet ton="warning">Ölçülemedi</Rozet>;
}

function SunucuSonra({ host, r, d }: { host: string; r: RcSunucuSonuc | undefined; d: RcDegerlendirme | undefined }) {
  const [acik, setAcik] = useState(d?.durum !== 'sorunsuz');
  const ilk = farkAyristir(r?.plan);
  const islem = islemAyristir(r?.islemler);
  const bilgi = bilgiAyristir(r?.plan);
  const kalan = farkAyristir(r?.son_fark);
  return (
    <div className="rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
      <button type="button" onClick={() => setAcik((x) => !x)} className="w-full flex items-center gap-3 px-3 py-2 text-left">
        <span className="font-mono text-sm font-semibold">{host}</span>
        {sunucuRozeti(d)}
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          ilk fark {ilk.length} · işlem {islem.length}{d?.hatali ? ` (${d.hatali} başarısız)` : ''}{d?.sebep ? ` · ${d.sebep}` : ''}
        </span>
        <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>{acik ? '▴' : '▾'}</span>
      </button>
      {acik && (
        <div className="px-3 pb-3 grid gap-3 md:grid-cols-2 text-[12px]">
          <div>
            <div className="font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Reboot sonrası ilk fark</div>
            {ilk.length === 0 ? <div style={{ color: 'var(--text-muted)' }}>Fark yok.</div> : ilk.map((f, i) => (
              <div key={i} className="font-mono text-[11px]">
                <span style={{ color: f.tur === 'DOWN' ? 'var(--status-danger)' : 'var(--status-warning)' }}>{f.tur === 'DOWN' ? 'KAPALI' : 'YENİ'}</span> {f.tip} · {f.ad}
              </div>
            ))}
          </div>
          <div>
            <div className="font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Yapılan işlemler</div>
            {islem.length === 0 ? <div style={{ color: 'var(--text-muted)' }}>İşlem yapılmadı.</div> : islem.map((x, i) => (
              <div key={i} className="font-mono text-[11px]" title={x.mesaj}>
                <span style={{ color: x.sonuc === 'OK' ? 'var(--status-success)' : x.sonuc === 'FAIL' ? 'var(--status-danger)' : 'var(--text-muted)' }}>{x.sonuc}</span> {x.islem} {x.tip} · {x.ad}
                <div className="pl-6 break-all" style={{ color: 'var(--text-muted)' }}>{x.mesaj}</div>
              </div>
            ))}
            {bilgi.length > 0 && (
              <div className="mt-2">
                <div className="font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Elle bakılmalı</div>
                {bilgi.map((b, i) => <div key={i} className="font-mono text-[11px]" style={{ color: 'var(--status-warning)' }}>{b.tur} {b.tip} · {b.ad} — {b.mesaj}</div>)}
              </div>
            )}
          </div>
          <div className="md:col-span-2">
            <div className="font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Son kontrol (düzeltmeden sonra, önce ile)</div>
            {!r?.son_olculdu ? <div style={{ color: 'var(--status-warning)' }}>Son görüntü alınamadı — sorunsuz sayılmadı.</div>
              : kalan.length === 0 ? <div style={{ color: 'var(--status-success)' }}>Önceki durumla birebir aynı.</div>
                : kalan.map((f, i) => (
                  <div key={i} className="font-mono text-[11px]" style={{ color: 'var(--status-danger)' }}>{f.tur === 'DOWN' ? 'hâlâ KAPALI' : 'hâlâ YENİ'} {f.tip} · {f.ad}</div>
                ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Ayrinti({ k, onSonra, busy }: { k: RcKayit; onSonra: () => void; busy: boolean }) {
  const onceS = k.once.sonuc?.sunucular || {};
  const sonraS = k.sonra.sonuc?.sunucular || {};
  const deg = k.ozet?.sonra?.sunucu || {};
  const sonraHazir = ['once_hazir', 'tamam', 'sorunlu', 'sonra_hata'].includes(k.durum);
  const sonraHosts = Object.keys(deg).length ? Object.keys(deg) : [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Kayıt #{k.id}</span>
        <Rozet ton={DURUM[k.durum]?.ton || 'muted'}>{DURUM[k.durum]?.etiket || k.durum}</Rozet>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{k.olusturan} · {fmtDateTime(k.olusturuldu)}{k.not ? ` · ${k.not}` : ''}</span>
        <button type="button" disabled={!sonraHazir || busy} onClick={onSonra} className={`${BTN} ml-auto`}
          style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-fg, #fff)' }}
          title={sonraHazir ? 'Reboot yapıldıktan sonra çalıştırın' : 'Önce görüntüsü hazır değil'}>
          <WrenchScrewdriverIcon className="w-4 h-4" /> Reboot sonrası kontrol et ve düzelt
        </button>
      </div>

      <section className="space-y-1.5">
        <div className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>1 · Reboot öncesi görüntü {k.once.at ? `(${fmtDateTime(k.once.at)})` : ''}</div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(18rem, 1fr))' }}>
          {k.hosts.map((h) => {
            const r = onceS[h];
            const g = goruntuAyristir(r?.goruntu);
            return (
              <details key={h} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
                <summary className="cursor-pointer flex items-center gap-2 text-sm">
                  <span className="font-mono font-semibold">{h}</span>
                  {k.durum === 'once_kosuyor' ? <Rozet ton="info">alınıyor…</Rozet>
                    : r?.goruntu_ok && g.length ? <Rozet ton="ok">{g.length} süreç kaydedildi</Rozet>
                      : <Rozet ton="danger">alınamadı</Rozet>}
                </summary>
                {g.length > 0 ? (
                  <div className="mt-1 max-h-48 overflow-auto font-mono text-[11px] space-y-0.5">
                    {g.map((s, i) => <div key={i}>{s.tip} · {s.ad}{s.adet > 1 ? ` ×${s.adet}` : ''} <span style={{ color: 'var(--text-muted)' }}>({s.kullanicilar})</span></div>)}
                  </div>
                ) : r?.goruntu_hata ? <div className="mt-1 text-[11px]" style={{ color: 'var(--status-danger)' }}>{r.goruntu_hata}</div> : null}
              </details>
            );
          })}
        </div>
      </section>

      <section className="space-y-1.5">
        <div className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          2 · Reboot sonrası kontrol ve düzeltme {k.sonra.at ? `(${fmtDateTime(k.sonra.at)})` : ''}
          {k.ozet?.sonra && <span className="ml-2" style={{ color: k.ozet.sonra.sorunsuz === k.ozet.sonra.toplam ? 'var(--status-success)' : 'var(--status-danger)' }}>{k.ozet.sonra.sorunsuz} / {k.ozet.sonra.toplam} sunucu sorunsuz</span>}
        </div>
        {k.durum === 'sonra_kosuyor' ? <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Sürüyor — iş panelinden izleyebilirsiniz.</div>
          : sonraHosts.length === 0 ? <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Henüz çalıştırılmadı. Reboot'u yaptıktan sonra yukarıdaki düğmeyi kullanın.</div>
            : <div className="space-y-1.5">{sonraHosts.map((h) => <SunucuSonra key={h} host={h} r={sonraS[h]} d={deg[h]} />)}</div>}
      </section>
    </div>
  );
}

export default function RebootKontroluTab() {
  const { addJob } = useJobTracker();
  const [kayitlar, setKayitlar] = useState<RcKayit[]>([]);
  const [secili, setSecili] = useState<RcKayit | null>(null);
  const [metin, setMetin] = useState('');
  const [not, setNot] = useState('');
  const [busy, setBusy] = useState(false);
  const [onay, setOnay] = useState(false);
  const [bilinen, setBilinen] = useState<Set<string> | null>(null);
  const seciliId = useRef<number | null>(null);

  const yukle = useCallback(async () => {
    try {
      const r = await rebootCheckApi.list();
      if (r.ok) setKayitlar(r.kayitlar || []);
      else toast.error(r.message || 'Kayıtlar alınamadı.');
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); }
  }, []);
  const ac = useCallback(async (id: number) => {
    seciliId.current = id;
    try {
      const r = await rebootCheckApi.get(id);
      if (r.ok && r.kayit && seciliId.current === id) setSecili(r.kayit);
      else if (!r.ok) toast.error(r.message || 'Kayıt alınamadı.');
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { yukle(); }, [yukle]);
  useEffect(() => {
    serverHubApi.overview().then((o) => { if (o.ok) setBilinen(new Set((o.hosts || []).map((h: { host: string }) => h.host))); }).catch(() => {});
  }, []);
  // Koşan kayıt açıksa 10 sn'de bir tazele (sunucu AWX sonucunu okuyup kayda yazar).
  useEffect(() => {
    if (!secili || !/_kosuyor$/.test(secili.durum)) return;
    const t = window.setInterval(() => { ac(secili.id); yukle(); }, 10000);
    return () => window.clearInterval(t);
  }, [secili, ac, yukle]);

  const izle = (baslik: string, serverId: number | undefined, jobId: number | null | undefined, id: number) => {
    if (!jobId) return;
    let bitti = false;
    addJob({
      title: baslik,
      fetchStatus: async () => {
        const s = await serverHubApi.jobStatus(Number(serverId ?? 0), jobId);
        if (!s.ok) throw new Error(s.message || 'Durum okunamadı.');
        if (TERMINAL.has(s.status) && !bitti) { bitti = true; window.setTimeout(() => { ac(id); yukle(); }, 1500); }
        return { status: s.status, output: s.output || '', result: s.result };
      },
    });
  };

  const hosts = sunucuListesi(metin);
  const bilinmeyen = bilinen ? hosts.filter((h) => !bilinen.has(h)) : [];

  const onceAl = async () => {
    if (!hosts.length) return;
    setBusy(true);
    try {
      const r = await rebootCheckApi.once(hosts, not);
      if (!r.ok || !r.id) { toast.error(r.message || 'İş başlatılamadı.'); return; }
      toast.success(`Reboot öncesi görüntü alınıyor (#${r.jobId}).`);
      izle(`Reboot kontrolü: ÖNCE ${hosts.length} sunucu`, r.awxServerId, r.jobId, r.id);
      setMetin(''); setNot('');
      await yukle(); await ac(r.id);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const sonraBaslat = async () => {
    if (!secili) return;
    setOnay(false); setBusy(true);
    try {
      const r = await rebootCheckApi.sonra(secili.id);
      if (!r.ok) { toast.error(r.message || 'İş başlatılamadı.'); return; }
      toast.success(`Reboot sonrası kontrol ve düzeltme başladı (#${r.jobId})${r.disarida?.length ? ` — önce görüntüsü olmayan ${r.disarida.length} sunucu dahil edilmedi` : ''}.`);
      izle(`Reboot kontrolü: SONRA #${secili.id}`, r.awxServerId, r.jobId, secili.id);
      await ac(secili.id); await yukle();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const inputStil: React.CSSProperties = { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="text-sm font-semibold">Yeni reboot kontrolü</div>
        <ol className="text-[12px] space-y-0.5 list-decimal pl-5" style={{ color: 'var(--text-secondary)' }}>
          <li><b>Reboot öncesi</b> görüntüyü alın — sunucuda hangi JVM / web sunucusu / süreç çalışıyor, Portal'da saklanır.</li>
          <li>Reboot'u (patch) yapın.</li>
          <li><b>Reboot sonrası kontrol et ve düzelt</b> — önce çalışıp şimdi kapalı olan başlatılır, önce olmayıp şimdi çalışan durdurulur (tek JVM bazında), son görüntü öncekiyle karşılaştırılır.</li>
        </ol>
        <div className="grid gap-2 md:grid-cols-[1fr_16rem]">
          <textarea value={metin} onChange={(e) => setMetin(e.target.value)} rows={2} placeholder="Sunucular (virgül, boşluk ya da satır): GBJBOP18, GBJBOAP18 …"
            className="w-full px-3 py-2 text-xs font-mono border rounded-lg" style={inputStil} />
          <input value={not} onChange={(e) => setNot(e.target.value)} placeholder="Not (ör. Ekim patch'i)" className="w-full px-3 py-2 text-xs border rounded-lg h-fit" style={inputStil} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={!hosts.length || hosts.length > 50 || busy} onClick={onceAl} className={BTN}
            style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-fg, #fff)' }}>
            <CameraIcon className="w-4 h-4" /> Reboot öncesi görüntüyü al ({hosts.length})
          </button>
          {hosts.length > 50 && <span className="text-[11px]" style={{ color: 'var(--status-danger)' }}>En fazla 50 sunucu.</span>}
          {bilinmeyen.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--status-warning)' }}>
              <ExclamationTriangleIcon className="w-3.5 h-3.5" /> Server Hub'da bilinmeyen: {bilinmeyen.join(', ')} — adı kontrol edin
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div className="flex items-center px-3 py-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <span className="text-xs font-semibold">Kayıtlar</span>
            <button type="button" onClick={yukle} className="ml-auto text-xs inline-flex items-center gap-1" style={{ color: 'var(--accent)' }}><ArrowPathIcon className="w-3.5 h-3.5" /> Yenile</button>
          </div>
          {kayitlar.length === 0 ? <div className="p-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>Henüz kayıt yok.</div> : (
            <ul>
              {kayitlar.map((k) => (
                <li key={k.id}>
                  <button type="button" onClick={() => ac(k.id)} className="w-full text-left px-3 py-2 border-b hover:bg-[var(--bg-elevated)]"
                    style={{ borderColor: 'var(--border-subtle)', background: secili?.id === k.id ? 'var(--bg-elevated)' : undefined }}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">#{k.id}</span>
                      <Rozet ton={DURUM[k.durum]?.ton || 'muted'}>{DURUM[k.durum]?.etiket || k.durum}</Rozet>
                    </div>
                    <div className="text-[11px] font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{k.hosts.join(', ')}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{k.olusturan} · {fmtDateTime(k.olusturuldu)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          {secili ? <Ayrinti k={secili} onSonra={() => setOnay(true)} busy={busy} /> : (
            <div className="text-[12px] flex items-center gap-2" style={{ color: 'var(--text-muted)' }}><CheckCircleIcon className="w-4 h-4" /> Ayrıntı için soldan bir kayıt seçin.</div>
          )}
        </div>
      </div>

      <Modal open={onay} onClose={() => setOnay(false)} title="Reboot sonrası kontrol et ve düzelt" size="md"
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOnay(false)} className={BTN} style={inputStil}>Vazgeç</button>
            <button type="button" onClick={sonraBaslat} disabled={busy} className={BTN} style={{ background: 'var(--status-danger)', borderColor: 'var(--status-danger)', color: '#fff' }}>Onayla ve başlat</button>
          </div>
        )}>
        <div className="space-y-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          <p>Sunucuların reboot'u <b>tamamlandıysa</b> devam edin. Her sunucuda:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>Önce çalışıp şimdi <b>kapalı</b> olan JVM / web sunucusu <b>başlatılır</b> (kapalı domain estate başlatma betiğiyle).</li>
            <li>Önce olmayıp şimdi <b>çalışan</b> JVM / web sunucusu <b>durdurulur</b>.</li>
            <li>Her işlem tek JVM bazında (<span className="font-mono">/host/server-config</span>); sunucu grubu ya da domain durdurulmaz, süreç öldürülmez.</li>
            <li>Komutu bilinmeyen teknolojiler (Tomcat, Node…) yalnız raporlanır.</li>
          </ul>
          <p>Yalnız "önce" görüntüsü alınmış sunucular işlenir.</p>
        </div>
      </Modal>
    </div>
  );
}
