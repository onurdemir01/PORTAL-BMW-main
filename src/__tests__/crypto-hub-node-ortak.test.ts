// src/__tests__/crypto-hub-node-ortak.test.ts — Crypto Hub > Indexer / Node SAF yardımcıları.
//
//   O1 sekmeler: node sekmesi yalnız Metaco'da; node-only kullanıcıda YALNIZ o (D5)
//   O2 gerekçe 10–500; production onayı grup kimliğini AYNEN ister (parça eşleşmesi yetmez)
//   O3 yeni değer: doğrulama ve maskeleme sunucuyla aynı modülden; hata metinleri neden kodlarıyla
//   O4 sonuç metinleri: her kapalı durum sözleşme 9.2 metniyle; GERI_ALMA yedek yolunu söyler
//   O5 Ankara önerisi yalnız metaco_das_prod talebinden sonra (D4)
//   O6 "Değiştir": okuma bayatken AÇIK (sihirbaz okur), tazeyken engel; bekleyen talep kapatır
//   O7 sonuç tablosu satırları ROLLOUT / VERIFY / ROLLBACK ile birleşir
//   O8 kalan süre sunucu saatiyle ölçülür
import { describe, it, expect } from 'vitest';
import {
  METIN,
  baslangicSekmesi,
  bosRoller,
  degerHatasi,
  degistirDurumu,
  esOneriGoster,
  gerekceGecerli,
  grupRozetleri,
  kalanSure,
  onayMetniEslesir,
  sekmeListesi,
  sonucMetni,
  sonucSatirlari,
  yeniGecerli,
  yeniMaskeli,
} from '@/components/crypto_hub/nodeOrtak';
import * as NS from '../../shared/cryptoHubNodes.cjs';
import type { NodeGrup, NodeRol, NodeSonuc } from '@/api/cryptoHubApi';

const ROLLER: NodeRol[] = [
  { rol: 'rpc', envler: ['SOLRPC'], bicim: 'url' },
  { rol: 'ws', envler: ['SOLWSRPC'], bicim: 'url' },
];
const grup =(ek: Partial<NodeGrup> = {}): NodeGrup => ({
  id: 'eski:solana-mainnet',
  tur: 'eski',
  baslik: 'solana-mainnet',
  kilit: 'eski-solana-mainnet',
  bilesenler: null,
  deploymentlar: [],
  roller: ROLLER,
  envler: [],
  mevcutNode: null,
  tutarsiz: false,
  olculemedi: false,
  referans: false,
  gitops: false,
  durdurulmus: [],
  bekleyen: null,
  degistirilebilir: true,
  engel: null,
  okumaBekleniyor: false,
  ...ek,
});

describe('O1 sekmeler', () => {
  it('Metaco: beş sekme, sonuncusu Indexer / Node', () => {
    const l = sekmeListesi('metaco', false).map(([id]) => id);
    expect(l).toEqual(['durum', 'podlar', 'surumler', 'configmap', 'node']);
  });
  it('node-only kullanıcı YALNIZ node sekmesini görür', () => {
    expect(sekmeListesi('metaco', true)).toEqual([['node', 'Indexer / Node']]);
  });
  it('Wyden: node sekmesi yok (node-only işareti gelse bile)', () => {
    expect(sekmeListesi('wyden', false).map(([id]) => id)).not.toContain('node');
    expect(sekmeListesi('wyden', true).map(([id]) => id)).not.toContain('node');
  });
  it('başlangıç sekmesi URL `s`ten; listede yoksa ilk sekme', () => {
    expect(baslangicSekmesi('node', sekmeListesi('metaco', false))).toBe('node');
    expect(baslangicSekmesi(null, sekmeListesi('metaco', false))).toBe('durum');
    expect(baslangicSekmesi('node', sekmeListesi('wyden', false))).toBe('durum');
    expect(baslangicSekmesi(null, sekmeListesi('metaco', true))).toBe('node');
  });
});

