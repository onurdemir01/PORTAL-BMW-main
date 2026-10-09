// src/components/server_hub/RebootKontroluTab.tsx — Server Hub > Reboot Kontrolü (2026-10-08).
//
// Kullanıcı: "Çalışma öncesi ve sonrası çalıştıralım, sunucunun sorunsuz olduğundan emin olalım."
// Kural (kullanıcı, "mesele çok basit"): Nginx / Red Hat Apache / IBM Apache / CTG / JBoss 7 / JBoss 8 / WAS
// reboot öncesi çalışıyorduysa sonra da çalışmalı (kapalıysa açılır). JBoss ve WAS JVM'lerinde önce çalışıp
// kapanan açılır, önce yokken çalışan kapatılır — tek JVM. Python vb. izlenmez. Ekran ürün başına:
// "çalışıyordu → çalışıyor ✓". Ölçülemeyen sunucu sorunsuz SAYILMAZ.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, CameraIcon, WrenchScrewdriverIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { rebootCheckApi, type RcKayit, type RcSunucuSonuc, type RcDegerlendirme } from '@/api/rebootCheckApi';
import { serverHubApi } from '@/api/serverHubApi';
import { useJobTracker } from '@/contexts/JobTrackerContext';
import { Modal } from '@/components/common/Modal';
import { fmtDateTime } from '@/utils/datetime';
import { toast } from '@/hooks/useToast';
import { DURUM, bilgiAyristir, goruntuAyristir, islemAyristir, onceOzeti, rebootOldu, sunucuListesi, urunTablosu, type Durum, type IslemSatiri } from './rebootKontrolu';

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

const DURUM_RENK: Record<Durum, string> = { ok: 'var(--status-success)', sorun: 'var(--status-danger)', bilgi: 'var(--status-warning)' };
const DURUM_ISARET: Record<Durum, string> = { ok: '✓', sorun: '✗', bilgi: 'i' };

function IslemNotu({ x }: { x?: IslemSatiri }) {
  if (!x) return null;
  const renk = x.sonuc === 'OK' ? 'var(--status-success)' : x.sonuc === 'FAIL' ? 'var(--status-danger)' : 'var(--text-muted)';
  const ne = x.islem === 'baslat' ? 'açma' : 'kapatma';
  const sonuc = x.sonuc === 'OK' ? 'yapıldı' : x.sonuc === 'FAIL' ? 'BAŞARISIZ' : x.sonuc === 'SKIP' ? 'gerek kalmadı' : '?';
  return (
    <span className="text-[11px]" style={{ color: renk }} title={x.mesaj}>
      {ne} {sonuc}{x.sonuc === 'FAIL' && x.mesaj ? ` — ${x.mesaj}` : ''}
    </span>
  );
}

