// src/components/self_service/__tests__/secim-baglama.test.tsx — seçenek kaynağı YANLIŞ alana bağlıysa
// kullanıcı ne yapacağını görür (2026-10-15).
//
// Kullanıcı: "survey'e ilgili şekilde giriş yapmama rağmen namespace seçimi sonrası uygulamalar
// listelenmiyor". Sebep: "Yeni uygulama" alanının kaynağı `namespace` alanına bağlıydı, formdaki alan
// `new_namespace`. Ekran "Önce namespace seçin…" diyordu; o alan formda yok, kullanıcı takılı kalıyordu.
//   SB1 bağlı alan formda GÖRÜNMÜYORSA açık uyarı (role=alert) + yöneticiye yönlendiren yer tutucu
//   SB2 bağlı alan görünüyor ama boşsa: değişken adı değil alanın ETİKETİ ("Önce “Yeni namespace” seçin…")
//   SB3 bağlı alan doluysa uyarı yok, liste yüklenir
//   SB4 form sihirbazı görünen alanları bileşene veriyor (kaynak iddiası)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const secenek = vi.hoisted(() => vi.fn());
vi.mock('@/api/ansibleApi', () => ({ ansibleApi: { choices: secenek } }));
import DynamicChoiceSelect from '../DynamicChoiceSelect';

const KAYNAK = { source: 'ocp-spa-applications', params: { env: 'env', namespace: 'namespace' }, options: { tenant: 'ark' } };
const ALANLAR = { env: 'Ortam', new_namespace: 'Yeni namespace', new_application: 'Yeni uygulama' };

describe('DynamicChoiceSelect bağlama teşhisi', () => {
  beforeEach(() => {
    secenek.mockReset();
    secenek.mockResolvedValue({ ok: true, choices: [{ value: 'iban-app-v2', label: 'iban-app-v2' }] });
  });

  it('SB1 bağlı alan formda yoksa açık uyarı ve yöneticiye yönlendirme', () => {
    render(
      <DynamicChoiceSelect id="x" source={KAYNAK} values={{ env: 'test', new_namespace: 'ns-a' }} value="" onChange={vi.fn()} alanlar={ALANLAR} />,
    );
    const uyari = screen.getByTestId('secim-baglama-hatasi');
    expect(uyari).toHaveAttribute('role', 'alert');
    expect(uyari.textContent).toContain('“namespace”');
    expect(uyari.textContent).toContain('Alan Ayarları');
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Liste yapılandırması hatalı — yöneticiye bildirin');
    expect(secenek).not.toHaveBeenCalled();
  });

  it('SB2 bağlı alan görünüyor ama boş: etiketiyle istenir, uyarı yok', () => {
    const k = { ...KAYNAK, params: { env: 'env', namespace: 'new_namespace' } };
    render(<DynamicChoiceSelect id="x" source={k} values={{ env: 'test', new_namespace: '' }} value="" onChange={vi.fn()} alanlar={ALANLAR} />);
    expect(screen.queryByTestId('secim-baglama-hatasi')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Önce “Yeni namespace” seçin…');
  });

  it('SB3 doğru bağlı ve dolu: uyarı yok, liste yüklenir', async () => {
    const k = { ...KAYNAK, params: { env: 'env', namespace: 'new_namespace' } };
    render(<DynamicChoiceSelect id="x" source={k} values={{ env: 'test', new_namespace: 'ns-a' }} value="" onChange={vi.fn()} alanlar={ALANLAR} />);
    await waitFor(() => expect(secenek).toHaveBeenCalledWith('ocp-spa-applications', { env: 'test', namespace: 'ns-a', tenant: 'ark' }));
    expect(screen.queryByTestId('secim-baglama-hatasi')).toBeNull();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Ara ve seç… (1 kayıt)'));
  });

  it('SB4 sihirbaz görünen alanları (ad -> etiket) bileşene veriyor', () => {
    const s = readFileSync(join(__dirname, '..', '..', 'SelfServicePage.tsx'), 'utf8');
    expect(s).toMatch(/<DynamicChoiceSelect[\s\S]{0,400}alanlar=\{Object\.fromEntries\(visibleFields\.map\(\(v\) => \[v\.name, v\.label \|\| v\.name\]\)\)\}/);
  });
});