describe('O2 gerekçe ve onay metni', () => {
  it('gerekçe 10–500 (boşluk sayılmaz)', () => {
    expect(gerekceGecerli('a'.repeat(9))).toBe(false);
    expect(gerekceGecerli('   ' + 'a'.repeat(9) + '   ')).toBe(false);
    expect(gerekceGecerli('a'.repeat(10))).toBe(true);
    expect(gerekceGecerli('a'.repeat(500))).toBe(true);
    expect(gerekceGecerli('a'.repeat(501))).toBe(false);
  });
  it('onay metni grup kimliğiyle AYNEN eşleşmeli', () => {
    expect(onayMetniEslesir('eski:solana-mainnet', 'eski:solana-mainnet')).toBe(true);
    expect(onayMetniEslesir('  eski:solana-mainnet ', 'eski:solana-mainnet')).toBe(true);
    expect(onayMetniEslesir('solana-mainnet', 'eski:solana-mainnet')).toBe(false);
    expect(onayMetniEslesir('eski:solana-mainnet-x', 'eski:solana-mainnet')).toBe(false);
    expect(onayMetniEslesir('', '')).toBe(false);
  });
});

describe('O3 yeni değer doğrulama ve maskeleme (sunucuyla aynı modül)', () => {
  it('METIN.degerHata anahtarları sunucu neden kodlarıyla BİREBİR; her neden bir cümleye çevrilir', () => {
    expect(Object.keys(METIN.degerHata).sort()).toEqual(
      ['bicim', 'hostport', 'karakter', 'sir', 'tip', 'url', 'uzun', 'yasak'].sort(),
    );
    const ornek: [string, string, string][] = [
      ['x', 'baska', 'bicim'],
      ['https://a.invalid/ü', 'url', 'karakter'],
      ['https://a.invalid/' + 'a'.repeat(2048), 'url', 'uzun'],
      ['https://a.invalid/;x', 'url', 'yasak'],
      ['https://a.invalid/a b', 'url', 'url'],
      ['a.invalid:0', 'hostport', 'hostport'],
      [' abc', 'sir', 'sir'],
    ];
    for (const [d, b, kod] of ornek) {
      expect(NS.degerDogrula(d, b), `${d} / ${b}`).toBe(kod);
      expect(degerHatasi(d, b)).toBe(METIN.degerHata[kod]);
    }
    expect(METIN.degerHata.uzun).toBe('En çok 2048 karakter.');
    expect(degerHatasi('', 'url')).toBeNull();
    expect(degerHatasi('https://eth.node.invalid/v3/K', 'url')).toBeNull();
  });
  it('maskeli önizleme ve boş roller (rol sırası grubun tanımından)', () => {
    const g = grup();
    const yeni = { rpc: 'https://sol.node.invalid/v1/ANAHTAR', ws: '' };
    expect(yeniMaskeli(g, yeni)).toEqual({ rpc: 'https://sol.node.invalid/****', ws: '(bos)' });
    expect(JSON.stringify(yeniMaskeli(g, yeni))).not.toContain('ANAHTAR');
    expect(bosRoller(g, yeni)).toEqual(['ws']);
    expect(bosRoller(g, {})).toEqual(['rpc', 'ws']);
  });
  it('yeniGecerli: her rol geçerli VE (boş yok ya da boş onaylı)', () => {
    const g = grup();
    const tam = { rpc: 'https://a.invalid', ws: 'wss://a.invalid' };
    expect(yeniGecerli(g, tam, false)).toBe(true);
    expect(yeniGecerli(g, { ...tam, ws: '' }, false)).toBe(false);
    expect(yeniGecerli(g, { ...tam, ws: '' }, true)).toBe(true);
    expect(yeniGecerli(g, { ...tam, ws: 'ftp://a.invalid' }, true)).toBe(false);
    expect(yeniGecerli(g, {}, true)).toBe(true);
    expect(yeniGecerli(grup({ roller: [] }), {}, true)).toBe(false);
  });
});

