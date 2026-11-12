// src/components/app_hub/jvmParam.ts — JBoss JVM parametresi düzenleme kuralları (2026-11-11).
// Sunucudaki server/app-hub/jvm-param.cjs ve AWX betiği server_hub_fix.sh ile AYNI izin listesi
// (bekçi: jvm-param-duzenle.test.tsx kaynakları karşılaştırır). Son söz sunucunundur; burası yalnız
// kullanıcıya yazarken geri bildirim verir.

export const JVMOPT_RE =
  /^(-D[A-Za-z0-9_.-]{1,128}(=[A-Za-z0-9_./:@%+=-]{0,512})?|-X(ms|mx|ss)[0-9]{1,6}[kKmMgG]|-XX:[+-][A-Za-z0-9]{1,64}|-XX:[A-Za-z0-9]{1,64}=[A-Za-z0-9_./:%-]{1,256})$/;
export const JVMOPT_YASAK_RE =
  /^-XX:[+-]?(OnError|OnOutOfMemoryError|VMOptionsFile|Flags|CompileCommandFile|CompilerDirectivesFile)|^-D(java\.security\.|java\.ext\.dirs|java\.endorsed\.dirs|java\.class\.path|java\.library\.path|java\.system\.class\.loader|sun\.boot\.|com\.sun\.management\.|jdk\.attach\.|java\.rmi\.server\.|jboss\.modules\.system\.pkgs|javax\.net\.ssl\.)/;
// server/server-hub/mask.cjs KEY_ERE ile aynı (parola / anahtar içeren -D anahtarları).
const SIR_RE =
  /(pass(word|wd|phrase)?|pwd|secret|token|credential|(access|license|signing|encryption|private|api|client|master|auth)[_.-]?key|key[_.-]?(store|pass)[_.-]?pass(word)?|keypass|storepass|truststore[_.-]?pass(word)?)/i;

/** "Aynı parametre" anahtarı: -Dad, -Xmx, -XX:Bayrak (+/- aynı), -XX:Ad= */
export function parametreAnahtari(opt: string): string {
  const s = String(opt || '');
  if (s.startsWith('-D')) return s.includes('=') ? s.slice(0, s.indexOf('=')) : s;
  if (/^-X(ms|mx|ss)/.test(s)) return s.slice(0, 4);
  if (/^-XX:[+-]/.test(s)) return `-XX:${s.slice(5)}`;
  if (s.startsWith('-XX:') && s.includes('=')) return `${s.slice(0, s.indexOf('='))}=`;
  return s;
}

/** Ekranda yazılabilir hata metni; geçerliyse null. */
export function parametreHatasi(opt: string): string | null {
  const s = String(opt || '').trim();
  if (!s) return 'Parametre girin.';
  if (s.includes('***')) return 'Maskeli değer (***) yazılamaz; gizlenen değeri yeniden girmeniz gerekir.';
  if (/\s/.test(s)) return 'Tek parametre girin (boşluk olamaz).';
  if (!JVMOPT_RE.test(s))
    return 'Biçim desteklenmiyor. Örnekler: -Dozellik=deger, -Xmx2g, -XX:+UseG1GC, -XX:MaxMetaspaceSize=512m (tırnak, virgül, $ ; ( ) kullanılamaz).';
  if (JVMOPT_YASAK_RE.test(s)) return `${parametreAnahtari(s)} Portal'dan değiştirilemez (komut çalıştırır ya da güvenliği kapatır).`;
  if (s.startsWith('-D') && SIR_RE.test(parametreAnahtari(s).slice(2)))
    return 'Parola / anahtar içeren parametreler Portal’dan yazılmaz (değer iş kaydında açık görünürdü).';
  return null;
}

/** Mevcut listede aynı anahtarlı belirteçler (maskeli olabilir). */
export function eslesenler(mevcut: string[], opt: string): string[] {
  const k = parametreAnahtari(opt);
  if (!k) return [];
  return mevcut.filter((t) => {
    if (k.startsWith('-D')) return t === k || t.startsWith(`${k}=`);
    if (/^-X(ms|mx|ss)$/.test(k)) return t.startsWith(k);
    if (k.endsWith('=')) return t.startsWith(k);
    if (k.startsWith('-XX:')) return t === `-XX:+${k.slice(4)}` || t === `-XX:-${k.slice(4)}`;
    return false;
  });
}

/** Mevcut bir belirteçten düzenleme başlangıcı: -D değeri maskeliyse yalnız "-Dad=" önerilir. */
export function duzenlemeBaslangici(tok: string): string {
  if (tok.startsWith('-D') && tok.includes('=')) {
    const deger = tok.slice(tok.indexOf('=') + 1);
    return deger.includes('*') ? `${tok.slice(0, tok.indexOf('='))}=` : tok;
  }
  return tok;
}
