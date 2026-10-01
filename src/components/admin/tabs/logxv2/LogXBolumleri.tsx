// src/components/admin/tabs/logxv2/LogXBolumleri.tsx — LogX YÖNETİMİ'nin bölümleri.
//
// 2026-10-02: bunlar "OCP Yapılandırma" sekmesinin alt sekmeleriydi; o sekme LogX,
// OpsX, Telnet ve ScaleX'in ORTAK OCP ayarlarını taşıdığı için LogX'e özgü bölümler
// orada kayboluyordu. Artık Admin > LogX Yönetimi (LogXAdminTab) tek sayfasında.
import React, { useState } from 'react';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import {
  logxV2Api,
  type EnvSuffixRow,
  type PlaybookReadinessRow,
  type MaskRuleRow,
  type AdminRequestRow,
} from '@/api/logxV2Api';
import SimpleCrudTable, { type ColumnDef } from './SimpleCrudTable';
import { useCrudSection } from './useCrudSection';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { downloadCsv } from '@/utils/csv';
import { fmtDateTime } from '@/utils/datetime';

const ENVSUFFIX_COLUMNS: ColumnDef<EnvSuffixRow>[] = [
  { key: 'suffix', label: 'EAR Klasör Son-Eki', placeholder: '-T (boş = son-ek yok)' },
  { key: 'env_label', label: 'Ortam Etiketi', placeholder: 'TEST' },
  { key: 'sort_order', label: 'Sıra', type: 'number' },
  { key: 'is_active', label: 'Aktif', type: 'checkbox' },
];
const ENVSUFFIX_EMPTY: Partial<EnvSuffixRow> = {
  suffix: '',
  env_label: '',
  sort_order: 0,
  is_active: true,
};

// LEGACY ORTAM SON-EKİ: EAR klasör son-eki ("-T") → ortam etiketi ("TEST"). LogX'in
// Legacy ortam etiketleri (ve ortam kısıtları) buradan türetilir.
export const EnvSuffixSection: React.FC = () => {
  const envSuffix = useCrudSection(
    logxV2Api.admin.listEnvSuffixMap,
    logxV2Api.admin.createEnvSuffix,
    logxV2Api.admin.updateEnvSuffix,
    logxV2Api.admin.deleteEnvSuffix,
  );
  if (envSuffix.loading) return <LoadingLogo compact />;
  if (envSuffix.error)
    return <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">{envSuffix.error}</div>;
  return (
    <SimpleCrudTable
      columns={ENVSUFFIX_COLUMNS}
      rows={envSuffix.rows}
      emptyRow={ENVSUFFIX_EMPTY}
      onCreate={envSuffix.onCreate}
      onUpdate={envSuffix.onUpdate}
      onDelete={envSuffix.onDelete}
    />
  );
};

/**
 * MASKELEME KURALLARI.
 *
 * `logx_mask_rules` tablosu, sunucu CRUD'u ve `masker.reloadMaskRules()`
 * (her mutasyondan sonra cagriliyor, yani degisiklik ANINDA etkili) yazilmisti
 * — ama hicbir ekran bu dort ucu cagirmiyordu. Kural yazmanin portal icinde
 * bir yolu yoktu.
 *
 * ONEMLI SINIR: bu kurallar BUGUN yalnizca AI analiz yolunda uygulaniyor
 * (`server/logx/ai-analyzer.cjs`, `server/ai-analyst/portal-tools.cjs`).
 * Indirilen ARSIVE uygulanmiyor — ekran bunu acikca soyluyor ki admin
 * "maskeleme var" sanip yanlis bir guvence hissetmesin.
 */
