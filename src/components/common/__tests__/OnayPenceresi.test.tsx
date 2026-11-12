// src/components/common/__tests__/OnayPenceresi.test.tsx — portal ici onay penceresi (2026-11-08).
//   OP1 onay -> true, pencere kapanir
//   OP2 Iptal / ESC / arka plan -> false
//   OP3 cift tiklama tek sonuc
//   OP4 tehlikeli -> kirmizi dugme; metinler secenekten, varsayilanlar "Devam" / "İptal"
//   OP5 bekleyen soru varken bilesen kalkarsa sonuc false (await asili kalmaz)
//   OP6 ikinci soru oncekini iptal eder
//   OP7 ust uste pencere: ESC yalniz ustteki pencereyi kapatir, sayfa kaydirma kilidi son
//       pencere kapanana kadar surer (Modal yigini)
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { useOnay, type OnaySecenekleri } from '../OnayPenceresi';
import { Modal } from '../Modal';

function Deneme({
  onSonuc,
  secenek = { metin: 'Silinsin mi?' },
}: {
  onSonuc: (v: boolean) => void;
  secenek?: OnaySecenekleri | string;
}) {
  const { onayla, onayPenceresi } = useOnay();
  return (
    <div>
      <button onClick={async () => onSonuc(await onayla(secenek))}>Sor</button>
      {onayPenceresi}
    </div>
  );
}

const sor = () => fireEvent.click(screen.getByRole('button', { name: 'Sor' }));

describe('useOnay / OnayPenceresi', () => {
  it('OP1 onay -> true, pencere kapanir', async () => {
    const onSonuc = vi.fn();
    render(<Deneme onSonuc={onSonuc} />);
    sor();
    const p = await screen.findByRole('dialog');
    expect(p).toHaveTextContent('Silinsin mi?');
    fireEvent.click(within(p).getByRole('button', { name: 'Devam' }));
    await waitFor(() => expect(onSonuc).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('OP2 Iptal / ESC / arka plan -> false', async () => {
    const onSonuc = vi.fn();
    render(<Deneme onSonuc={onSonuc} />);

    sor();
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'İptal' }),
    );
    await waitFor(() => expect(onSonuc).toHaveBeenLastCalledWith(false));

    sor();
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onSonuc).toHaveBeenCalledTimes(2));
    expect(onSonuc).toHaveBeenLastCalledWith(false);

    sor();
    const ortu = (await screen.findByRole('dialog')).firstElementChild as HTMLElement;
    fireEvent.mouseDown(ortu);
    fireEvent.click(ortu);
    await waitFor(() => expect(onSonuc).toHaveBeenCalledTimes(3));
    expect(onSonuc).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('OP3 cift tiklama tek sonuc', async () => {
    const onSonuc = vi.fn();
    render(<Deneme onSonuc={onSonuc} />);
    sor();
    const dugme = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Devam' });
    fireEvent.click(dugme);
    fireEvent.click(dugme);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onSonuc).toHaveBeenCalledTimes(1));
    expect(onSonuc).toHaveBeenCalledWith(true);
  });

  it('OP4 tehlikeli -> kirmizi dugme; metinler secenekten', async () => {
    render(
      <Deneme
        onSonuc={() => {}}
        secenek={{
          baslik: 'Kaydı sil',
          metin: 'Satır 1\nSatır 2',
          onayMetni: 'Sil',
          iptalMetni: 'Koru',
          tehlikeli: true,
        }}
      />,
    );
    sor();
    const p = await screen.findByRole('dialog');
    expect(within(p).getByRole('heading', { name: 'Kaydı sil' })).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: 'Sil' })).toHaveClass('btn-danger');
    expect(within(p).getByRole('button', { name: 'Koru' })).toHaveClass('btn-secondary');
    // Satir sonlari korunur (whitespace-pre-line).
    expect(within(p).getByText(/Satır 1/)).toHaveClass('whitespace-pre-line');
  });

  it('OP4b varsayilan: birincil dugme, baslik "Onay"', async () => {
    render(<Deneme onSonuc={() => {}} secenek="Devam edilsin mi?" />);
    sor();
    const p = await screen.findByRole('dialog');
    expect(within(p).getByRole('heading', { name: 'Onay' })).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: 'Devam' })).toHaveClass('btn-primary');
  });

  it('OP5 bekleyen soru varken bilesen kalkarsa sonuc false', async () => {
    const onSonuc = vi.fn();
    const { unmount } = render(<Deneme onSonuc={onSonuc} />);
    sor();
    await screen.findByRole('dialog');
    unmount();
    await waitFor(() => expect(onSonuc).toHaveBeenCalledWith(false));
  });

  it('OP6 ikinci soru oncekini iptal eder', async () => {
    const sonuclar: string[] = [];
    function Iki() {
      const { onayla, onayPenceresi } = useOnay();
      return (
        <div>
          <button onClick={async () => sonuclar.push(`a:${await onayla('A?')}`)}>A</button>
          <button onClick={async () => sonuclar.push(`b:${await onayla('B?')}`)}>B</button>
          {onayPenceresi}
        </div>
      );
    }
    render(<Iki />);
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'B', hidden: true }));
    await waitFor(() => expect(sonuclar).toEqual(['a:false']));
    expect(screen.getByRole('dialog')).toHaveTextContent('B?');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Devam' }));
    await waitFor(() => expect(sonuclar).toEqual(['a:false', 'b:true']));
  });

  it('OP7 ust uste pencere: ESC yalniz usttekini kapatir; kaydirma kilidi son pencereye kadar', async () => {
    const onSonuc = vi.fn();
    function Dis() {
      const [acik, setAcik] = useState(true);
      const { onayla, onayPenceresi } = useOnay();
      return (
        <Modal open={acik} onClose={() => setAcik(false)} title="Dış pencere">
          <button onClick={async () => onSonuc(await onayla('İç soru?'))}>İç sor</button>
          {onayPenceresi}
        </Modal>
      );
    }
    render(<Dis />);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'İç sor' }));
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2));

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onSonuc).toHaveBeenCalledWith(false));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Dış pencere' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});
