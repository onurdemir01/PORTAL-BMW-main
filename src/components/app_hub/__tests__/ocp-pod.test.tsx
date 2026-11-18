// src/components/app_hub/__tests__/ocp-pod.test.tsx — Application Hub OpenShift: saatlik tarama + pod sayısı (2026-11-18).
// Kullanıcı: "Canlı Oku demeden her saat başı tarasak ... cluster başına uygulamanın kaç pod'u var bunu da görebilsinler".
//   OP1 pod sayısı tüm pod'lardan (podOzet); okunamadıysa null (0 DEĞİL); eski canlı okumada listeden sayılır
//   OP2 birleştirme: (cluster, namespace) başına daha yeni okuma kalır; yeni canlı okuma diğer cluster'ları silmez
//   OP3 cluster başına dağılım: aynı cluster'ın namespace'leri toplanır, ölçülemeyen ayrı sayılır
//   OP4 ekran: satırda pod sütunu, cluster başına pod rozetleri, kaynak (saatlik tarama) ve son koşu metni
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import OcpGorunum, {
  clusterPodlari,
  okumaBirlestir,
  podSayisi,
} from '@/components/app_hub/OcpGorunum';
import type { OcpCanliOkuma, OcpDetay, OcpYer } from '@/api/appHubApi';

const okuma = (o: Partial<OcpCanliOkuma>): OcpCanliOkuma => ({
  cluster: 'c1',
  namespace: 'ns1',
  ok: true,
  hata: null,
  alanAd: null,
  alinma: '2026-11-18T09:00:00.000Z',
  isNo: null,
  kaynak: 'saatlik',
  nesneler: [],
  podlar: [],
  ...o,
});
const yer = (o: Partial<OcpYer>): OcpYer => ({
  cluster: 'c1',
  namespace: 'ns1',
  ortam: 'PROD',
  tenant: 'ark',
  konsol: null,
  katalogda: true,
  onbellek: null,
  routelar: [],
  routeEslesme: null,
  atfedilmeyenRoute: 0,
  istek: null,
  ...o,
});

