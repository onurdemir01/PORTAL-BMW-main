// src/components/telnet/steps/JbossVersionStep.tsx — Telnet testi sihirbazinin JBoss surum adimi: ortak adim
// (common/sihirbaz/JbossSurumAdimi; majör bazinda gruplar) bu modulun sunucu ucuyla.
import React from 'react';
import { telnetApi } from '@/api/telnetApi';
import JbossSurumAdimi from '@/components/common/sihirbaz/JbossSurumAdimi';

const JbossVersionStep: React.FC<{
  app: string;
  busy?: boolean;
  onSubmit: (versions: string[]) => void;
}> = (p) => (
  <JbossSurumAdimi
    {...p}
    sunuculariGetir={(app) => telnetApi.getHosts(app)}
    soru="Hangi JBoss sürümündeki sunucularla test yapmak istiyorsunuz?"
  />
);

export default JbossVersionStep;
