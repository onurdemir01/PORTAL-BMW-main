// src/components/server_hub/jvmNesil.ts — JVM nesil etiketi (2026-11-14, üretim GBJIST02).
//
// Server Hub, taramada JVM'i bulunamayan dbo.MWAppsInventory uygulamasını gen 0 satır olarak tutar
// (source 'envanter', yalnizEnvanter). Bu satır taranmış bir JVM değildir; ekranda "JBoss 0" yerine
// "yalnız envanterde" yazılır. Nesil basılan her yer bu yardımcıyı kullanır.

export const YALNIZ_ENVANTER_ETIKETI = 'yalnız envanterde';

/** Taramada JVM'i olmayan, yalnız envanterden gelen satır mı. */
export function yalnizEnvanterMi(
  j: { source?: string | null; yalnizEnvanter?: boolean | null } | null | undefined,
): boolean {
  return !!j && (j.yalnizEnvanter === true || j.source === 'envanter');
}

/** "JBoss 7" / "JBoss 8"; yalnız envanterdeki (ya da gen 0) satırda "yalnız envanterde"; nesil bilinmiyorsa "JBoss ?". */
export function jvmNesilEtiketi(
  j:
    | { gen?: number | null; source?: string | null; yalnizEnvanter?: boolean | null }
    | null
    | undefined,
): string {
  if (!j) return 'JBoss ?';
  if (yalnizEnvanterMi(j) || j.gen === 0) return YALNIZ_ENVANTER_ETIKETI;
  return j.gen ? `JBoss ${j.gen}` : 'JBoss ?';
}

type SayilanJvm = { source?: string | null; yalnizEnvanter?: boolean | null };
/** Taranmış JVM sayısı; "yalnız envanterde" satırları JVM sayılmaz, ayrıca yazılır: "2 JVM + 1 yalnız envanterde". */
export function jvmSayisiMetni(jvms: SayilanJvm[] | null | undefined): string {
  const l = jvms || [];
  const env = l.filter(yalnizEnvanterMi).length;
  return `${l.length - env} JVM${env ? ` + ${env} ${YALNIZ_ENVANTER_ETIKETI}` : ''}`;
}
