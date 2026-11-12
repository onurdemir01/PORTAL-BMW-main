// src/components/nginx_console/EskiSunucular.tsx — Nginx Hub: kapatılmış (eski) sunucular (2026-11-12).
//
// Kullanıcı: "Nginx Hub'da silinmiş ve artık var olmayan sunucuların verileri hâlâ tablolarda
// duruyor." Sunucu, envanterde (dbo.Inventory, nginx sürümü dolu) olmayan VE 14+ gündür hiçbir
// kaynakta görülmeyen sunucuları her listede gizler. Burada:
//   - EskiSunucuNotu: açık sekmede kaç sunucunun gizlendiğini söyleyen kısa not;
//   - EskiSunucuTemizligi: yalnız Admin — adaylar, kaynak başına ne silineceği, yazılı onay
//     ("SIL"), sonuç özeti. Sunucu silme anında adaylığı yeniden denetler ve sınırları uygular.
import React, { useMemo, useState } from 'react';
import { ArchiveBoxXMarkIcon, ArrowPathIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/common/Modal';
import { TableEmptyRow } from '@/components/common/EmptyState';
import { Panel, Pill } from '@/components/denetim/ui';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';
import {
  nginxEskiSunucuApi,
  useEskiGizli,
  type EskiAday,
  type EskiAdaylarSonuc,
  type EskiKaynak,
  type EskiTemizlikSonuc,
} from '@/api/nginxEskiSunucuApi';

/** Onay metni: 'SIL' ya da Türkçe Q klavyede Caps Lock ile çıkan 'SİL' (sunucu ikisini de kabul eder). */
const onayGecerli =(m: string): boolean => ['SIL', 'SİL'].includes(m.trim());

/** Gizlenen sunucu varsa kısa not; yoksa hiçbir şey. */
export function EskiSunucuNotu({ kaynaklar }: { kaynaklar: readonly EskiKaynak[] }) {
  const e = useEskiGizli(kaynaklar);
  if (!kaynaklar.length || !e || !e.sayi) return null;
  const liste = e.hostlar.slice(0, 30).join(', ') + (e.hostlar.length > 30 ? ` (+${e.hostlar.length - 30})` : '');
  return (
    <div
      data-testid="nc-eski-notu"
      className="flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px]"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
      title={liste}
    >
      <InformationCircleIcon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <span>
        {fmtNumber(e.sayi)} eski sunucu gizlendi (envanterde yok, {e.gun}+ gündür taranmadı)
        {liste ? <span className="font-mono"> · {liste}</span> : null}
      </span>
    </div>
  );
}

const satirToplami = (o: Record<string, number>) => Object.values(o || {}).reduce((a, n) => a + (n || 0), 0);
const tabloAdi = (t: string) => t.replace(/^dbo\./, '');

function KaynakDokumu({ a }: { a: EskiAday }) {
  const satirlar = [
    ...Object.entries(a.portal || {}).map(([t, n]) => ({ kaynak: 'Portal DB', t, n })),
    ...Object.entries(a.tbmwans || {}).map(([t, n]) => ({ kaynak: 'TBMWANS', t, n })),
  ].filter((x) => x.n > 0);
  return (
    <div className="text-[11px] space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
      {a.dosyalar.length > 0 && (
        <div>
          <b>Dosya:</b> <span className="font-mono">{a.dosyalar.join(', ')}</span>
        </div>
      )}
      {satirlar.map((x) => (
        <div key={x.kaynak + x.t}>
          <b>{x.kaynak}:</b> <span className="font-mono">{tabloAdi(x.t)}</span> — {fmtNumber(x.n)} satır
        </div>
      ))}
      {!a.dosyalar.length && !satirlar.length && <div>Silinecek veri yok.</div>}
    </div>
  );
}

/** Yalnız Admin: eski sunucu verisinin temizliği. */
export function EskiSunucuTemizligi() {
  const [veri, setVeri] = useState<EskiAdaylarSonuc | null>(null);
  const [hata, setHata] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [acik, setAcik] = useState<string | null>(null);
  const [onayAcik, setOnayAcik] = useState(false);
  const [onayMetni, setOnayMetni] = useState('');
  const [siliniyor, setSiliniyor] = useState(false);
  const [sonuc, setSonuc] = useState<EskiTemizlikSonuc | null>(null);

  const yukle = async () => {
    setYukleniyor(true);
    setHata('');
    try {
      const r = await nginxEskiSunucuApi.adaylar();
      if (r.ok) {
        setVeri(r);
        const varolan = new Set(r.adaylar.map((a) => a.host));
        setSecili((s) => new Set([...s].filter((h) => varolan.has(h))));
      } else {
        setVeri(null);
        setHata(r.message || (r as unknown as { error?: string }).error || 'Aday listesi alınamadı.');
      }
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setYukleniyor(false);
    }
  };

  const maksHost = veri?.sinirlar?.maksHost ?? 50;
  const maksSatir = veri?.sinirlar?.maksSatir ?? 20000;
  const seciliAdaylar = useMemo(() => (veri?.adaylar || []).filter((a) => secili.has(a.host)), [veri, secili]);
  const seciliSatir = seciliAdaylar.reduce((t, a) => t + a.toplamSatir, 0);
  const seciliDosya = seciliAdaylar.reduce((t, a) => t + a.dosyalar.length, 0);

  const degistir = (h: string) =>
    setSecili((s) => {
      const n = new Set(s);
      if (n.has(h)) n.delete(h);
      else if (n.size < maksHost) n.add(h);
      return n;
    });
  const hepsi = () => setSecili(new Set((veri?.adaylar || []).slice(0, maksHost).map((a) => a.host)));

  const sil = async () => {
    setSiliniyor(true);
    try {
      const r = await nginxEskiSunucuApi.temizle([...secili], onayMetni.trim());
      setSonuc(r.ok ? r : { ...r, message: r.message || (r as unknown as { error?: string }).error || 'Temizlik yapılamadı.' });
      setOnayAcik(false);
      setOnayMetni('');
      if (r.ok) setSecili(new Set());
      await yukle();
    } catch (e) {
      setSonuc({ ok: false, message: e instanceof Error ? e.message : String(e) });
      setOnayAcik(false);
    } finally {
      setSiliniyor(false);
    }
  };

  return (
    <Panel
      title={<span className="flex items-center gap-1.5"><ArchiveBoxXMarkIcon className="w-4 h-4" /> Eski sunucu temizliği</span>}
      description={
        `Envanterde olmayan ve ${veri?.gun ?? 14}+ gündür hiçbir kaynakta görülmeyen sunucuların dökümleri ve tablo satırları. ` +
        `Envanter okunamazsa hiçbir sunucu eski sayılmaz. Tek seferde en fazla ${maksHost} sunucu ve ${fmtNumber(maksSatir)} satır silinir; ` +
        'kalan varsa yeniden çalıştırın.'
      }
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={yukle}
            disabled={yukleniyor}
            data-testid="nc-eski-listele"
            className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium rounded-lg border disabled:opacity-40"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin' : ''}`} /> {veri ? 'Yenile' : 'Adayları listele'}
          </button>
          <button
            onClick={() => { setOnayMetni(''); setOnayAcik(true); }}
            disabled={!secili.size || siliniyor}
            data-testid="nc-eski-sil"
            className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium rounded-lg border disabled:opacity-40"
            style={{ borderColor: 'var(--status-danger)', background: 'var(--bg-surface)', color: 'var(--status-danger-text, var(--status-danger))' }}
          >
            Seçilileri sil ({secili.size})
          </button>
        </div>
      }
    >
      {hata && (
        <div className="text-xs mb-2" role="alert" style={{ color: 'var(--status-danger-text, var(--status-danger))' }}>{hata}</div>
      )}
      {sonuc && (
        <div
          data-testid="nc-eski-sonuc"
          className="rounded-lg border px-3 py-2 mb-2 text-xs space-y-1"
          style={{ borderColor: sonuc.ok && !sonuc.kalanVar ? 'var(--status-success)' : 'var(--status-warning)', background: 'var(--bg-elevated)' }}
        >
          {sonuc.ok ? (
            <>
              <div>
                <b>{fmtNumber(sonuc.toplamSatir || 0)} satır silindi</b> ·{' '}
                {fmtNumber((sonuc.hosts || []).reduce((t, h) => t + h.dosyalar.length, 0))} dosya ·{' '}
                {(sonuc.hosts || []).filter((h) => h.tamam).length}/{(sonuc.hosts || []).length} sunucu tamamlandı
              </div>
              {sonuc.kalanVar && (
                <div style={{ color: 'var(--status-warning-text, var(--text-secondary))' }}>
                  {sonuc.butceDoldu ? 'İstek başına satır sınırına ulaşıldı. ' : ''}Kalan veri var — listeyi yenileyip yeniden çalıştırın.
                </div>
              )}
              {(sonuc.hosts || []).filter((h) => !h.tamam).map((h) => (
                <div key={h.host} className="font-mono text-[11px]">
                  {h.host}: {h.islenmedi ? 'işlenmedi (sınır)' : h.hatalar.length ? h.hatalar.map((x) => `${tabloAdi(x.tablo)}: ${x.mesaj}`).join('; ') : 'kısmen silindi'}
                </div>
              ))}
            </>
          ) : (
            <div>
              {sonuc.message}
              {sonuc.reddedilen?.length ? <div className="font-mono">{sonuc.reddedilen.join(', ')}</div> : null}
            </div>
          )}
        </div>
      )}
      {veri && (
        <>
          <div className="flex items-center gap-2 text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
            <span>{fmtNumber(veri.adaylar.length)} aday · eşik {fmtDateTime(veri.esik)} · hesaplandı {fmtDateTime(veri.hesaplandi)}</span>
            {veri.adaylar.length > 0 && (
              <button onClick={hepsi} className="underline">İlk {Math.min(maksHost, veri.adaylar.length)} adayı seç</button>
            )}
            {secili.size > 0 && <button onClick={() => setSecili(new Set())} className="underline">Seçimi temizle</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="nc-eski-tablo">
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left p-1.5 w-6" />
                  <th className="text-left p-1.5">Sunucu</th>
                  <th className="text-left p-1.5">Son görülme (döküm)</th>
                  <th className="text-left p-1.5">Son tarama (tablolar)</th>
                  <th className="text-right p-1.5">Dosya</th>
                  <th className="text-right p-1.5">Portal DB satırı</th>
                  <th className="text-right p-1.5">TBMWANS satırı</th>
                </tr>
              </thead>
              <tbody>
                {veri.adaylar.length === 0 && <TableEmptyRow colSpan={7} title="Eski sunucu adayı yok." />}
                {veri.adaylar.map((a) => (
                  <React.Fragment key={a.host}>
                    <tr className="border-t cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }} onClick={() => setAcik(acik === a.host ? null : a.host)}>
                      <td className="p-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`${a.host} seç`}
                          checked={secili.has(a.host)}
                          disabled={!secili.has(a.host) && secili.size >= maksHost}
                          onChange={() => degistir(a.host)}
                        />
                      </td>
                      <td className="p-1.5 font-mono">{a.host}</td>
                      <td className="p-1.5">{a.sonGorulme ? fmtDateTime(a.sonGorulme) : '—'}</td>
                      <td className="p-1.5">{a.sonTarama || '—'}</td>
                      <td className="p-1.5 text-right tabular-nums">{fmtNumber(a.dosyalar.length)}</td>
                      <td className="p-1.5 text-right tabular-nums">{fmtNumber(satirToplami(a.portal))}</td>
                      <td className="p-1.5 text-right tabular-nums">{fmtNumber(satirToplami(a.tbmwans))}</td>
                    </tr>
                    {acik === a.host && (
                      <tr>
                        <td />
                        <td colSpan={6} className="p-1.5"><KaynakDokumu a={a} /></td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Modal
        open={onayAcik}
        onClose={() => { if (!siliniyor) setOnayAcik(false); }}
        title="Eski sunucu verisini sil"
        size="lg"
        dismissOnBackdrop={false}
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOnayAcik(false)}
              disabled={siliniyor}
              className="px-3 py-1.5 text-xs rounded-lg border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              İptal
            </button>
            <button
              onClick={sil}
              disabled={!onayGecerli(onayMetni) || siliniyor}
              data-testid="nc-eski-onayla"
              className="px-3 py-1.5 text-xs rounded-lg disabled:opacity-40"
              style={{ background: 'var(--status-danger)', color: '#fff' }}
            >
              {siliniyor ? 'Siliniyor…' : 'Sil'}
            </button>
          </div>
        }
      >
        <div className="space-y-2 text-sm">
          <p>
            <b>{secili.size}</b> sunucunun verisi kalıcı olarak silinecek: yaklaşık <b>{fmtNumber(seciliSatir)}</b> tablo satırı ve{' '}
            <b>{fmtNumber(seciliDosya)}</b> döküm dosyası. Bu işlem geri alınamaz.
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Sunucu silmeden hemen önce her sunucunun hâlâ aday olduğunu yeniden denetler; biri envantere dönmüş ya da yeniden
            taranmışsa hiçbir şey silinmez. Bir istekte en fazla {fmtNumber(maksSatir)} satır silinir.
          </p>
          <div className="font-mono text-xs max-h-32 overflow-auto rounded border p-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
            {[...secili].sort().join(', ')}
          </div>
          <label className="block text-xs">
            Onaylamak için <b className="font-mono">SIL</b> yazın (büyük harfle; <span className="font-mono">SİL</span> de kabul edilir):
            <input
              data-testid="nc-eski-onay-metni"
              value={onayMetni}
              onChange={(e) => setOnayMetni(e.target.value)}
              className="mt-1 w-full rounded-lg border px-2 py-1 font-mono"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {seciliAdaylar.slice(0, 50).map((a) => (
              <Pill key={a.host} tone="neutral" title={`${a.toplamSatir} satır, ${a.dosyalar.length} dosya`}>{a.host}</Pill>
            ))}
          </div>
        </div>
      </Modal>
    </Panel>
  );
}
