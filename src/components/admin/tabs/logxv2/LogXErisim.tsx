// src/components/admin/tabs/logxv2/LogXErisim.tsx — LogX YÖNETİMİ: ERİŞİM (L5, 2026-10-01).
//
// Tek bileşen, iki kullanıcı:
//   * Admin (Admin > LogX Yönetimi > Erişim): her kaynak, sahip atama, "neden reddedildi?"
//     açıklayıcısı, red günlüğü, ortam etiketleri ve altyapı teşhisi.
//   * Kaynak sahibi (LogX sayfası > "LogX Yönetimi"): YALNIZCA kendi kaynaklarının
//     kısıtı ve izinleri. Sunucu (`/manage/...` uçları) aynı sınırı ayrıca uygular.
//
// Model (kullanıcı kararı): her şey varsayılan olarak HERKESE AÇIK; kısıt eklenince
// yalnızca izinli kişi/gruplar (+ Admin) erişir. Ortam kuralı kaynak kuralıyla
// BİRLİKTE (AND) uygulanır.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  logxV2Api,
  type DenialRow,
  type ExplainResult,
  type ManagedResource,
} from '@/api/logxV2Api';
import { useToast } from '@/hooks/useToast';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtDateTime } from '@/utils/datetime';
import { LoadingLogo } from '@/components/common/LoadingLogo';

type Tip = 'legacy_app' | 'ocp_namespace' | 'env';
const TIP_ETIKET: Record<string, string> = {
  legacy_app: 'Legacy',
  ocp_namespace: 'OCP',
  ocp_app: 'OCP uygulama',
  env: 'Ortam',
};

const kisaGrup = (dn: string) => (/^\s*cn=([^,]+)/i.exec(dn)?.[1] || dn).trim();
const hataMetni = (e: unknown) => (e instanceof Error ? e.message : String(e));

// TEMA SINIFLARI (2026-10-02): diger admin sekmeleriyle ayni gorunum, koyu temada da
// okunur. Eskiden sabit gri/siyah Tailwind sinifliydi.
const inputCls = 'pf-input text-sm';
const btnCls = 'btn-secondary text-xs disabled:opacity-50';
const btnKoyu = 'btn-primary text-xs disabled:opacity-50';

