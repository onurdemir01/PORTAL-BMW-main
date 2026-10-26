// IN-PLACE uyarisi (2026-10-26). Kullanici: "Eger JBoss ya da uygulamasi icin ayni sunucuda JBoss 8 de
// kesfedilirse giris yapan kisiyi uyaralim, dikkatli ol ... Hicbir sey engellemesin ama insanlar yine de
// bilincinde olsun."
//   IP1 inPlaceOzeti: yalniz SECILI ve inPlace === true hedefler; null / yok (eski kayit) uyari uretmez
//   IP2 diger kurulum da seciliyse ayrica soylenir (dokunulmaz DENMEZ); elle vhost sayilir
//   IP3 InPlaceUyari: hangi sunucu / uygulama / diger kurulum, dokunulmayanlar, 'elle' vhost'lar, isten sonra kontrol
//   IP4 in-place secili degilse kutu yok; kutu ENGELLEMEZ (dugme yok); canli bolge degil (secim degistikce parca duyurmasin)
//   IP5 STOP baglami: kontrol onerisi "STOP bittikten sonra"
//   IP6 inPlaceIpucu (satir cipi): diger kurulum adi; liste bossa bos metin degil; sertifika da soylenir
//   IP7 (denetim B1) diger kurulum da seciliyse "hala calisiyor mu" DENMEZ; kismi secimde yalniz secili olmayan icin
//   IP8 STOP baglaminda diger kurulum KAYITTA hedefse (onayda olmasa da) "bu kayitta hedef" der
//   IP9 (denetim B8) ozel uyari gorsel olarak ayrisir: kalin sol cizgi + IN-PLACE cipi
// Kaynak bekcisi (CreateModal yerlesimi, create() inPlace'e bakmaz): server/retirement/__tests__/ekran-tablo.test.cjs.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { InPlaceUyari, inPlaceIpucu, inPlaceOzeti, type InPlaceHedef } from '@/components/server_hub/RetirementInPlace';

// discover.cjs inPlaceIsaretle ciktisinin bicimi (in-place.test.cjs IN1/IN5 ile ayni senaryo).
const elle = 'in-place: GBPOSWEBAPI bu sunucuda JBoss 8 kurulumunda da var; ... elle kontrol edilmeli';
const j7: InPlaceHedef = { host: 'GBJEXP05', appName: 'GBPOSWEBAPI', gen: 7, inPlace: true, digerSurumler: [8], web: [{ elle }, { elle }, {}] };
const j8: InPlaceHedef = { host: 'GBJEXP05', appName: 'GBPOSWEBAPI', gen: 8, inPlace: true, digerSurumler: [7], web: [] };
const tek: InPlaceHedef = { host: 'GBJEXP06', appName: 'GBPOSWEBAPI', gen: 7, web: [] };