describe('O4 sonuç metinleri (9.2)', () => {
  const tablo: [Parameters<typeof sonucMetni>[0], string, string][] = [
    ['BASARILI', '-', "Tamamlandı — env yazıldı, pod'lar hazır."],
    ['GERI_ALINDI', 'ROLLOUT', "Geri alındı — rollout zamanında bitmedi. Eski node'a dönüldü."],
    ['GERI_ALINDI', 'VERIFY', "Geri alındı — geri okuma tutmadı. Eski node'a dönüldü."],
    ['GERI_ALINDI', 'YAZMA', "Geri alındı — yazma başarısız. Eski node'a dönüldü."],
    [
      'BAYAT',
      'BAYAT_ESKI_DEGER',
      'Durdu, hiçbir şey yazılmadı — onay beklerken mevcut node değişmiş. Yeniden okuyup yeni talep açın.',
    ],
    [
      'BAYAT',
      'BAYAT_KAPSAM',
      'Durdu, hiçbir şey yazılmadı — gruba bileşen eklenmiş/silinmiş. Yeniden okuyup yeni talep açın.',
    ],
    ['BASARISIZ', 'GITOPS', 'Başarısız — GITOPS.'],
    ['OLCULEMEDI', '', "Durum bilinmiyor — sonuç satırı gelmedi. Mevcut node'ları okuyun."],
    ['REDDEDILDI', '', "Smart'ta reddedildi."],
    ['ZAMAN_ASIMI', '', 'Onay 24 saat içinde gelmedi; talep kapandı.'],
    ['IPTAL', '', 'İptal edildi.'],
    ['HATA', 'YETIM_BILET', 'Talep hatayla kapandı: YETIM_BILET.'],
  ];
  it.each(tablo)('%s / %s', (d, k, beklenen) => {
    expect(sonucMetni(d, k, null)).toBe(beklenen);
  });
  it('GERI_ALMA: yedek yolu ERR geri_alma satırından', () => {
    const s: NodeSonuc = {
      sum: null,
      degisiklikler: [],
      rollout: [],
      verify: [],
      rollback: [],
      yedek: ['/vhosting/crypto-hub/node-backup/x/ilk'],
      hatalar: [{ stage: 'geri_alma', message: '/vhosting/crypto-hub/node-backup/x/20261102-t42' }],
    };
    expect(sonucMetni('BASARISIZ', 'GERI_ALMA', s)).toBe(
      'Geri alma da başarısız oldu; yedek: /vhosting/crypto-hub/node-backup/x/20261102-t42. Middleware ekibine haber verin.',
    );
  });
  it('GERI_ALMA: hedef başına neden satırları yol sanılmaz (betik yolu en sonda basar)', () => {
    const s: NodeSonuc = {
      sum: null,
      degisiklikler: [],
      rollout: [],
      verify: [],
      rollback: [],
      yedek: ['/vhosting/crypto-hub/node-backup/x/20261102-t42'],
      hatalar: [
        { stage: 'geri_alma', message: 'hmz-harmonize-uis-adapter-evm-ethereum-mainnet: oc set env rc=1' },
        { stage: 'geri_alma', message: '/vhosting/crypto-hub/node-backup/x/20261102-t42' },
      ],
    };
    expect(sonucMetni('BASARISIZ', 'GERI_ALMA', s)).toBe(
      'Geri alma da başarısız oldu; yedek: /vhosting/crypto-hub/node-backup/x/20261102-t42. Middleware ekibine haber verin.',
    );
    const yalnizNeden: NodeSonuc = {
      ...s,
      hatalar: [{ stage: 'geri_alma', message: 'hmz-harmonize-uis-adapter-evm-ethereum-mainnet: oc set env rc=1' }],
    };
    expect(sonucMetni('BASARISIZ', 'GERI_ALMA', yalnizNeden)).toContain(
      'yedek: /vhosting/crypto-hub/node-backup/x/20261102-t42.',
    );
  });
  it('açık durumlarda sonuç cümlesi yok (uydurulmaz)', () => {
    expect(sonucMetni('BEKLIYOR', null)).toBeNull();
    expect(sonucMetni('CALISIYOR', null)).toBeNull();
    expect(sonucMetni('ACILIYOR', null)).toBeNull();
  });
});

describe('O5 Ankara önerisi', () => {
  const o = { tenant: 'metaco_das_prod_ank' };
  it('yalnız metaco_das_prod', () => {
    expect(esOneriGoster('metaco_das_prod', o)).toBe(true);
    expect(esOneriGoster('metaco_das_test', o)).toBe(false);
    expect(esOneriGoster('metaco_gar_prod', o)).toBe(false);
    expect(esOneriGoster('metaco_das_prod_ank', o)).toBe(false);
    expect(esOneriGoster('metaco_das_prod', null)).toBe(false);
  });
});

