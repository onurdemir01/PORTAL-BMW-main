// src/components/filex/steps/HostSelectStep.tsx — FileX dosya listesi sihirbazinin sunucu secimi: ortak adim
// (common/sihirbaz/SunucuSecimAdimi; satir kimligi (host, majör), sunucuya tekil host adlari) bu modulun
// sunucu ucuyla. Secilen host'lar sunucuda yine dogrulanir (anti-TOCTOU, server/filex/index.cjs).
import React from 'react';
import { filexApi } from '@/api/filexApi';
import SunucuSecimAdimi from '@/components/common/sihirbaz/SunucuSecimAdimi';

const HostSelectStep: React.FC<{
  app: string;
  jbossVersions: string[];
  busy?: boolean;
  onSubmit: (hosts: string[]) => void;
}> = (p) => (
  <SunucuSecimAdimi
    {...p}
    sunuculariGetir={(app) => filexApi.getHosts(app)}
    soru="Hangi sunucularda dosya listelemek istiyorsunuz?"
  />
);

export default HostSelectStep;
