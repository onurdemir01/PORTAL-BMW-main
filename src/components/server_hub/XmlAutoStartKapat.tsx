// src/components/server_hub/XmlAutoStartKapat.tsx — domain KAPALIYKEN host XML ile auto-start KAPAT (2026-11-15).
//
// Kullanıcı kararı: "biz 'Tek tek, bilinçli kullanım için XML yolu ekleyebilirim' opsiyonunu devreye alalım ben
// bunları görmek istemiyorum. bunlar yanlış retire edilmiş uygulamalar o yüzden auto-start'ları kapatılmalı".
//
// Taramada host controller çalışmıyorsa (JBOSS_DOMAIN_DOWN, JVM domainKapali) CLI ile auto-start değişmez; tek-JVM
// "Kapat" düğmesi gizli. Bu pencere server_hub_fix jboss_autostart_xml_off işini açar: YALNIZ kapatma, önce plan
// (salt okunur: dosya, host adı, JVM başına eski -> false, yedek yeri), sonra onay (Production'da ek uyarı + işaret),
// sonra uygulama. Betik host controller'ın kapalı olduğunu yazmadan önce ve sonra canlı kontrol eder; açıldıysa
// geri alır. Sunucu (/jvm-autostart-xml) kapıları taze taramadan yeniden uygular. Toplu karşılığı (2026-11-15): Toplu
// Auto-Start › "Domain kapalı — auto-start host XML üzerinden kapat" (TopluXmlKapat.tsx; aynı kapılar, ayrı toplu iş).
import React, { useState } from 'react';
import {
  ExclamationTriangleIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { serverHubApi, type ShXmlKapatSonuc } from '@/api/serverHubApi';
import { toast } from '@/hooks/useToast';
import { useEscIleKapat } from '@/components/common/pencereKlavye';

export interface XmlKapatJvm {
  gen: number;
  name: string;
  running?: boolean | null;
  runningKnown?: boolean | null;
  autoStart?: string;
  domainKapali?: boolean | null;
  source?: string;
  cfgSrc?: string | null;
  yalnizEnvanter?: boolean | null;
}

/** JVM host XML ile kapatılabilir mi (sunucu xmlKapatKapisi ile aynı koşullar). */
export function xmlKapatilabilir(j: XmlKapatJvm): boolean {
  return (
    j.domainKapali === true &&
    j.yalnizEnvanter !== true &&
    j.source !== 'envanter' &&
    String(j.cfgSrc || '').toUpperCase() !== 'UNAVAILABLE' &&
    j.running !== true &&
    j.runningKnown !== false &&
    j.autoStart === 'true'
  );
}

/** Bu JBoss sürümünün domain'inde host XML ile kapatılabilecek JVM adları. */
export function xmlKapatAdaylari(jvms: XmlKapatJvm[], gen: number | undefined): string[] {
  return (jvms || []).filter((j) => Number(j.gen) === Number(gen) && xmlKapatilabilir(j)).map((j) => j.name);
}

/** Sunucu düzeyi engel (sunucu da aynı kapıyı uygular); boş = engel yok. */
export function xmlKapatSunucuEngeli(h: { schemaUnknown?: boolean; fresh?: boolean } | null | undefined): string {
  if (h?.schemaUnknown === true) return 'Server Hub şeması okunamadı — eylemler kapalı';
  if (h?.fresh === false) return 'tarama bayat ya da son yükleme dışlandı — eylemler kapalı';
  return '';
}

export interface XmlKapatOge {
  jvm: string;
  durum: string;
  mesaj: string;
}
export interface XmlKapatAyrisik {
  genel: { durum: string; mesaj: string } | null;
  ogeler: XmlKapatOge[];
  plan: { dosya?: string; host?: string; yedek?: string };
}

const satirAyir = (line: string): { durum: string; mesaj: string } | null => {
  const p = String(line || '').split('\t');
  if (p[0] !== 'RESULT' || p.length < 3) return null;
  return { durum: String(p[2] || '').toUpperCase(), mesaj: p.slice(3).join(' ').trim() };
};

/** server_hub_fix_result -> genel sonuç, öğe satırları, plan bilgisi (dosya / host / yedek). */
export function xmlSonucunuAyristir(result: unknown): XmlKapatAyrisik {
  const r = (result && typeof result === 'object' ? result : {}) as ShXmlKapatSonuc;
  const ogeler: XmlKapatOge[] = [];
  for (const x of Array.isArray(r.items) ? r.items : []) {
    const s = x && satirAyir(x.line);
    if (s) ogeler.push({ jvm: String(x.jvm || ''), ...s });
  }
  const plan: XmlKapatAyrisik['plan'] = {};
  for (const l of Array.isArray(r.xmlplan) ? r.xmlplan : []) {
    const p = String(l || '').split('\t');
    if (p[0] === 'PLAN' && (p[1] === 'dosya' || p[1] === 'host' || p[1] === 'yedek')) plan[p[1]] = p.slice(2).join(' ');
  }
  return { genel: satirAyir(r.line || ''), ogeler, plan };
}

type Asama = 'ask' | 'planning' | 'planned' | 'applying' | 'done';
const DURUM_RENK: Record<string, string> = {
  OK: 'var(--status-success)',
  SKIP: 'var(--text-muted)',
  PLAN: 'var(--status-info)',
  FAIL: 'var(--status-danger)',
};
const BTN =
  'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
const btn = (primary = false): React.CSSProperties =>
  primary
    ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--text-on-accent)' }
    : { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' };

export function XmlAutoStartKapatPenceresi({
  host,
  gen,
  jvms,
  envGroup,
  trackJob,
  onClose,
  onBitti,
}: {
  host: string;
  gen: number;
  jvms: string[];
  envGroup?: string | null;
  trackJob: (
    title: string,
    r: { jobId: number | null; awxServerId: number },
    onDone?: (status: string, result: unknown) => void,
  ) => void;
  onClose: () => void;
  onBitti: () => void;
}) {
  const [asama, setAsama] = useState<Asama>('ask');
  const [sonuc, setSonuc] = useState<XmlKapatAyrisik | null>(null);
  const [isNo, setIsNo] = useState<number | null>(null);
  const [prodOnay, setProdOnay] = useState(false);
  // Production ya da ortamı bilinmeyen sunucu: ek uyarı + açık işaret.
  const prod = envGroup !== 'Non-Production';
  // İş AWX'te başladıktan sonra (iş no var) pencere kapatılabilir: iş, iş çubuğunda sürer (inceleme F5: yoklama
  // hiç bitmezse pencere HostModal'ın üstünde takılı kalıyordu). İş isteği yanıtlanana kadar kapanmaz. "İptal"
  // koşan işte kapalı kalır — işi iptal etmez, yanlış anlaşılmasın.
  const kosuyor = asama === 'planning' || asama === 'applying';
  const kapatilabilir = !kosuyor || isNo != null;
  useEscIleKapat(true, () => {
    if (kapatilabilir) onClose();
  });

  const baslat = async (plan: boolean) => {
    const geri: Asama = plan ? 'ask' : 'planned';
    setAsama(plan ? 'planning' : 'applying');
    setIsNo(null);
    try {
      const r = await serverHubApi.jvmAutoStartXml({ host, gen, jvms, asama: plan ? 'plan' : 'uygula' });
      if (!r.ok || r.jobId == null) {
        toast.error(r.message || 'İş başlatılamadı.');
        setAsama(geri);
        return;
      }
      setIsNo(r.jobId);
      trackJob(
        `Server Hub: ${plan ? 'plan' : 'uygula'} auto-start kapat (host XML) @ ${host} (${jvms.length} JVM)`,
        r,
        (status, result) => {
          const s = xmlSonucunuAyristir(result);
          setSonuc(s);
          if (plan) {
            setAsama('planned');
            return;
          }
          setAsama('done');
          const d = s.genel?.durum;
          if (status === 'successful' && (d === 'OK' || d === 'SKIP'))
            toast.success(`Auto-start kapatıldı (host XML): ${s.genel?.mesaj || status}`);
          else toast.error(`Auto-start kapatılamadı (host XML): ${s.genel?.mesaj || status}`);
          onBitti();
        },
      );
      toast.success(`${plan ? 'Plan' : 'Uygulama'} işi başladı (#${r.jobId}). Sonuç bu pencerede görünecek.`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
      setAsama(geri);
    }
  };

  const planHazir =
    asama === 'planned' &&
    sonuc?.genel?.durum === 'PLAN' &&
    sonuc.ogeler.some((o) => o.durum === 'PLAN') &&
    !sonuc.ogeler.some((o) => o.durum === 'FAIL');
  const uygulanabilir = planHazir && (!prod || prodOnay);
  const planSorunu =
    asama === 'planned' && !planHazir
      ? sonuc?.genel?.durum === 'SKIP'
        ? "Plan: değiştirilecek bir şey yok (auto-start'lar zaten kapalı)."
        : `Plan uygulanamaz: ${sonuc?.genel?.mesaj || 'sonuç okunamadı'}`
      : '';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.45)' }}
      role="presentation"
      onClick={() => (kapatilabilir ? onClose() : null)}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border p-5 space-y-3 max-h-[90vh] overflow-auto"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Auto-start'ı kapat (host XML)"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <WrenchScrewdriverIcon className="w-5 h-5 shrink-0" style={{ color: 'var(--accent)' }} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              Auto-start&apos;ı kapat (host XML) — {host} · JBoss {gen}
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Bu sunucuda JBoss {gen} domain&apos;i kapalı (taramada host controller çalışmıyordu); auto-start CLI ile
              değiştirilemez. Aşağıdaki {jvms.length} JVM&apos;in auto-start&apos;ı host XML dosyasında doğrudan{' '}
              <b>false</b> yapılır — reboot&apos;ta açılmazlar. Yalnız kapatma yapılır.
            </div>
          </div>
          <button
            onClick={() => (kapatilabilir ? onClose() : null)}
            className="p-1 rounded-lg"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Pencereyi kapat"
            disabled={!kapatilabilir}
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
        <div
          className="rounded-xl border px-3 py-2 text-[12px] font-mono"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
          data-testid="xml-kapat-jvmler"
        >
          {jvms.join(', ')}
        </div>
        {prod && asama !== 'done' && (
          <div
            className="flex items-start gap-2 rounded-xl border px-3 py-2 text-[12px]"
            style={{
              borderColor: 'var(--status-danger)',
              background: 'var(--status-danger-bg)',
              color: 'var(--text-primary)',
            }}
            role="alert"
            data-testid="xml-kapat-prod-uyari"
          >
            <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--status-danger)' }} />
            <div>
              <b>{envGroup === 'Production' ? 'PRODUCTION sunucusu.' : 'Ortamı bilinmeyen sunucu (Production sayıldı).'}</b>{' '}
              Host XML elle değil betikle değişir ama yine de canlı yapılandırma dosyasıdır: bu JVM&apos;ler bir sonraki
              reboot&apos;ta açılmaz. Uygulamaların gerçekten retire edilmiş olduğundan emin olun.
            </div>
          </div>
        )}
        {asama === 'ask' && (
          <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            Önce sunucuda <b>plan</b> koşar: dosya, host adı, her JVM&apos;in mevcut değeri ve yedek yeri gösterilir,
            hiçbir şey değişmez. Planı gördükten sonra onaylarsınız. Uygulamada önce yedek alınır; betik yazmadan önce
            ve sonra host controller&apos;ın hâlâ kapalı olduğunu kontrol eder, açıldıysa değişikliği geri alır.
          </p>
        )}
        {asama === 'planning' && (
          <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }} role="status">
            Plan koşuyor{isNo ? ` (iş #${isNo})` : ''}… (iş penceresinden izlenebilir)
          </p>
        )}
        {asama === 'applying' && (
          <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }} role="status">
            Uygulanıyor{isNo ? ` (iş #${isNo})` : ''}…
          </p>
        )}
        {kosuyor && isNo != null && (
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }} data-testid="xml-kapat-arka-plan">
            Pencereyi kapatabilirsiniz: iş arka planda sürer, sonucu iş çubuğunda görünür.
          </p>
        )}
        {sonuc && (asama === 'planned' || asama === 'done' || asama === 'applying') && (
          <div
            className="rounded-xl border px-3 py-2 text-[12px] space-y-1.5"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
            data-testid="xml-kapat-sonuc"
          >
            {(sonuc.plan.dosya || sonuc.plan.host || sonuc.plan.yedek) && (
              <div className="font-mono text-[11px] space-y-0.5">
                {sonuc.plan.dosya && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>dosya=</span>
                    {sonuc.plan.dosya}
                  </div>
                )}
                {sonuc.plan.host && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>host name=</span>
                    {sonuc.plan.host}
                  </div>
                )}
                {sonuc.plan.yedek && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>yedek=</span>
                    {sonuc.plan.yedek}
                  </div>
                )}
              </div>
            )}
            {sonuc.ogeler.length > 0 && (
              <table className="w-full text-[11px]">
                <tbody>
                  {sonuc.ogeler.map((o) => (
                    <tr key={o.jvm} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="py-0.5 pr-2 font-mono font-semibold">{o.jvm}</td>
                      <td className="py-0.5 pr-2 font-semibold" style={{ color: DURUM_RENK[o.durum] || 'var(--text-primary)' }}>
                        {o.durum}
                      </td>
                      <td className="py-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {o.mesaj}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {sonuc.genel && (
              <div style={{ color: DURUM_RENK[sonuc.genel.durum] || 'var(--text-primary)' }}>
                <b>{sonuc.genel.durum}:</b> {sonuc.genel.mesaj}
              </div>
            )}
          </div>
        )}
        {planSorunu && (
          <p className="text-[12px]" style={{ color: 'var(--status-warning)' }} data-testid="xml-kapat-plan-sorunu">
            {planSorunu}
          </p>
        )}
        {planHazir && prod && (
          <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={prodOnay} onChange={(e) => setProdOnay(e.target.checked)} />
            Bu bir {envGroup === 'Production' ? 'Production' : 'ortamı bilinmeyen'} sunucu; bu JVM&apos;lerin reboot&apos;ta
            açılmayacağını anladım
          </label>
        )}
        <div className="flex items-center gap-2 justify-end">
          {asama === 'done' ? (
            <button onClick={onClose} className={BTN} style={btn()}>
              Kapat
            </button>
          ) : (
            <button
              onClick={onClose}
              className={BTN}
              style={btn()}
              disabled={asama === 'planning' || asama === 'applying'}
            >
              İptal
            </button>
          )}
          {asama === 'ask' && (
            <button onClick={() => void baslat(true)} className={BTN} style={btn(true)}>
              Planı göster
            </button>
          )}
          {asama === 'planned' && planHazir && (
            <button
              onClick={() => void baslat(false)}
              className={BTN}
              disabled={!uygulanabilir}
              title={uygulanabilir ? undefined : 'Production onayını işaretleyin'}
              style={{ ...btn(true), background: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
            >
              Onayla ve uygula
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