function SunucuSonra({ host, once, r, d }: { host: string; once: string[] | undefined; r: RcSunucuSonuc | undefined; d: RcDegerlendirme | undefined }) {
  const [acik, setAcik] = useState(d?.durum !== 'sorunsuz');
  const og = goruntuAyristir(once);
  const ig = goruntuAyristir(r?.goruntu);
  const sg = r?.son_olculdu ? goruntuAyristir(r?.son_goruntu) : null;
  const islem = islemAyristir(r?.islemler);
  const tablo = urunTablosu(og, ig, sg, islem);
  const hata = bilgiAyristir(r?.plan).filter((b) => b.tur === 'HATA');
  const reboot = rebootOldu(og, ig);
  return (
    <div className="rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
      <button type="button" onClick={() => setAcik((x) => !x)} className="w-full flex items-center gap-3 px-3 py-2 text-left">
        <span className="font-mono text-sm font-semibold">{host}</span>
        {sunucuRozeti(d)}
        {reboot === false && <Rozet ton="warning">reboot olmamış görünüyor</Rozet>}
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {islem.filter((x) => x.sonuc !== 'SKIP').length} işlem{d?.hatali ? ` (${d.hatali} başarısız)` : ''}{d?.sebep ? ` · ${d.sebep}` : ''}
        </span>
        <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>{acik ? '▴' : '▾'}</span>
      </button>
      {acik && (
        <div className="px-3 pb-3 space-y-2 text-[12px]">
          {reboot !== null && (
            <div style={{ color: reboot ? 'var(--text-muted)' : 'var(--status-warning)' }}>
              {reboot ? 'Reboot doğrulandı (açılış kimliği değişmiş).' : 'Açılış kimliği reboot öncesiyle aynı — sunucu yeniden başlamamış olabilir.'}
            </div>
          )}
          {hata.map((b, i) => <div key={i} style={{ color: 'var(--status-danger)' }}>{b.mesaj}</div>)}
          {!r?.son_olculdu && <div style={{ color: 'var(--status-warning)' }}>Son durum ölçülemedi — sorunsuz sayılmadı.</div>}
          {tablo.length === 0 ? <div style={{ color: 'var(--text-muted)' }}>Bu sunucuda izlenen ürün (Nginx, Apache, IHS, CTG, JBoss, WAS) yok.</div> : (
            <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
              {tablo.map((u) => (
                <li key={u.urun} className="py-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="w-4 text-center font-semibold" style={{ color: DURUM_RENK[u.durum] }}>{DURUM_ISARET[u.durum]}</span>
                    <span className="font-semibold w-36">{u.ad}</span>
                    <span style={{ color: u.durum === 'ok' ? 'var(--text-secondary)' : DURUM_RENK[u.durum] }}>{u.metin}</span>
                    <IslemNotu x={u.islem} />
                  </div>
                  {(u.jvmAyni > 0 || u.jvmDegisim.length > 0) && (
                    <div className="pl-[10.5rem] mt-0.5 space-y-0.5">
                      {u.jvmAyni > 0 && <div style={{ color: 'var(--text-muted)' }}>{u.jvmAyni} JVM önceki gibi çalışıyor</div>}
                      {u.jvmDegisim.map((j) => (
                        <div key={j.ad} className="flex flex-wrap items-baseline gap-x-2">
                          <span className="w-4 text-center" style={{ color: DURUM_RENK[j.durum] }}>{DURUM_ISARET[j.durum]}</span>
                          <span className="font-mono text-[11px]">{j.ad}</span>
                          <span style={{ color: j.durum === 'ok' ? 'var(--text-secondary)' : DURUM_RENK[j.durum] }}>{j.metin}</span>
                          <IslemNotu x={j.islem} />
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
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
            const oz = onceOzeti(g);
            const alindi = !!r?.goruntu_ok && g.bicimTamam;
            return (
              <details key={h} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
                <summary className="cursor-pointer flex items-center gap-2 text-sm">
                  <span className="font-mono font-semibold">{h}</span>
                  {k.durum === 'once_kosuyor' ? <Rozet ton="info">alınıyor…</Rozet>
                    : alindi ? <Rozet ton="ok">{oz.length ? `${oz.length} ürün kaydedildi` : 'izlenen ürün yok'}</Rozet>
                      : r?.goruntu_ok ? (
                        // BOOT satiri yok = gorutuyu ESKI playbook (patch-snapshot.sh) aldi. Yeni kayitta
                        // gorunuyorsa AWX projesindeki reboot_check.yml guncel degildir (2026-10-09, job 3391026).
                        <span title="Görüntüyü eski playbook aldı (patch-snapshot.sh). AWX projesindeki reboot_check.yml ve scripts/reboot_goruntu.sh güncel değil — ZIP'i uygulayıp projeyi Sync edin, sonra yeniden alın.">
                          <Rozet ton="warning">eski playbook — AWX güncel değil</Rozet>
                        </span>
                      )
                        : <Rozet ton="danger">alınamadı</Rozet>}
                </summary>
                {alindi && oz.length > 0 ? (
                  <ul className="mt-1 text-[12px] space-y-0.5">
                    {oz.map((o) => <li key={o.urun}>{o.ad}{o.jvm !== null ? <span style={{ color: 'var(--text-muted)' }}> · {o.jvm} JVM</span> : null}</li>)}
                  </ul>
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
            : <div className="space-y-1.5">{sonraHosts.map((h) => <SunucuSonra key={h} host={h} once={onceS[h]?.goruntu} r={sonraS[h]} d={deg[h]} />)}</div>}
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
          <li><b>Reboot öncesi</b> görüntüyü alın — Nginx, Red Hat Apache, IBM Apache, CTG, JBoss 7/8, WAS ve JVM'leri; Portal'da saklanır.</li>
          <li>Reboot'u (patch) yapın.</li>
          <li><b>Reboot sonrası kontrol et ve düzelt</b> — önce çalışan ürün kapalıysa açılır; JBoss/WAS'ta önce çalışan JVM açılır, önce olmayan JVM kapatılır.</li>
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
            <li>Reboot öncesi çalışan <b>Nginx / Red Hat Apache / IBM Apache / CTG / JBoss / WAS</b> kapalıysa estate başlatma yoluyla <b>açılır</b>. Önce çalışmayan ürüne dokunulmaz.</li>
            <li>JBoss ve WAS'ta önce çalışıp şimdi kapalı olan JVM <b>açılır</b>; önce çalışmayıp şimdi çalışan JVM <b>kapatılır</b>.</li>
            <li>Her JVM tek tek işlenir; sunucu grubu ya da domain durdurulmaz, süreç öldürülmez.</li>
          </ul>
          <p>Yalnız "önce" görüntüsü alınmış sunucular işlenir.</p>
        </div>
      </Modal>
    </div>
  );
}
