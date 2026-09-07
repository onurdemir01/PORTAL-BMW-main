// src/components/admin/tabs/InventoryGapsTab.tsx — ENVANTER BOŞLUKLARI.
//
// NEDEN VAR: LogX legacy'de envanterde olmayan bir uygulama/sunucu ELLE girilebiliyor
// ve iş çalışıyor — ama o ad envantere YAZILMIYOR (karar: oraya yalnızca düzenli
// tarama yazar). Doğru bir karar, ama DÖNGÜYÜ AÇIK bırakıyordu: elle girilen ad
// denetim kaydına yazılıp orada kalıyordu. Hangi adların hâlâ envantere girmediğini
// kimse bilmiyordu; aynı adı her hafta yeniden yazan bir kullanıcı sessizce yeniden
// yazmaya devam ediyordu.
//
// Bu ekran o kayıtları listeye çevirir ve her ad için ŞİMDİKİ durumu canlı sorar.
//
// ÜÇ HAL, İKİ DEĞİL. `kontrol_edilemedi` bir eksiklik değil, BİLİNMEZLİKTİR ve ayrı
// gösterilir: envanter okunamadığında bir adı "hâlâ yok" diye kırmızıya boyamak,
// bakan kişiyi ZATEN VAR OLAN bir kaydı ikinci kez açmaya yöneltirdi.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  MagnifyingGlassIcon,
  ServerStackIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';
import { logxV2Api, type InventoryGapRow, type InventoryGapStatus } from '@/api/logxV2Api';
import EmptyState from '@/components/common/EmptyState';
import { toast } from '@/hooks/useToast';
// Ham tarih bicimlendirme YOK: bicim tek bir yerden gelir (bekci G19),
// yoksa ayni tarih ekrandan ekrana farkli gorunur.
import { fmtDate, EMPTY_MARK } from '@/utils/datetime';

const STATUS_META: Record<InventoryGapStatus, { label: string; cls: string; hint: string }> = {
  hala_yok: {
    label: 'hâlâ yok',
    cls: 'border-[var(--status-danger)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]',
    hint: 'Envanter okundu, bu ad orada yok — gerçek boşluk.',
  },
  envantere_girdi: {
    label: 'envantere girdi',
    cls: 'border-[var(--status-success)] bg-[var(--status-success-bg)] text-[var(--status-success)]',
    hint: 'Tarama bu adı eklemiş; döngü kapandı.',
  },
  kontrol_edilemedi: {
    label: 'kontrol edilemedi',
    cls: 'border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-muted)]',
    hint: 'Envanter şu an okunamadı. Bu ad eksik OLMAYABİLİR — bilinmiyor.',
  },
};