export const MaskRulesSection: React.FC = () => {
  const [rows, setRows] = useState<MaskRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await logxV2Api.admin.listMaskRules();
      setRows(r.rows || []);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useAsyncEffect(async (alive) => {
    if (alive()) await load();
  }, [load]);

  const columns: ColumnDef<MaskRuleRow>[] = [
    { key: 'name', label: 'Ad', placeholder: 'tc_kimlik' },
    { key: 'pattern', label: 'Desen (RegExp)', placeholder: '\\b\\d{11}\\b', truncate: true },
    { key: 'flags', label: 'Bayrak', placeholder: 'g' },
    { key: 'replacement', label: 'Yerine', placeholder: '[TCKN]' },
    { key: 'sort_order', label: 'Sıra', type: 'number' },
    { key: 'enabled', label: 'Açık', type: 'checkbox' },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <strong>Bu kurallar bugün yalnızca AI analiz yolunda uygulanıyor.</strong> İndirilen
        arşive <em>uygulanmıyor</em> — yani buraya kural yazmak indirilen log dosyalarını
        maskelemez. Teslim yoluna bağlanması ayrı bir iş.
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Desen sunucuda <code>new RegExp(desen, bayrak)</code> ile <strong>derlenerek</strong>
        doğrulanır; derlenmeyen kural kaydedilmez. Kayıttan sonra maskeleyici önbelleği
        yeniden yüklenir — değişiklik <strong>anında</strong> etkilidir.
      </p>
      {err && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          {err}
        </div>
      )}
      {loading && !rows.length ? (
        <LoadingLogo compact />
      ) : (
        <SimpleCrudTable<MaskRuleRow>
          columns={columns}
          rows={rows}
          emptyRow={{ name: '', pattern: '', flags: 'g', replacement: '', sort_order: 0, enabled: true }}
          onCreate={async (d) => {
            await logxV2Api.admin.createMaskRule(d);
            await load();
          }}
          onUpdate={async (id, d) => {
            await logxV2Api.admin.updateMaskRule(id, d);
            await load();
          }}
          onDelete={async (id) => {
            await logxV2Api.admin.deleteMaskRule(id);
            await load();
          }}
        />
      )}
    </div>
  );
};

/** Sihirbazin takildigi yeri gosteren durumlar — bunlar "devam ediyor" demek. */
const SURUYOR = new Set([
  'discovering', 'namespace_discovering', 'app_discovering', 'transferring',
]);

/**
 * ISTEK IZLEME — `GET /admin/requests`.
 *
 * Uc ve istemci sarmalayicisi (`logxV2Api.admin.listRequests`) yazilmisti ama
 * HICBIR BILESEN cagirmiyordu: admin, hangi istegin hangi state'te takildigini
 * goremiyordu. LogX'in TEK gercegi `logx_v2_requests.state` oldugu icin bu,
 * "kullanici bekliyor ama neden" sorusunun tek cevap yeriydi.
 */
