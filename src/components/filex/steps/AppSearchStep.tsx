// src/components/filex/steps/AppSearchStep.tsx — FileX dosya listesi sihirbazinin uygulama secimi: ortak adim
// (common/sihirbaz/UygulamaAramaAdimi) bu modulun arama ucuyla. Bu kutu sayfanin ilk icerigi: odak tasinmaz.
import React from 'react';
import { filexApi } from '@/api/filexApi';
import UygulamaAramaAdimi from '@/components/common/sihirbaz/UygulamaAramaAdimi';

const AppSearchStep: React.FC<{ onSelect: (app: string) => void; busy?: boolean }> = (p) => (
  <UygulamaAramaAdimi {...p} ara={(q) => filexApi.searchApps(q)} />
);

export default AppSearchStep;
