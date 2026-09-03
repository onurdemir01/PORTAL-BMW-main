// src/components/opsx/steps/HostSelectStep.tsx — seçilen uygulamanın bulunduğu
// sunucular arasından çoklu seçim.
//
// NOT: burada seçilen liste sunucuya gönderilse de backend onu OLDUĞU GİBİ KABUL
// ETMEZ — envanterden yeniden çözüp yalnızca gerçekten bu uygulamaya ait olan
// host'ları geçirir (anti-TOCTOU, bkz. server/opsx/index.cjs). Yani bu ekran bir
// kolaylık katmanıdır, güvenlik sınırı değil.
//
// ── AYNI SUNUCUDA İKİ JBOSS OLABİLİR ─────────────────────────────────────────
// Envanter aynı host için hem JBoss 7 hem JBoss 8 satırı döndürebiliyor. Kullanıcı
// önceki adımda iki majörü birden seçtiyse o host burada İKİ KEZ listelenir. Satır
// kimliği eskiden yalnızca host adıydı; iki satır tek onay kutusu durumunu paylaşıyor,
// birini işaretleyince diğeri de işaretleniyordu ve ikisi görsel olarak aynıydı.
// Kimlik artık `(host, majör)` çifti ve her satır JBoss rozetiyle geliyor.
//
// SEÇİLEN MAJÖRLER SUNUCUYA AYRICA GİDER: backend eskiden majörü envanterden
// TÜRETİYORDU (`versionByHost` Map'i host adıyla anahtarlı) — çift kurulumlu bir
// host'ta ikinci satır birincisini eziyor ve türetilen majör keyfi oluyordu. Artık
// kullanıcının fiilen işaretlediği majörler gönderiliyor.
import React, { useEffect, useMemo, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { opsxApi, type OpsxHost } from "@/api/opsxApi";
import { hostKey, majorOfHost, normalizeJbossVersion, parseHostKey } from "@/utils/jboss";
import JbossTag from "@/components/common/JbossTag";

const HostSelectStep: React.FC<{
  app: string;
  jbossVersions: string[];
  busy?: boolean;
  onSubmit: (v: { hosts: string[]; hostMajors: string[] }) => void;
}> = ({ app, jbossVersions, busy, onSubmit }) => {
  const [hosts, setHosts] = useState<OpsxHost[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    opsxApi.getHosts(app)
      .then((r) => setHosts(r.hosts))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [app]);

  // Bir önceki adımda seçilen JBoss MAJÖR sürümlerine (birden fazla olabilir) göre
  // daralt — tam sürüm string'i değil (bkz. JbossVersionStep.tsx dosya başı notu):
  // aynı majörde farklı minör sürümler ("8.0.7" / "8.1.2") aynı seçenek altında toplanır,
  // yoksa biri işaretlenip diğeri seçilmeden o host'lar listeden hiç görünmezdi.
  const filteredHosts = useMemo(() => {
    const wanted = new Set(jbossVersions);
    return hosts.filter((h) => wanted.has(majorOfHost(h)));
  }, [hosts, jbossVersions]);

  // Ortama göre grupla — kullanıcı prod/test sunucusunu ayırt edebilsin.
  const grouped = useMemo(() => {
    const g: Record<string, OpsxHost[]> = {};
    for (const h of filteredHosts) {
      const key = h.env || "(ortam belirtilmemiş)";
      (g[key] ||= []).push(h);
    }
    return g;
  }, [filteredHosts]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleAllIn(envKey: string) {
    const keys = grouped[envKey].map((h) => hostKey(h.host, majorOfHost(h)));
    const allSelected = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (allSelected) next.delete(k); else next.add(k);
      }
      return next;
    });
  }

  // Sunucuya iki ayri liste gider: BENZERSIZ host adlari (playbook'un `limit` hedefi)
  // ve kullanicinin fiilen isaretledigi MAJORLER (backend `jboss_version`'i bundan
  // turetir — bkz. dosya basi notu).
  const submission = useMemo(() => {
    const pairs = [...selected].map(parseHostKey);
    return {
      hosts: [...new Set(pairs.map((p) => p.host))],
      hostMajors: [...new Set(pairs.map((p) => p.jbossMajor).filter(Boolean))].sort(),
    };
  }, [selected]);

  if (loading) return <div className="py-8 text-center text-sm text-[var(--text-muted)]">Sunucular yükleniyor...</div>;
  if (error) return <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">{error}</div>;

  if (filteredHosts.length === 0) {
    return (
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
        <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          <strong>{app}</strong> için seçilen JBoss sürümünde ({jbossVersions.map((v) => v ? `JBoss ${v}` : "Bilinmiyor").join(", ")}) sunucu bulunamadı.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-[var(--text-secondary)]">Lütfen işlem yapılması istenen sunucuları seçin</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Uygulama: <span className="font-mono text-[var(--text-primary)]">{app}</span>
        </p>
      </div>

      <div className="space-y-3 max-h-80 overflow-y-auto">
        {Object.keys(grouped).sort().map((envKey) => (
          <div key={envKey}>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">{envKey}</label>
              <button
                onClick={() => toggleAllIn(envKey)}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                {grouped[envKey].every((h) => selected.has(hostKey(h.host, majorOfHost(h))))
                  ? "Seçimi kaldır" : "Tümünü seç"}
              </button>
            </div>
            <div className="space-y-1 border border-[var(--border)] rounded-xl p-1.5">
              {grouped[envKey].map((h) => {
                const major = majorOfHost(h);
                const key = hostKey(h.host, major);
                return (
                  <label
                    key={key}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-elevated)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggle(key)}
                      className="rounded"
                    />
                    <span className="text-sm text-[var(--text-primary)] font-mono flex-1">{h.host}</span>
                    <JbossTag major={major} version={normalizeJbossVersion(h.jbossVersion)} />
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-muted)]">
          {submission.hosts.length} sunucu seçildi
          {/* Çift kurulumlu bir host'un iki satırı da işaretlendiyse sayıların neden
              tutmadığını SÖYLE — sessiz tekilleştirme kullanıcıyı şaşırtırdı. */}
          {submission.hosts.length !== selected.size && (
            <> · {selected.size} kurulum (aynı sunucunun iki JBoss sürümü)</>
          )}
        </span>
        <button
          onClick={() => onSubmit(submission)}
          disabled={submission.hosts.length === 0 || busy}
          className="btn-primary"
        >
          Devam Et
        </button>
      </div>
    </div>
  );
};

export default HostSelectStep;
