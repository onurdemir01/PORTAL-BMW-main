// src/components/telnet/steps/HostSelectStep.tsx — Telnet testi sihirbazinin sunucu secimi: ortak adim
// (common/sihirbaz/SunucuSecimAdimi; satir kimligi (host, majör), sunucuya tekil host adlari) bu modulun
// sunucu ucuyla. Secilen host'lar sunucuda yine dogrulanir (anti-TOCTOU, server/telnet/index.cjs).
import React from 'react';
import { telnetApi } from '@/api/telnetApi';
import SunucuSecimAdimi from '@/components/common/sihirbaz/SunucuSecimAdimi';

const HostSelectStep: React.FC<{
  app: string;
  jbossVersions: string[];
  busy?: boolean;
  onSubmit: (hosts: string[]) => void;
}> = (p) => (
  <SunucuSecimAdimi
    {...p}
    sunuculariGetir={(app) => telnetApi.getHosts(app)}
    soru="Lütfen Telnet testinin yapılacağı sunucuları seçin"
  />
);

export default HostSelectStep;
