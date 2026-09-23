// src/components/admin/tabs/TabAccessPanel.tsx — "sayfa + sekme erişimi" paneli (2026-09-23).
//
// Denetim Erişimi paneli (2026-09-17) bir kullanıcıya/AD grubuna seçilen sekmeleri açıyordu.
// Kullanıcı aynısını Nginx Hub için de istedi ("istediğim kullanıcıları sokayım ama yalnız
// istediğim sayfaları görsünler"). İki ekranın davranışı birebir aynı olduğu için panel
// ortaklaştırıldı; sayfaya özgü olan yalnızca METİNLER ve API uçlarıdır.
//
// Motor: portal_element_visibility. Sayfa elementine allow, sekme elementlerine allow/deny.
// Sekmelerin VARSAYILANI sayfadan sayfaya değişebilir (Denetim: kapalı, Nginx Hub: açık);
// bu yüzden "seçilmeyen sekmeye ne yazılacağı" kararı sunucudadır, panel yalnızca seçimi yollar.
import React, { useMemo, useState } from 'react';
import { ShieldCheckIcon, TrashIcon, PlusIcon } from '@heroicons/react/24/outline';
import { type DenetimAccessGrant } from '@/api/adminApi';
import { toast } from '@/hooks/useToast';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { LoadingLogo } from '@/components/common/LoadingLogo';

export type TabAccessGrant = DenetimAccessGrant;

export interface TabAccessApi {
  list(): Promise<{ tabs: string[]; grants: TabAccessGrant[] }>;
  set(body: { principalType: 'user' | 'group'; principalId: string; tabs: string[] | 'all' }): Promise<void>;
  remove(principalType: 'user' | 'group', principalId: string): Promise<void>;
}

