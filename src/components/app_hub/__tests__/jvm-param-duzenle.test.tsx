// JBoss JVM parametresi değiştir / ekle penceresi (2026-11-11).
//   JD1 istemci izin listesi = sunucu izin listesi (kaynak karşılaştırma); parola desenli -D reddedilir
//   JD2 mevcut parametreye tıklamak: -D maskeliyse yalnız "-Dad=" önerir, değiştirilecek olan yazılır
//   JD3 akış: Önizle (plan) → plan metni → JVM adı yazılmadan Uygula kapalı → Uygula → OK mesajı + yenile
//   JD4 production: Smart talebi açılırsa iş izlenmez, bilgi mesajı gösterilir
//   JD5 geçersiz parametrede Önizle kapalı; parametre değişince eski plan geçersiz
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ jvmParam: vi.fn(), jvmParamDurum: vi.fn() }));
vi.mock('@/api/appHubApi', () => ({ appHubApi: m }));

import JvmParamDuzenle from '@/components/app_hub/JvmParamDuzenle';
import { JVMOPT_RE, JVMOPT_YASAK_RE, parametreHatasi, duzenlemeBaslangici, eslesenler } from '@/components/app_hub/jvmParam';

const ac = (onDegisti = vi.fn()) => {
  render(
    <JvmParamDuzenle host="GOJBAP01" gen={8} jvm="MUSTERI" uygulama="MUSTERI" mevcut="-Xmx1g -Dapp.env=*** -Dfile.encoding=UTF-8 -XX:+UseG1GC" onDegisti={onDegisti} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Parametre değiştir \/ ekle/ }));
  return onDegisti;
};

beforeEach(() => {
  m.jvmParam.mockReset();
  m.jvmParamDurum.mockReset();
});

