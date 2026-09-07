// src/utils/ansibleProgress.ts — AWX çıktısından GERÇEK adımı okur.
//
// NEDEN VAR: `JobProgress` "şu an ne oluyor" bilgisini KRONOMETREDEN üretiyordu:
//   <10sn  → "Sunuculara bağlanılıyor…"
//   <30sn  → (genel etiket)
//   >30sn  → "Bu biraz uzun sürüyor — büyük bir sonuç kümesi olabilir…"
//
// Üçü de playbook'un gerçekte ne yaptığına DEĞİL, geçen süreye bakıyordu. Sonuncusu
// bir adım daha ileri gidip UYDURULMUŞ BİR TEŞHİS koyuyordu: 2026-09'daki LogX OCP
// arızasında iş boş parola yüzünden takılıyken kullanıcıya "büyük bir sonuç kümesi
// olabilir" deniyordu — yani ekran, yanlış yeri işaret ediyordu.
//
// Ansible çıktısı gerçek adımı zaten yazıyor (`TASK [...]`). Panel açıkken bu metin
// zaten çekiliyor; buradaki saf fonksiyonlar onu okunur hale getirir.

/** Çıktıdaki SON `TASK [...]` / `PLAY [...]` başlığı. Yoksa null. */
export function currentTaskName(stdout: unknown): string | null {
  const text = String(stdout ?? '');
  if (!text) return null;
  // Ansible başlıkları satır başındadır ve `TASK [ad] ****` biçimindedir.
  const matches = [...text.matchAll(/^(TASK|PLAY) \[([^\]]+)\]/gm)];
  if (!matches.length) return null;
  const name = matches[matches.length - 1][2].trim();
  return name || null;
}

/** Çıktıda şu ana kadar KAÇ görev başlığı geçti. "Adım N" için — tahmin değil, sayım. */
export function taskCount(stdout: unknown): number {
  const text = String(stdout ?? '');
  if (!text) return 0;
  return (text.match(/^TASK \[[^\]]+\]/gm) || []).length;
}

/**
 * Görev adını kullanıcı diline çevirir.
 *
 * ÇEVİRİ BURADA, PLAYBOOK'TA DEĞİL: AWX log'unu operasyon ekibi okuyor, orada
 * İngilizce kalması doğru; ayrıca playbook'lar AWX'e ELLE kopyalanıyor, her metin
 * değişikliği için redeploy istemek anlamsız. (`src/utils/scalexLog.ts` ile aynı karar.)
 *
 * Eşleşme yoksa ad AYNEN döner — uydurma yapılmaz.
 */
const TASK_TEXT: { test: RegExp; text: string }[] = [
  { test: /validate|assert|kimlik dosyasi/i, text: 'Girdiler doğrulanıyor' },
  { test: /add_host|dynamic inventory|terminal host/i, text: 'Sunucular hazırlanıyor' },
  { test: /probe candidate oc|resolve the oc binary/i, text: '`oc` aracı aranıyor' },
  { test: /login/i, text: "Cluster'lara bağlanılıyor" },
  { test: /list namespace|namespaces/i, text: 'Namespace listesi alınıyor' },
  { test: /pods|application|object/i, text: 'Uygulamalar taranıyor' },
  { test: /collect|fetch|log/i, text: 'Log dosyaları toplanıyor' },
  { test: /archive|zip|staging/i, text: 'Arşiv hazırlanıyor' },
  { test: /clean|cleanup|remove/i, text: 'Geçici dosyalar temizleniyor' },
  { test: /publish|set_stats|result/i, text: 'Sonuç yayınlanıyor' },
];

export function humanizeTask(name: unknown): string {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  for (const r of TASK_TEXT) if (r.test.test(raw)) return r.text;
  return raw;
}

/**
 * Ekranda gösterilecek "şu an ne oluyor" satırı.
 *
 * KRONOMETREYE DAYALI TAHMİN YOK. Çıktı elde varsa gerçek adım yazılır; yoksa
 * yalnızca AWX'ten gelen DURUM söylenir ve sebep hakkında iddia edilmez.
 */
export function progressText(status: string, stdout?: unknown): string {
  const task = currentTaskName(stdout);
  if (task) {
    const n = taskCount(stdout);
    return n > 0 ? `Adım ${n}: ${humanizeTask(task)}` : humanizeTask(task);
  }
  if (status === 'pending' || status === 'waiting') return 'AWX kuyruğunda bekleniyor…';
  if (status === 'running') return 'Çalışıyor — ayrıntı için Ansible çıktısını açın.';
  return 'İşleniyor…';
}
