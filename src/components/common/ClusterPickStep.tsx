// src/components/common/ClusterPickStep.tsx — bir tenant/ortam grubundaki GERÇEK
// cluster'lardan hedeflenecek alt kümenin seçimi.
//
// NEDEN VAR: bir tenant/env grubuna birden fazla gerçek cluster bağlı olabilir
// (ör. ark_prod → gbocpprod1, gbocpprod2, gbocpprod4). Uygulama sahibi bazen yalnızca
// birinde işlem yapmak/log almak ister; önceden bu sorulmuyordu ve iş hep tüm gruba gidiyordu.
//
// VARSAYILAN: TÜMÜ SEÇİLİ. Bu bilinçli — bugünkü (kısıtlamasız) davranışı birebir korur,
// hiç dokunmayan kullanıcı için HİÇBİR ŞEY değişmez. "Hiçbiri seçili değil" başlangıcı
// daha güvenli görünürdü ama çalışan akışı değiştirir ve herkese fazladan bir tık yüklerdi.
//
// TEK CLUSTER: adım hiç gösterilmez (`clusters.length <= 1` iken çağıran bu bileşeni
// render ETMEMELİ — gereksiz bir tık ve boş bir karar ekranı olurdu).
//
// GÜVENLİK: buradaki seçim bir ÖNERİDİR. Sunucu, seçilen adları kendi DB'sinden çözdüğü
// gerçek cluster listesine karşı yeniden doğrular (anti-TOCTOU) — grup dışı bir ad asla
// AWX `limit`ine ya da `ocp_clusters[]`e sızmaz.
import React from "react";
import { ServerStackIcon } from "@heroicons/react/24/outline";

interface Props {
  clusters: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  /** Buton metni; ok verilmezse bileşen buton render etmez (çağıran kendi akışını sürdürür). */
  submitLabel?: string;
  onSubmit?: () => void;
  busy?: boolean;
  /** Başlık altındaki açıklama — akışa göre değişir (log çekilecek / işlem yapılacak). */
  hint?: string;
}

const ClusterPickStep: React.FC<Props> = ({
  clusters, selected, onChange, submitLabel, onSubmit, busy, hint,
}) => {
  const all = clusters.length > 0 && selected.length === clusters.length;

  function toggle(name: string) {
    onChange(selected.includes(name) ? selected.filter((c) => c !== name) : [...selected, name]);
  }

  if (clusters.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
        Bu ortam/tenant için envanterde tanımlı gerçek cluster bulunamadı — Admin &gt; LogX
        Yapılandırma ekranından cluster kataloğunu kontrol edin.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-[var(--text-secondary)]">
          {hint || "Hangi cluster'lar hedeflensin?"}
        </p>
        <button
          onClick={() => onChange(all ? [] : [...clusters])}
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline underline-offset-2"
        >
          {all ? "Tümünün seçimini kaldır" : `Tümünü seç (${clusters.length})`}
        </button>
      </div>

      <div className="border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {clusters.map((name) => (
          <label
            key={name}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selected.includes(name)}
              onChange={() => toggle(name)}
              className="rounded"
            />
            <ServerStackIcon aria-hidden="true" className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
            <span className="text-sm font-mono text-[var(--text-primary)] flex-1 truncate">{name}</span>
          </label>
        ))}
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        {all
          ? "Tümü seçili — grubun bütün cluster'ları hedeflenecek (bugünkü davranış)."
          : `${selected.length} / ${clusters.length} cluster hedeflenecek.`}
      </p>

      {submitLabel && onSubmit && (
        <button
          onClick={onSubmit}
          disabled={busy || selected.length === 0}
          className="btn-primary w-full"
        >
          {busy ? "Başlatılıyor…" : `${submitLabel} (${selected.length})`}
        </button>
      )}
    </div>
  );
};

export default ClusterPickStep;