describe('O6 Değiştir düğmesi', () => {
  const ac = { talep: true, nodeAcik: true, okumaTaze: true };
  it('taze okumada engel varsa kapalı ve neden engel metni', () => {
    const g = grup({ degistirilebilir: false, engel: 'GitOps engeli' });
    expect(degistirDurumu(g, ac)).toEqual({ acik: false, neden: 'GitOps engeli' });
  });
  it('okuma bayatken açık (sihirbaz önce okur)', () => {
    const g = grup({ degistirilebilir: false, engel: 'okuma bayat' });
    expect(degistirDurumu(g, { ...ac, okumaTaze: false }).acik).toBe(true);
  });
  it('yetki yok / ortam kapalı / bekleyen talep: kapalı', () => {
    expect(degistirDurumu(grup(), { ...ac, talep: false })).toEqual({
      acik: false,
      neden: METIN.yetkiYok,
    });
    expect(degistirDurumu(grup(), { ...ac, nodeAcik: false }).acik).toBe(false);
    const b = grup({
      bekleyen: {
        talepId: 7,
        externalTicketId: 'SR-1',
        username: 'ali',
        createdAt: '2026-11-02T10:00:00Z',
        durum: 'BEKLIYOR',
      },
    });
    const d = degistirDurumu(b, { ...ac, okumaTaze: false });
    expect(d.acik).toBe(false);
    expect(d.neden).toMatch(/^Onay bekleyen değişiklik: Smart #SR-1 — ali, /);
  });
});

describe('O7 rozetler ve sonuç tablosu', () => {
  it('rozetler sözleşme metinleriyle', () => {
    const g = grup({
      tutarsiz: true,
      olculemedi: true,
      referans: true,
      gitops: true,
      durdurulmus: ['x'],
      envler: [
        {
          deployment: 'd',
          container: 'c',
          env: 'SOLRPC',
          rol: 'rpc',
          kaynak: 'literal',
          maskeli: 'https://a/****',
          sha: 'a'.repeat(64),
          helm: 'evet',
        },
      ],
    });
    expect(grupRozetleri(g).map((r) => r.metin)).toEqual([
      "Tutarsız: bileşenler farklı node'a bağlı",
      'Ölçülemedi',
      'Secret/ConfigMap referansı — Portal bu sürümde değiştirmez',
      'GitOps sahipli — Portal değiştirmez',
      'Durdurulmuş (replika 0)',
      "Helm values'ta da var",
    ]);
  });
  it('NODECHG + ROLLOUT + VERIFY + ROLLBACK birleşir', () => {
    const s: NodeSonuc = {
      sum: { sonuc: 'geri_alindi', planSha: 'a'.repeat(64), talepId: '4', kod: 'ROLLOUT' },
      degisiklikler: [
        { deployment: 'd1', container: 'app', env: 'SOLRPC', eski: 'e', yeni: 'y', durum: 'geri_alindi' },
        { deployment: 'd2', container: 'app', env: 'SOLRPC', eski: 'e', yeni: 'y', durum: 'BAYAT' },
      ],
      rollout: [{ deployment: 'd1', durum: 'timeout', sureSn: 600 }],
      verify: [{ deployment: 'd1', container: 'app', env: 'SOLRPC', durum: 'uyusmuyor' }],
      rollback: [{ deployment: 'd1', durum: 'ok' }],
      yedek: [],
      hatalar: [],
    };
    const [a, b] = sonucSatirlari(s);
    expect(a).toMatchObject({
      yazildi: 'evet',
      rollout: 'timeout (600 sn)',
      geriOkuma: 'uyusmuyor',
      durum: 'geri alma: ok',
    });
    expect(b).toMatchObject({ yazildi: 'hayır', rollout: '—', geriOkuma: '—', durum: 'bayat — yazılmadı' });
    expect(sonucSatirlari(null)).toEqual([]);
  });
});

describe('O8 kalan süre', () => {
  it('sunucu saati + yerel geçen süre', () => {
    const alindi = 1_000_000;
    expect(
      kalanSure('2026-11-02T12:00:00Z', '2026-11-02T10:30:00Z', alindi, alindi + 10 * 60000),
    ).toBe('1 sa 20 dk');
    expect(kalanSure('2026-11-02T12:00:00Z', '2026-11-02T12:00:00Z', alindi, alindi)).toBe(
      'süresi doldu',
    );
    expect(kalanSure(null, null, null, 0)).toBeNull();
  });
});

// ── O9-O11 (2026-11-02 düzeltme turu) ────────────────────────────────────────────────
describe('O9 PS7 talep numarası sunucuyla aynı biçimde', () => {
  it('Smart numarası varsa "Smart #…", yoksa "Portal #…"; bant çift önek taşımaz', async () => {
    const { smartNo, bekleyenMetni } = await import('@/components/crypto_hub/nodeOrtak');
    const N = await import('../../shared/cryptoHubNodes.cjs');
    expect(smartNo('SM-1', 4)).toBe('Smart #SM-1');
    expect(smartNo(null, 12)).toBe('Portal #12');
    expect(smartNo('SM-1', 4)).toBe(N.talepNoMetni('SM-1', 4));
    expect(smartNo(null, 12)).toBe(N.talepNoMetni(null, 12));
    const b = bekleyenMetni({ talepId: 12, externalTicketId: null, username: 'ali', createdAt: '2026-11-02T08:00:00Z', durum: 'ACILIYOR' });
    expect(b).toMatch(/^Onay bekleyen değişiklik: Portal #12 — ali, /);
    expect(b).not.toMatch(/Smart #Portal/);
  });
});

describe('O10 sonuç metinleri: TAKILDI, yönetici kapatması, istisna sonrası geri alma', () => {
  it('belirli kodlar ayrı cümleyle', () => {
    expect(sonucMetni('OLCULEMEDI', 'TAKILDI')).toMatch(/belirlenen sürede sonuçlanmadı/);
    expect(sonucMetni('IPTAL', 'ADMIN_KAPATTI')).toMatch(/^Yönetici tarafından kapatıldı/);
    expect(sonucMetni('GERI_ALINDI', 'BETIK')).toMatch(/beklenmeyen bir hata/);
  });
});

describe('O11 bileşen seçimi yardımcıları', () => {
  it('seçime göre tutarsızlık, aynı değer (sha256, crypto.subtle) ve etkilenenler', async () => {
    const o = await import('@/components/crypto_hub/nodeOrtak');
    const { createHash } = await import('node:crypto');
    const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
    const V1 = 'https://n1.node.invalid/v3/K1';
    const V2 = 'https://n2.node.invalid/v3/K2';
    const e = (deployment: string, deger: string) => ({
      deployment, container: 'app', env: 'NODE_ADDR', rol: 'rpc', kaynak: 'literal', maskeli: 'x', sha: sha(deger), helm: 'hayir' as const,
    });
    const d = (ad: string, bilesen: 'adapter' | 'api' | 'indexer' | 'processor', ek = {}) => ({
      ad, bilesen, durum: 'running' as const, istenen: 1, hazir: 1, gitops: 'hayir' as const, nodeBagli: true, secilebilir: true, ...ek,
    });
    const g = grup({
      roller: [{ rol: 'rpc', envler: ['NODE_ADDR'], bicim: 'url' }],
      deploymentlar: [d('a', 'adapter'), d('b', 'api'), d('c', 'indexer'), d('p', 'processor', { nodeBagli: false, secilebilir: false })],
      envler: [e('a', V1), e('b', V2), e('c', V2)],
    });
    expect(o.secilebilirler(g).map((x) => x.ad)).toEqual(['a', 'b', 'c']);
    expect(o.secimGoster(g)).toBe(true);
    expect(o.secimTutarsiz(g, ['b', 'c'])).toBe(false);
    expect(o.secimTutarsiz(g, ['a', 'c'])).toBe(true);
    expect(await o.ayniDegerMi(g, ['b', 'c'], { rpc: V2 })).toBe(true);
    expect(await o.ayniDegerMi(g, ['a', 'b'], { rpc: V2 })).toBe(false);
    expect(await o.ayniDegerMi(g, ['a'], { rpc: V1 })).toBe(true);
    expect(await o.ayniDegerMi(g, ['b'], { rpc: '' })).toBe(false);
    // crypto.subtle yoksa (güvenli olmayan bağlam): bilinmiyor -> null (uyarı yok, sunucu 409 der).
    const subtle = globalThis.crypto.subtle;
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    try {
      expect(await o.ayniDegerMi(g, ['b', 'c'], { rpc: V2 })).toBeNull();
    } finally {
      Object.defineProperty(globalThis.crypto, 'subtle', { value: subtle, configurable: true });
    }
    expect(await o.ayniDegerMi(g, ['b', 'c'], { rpc: V2 })).toBe(true);
    expect(o.etkilenenDeploymentlar(g, ['c'])).toEqual(['c']);
    expect(o.etkilenenDeploymentlar(g)).toEqual(['a', 'b', 'c']);
    expect(o.secimGoster(grup({ deploymentlar: [d('x', 'indexer')] }))).toBe(false);
  });
});

// ── O12 kullanıcı geri bildirimi 2026-11-03: "Katalog" anlaşılmadı ───────────────────
const ENV1 = {
  deployment: 'd',
  container: 'c',
  env: 'SOLRPC',
  rol: 'rpc',
  kaynak: 'literal' as const,
  maskeli: 'x',
  sha: 'a'.repeat(64),
  helm: 'hayir' as const,
};

describe('O12 kullanıcıya görünen metinlerde "katalog" yok; değer yalnız maskeli', () => {
  /** METIN'i dolaşır: dizgi, dizi ve fonksiyon (örnek argümanla çağrılır) değerleri toplar. */
  function metinler(x: unknown, yol: string, out: [string, string][]) {
    if (typeof x === 'string') out.push([yol, x]);
    else if (typeof x === 'function') {
      const f = x as (...a: unknown[]) => unknown;
      out.push([yol + '()', String(f('ornek_a', 'ornek_b', 'ornek_c'))]);
    } else if (Array.isArray(x)) x.forEach((v, i) => metinler(v, `${yol}[${i}]`, out));
    else if (x && typeof x === 'object')
      for (const [k, v] of Object.entries(x)) metinler(v, `${yol}.${k}`, out);
  }

  it('METIN, DURUM_ETIKETI ve sonuç cümlelerinde "katalog" kelimesi yok', async () => {
    const o = await import('@/components/crypto_hub/nodeOrtak');
    const out: [string, string][] = [];
    metinler(o.METIN, 'METIN', out);
    metinler(o.DURUM_ETIKETI, 'DURUM_ETIKETI', out);
    // Her durumun bilinen kodları (bilinmeyen kod metne aynen düşer; o kod adıdır, cümle değil).
    const KODLAR: Partial<Record<keyof typeof o.DURUM_ETIKETI, string[]>> = {
      GERI_ALINDI: ['ROLLOUT', 'VERIFY', 'YAZMA', 'BETIK'],
      BAYAT: ['BAYAT_ESKI_DEGER', 'BAYAT_KAPSAM'],
      BASARISIZ: ['GERI_ALMA'],
      OLCULEMEDI: ['TAKILDI'],
      IPTAL: ['ADMIN_KAPATTI'],
    };
    for (const d of Object.keys(o.DURUM_ETIKETI) as (keyof typeof o.DURUM_ETIKETI)[])
      for (const k of ['', ...(KODLAR[d] || [])])
        out.push([`sonucMetni(${d},${k})`, String(o.sonucMetni(d, k))]);
    expect(out.length, 'bekçi boş koşuyor').toBeGreaterThan(80);
    // Sunucu METIN'i de kullanıcıya gider (ret mesajları).
    const sunucu = await import('../../server/crypto-hub/node.cjs');
    metinler((sunucu as unknown as { METIN: unknown }).METIN ?? (sunucu as unknown as { default: { METIN: unknown } }).default.METIN, 'SUNUCU', out);
    expect(out.some(([y]) => y.startsWith('SUNUCU.sifrelemeYok'))).toBe(true);
    const kotu = out.filter(([, v]) => /katalog/i.test(v));
    expect(kotu).toEqual([]);
    // BAYAT_KATALOG nedeni kalktı: kod artık metne aynen düşer (cümle yok).
    expect(o.sonucMetni('BAYAT', 'BAYAT_KATALOG')).toContain('BAYAT_KATALOG');
  });

  it('mevcut değer her yerde yalnız maskeli; node listesi yardımcıları ve metinleri yok', async () => {
    const o = await import('@/components/crypto_hub/nodeOrtak');
    const mn = { maskeli: { rpc: 'https://a/****', ws: 'wss://a/****' } };
    const dep = { ad: 'd', bilesen: null, durum: 'running' as const, istenen: 1, hazir: 1, gitops: 'hayir' as const, nodeBagli: true };
    expect(o.mevcutNodeMetni({ ...dep, mevcutNode: mn }, ROLLER)).toBe('rpc: https://a/****; ws: wss://a/****');
    expect(o.uisOzetMetni(grup({ mevcutNode: mn, envler: [ENV1] }))).toBe(
      "Tüm bileşenler aynı node'a bağlı: rpc: https://a/****; ws: wss://a/****",
    );
    expect(o.mevcutNodeMetni({ ...dep, mevcutNode: null }, ROLLER)).toBe('—');
    expect(o.uisOzetMetni(grup({ mevcutNode: mn, envler: [ENV1], tutarsiz: true }))).toBeNull();
    expect(o.uisOzetMetni(grup({ mevcutNode: mn }))).toBeNull();
    // Özet "tüm bileşenler" diyemiyorsa yok: referanslı grup (sunucu maskeli '' verir), bir rolün
    // değeri yok, node'a bağlı bir bileşenin literal değeri yok, ölçülemedi.
    expect(o.uisOzetMetni(grup({ mevcutNode: { maskeli: { rpc: '', ws: '' } }, envler: [ENV1], referans: true }))).toBeNull();
    expect(o.uisOzetMetni(grup({ mevcutNode: { maskeli: { rpc: 'https://a/****', ws: '' } }, envler: [ENV1] }))).toBeNull();
    expect(o.uisOzetMetni(grup({ mevcutNode: mn, envler: [ENV1], referans: true }))).toBeNull();
    expect(o.uisOzetMetni(grup({ mevcutNode: mn, envler: [ENV1], olculemedi: true }))).toBeNull();
    const literalDep = { ...dep, ad: 'adapter', mevcutNode: mn };
    const refDep = { ...dep, ad: 'indexer', mevcutNode: null };
    const isleyici = { ...dep, ad: 'processor', nodeBagli: false, mevcutNode: null };
    expect(o.uisOzetMetni(grup({ mevcutNode: mn, envler: [ENV1], deploymentlar: [literalDep, refDep] }))).toBeNull();
    expect(o.uisOzetMetni(grup({ mevcutNode: mn, envler: [ENV1], deploymentlar: [literalDep, isleyici] }))).toBe(
      "Tüm bileşenler aynı node'a bağlı: rpc: https://a/****; ws: wss://a/****",
    );
    const ad = o as unknown as Record<string, unknown>;
    for (const k of [
      'katalogRozeti', 'nodeRozeti', 'adaySecilebilir', 'adayEtiketi', 'maskeliOzet', 'secimAdaydaMi', 'adaySizNotu', 'adayYokMetni',
    ])
      expect(ad[k], k).toBeUndefined();
    const m = o.METIN as unknown as Record<string, unknown>;
    for (const k of [
      'katalogda', 'katalogdaYok', 'nodeRozet', 'nodeTanimsiz', 'mevcutAciklama', 'yeniNodeYerTutucu', 'ekKullanimda',
      'ekCozulemedi', 'adayYokListeBos', 'adayYokGrup', 'kartListeBos', 'kartGrupBos',
    ])
      expect(m[k], k).toBeUndefined();
    expect(o.METIN.mevcutBasliklar).toEqual(['Bileşen', 'Kap', 'Env değişkeni', 'Şu anki değer (maskeli)']);
    expect(o.METIN.uisBasliklar).toEqual(['Bileşen', 'Deployment', 'Durum', 'Node değişkeni', 'Şu anki değer']);
    expect(o.METIN.gecmisBasliklar[2]).toBe('Yeni değer (maskeli)');
    expect(o.METIN.yeniNodeEtiket).toBe('Yeni değer (maskeli)');
    expect(o.METIN.smartGorunum('https://a.invalid/****')).toBe("Smart'ta böyle görünecek: https://a.invalid/****");
    expect(o.METIN.bosUyari('p2p')).toBe("p2p boş bırakıldı: env değişkeni BOŞ değere yazılır, uygulama node'suz kalabilir.");
  });
});
