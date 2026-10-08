// src/components/opsx/__tests__/host-kurulum-dizini.test.tsx — HK1..HK2 (2026-10-08).
//
// Uretim: GBJBOP18 / GBCCSECURETRACKER. Standart disi sunucuda /usr/jboss altina da JBoss 8
// kurulmus; envanter iki satir donduruyor, ikisi de 8.x. Kullanici: "sunucuyu sectigimde
// ikisini otomatik olarak tikliyor ... niye hem JBoss 7 dizinine kurulu JBoss 8'i seciyor?"
// Satir kimligi artik kurulum DIZINI (kol); iki satir ayri secilir, dizin ve "standart disi"
// etiketi gorunur, sunucuya secilen dizinin kolu gider.
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '@/test/test-utils';

vi.mock('@/api/opsxApi', () => ({
  opsxApi: {
    getHosts: vi.fn(async () => ({
      hosts: [
        { host: 'GBJBOP18', env: 'Production', jbossVersion: '8.0', status: 'running', appPath: '/vhosting/GBCCSECURETRACKER.ear', kurulum: '7' },
        { host: 'GBJBOP18', env: 'Production', jbossVersion: '8.1', status: 'running', appPath: '/vhosting8/GBCCSECURETRACKER.ear', kurulum: '8' },
      ],
    })),
  },
}));

import HostSelectStep from '../steps/HostSelectStep';

describe('OpsX sunucu secimi: ayni sunucuda iki JBoss 8 kurulumu', () => {
  it('HK1 iki satir AYRI secilir; birine tiklamak digerini secmez', async () => {
    let gonderilen: { hosts: string[]; hostMajors: string[] } | null = null;
    render(<HostSelectStep app="GBCCSECURETRACKER" jbossVersions={['8']} onSubmit={(v) => { gonderilen = v; }} />);
    await screen.findByText('/usr/jboss8');
    const kutular = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(kutular.length).toBe(2);
    const satir8 = screen.getByText('/usr/jboss8').closest('label') as HTMLElement;
    fireEvent.click(satir8.querySelector('input') as HTMLInputElement);
    expect(kutular.filter((k) => k.checked).length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /Devam/ }));
    expect(gonderilen).toEqual({ hosts: ['GBJBOP18'], hostMajors: ['8'] });
  });

  it('HK2 /usr/jboss altindaki JBoss 8 "standart disi" isaretlenir ve SECILINCE "7" kolu gider', async () => {
    let gonderilen: { hosts: string[]; hostMajors: string[] } | null = null;
    render(<HostSelectStep app="GBCCSECURETRACKER" jbossVersions={['8']} onSubmit={(v) => { gonderilen = v; }} />);
    const satir = (await screen.findByText('/usr/jboss')).closest('label') as HTMLElement;
    expect(satir.textContent).toContain('standart dışı');
    expect((screen.getByText('/usr/jboss8').closest('label') as HTMLElement).textContent).not.toContain('standart dışı');
    fireEvent.click(satir.querySelector('input') as HTMLInputElement);
    fireEvent.click(screen.getByRole('button', { name: /Devam/ }));
    expect(gonderilen).toEqual({ hosts: ['GBJBOP18'], hostMajors: ['7'] });
  });
});
