// src/components/app_hub/__tests__/ocp-karsilastir.test.tsx — Application Hub OCP: ortam içi cluster karşılaştırması (2026-11-23).
// Kullanıcı: "her ortam için küme halinde her cluster için alt alta gözüksün ki insanlar kontrol ederken hemen bir
// fark var mı görebilsin". Kurallar ocpKarsilastir.ts başında.
//   OK1 imajSurumu: etiket, digest kısa, etiketsiz, boş; boş etiket ('reg/ns/app:') sunucu imajCoz ile aynı
//   OK2 gruplama: ortam büyük harf, PROD önce, katalog dışı en sonda ve karşılaştırılmaz; ortamlar arası fark yok
//   OK3 çoğunluk: 3 cluster'da sapan tek üye fark alır, ipucu çoğunluk değeri; beraberlikte iki taraf "diğerleri"
//   OK4 JVM: eksik / fazla / değer farkı (sırasız, aynı argümanlar farklı sırada fark DEĞİL); referans env
//   OK5 ölçülemeyen karşılaştırmaya girmez; JVM boyut sınırıyla atılmışsa JVM farkı üretilmez
//   OK6 aynı etiket farklı imaj yolu: fark yazılır ve tam yol gösterilir
//   OK7 ekran: farklı hücre sarı + çoğunluk ipucu, durum hapı, sürüm çipleri, "tümünü göster" açılır
import { describe, it, expect } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import OcpOrtamlar from '@/components/app_hub/OcpOrtamlar';
import { imajSurumu, ortamGruplari } from '@/components/app_hub/ocpKarsilastir';
import { imajCoz } from '../../../../shared/ocpImaj.cjs';
import type { OcpCanliNesne, OcpCanliOkuma, OcpYer } from '@/api/appHubApi';

type Ctr = OcpCanliNesne['containerlar'][number];
const ctr = (o: Partial<Ctr> = {}): Ctr => ({
  ad: 'app',
  imaj: 'reg.example/ns/app:1.0.0',
  istek: { cpu: '500m', bellek: '1Gi' },
  limit: { cpu: '1', bellek: '2Gi' },
  jvmEnv: [],
  ...o,
});
const nesne = (istenen: number, containerlar: Ctr[], tur = 'Deployment'): OcpCanliNesne => ({
  tur,
  kind: tur,
  ad: 'app',
  istenen,
  hazir: istenen,
  guncel: istenen,
  mevcut: istenen,
  strateji: null,
  gitops: null,
  olusturma: null,
  containerlar,
});
const okuma = (cluster: string, o: Partial<OcpCanliOkuma> = {}): OcpCanliOkuma => ({
  cluster,
  namespace: 'ns1',
  ok: true,
  hata: null,
  alanAd: null,
  alinma: '2026-11-23T09:00:00.000Z',
  isNo: null,
  kaynak: 'saatlik',
  nesneler: [nesne(2, [ctr()])],
  podlar: [],
  podOzet: { toplam: 2, hazir: 2, listelenen: 2, okunamadi: false },
  ...o,
});
const yer = (cluster: string, ortam: string | null = 'PROD'): OcpYer => ({
  cluster,
  namespace: 'ns1',
  ortam,
  tenant: 'ark',
  konsol: null,
  katalogda: ortam !== null,
  onbellek: null,
  routelar: [],
  routeEslesme: null,
  atfedilmeyenRoute: 0,
  istek: null,
});
const jvm = (deger: string) => [{ ad: 'JAVA_OPTS', kaynak: 'deger' as const, deger }];
const uye = (g: ReturnType<typeof ortamGruplari>[number], cluster: string) =>
  g.uyeler.find((u) => u.yer.cluster === cluster)!;

