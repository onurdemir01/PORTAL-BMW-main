// src/components/server_hub/__tests__/ear-jboss-eslesmesi.test.tsx — Uygulama Envanteri: JBoss eşlemesi
// (tarayıcı sürüm 2, 2026-11-06).
//
//   EJ1 durum dili: JVM'e bağlı yeşil DEĞİL (JVM kapalı olabilir); okunamadı / ölçülmedi yeşil değil;
//       JVM_YOK alt nedenleri ayrı etiket
//   EJ2 xmlEslesmeOku: boş / bozuk / bilinmeyen durum -> null (ölçülmedi), eksik listeler boş dizi
//   EJ3 xmlNedenMetni: ham dosya durumu okunur dile çevrilir
//   EJ4 bölüm: JVM tablosu (auto-start, deployment etkin/devre dışı), deployment satırı (yol / ad eşleşmesi,
//       server-group yok), okunamadıysa nedeni, eski taramada "ölçülmedi"
//   EJ5 dizin kullanımı (sürüm 4): süreç / son yazma görünür, 7 gün eşiği, ölçülemeyen "kullanılmıyor" değil
//   EJ6 inceleme (2026-11-17): eşiğin referansı TARAMA anı (duvar saati değil); ileri tarihli yazma kanıt değil;
//       okunamayan süreç / hidepid "görülmedi" nötrü değil; maps / '?' nasıl; Server Hub sunucu panelinde rozet
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { JbossEslesmesi } from '@/components/server_hub/EarEnvanterDetay';
import { BagsizKullanim } from '@/components/server_hub/SunucuPaneli';
import {
  xmlEslesmeOku,
  jbossDurumu,
  xmlNedenMetni,
  kullanimDurumu,
} from '@/components/server_hub/earEnvanter';
import type { EarKullanim } from '@/api/earEnvanterApi';

const ham = (x: unknown) => JSON.stringify(x);
const VAR = {
  durum: 'VAR',
  neden: null,
  deploymentlar: [
    {
      kurulum: '/usr/jboss/AppServer',
      ad: 'ODEME.ear',
      tur: 'ACIK',
      yol: '/vhosting/ODEME.ear',
      yontem: 'YOL',
      gruplar: [{ ad: 'odeme-grp', acik: true }],
    },
  ],
  jvmler: [
    {
      ad: 'ODEME_JVM1',
      grup: 'odeme-grp',
      auto_start: false,
      deployment_acik: true,
      kurulum: '/usr/jboss/AppServer',
    },
    {
      ad: 'ODEME_JVM2',
      grup: 'odeme-grp',
      auto_start: true,
      deployment_acik: false,
      kurulum: '/usr/jboss/AppServer',
    },
  ],
};

describe('EJ1 durum dili', () => {
  it('hiçbir JBoss durumu yeşil değil', () => {
    for (const x of [
      VAR,
      { durum: 'JVM_YOK', neden: 'TANIM_YOK' },
      { durum: 'JVM_YOK', neden: 'GRUPTA_YOK' },
      { durum: 'JVM_YOK', neden: 'SUNUCU_YOK' },
      { durum: 'OLCULEMEDI', neden: 'x domain.xml IZIN' },
    ])
      expect(jbossDurumu(xmlEslesmeOku(ham(x))).ton).not.toBe('iyi');
    expect(jbossDurumu(null).etiket).toBe('ölçülmedi');
  });
  it('JVM_YOK alt nedenleri ayrı etiket', () => {
    const e = (neden: string) =>
      jbossDurumu(xmlEslesmeOku(ham({ durum: 'JVM_YOK', neden }))).etiket;
    expect(new Set([e('TANIM_YOK'), e('GRUPTA_YOK'), e('SUNUCU_YOK')]).size).toBe(3);
    expect(jbossDurumu(xmlEslesmeOku(ham({ durum: 'OLCULEMEDI' }))).etiket).toBe('okunamadı');
  });
});

