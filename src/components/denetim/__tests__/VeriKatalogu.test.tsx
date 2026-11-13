// src/components/denetim/__tests__/VeriKatalogu.test.tsx
//
// Denetim > Veri Kataloğu (2026-11-13). Kilitlenen davranış:
//   - arama tablo adı, amaç, yazan (dosya dahil) ve okuyan üzerinde; Türkçe İ/ı
//   - süzgeçler: veritabanı, alan, yazan türü, kullanılmıyor
//   - satır açılınca yazanlar (nasıl / ne zaman / dosya), okuyanlar, saklama, notlar, güven
//   - sapma paneli sayıları; okunamayan DB uyarısı ve "?" hücreleri
//   - alan sıralamasında grup başlıkları; satır sütununa göre sıralama
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import VeriKatalogu from '@/components/denetim/VeriKatalogu';
import type { KatalogTablo, VeriKataloguResult } from '@/api/denetimApi';

const mockApi = vi.hoisted(() => vi.fn());
vi.mock('@/api/denetimApi', () => ({
  denetimApi: { veriKatalogu: mockApi },
}));

const T = (o: Partial<KatalogTablo> & Pick<KatalogTablo, 'db' | 'tablo'>): KatalogTablo => ({
  amac: `${o.tablo} amacı`,
  alan: 'Envanter',
  yazanlar: [],
  okuyanlar: [],
  saklama: '',
  notlar: '',
  kullanilmiyor: false,
  guven: 'KESIN',
  durum: 'var',
  satir: 1,
  mb: 0.5,
  ...o,
});

const VERI: VeriKataloguResult = {
  ok: true,
  hesaplandi: '2026-11-13T10:00:00.000Z',
  ayniFiziksel: false,
  veritabanlari: [
    { db: 'Portal', ok: true, dbAdi: 'PORTAL', boyutVar: true, tabloSayisi: 3, toplamMb: 3, katalogSayisi: 2 },
    { db: 'TBMWANS', ok: true, dbAdi: 'TBMWANS', boyutVar: true, tabloSayisi: 2, toplamMb: 100, katalogSayisi: 2 },
  ],
  tablolar: [
    T({
      db: 'Portal',
      tablo: 'portal_users',
      alan: 'Kimlik / Oturum',
      amac: 'Portal kullanıcıları ve rolleri',
      yazanlar: [{ tur: 'portal', ad: 'Giriş akışı', dosya: 'server/auth/users.cjs:12', nasil: 'MERGE', ne_zaman: 'Her girişte' }],
      okuyanlar: [{ ad: 'Admin kullanıcı listesi', dosya: 'server/admin/users.cjs:5', uzerinden: 'server/auth/user-store.cjs' }],
      saklama: 'süresiz',
      notlar: 'LDAP ile eşlenir',
      satir: 50,
    }),
    T({ db: 'Portal', tablo: 'splunk_products', alan: 'Ayarlar', kullanilmiyor: true, guven: 'MAKUL', durum: 'yok', satir: null, mb: null }),
    T({
      db: 'TBMWANS',
      tablo: 'Inventory',
      amac: 'Sunucu envanteri (İstanbul)',
      yazanlar: [{ tur: 'playbook', ad: 'middleware_inventory', dosya: 'bmw_inventory/middleware_inventory.yml', nasil: 'TRUNCATE + INSERT', ne_zaman: 'Günlük' }],
      satir: 9000,
      mb: 120,
    }),
    T({ db: 'TBMWANS', tablo: 'Servers', yazanlar: [{ tur: 'bilinmiyor', ad: 'bilinmiyor', dosya: '', nasil: '', ne_zaman: '' }], kullanilmiyor: true, satir: 3 }),
  ],
  sapma: {
    katalogdaYok: [{ db: 'Portal', tablo: 'yeni_tablo', satir: 7, mb: 0.1 }],
    veritabanindaYok: [{ db: 'Portal', tablo: 'splunk_products', alan: 'Ayarlar', kullanilmiyor: true }],
  },
  secenekler: {
    veritabanlari: ['Portal', 'TBMWANS'],
    alanlar: ['Ayarlar', 'Envanter', 'Kimlik / Oturum'],
    yazanTurleri: ['portal', 'playbook', 'betik', 'bilinmiyor'],
    guvenler: ['KESIN', 'MAKUL'],
  },
};

