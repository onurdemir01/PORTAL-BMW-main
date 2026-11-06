// src/components/server_hub/__tests__/ear-jboss-eslesmesi.test.tsx — Uygulama Envanteri: JBoss eşlemesi
// (tarayıcı sürüm 2, 2026-11-06).
//
//   EJ1 durum dili: JVM'e bağlı yeşil DEĞİL (JVM kapalı olabilir); okunamadı / ölçülmedi yeşil değil;
//       JVM_YOK alt nedenleri ayrı etiket
//   EJ2 xmlEslesmeOku: boş / bozuk / bilinmeyen durum -> null (ölçülmedi), eksik listeler boş dizi
//   EJ3 xmlNedenMetni: ham dosya durumu okunur dile çevrilir
//   EJ4 bölüm: JVM tablosu (auto-start, deployment etkin/devre dışı), deployment satırı (yol / ad eşleşmesi,
//       server-group yok), okunamadıysa nedeni, eski taramada "ölçülmedi"
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { JbossEslesmesi } from '@/components/server_hub/EarEnvanterDetay';
import { xmlEslesmeOku, jbossDurumu, xmlNedenMetni } from '@/components/server_hub/earEnvanter';

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