describe('Retirement in-place uyarisi', () => {
  it('IP1 yalniz secili ve inPlace === true', () => {
    expect(inPlaceOzeti([tek])).toEqual([]);
    expect(inPlaceOzeti([{ ...j7, inPlace: null }])).toEqual([]);
    expect(inPlaceOzeti([{ ...j7, inPlace: undefined }])).toEqual([]);
    const l = inPlaceOzeti([j7, tek]);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ host: 'GBJEXP05', appName: 'GBPOSWEBAPI', gen: 7, diger: [8], digerSecili: [], elle: 2 });
  });

  it('IP2 diger kurulum da seciliyse ayrica soylenir', () => {
    const l = inPlaceOzeti([j7, { ...j8, host: 'gbjexp05' }]);
    expect(l.map((x) => x.digerSecili)).toEqual([[8], [7]]);
  });

  it('IP3 kutu: sunucu, uygulama, diger kurulum, dokunulmayanlar, elle, kontrol onerisi', () => {
    const { container: c1 } = render(<InPlaceUyari hedefler={[j7, tek]} />);
    const kutu = c1.querySelector('[data-rt-inplace]') as HTMLElement;
    expect(kutu).toHaveTextContent('Dikkatli olun: seçili 1 hedef in-place');
    const satir = kutu.querySelector('[data-rt-inplace-liste] li') as HTMLElement;
    expect(satir).toHaveTextContent('seçilen JBoss 7; aynı sunucuda: JBoss 8 (seçili değil: dokunulmaz) · 2 vhost elle');
    expect(satir).toHaveAttribute('title', satir.textContent);
    expect(kutu).toHaveTextContent('diğer kurulumun JVM’ine ve paketine dokunulmaz');
    expect(kutu).toHaveTextContent('otomatik kapatılmaz');
    expect(kutu).toHaveTextContent('İşi başlattıktan sonra kontrol edin: diğer kurulumun JVM’i hâlâ çalışıyor mu (Server Hub)');
    expect(kutu).toHaveTextContent('Bu uyarı hiçbir adımı engellemez.');
    // Iki kurulum birden secildiyse "dokunulmaz" denmez.
    const { container } = render(<InPlaceUyari hedefler={[j7, j8]} />);
    expect(container).toHaveTextContent('JBoss 8 de seçili: ayrı hedef olarak işlenir');
    expect(container).not.toHaveTextContent('seçili değil: dokunulmaz');
  });

  it('IP4 in-place secili degilse kutu yok; kutu engellemez', () => {
    const { container } = render(<InPlaceUyari hedefler={[tek, { ...j7, inPlace: null }]} />);
    expect(container).toBeEmptyDOMElement();
    const r = render(<InPlaceUyari hedefler={[j7]} />);
    expect(r.container.querySelector('button, input, [role="alert"], [role="status"], [aria-live]')).toBeNull();
  });

  it('IP5 STOP baglami', () => {
    const { container } = render(<InPlaceUyari hedefler={[j7]} baglam="stop" />);
    expect(container.querySelector('[data-rt-inplace]')).toHaveTextContent('STOP bittikten sonra kontrol edin');
  });

  it('IP6 satir cipi ipucu', () => {
    expect(inPlaceIpucu([8])).toMatch(/^Bu sunucuda uygulama JBoss 8 kurulumunda da var\. .*DOKUNULMAZ/);
    expect(inPlaceIpucu([0])).toMatch(/uygulama sürümü bilinmeyen kurulumunda da var/);
    expect(inPlaceIpucu([])).toMatch(/başka bir JBoss kurulumunda da var/);
    expect(inPlaceIpucu(null)).toMatch(/başka bir JBoss kurulumunda da var/);
    expect(inPlaceIpucu([8])).toMatch(/adı ya da sertifikasıyla eşleşen vhost’lar otomatik kapatılmaz/);
  });

  it('IP7 diger kurulum da seciliyse "hala calisiyor mu" denmez; kismi secimde yalniz secili olmayan icin sorulur', () => {
    const { container } = render(<InPlaceUyari hedefler={[j7, j8]} />);
    expect(container).toHaveTextContent('aynı sunucudaki kurulumların hepsi seçili — diğer kurulumun çalışmaya devam etmesi beklenmez');
    expect(container).toHaveTextContent('‘elle’ çipli vhost’lar otomatik kapatılmaz, kurulumlar durduktan sonra elle kapatılmalı');
    expect(container).not.toHaveTextContent('hâlâ çalışıyor mu');
    expect(container).not.toHaveTextContent('diğer kurulumun JVM’ine ve paketine dokunulmaz');
    // Kismi: GBJEXP05'te iki kurulum secili, GBJEXP09'da yalniz biri -> "seçili olmayan diger kurulum".
    const j9: InPlaceHedef = { ...j7, host: 'GBJEXP09' };
    const k = render(<InPlaceUyari hedefler={[j7, j8, j9]} />).container;
    expect(k).toHaveTextContent('kontrol edin: seçili olmayan diğer kurulumun JVM’i hâlâ çalışıyor mu (Server Hub)');
  });

  it('IP8 STOP baglaminda diger kurulum kayitta hedefse "bu kayitta hedef" der', () => {
    const { container } = render(<InPlaceUyari hedefler={[j7]} baglam="stop" kayittakiler={[j7, j8]} />);
    expect(container).toHaveTextContent('JBoss 8 de bu kayıtta hedef: ayrı hedef olarak işlenir');
    expect(container).toHaveTextContent('STOP bittikten sonra kontrol edin: aynı sunucudaki kurulumların hepsi bu kayıtta hedef');
    expect(container).not.toHaveTextContent('hâlâ çalışıyor mu');
    const yok = render(<InPlaceUyari hedefler={[j7]} baglam="stop" kayittakiler={[j7]} />).container;
    expect(yok).toHaveTextContent('(bu kayıtta hedef değil: dokunulmaz)');
    expect(yok).toHaveTextContent('diğer kurulumun JVM’i hâlâ çalışıyor mu');
  });

  it('IP9 ozel uyari: kalin sol cizgi ve IN-PLACE cipi', () => {
    const { container } = render(<InPlaceUyari hedefler={[j7]} />);
    const kutu = container.querySelector('[data-rt-inplace] > div') as HTMLElement;
    expect(kutu.style.boxShadow).toMatch(/^inset 4px 0 0 var\(--status-warning\)/);
    expect(container.querySelector('[data-rt-inplace]')).toHaveTextContent(/^IN-PLACE Dikkatli olun/);
  });
});
