// src/components/app_hub/JbossGorunum.tsx — Application Hub: JBoss uygulamasının sunucuları,
// JVM'leri (parametreleriyle; yalnız parola değerleri gizli), web katmanı, yükü ve sunucu kapasitesi.
import React, { useMemo, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import type { JbossDetay, JbossSunucu } from '@/api/appHubApi';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { fmtDate, fmtNumber } from '@/utils/datetime';
import JvmParamDuzenle from './JvmParamDuzenle';
import { Bolum, CalismaHap, Hap, JvmArglari, KapasiteHucresi, KaynakUyarisi, TD, TH } from './ortak';
import { OrtamOzeti, satirAnahtarlari } from './OrtamOzeti';

const KAYNAK_AD: Record<string, string> = {
  envanter: 'JBoss uygulama envanteri (MWAppsInventory)',
  kesif: 'Web ve trafik keşfi',
  serverHub: 'Server Hub taraması',
  kapasite: 'Sunucu envanteri (Inventory)',
};

function heapMetni(s: JbossSunucu) {
  if (!s.minHeap && !s.maxHeap) return null;
  return `${s.minHeap || '?'} / ${s.maxHeap || '?'}`;
}

const KAYNAK_METNI: Record<string, string> = {
  PS: 'Sunucudaki süreç listesinde (ps) JVM süreci görüldü.',
  CLI_STATUS: "JBoss CLI'dan server-state okundu.",
  PS_ABSENT: 'Sunucudaki süreç listesinde (ps) bu JVM için süreç yok.',
  UNMEASURED: 'Tarama çalışma durumunu ölçemedi (ör. süreç listesi okunamadı).',
  ENVANTER: 'Server Hub taramasında bu JVM görülmedi; durum yalnız JBoss uygulama envanterinden (MWAppsInventory).',
};

/**
 * DURUM KANITI (kullanici, 2026-11-12: "1 calisiyor 1 kapali gozukuyor, dogru olup olmadigini nasil
 * anlayacagim"): durumun NEREDEN geldigi, ne zaman olculdugu, envanterle celisip celismedigi ve
 * elle dogrulama komutu.
 */
function DurumKaniti({ j }: { j: JbossSunucu['jvmler'][number] }) {
  const kaynak = j.durumKaynagi || null;
  const celiski = (j.uyumsuzluk || []).filter((x) => x.startsWith('durum:'));
  return (
    <div className="text-[11px] rounded px-2.5 py-1.5 space-y-0.5" style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }} data-testid="durum-kaniti">
      <div>
        <b>Durum nereden:</b> {kaynak ? KAYNAK_METNI[kaynak] || kaynak : 'Server Hub taraması (ölçüm yöntemi kayıtlı değil).'}
        {j.durum && j.durum !== 'unknown' ? ` server-state: ${j.durum}.` : ''}
        {j.taramaTarihi ? ` Ölçüm: ${fmtDate(j.taramaTarihi)}${j.taze ? '' : ' (2 günden eski)'}.` : ''}
      </div>
      {j.envanterDurumu && (
        <div>
          <b>Envanterde:</b> {j.envanterDurumu}
          {celiski.length ? (
            <span style={{ color: 'var(--status-warning-text)' }}> — tarama ile çelişiyor ({celiski.map((c) => c.replace(/^durum: /, '')).join('; ')})</span>
          ) : (
            ' (tarama ile aynı)'
          )}
        </div>
      )}
      <div style={{ color: 'var(--text-muted)' }}>
        Elle doğrulamak için sunucuda: <code style={{ fontFamily: 'var(--font-mono)' }}>ps -ef | grep [j]boss | grep {j.ad}</code>
      </div>
    </div>
  );
}

