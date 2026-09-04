// src/api/http.ts — tum src/api/*.ts dosyalarinin ortak kullandigi guvenli JSON
// ayristirici. Sunucu (dev ortaminda Vite proxy hedefi gecici erisilemez oldugunda,
// veya beklenmedik bir hatada) JSON yerine HTML donebilir ("Unexpected token '<'"
// hatasi buradan gelir) — safeJson bunu content-type kontrolu ile yakalayip
// durum kodu + govde-onizlemesi iceren OKUNABILIR bir hata firlatir.
export async function safeJson(res: Response): Promise<any> {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw Object.assign(
      new Error(
        `Sunucu beklenmeyen bir yanıt döndü (HTTP ${res.status}) — lütfen tekrar deneyin veya yöneticiye bildirin.` +
          (text ? ` [${text.slice(0, 150).replace(/\s+/g, ' ')}]` : ''),
      ),
      { status: res.status },
    );
  }
  // OK OLMAYAN JSON yanitlari da status tasimali — or. 401/403 `res.json()` basarili
  // donebilir (`{ ok: false, message: "..." }`) ama caller'in HTTP durumunu bilmesi
  // gerekir (polling dongusu 403'te durmali, 502'de yeniden denemeli).
  const body = await res.json();
  if (!res.ok && body && typeof body === 'object') {
    return Object.assign(body, { _httpStatus: res.status });
  }
  return body;
}