describe('EJ2 xmlEslesmeOku', () => {
  it('boş, bozuk ya da bilinmeyen durum ölçülmedi sayılır', () => {
    expect(xmlEslesmeOku(null)).toBeNull();
    expect(xmlEslesmeOku('')).toBeNull();
    expect(xmlEslesmeOku('{bozuk')).toBeNull();
    expect(xmlEslesmeOku(ham({ durum: 'BELKI' }))).toBeNull();
  });
  it('eksik listeler boş dizi olur', () => {
    expect(xmlEslesmeOku(ham({ durum: 'JVM_YOK', neden: 'TANIM_YOK' }))).toMatchObject({
      deploymentlar: [],
      jvmler: [],
    });
  });
});

describe('EJ3 xmlNedenMetni', () => {
  it('dosya durumlarını okunur dile çevirir', () => {
    expect(
      xmlNedenMetni(
        '/usr/jboss8/AppServer domain.xml REDDEDILDI; /usr/jboss/AppServer domain.xml IZIN',
      ),
    ).toBe(
      '/usr/jboss8/AppServer domain.xml: DOCTYPE/ENTITY içerdiği için okunmadı; /usr/jboss/AppServer domain.xml: okuma izni yok',
    );
    expect(xmlNedenMetni('/k host.xml BOZUK')).toBe('/k host.xml: XML bozuk');
    expect(xmlNedenMetni(null)).toBe('');
  });
});

describe('EJ4 JBoss eşlemesi bölümü', () => {
  it('JVM tablosu ve deployment satırı', () => {
    render(<JbossEslesmesi ham={ham(VAR)} />);
    const b = screen.getByTestId('jboss-eslesmesi');
    expect(within(b).getByText('JVM’e bağlı')).toBeInTheDocument();
    const satirlar = within(b).getAllByRole('row');
    expect(satirlar).toHaveLength(3);
    expect(within(satirlar[1]).getByText('ODEME_JVM1')).toBeInTheDocument();
    expect(within(satirlar[1]).getByText('kapalı')).toBeInTheDocument();
    expect(within(satirlar[1]).getByText('etkin')).toBeInTheDocument();
    expect(within(satirlar[2]).getByText('açık')).toBeInTheDocument();
    expect(within(satirlar[2]).getByText('devre dışı')).toBeInTheDocument();
    expect(
      within(b).getByText(/ODEME\.ear · \/vhosting\/ODEME\.ear · yol eşleşti · odeme-grp/),
    ).toBeInTheDocument();
  });
  it('server-group yoksa yazar; JVM tablosu çizilmez', () => {
    render(
      <JbossEslesmesi
        ham={ham({
          durum: 'JVM_YOK',
          neden: 'GRUPTA_YOK',
          deploymentlar: [
            { kurulum: '/k', ad: 'A.ear', tur: 'YONETILEN', yol: '', yontem: 'AD', gruplar: [] },
          ],
          jvmler: [],
        })}
      />,
    );
    const b = screen.getByTestId('jboss-eslesmesi');
    expect(within(b).getByText('grupta yok')).toBeInTheDocument();
    expect(within(b).queryByRole('table')).toBeNull();
    expect(
      within(b).getByText(/A\.ear · yönetilen içerik · ad eşleşti · server-group yok/),
    ).toBeInTheDocument();
  });
  it('okunamadıysa nedeni okunur dilde', () => {
    render(
      <JbossEslesmesi
        ham={ham({ durum: 'OLCULEMEDI', neden: '/usr/jboss/AppServer domain.xml IZIN' })}
      />,
    );
    const b = screen.getByTestId('jboss-eslesmesi');
    expect(within(b).getByText('okunamadı')).toBeInTheDocument();
    expect(
      within(b).getByText('/usr/jboss/AppServer domain.xml: okuma izni yok'),
    ).toBeInTheDocument();
  });
  it('eski tarama: ölçülmedi', () => {
    render(<JbossEslesmesi ham={null} />);
    const b = screen.getByTestId('jboss-eslesmesi');
    expect(within(b).getByText('ölçülmedi')).toBeInTheDocument();
    expect(within(b).getByText(/eski tarayıcıyla/)).toBeInTheDocument();
  });
});

