// src/utils/ssBaglar.ts — Self Servis kartının (sunucu, template) bağları (2026-11-10).
// Şu anki bağ + Self Servis Taşıma sonrası önceki bağlar: servisin Geçmiş sekmesi taşımadan
// önce eski sunucuda koşmuş işleri de gösterir (iş geçmişi eski sunucuda salt-okunur kalır).
import type { AnsibleSsItem } from '@/api/ansibleApi';

export function servisBaglari(item: Pick<AnsibleSsItem, 'awxServerId' | 'awxTemplateId' | 'oncekiBaglar'>): { awxServerId: number; awxTemplateId: number }[] {
  return [
    { awxServerId: Number(item.awxServerId), awxTemplateId: Number(item.awxTemplateId) },
    ...(item.oncekiBaglar ?? []).map((b) => ({ awxServerId: Number(b.awxServerId), awxTemplateId: Number(b.awxTemplateId) })),
  ];
}

/** Geçmiş kaydı bu servise mi ait (şu anki ya da önceki bağ). */
export function servisinIsiMi(
  item: Pick<AnsibleSsItem, 'awxServerId' | 'awxTemplateId' | 'oncekiBaglar'>,
  h: { template_id: number | string; awx_server_id: number | string },
): boolean {
  return servisBaglari(item).some((b) => Number(h.template_id) === b.awxTemplateId && Number(h.awx_server_id) === b.awxServerId);
}