export const RequestsSection: React.FC = () => {
  const [rows, setRows] = useState<AdminRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState('');
  const [platform, setPlatform] = useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await logxV2Api.admin.listRequests({
        ...(state ? { state } : {}),
        ...(platform ? { platform } : {}),
      });
      setRows(r.requests || []);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [state, platform]);

  useAsyncEffect(async (alive) => {
    if (alive()) await load();
  }, [load]);

  const durumlar = React.useMemo(
    () => [...new Set(rows.map((r) => r.state).filter(Boolean))],
    [rows],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
        >
          <option value="">tüm platformlar</option>
          <option value="legacy">legacy</option>
          <option value="openshift">openshift</option>
        </select>
        <select
          value={state}
          onChange={(e) => setState(e.target.value)}
          className="px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
        >
          <option value="">tüm durumlar</option>
          {durumlar.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <button type="button" onClick={load} className="text-xs text-[var(--accent)] hover:underline">
          Yenile
        </button>
        <button
          type="button"
          disabled={!rows.length}
          onClick={() =>
            downloadCsv(
              'logx_istekler',
              ['İstek', 'Kullanıcı', 'Platform', 'Durum', 'Hata', 'Oluşturma', 'Güncelleme', 'Son kullanma'],
              rows.map((r) => [
                r.id, r.username, r.platform, r.state, r.errorMessage,
                r.createdAt, r.updatedAt, r.expiresAt,
              ]),
            )
          }
          className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
        >
          CSV
        </button>
        <span className="text-xs text-[var(--text-muted)]">{rows.length} kayıt</span>
      </div>

      {err && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          {err}
        </div>
      )}

      {loading && !rows.length ? (
        <LoadingLogo compact />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--text-muted)]">
                <th className="py-1.5 pr-3 font-medium">İstek</th>
                <th className="py-1.5 pr-3 font-medium">Kullanıcı</th>
                <th className="py-1.5 pr-3 font-medium">Platform</th>
                <th className="py-1.5 pr-3 font-medium">Durum</th>
                <th className="py-1.5 pr-3 font-medium">Güncelleme</th>
                <th className="py-1.5 font-medium">Not</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {!rows.length && (
                <TableEmptyRow
                  colSpan={6}
                  title={state || platform ? 'Süzgece uyan istek yok.' : 'Hiç LogX isteği yok.'}
                  description={
                    state || platform
                      ? 'Süzgeçleri gevşetin.'
                      : 'Bir kullanıcı LogX sihirbazını başlattığında burası dolar.'
                  }
                />
              )}
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-1.5 pr-3 font-mono text-[var(--text-muted)]">{r.id.slice(0, 8)}</td>
                  <td className="py-1.5 pr-3">{r.username}</td>
                  <td className="py-1.5 pr-3">{r.platform}</td>
                  <td className="py-1.5 pr-3">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        r.state === 'failed'
                          ? 'bg-red-100 text-red-800'
                          : r.state === 'ready'
                            ? 'bg-green-100 text-green-800'
                            : SURUYOR.has(r.state)
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {r.state}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-[var(--text-muted)]">
                    {fmtDateTime(r.updatedAt || r.createdAt)}
                  </td>
                  <td className="py-1.5 text-[var(--text-muted)]">{r.errorMessage || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// LogX'in kullandigi playbook kayitlarinin hazirlik durumu. Uretimde "Bu namespace'i tara"
// 503 dondu ve sebebi (template ID tanimsiz ya da AWX'te "Prompt on launch" KAPALI —
// bu durumda AWX gonderilen extra_vars'i sessizce yok sayar) hicbir ekranda gorunmuyordu.
export const PlaybookReadinessPanel: React.FC = () => {
  const [rows, setRows] = useState<PlaybookReadinessRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await logxV2Api.admin.getPlaybookReadiness();
      setRows(r.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useAsyncEffect(async () => {
    await load();
  }, []);

  const problems = (rows || []).filter(
    (r) => !r.templateId || r.foundOnAwx === false || r.promptOnLaunch === false || !r.enabled,
  );

  return (
    <div className="border border-[var(--border)] rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-[var(--text-secondary)]">Playbook hazırlık durumu</h4>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          {loading ? 'Kontrol ediliyor…' : 'Yenile'}
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {rows && problems.length === 0 && (
        <p className="text-xs text-emerald-700">Tüm LogX playbook kayıtları hazır.</p>
      )}
      {rows && problems.length > 0 && (
        <ul className="space-y-1.5">
          {problems.map((r) => (
            <li
              key={r.keyName}
              className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5"
            >
              <span className="font-mono font-medium">{r.keyName}</span>
              {' — '}
              {!r.enabled && 'kayıt devre dışı. '}
              {!r.templateId && 'AWX template ID tanımlı değil (Admin > Playbook Kayıtları). '}
              {r.foundOnAwx === false &&
                `Template ${r.templateId}, AWX ${r.awxServerId} üzerinde bulunamadı. `}
              {r.promptOnLaunch === false && (
                <>
                  AWX'te <strong>"Prompt on launch" (Variables) KAPALI</strong> — bu durumda AWX,
                  portalın gönderdiği değişkenleri sessizce yok sayar ve playbook boş girdiyle hata
                  verir. AWX &gt; Job Templates &gt; {r.templateName || r.templateId} &gt; Variables
                  bölümünde kutuyu işaretleyin.
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows && rows.some((r) => r.foundOnAwx === null && r.templateId) && (
        <p className="text-xs text-[var(--text-muted)]">
          Bazı template'lerin durumu AWX'ten okunamadı (ağ/yetki) — "kapalı" anlamına gelmez.
        </p>
      )}
    </div>
  );
};
