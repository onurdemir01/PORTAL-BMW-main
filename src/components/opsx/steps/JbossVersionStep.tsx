// src/components/opsx/steps/JbossVersionStep.tsx — uygulama seçildikten sonra,
// sunucu listesinden ÖNCE JBoss versiyonu sorulur. Aynı uygulamanın host'ları
// farklı JBoss majör sürümlerinde (7.X / 8.Y) olabiliyor — kullanıcı birden fazla
// sürümü BİRLİKTE seçebilir (ör. hem 7.X hem 8.Y), HostSelectStep listeyi buna
// göre filtreler.
//
// MAJÖR SÜRÜM BAZINDA GRUPLANIR (tam sürüm string'i DEĞİL): eskiden burada TAM
// envanter değeri ("7.3.10", "8.1.2" gibi) tek tek seçenek olarak listeleniyordu —
// aynı majör sürümde birden fazla minör sürüm varsa (ör. hem "8.0.7" hem "8.1.2"
// host'ları), kullanıcı sadece BİRİNİ işaretlediğinde diğer minör sürümdeki host'lar
// HostSelectStep'te hiç görünmüyordu (bildirilen hata: "Jboss8 sunucuları
// listelenmedi"). Artık tek bir "JBoss 8.X" seçeneği o majör sürümdeki TÜM host'ları
// kapsar — server/opsx/index.cjs.resolveLegacyTargets zaten majör sürüm bazında
// çalışıyordu, önyüz de aynı granülariteye getirildi.
//
// `jbossMajorOf` ARTIK BURADA DEĞİL: aynı yardımcıyı Telnet bu dosyadan import
// ediyordu — bir modülün sihirbaz adımı başka bir modülün adımına bağımlıydı.
// Ortak yer: src/utils/jboss.ts (LogX, OpsX, Telnet ve FileX birlikte kullanır).
import React from 'react';
import { opsxApi } from '@/api/opsxApi';
import JbossSurumAdimi from '@/components/common/sihirbaz/JbossSurumAdimi';

// Govde ortak adimda (common/sihirbaz/JbossSurumAdimi, 2026-11-24): Telnet ve FileX ayni adimi kullanir. OpsX'te
// gruptaki gercek surumler kirpilmaz, satira sarar.
const JbossVersionStep: React.FC<{
  app: string;
  busy?: boolean;
  onSubmit: (versions: string[]) => void;
}> = (p) => (
  <JbossSurumAdimi
    {...p}
    sunuculariGetir={(app) => opsxApi.getHosts(app)}
    soru="Hangi JBoss sürümündeki sunucularla işlem yapmak istiyorsunuz?"
    surumlerSarar
  />
);

export default JbossVersionStep;
