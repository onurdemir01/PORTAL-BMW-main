// src/components/common/sihirbaz/tipler.ts — ortak sihirbaz adimlarinin sunucu satiri: OpsX / Telnet / FileX
// getHosts yanitinin ortak alanlari (envanter hostsForApp).
export interface JbossSunucu {
  host: string;
  env: string;
  jbossVersion: string;
  status: string;
}
