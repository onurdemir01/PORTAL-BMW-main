// src/components/self_service/__tests__/ChoiceDetailsPanel.test.tsx — seçimin AYRINTISI (2026-10-22).
//
// Kullanıcı: "seçilen kök API'yle beraber etkilenecek diğer children API'ler sağda liste halinde gözüksün
// kullanıcı bunun bilincinde olsun hepsinin rate limiti çünkü kök API'nin ismiyle aynı zone'a tanımlı".
//   CD1 seçim yapılınca panel gelir: başlıkta etkilenen sayısı, zone adları, kök ve başka konfigürasyon rozeti,
//       limitsiz uç "etkilenmez", kapsam n/toplam
//   CD2 zone bilgisi yoksa bunu açıkça yazar (liste yalnız bu konfigürasyon)
//   CD3 ayrıntı alınamazsa "ölçülemedi" der — "etkilenen yok" demez
//   CD4 kaynak details istemiyorsa ya da seçim yoksa ayrıntı ÇAĞRILMAZ; istek parametreleri + değer doğru
//   CD5 okuma (mod=bilgi): "etkilenecek" denmez, okumanın hiçbir şeyi değiştirmediği yazar
//   CD6 bağlı zorunlu alan boşaltılınca / değer listede değilken panel yok ve ayrıntı istenmez
//       (yanıltıcı "listede yok" hatası çıkmasın — inceleme 2026-10-22)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({ choices: vi.fn(), choiceDetails: vi.fn() }));
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: api }));
import DynamicChoiceSelect from '../DynamicChoiceSelect';

const KAYNAK = {
  source: 'nginx-api-gateway-confs',
  params: { env: 'env', site: 'site', channel: 'channel' },
  optional: ['site', 'channel'],
  details: true,
};
const DEGERLER = { env: 'prod', site: '', channel: 'customers', op_selection: 'rate_limit_change' };
const Z = '/das-a/a-channel/v0_rate_limit';
const uc = (o: Record<string, unknown>) => ({
  conf: 'ORT.CST.REST.A.V1', kok: false, baskaConf: false, sunucu: 12, ip: '50r/s', loc: '', ipFarkli: false,
  locFarkli: false, ipZone: Z, locZone: '', etkiler: { ip: true, location: false }, ...o,
});
const DETAY = {
  conf: 'ORT.CST.REST.A.V1', kume: 'customers', toplamSunucu: 12, taramaTarihi: '2026-10-22', zoneBilgisi: true,
  zoneKirpildi: false, zonelar: { ip: [Z], location: [] }, mod: 'degisiklik' as const, etkilenen: 3,
  uclar: [
    uc({ yol: '/das-a/a-channel/v0', kok: true }),
    uc({ yol: '/das-a/a-channel/v0/x', ip: '50r/s / 60r/s', ipFarkli: true, sunucu: 11 }),
    uc({ yol: '/das-a/a-channel/v0/ping', ip: '', ipZone: '', etkiler: { ip: false, location: false } }),
    uc({ yol: '/gar/baska/v0', conf: 'GAR.BASKA.V1', baskaConf: true }),
  ],
};

