// Ust uste pencerelerde ESC'nin ILK KAREDEN itibaren yalniz en ustteki katmani kapatmasi.
//
// Bir katmanin ESC dinleyicisi pasif efektte (useEffect) kaydedilirse, tarayici yeni katmani
// cizdikten SONRA kaydedilir. Arada basilan ESC alttaki pencereye gider: kullanici onay katmanini
// kapatmak isterken butun kayit penceresini kapatir. CI'da (yuk altinda) Retirement RE8 testi tam
// bu araliga dustu: onay penceresi ekrandaydi, ESC kayit penceresini kapatti.
//
// Sonda, ESC'yi yeni katmanin LAYOUT efektinde basar: tarayicinin katmani boyayabilecegi en erken an.
import { useLayoutEffect, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../Modal';
import { useEscIleKapat } from '../pencereKlavye';

function IlkKaredeEsc({ aktif }: Readonly<{ aktif: boolean }>) {
  useLayoutEffect(() => {
    if (aktif)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }, [aktif]);
  return null;
}

function OnayKatmani({ kapat }: Readonly<{ kapat: () => void }>) {
  useEscIleKapat(true, kapat);
  return (
    <div role="dialog" aria-label="Onay">
      onay
    </div>
  );
}

function KayitVeOnay({
  kayitKapat,
  onayKapat,
  sonda,
}: Readonly<{ kayitKapat: () => void; onayKapat: () => void; sonda: boolean }>) {
  const [onay, setOnay] = useState(false);
  return (
    <Modal open onClose={kayitKapat} title="Kayit">
      <button type="button" onClick={() => setOnay(true)}>
        Onay ac
      </button>
      {onay && (
        <OnayKatmani
          kapat={() => {
            onayKapat();
            setOnay(false);
          }}
        />
      )}
      <IlkKaredeEsc aktif={sonda && onay} />
    </Modal>
  );
}

function IcIcePencere({
  disKapat,
  icKapat,
  sonda,
}: Readonly<{ disKapat: () => void; icKapat: () => void; sonda: boolean }>) {
  const [ic, setIc] = useState(false);
  return (
    <Modal open onClose={disKapat} title="Dis">
      <button type="button" onClick={() => setIc(true)}>
        Ic ac
      </button>
      <Modal
        open={ic}
        onClose={() => {
          icKapat();
          setIc(false);
        }}
        title="Ic"
      >
        <p>ic</p>
      </Modal>
      <IlkKaredeEsc aktif={sonda && ic} />
    </Modal>
  );
}

const esc = () => fireEvent.keyDown(document, { key: 'Escape' });

describe('Ust uste katmanlarda ESC: ilk kareden itibaren yalniz en ustteki', () => {
  it('EK1 Modal icindeki onay katmani: ilk karedeki ESC onayi kapatir, kayit penceresi acik kalir', () => {
    const kayitKapat = vi.fn();
    const onayKapat = vi.fn();
    render(<KayitVeOnay kayitKapat={kayitKapat} onayKapat={onayKapat} sonda />);
    fireEvent.click(screen.getByRole('button', { name: 'Onay ac' }));
    expect(onayKapat).toHaveBeenCalledTimes(1);
    expect(kayitKapat).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Onay' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Kayit' })).toBeTruthy();
  });

  it('EK2 Modal icinde Modal: ilk karedeki ESC icteki pencereyi kapatir, distaki acik kalir', () => {
    const disKapat = vi.fn();
    const icKapat = vi.fn();
    render(<IcIcePencere disKapat={disKapat} icKapat={icKapat} sonda />);
    fireEvent.click(screen.getByRole('button', { name: 'Ic ac' }));
    expect(icKapat).toHaveBeenCalledTimes(1);
    expect(disKapat).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Ic' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Dis' })).toBeTruthy();
  });

  it('EK3 sonraki ESC yigindan birer birer iner: once ust katman, sonra alttaki pencere', () => {
    const kayitKapat = vi.fn();
    const onayKapat = vi.fn();
    render(<KayitVeOnay kayitKapat={kayitKapat} onayKapat={onayKapat} sonda={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Onay ac' }));
    expect(screen.getByRole('dialog', { name: 'Onay' })).toBeTruthy();
    esc();
    expect(onayKapat).toHaveBeenCalledTimes(1);
    expect(kayitKapat).not.toHaveBeenCalled();
    esc();
    expect(kayitKapat).toHaveBeenCalledTimes(1);
    expect(onayKapat).toHaveBeenCalledTimes(1);

    const disKapat = vi.fn();
    const icKapat = vi.fn();
    render(<IcIcePencere disKapat={disKapat} icKapat={icKapat} sonda={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ic ac' }));
    esc();
    expect(icKapat).toHaveBeenCalledTimes(1);
    expect(disKapat).not.toHaveBeenCalled();
  });
});