function gunFarki(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

export default function InventoryGapsTab() {
  const [rows, setRows] = useState<InventoryGapRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const r = await logxV2Api.admin.inventoryGaps();
      setRows(r.rows || []);
    } catch {
      setRows(null);
      toast.error('Envanter boşlukları okunamadı.');
    } finally {
      setLoading(false);
    }
  }

  // ILK YUKLEME EFFECT ICINDE SENKRON setState YAPMAZ.
  //
  // `reload()` ilk isi olarak `setLoading(true)` cagiriyor; onu dogrudan effect
  // govdesinde cagirmak `react-hooks/set-state-in-effect` uyarisi uretiyordu ve bu
  // depoda uyari sayisi CIRCIRLA sabitlenmis (yeni kod uyari EKLEYEMEZ). `loading`
  // zaten `true` basliyor, yani ilk yuklemede o cagriya gerek de yok.
  //
  // `alive` bayragi ayri bir kazanc: sekme yanit gelmeden kapanirsa cozulmus
  // istegin sonucu artik olmayan bir bilesene yazilmaz.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await logxV2Api.admin.inventoryGaps();
        if (alive) setRows(r.rows || []);
      } catch {
        if (alive) {
          setRows(null);
          toast.error('Envanter boşlukları okunamadı.');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // SAYAÇLAR SÜZGEÇTEN BAĞIMSIZ: süzgeç açıkken "3 eksik" yazması, süzgecin
  // gizlediklerini yok saymak olurdu.
  const sayac = useMemo(() => {
    const c = { hala_yok: 0, envantere_girdi: 0, kontrol_edilemedi: 0 };
    for (const r of rows || []) c[r.status]++;
    return c;
  }, [rows]);

  const gorunen = useMemo(() => {
    const term = q.trim().toUpperCase();
    return (rows || []).filter((r) => {
      if (onlyMissing && r.status !== 'hala_yok') return false;
      if (!term) return true;
      return r.name.includes(term) || r.app.includes(term);
    });
  }, [rows, q, onlyMissing]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-[var(--text-primary)]">Envanter Boşlukları</h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          LogX'te <strong>elle girilmiş</strong> (envanterde bulunamayan) uygulama ve sunucu adları.
          Portal bu adları envantere <strong>yazmaz</strong> — oraya düzenli tarama yazar. Bu liste,
          hangi adların hâlâ eklenmediğini gösterir.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(STATUS_META) as InventoryGapStatus[]).map((s) => (
          <span
            key={s}
            title={STATUS_META[s].hint}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${STATUS_META[s].cls}`}
          >
            <span className="font-semibold">{sayac[s]}</span>
            <span>{STATUS_META[s].label}</span>
          </span>
        ))}
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="btn-secondary ml-auto text-sm inline-flex items-center gap-1.5"
        >
          <ArrowPathIcon
            aria-hidden="true"
            className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
          />
          Yenile
        </button>
      </div>

      {sayac.kontrol_edilemedi > 0 && (
        <p className="rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)] p-3 text-xs text-[var(--text-muted)]">
          <QuestionMarkCircleIcon
            aria-hidden="true"
            className="mr-1 inline w-4 h-4 align-text-bottom"
          />
          {sayac.kontrol_edilemedi} ad için envanter <strong>okunamadı</strong>. Bu adlar eksik
          olmayabilir — durumları bilinmiyor, eksik sayılmadılar.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ad veya uygulama ara..."
            aria-label="Envanter boşluklarında ara"
            className="pf-input w-full pl-9 text-sm"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={onlyMissing}
            onChange={(e) => setOnlyMissing(e.target.checked)}
          />
          Yalnızca hâlâ eksik olanlar
        </label>
      </div>

      {loading && <p className="text-sm text-[var(--text-muted)]">Yükleniyor…</p>}

      {!loading && rows !== null && rows.length === 0 && (
        <EmptyState
          icon={<ServerStackIcon aria-hidden="true" className="w-8 h-8" />}
          title="Elle girilmiş ad yok"
          description="LogX'te envanter dışına çıkan bir uygulama ya da sunucu adı kullanılmamış."
        />
      )}

      {!loading && rows !== null && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-2)] text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2">Ad</th>
                <th className="px-3 py-2">Tür</th>
                <th className="px-3 py-2">Uygulama</th>
                <th className="px-3 py-2">Durum</th>
                <th className="px-3 py-2">Kullanım</th>
                <th className="px-3 py-2">İlk görülme</th>
                <th className="px-3 py-2">Son görülme</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {gorunen.map((r) => {
                const yas = gunFarki(r.firstSeen);
                return (
                  <tr key={`${r.kind}:${r.app}:${r.name}`} className="hover:bg-[var(--surface-2)]">
                    <td className="px-3 py-2 font-mono">{r.name}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {r.kind === 'app' ? 'uygulama' : 'sunucu'}
                    </td>
                    <td className="px-3 py-2 font-mono text-[var(--text-muted)]">
                      {r.kind === 'app' ? EMPTY_MARK : r.app}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        title={STATUS_META[r.status].hint}
                        className={`inline-block rounded-lg border px-2 py-0.5 text-xs ${STATUS_META[r.status].cls}`}
                      >
                        {STATUS_META[r.status].label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {r.count} kez · {r.userCount} kişi
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {r.firstSeen ? fmtDate(r.firstSeen) : EMPTY_MARK}
                      {r.status === 'hala_yok' && yas !== null && yas > 0 && (
                        <span className="ml-1 text-xs">({yas} gündür)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {r.lastSeen ? fmtDate(r.lastSeen) : EMPTY_MARK}
                    </td>
                  </tr>
                );
              })}
              {gorunen.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-sm text-[var(--text-muted)]"
                  >
                    Süzgece uyan kayıt yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
