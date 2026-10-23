// src/components/server_hub/__tests__/KurallarTab.test.tsx — Server Hub › Kurallar & Limitler (2026-10-20).
//
// Kullanıcı: "hangi maddeler taranıyor ve hangi maddelerin hangi çıktıları kritik, uyarı, bilgi ve
// sorun yok olarak algılanıyor? ... istediğimde kritiklik seviyesini değiştirebilmek istiyorum" ve
// "tek seferde kaç sunucu yazılabileceğini oraya göster ... limitin arttırılabilmesi için adminlere yetki".
//   KT1 maddeler alan alan; her çıktının kodu, varsayılan ve geçerli seviyesi, son tarama sayısı;
//       "sorun yok" çıktısı bulgu üretmez; ölçülemeyen sayı "—" (0 değil); seviyelerin etkisi yazılı
//   KT2 seviye değiştirme: seçim → açıklama → Kaydet; API kod + seviye + açıklama ile; liste tazelenir;
//       İptal hiçbir şey göndermez
//   KT3 değiştirilmiş satır işaretli (kim, ne zaman, açıklama) ve "Varsayılana dön" varsayılanı gönderir
//   KT4 süzgeç: yalnız değiştirilenler, arama, alan
//   KT5 limitler: şu an / varsayılan / üst sınır; aralık dışı değer kaydedilmez; Kaydet API'ye gider;
//       ayarlar okunamadıysa bant ve tüm değiştirme denetimleri kilitli
//   KT6 geçmiş: kim, ayar, eski → yeni (seviye adlarıyla), açıklama
//   KT7 girdi ekranları limiti gösterir: sunucu adı ayrıştırma, "N / M sunucu", aşınca kırmızı + neden;
//       üç ekran da sabit 50 / 500 yerine ayardaki limiti kullanır (kaynak bekçisi)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import fs from 'node:fs';
import path from 'node:path';
import KurallarTab from '@/components/server_hub/KurallarTab';
import { LimitNotu, sunucuAdlari, limitAsildi } from '@/components/server_hub/sunucuLimiti';
import type { ShKurallar } from '@/api/serverHubApi';

const mockKurallar = vi.hoisted(() => vi.fn());
const mockSeviye = vi.hoisted(() => vi.fn());
const mockLimit = vi.hoisted(() => vi.fn());
vi.mock('@/api/serverHubApi', () => ({
  serverHubApi: { kurallar: mockKurallar, seviyeDegistir: mockSeviye, limitDegistir: mockLimit, limitler: vi.fn() },
}));

function veri(o: Partial<ShKurallar> = {}): ShKurallar {
  return {
    ok: true,
    okunamadi: false,
    taramaTarihi: '2026-10-20',
    sayimOlculdu: true,
    alanlar: { jvm: 'JVM', web: 'Web sunucu' },
    maddeler: [
      {
        id: 'autostart',
        alan: 'jvm',
        alanAd: 'JVM',
        ad: 'Auto-start ↔ çalışma durumu',
        neTaranir: 'JVM çalışma durumu ile auto-start uyumlu mu.',
        ciktilar: [
          { kod: 'REBOOT_RISK', kosul: 'JVM çalışıyor ama auto-start kapalı.', varsayilan: 'danger', gecerli: 'warning', degistiren: 'ayse', zaman: '2026-10-20T08:00:00Z', aciklama: 'test ortamı', bulgu: 3, sunucu: 2 },
          { kod: 'STOPPED_AUTOSTART_ON', kosul: 'JVM kapalı ama auto-start açık.', varsayilan: 'warning', gecerli: 'warning', bulgu: 0, sunucu: 0 },
          { kod: null, kosul: 'Çalışıyor + auto-start açık.', varsayilan: 'ok', gecerli: 'ok' },
        ],
      },
      {
        id: 'web-sozdizimi',
        alan: 'web',
        alanAd: 'Web sunucu',
        ad: 'Web sunucu sözdizimi',
        neTaranir: 'apachectl -t / nginx -t.',
        ciktilar: [
          { kod: 'SYNTAX_FAIL', kosul: 'Sözdizimi hatası doğrulandı.', varsayilan: 'danger', gecerli: 'danger', bulgu: null, sunucu: null },
          { kod: null, kosul: 'Sözdizimi doğru.', varsayilan: 'ok', gecerli: 'ok' },
        ],
      },
    ],
    limitler: [
      { ad: 'tara', etiket: 'Şimdi tara', aciklama: 'server_hub_scan', varsayilan: 50, ust: 1000, gecerli: 50, degistiren: null, zaman: null, not: '' },
      { ad: 'reboot', etiket: 'Reboot Kontrolü', aciklama: 'reboot_check', varsayilan: 50, ust: 500, gecerli: 120, degistiren: 'veli', zaman: '2026-10-19T08:00:00Z', not: 'patch günü' },
    ],
    gecmis: [{ anahtar: 'seviye:REBOOT_RISK', eski: 'danger', yeni: 'warning', aciklama: 'test ortamı', degistiren: 'ayse', zaman: '2026-10-20T08:00:00Z' }],
    ...o,
  };
}
const satir = (kod: string) => screen.getByText(kod).closest('tr') as HTMLElement;

