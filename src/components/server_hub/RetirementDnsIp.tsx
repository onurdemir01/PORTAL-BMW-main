// src/components/server_hub/RetirementDnsIp.tsx — Retirement: silinecek DNS'ler ve iade edilecek IP'ler (2026-10-09).
//
// Kullanici: "DNS silme ve IP iadesi adiminda hangi IP'nin iade edilecegi ve hangi DNS'in
// sildirilecegi guzelce gosterilsin." Portal bu Smart kayitlarini ACMAZ; ekip acarken neyi
// yazacagini burada gorur. Kurallar sunucuda (server/retirement/dns-ip.cjs):
//   * IP iki turlu: LB VIP (DNS'in cozuldugu) + vhost'un web sunucusunda dinledigi IP.
//   * Vhost IP'sini BASKA vhost dinliyorsa iade EDILMEZ; web sunucusu taranmadiysa "olculemedi".
//   * DNS turu (intranet/internet) tahmin edilmez - kullanici secer, kayitta saklanir.
import React, { useCallback, useState } from 'react';
import { ArrowPathIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { retirementApi, type DnsTur, type RtDnsIp } from '@/api/retirementApi';
import { toast } from '@/hooks/useToast';

const DURUM_RENK: Record<string, string> = {
  silinecek: 'var(--status-danger)', iade: 'var(--status-danger)',
  silinmemeli: 'var(--status-warning)', iade_edilmez: 'var(--status-warning)', olculemedi: 'var(--status-warning)',
  kalacak: 'var(--text-muted)', ozel_ip_yok: 'var(--text-muted)',
};
const DURUM_ETIKET: Record<string, string> = {
  silinecek: 'silinecek', silinmemeli: 'SİLİNMEMELİ', kalacak: 'kalacak (DNS kullanılmaya devam edecek)',
  iade: 'iade edilecek', iade_edilmez: 'iade EDİLMEZ', olculemedi: 'ölçülemedi — elle doğrulayın', ozel_ip_yok: 'vhost belirli bir IP\'ye bağlı değil — iade yok',
};
function Durum({ d }: { d: string }) {
  return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap" style={{ color: DURUM_RENK[d], borderColor: DURUM_RENK[d] }}>{DURUM_ETIKET[d] || d}</span>;
}
const TH = 'px-2.5 py-1.5 text-left text-[11px] font-semibold';
const TD = 'px-2.5 py-1.5 align-top';

/** Smart kayitlarina yapistirilacak duz metin. Yalniz ISLEM YAPILACAK satirlar. */
export function smartMetni(app: string, d: RtDnsIp): string {
  const s: string[] = [`${app} retirement — DNS silme / IP iadesi`];
  const sil = d.dns.filter((x) => x.durum === 'silinecek');
  if (sil.length) {
    s.push('', 'Silinecek DNS kayıtları:');
    for (const x of sil) s.push(`  - ${x.ad} (${x.tur || 'tür seçilmedi'}${x.smartAkisi ? `, ${x.smartAkisi}` : ''})${x.vip?.length ? ` -> ${x.vip.join(', ')}` : ''}`);
  }
  const vip = d.vip.filter((x) => x.durum === 'iade');
  if (vip.length) { s.push('', 'İade edilecek LB VIP IP (364308_Delete_6):'); for (const x of vip) s.push(`  - ${x.ip} (${x.dnsler.join(', ')})`); }
  const vh = d.vhostIp.filter((x) => x.durum === 'iade' && x.ip);
  if (vh.length) { s.push('', 'İade edilecek web sunucusu IP:'); for (const x of vh) s.push(`  - ${x.ip} @ ${x.host} (${x.vhostlar.join(', ')})`); }
  return s.join('\n');
}

export default function RetirementDnsIp({ id, app }: { id: number; app: string }) {
  const [d, setD] = useState<RtDnsIp | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState('');
  const yukle = useCallback(async () => {
    setYukleniyor(true); setHata('');
    try {
      const r = await retirementApi.dnsIp(id);
      if (r.ok) setD(r); else setHata(r.message || 'Hesaplanamadı.');
    } catch (e: unknown) { setHata(e instanceof Error ? e.message : String(e)); } finally { setYukleniyor(false); }
  }, [id]);
  const turSec = async (ad: string, tur: DnsTur | null) => {
    const r = await retirementApi.dnsTur(id, ad, tur);
    if (!r.ok) { toast.error(r.message || 'Kaydedilemedi.'); return; }
    setD((x) => x && { ...x, dns: x.dns.map((s) => (s.ad === ad ? { ...s, tur, smartAkisi: tur === 'intranet' ? '2523535_Delete_6' : tur === 'internet' ? '349792_Delete' : null } : s)) });
  };
  const kopyala = async () => {
    if (!d) return;
    try { await navigator.clipboard.writeText(smartMetni(app, d)); toast.success('Smart için metin panoya kopyalandı.'); }
    catch { toast.error('Panoya kopyalanamadı.'); }
  };

  return (
    <details className="rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !d && !yukleniyor) yukle(); }}>
      <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold">
        DNS silme / IP iadesi <span className="font-normal" style={{ color: 'var(--text-muted)' }}>— hangi DNS silinecek, hangi IP iade edilecek (Smart kayıtları ekip tarafından açılır)</span>
      </summary>
      <div className="px-3 pb-3 space-y-3 text-[12px]">
        <div className="flex items-center gap-2">
          {yukleniyor && <span style={{ color: 'var(--text-muted)' }}>hesaplanıyor (DNS sorgusu dahil)…</span>}
          {hata && <span style={{ color: 'var(--status-danger)' }}>{hata}</span>}
          <span className="ml-auto" />
          {d && <button onClick={kopyala} className="inline-flex items-center gap-1 text-[11px] underline decoration-dotted" style={{ color: 'var(--accent)' }}><ClipboardDocumentIcon className="w-3.5 h-3.5" /> Smart için metni kopyala</button>}
          <button onClick={yukle} disabled={yukleniyor} className="inline-flex items-center gap-1 text-[11px] underline decoration-dotted" style={{ color: 'var(--accent)' }}><ArrowPathIcon className="w-3.5 h-3.5" /> Yeniden hesapla</button>
        </div>
        {d && (
          <>
            {(d.hubHata || (d.taranmayan && d.taranmayan.length > 0)) && (
              <div className="rounded-lg border px-3 py-2" style={{ color: 'var(--status-warning)', borderColor: 'var(--status-warning)', background: 'var(--status-warning-bg)' }}>
                {d.hubHata ? `Server Hub okunamadı (${d.hubHata}) — IP paylaşımı ölçülemedi.` : `Server Hub'da taranmamış web sunucusu: ${d.taranmayan!.join(', ')} — bu sunuculardaki IP'lerin paylaşımı ölçülemedi.`}
              </div>
            )}

            <section className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>DNS kayıtları {d.dnsReuse && '— kayıtta "DNS kullanılmaya devam edecek" seçili, silinmez'}</div>
              {d.dns.length === 0 ? <div style={{ color: 'var(--text-muted)' }}>Bu kaydın hedeflerinde web vhost'u (DNS adı) yok.</div> : (
                <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
                  <table className="w-full border-collapse">
                    <thead style={{ background: 'var(--bg-elevated)' }}><tr>{['DNS adı', 'Çözüldüğü IP (LB VIP)', 'Kullanan vhost', 'Tür (sen seç)', 'Durum'].map((h) => <th key={h} className={TH} style={{ color: 'var(--text-muted)' }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {d.dns.map((x) => (
                        <tr key={x.ad} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                          <td className={`${TD} font-mono font-semibold`}>{x.ad}</td>
                          <td className={`${TD} font-mono`}>{x.vip ? x.vip.join(', ') || '—' : <span style={{ color: 'var(--status-warning)' }}>çözülemedi ({x.cozumHata})</span>}</td>
                          <td className={`${TD} text-[11px]`}>
                            {x.vhostlar.map((v) => <div key={v.host + v.serverName}>{v.host} · {v.serverName}</div>)}
                            {x.paylasilan.map((v) => <div key={'p' + v.host + v.serverName} style={{ color: 'var(--status-warning)' }}>başka vhost: {v.host} · {v.serverName}</div>)}
                          </td>
                          <td className={TD}>
                            <div className="flex gap-2 text-[11px]">
                              {(['intranet', 'internet'] as DnsTur[]).map((t) => (
                                <label key={t} className="inline-flex items-center gap-1 cursor-pointer">
                                  <input type="radio" name={`dns-tur-${x.ad}`} checked={x.tur === t} onChange={() => turSec(x.ad, t)} /> {t}
                                </label>
                              ))}
                            </div>
                            <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{x.smartAkisi || 'akış: tür seçilince'}</div>
                          </td>
                          <td className={TD}><Durum d={x.durum} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>İade edilecek IP'ler</div>
              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
                <table className="w-full border-collapse">
                  <thead style={{ background: 'var(--bg-elevated)' }}><tr>{['IP', 'Tür', 'Nerede / kim kullanıyor', 'Durum'].map((h) => <th key={h} className={TH} style={{ color: 'var(--text-muted)' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {d.vip.map((x) => (
                      <tr key={'v' + x.ip} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                        <td className={`${TD} font-mono font-semibold`}>{x.ip}</td>
                        <td className={TD}>LB VIP <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>364308_Delete_6</span></td>
                        <td className={`${TD} text-[11px]`}>DNS: {x.dnsler.join(', ')}{x.sebep && <div style={{ color: 'var(--status-warning)' }}>{x.sebep}</div>}</td>
                        <td className={TD}><Durum d={x.durum} /></td>
                      </tr>
                    ))}
                    {d.vhostIp.map((x) => (
                      <tr key={'h' + x.host + x.ip + x.vhostlar.join()} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                        <td className={`${TD} font-mono font-semibold`}>{x.ip || '—'}</td>
                        <td className={TD}>Web sunucusu IP</td>
                        <td className={`${TD} text-[11px]`}>
                          {x.host} · {x.vhostlar.join(', ')}
                          {x.digerleri.length > 0 && <div style={{ color: 'var(--status-warning)' }}>bu IP'yi dinleyen başka vhost: {x.digerleri.join(', ')}</div>}
                        </td>
                        <td className={TD}><Durum d={x.durum} /></td>
                      </tr>
                    ))}
                    {d.vip.length === 0 && d.vhostIp.length === 0 && <tr><td colSpan={4} className={TD} style={{ color: 'var(--text-muted)' }}>İade edilecek IP bulunamadı.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                LB VIP, Portal sunucusunun DNS sorgusuyla bulunur; VIP'i bu kayıt dışındaki başka bir DNS adı kullanıyorsa Portal bunu göremez — LB tarafında kontrol edin.
                Web sunucusu IP'si, aynı sunucuda başka bir vhost da dinliyorsa iade edilmez.
              </p>
            </section>
          </>
        )}
      </div>
    </details>
  );
}