// EJ5 dizin kullanımı (tarayıcı sürüm 4, 2026-11-17; ODCRPAP01 canlı Node.js): JBoss'a bağlı olmayan EAR'da süreç /
// son yazma görünür; yakın yazma ve süreç uyarı (silinmemeli); ölçülemeyen "kullanılmıyor" denmez; hiçbiri yeşil değil.
describe('EJ5 dizin kullanımı', () => {
  const SIMDI = Date.parse('2026-11-17T10:00:00Z');
  const sn = (ms: number) => Math.floor(ms / 1000);
  const jvmsiz = (kullanim: unknown) =>
    ham({ durum: 'JVM_YOK', neden: 'TANIM_YOK', deploymentlar: [], jvmler: [], kullanim });
  it('süreç: rozet, pid / comm / nasıl / kullanıcı ve son yazma görünür', () => {
    render(
      <JbossEslesmesi
        taranma={SIMDI}
        ham={jvmsiz({
          durum: 'VAR',
          surecler: [{ pid: 76867, comm: 'node', kullanici: 'was', nasil: 'cwd' }],
          son_yazma: sn(Date.parse('2026-11-16T21:56:00Z')),
          not: null,
        })}
      />,
    );
    const b = screen.getByTestId('dizin-kullanimi');
    expect(within(b).getByText('dizin kullanımda')).toBeInTheDocument();
    expect(within(b).getByText('node pid 76867 (cwd) · was')).toBeInTheDocument();
    expect(within(b).getByText(/son yazma: 17\.11\.2026 00:56/)).toBeInTheDocument();
    expect(within(b).getByText(/silinmemeli/)).toBeInTheDocument();
  });
  it('yalnız yakın yazma (7 gün içinde) uyarı; daha eski yazma "görülmedi"', () => {
    const { unmount } = render(
      <JbossEslesmesi
        taranma={SIMDI}
        ham={jvmsiz({ durum: 'YOK', surecler: [], son_yazma: sn(SIMDI - 6 * 86400000), not: null })}
      />,
    );
    expect(
      within(screen.getByTestId('dizin-kullanimi')).getByText('yakında yazılmış'),
    ).toBeInTheDocument();
    unmount();
    render(
      <JbossEslesmesi
        taranma={SIMDI}
        ham={jvmsiz({ durum: 'YOK', surecler: [], son_yazma: sn(SIMDI - 8 * 86400000), not: null })}
      />,
    );
    expect(
      within(screen.getByTestId('dizin-kullanimi')).getByText('kullanım görülmedi'),
    ).toBeInTheDocument();
  });
  it('kısmi / ölçülemedi / eski tarayıcı "kullanılmıyor" demez; hiçbir kullanım durumu yeşil değil', () => {
    for (const k of [
      {
        durum: 'VAR',
        surecler: [{ pid: 1, comm: 'x', kullanici: '', nasil: 'fd' }],
        son_yazma: null,
        not: null,
      },
      { durum: 'YOK', surecler: [], son_yazma: null, not: null },
      { durum: 'KISMI', surecler: [], son_yazma: null, not: 'surec siniri' },
      { durum: 'OLCULEMEDI', surecler: [], son_yazma: null, not: null },
    ])
      expect(kullanimDurumu(k as EarKullanim, SIMDI)?.ton).not.toBe('iyi');
    expect(
      kullanimDurumu({ durum: 'KISMI', surecler: [], son_yazma: null, not: null }, SIMDI)?.etiket,
    ).toBe('kullanım kısmen ölçüldü');
    render(<JbossEslesmesi taranma={SIMDI} ham={jvmsiz(undefined)} />);
    expect(
      within(screen.getByTestId('dizin-kullanimi')).getByText(
        /ölçülmedi .*“kullanılmıyor” sayılmaz/,
      ),
    ).toBeInTheDocument();
  });
  it('JVM’e bağlı EAR’da dizin kullanımı bölümü yok', () => {
    render(<JbossEslesmesi ham={ham(VAR)} />);
    expect(screen.queryByTestId('dizin-kullanimi')).toBeNull();
  });
});