describe('Server Hub › Kurallar & Limitler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKurallar.mockResolvedValue(veri());
    mockSeviye.mockResolvedValue({ ok: true, eski: 'warning', yeni: 'info' });
    mockLimit.mockResolvedValue({ ok: true, eski: '120', yeni: '200' });
  });

  it('KT1 maddeler, çıktılar, seviyeler, sayılar; sorun yok bulgu üretmez; ölçülemedi "—"', async () => {
    render(<KurallarTab />);
    expect(await screen.findByText('Auto-start ↔ çalışma durumu')).toBeTruthy();
    expect(screen.getByText('Ne taranır: JVM çalışma durumu ile auto-start uyumlu mu.')).toBeTruthy();
    const rr = satir('REBOOT_RISK');
    expect(within(rr).getByText('kritik')).toBeTruthy();
    expect((within(rr).getByLabelText('REBOOT_RISK seviyesi') as HTMLSelectElement).value).toBe('warning');
    expect(within(rr).getByText('3 bulgu · 2 sunucu')).toBeTruthy();
    expect(within(satir('STOPPED_AUTOSTART_ON')).getByText('0 bulgu · 0 sunucu')).toBeTruthy();
    expect(within(satir('SYNTAX_FAIL')).getByTitle('Son tarama okunamadı — ölçülemedi').textContent).toBe('—');
    expect(screen.getAllByText('bulgu üretilmez')).toHaveLength(2);
    const ok = screen.getByText('Çalışıyor + auto-start açık.').closest('tr') as HTMLElement;
    expect(within(ok).queryByRole('combobox')).toBeNull();
    const etki = screen.getByLabelText('Seviyelerin etkisi');
    for (const t of ['Sunucu durumu kritik olur', 'Sunucu durumu uyarı olur', 'en fazla “bilgi”', 'Bulgu listede kalır ama sayılmaz'])
      expect(etki.textContent).toContain(t);
    expect(screen.getByText(/Açılış Hazırlığı ve özet kartları/)).toBeTruthy();
  });

  it('KT2 seviye değiştirme: açıklama + Kaydet; İptal göndermez', async () => {
    render(<KurallarTab />);
    await screen.findByText('STOPPED_AUTOSTART_ON');
    fireEvent.change(screen.getByLabelText('STOPPED_AUTOSTART_ON seviyesi'), { target: { value: 'info' } });
    fireEvent.click(screen.getByText('İptal'));
    expect(mockSeviye).not.toHaveBeenCalled();
    expect((screen.getByLabelText('STOPPED_AUTOSTART_ON seviyesi') as HTMLSelectElement).value).toBe('warning');
    fireEvent.change(screen.getByLabelText('STOPPED_AUTOSTART_ON seviyesi'), { target: { value: 'info' } });
    const aciklama = screen.getByLabelText('STOPPED_AUTOSTART_ON değişiklik açıklaması');
    fireEvent.change(aciklama, { target: { value: 'gürültü' } });
    fireEvent.click(within(aciklama.closest('tr') as HTMLElement).getByText('Kaydet'));
    await waitFor(() => expect(mockSeviye).toHaveBeenCalledWith('STOPPED_AUTOSTART_ON', 'info', 'gürültü'));
    await waitFor(() => expect(mockKurallar).toHaveBeenCalledTimes(2));
    expect(mockKurallar).toHaveBeenLastCalledWith(true);
  });

  it('KT3 değiştirilmiş satır işaretli; varsayılana dön varsayılanı gönderir', async () => {
    render(<KurallarTab />);
    const rr = satir(await screen.findByText('REBOOT_RISK').then(() => 'REBOOT_RISK'));
    expect(rr.textContent).toMatch(/değiştiren ayse/);
    expect(rr.textContent).toMatch(/“test ortamı”/);
    expect(within(satir('STOPPED_AUTOSTART_ON')).queryByText(/Varsayılana dön/)).toBeNull();
    fireEvent.click(within(rr).getByText(/Varsayılana dön/));
    await waitFor(() => expect(mockSeviye).toHaveBeenCalledWith('REBOOT_RISK', 'danger', ''));
  });

  it('KT4 süzgeçler: yalnız değiştirilenler, arama, alan', async () => {
    render(<KurallarTab />);
    await screen.findByText('Web sunucu sözdizimi');
    fireEvent.click(screen.getByLabelText(/Yalnız seviyesi değiştirilenler \(1\)/));
    expect(screen.queryByText('Web sunucu sözdizimi')).toBeNull();
    expect(screen.getByText('Auto-start ↔ çalışma durumu')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Yalnız seviyesi değiştirilenler/));
    // kod küçük harfle aranabilmeli (Türkçe "I" → "ı" tuzağı)
    fireEvent.change(screen.getByLabelText('Madde, kod ya da koşul ara'), { target: { value: 'syntax_fail' } });
    expect(screen.queryByText('Auto-start ↔ çalışma durumu')).toBeNull();
    expect(screen.getByText('Web sunucu sözdizimi')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Madde, kod ya da koşul ara'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Alana göre süz'), { target: { value: 'jvm' } });
    expect(screen.queryByText('Web sunucu sözdizimi')).toBeNull();
  });

  it('KT5 limitler: değerler, aralık dışı kaydedilmez, Kaydet; okunamadıysa kilitli', async () => {
    const { unmount } = render(<KurallarTab />);
    const reboot = await screen.findByLabelText('Reboot Kontrolü tek seferde en fazla sunucu');
    const tr = reboot.closest('tr') as HTMLElement;
    expect(tr.textContent).toMatch(/120.*50.*500/);
    expect(tr.textContent).toMatch(/değiştiren veli/);
    const kaydet = within(tr).getByText('Kaydet') as HTMLButtonElement;
    expect(kaydet.disabled).toBe(true);
    fireEvent.change(reboot, { target: { value: '501' } });
    expect(within(tr).getByText('1 ile 500 arasında bir tam sayı girin.')).toBeTruthy();
    expect(kaydet.disabled).toBe(true);
    fireEvent.change(reboot, { target: { value: '200' } });
    fireEvent.change(within(tr).getByLabelText('Reboot Kontrolü limit açıklaması'), { target: { value: 'büyük patch' } });
    fireEvent.click(kaydet);
    await waitFor(() => expect(mockLimit).toHaveBeenCalledWith('reboot', 200, 'büyük patch'));
    unmount();
    mockKurallar.mockResolvedValue(veri({ okunamadi: true, hata: 'baglanti yok' }));
    render(<KurallarTab />);
    expect(await screen.findByText(/Server Hub ayarları okunamadı \(baglanti yok\)/)).toBeTruthy();
    expect((screen.getByLabelText('REBOOT_RISK seviyesi') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Şimdi tara tek seferde en fazla sunucu') as HTMLInputElement).disabled).toBe(true);
  });

  it('KT6 geçmiş', async () => {
    render(<KurallarTab />);
    fireEvent.click(await screen.findByText('Değişiklik geçmişi'));
    const t = screen.getByText('REBOOT_RISK seviyesi').closest('tr') as HTMLElement;
    expect(t.textContent).toMatch(/ayse/);
    expect(t.textContent).toMatch(/kritik → uyarı/);
    expect(t.textContent).toMatch(/test ortamı/);
  });
});