describe('Application Hub — OpenShift pod sayısı ve saatlik tarama', () => {
  it('OP1 pod sayısı: podOzet, okunamadı null, eski okuma listeden', () => {
    expect(
      podSayisi(okuma({ podOzet: { toplam: 5, hazir: 4, listelenen: 5, okunamadi: false } })),
    ).toEqual({ hazir: 4, toplam: 5 });
    expect(
      podSayisi(okuma({ podOzet: { toplam: null, hazir: null, listelenen: 0, okunamadi: true } })),
    ).toBeNull();
    expect(podSayisi(okuma({ ok: false }))).toBeNull();
    expect(podSayisi(undefined)).toBeNull();
    const eski = okuma({
      kaynak: 'canli',
      podlar: [
        { ad: 'a', faz: 'Running', node: 'w1', hazir: '1/1', restart: 0, baslama: null },
        { ad: 'b', faz: 'Running', node: 'w1', hazir: '0/1', restart: 0, baslama: null },
        { ad: 'c', faz: 'Pending', node: null, hazir: '0/1', restart: 0, baslama: null },
      ],
    });
    expect(podSayisi(eski)).toEqual({ hazir: 1, toplam: 3 });
  });

  it('OP2 birleştirme: daha yeni kalır, diğer cluster silinmez', () => {
    const eski = [okuma({ cluster: 'c1' }), okuma({ cluster: 'c2' })];
    const yeni = [okuma({ cluster: 'C1', alinma: '2026-11-18T10:00:00.000Z', kaynak: undefined })];
    const b = okumaBirlestir(eski, yeni);
    expect(b).toHaveLength(2);
    expect(b.find((o) => o.cluster.toLowerCase() === 'c1')?.kaynak).toBe('canli');
    expect(b.find((o) => o.cluster === 'c2')?.kaynak).toBe('saatlik');
    expect(
      okumaBirlestir(eski, [okuma({ cluster: 'c1', alinma: '2026-11-18T08:00:00.000Z' })]).find(
        (o) => o.cluster === 'c1',
      )?.alinma,
    ).toBe('2026-11-18T09:00:00.000Z');
  });

  it('OP3 cluster başına dağılım', () => {
    const d = clusterPodlari([
      okuma({
        cluster: 'c1',
        namespace: 'a',
        podOzet: { toplam: 3, hazir: 3, listelenen: 3, okunamadi: false },
      }),
      okuma({
        cluster: 'C1',
        namespace: 'b',
        podOzet: { toplam: 2, hazir: 1, listelenen: 2, okunamadi: false },
      }),
      okuma({
        cluster: 'c2',
        namespace: 'a',
        podOzet: { toplam: null, hazir: null, listelenen: 0, okunamadi: true },
      }),
    ]);
    expect(d).toEqual([
      { cluster: 'c1', hazir: 4, toplam: 5, olculemeyen: 0 },
      { cluster: 'c2', hazir: 0, toplam: 0, olculemeyen: 1 },
    ]);
  });

  it('OP4 ekran: pod sütunu, cluster rozetleri, kaynak ve son koşu', () => {
    const d: OcpDetay = {
      tip: 'ocp',
      ad: 'musteri-api',
      ozet: { clusterSayisi: 2, namespaceSayisi: 1, ortamlar: ['PROD'], routeSayisi: 0 },
      yerler: [yer({ cluster: 'c1' }), yer({ cluster: 'c2' })],
      canli: [
        okuma({
          cluster: 'c1',
          nesneler: [
            {
              tur: 'Deployment',
              kind: 'Deployment',
              ad: 'musteri-api',
              istenen: 3,
              hazir: 2,
              guncel: 3,
              mevcut: 2,
              strateji: null,
              gitops: null,
              olusturma: null,
              containerlar: [],
            },
          ],
          podOzet: { toplam: 3, hazir: 2, listelenen: 3, okunamadi: false },
        }),
        okuma({
          cluster: 'c2',
          podOzet: { toplam: null, hazir: null, listelenen: 0, okunamadi: true },
        }),
      ],
      filo: {
        sonKosu: {
          kosuId: 9,
          durum: 'BITTI',
          baslangic: null,
          bitis: '2026-11-18T09:05:00.000Z',
          clusterSayisi: 45,
          okSayisi: 44,
          hata: null,
        },
        aralikDk: 60,
      },
      kaynaklar: {},
    };
    render(<OcpGorunum d={d} onYenile={() => undefined} />);
    const podHucreleri = screen.getAllByTestId('yer-pod');
    expect(podHucreleri[0]).toHaveTextContent('2 / 3');
    expect(podHucreleri[1]).toHaveTextContent('ölçülemedi');
    const dagilim = screen.getByTestId('cluster-pod-dagilimi');
    expect(within(dagilim).getByText('c1').parentElement).toHaveTextContent('3 pod · 2 hazır');
    expect(dagilim).toHaveTextContent('1 namespace ölçülemedi');
    expect(screen.getByTestId('filo-durumu')).toHaveTextContent('44/45 cluster okundu');
    expect(screen.getAllByText('saatlik tarama').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('kart-pod')[0]).toHaveTextContent('3 pod · 2 hazır');
  });

  it('OP5 başarısız yeni okuma geçerli veriyi gizlemez; pod listesi okunamayan eski kayıt 0 sayılmaz; başarısız koşu uyarı', () => {
    const iyi = okuma({
      cluster: 'c1',
      podOzet: { toplam: 2, hazir: 2, listelenen: 2, okunamadi: false },
    });
    const kotu = okuma({
      cluster: 'c1',
      ok: false,
      hata: 'bastion zaman aşımı',
      alinma: '2026-11-18T11:00:00.000Z',
      kaynak: undefined,
      podOzet: undefined,
    });
    const b = okumaBirlestir([iyi], [kotu]);
    expect(b).toHaveLength(1);
    expect(b[0].kaynak).toBe('saatlik');
    expect(b[0].sonOkumaHatasi).toBe('bastion zaman aşımı');
    const eskiKayit = okuma({
      kaynak: 'canli',
      podOzet: undefined,
      podlar: [],
      hatalar: ['pod listesi okunamadi: Forbidden'],
    });
    expect(podSayisi(eskiKayit)).toBeNull();
    const d: OcpDetay = {
      tip: 'ocp',
      ad: 'x',
      ozet: { clusterSayisi: 1, namespaceSayisi: 1, ortamlar: [], routeSayisi: 0 },
      yerler: [yer({})],
      canli: b,
      filo: {
        sonKosu: {
          kosuId: 3,
          durum: 'HATA',
          baslangic: null,
          bitis: '2026-11-18T09:05:00.000Z',
          clusterSayisi: 0,
          okSayisi: 0,
          hata: 'AWX 503',
        },
        aralikDk: 60,
      },
      kaynaklar: {},
    };
    render(<OcpGorunum d={d} onYenile={() => undefined} />);
    expect(screen.getByTestId('filo-durumu')).toHaveTextContent('Son saatlik tarama başarısız');
    expect(screen.getByTestId('filo-durumu')).toHaveTextContent('AWX 503');
    expect(
      screen.getByText(/Daha yeni bir okuma başarısız oldu \(bastion zaman aşımı\)/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('yer-pod')).toHaveTextContent('2 / 2');
  });
});