describe('Application Hub — OCP ortam içi cluster karşılaştırması', () => {
  it('OK1 imajSurumu', () => {
    expect(imajSurumu('reg.example:5000/goh/acquiring-app-v0:0.0.32-391-prod')).toBe(
      '0.0.32-391-prod',
    );
    expect(imajSurumu('reg.example/x/app@sha256:0123456789abcdef0123')).toBe('sha256:0123456789ab');
    expect(imajSurumu('reg.example:5000/x/app')).toBe('latest (etiketsiz)');
    expect(imajSurumu(null)).toBe('—');
    expect(imajSurumu('  ')).toBe('—');
    // Sınır: boş etiket iki tarafta da etiketsiz (sunucu paket kurulumu kurulabilir saymaz).
    expect(imajCoz('reg.example/ns/app:').etiket).toBeNull();
    expect(imajSurumu('reg.example/ns/app:')).toBe('latest (etiketsiz)');
    expect(imajSurumu('reg.example:5000/ns/app:1.0@sha256:abc')).toBe('sha256:abc');
    expect(imajSurumu('r/a:9.9.9')).toBe(imajCoz('r/a:9.9.9').etiket);
  });

  it('OK2 gruplama ve sıralama; ortamlar arası karşılaştırma yok', () => {
    const g = ortamGruplari(
      [yer('d1', 'dev'), yer('x1', null), yer('p2'), yer('p1'), yer('q1', 'QA')],
      [
        okuma('d1', { nesneler: [nesne(1, [ctr({ imaj: 'r/a:9.9.9' })])] }),
        okuma('x1', { nesneler: [nesne(5, [ctr({ imaj: 'r/a:0.0.1' })])] }),
        okuma('p1'),
        okuma('p2'),
        okuma('q1'),
      ],
    );
    expect(g.map((x) => x.ortam)).toEqual(['PROD', 'QA', 'DEV', '']);
    expect(g[0].uyeler.map((u) => u.yer.cluster)).toEqual(['p1', 'p2']);
    expect(g[3].katalogDisi).toBe(true);
    // DEV ve katalog dışı başka sürümde: PROD'a fark yazılmaz, katalog dışı hiç karşılaştırılmaz
    expect(g.every((x) => x.farkliUye === 0)).toBe(true);
    expect(g[0].surumler).toEqual([{ surum: '1.0.0', sayi: 2 }]);
    expect(g[0].pod).toEqual({ hazir: 4, toplam: 4, olculemeyen: 0 });
    // Katalog dışı iki cluster farklı olsa da karşılaştırılmaz (ortamları aynı olduğu bilinmiyor)
    const [, k] = ortamGruplari(
      [yer('p1'), yer('x1', null), yer('x2', null)],
      [
        okuma('p1'),
        okuma('x1'),
        okuma('x2', { nesneler: [nesne(7, [ctr({ imaj: 'r/a:0.0.1' })])] }),
      ],
    );
    expect(k.katalogDisi).toBe(true);
    expect(k.olculen).toBe(2);
    expect(k.farkliUye).toBe(0);
  });

  it('OK4b JVM: argüman tam yarıda varsa "yalnız bazılarında", diğerlerine eksik yazılmaz', () => {
    const [g] = ortamGruplari(
      [yer('c1'), yer('c2'), yer('c3'), yer('c4')],
      ['-Xmx2g -Da=1', '-Xmx2g -Da=1', '-Xmx2g', '-Xmx2g'].map((v, i) =>
        okuma(`c${i + 1}`, { nesneler: [nesne(2, [ctr({ jvmEnv: jvm(v) })])] }),
      ),
    );
    expect(uye(g, 'c1').farklar.map((x) => `${x.metin} | ${x.ipucu}`)).toEqual([
      "yalnız bazılarında: -Da=1 | 2 cluster'da yok",
    ]);
    expect(uye(g, 'c3').farklar).toEqual([]);
    expect(g.farkliUye).toBe(2);
  });

  it('OK3 çoğunluk ve beraberlik', () => {
    const [g] = ortamGruplari(
      [yer('c1'), yer('c2'), yer('c3')],
      [
        okuma('c1'),
        okuma('c2'),
        okuma('c3', {
          nesneler: [
            nesne(3, [
              ctr({ imaj: 'reg.example/ns/app:1.0.1', limit: { cpu: '2', bellek: '2Gi' } }),
            ]),
          ],
        }),
      ],
    );
    expect(g.farkliUye).toBe(1);
    expect(g.farkSayilari).toEqual({ replika: 1, surum: 1, kaynak: 1 });
    const f = uye(g, 'c3').farklar;
    expect(f.find((x) => x.alan === 'replika')).toEqual({
      alan: 'replika',
      metin: 'istenen 3',
      ipucu: 'çoğunluk: istenen 2',
    });
    expect(f.find((x) => x.alan === 'surum')?.ipucu).toBe('çoğunluk: 1.0.0');
    expect(uye(g, 'c1').farklar).toEqual([]);
    expect(g.surumler).toEqual([
      { surum: '1.0.0', sayi: 2 },
      { surum: '1.0.1', sayi: 1 },
    ]);

    const [b] = ortamGruplari(
      [yer('c1'), yer('c2')],
      [
        okuma('c1'),
        okuma('c2', { nesneler: [nesne(2, [ctr({ imaj: 'reg.example/ns/app:2.0.0' })])] }),
      ],
    );
    expect(b.farkliUye).toBe(2);
    expect(uye(b, 'c1').farklar[0].ipucu).toBe('diğerleri: 2.0.0');
    expect(uye(b, 'c2').farklar[0].ipucu).toBe('diğerleri: 1.0.0');
  });

  it('OK4 JVM: sırasız, eksik, fazla, değer farkı, referans', () => {
    const ile = (deger: string) => [nesne(2, [ctr({ jvmEnv: jvm(deger) })])];
    const [g] = ortamGruplari(
      [yer('c1'), yer('c2'), yer('c3')],
      [
        okuma('c1', { nesneler: ile('-Xmx2g -Dfile.encoding=UTF-8 -XX:+UseG1GC') }),
        okuma('c2', { nesneler: ile('-XX:+UseG1GC -Xmx2g -Dfile.encoding=UTF-8') }),
        okuma('c3', { nesneler: ile('-Xmx4g -XX:+UseG1GC -Dzaman=1') }),
      ],
    );
    expect(uye(g, 'c1').farklar).toEqual([]);
    expect(uye(g, 'c2').farklar).toEqual([]);
    const f = uye(g, 'c3').farklar.map((x) => `${x.metin} | ${x.ipucu}`);
    expect(f).toEqual(
      expect.arrayContaining([
        '-Xmx4g | çoğunluk: -Xmx2g',
        'eksik: -Dfile.encoding | diğerlerinde: -Dfile.encoding=UTF-8',
        "fazla: -Dzaman=1 | 2 cluster'da yok",
      ]),
    );
    expect(f).toHaveLength(3);

    const [r] = ortamGruplari(
      [yer('c1'), yer('c2')],
      [
        okuma('c1', {
          nesneler: [
            nesne(2, [
              ctr({ jvmEnv: [{ ad: 'JAVA_OPTS', kaynak: 'referans', deger: 'configMap/a' }] }),
            ]),
          ],
        }),
        okuma('c2', {
          nesneler: [
            nesne(2, [
              ctr({ jvmEnv: [{ ad: 'JAVA_OPTS', kaynak: 'referans', deger: 'configMap/b' }] }),
            ]),
          ],
        }),
      ],
    );
    expect(uye(r, 'c1').farklar[0].metin).toBe('JAVA_OPTS=(configMap/a)');
    // Argüman olmayan değer tek anahtar
    const [s] = ortamGruplari(
      [yer('c1'), yer('c2'), yer('c3')],
      ['80', '80', '50'].map((v, i) =>
        okuma(`c${i + 1}`, {
          nesneler: [
            nesne(2, [ctr({ jvmEnv: [{ ad: 'JAVA_MAX_MEM_RATIO', kaynak: 'deger', deger: v }] })]),
          ],
        }),
      ),
    );
    expect(uye(s, 'c3').farklar.map((x) => x.metin)).toEqual(['JAVA_MAX_MEM_RATIO=50']);
  });

  it('OK5 ölçülemeyen ve JVM atılmış üye karşılaştırılmaz', () => {
    const [g] = ortamGruplari(
      [yer('c1'), yer('c2'), yer('c3'), yer('c4')],
      [
        okuma('c1', { nesneler: [nesne(2, [ctr({ jvmEnv: jvm('-Xmx2g') })])] }),
        okuma('c2', {
          ok: false,
          hata: 'zaman aşımı',
          nesneler: [nesne(9, [ctr({ imaj: 'r/a:6.6.6' })])],
        }),
        okuma('c3', {
          notlar: ['JVM ayrıntısı boyut sınırı yüzünden gösterilmiyor.'],
          nesneler: [nesne(2, [ctr({ jvmEnv: jvm('-Xmx8g') })])],
        }),
      ],
    );
    expect(g.olculen).toBe(2);
    expect(g.farkliUye).toBe(0);
    expect(uye(g, 'c2').olculdu).toBe(false);
    expect(uye(g, 'c3').containerlar[0].jvm).toBeNull();
    expect(uye(g, 'c4').okuma).toBeUndefined();
    expect(g.pod).toEqual({ hazir: 4, toplam: 4, olculemeyen: 2 });
  });

  it('OK6 aynı etiket farklı imaj yolu', () => {
    const [g] = ortamGruplari(
      [yer('c1'), yer('c2'), yer('c3')],
      [
        okuma('c1'),
        okuma('c2'),
        okuma('c3', { nesneler: [nesne(2, [ctr({ imaj: 'baska.reg/ns/app:1.0.0' })])] }),
      ],
    );
    const f = uye(g, 'c3').farklar;
    expect(f).toEqual([
      {
        alan: 'surum',
        metin: 'baska.reg/ns/app:1.0.0',
        ipucu: 'çoğunluk: reg.example/ns/app:1.0.0',
      },
    ]);
  });

  it('OK7 ekran: sarı hücre, ipucu, durum hapı, aç / kapa', () => {
    const yerler = [yer('c1'), yer('c2'), yer('c3'), yer('t1', 'TEST')];
    const okumalar = [
      okuma('c1', { nesneler: [nesne(2, [ctr({ jvmEnv: jvm('-Xmx2g -Da=1') })])] }),
      okuma('c2', { nesneler: [nesne(2, [ctr({ jvmEnv: jvm('-Xmx2g -Da=1') })])] }),
      okuma('c3', {
        nesneler: [
          nesne(2, [ctr({ imaj: 'reg.example/ns/app:1.0.1', jvmEnv: jvm('-Xmx4g -Da=1') })]),
        ],
      }),
      okuma('t1'),
    ];
    render(<OcpOrtamlar yerler={yerler} okumalar={okumalar} />);
    const kartlar = screen.getAllByTestId('ocp-ortam');
    expect(kartlar.map((k) => k.getAttribute('data-ortam'))).toEqual(['PROD', 'TEST']);
    const prod = kartlar[0];
    expect(prod).toHaveTextContent("1 cluster'da fark");
    expect(prod).toHaveTextContent('1.0.0 ×2');
    expect(prod).toHaveTextContent('farklı olan: sürüm 1 · JVM 1');
    expect(kartlar[1]).toHaveTextContent('tek cluster ölçüldü');
    const satirlar = within(prod).getAllByTestId('ocp-uye');
    expect(satirlar.map((s) => s.getAttribute('data-fark'))).toEqual(['yok', 'yok', 'var']);
    const c3 = satirlar[2];
    expect(c3).toHaveTextContent('çoğunluk: 1.0.0');
    expect(within(c3).getByTestId('jvm-fark')).toHaveTextContent('-Xmx4g · çoğunluk: -Xmx2g');
    expect(within(satirlar[0]).getByText('aynı · 2 parametre')).toBeInTheDocument();
    const surumHucresi = within(c3).getByText('1.0.1').closest('td')!;
    expect(surumHucresi.getAttribute('style')).toContain('var(--status-warning-bg)');
    const ilkSurum = within(satirlar[0]).getByText('1.0.0').closest('td')!;
    expect(ilkSurum.getAttribute('style') || '').not.toContain('var(--status-warning-bg)');
    fireEvent.click(within(satirlar[0]).getByRole('button', { name: 'tümünü göster' }));
    expect(within(satirlar[0]).getByRole('button', { name: 'gizle' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('-Da=1', { exact: false })).toBeInTheDocument();
  });

  it('OK8 envanter boş', () => {
    render(<OcpOrtamlar yerler={[]} okumalar={[]} />);
    expect(screen.getByText(/Envanterde bu uygulama için cluster/)).toBeInTheDocument();
  });
});