// ── Tek kaynak kartı ─────────────────────────────────────────────────────────
const KaynakKarti: React.FC<{
  r: ManagedResource;
  isAdmin: boolean;
  yenile: () => Promise<void>;
}> = ({ r, isAdmin, yenile }) => {
  const { toast } = useToast();
  const [kullanici, setKullanici] = useState('');
  const [grup, setGrup] = useState('');
  const [sahip, setSahip] = useState('');
  const [mesgul, setMesgul] = useState(false);

  const yap = async (fn: () => Promise<unknown>, basari: string) => {
    setMesgul(true);
    try {
      await fn();
      toast.success(basari);
      await yenile();
    } catch (e) {
      toast.error(hataMetni(e));
    } finally {
      setMesgul(false);
    }
  };
  const k = r.restriction;

  return (
    <div className="border border-[var(--border)] rounded-xl p-3 space-y-2" data-testid="logx-kaynak">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
          {TIP_ETIKET[r.resourceType] || r.resourceType}
        </span>
        <span className="text-sm font-semibold text-[var(--text-primary)] font-mono">{r.resourceKey}</span>
        <span
          className={`text-xs px-1.5 py-0.5 rounded-full ${
            k ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700'
          }`}
        >
          {k ? 'Kısıtlı' : 'Herkese açık'}
        </span>
        <div className="ml-auto">
          {k ? (
            <button
              className={btnCls}
              disabled={mesgul}
              onClick={() =>
                yap(
                  () => logxV2Api.manage.unrestrict(k.id),
                  'Kısıtlama kaldırıldı — kaynak herkese açık.',
                )
              }
            >
              Kısıtlamayı kaldır
            </button>
          ) : (
            <button
              className={btnKoyu}
              disabled={mesgul}
              onClick={() =>
                yap(
                  () =>
                    logxV2Api.manage.restrict({
                      resourceType: r.resourceType,
                      resourceKey: r.resourceKey,
                    }),
                  'Kaynak kısıtlandı — şimdi izinli kişi/grup ekleyin.',
                )
              }
            >
              Kısıtla
            </button>
          )}
        </div>
      </div>

      {k && (
        <div className="space-y-1.5">
          <p className="text-xs text-[var(--text-muted)]">
            İzinliler{' '}
            {k.grants.length + k.groupGrants.length === 0 && (
              <strong className="text-amber-700">— henüz kimse yok (yalnızca Admin erişir)</strong>
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {k.grants.map((u) => (
              <span key={`u-${u}`} className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-elevated)]">
                {u}
                <button
                  aria-label={`${u} iznini kaldır`}
                  className="ml-1 text-[var(--text-muted)] hover:text-[var(--status-danger)]"
                  disabled={mesgul}
                  onClick={() =>
                    yap(() => logxV2Api.manage.removeGrant(k.id, u), 'İzin kaldırıldı.')
                  }
                >
                  ×
                </button>
              </span>
            ))}
            {k.groupGrants.map((g) => (
              <span
                key={`g-${g}`}
                title={g}
                className="text-xs px-2 py-0.5 rounded-full bg-blue-50"
              >
                grup {kisaGrup(g)}
                <button
                  aria-label={`${kisaGrup(g)} grup iznini kaldır`}
                  className="ml-1 text-[var(--text-muted)] hover:text-[var(--status-danger)]"
                  disabled={mesgul}
                  onClick={() =>
                    yap(() => logxV2Api.manage.removeGroupGrant(k.id, g), 'Grup izni kaldırıldı.')
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex gap-1">
              <input
                className={`${inputCls} flex-1`}
                placeholder="kullanıcı adı"
                value={kullanici}
                onChange={(e) => setKullanici(e.target.value)}
              />
              <button
                className={btnCls}
                disabled={mesgul || !kullanici.trim()}
                onClick={() =>
                  yap(async () => {
                    await logxV2Api.manage.addGrant(k.id, kullanici.trim());
                    setKullanici('');
                  }, 'Kullanıcı izni eklendi.')
                }
              >
                Kişi ekle
              </button>
            </div>
            <div className="flex gap-1">
              <input
                className={`${inputCls} flex-1`}
                placeholder="AD grup DN (CN=...,OU=...)"
                value={grup}
                onChange={(e) => setGrup(e.target.value)}
              />
              <button
                className={btnCls}
                disabled={mesgul || !grup.trim()}
                onClick={() =>
                  yap(async () => {
                    await logxV2Api.manage.addGroupGrant(k.id, grup.trim());
                    setGrup('');
                  }, 'Grup izni eklendi.')
                }
              >
                Grup ekle
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1.5 border-t border-[var(--border)] pt-2">
        <p className="text-xs text-[var(--text-muted)]">
          Kaynak sahipleri{' '}
          {r.owners.length === 0 && (
            <span className="text-[var(--text-muted)]">— yok (yalnızca Admin yönetir)</span>
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {r.owners.map((o) => (
            <span
              key={o.id}
              title={o.principal}
              className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-800"
            >
              {o.principalType === 'group' ? `grup ${kisaGrup(o.principal)}` : o.principal}
              {isAdmin && (
                <button
                  aria-label="sahibi kaldır"
                  className="ml-1 text-[var(--text-muted)] hover:text-[var(--status-danger)]"
                  disabled={mesgul}
                  onClick={() => yap(() => logxV2Api.manage.removeOwner(o.id), 'Sahip kaldırıldı.')}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        {isAdmin && (
          <div className="flex gap-1">
            <input
              className={`${inputCls} flex-1`}
              placeholder="sahip: kullanıcı adı ya da grup DN (CN=...)"
              value={sahip}
              onChange={(e) => setSahip(e.target.value)}
            />
            <button
              className={btnCls}
              disabled={mesgul || !sahip.trim()}
              onClick={() =>
                yap(async () => {
                  const v = sahip.trim();
                  await logxV2Api.manage.addOwner({
                    resourceType: r.resourceType,
                    resourceKey: r.resourceKey,
                    ...(/^cn=/i.test(v) ? { groupDn: v } : { username: v }),
                  });
                  setSahip('');
                }, 'Sahip atandı.')
              }
            >
              Sahip ata
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Yeni kaynak seçici (yalnızca Admin) ──────────────────────────────────────
const YeniKaynak: React.FC<{ yenile: () => Promise<void> }> = ({ yenile }) => {
  const { toast } = useToast();
  const [tip, setTip] = useState<Tip>('env');
  const [anahtar, setAnahtar] = useState('');
  // Tipe ÖZGÜ öneri listeleri: tip değişince temizlemek gerekmez (efektte senkron
  // setState yok), görünen liste zaten seçili tipe ait olandır.
  const [legacyOneri, setLegacyOneri] = useState<string[]>([]);
  const [nsOneri, setNsOneri] = useState<string[]>([]);
  const [etiketler, setEtiketler] = useState<{ label: string; sources: string[] }[]>([]);
  const [agac, setAgac] = useState<Record<string, Record<string, string[]>>>({});
  const [ocp, setOcp] = useState({ env: '', tenant: '', cluster: '', ns: '' });
  const [mesgul, setMesgul] = useState(false);

  useEffect(() => {
    logxV2Api.manage
      .envLabels()
      .then((r) => setEtiketler(r.labels || []))
      .catch(() => setEtiketler([]));
    logxV2Api
      .getClusterTree()
      .then((r) => setAgac(r.tree || {}))
      .catch(() => setAgac({}));
  }, []);

  // Legacy: uygulama adı arama (envanterden), elle giriş de serbest.
  useEffect(() => {
    if (tip !== 'legacy_app' || anahtar.trim().length < 2) return;
    let iptal = false;
    const t = setTimeout(() => {
      logxV2Api
        .searchLegacyApps(anahtar.trim())
        .then((r) => !iptal && setLegacyOneri((r.apps || []).slice(0, 8)))
        .catch(() => !iptal && setLegacyOneri([]));
    }, 250);
    return () => {
      iptal = true;
      clearTimeout(t);
    };
  }, [tip, anahtar]);

  // OCP: namespace önerileri seçilen cluster'ın envanterinden.
  useAsyncEffect(
    async (alive) => {
      if (tip !== 'ocp_namespace' || !ocp.env || !ocp.tenant || !ocp.cluster) return;
      const r = await logxV2Api
        .inventoryNamespaces(ocp.env, ocp.tenant, [ocp.cluster])
        .catch(() => null);
      if (alive()) setNsOneri(r?.items || []);
    },
    [tip, ocp.env, ocp.tenant, ocp.cluster],
  );

  const sonAnahtar =
    tip === 'ocp_namespace'
      ? ocp.env && ocp.tenant && ocp.cluster && ocp.ns
        ? `${ocp.tenant}/${ocp.env}/${ocp.cluster}/${ocp.ns}`
        : ''
      : anahtar.trim();

  const kisitla = async () => {
    setMesgul(true);
    try {
      await logxV2Api.manage.restrict({ resourceType: tip, resourceKey: sonAnahtar });
      toast.success(`${sonAnahtar} kısıtlandı — izinli kişi/grup ekleyin.`);
      setAnahtar('');
      setOcp((o) => ({ ...o, ns: '' }));
      await yenile();
    } catch (e) {
      toast.error(hataMetni(e));
    } finally {
      setMesgul(false);
    }
  };

  const tekKaynakli = etiketler.filter((e) => e.sources.length === 1);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 space-y-3">
      <p className="text-sm font-medium text-[var(--text-primary)]">Kaynak kısıtla</p>
      <div className="flex gap-2 flex-wrap items-center">
        <select
          aria-label="kaynak tipi"
          className={inputCls}
          value={tip}
          onChange={(e) => {
            setTip(e.target.value as Tip);
            setAnahtar('');
          }}
        >
          <option value="env">Ortam (Legacy + OCP)</option>
          <option value="ocp_namespace">OCP namespace</option>
          <option value="legacy_app">Legacy uygulama</option>
        </select>

        {tip === 'env' && (
          <select
            aria-label="ortam"
            className={inputCls}
            value={anahtar}
            onChange={(e) => setAnahtar(e.target.value)}
          >
            <option value="">ortam seçin…</option>
            {etiketler.map((e) => (
              <option key={e.label} value={e.label}>
                {e.label} ({e.sources.join(' + ')})
              </option>
            ))}
          </select>
        )}

        {tip === 'legacy_app' && (
          <div className="relative">
            <input
              className={inputCls}
              placeholder="uygulama adı (ör. GBCEPPOSDASHBOARD)"
              value={anahtar}
              onChange={(e) => setAnahtar(e.target.value)}
              list="logx-erisim-legacy"
            />
            <datalist id="logx-erisim-legacy">
              {legacyOneri.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
        )}

        {tip === 'ocp_namespace' && (
          <>
            <select
              aria-label="ocp ortam"
              className={inputCls}
              value={ocp.env}
              onChange={(e) => setOcp({ env: e.target.value, tenant: '', cluster: '', ns: '' })}
            >
              <option value="">ortam…</option>
              {Object.keys(agac).map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
            <select
              aria-label="ocp tenant"
              className={inputCls}
              value={ocp.tenant}
              onChange={(e) =>
                setOcp((o) => ({ ...o, tenant: e.target.value, cluster: '', ns: '' }))
              }
            >
              <option value="">tenant…</option>
              {Object.keys(agac[ocp.env] || {}).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select
              aria-label="ocp cluster"
              className={inputCls}
              value={ocp.cluster}
              onChange={(e) => setOcp((o) => ({ ...o, cluster: e.target.value, ns: '' }))}
            >
              <option value="">cluster…</option>
              {(agac[ocp.env]?.[ocp.tenant] || []).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              className={inputCls}
              placeholder="namespace"
              value={ocp.ns}
              onChange={(e) => setOcp((o) => ({ ...o, ns: e.target.value }))}
              list="logx-erisim-ns"
            />
            <datalist id="logx-erisim-ns">
              {nsOneri.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </>
        )}

        <button className={btnKoyu} disabled={mesgul || !sonAnahtar} onClick={kisitla}>
          Kısıtla
        </button>
      </div>
      {tip === 'env' && tekKaynakli.length > 0 && (
        <p className="text-xs text-amber-800" data-testid="logx-tek-kaynakli-ortam">
          Yalnızca tek kaynakta görünen etiketler var (
          {tekKaynakli.map((e) => `${e.label}: ${e.sources[0]}`).join(', ')}). OCP ve Legacy aynı
          ortamı farklı yazıyorsa her iki yazımı da kısıtlayın.
        </p>
      )}
      <p className="text-xs text-[var(--text-muted)]">
        Kaynağa sahip atamak için önce kısıtlayın ya da listedeki kartından &quot;Sahip ata&quot;yı
        kullanın.
      </p>
    </div>
  );
};

// ── "Neden reddedildi?" (yalnızca Admin) ─────────────────────────────────────
const Aciklayici: React.FC = () => {
  const [q, setQ] = useState({ username: '', resourceType: 'ocp_namespace', resourceKey: '' });
  const [sonuc, setSonuc] = useState<ExplainResult | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [mesgul, setMesgul] = useState(false);
  const sor = async () => {
    setMesgul(true);
    setHata(null);
    try {
      setSonuc(await logxV2Api.manage.explain(q));
    } catch (e) {
      setHata(hataMetni(e));
      setSonuc(null);
    } finally {
      setMesgul(false);
    }
  };
  return (
    <div className="border border-[var(--border)] rounded-xl p-4 space-y-3">
      <p className="text-sm font-medium text-[var(--text-primary)]">Neden reddedildi?</p>
      <div className="flex gap-2 flex-wrap">
        <input
          className={inputCls}
          placeholder="kullanıcı adı"
          value={q.username}
          onChange={(e) => setQ({ ...q, username: e.target.value })}
        />
        <select
          aria-label="açıklayıcı tip"
          className={inputCls}
          value={q.resourceType}
          onChange={(e) => setQ({ ...q, resourceType: e.target.value })}
        >
          <option value="ocp_namespace">OCP namespace</option>
          <option value="legacy_app">Legacy uygulama</option>
          <option value="env">Ortam</option>
        </select>
        <input
          className={`${inputCls} flex-1 min-w-[16rem]`}
          placeholder={
            q.resourceType === 'ocp_namespace'
              ? 'tenant/env/cluster/namespace'
              : q.resourceType === 'env'
                ? 'PROD'
                : 'uygulama adı'
          }
          value={q.resourceKey}
          onChange={(e) => setQ({ ...q, resourceKey: e.target.value })}
        />
        <button className={btnKoyu} disabled={mesgul || !q.username.trim()} onClick={sor}>
          Sına
        </button>
      </div>
      {hata && <p className="text-xs text-red-700">{hata}</p>}
      {sonuc && (
        <div className="space-y-1.5" data-testid="logx-aciklama">
          {sonuc.kimlikUyarisi && (
            <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-2 py-1">
              {sonuc.kimlikUyarisi}
            </p>
          )}
          <p className="text-xs text-[var(--text-muted)]">
            {sonuc.kullanici.username} — {sonuc.kullanici.grupSayisi} AD grubu
            {sonuc.kimlikKaynagi ? ' (LDAP)' : ''}
          </p>
          <ol className="space-y-1">
            {sonuc.adimlar.map((a, i) => (
              <li key={i} className="text-xs flex gap-2">
                <span
                  className={
                    a.izin === false
                      ? 'text-red-700'
                      : a.izin === null
                        ? 'text-amber-700'
                        : 'text-green-700'
                  }
                >
                  {a.izin === false ? '✗' : a.izin === null ? '?' : '✓'}
                </span>
                <span>
                  <strong>{a.ad}:</strong> {a.aciklama}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-sm font-medium">
            Sonuç: {sonuc.sonuc === 'izin' ? 'erişebilir' : 'reddedilir'}
          </p>
        </div>
      )}
    </div>
  );
};

// ── Red günlüğü (yalnızca Admin) ─────────────────────────────────────────────
const RedGunlugu: React.FC = () => {
  const [satirlar, setSatirlar] = useState<DenialRow[]>([]);
  const [kullanici, setKullanici] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const yukle = useCallback(async () => {
    try {
      setHata(null);
      setSatirlar((await logxV2Api.manage.denials(kullanici.trim() || undefined)).denials || []);
    } catch (e) {
      setHata(hataMetni(e));
    }
  }, [kullanici]);
  // Yalnızca ilk açılışta; süzgeç "Yenile" ile uygulanır.
  useAsyncEffect(async (alive) => {
    if (alive()) await yukle();
  }, []);
  return (
    <div className="border border-[var(--border)] rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-[var(--text-primary)]">Red günlüğü</p>
        <input
          className={`${inputCls} ml-auto`}
          placeholder="kullanıcıya göre süz"
          value={kullanici}
          onChange={(e) => setKullanici(e.target.value)}
        />
        <button className={btnCls} onClick={() => void yukle()}>
          Yenile
        </button>
      </div>
      {hata && <p className="text-xs text-red-700">{hata}</p>}
      {satirlar.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">Kayıtlı red yok.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--text-muted)]">
              <th className="py-1 pr-2 font-medium">Zaman</th>
              <th className="py-1 pr-2 font-medium">Kullanıcı</th>
              <th className="py-1 pr-2 font-medium">Kaynak</th>
              <th className="py-1 pr-2 font-medium">Uç</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {satirlar.map((d) => (
              <tr key={d.id}>
                <td className="py-1 pr-2 whitespace-nowrap text-[var(--text-muted)]">{fmtDateTime(d.at)}</td>
                <td className="py-1 pr-2">{d.username}</td>
                <td className="py-1 pr-2 font-mono">
                  {d.resourceType ? `${TIP_ETIKET[d.resourceType] || d.resourceType}: ` : ''}
                  {d.resourceKey || '—'}
                </td>
                <td className="py-1 pr-2 font-mono text-[var(--text-muted)]">{d.route || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ── Altyapı teşhisi (yalnızca Admin, salt okunur) ────────────────────────────
const Altyapi: React.FC = () => {
  const [rows, setRows] = useState<
    {
      env: string;
      tenant: string;
      cluster: string;
      active: boolean;
      eksik: string[];
      notlar: string[];
    }[]
  >([]);
  useEffect(() => {
    logxV2Api.manage
      .infra()
      .then((r) => setRows(r.clusters || []))
      .catch(() => setRows([]));
  }, []);
  const sorunlu = rows.filter((r) => r.active && r.eksik.length);
  return (
    <div className="border border-[var(--border)] rounded-xl p-4 space-y-2">
      <p className="text-sm font-medium text-[var(--text-primary)]">Kural dışı sebepler (altyapı)</p>
      <p className="text-xs text-[var(--text-muted)]">
        Kural izin verdiği hâlde prod&apos;da hata alınıyorsa sebep çoğunlukla altyapıdadır:
        OCP&apos;de servis hesabının <code>projects</code> list ve <code>pods/log</code> get yetkisi
        (cluster başına; bkz. docs/OCP-YETKILERI.yaml), Legacy&apos;de <code>dzdo</code> ile{' '}
        <code>was</code> olabilme ve dump dizini, ve prod host&apos;unun AWX envanterinde olması.
      </p>
      {sorunlu.length === 0 ? (
        <p className="text-xs text-green-700">Aktif cluster&apos;larda kimlik alanı eksiği yok.</p>
      ) : (
        <ul className="text-xs space-y-0.5" data-testid="logx-altyapi-eksik">
          {sorunlu.map((r) => (
            <li key={`${r.env}/${r.tenant}/${r.cluster}`}>
              <span className="font-mono">
                {r.env}/{r.tenant}/{r.cluster}
              </span>
              : eksik {r.eksik.join(', ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── Ana bileşen ──────────────────────────────────────────────────────────────
const LogXErisim: React.FC = () => {
  const [kaynaklar, setKaynaklar] = useState<ManagedResource[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [suzgec, setSuzgec] = useState('');

  const yenile = useCallback(async () => {
    try {
      setHata(null);
      const r = await logxV2Api.manage.resources();
      setKaynaklar(r.resources || []);
      setIsAdmin(!!r.isAdmin);
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setYukleniyor(false);
    }
  }, []);
  useAsyncEffect(
    async (alive) => {
      if (alive()) await yenile();
    },
    [yenile],
  );

  const gorunen = useMemo(() => {
    const s = suzgec.trim().toLowerCase();
    return s ? kaynaklar.filter((k) => k.resourceKey.toLowerCase().includes(s)) : kaynaklar;
  }, [kaynaklar, suzgec]);

  if (yukleniyor) return <LoadingLogo compact />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-muted)]">
        Varsayılan olarak her şey <strong>herkese açık</strong>. Kısıtlanan kaynağa yalnızca izinli
        kişi/gruplar ve Admin erişir; ortam kuralı kaynak kuralıyla <strong>birlikte</strong>{' '}
        uygulanır.
        {!isAdmin && ' Burada yalnızca sahibi olduğunuz kaynakları görüyorsunuz.'}
      </p>
      {hata && <p className="text-xs text-red-700">{hata}</p>}
      {isAdmin && <YeniKaynak yenile={yenile} />}
      <div className="space-y-2">
        <input
          className={`${inputCls} w-full`}
          placeholder="kaynaklarda ara"
          aria-label="Kaynaklarda ara"
          value={suzgec}
          onChange={(e) => setSuzgec(e.target.value)}
        />
        {gorunen.length === 0 && (
          <p className="text-sm text-[var(--text-muted)] text-center py-4">
            {/* Arama varsa "eşleşen yok" — "her şey herkese açık" demek yanlış olurdu. */}
            {suzgec.trim()
              ? 'Aramayla eşleşen kaynak yok.'
              : isAdmin
                ? 'Hiç kısıtlama ya da sahip yok — her şey herkese açık.'
                : 'Sahibi olduğunuz bir kaynak yok.'}
          </p>
        )}
        {gorunen.map((r) => (
          <KaynakKarti
            key={`${r.resourceType}:${r.resourceKey}`}
            r={r}
            isAdmin={isAdmin}
            yenile={yenile}
          />
        ))}
      </div>
      {isAdmin && (
        <>
          <Aciklayici />
          <RedGunlugu />
          <Altyapi />
        </>
      )}
    </div>
  );
};

export default LogXErisim;
