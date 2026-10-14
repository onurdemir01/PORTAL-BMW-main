// src/components/scalex/kapiMetni.ts — seçim sürerken ekranın söylediği onay kuralı.
//
// NEDEN VAR (2026-10-14, kullanıcı): "Admin ekranında yalnız OCO dedim ama prod seçince
// yine 'SMART kaydı açılacak, ikinci kişi onayı istenir' yazıyor; her şey admin ekranıyla
// dinamik olmalı." Kapsam adımındaki uyarı ve toplu geri alma kutusu SABİT cümlelerdi:
// admin anahtarını (yalnız OCO), SMART'ın tanımlı olup olmadığını, OCO ortam listesini ve
// istisna kurallarını hiç okumuyorlardı. "İkinci kişi onayı" sunucuda HİÇ uygulanmayan bir
// vaatti (bkz. PreviewStep `requiresSecondPerson` notu).
//
// Cümleler artık YALNIZCA sunucunun kararından (`/gate-summary`, `/preview` ile aynı
// çözücü) üretilir. Saf fonksiyonlar: ekran testleri her durumu doğrudan sınar.
import type { ScaleXGatePolicy } from '@/api/scalexApi';

export interface KapiKurali {
  /** `engel`: değişiklik başlatılamaz (sunucu aynı metinle reddeder). */
  ton: 'engel' | 'uyari';
  satirlar: string[];
}

type SmartDurumu = NonNullable<ScaleXGatePolicy['smartStatus']>;

function smartDurumu(p: ScaleXGatePolicy): SmartDurumu {
  return p.smartStatus ?? (p.smart === 'require' ? 'unknown' : 'not_applicable');
}

/**
 * Değişiklik (Durdur / Ölçekle + Uygula) için kural. Hiçbir kapı yoksa `null` — ekran
 * bir şey söylemez (prod dışı, OCO listesinde olmayan ortam).
 */
export function degisiklikKurali(
  p: ScaleXGatePolicy,
  { secimeBagli = false }: { secimeBagli?: boolean } = {},
): KapiKurali | null {
  if (p.blocked) return { ton: 'engel', satirlar: [p.blocked.message] };
  const satirlar: string[] = [];
  if (p.oco === 'require') {
    satirlar.push('OCO numarası istenecek; iş yalnızca OCO penceresi içinde başlar.');
  } else if (p.ocoGateDisabled) {
    satirlar.push('OCO kapısı yönetici tarafından kapatıldı — değişiklik kaydı sorulmayacak.');
  }
  switch (smartDurumu(p)) {
    case 'ready':
    case 'unknown':
      satirlar.push('SMART kaydı açılacak; iş SMART onayından sonra başlar.');
      break;
    case 'disabled_by_admin':
      satirlar.push('SMART onayı yönetici ayarıyla kapalı (yalnız OCO) — SMART kaydı açılmaz.');
      break;
    case 'admin_skip':
      satirlar.push('Yönetici tercihiniz gereği SMART onayı atlanır.');
      break;
    case 'skipped_by_rule':
      satirlar.push('SMART istisna kuralı bu kapsamı kapsıyor — SMART kaydı açılmaz.');
      break;
    default:
      break;
  }
  if (!satirlar.length) return null;
  if (secimeBagli) {
    satirlar.push('Kesin karar, namespace ve işlem seçildikten sonra önizlemede gösterilir.');
  }
  return { ton: 'uyari', satirlar };
}

/**
 * Geri alma (toplu "Geri Al") için tek cümle — "Geri alma bir onarım işlemidir:"
 * ifadesinin devamı olarak okunur. Engelse sunucunun metni.
 */
export function geriAlmaKurali(p: ScaleXGatePolicy): KapiKurali {
  if (p.blocked) return { ton: 'engel', satirlar: [p.blocked.message] };
  const parcalar = [
    p.oco === 'warn'
      ? 'OCO penceresi dışında da çalışır, ama gerekçe zorunludur'
      : 'gerekçe zorunludur',
  ];
  switch (smartDurumu(p)) {
    case 'ready':
    case 'unknown':
      parcalar.push('her grup için SMART talebi açılır ve gerekçe SMART kaydına da yazılır');
      break;
    case 'disabled_by_admin':
      parcalar.push('SMART kaydı açılmaz (yönetici ayarı: yalnız OCO)');
      break;
    case 'admin_skip':
      parcalar.push('SMART onayı atlanır (yönetici tercihiniz)');
      break;
    case 'skipped_by_rule':
      parcalar.push('SMART istisna kuralı geçerli, SMART kaydı açılmaz');
      break;
    default:
      break;
  }
  return { ton: 'uyari', satirlar: [`${parcalar.join('; ')}.`] };
}