describe('KT7 girdi ekranlarında tek seferde sunucu sayısı', () => {
  it('ayrıştırma, gösterge ve aşım', () => {
    expect(sunucuAdlari('gbapp01, GBAPP02.fw.garanti.com.tr:8080\ngbapp01;  gbapp03 gbapp04:8080')).toEqual(['GBAPP01', 'GBAPP02', 'GBAPP03', 'GBAPP04']);
    expect(limitAsildi({ enCok: null, tahmini: false }, 9999)).toBe(false);
    expect(limitAsildi({ enCok: 2, tahmini: false }, 3)).toBe(true);
    const { rerender } = render(<LimitNotu limit={{ enCok: 50, tahmini: false }} sayi={12} />);
    expect(screen.getByTestId('sunucu-limiti').textContent).toBe('12 / 50 sunucu · tek seferde en fazla 50');
    rerender(<LimitNotu limit={{ enCok: 50, tahmini: true }} sayi={53} />);
    const t = screen.getByTestId('sunucu-limiti');
    expect(t.textContent).toMatch(/53 \/ 50 sunucu .* \(varsayılan; güncel limit okunamadı\) — 3 fazla; listeyi bölün ya da Admin Kurallar & Limitler'den artırsın/);
    expect(t.getAttribute('style')).toContain('--status-danger-text');
  });

  it('üç ekran ayardaki limiti kullanır (sabit 50 / 500 yok)', () => {
    const kok = path.resolve(__dirname, '..');
    const sh = fs.readFileSync(path.join(kok, 'ServerHubPage.tsx'), 'utf8');
    const rk = fs.readFileSync(path.join(kok, 'RebootKontroluTab.tsx'), 'utf8');
    expect(sh).toMatch(/const taraLimiti = useSunucuLimiti\('tara'\)/);
    expect(sh).toMatch(/limitAsildi\(taraLimiti, rows\.length\)/);
    expect(sh).toMatch(/<LimitNotu limit=\{taraLimiti\} sayi=\{rows\.length\} \/>/);
    expect(sh).toMatch(/const hazirlikLimiti = useSunucuLimiti\('hazirlik'\)/);
    expect(sh).toMatch(/<LimitNotu limit=\{hazirlikLimiti\} sayi=\{girilen\} \/>/);
    expect(sh).not.toMatch(/rows\.length > 50/);
    expect(rk).toMatch(/const rebootLimiti = useSunucuLimiti\('reboot'\)/);
    expect(rk).toMatch(/<LimitNotu limit=\{rebootLimiti\} sayi=\{hosts\.length\} \/>/);
    expect(rk).not.toMatch(/hosts\.length > 50/);
    expect(sh).toMatch(/\{ id: 'kurallar', label: 'Kurallar & Limitler' \}/);
    expect(sh).toMatch(/\{tab === 'kurallar' && <KurallarTab \/>\}/);
    // sınır aşılınca düğme kilitli (sunucu da reddeder; ekran önceden söyler)
    expect(sh).toMatch(/disabled=\{busy \|\| !metin\.trim\(\) \|\| limitAsildi\(hazirlikLimiti, girilen\)\}/);
    expect(sh).toMatch(/const girilen = sunucuAdlari\(metin\)\.length;/);
    expect(rk).toMatch(/disabled=\{!hosts\.length \|\| limitAsildi\(rebootLimiti, hosts\.length\) \|\| busy\}/);
  });

  it('rapor seviye değişikliğini gizlemez: bant, bulgu işareti, "sorun yok" süzgeci', () => {
    const sh = fs.readFileSync(path.resolve(__dirname, '..', 'ServerHubPage.tsx'), 'utf8');
    expect(sh).toMatch(/<SeviyeAyarBandi ayar=\{data\.ayar\} \/>/);
    expect(sh).toMatch(/bulgu kodunun seviyesi Admin tarafından değiştirildi/);
    expect(sh).toMatch(/Server Hub ayarları okunamadı: bu raporda varsayılan seviyeler uygulandı\./);
    expect((sh.match(/<SeviyeDegistiIsareti d=\{f\.defaultSeverity\} \/>/g) || []).length).toBe(2);
    expect(sh).toMatch(/<option value="ok">sorun yok \(seviyesi değiştirilen\)<\/option>/);
  });
});