function SunucuSatiri({ s, acik, onToggle, uygulama, onYenile }: { s: JbossSunucu; acik: boolean; onToggle: () => void; uygulama: string; onYenile?: () => void }) {
  const calisan = s.jvmler.filter((j) => j.calisiyor === true).length;
  const olculemeyen = s.jvmler.filter((j) => j.calisiyor == null).length;
  const portlar = [...new Set(s.jvmler.flatMap((j) => j.portlar || []))];
  return (
    <>
      <tr className="cursor-pointer hover:bg-[var(--bg-inset)]" style={{ borderTop: '1px solid var(--border-subtle)' }} onClick={onToggle} data-testid="sunucu-satiri">
        <td className={TD}>
          <button
            type="button"
            aria-expanded={acik}
            className="inline-flex items-center gap-1 font-medium focus-visible:outline focus-visible:outline-2"
            style={{ color: 'var(--text-primary)' }}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {acik ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
            <span style={{ fontFamily: 'var(--font-mono)' }}>{s.host}</span>
          </button>
          <div className="pl-5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {s.uygulama}
            {s.site ? ` · ${s.site}` : ''}
            {s.tier ? ` · ${s.tier}` : ''}
            {s.domainler && s.domainler.length > 1 ? ` · ${s.domainler.length} domain` : ''}
          </div>
        </td>
        <td className={TD}>{s.ortam || '—'}</td>
        <td className={TD}>
          <div>{s.jbossSurum || '—'}</div>
          {s.nesil && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>JBoss {s.nesil}</div>}
        </td>
        <td className={TD}>
          <div>{s.jre || '—'}</div>
          {s.jdk && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{s.jdk}</div>}
        </td>
        <td className={`${TD} tabular-nums whitespace-nowrap`}>{heapMetni(s) || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
        <td className={TD}>
          {s.jvmler.length ? (
            <div className="space-y-0.5">
              <div className="flex flex-wrap gap-1">
                {calisan > 0 && <Hap ton="iyi">{calisan} çalışıyor</Hap>}
                {s.jvmler.length - calisan - olculemeyen > 0 && <Hap ton="kritik">{s.jvmler.length - calisan - olculemeyen} kapalı</Hap>}
                {olculemeyen > 0 && <Hap ton="notr">{olculemeyen} ölçülemedi</Hap>}
              </div>
              {portlar.length > 0 && (
                <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>port {portlar.slice(0, 6).join(', ')}{portlar.length > 6 ? '…' : ''}</div>
              )}
            </div>
          ) : (
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }} title="Bu sunucu Server Hub taramasında yok ya da taramadan düştü">
              Server Hub'da yok
            </span>
          )}
        </td>
        <td className={TD}>
          {s.web.length ? (
            <div className="text-[12px] leading-tight" style={{ fontFamily: 'var(--font-mono)' }}>
              {[...new Set(s.web.map((w) => w.host))].slice(0, 3).join(', ')}
              {new Set(s.web.map((w) => w.host)).size > 3 ? '…' : ''}
            </div>
          ) : (
            <span className="text-[12px]" style={{ color: 'var(--status-warning-text)' }} title={s.webUyari || undefined}>
              bulunamadı
            </span>
          )}
        </td>
        <td className={TD}><KapasiteHucresi k={s.kapasite} /></td>
      </tr>
      {acik && (
        <tr>
          <td colSpan={8} className="px-4 pb-4 pt-1" style={{ background: 'var(--bg-inset)' }}>
            <div className="space-y-4">
              {s.jvmler.length === 0 && (
                <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  Bu sunucu için Server Hub JVM kaydı yok; JVM parametreleri ve çalışma durumu gösterilemiyor.
                  {heapMetni(s) && ` Envanterdeki heap: ${heapMetni(s)}.`}
                </p>
              )}
              {s.jvmler.map((j) => (
                <div key={`${j.ad}-${j.nesil}`} className="rounded p-3 space-y-2" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[13px]" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{j.ad}</span>
                    {j.nesil && <Hap ton="bilgi">JBoss {j.nesil}</Hap>}
                    <CalismaHap calisiyor={j.calisiyor} />
                    <Hap ton={j.autoStart === 'true' || j.autoStart === 'yes' ? 'iyi' : j.autoStart === 'unknown' ? 'notr' : 'uyari'}>
                      auto-start: {j.autoStart}
                    </Hap>
                    {j.grup && <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>grup {j.grup}</span>}
                    {j.portlar.length > 0 && <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>port {j.portlar.join(', ')}</span>}
                    {j.istek7g != null && <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>7 gün {fmtNumber(j.istek7g)} istek</span>}
                    {!j.taze && <Hap ton="uyari" title="Server Hub taraması 2 günden eski">bayat tarama</Hap>}
                    {j.taramaTarihi && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>tarama {fmtDate(j.taramaTarihi)}</span>}
                    {j.domain && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>domain {j.domain}</span>}
                    {j.nesil != null && (
                      <span className="ml-auto">
                        <JvmParamDuzenle
                          host={j.host || s.host}
                          gen={j.nesil}
                          jvm={j.ad}
                          uygulama={uygulama}
                          mevcut={j.yapilandirilanJvmArgs || j.jvmArgs}
                          onDegisti={() => onYenile && onYenile()}
                        />
                      </span>
                    )}
                  </div>
                  <DurumKaniti j={j} />
                  <JvmArglari
                    baslik="Çalışma anı JVM parametreleri"
                    args={j.jvmArgs}
                    bosMetin={
                      j.jvmArgDurumu && j.jvmArgDurumu !== 'NOT_COLLECTED'
                        ? `JVM parametreleri ölçülemedi (${j.jvmArgDurumu}${j.jvmArgFarki && j.jvmArgFarki.startsWith('reason=') ? `: ${j.jvmArgFarki.slice(7)}` : ''}).`
                        : `JVM parametreleri henüz toplanmıyor: Server Hub taraması bu alanı güncellendiğinde dolduracak.${heapMetni(s) ? ` Envanterdeki heap (min / max): ${heapMetni(s)}.` : ''}`
                    }
                  />
                  {j.yapilandirilanJvmArgs && j.yapilandirilanJvmArgs !== j.jvmArgs && (
                    <JvmArglari baslik="Yapılandırmadaki parametreler" args={j.yapilandirilanJvmArgs} bosMetin="—" />
                  )}
                  {j.jvmArgFarki && !j.jvmArgFarki.startsWith('reason=') && (
                    <div className="text-[12px] space-y-0.5" style={{ color: 'var(--status-warning-text)' }}>
                      <p className="font-semibold">Çalışan JVM ile yapılandırma farklı (yeniden başlatmada değişecek):</p>
                      <ul className="list-disc pl-5" style={{ fontFamily: 'var(--font-mono)' }}>
                        {j.jvmArgFarki
                          .split('; ')
                          .filter((x) => x && x !== 'partial')
                          .map((x) => (
                            <li key={x} className="break-all">{x}</li>
                          ))}
                      </ul>
                      {j.jvmArgFarki.startsWith('partial') && <p style={{ color: 'var(--text-muted)' }}>İfade içeren (${'{…}'}) seçenekler karşılaştırılmadı.</p>}
                    </div>
                  )}
                  {j.jvmArgFarki && j.jvmArgFarki.startsWith('reason=') && j.jvmArgs && (
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Yapılandırma ile karşılaştırılamadı ({j.jvmArgFarki.slice(7)}).</p>
                  )}
                </div>
              ))}
              {s.web.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr style={{ color: 'var(--text-secondary)' }}>
                        <th className={TH}>Web sunucusu</th>
                        <th className={TH}>Ürün</th>
                        <th className={TH}>Vhost</th>
                        <th className={TH}>Bağ</th>
                        <th className={TH}>Trafik (7 gün)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.web.map((w, i) => (
                        <tr key={`${w.host}-${w.serverName}-${i}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td className="px-3 py-1.5" style={{ fontFamily: 'var(--font-mono)' }}>{w.host}</td>
                          <td className="px-3 py-1.5">{w.product || '—'}</td>
                          <td className="px-3 py-1.5 break-all">{w.serverName || '—'}{w.port ? `:${w.port}` : ''}</td>
                          <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)' }}>{w.kaynak || '—'}</td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {w.trafik?.durum === 'var' ? `${fmtNumber(w.trafik.req7 ?? 0)}${w.trafik.sampled ? ' (en az)' : ''}` : w.trafik?.durum === 'yok' ? 'trafik yok' : 'ölçülemedi'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {s.uygulamaYolu && (
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Uygulama yolu: <code style={{ fontFamily: 'var(--font-mono)' }}>{s.uygulamaYolu}</code>
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function JbossGorunum({ d, onYenile }: { d: JbossDetay; onYenile?: () => void }) {
  const tumAnahtarlar = useMemo(() => satirAnahtarlari(d.sunucular.map((s) => `${s.host}|${s.uygulama}`)), [d.sunucular]);
  const [acik, setAcik] = useState<Set<string>>(() => new Set(d.sunucular.length <= 2 ? tumAnahtarlar : []));
  const [ortam, setOrtam] = useState('');
  const { liste, anahtarlar } = useMemo(() => {
    const idx = d.sunucular.map((_, i) => i).filter((i) => !ortam || (d.sunucular[i].ortam || '') === ortam);
    return { liste: idx.map((i) => d.sunucular[i]), anahtarlar: idx.map((i) => tumAnahtarlar[i]) };
  }, [d.sunucular, ortam, tumAnahtarlar]);
  const yuk = d.ozet.yuk;
  const toggle = (k: string) =>
    setAcik((a) => {
      const n = new Set(a);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <div className="space-y-4">
      <KaynakUyarisi kaynaklar={d.kaynaklar} adlar={KAYNAK_AD} />
      {/* ORTAM OZETI (kullanici, 2026-11-12: kartlar "dip dibe surumler, kafa karistiriyor";
          "hangi ortam hangi JBoss surumunde ayri ayri"). Satira tiklamak asagidaki tabloyu o
          ortama suzer. */}
      <OrtamOzeti
        satirlar={d.sunucular.map((s) => ({
          host: s.host,
          ortam: s.ortam,
          surum: s.jbossSurum,
          java: s.jre,
          jvmler: s.jvmler,
          kapasite: s.kapasite,
        }))}
        surumBasligi="JBoss sürümü"
        secili={ortam}
        onSec={setOrtam}
        altBilgi={
          <>
            {fmtNumber(d.ozet.webSunucuSayisi)} web sunucusu
            {' · '}
            {yuk && yuk.var + yuk.yok > 0
              ? `son 7 günde ${fmtNumber(yuk.req7Toplam)} istek${yuk.altSinir ? ' (en az)' : ''} · ${yuk.var} vhost trafikli${yuk.olculemedi ? `, ${yuk.olculemedi} ölçülemedi` : ''}`
              : 'yük ölçülemedi'}
          </>
        }
      />

      <Bolum
        baslik="Sunucular ve JVM'ler"
        aciklama="Satıra tıklayın: JVM parametreleri, auto-start, portlar ve web bağları açılır. Kapasite sunucunun toplam CPU / belleğidir, anlık kullanım değildir."
        sag={
          d.ozet.ortamlar.length > 1 ? (
            <div role="group" aria-label="Ortam" className="inline-flex rounded border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              {['', ...d.ozet.ortamlar].map((o) => (
                <button
                  key={o || 'hepsi'}
                  aria-pressed={ortam === o}
                  onClick={() => setOrtam(o)}
                  className="px-2.5 py-1 text-[12px] focus-visible:outline focus-visible:outline-2"
                  style={{ background: ortam === o ? 'var(--ah-hue-soft)' : 'var(--bg-surface)', color: 'var(--text-primary)', fontWeight: ortam === o ? 600 : 400 }}
                >
                  {o || 'Tümü'}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className={TH}>Sunucu</th>
                <th className={TH}>Ortam</th>
                <th className={TH}>JBoss</th>
                <th className={TH}>Java</th>
                <th className={TH}>Heap (min / max)</th>
                <th className={TH}>JVM durumu</th>
                <th className={TH}>Web</th>
                <th className={TH}>Kapasite</th>
              </tr>
            </thead>
            <tbody>
              {!liste.length && <TableEmptyRow colSpan={8} title="Bu ortamda sunucu yok." />}
              {liste.map((s, i) => {
                // ANAHTAR BENZERSIZ (kullanici, 2026-11-12: "sunucu sekmeleri ya acilmiyor ya
                // kapanmiyor"): ayni host + uygulama icin birden cok satir gelebiliyordu; ayni
                // anahtar iki satiri birden acip kapatiyor, React satirlari karistiriyordu.
                const k = anahtarlar[i];
                return <SunucuSatiri key={k} s={s} acik={acik.has(k)} onToggle={() => toggle(k)} uygulama={d.ad} onYenile={onYenile} />;
              })}
            </tbody>
          </table>
        </div>
      </Bolum>

      <Bolum baslik="Web sunucuları (Apache / IHS)" aciklama="Uygulamaya trafik ileten vhost'lar: Server Hub proxy hedefleri, AJP / mod_cluster ve sertifika envanterinden.">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className={TH}>Web sunucusu</th>
                <th className={TH}>Ürün</th>
                <th className={TH}>Vhost'lar</th>
                <th className={TH}>Arkasındaki uygulama sunucuları</th>
                <th className={TH}>İstek (7 gün)</th>
              </tr>
            </thead>
            <tbody>
              {!d.webSunuculari.length && <TableEmptyRow colSpan={5} title="Web sunucusu eşlenemedi." description="2-tier uygulamalarda web katmanı uygulama sunucusunun kendisidir; 3-tier'da eşleme bulunamadıysa Server Hub taramasını kontrol edin." />}
              {d.webSunuculari.map((w) => (
                <tr key={w.host} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td className={TD} style={{ fontFamily: 'var(--font-mono)' }}>{w.host}</td>
                  <td className={TD}>{w.urun || '—'}</td>
                  <td className={`${TD} text-[12px] break-all`}>{w.vhostlar.join(', ') || '—'}</td>
                  <td className={`${TD} text-[12px]`} style={{ fontFamily: 'var(--font-mono)' }}>{w.uygulamaSunuculari.join(', ')}</td>
                  <td className={`${TD} tabular-nums`}>{w.istek7g == null ? <span style={{ color: 'var(--text-muted)' }}>ölçülemedi</span> : fmtNumber(w.istek7g)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Bolum>
    </div>
  );
}
