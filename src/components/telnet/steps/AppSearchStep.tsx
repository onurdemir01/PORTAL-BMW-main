// src/components/telnet/steps/AppSearchStep.tsx — Telnet testi sihirbazinin uygulama secimi: ortak adim
// (common/sihirbaz/UygulamaAramaAdimi) bu modulun arama ucuyla.
import React from 'react';
import { telnetApi } from '@/api/telnetApi';
import UygulamaAramaAdimi from '@/components/common/sihirbaz/UygulamaAramaAdimi';

const AppSearchStep: React.FC<{ onSelect: (app: string) => void; busy?: boolean }> = (p) => (
  <UygulamaAramaAdimi {...p} ara={(q) => telnetApi.searchApps(q)} odakla />
);

export default AppSearchStep;