const tablolar = () => screen.getAllByTestId('katalog-satir').map((r) => within(r).getAllByRole('cell')[1].querySelector('.font-mono')?.textContent);

async function ac(veri: VeriKataloguResult = VERI) {
  mockApi.mockResolvedValue(veri);
  render(<VeriKatalogu />);
  await screen.findByText('portal_users');
}

describe('VeriKatalogu', () => {
  beforeEach(() => mockApi.mockReset());

  it('arama: tablo adı, amaç, yazan dosyası, okuyan; Türkçe İ', async () => {
    await ac();
    const ara = screen.getByLabelText('Katalogda ara');
    fireEvent.change(ara, { target: { value: 'middleware_inventory.yml' } });
    expect(tablolar()).toEqual(['Inventory']);
    fireEvent.change(ara, { target: { value: 'istanbul' } });
    expect(tablolar()).toEqual(['Inventory']);
    fireEvent.change(ara, { target: { value: 'kullanıcı listesi' } });
    expect(tablolar()).toEqual(['portal_users']);
    fireEvent.change(ara, { target: { value: 'user-store' } });
    expect(tablolar()).toEqual(['portal_users']);
    fireEvent.change(ara, { target: { value: 'SPLUNK' } });
    expect(tablolar()).toEqual(['splunk_products']);
    fireEvent.change(ara, { target: { value: 'hicbir-sey' } });
    expect(screen.getByText('Süzgeçlere uyan tablo yok.')).toBeInTheDocument();
  });

  it('süzgeçler: veritabanı, alan, yazan türü, kullanım', async () => {
    await ac();
    expect(screen.getByTestId('katalog-sayac')).toHaveTextContent('4 / 4 tablo');
    fireEvent.change(screen.getByLabelText('Veritabanı'), { target: { value: 'TBMWANS' } });
    expect(tablolar()).toEqual(['Inventory', 'Servers']);
    fireEvent.change(screen.getByLabelText('Yazan türü'), { target: { value: 'playbook' } });
    expect(tablolar()).toEqual(['Inventory']);
    fireEvent.click(screen.getByText('Süzgeçleri temizle'));
    fireEvent.change(screen.getByLabelText('Kullanım'), { target: { value: 'kullanilmayan' } });
    expect(tablolar()).toEqual(['splunk_products', 'Servers']);
    fireEvent.change(screen.getByLabelText('Kullanım'), { target: { value: 'tumu' } });
    fireEvent.change(screen.getByLabelText('Alan'), { target: { value: 'Kimlik / Oturum' } });
    expect(tablolar()).toEqual(['portal_users']);
  });

  it('satır açılınca yazan / okuyan / saklama / notlar / güven görünür', async () => {
    await ac();
    expect(screen.queryByTestId('katalog-ayrinti')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'portal_users ayrıntısı' }));
    const a = screen.getByTestId('katalog-ayrinti');
    expect(within(a).getByText('Giriş akışı')).toBeInTheDocument();
    expect(within(a).getByText('Her girişte')).toBeInTheDocument();
    expect(within(a).getByText('MERGE')).toBeInTheDocument();
    expect(within(a).getAllByText('server/auth/users.cjs:12').length).toBeGreaterThan(0);
    expect(within(a).getByText('Admin kullanıcı listesi')).toBeInTheDocument();
    // Okuyan tabloyu yardımcı modül üzerinden okuyor: modül adı görünür.
    expect(within(a).getByText('tabloya şu modül üzerinden gider:')).toBeInTheDocument();
    expect(within(a).getAllByText('server/auth/user-store.cjs').length).toBeGreaterThan(0);
    expect(within(a).getByText('süresiz')).toBeInTheDocument();
    expect(within(a).getByText('LDAP ile eşlenir')).toBeInTheDocument();
    expect(within(a).getByText(/KESİN/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'portal_users ayrıntısı' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'portal_users ayrıntısı' }));
    expect(screen.queryByTestId('katalog-ayrinti')).toBeNull();
  });

  it('sapma paneli: iki yön sayılır ve listelenir', async () => {
    await ac();
    const s = screen.getByTestId('sapma');
    expect(within(s).getByText('Katalogda yok: 1')).toBeInTheDocument();
    expect(within(s).getByText('Veritabanında yok: 1')).toBeInTheDocument();
    expect(within(s).getByText('yeni_tablo')).toBeInTheDocument();
    expect(within(s).getByText('splunk_products')).toBeInTheDocument();
    // Satırdaki rozet
    const satir = screen.getAllByTestId('katalog-satir').find((r) => r.textContent?.includes('splunk_products'))!;
    expect(within(satir).getByText('veritabanında yok')).toBeInTheDocument();
    expect(within(satir).getByText('kullanılmıyor')).toBeInTheDocument();
    expect(within(satir).getByText('MAKUL')).toBeInTheDocument();
  });

  it('okunamayan veritabanı: uyarı ve "?" hücreleri, sayfa yine çizilir', async () => {
    await ac({
      ...VERI,
      veritabanlari: [{ db: 'Portal', ok: false, hata: 'Login failed', katalogSayisi: 2 }, VERI.veritabanlari[1]],
      tablolar: VERI.tablolar.map((t) => (t.db === 'Portal' ? { ...t, durum: 'bilinmiyor', satir: null, mb: null } : t)),
      sapma: { katalogdaYok: [], veritabanindaYok: [] },
    });
    expect(screen.getByText('Portal DB okunamadı')).toBeInTheDocument();
    const satir = screen.getAllByTestId('katalog-satir').find((r) => r.textContent?.includes('portal_users'))!;
    expect(within(satir).getAllByText('?').length).toBe(2);
  });

  it('aynı fiziksel veritabanı: iki kutucuk ortak olduğunu söyler (boyut iki kez toplanmasın)', async () => {
    const ortak = { boyutVar: true, tabloSayisi: 186, toplamMb: 2048 };
    await ac({
      ...VERI,
      ayniFiziksel: true,
      veritabanlari: VERI.veritabanlari.map((v) => ({ ...v, ...ortak, dbAdi: 'TBMWANS', ayniFiziksel: true })),
    });
    // StatTile ipucunu title olarak taşır.
    const ipuclari = screen.getAllByTitle('Ortak fiziksel veritabanı (iki kutucuk aynı): 186 tablo · 2 GB');
    expect(ipuclari).toHaveLength(2);
    expect(screen.queryByTitle(/^Veritabanında 186 tablo/)).toBeNull();
  });

  it('tek veritabanı okunamadı: farkın birleşik katalogla süzüldüğü yazılır', async () => {
    await ac({
      ...VERI,
      sapmaKismi: true,
      veritabanlari: [{ db: 'Portal', ok: false, hata: 'zaman aşımı', katalogSayisi: 2 }, VERI.veritabanlari[1]],
    });
    expect(screen.getByTestId('sapma-kismi')).toHaveTextContent('iki kataloğun birleşimine göre');
  });

  it('alan sıralamasında grup başlıkları; satır sütununa göre sıralama', async () => {
    await ac();
    expect(screen.getAllByTestId('alan-basligi').map((x) => x.textContent?.split(' ·')[0])).toEqual(['Ayarlar', 'Envanter', 'Kimlik / Oturum']);
    fireEvent.click(screen.getByRole('button', { name: 'Satır' }));
    expect(screen.queryAllByTestId('alan-basligi')).toHaveLength(0);
    expect(tablolar()).toEqual(['Inventory', 'portal_users', 'Servers', 'splunk_products']);
    fireEvent.click(screen.getByRole('button', { name: /Satır/ }));
    expect(tablolar()).toEqual(['splunk_products', 'Servers', 'portal_users', 'Inventory']);
  });
});