describe('EJ6 inceleme: tarama referansı, ileri tarih, kısmi görünürlük, sunucu paneli', () => {
  const TARAMA = Date.parse('2026-10-01T10:00:00Z');
  const sn = (ms: number) => Math.floor(ms / 1000);
  const jvmsiz = (kullanim: unknown) =>
    ham({ durum: 'JVM_YOK', neden: 'TANIM_YOK', deploymentlar: [], jvmler: [], kullanim });
  const yok = { durum: 'YOK' as const, surecler: [], not: null };
  it('eski taramada taramadan 1 saat önce yazılmış dizin hâlâ "yakında yazılmış" (referans tarama, şimdi değil)', () => {
    render(
      <JbossEslesmesi
        taranma="2026-10-01T10:00:00"
        ham={jvmsiz({ ...yok, son_yazma: sn(TARAMA - 3600000) })}
      />,
    );
    expect(
      within(screen.getByTestId('dizin-kullanimi')).getByText('yakında yazılmış'),
    ).toBeInTheDocument();
    expect(kullanimDurumu({ ...yok, son_yazma: sn(TARAMA - 8 * 86400000) }, TARAMA)?.etiket).toBe(
      'kullanım görülmedi',
    );
  });
  it('tarama anından 1 günden fazla ileri tarihli yazma kanıt değil (uyarı), 1 gün içi yakın sayılır', () => {
    expect(kullanimDurumu({ ...yok, son_yazma: sn(TARAMA + 3 * 86400000) }, TARAMA)?.etiket).toBe(
      'son yazma ileri tarihli',
    );
    expect(kullanimDurumu({ ...yok, son_yazma: sn(TARAMA + 3600000) }, TARAMA)?.etiket).toBe(
      'yakında yazılmış',
    );
  });
  it('okunamayan süreç / hidepid varken "görülmedi" nötr değil, sarı', () => {
    for (const ek of [{ okunamayan: 3 }, { hidepid: '2' }]) {
      const d = kullanimDurumu({ ...yok, son_yazma: null, ...ek }, TARAMA);
      expect([d?.etiket, d?.ton]).toEqual(['kullanım kısmen görüldü', 'uyari']);
    }
    expect(kullanimDurumu({ ...yok, son_yazma: null, okunamayan: 0 }, TARAMA)?.ton).toBe('notr');
    render(
      <JbossEslesmesi taranma={TARAMA} ham={jvmsiz({ ...yok, son_yazma: null, okunamayan: 42 })} />,
    );
    expect(
      within(screen.getByTestId('dizin-kullanimi')).getByText(
        /42 süreç izin yüzünden yalnız komut satırından denetlendi/,
      ),
    ).toBeInTheDocument();
  });
  it('sunucu paneli: JVM’e bağlanmayan EAR satırında kullanım rozeti ve süreç; ölçülmediyse söyler', () => {
    const { unmount } = render(
      <BagsizKullanim
        taramaMs={TARAMA}
        k={{
          durum: 'VAR',
          surecler: [{ pid: 76867, comm: 'node', kullanici: 'was', nasil: 'maps' }],
          son_yazma: null,
          not: null,
        }}
      />,
    );
    const b = screen.getByTestId('bagsiz-kullanim');
    expect(within(b).getByText('dizin kullanımda')).toBeInTheDocument();
    expect(within(b).getByText(/node pid 76867 \(maps\) · was/)).toBeInTheDocument();
    unmount();
    render(<BagsizKullanim taramaMs={null} k={null} />);
    expect(
      within(screen.getByTestId('bagsiz-kullanim')).getByText('kullanım ölçülmedi'),
    ).toBeInTheDocument();
  });
});