export function TabAccessPanel({
  api,
  labels,
  title,
  intro,
  emptyText,
  subject,
}: {
  api: TabAccessApi;
  labels: Record<string, string>;
  title: string;
  intro: React.ReactNode;
  emptyText: string;
  /** Bildirimlerde geçen ad: "<subject> erişimi kaydedildi" */
  subject: string;
}) {
  const [tabs, setTabs] = useState<string[]>([]);
  const [grants, setGrants] = useState<TabAccessGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // form
  const [ptype, setPtype] = useState<'user' | 'group'>('user');
  const [pid, setPid] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.list();
      setTabs(r.tabs);
      setGrants(r.grants);
      setErr('');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  // `useAsyncEffect`: efekt içinde doğrudan `load()` çağırmak
  // `react-hooks/set-state-in-effect` uyarısı üretiyordu; ayrıca bileşen sökülünce
  // gelen cevap artık `setState` ÇAĞIRMAZ.
  useAsyncEffect(async (alive) => {
    if (alive()) await load();
  }, []);

  const allSelected = tabs.length > 0 && sel.size === tabs.length;
  const toggle = (t: string) => setSel((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  const save = async () => {
    const id = pid.trim();
    if (!id) { toast.error(ptype === 'user' ? 'Kullanıcı adı girin.' : 'AD grubu girin (CN adı ya da tam DN).'); return; }
    if (sel.size === 0) { toast.error('En az bir sekme seçin.'); return; }
    setBusy(true);
    try {
      await api.set({ principalType: ptype, principalId: id, tabs: allSelected ? 'all' : [...sel] });
      toast.success(`${id} için ${subject} erişimi kaydedildi (${allSelected ? 'tüm sekmeler' : sel.size + ' sekme'}).`);
      setPid(''); setSel(new Set());
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const remove = async (g: TabAccessGrant) => {
    if (!window.confirm(`${g.principalId} (${g.principalType === 'group' ? 'AD grubu' : 'kullanıcı'}) için ${subject} erişimi kaldırılsın mı?`)) return;
    try {
      await api.remove(g.principalType, g.principalId);
      toast.success('Erişim kaldırıldı.');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const edit = (g: TabAccessGrant) => { setPtype(g.principalType); setPid(g.principalId); setSel(new Set(g.tabs)); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const sorted = useMemo(() => [...grants].sort((a, b) => a.principalType.localeCompare(b.principalType) || a.principalId.localeCompare(b.principalId)), [grants]);
  const inputCls = 'px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-surface)]';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        </div>
        <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{intro}</p>
      </div>

      {/* Ekleme / düzenleme */}
      <div className="rounded-xl border px-4 py-3 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Kime</span>
            <select value={ptype} onChange={(e) => setPtype(e.target.value as 'user' | 'group')} className={inputCls}>
              <option value="user">Kullanıcı (kullanıcı adı)</option>
              <option value="group">LDAP grubu (CN ya da DN)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[16rem]">
            <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{ptype === 'user' ? 'Kullanıcı adı' : 'AD grubu'}</span>
            <input value={pid} onChange={(e) => setPid(e.target.value)} placeholder={ptype === 'user' ? 'örn. ademir' : 'örn. GT-Middleware  ya da  CN=GT-Middleware,OU=Groups,DC=fw,DC=garanti,DC=com,DC=tr'} className={inputCls} />
          </label>
        </div>
        <div>
          <div className="flex items-center gap-3 mb-1.5">
            <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Açılacak sekmeler</span>
            <button onClick={() => setSel(allSelected ? new Set() : new Set(tabs))} className="text-[11px] underline decoration-dotted" style={{ color: 'var(--accent)' }}>
              {allSelected ? 'hiçbiri' : 'tümü'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => (
              <label key={t} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer ${sel.has(t) ? 'font-semibold' : ''}`}
                style={{ borderColor: sel.has(t) ? 'var(--accent)' : 'var(--border-subtle)', background: sel.has(t) ? 'var(--bg-elevated)' : 'var(--bg-surface)', color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={sel.has(t)} onChange={() => toggle(t)} />
                {labels[t] || t}
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
            <PlusIcon className="w-3.5 h-3.5" /> {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Aynı kişi/grup için tekrar kaydetmek mevcut seçimi değiştirir.</span>
        </div>
      </div>

      {/* Mevcut grant'lar */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="px-4 py-2.5 border-b text-sm font-semibold" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
          Erişimi olanlar {grants.length ? `(${grants.length})` : ''}
        </div>
        {err && <div className="px-4 py-3 text-xs text-red-600">{err}</div>}
        {loading && !grants.length && <LoadingLogo compact />}
        {!loading && !grants.length && !err && (
          <div className="px-4 py-4 text-xs" style={{ color: 'var(--text-muted)' }}>{emptyText}</div>
        )}
        {sorted.length > 0 && (
          <table className="w-full text-[12px]">
            <thead style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Kim</th>
                <th className="text-left px-2 py-2 font-semibold">Tür</th>
                <th className="text-left px-2 py-2 font-semibold">Sekmeler</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((g) => (
                <tr key={g.principalType + g.principalId} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="px-4 py-2 font-mono" style={{ color: 'var(--text-primary)' }}>{g.principalId}</td>
                  <td className="px-2 py-2" style={{ color: 'var(--text-secondary)' }}>{g.principalType === 'group' ? 'AD grubu' : 'kullanıcı'}</td>
                  <td className="px-2 py-2">
                    {g.tabs.length === tabs.length ? (
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--status-success)' }}>tüm sekmeler</span>
                    ) : g.tabs.length === 0 ? (
                      <span className="text-[11px]" style={{ color: 'var(--status-warning)' }}>sayfa açık ama sekme seçilmemiş (hiçbir şey görmez)</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {g.tabs.map((t) => <span key={t} className="px-1.5 py-0.5 rounded border text-[10px]" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>{labels[t] || t}</span>)}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <button onClick={() => edit(g)} className="text-[11px] underline decoration-dotted mr-3" style={{ color: 'var(--accent)' }}>düzenle</button>
                    <button onClick={() => remove(g)} className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--status-danger)' }}><TrashIcon className="w-3.5 h-3.5" /> kaldır</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default TabAccessPanel;
