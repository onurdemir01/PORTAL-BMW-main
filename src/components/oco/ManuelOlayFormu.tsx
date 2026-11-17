// src/components/oco/ManuelOlayFormu.tsx — OCO Takvimi: elle olay ekle / düzenle penceresi (2026-11-17).
//
// Kurallar (sunucu da aynısını denetler, bkz. server/oco/manuel.cjs):
//  * Başlık ve başlangıç zorunlu; OCO no isteğe bağlı (yalnız rakam); bitiş varsa >= başlangıç.
//  * Aynı OCO no serviste de listeleniyorsa UYARI verilir, engel değil (servis kaydı gecikebilir).
//  * Arka plana tıklamak formu kapatmaz: yazılan metin tek yanlış tıklamayla silinmesin.
import React, { useRef, useState } from 'react';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/common/Modal';
import {
  formHatasi,
  isoYerel,
  manuelKaydet,
  yerelIso,
  type ManuelOlay,
} from '@/components/oco/manuelOlay';

export interface ManuelOlayFormuProps {
  /** Düzenlenen olay; null = yeni olay. */
  olay: ManuelOlay | null;
  /** Serviste listelenen OCO numaraları (çakışma uyarısı için). */
  servisOcolari: Set<string>;
  onClose: () => void;
  onKaydedildi: (o: ManuelOlay | null) => void;
}

const alanStili = {
  borderColor: 'var(--border)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
} as const;

export default function ManuelOlayFormu({
  olay,
  servisOcolari,
  onClose,
  onKaydedildi,
}: ManuelOlayFormuProps) {
  // Pencere yalniz acikken bagli (sayfa kosullu cizer, key ile): durum ilk degerle kurulur,
  // her acilista sifirdan baslar; efektle doldurmaya gerek yok.
  const [baslik, setBaslik] = useState(olay?.baslik || '');
  const [ocoNo, setOcoNo] = useState(olay?.ocoNo || '');
  const [baslangic, setBaslangic] = useState(isoYerel(olay?.baslangic));
  const [bitis, setBitis] = useState(isoYerel(olay?.bitis));
  const [aciklama, setAciklama] = useState(olay?.aciklama || '');
  const [hata, setHata] = useState<string | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const cakisma = ocoNo.trim() && servisOcolari.has(ocoNo.trim());

  // CIFT GONDERIM KILIDI (dogrulama bulgusu, 2026-11-17): kayit surerken alanda tekrar Enter
  // (ya da tus tekrari) ikinci POST'u gonderip olayi IKI KEZ ekliyordu. Durum (state) ayni
  // tikteki ikinci gonderimi goremez; kilit ref'te.
  const ucusta = useRef(false);

  const kaydet = async () => {
    if (ucusta.current) return;
    const yerelHata = formHatasi({ baslik, ocoNo, baslangic, bitis });
    if (yerelHata) {
      setHata(yerelHata);
      return;
    }
    ucusta.current = true;
    setKaydediliyor(true);
    setHata(null);
    try {
      const r = await manuelKaydet(olay?.id ?? null, {
        baslik: baslik.trim(),
        ocoNo: ocoNo.trim(),
        aciklama: aciklama.trim(),
        baslangic: yerelIso(baslangic),
        bitis: yerelIso(bitis),
      });
      if (!r.ok) {
        setHata(r.message || 'Olay kaydedilemedi.');
        return;
      }
      onKaydedildi(r.olay || null);
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      ucusta.current = false;
      setKaydediliyor(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={olay ? 'Olayı düzenle' : 'Takvime olay ekle'}
      subtitle="Elle eklenen olay OCO servisine yazılmaz; takvimde “manuel” rozetiyle görünür."
      icon={CalendarDaysIcon}
      dismissOnBackdrop={false}
      footer={
        <>
          <button
            type="button"
            onClick={() => void kaydet()}
            disabled={kaydediliyor}
            className="h-8 px-3 text-xs font-medium rounded-lg disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            {kaydediliyor ? 'Kaydediliyor…' : olay ? 'Kaydet' : 'Ekle'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={kaydediliyor}
            className="h-8 px-3 text-xs rounded-lg border focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            style={alanStili}
          >
            İptal
          </button>
        </>
      }
    >
      <form
        className="space-y-3 text-xs"
        onSubmit={(e) => {
          e.preventDefault();
          void kaydet();
        }}
        data-testid="oco-manuel-form"
      >
        <label className="block space-y-1">
          <span style={{ color: 'var(--text-secondary)' }}>Başlık *</span>
          <input
            value={baslik}
            onChange={(e) => setBaslik(e.target.value)}
            maxLength={300}
            required
            className="w-full h-8 px-2 rounded-lg border"
            style={alanStili}
            aria-label="Başlık"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span style={{ color: 'var(--text-secondary)' }}>Başlangıç *</span>
            <input
              type="datetime-local"
              value={baslangic}
              onChange={(e) => setBaslangic(e.target.value)}
              required
              className="w-full h-8 px-2 rounded-lg border"
              style={alanStili}
              aria-label="Başlangıç"
            />
          </label>
          <label className="block space-y-1">
            <span style={{ color: 'var(--text-secondary)' }}>Bitiş</span>
            <input
              type="datetime-local"
              value={bitis}
              min={baslangic || undefined}
              onChange={(e) => setBitis(e.target.value)}
              className="w-full h-8 px-2 rounded-lg border"
              style={alanStili}
              aria-label="Bitiş"
            />
          </label>
        </div>
        <label className="block space-y-1">
          <span style={{ color: 'var(--text-secondary)' }}>OCO no (isteğe bağlı)</span>
          <input
            value={ocoNo}
            onChange={(e) => setOcoNo(e.target.value)}
            inputMode="numeric"
            maxLength={20}
            className="w-full h-8 px-2 rounded-lg border tabular-nums"
            style={alanStili}
            aria-label="OCO no"
          />
        </label>
        {cakisma && (
          <div
            className="rounded-lg px-2.5 py-1.5 border"
            style={{
              color: 'var(--status-warning-text)',
              background: 'var(--status-warning-bg)',
              borderColor: 'var(--status-warning)',
            }}
            data-testid="oco-manuel-cakisma"
          >
            OCO {ocoNo.trim()} zaten servisten listeleniyor. Kaydederseniz takvimde iki kez görünür.
          </div>
        )}
        <label className="block space-y-1">
          <span style={{ color: 'var(--text-secondary)' }}>Açıklama</span>
          <textarea
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
            maxLength={2000}
            rows={4}
            className="w-full px-2 py-1.5 rounded-lg border"
            style={alanStili}
            aria-label="Açıklama"
          />
        </label>
        {hata && (
          <div
            role="alert"
            className="rounded-lg px-2.5 py-1.5 border"
            style={{
              color: 'var(--status-danger)',
              background: 'var(--status-danger-bg)',
              borderColor: 'var(--status-danger)',
            }}
          >
            {hata}
          </div>
        )}
        {/* Enter ile gonderim icin gorunmez gonder dugmesi (alt bardaki dugme form disinda). */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
