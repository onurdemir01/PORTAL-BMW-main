// src/components/denetim/__tests__/EkipKaynak.test.tsx — ekip adı KAYNAĞIYLA (2026-11-02).
//
// Kullanıcı: namespace sahibini uygulamanın sahibi gibi yazmak geri dönüş almada sorun çıkarıyor;
// sahip uygulama başına, bulunamazsa namespace sahibi gösterilir ve bu işaretlenir.
//   EK1 OwnerCell: uygulama kaynağı işaretsiz, ipucunda kaynak; NAMESPACE yanında "(namespace sahibi)"
//   EK2 OwnerCell: kaynak bilgisi yok (uygulama tablosu henüz yok) -> eskisi gibi, işaret yok
//   EK3 OwnerCell: veri yok / bilinmiyor durumları değişmedi
//   EK4 EkipListesi: karışık kaynak, boş liste metni, bilinmeyen kaynak kodu
//   EK5 namespace tablosu okunamadı (veriYokNs / veriYok): "veri yok" + ipucu, "bilinmiyor" değil
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { OwnerCell } from '@/components/denetim/OwnerCell';
import { EkipListesi, kaynakEtiketi } from '@/components/denetim/EkipKaynak';

describe('Ekip kaynağı', () => {
  it('EK1 uygulama sahibi işaretsiz; namespace yedeği "(namespace sahibi)" ile işaretli', () => {
    render(
      <OwnerCell
        owner={{
          groups: ['SI51-AGILE-12891', 'GT-NS-TEST'],
          emails: ['agile@x', 'ns@x'],
          unknownNs: [],
          namespaces: ['muh-prod', 'muh-test'],
          kaynaklar: ['SI51_AGILE', 'NAMESPACE'],
          nsSahibi: ['muh-test'],
          appReady: true,
        }}
      />,
    );
    const app = screen.getByText('SI51-AGILE-12891');
    expect(app.getAttribute('title')).toContain('CMDB Code Repository kaydı — Agile Takım');
    expect(app.parentElement?.textContent).not.toContain('namespace sahibi');
    const ns = screen.getByText('GT-NS-TEST');
    expect(ns.getAttribute('title')).toContain('Namespace sahibi — uygulama düzeyinde sahip bulunamadı ya da aranmadı');
    // ARK disi cluster'larda uygulama duzeyi sahip hic aranmaz (lookup_status ARK_DISI): metin bunu soylemeli.
    expect(ns.getAttribute('title')).toContain('yalnız ARK cluster’larında aranır');
    expect(ns.parentElement?.textContent).toContain('(namespace sahibi)');
    expect(screen.getAllByText('(namespace sahibi)')).toHaveLength(1);
  });

  it('EK2 kaynak bilgisi yoksa (uygulama tablosu henüz yok) eskisi gibi: işaret yok', () => {
    render(<OwnerCell owner={{ groups: ['GT-NS'], emails: ['ns@x'], unknownNs: [], namespaces: ['a-prod'], kaynaklar: [] }} />);
    expect(screen.getByText('GT-NS').getAttribute('title')).toBe('GT-NS\nns@x\nnamespace: a-prod');
    expect(screen.queryByText('(namespace sahibi)')).toBeNull();
  });

  it('EK3 veri yok / bilinmiyor durumları değişmedi', () => {
    const { unmount } = render(<OwnerCell ready={false} />);
    expect(screen.getByText('veri yok').getAttribute('title')).toContain('dbo.Openshift_App_Owners');
    unmount();
    render(<OwnerCell owner={{ groups: [], emails: [], unknownNs: ['x-prod'], kaynaklar: [] }} />);
    expect(screen.getByText('bilinmiyor').getAttribute('title')).toBe('CMDB\'de sorumlu bulunamadı: x-prod');
  });

  it('EK4 EkipListesi: karışık kaynak, boş metin, bilinmeyen kod', () => {
    const { container, unmount } = render(
      <EkipListesi groups={['A', 'B', 'C']} kaynaklar={['ARK997_YAZILIM', 'NAMESPACE', '']} />,
    );
    expect(container.textContent).toBe('A, B (namespace sahibi), C');
    expect(screen.getByText('A').getAttribute('title')).toBe('A\nCMDB ARK Application kaydı — Yazılım Geliştirme Sorumlusu');
    expect(screen.getByText('C').getAttribute('title')).toBe('C');
    unmount();
    render(<EkipListesi groups={[]} bos="—" />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(kaynakEtiketi('yeni_kod')).toBe('kaynak: YENI_KOD');
    expect(kaynakEtiketi(null)).toBe('');
  });

  it('EK5 namespace tablosu okunamadı (veriYokNs): "bilinmiyor" değil "veri yok", ipucunda neden', () => {
    const { unmount } = render(
      <OwnerCell owner={{ groups: [], emails: [], unknownNs: [], veriYokNs: ['b-prod'], kaynaklar: [], appReady: true }} />,
    );
    expect(screen.queryByText('bilinmiyor')).toBeNull();
    const v = screen.getByText('veri yok');
    expect(v.getAttribute('title')).toContain('dbo.Openshift_Namespace_Owners');
    expect(v.getAttribute('title')).toContain('b-prod');
    unmount();
    // Bir ortamda sahip var, diğerinde veri yok: grup + "+veri yok" işareti.
    const r2 = render(
      <OwnerCell owner={{ groups: ['GT-Uyg'], emails: [], unknownNs: [], veriYokNs: ['b-test'], kaynaklar: ['SI51_AGILE'], appReady: true }} />,
    );
    expect(screen.getByText('GT-Uyg')).toBeTruthy();
    expect(screen.getByText('+veri yok').getAttribute('title')).toContain('b-test');
    r2.unmount();
    // EkipListesi: veriYok bayrağıyla "veri yok"; bayraksız boş liste eskisi gibi "bilinmiyor".
    const r3 = render(<EkipListesi groups={[]} veriYok />);
    expect(screen.getByText('veri yok').getAttribute('title')).toContain('okunamadı');
    r3.unmount();
    render(<EkipListesi groups={[]} />);
    expect(screen.getByText('bilinmiyor')).toBeTruthy();
  });
});
