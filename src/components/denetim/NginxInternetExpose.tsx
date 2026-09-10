// src/components/denetim/NginxInternetExpose.tsx — "API'yi internete aç".
//
// Test ortamındaki API tanımlarını listeler ve her birinin yanında, tanımı internete
// açık sunucuya (varsayılan GBNGXT07) BİREBİR kopyalayan bir buton sunar.
//
// Bir API = BİR DOSYA (`<api>.conf`); içindeki `location` blokları o API'nin
// yollarıdır — liste "dosya + içindeki API'ler" şeklinde bu yüzden kuruluyor.
//
// EYLEM GERİ ALINMASI KOLAY DEĞİL (bir tanım internete açılıyor), bu yüzden tıklama
// doğrudan iş başlatmaz: önce ne yapılacağını yazan bir onay adımı gelir.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { nginxExposeApi, type NginxExposeResult, type NginxExposeRow } from '@/api/nginxExposeApi';
import { Modal } from '@/components/common/Modal';
import { Panel, StatTile, Pill, TableShell, Th, Td, Code, Note } from './ui';

const nf = (n: number) => new Intl.NumberFormat('tr-TR').format(n);

export function NginxInternetExpose() {
  const [data, setData] = useState<NginxExposeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  // Onay bekleyen istek + sonuç mesajı
  const [pending, setPending] = useState<{ row: NginxExposeRow; host: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await nginxExposeApi.apis();
      if (r.ok) {
        setData(r);
        setErr('');
      } else setErr(r.message || 'Veri alınamadı.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // ILK YUKLEME EFFECT ICINDE: istek BURADA kurulur, `load()` cagrilmaz.
  //
  // NEDEN: `load` ilk isi olarak `setLoading(true)` cagiriyor ve React 19'un
  // `set-state-in-effect` kurali, effect'ten cagrilan bir fonksiyonun ICINDEKI
  // setState'i de "effect'te senkron" sayiyor — `setLoading(true)`'yu cikarmak
  // BILE yetmiyor (olculdu). Burada ilk ifade `await`, yani hicbir setState
  // senkron degil. `loading` zaten `true` basladigi icin ilk yuklemede bayragi
  // ayrica kaldirmaya gerek de yok.
  //
  // `alive` bayragi ayri bir kazanc: sekme yanit gelmeden kapanirsa cozulmus
  // istegin sonucu artik olmayan bir bilesene yazilmaz.
  // `load` KALIYOR: Yenile dugmesi onu cagiriyor ve olay isleyicisinde
  // setState tamamen mesru.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await nginxExposeApi.apis();
        if (!alive) return;
        if (r.ok) {
          setData(r);
          setErr('');
        } else setErr(r.message || 'Veri alınamadı.');
      } catch (e: unknown) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return data.rows;
    return data.rows.filter(
      (r) =>
        r.api.toLowerCase().includes(needle) ||
        r.locations.some((l) => l.path.toLowerCase().includes(needle)),
    );
  }, [data, q]);

  async function confirmOpen() {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await nginxExposeApi.open(pending.row.api, pending.host);
      if (r.ok) {
        setResult({
          tone: 'ok',
          text: `${pending.row.api} için iş başlatıldı${r.job?.id ? ` (job ${r.job.id})` : ''}. Hedef: ${r.targetHost || '—'}. Sonucu AWX'ten izleyebilirsiniz.`,
        });
      } else {
        setResult({ tone: 'bad', text: r.message || 'İş başlatılamadı.' });
      }
    } catch (e: unknown) {
      setResult({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  if (loading && !data)
    return <div className="py-10 text-center text-sm text-[var(--text-muted)]">Yükleniyor…</div>;
  if (err)
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
        {err}
      </div>
    );
  if (!data) return null;

  if (!data.scanDate) {
    return (
      <Note tone="info" title="Henüz tarama kaydı yok">
        <Code>nginx_ratelimit_inventory</Code> job&apos;ı çalıştıktan sonra burası dolacak.
      </Note>
    );
  }

  const configured = data.config.awxServerId > 0 && data.config.templateId > 0;

  return (
    <div className="space-y-3">
      <Note tone="info" title="Bu ekran ne yapıyor?">
        Test ortamında tanımlı API&apos;leri listeler. Bir satırdaki{' '}
        <b>&quot;API&apos;yi internete aç&quot;</b> butonu, o API&apos;nin konfigürasyon dosyasını
        kaynak test sunucusundan <b>birebir okuyup</b> internete açık sunucuya (
        <Code>{data.config.targetHost}</Code>) kopyalar; limit zone satırları da taşınır. Yeniden
        üretilmez — kopyalanır, çünkü konfigürasyon bloğu hiçbir envanterde saklanmıyor, yalnızca
        dosyanın kendisinde var.
        <div className="mt-1.5">
          Hedefte ilgili <Code>include</Code> satırı yoksa iş <b>durur</b>: dosya yazılsaydı nginx
          onu hiç yüklemez, API açılmış <i>görünüp</i> açılmamış olurdu.
        </div>
      </Note>

      {!configured && (
        <Note tone="warning" title="Buton henüz çalışmıyor — yapılandırma eksik">
          <Code>api_expose.yml</Code> için AWX&apos;te bir job template açılıp Portal&apos;a
          tanıtılması gerekiyor. Bu yapılana kadar butona basmak açık bir hata döndürür, sessizce
          hiçbir şey yapmaz.
        </Note>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="test API dosyası" value={nf(data.rows.length)} />
        <StatTile
          label="toplam yol (location)"
          value={nf(data.rows.reduce((a, r) => a + r.locations.length, 0))}
        />
        <StatTile
          label="kaynak sunucu"
          value={nf(data.hosts.length)}
          hint={data.hosts.join(', ')}
        />
        <StatTile
          label="hedef"
          value={data.config.targetHost}
          tone="accent"
          hint="İnternete açık sunucu"
        />
      </div>

      {result && <Note tone={result.tone === 'ok' ? 'success' : 'danger'}>{result.text}</Note>}

      <Panel
        title="Test ortamındaki API'ler"
        description={`${nf(rows.length)} dosya gösteriliyor · tarama ${data.scanDate}`}
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="API ya da yol ara"
                className="pl-8 pr-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg w-52"
              />
            </div>
            <button
              onClick={load}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-elevated)]"
            >
              <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Yenile
            </button>
          </div>
        }
        dense
      >
        <TableShell maxHeight="34rem">
          <thead>
            <tr>
              <Th>API (dosya)</Th>
              <Th align="right">Yol</Th>
              <Th>Kaynak sunucu</Th>
              <Th align="right">İşlem</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <React.Fragment key={r.configFile}>
                <tr>
                  <Td>
                    <button
                      type="button"
                      onClick={() => setOpen(open === r.configFile ? null : r.configFile)}
                      className="flex items-center gap-1 text-left font-mono hover:underline"
                      title="İçindeki yolları göster"
                    >
                      <ChevronRightIcon
                        className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${
                          open === r.configFile ? 'rotate-90' : ''
                        }`}
                      />
                      {r.configFile}
                    </button>
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {nf(r.locations.length)}
                  </Td>
                  <Td className="font-mono text-[11px]" title={r.hosts.join(', ')}>
                    {r.hosts[0] || '—'}
                    {r.hosts.length > 1 && (
                      <span className="text-[var(--text-muted)]"> +{r.hosts.length - 1}</span>
                    )}
                  </Td>
                  <Td align="right">
                    <button
                      type="button"
                      disabled={!r.hosts.length}
                      onClick={() => {
                        setResult(null);
                        setPending({ row: r, host: r.hosts[0] });
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors disabled:opacity-40"
                      style={{
                        borderColor: 'var(--accent-light)',
                        background: 'var(--accent-bg)',
                        color: 'var(--accent)',
                      }}
                    >
                      <GlobeAltIcon className="w-3.5 h-3.5" /> API&apos;yi internete aç
                    </button>
                  </Td>
                </tr>
                {open === r.configFile && (
                  <tr>
                    <td colSpan={4} className="p-0">
                      <div
                        className="px-4 py-3 border-t"
                        style={{
                          background: 'var(--bg-elevated)',
                          borderColor: 'var(--border-subtle)',
                        }}
                      >
                        <div
                          className="text-[11px] font-semibold mb-1.5"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {r.configFile} içindeki yollar
                        </div>
                        <div className="space-y-1">
                          {r.locations.map((l) => (
                            <div
                              key={l.path}
                              className="flex flex-wrap items-center gap-2 text-[11px]"
                            >
                              <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                                {l.path}
                              </span>
                              {l.ipRateLimit && <Pill tone="info">IP: {l.ipRateLimit}</Pill>}
                              {l.serverRateLimit && (
                                <Pill tone="info">location: {l.serverRateLimit}</Pill>
                              )}
                              {!l.ipRateLimit && !l.serverRateLimit && (
                                <Pill tone="warning">rate limit yok</Pill>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </TableShell>
      </Panel>

      <Modal
        open={!!pending}
        onClose={() => setPending(null)}
        title="API'yi internete aç"
        subtitle={
          pending ? `${pending.row.api} · ${pending.host} → ${data.config.targetHost}` : undefined
        }
        icon={GlobeAltIcon}
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setPending(null)}
              className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)]"
            >
              İptal
            </button>
            <button
              onClick={confirmOpen}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {busy ? 'Başlatılıyor…' : 'Evet, internete aç'}
            </button>
          </div>
        }
      >
        {pending && (
          <div className="space-y-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            <p>
              <b>{pending.row.configFile}</b> dosyası <Code>{pending.host}</Code> sunucusundan
              okunup <Code>{data.config.targetHost}</Code> sunucusuna kopyalanacak. Bu API
              internetten erişilebilir hâle gelecek.
            </p>
            <div>
              Taşınacak yollar:
              <div className="mt-1 space-y-0.5">
                {pending.row.locations.map((l) => (
                  <div
                    key={l.path}
                    className="font-mono text-[11px]"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {l.path}
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Hedefte aynı isimde bir tanım varsa önce yedeklenir. <Code>nginx -t</Code> başarısız
              olursa değişiklik geri alınır ve iş hata ile biter.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
