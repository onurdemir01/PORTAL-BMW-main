// src/components/admin/tabs/DenetimAccessTab.tsx — Admin > "Denetim Erişimi" (2026-09-17).
//
// Kullanici: Denetim sayfasi Admin disinda herkese KAPALI; istedigim sayfalari istedigim
// kisiye ya da LDAP grubuna buradan acabileyim. Motor: mevcut gorunurluk kurallari
// (portal_element_visibility) — 'Denetim' sayfasina allow + secilen 'tab:denetim:<id>'
// elementlerine allow. Grup kurali oturumdaki AD gruplarindan (memberOf) eslesir; tam DN
// ya da yalin CN adi girilebilir.
import React, { useMemo, useState } from 'react';
import { ShieldCheckIcon, TrashIcon, PlusIcon } from '@heroicons/react/24/outline';
import { denetimAccessApi, type DenetimAccessGrant } from '@/api/adminApi';
import { toast } from '@/hooks/useToast';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';

const TAB_LABELS: Record<string, string> = {
  nginx: 'Nginx SPA', nginxapi: 'Nginx API Envanteri', nginxenv: 'Nginx Envanteri', nginxaudit: 'Nginx Audit',
  ocp: 'OpenShift', init: 'Init Script', envanter: 'Envanter', degisim: 'Envanter Değişim', appenvs: 'JBoss/WAS', webapp: 'Web-App',
};

export default function DenetimAccessTab() {
  const [tabs, setTabs] = useState<string[]>([]);
  const [grants, setGrants] = useState<DenetimAccessGrant[]>([]);
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
      const r = await denetimAccessApi.list();
      setTabs(r.tabs);
      setGrants(r.grants);
      setErr('');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  // `useAsyncEffect`: efekt icinde dogrudan `load()` cagirmak
  // `react-hooks/set-state-in-effect` uyarisi uretiyordu (ESLint ozel hook'larin
  // ICINE bakmaz; erteleme hook'un kendisinde). Ayrica bilesen sokulduktan sonra
  // gelen cevap artik `setState` CAGIRMAZ.
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
      await denetimAccessApi.set({ principalType: ptype, principalId: id, tabs: allSelected ? 'all' : [...sel] });
      toast.success(`${id} için Denetim erişimi kaydedildi (${allSelected ? 'tüm sekmeler' : sel.size + ' sekme'}).`);
      setPid(''); setSel(new Set());
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const remove = async (g: DenetimAccessGrant) => {
    if (!window.confirm(`${g.principalId} (${g.principalType === 'group' ? 'AD grubu' : 'kullanıcı'}) için Denetim erişimi kaldırılsın mı?`)) return;
    try {
      await denetimAccessApi.remove(g.principalType, g.principalId);
      toast.success('Erişim kaldırıldı.');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const edit = (g: DenetimAccessGrant) => { setPtype(g.principalType); setPid(g.principalId); setSel(new Set(g.tabs)); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const sorted = useMemo(() => [...grants].sort((a, b) => a.principalType.localeCompare(b.principalType) || a.principalId.localeCompare(b.principalId)), [grants]);
  const inputCls = 'px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--bg-surface)]';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Denetim sayfası erişimi</h3>
        </div>
        <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Middleware İç Denetim sayfası <b>yalnız yöneticilere</b> açıktır. Buradan bir <b>kullanıcıya</b> ya da bir <b>LDAP (AD) grubuna</b> seçtiğiniz
          sekmeleri açabilirsiniz; kişi yalnız o sekmeleri görür, diğer sekmelerin verisi sunucu tarafında da kapalıdır (403).
          Grup için CN adı (örn. <code className="px-1 rounded bg-[var(--bg-elevated)]">GT-Middleware</code>) ya da tam DN girilebilir; eşleşme
          kullanıcının oturumundaki <code className="px-1 rounded bg-[var(--bg-elevated)]">memberOf</code> listesine göre yapılır. Değişiklik anında
          yayılır (açık oturumlar yeniden giriş yapmadan görür).
        </p>
      </div>

      {/* Ekleme / duzenleme */}
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
                {TAB_LABELS[t] || t}
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
        {loading && !grants.length && <div className="px-4 py-4 text-xs" style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
        {!loading && !grants.length && !err && (
          <div className="px-4 py-4 text-xs" style={{ color: 'var(--text-muted)' }}>Henüz kimseye açılmamış — Denetim sayfasını yalnız yöneticiler görüyor.</div>
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
                        {g.tabs.map((t) => <span key={t} className="px-1.5 py-0.5 rounded border text-[10px]" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>{TAB_LABELS[t] || t}</span>)}
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