describe('DynamicChoiceSelect + ChoiceDetailsPanel', () => {
  beforeEach(() => {
    api.choices.mockReset();
    api.choiceDetails.mockReset();
    api.choices.mockResolvedValue({ ok: true, choices: [{ value: 'ORT.CST.REST.A.V1', label: 'ORT.CST.REST.A.V1  ·  örnek uç /das-a/a-channel/v0' }] });
    api.choiceDetails.mockResolvedValue({ ok: true, detay: DETAY });
  });

  it('CD1 seçim yapılınca sağda birlikte etkilenecek uçlar', async () => {
    render(<DynamicChoiceSelect id="c" source={KAYNAK} values={DEGERLER} value="ORT.CST.REST.A.V1" onChange={vi.fn()} />);
    const panel = await screen.findByTestId('secim-ayrinti');
    await waitFor(() => expect(within(panel).getByText('Birlikte etkilenecek API uçları (3)')).toBeInTheDocument());
    expect(within(panel).getByTestId('secim-ayrinti-zone').textContent).toContain(Z);
    const satirlar = within(panel).getAllByTestId('secim-ayrinti-uc');
    expect(satirlar).toHaveLength(4);
    expect(within(satirlar[0]).getByText('kök')).toBeInTheDocument();
    expect(satirlar[1].textContent).toContain('IP 50r/s / 60r/s (sunucular arasında farklı) · 11/12 sunucu');
    expect(satirlar[2].textContent).toContain('limit yok — etkilenmez');
    expect(within(satirlar[3]).getByText('başka konfigürasyon: GAR.BASKA.V1')).toBeInTheDocument();
    expect(panel.textContent).toContain('customers kümesi');
    expect(panel.textContent).not.toContain('zone adını henüz tutmuyor');
  });

  it('CD2 zone bilgisi yoksa açıkça yazar', async () => {
    api.choiceDetails.mockResolvedValue({ ok: true, detay: { ...DETAY, zoneBilgisi: false, zonelar: { ip: [], location: [] }, uclar: DETAY.uclar.slice(0, 3) } });
    render(<DynamicChoiceSelect id="c" source={KAYNAK} values={DEGERLER} value="ORT.CST.REST.A.V1" onChange={vi.fn()} />);
    const panel = await screen.findByTestId('secim-ayrinti');
    await waitFor(() => expect(panel.textContent).toContain('Envanter zone adını henüz tutmuyor'));
    expect(within(panel).queryByTestId('secim-ayrinti-zone')).toBeNull();
  });

  it('CD3 ayrıntı alınamazsa ölçülemedi der', async () => {
    api.choiceDetails.mockResolvedValue({ ok: false, message: 'veritabanı yanıt vermedi' });
    render(<DynamicChoiceSelect id="c" source={KAYNAK} values={DEGERLER} value="ORT.CST.REST.A.V1" onChange={vi.fn()} />);
    const uyari = await screen.findByRole('alert');
    expect(uyari.textContent).toContain('ölçülemedi');
    expect(uyari.textContent).toContain('veritabanı yanıt vermedi');
    expect(screen.queryByText(/Birlikte etkilenecek API uçları \(/)).toBeNull();
  });

  it('CD4 details yoksa / seçim yoksa çağrılmaz; çağrı parametreleri doğru', async () => {
    const { rerender } = render(<DynamicChoiceSelect id="c" source={{ ...KAYNAK, details: false }} values={DEGERLER} value="ORT.CST.REST.A.V1" onChange={vi.fn()} />);
    await waitFor(() => expect(api.choices).toHaveBeenCalled());
    expect(screen.queryByTestId('secim-ayrinti')).toBeNull();
    rerender(<DynamicChoiceSelect id="c" source={KAYNAK} values={DEGERLER} value="" onChange={vi.fn()} />);
    await waitFor(() => expect(api.choices).toHaveBeenCalled());
    expect(screen.queryByTestId('secim-ayrinti')).toBeNull();
    expect(api.choiceDetails).not.toHaveBeenCalled();
    rerender(<DynamicChoiceSelect id="c" source={KAYNAK} values={DEGERLER} value="ORT.CST.REST.A.V1" onChange={vi.fn()} />);
    await screen.findByTestId('secim-ayrinti');
    await waitFor(() =>
      expect(api.choiceDetails).toHaveBeenCalledWith('nginx-api-gateway-confs', { env: 'prod', site: '', channel: 'customers' }, 'ORT.CST.REST.A.V1'),
    );
  });

  it('CD5 okuma modunda "etkilenecek" denmez', async () => {
    api.choiceDetails.mockResolvedValue({ ok: true, detay: { ...DETAY, mod: 'bilgi' } });
    render(<DynamicChoiceSelect id="c" source={KAYNAK} values={DEGERLER} value="ORT.CST.REST.A.V1" onChange={vi.fn()} />);
    const panel = await screen.findByTestId('secim-ayrinti');
    await waitFor(() => expect(panel.textContent).toContain("Bu konfigürasyonun zone'larını paylaşan API uçları (3)"));
    expect(panel.textContent).toContain('Okuma hiçbir şeyi değiştirmez');
    expect(panel.textContent).not.toContain('Birlikte etkilenecek');
  });

  it('CD7 seçili değer vurgulu ve tam metin; açık listede seçili satır işaretli', async () => {
    const UZUN = 'GAR.CST.REST.DIGITAL-ONBOARDING-PB_DIGITAL-ONBOARDING-PB-CH_V0';
    const ETIKET = `${UZUN} - /digital-onboarding-pb/digital-onboarding-pb/v0/`;
    api.choices.mockResolvedValue({ ok: true, choices: [{ value: 'GAR.A', label: 'GAR.A - /a/v0' }, { value: UZUN, label: ETIKET }] });
    render(<DynamicChoiceSelect id="c" source={KAYNAK} values={DEGERLER} value={UZUN} onChange={vi.fn()} />);
    const secili = await screen.findByTestId('secim-secili');
    await waitFor(() => expect(secili.textContent).toContain(ETIKET));
    expect(secili.className).toContain('border-[var(--accent)]');
    expect(secili.querySelector('span')!.className).toContain('break-all');
    within(secili).getByText('değiştir').click();
    const secenek = await screen.findByRole('option', { selected: true });
    expect(secenek.textContent).toBe(`✓ ${ETIKET}`);
    expect(secenek.className).toContain('border-[var(--accent)]');
    const diger = screen.getAllByRole('option').find((o) => o !== secenek)!;
    expect(diger.className).toContain('border-transparent');
  });

  it('CD6 zorunlu alan boşken ya da değer listede yokken panel yok, ayrıntı istenmez', async () => {
    const { rerender } = render(
      <DynamicChoiceSelect id="c" source={KAYNAK} values={{ ...DEGERLER, env: '' }} value="ORT.CST.REST.A.V1" onChange={vi.fn()} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('secim-ayrinti')).toBeNull();
    api.choices.mockResolvedValue({ ok: true, choices: [{ value: 'BASKA.V1', label: 'BASKA.V1' }] });
    rerender(<DynamicChoiceSelect id="c" source={KAYNAK} values={DEGERLER} value="ORT.CST.REST.A.V1" onChange={vi.fn()} />);
    await waitFor(() => expect(api.choices).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('secim-ayrinti')).toBeNull();
    expect(api.choiceDetails).not.toHaveBeenCalled();
  });
});