describe('JVM parametresi', () => {
  it('JD1 istemci ve sunucu izin listesi aynı', () => {
    const sunucu = readFileSync(join(__dirname, '..', '..', '..', '..', 'server', 'app-hub', 'jvm-param.cjs'), 'utf8');
    expect(sunucu).toContain(JVMOPT_RE.source);
    expect(sunucu).toContain(JVMOPT_YASAK_RE.source);
    expect(parametreHatasi('-Ddb.password=x')).toMatch(/Parola/);
    expect(parametreHatasi('-Dx=a b')).toMatch(/Tek parametre/);
    expect(parametreHatasi('-Dx=***')).toMatch(/Maskeli/);
    expect(parametreHatasi('-XX:OnOutOfMemoryError=x')).toMatch(/değiştirilemez/);
    expect(parametreHatasi('-Xmx2g')).toBeNull();
    expect(duzenlemeBaslangici('-Dapp.env=***')).toBe('-Dapp.env=');
    expect(duzenlemeBaslangici('-Dfile.encoding=UTF-8')).toBe('-Dfile.encoding=UTF-8');
    expect(eslesenler(['-XX:+UseG1GC', '-Xmx1g'], '-XX:-UseG1GC')).toEqual(['-XX:+UseG1GC']);
  });

  it('JD2 mevcut parametreye tıklamak', () => {
    ac();
    fireEvent.click(screen.getByRole('button', { name: '-Dapp.env=***' }));
    const giris = screen.getByLabelText('Parametre') as HTMLInputElement;
    expect(giris.value).toBe('-Dapp.env=');
    fireEvent.change(giris, { target: { value: '-Dapp.env=prod' } });
    expect(screen.getByText(/Mevcut -Dapp.env=\*\*\* yerine yazılacak/)).toBeInTheDocument();
    fireEvent.change(giris, { target: { value: '-Dyeni=1' } });
    expect(screen.getByText(/Yeni parametre olarak eklenecek/)).toBeInTheDocument();
  });

  it('JD3 önizle → onay → uygula', async () => {
    m.jvmParam.mockResolvedValueOnce({ ok: true, serverId: 2, jobId: 11, plan: true });
    m.jvmParamDurum.mockResolvedValueOnce({ status: 'successful', finished: true, sonuc: 'PLAN', mesaj: 'MUSTERI (jvm=MUSTERI) max-heap-size 1g -> 2g' });
    const onDegisti = ac();
    fireEvent.change(screen.getByLabelText('Parametre'), { target: { value: '-Xmx2g' } });
    fireEvent.click(screen.getByRole('button', { name: 'Önizle' }));
    expect(await screen.findByTestId('jvm-param-plan')).toHaveTextContent('max-heap-size 1g -> 2g');
    expect(m.jvmParam).toHaveBeenCalledWith({ host: 'GOJBAP01', gen: 8, jvm: 'MUSTERI', parametre: '-Xmx2g', uygulama: 'MUSTERI' });
    const uygula = screen.getByRole('button', { name: 'Uygula' });
    expect(uygula).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/JVM adını yazın/), { target: { value: 'musteri' } });
    expect(uygula).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/JVM adını yazın/), { target: { value: 'MUSTERI' } });
    expect(uygula).toBeEnabled();
    m.jvmParam.mockResolvedValueOnce({ ok: true, serverId: 2, jobId: 12, plan: false });
    m.jvmParamDurum.mockResolvedValueOnce({ status: 'successful', finished: true, sonuc: 'OK', mesaj: 'MUSTERI max-heap-size=2g (CLI ile dogrulandi; restart gerekli)' });
    fireEvent.click(uygula);
    expect(await screen.findByTestId('jvm-param-sonuc')).toHaveTextContent(/yeniden başlatıldığında yürürlüğe girer/);
    expect(m.jvmParam).toHaveBeenLastCalledWith(expect.objectContaining({ apply: true, onayMetni: 'MUSTERI', parametre: '-Xmx2g' }));
    // Sayfa yenilemesi PENCERE KAPANINCA (yenileme pencereyi mesaj okunamadan sokerdi).
    expect(onDegisti).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Kapat' }).at(-1)!);
    expect(onDegisti).toHaveBeenCalledTimes(1);
  });

  it('JD6 iş başladıktan sonra durum okunamazsa Uygula yeniden açılmaz', async () => {
    m.jvmParam.mockResolvedValueOnce({ ok: true, serverId: 2, jobId: 11, plan: true });
    m.jvmParamDurum.mockResolvedValueOnce({ status: 'successful', finished: true, sonuc: 'PLAN', mesaj: 'plan' });
    const onDegisti = ac();
    fireEvent.change(screen.getByLabelText('Parametre'), { target: { value: '-Dyeni=1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Önizle' }));
    await screen.findByTestId('jvm-param-plan');
    fireEvent.change(screen.getByLabelText(/JVM adını yazın/), { target: { value: 'MUSTERI' } });
    m.jvmParam.mockResolvedValueOnce({ ok: true, serverId: 2, jobId: 12, plan: false });
    m.jvmParamDurum.mockRejectedValue(new Error('Sunucu hatası (HTTP 502).'));
    fireEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    expect(await screen.findByTestId('jvm-param-sonuc', {}, { timeout: 12000 })).toHaveTextContent('İş başlatıldı (AWX #12) ama sonucu okunamadı');
    expect(screen.queryByRole('button', { name: 'Uygula' })).toBeNull();
    expect(m.jvmParam).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Kapat' }).at(-1)!);
    expect(onDegisti).not.toHaveBeenCalled();
  }, 15000);

  it('JD4 production: Smart talebi', async () => {
    m.jvmParam.mockResolvedValueOnce({ ok: true, serverId: 2, jobId: 11, plan: true });
    m.jvmParamDurum.mockResolvedValueOnce({ status: 'successful', finished: true, sonuc: 'PLAN', mesaj: 'plan' });
    const onDegisti = ac();
    fireEvent.change(screen.getByLabelText('Parametre'), { target: { value: '-Dyeni=1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Önizle' }));
    await screen.findByTestId('jvm-param-plan');
    fireEvent.change(screen.getByLabelText(/JVM adını yazın/), { target: { value: 'MUSTERI' } });
    m.jvmParam.mockResolvedValueOnce({ ok: true, pendingApproval: true, externalTicketId: 'S-9', message: 'Production işlemi için Smart talebi açıldı (kayıt no: S-9).' });
    fireEvent.click(screen.getByRole('button', { name: 'Uygula' }));
    expect(await screen.findByTestId('jvm-param-sonuc')).toHaveTextContent('Smart talebi açıldı');
    expect(m.jvmParamDurum).toHaveBeenCalledTimes(1);
    expect(onDegisti).not.toHaveBeenCalled();
  });

  it('JD5 geçersiz parametre ve eskiyen plan', async () => {
    ac();
    const giris = screen.getByLabelText('Parametre');
    fireEvent.change(giris, { target: { value: '-Dx=$(id)' } });
    expect(screen.getByRole('button', { name: 'Önizle' })).toBeDisabled();
    m.jvmParam.mockResolvedValueOnce({ ok: true, serverId: 2, jobId: 11, plan: true });
    m.jvmParamDurum.mockResolvedValueOnce({ status: 'successful', finished: true, sonuc: 'PLAN', mesaj: 'plan' });
    fireEvent.change(giris, { target: { value: '-Dyeni=1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Önizle' }));
    await screen.findByTestId('jvm-param-plan');
    fireEvent.change(giris, { target: { value: '-Dyeni=2' } });
    await waitFor(() => expect(screen.queryByTestId('jvm-param-plan')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Uygula' })).toBeNull();
  });
});
