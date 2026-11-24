// src/components/filex/steps/JbossVersionStep.tsx — FileX dosya listesi sihirbazinin JBoss surum adimi: ortak adim
// (common/sihirbaz/JbossSurumAdimi; majör bazinda gruplar) bu modulun sunucu ucuyla.
import React from 'react';
import { filexApi } from '@/api/filexApi';
import JbossSurumAdimi from '@/components/common/sihirbaz/JbossSurumAdimi';

const JbossVersionStep: React.FC<{
  app: string;
  busy?: boolean;
  onSubmit: (versions: string[]) => void;
}> = (p) => (
  <JbossSurumAdimi
    {...p}
    sunuculariGetir={(app) => filexApi.getHosts(app)}
    soru="Hangi JBoss sürümündeki sunucularda dosya listelemek istiyorsunuz?"
  />
);

export default JbossVersionStep;
