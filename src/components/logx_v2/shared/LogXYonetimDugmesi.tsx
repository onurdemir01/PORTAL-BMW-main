// src/components/logx_v2/shared/LogXYonetimDugmesi.tsx — KAYNAK SAHİBİNİN GİRİŞ NOKTASI.
//
// Kaynak sahibi (L4) portal Admin'i değildir ve Admin ekranlarına giremez. Sahibi
// olduğu kaynak VARSA LogX sayfasında bu düğme görünür ve LogX Yönetimi'ni (yalnızca
// kendi kaynakları) bir pencerede açar. Admin bu düğmeyi görmez: tam ekran Admin >
// LogX v2 > Erişim'dedir. Sahip değilse hiçbir şey çizilmez.
import React, { useState } from 'react';
import { logxV2Api } from '@/api/logxV2Api';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { Modal } from '@/components/common/Modal';
import LogXErisim from '@/components/admin/tabs/logxv2/LogXErisim';

const LogXYonetimDugmesi: React.FC = () => {
  const [sahip, setSahip] = useState(false);
  const [acik, setAcik] = useState(false);

  useAsyncEffect(async (alive) => {
    const r = await logxV2Api.manage.resources().catch(() => null);
    if (alive()) setSahip(!!r && !r.isAdmin && (r.resources || []).length > 0);
  }, []);

  if (!sahip) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setAcik(true)}
        className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors"
      >
        LogX Yönetimi
      </button>
      <Modal open={acik} onClose={() => setAcik(false)} title="LogX Yönetimi" size="wide">
        <LogXErisim />
      </Modal>
    </>
  );
};

export default LogXYonetimDugmesi;
