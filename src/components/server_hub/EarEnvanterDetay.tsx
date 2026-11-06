// src/components/server_hub/EarEnvanterDetay.tsx — Uygulama Envanteri: tek uygulamanın ayrıntısı (2026-11-04).
//
// WAR'lar (teknoloji, tanımlayıcılar, JSP / TLD sayıları), her WAR'ın kütüphane listesi, EAR lib/,
// aynı adlı kopyalar (hangi sunucu aynı izde) ve ls -lrtiR benzeri ağaç. Ağaç /sw'deki ham dosyadan
// gelir: yalnız TAM kipte ve saklama süresindeki koşularda vardır; yoksa ekran nedenini söyler.
// Ağaç on binlerce satır olabilir: pencereli liste (sabit satır yüksekliği; yalnız görünen satırlar
// DOM'da). useVirtualizer yerine elle: React Compiler o kütüphaneyi derleyemiyor (lint uyarısı).
import React, { useMemo, useRef, useState } from 'react';
import { CubeIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/common/Modal';
import LoadError from '@/components/common/LoadError';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtNumber, fmtDateTime } from '@/utils/datetime';
import {
  earApi,
  earIndir,
  type EarUygulamaDetay,
  type EarAgac,
  type EarKutuphane,
  type EarWar,
} from '@/api/earEnvanterApi';
import {
  uygulamaDurumu,
  kisaIz,
  boyutMetni,
  agacSuz,
  xmlEslesmeOku,
  jbossDurumu,
  xmlNedenMetni,
} from './earEnvanter';
import {
  Rozet,
  Kirp,
  IndirBag,
  BTN,
  btnStil,
  GIRDI,
  girdiStil,
  TABLO,
  TH,
  TD,
  thStil,
} from './EarEnvanterUi';

const say = (n: number | null | undefined) => (n == null ? '—' : fmtNumber(n));
const evet = (b: boolean | null | undefined) => (b == null ? '—' : b ? 'var' : 'yok');
const SATIR_YUKSEKLIK = 22;
const PENCERE_YUKSEKLIK = 320; // h-80
const PAY = 20;

/** Kaydırma konumundan çizilecek satır aralığı [bas, son). */
export function pencereAraligi(ust: number, adet: number): [number, number] {
  // Liste kisaldiysa (suzgec, yeni veri) eski kaydirma konumu sonun otesinde kalabilir: son ekrana
  // sikistirilir, yoksa pencere bos cizilirdi.
  const u = Math.min(Math.max(0, ust), Math.max(0, adet * SATIR_YUKSEKLIK - PENCERE_YUKSEKLIK));
  const bas = Math.max(0, Math.floor(u / SATIR_YUKSEKLIK) - PAY);
  return [bas, Math.min(adet, Math.ceil((u + PENCERE_YUKSEKLIK) / SATIR_YUKSEKLIK) + PAY)];
}

/** JBoss eşlemesi: bu EAR hangi deployment / server-group / JVM'e bağlı; okunamadıysa nedeni. */
export function JbossEslesmesi({ ham }: { ham: string | null | undefined }) {
  const x = xmlEslesmeOku(ham);
  const d = jbossDurumu(x);
  return (
    <section className="space-y-1.5" data-testid="jboss-eslesmesi">
      <h3 className="text-xs font-semibold flex items-center gap-2">
        JBoss eşlemesi <Rozet d={d} kucuk />
      </h3>
      <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        {x && x.durum === 'OLCULEMEDI' ? xmlNedenMetni(x.neden) : d.aciklama}
      </div>
      {x && x.jvmler.length > 0 && (
        <table className={TABLO}>
          <thead>
            <tr>
              {['JVM', 'server-group', 'auto-start', 'deployment'].map((h) => (
                <th key={h} className={TH} style={thStil}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {x.jvmler.map((j) => (
              <tr key={`${j.kurulum}|${j.ad}`}>
                <td className={`${TD} font-mono`}>{j.ad}</td>
                <td className={`${TD} font-mono`}>{j.grup}</td>
                <td className={TD}>{j.auto_start ? 'açık' : 'kapalı'}</td>
                <td className={TD}>{j.deployment_acik ? 'etkin' : 'devre dışı'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {x && x.deploymentlar.length > 0 && (
        <div className="text-[11px] space-y-0.5" style={{ color: 'var(--text-muted)' }}>
          {x.deploymentlar.map((dp) => (
            <div key={`${dp.kurulum}|${dp.ad}`} className="font-mono">
              {dp.ad} · {dp.tur === 'YONETILEN' ? 'yönetilen içerik' : dp.yol} ·{' '}
              {dp.yontem === 'YOL' ? 'yol eşleşti' : 'ad eşleşti'}
              {dp.gruplar.length > 0 ? ` · ${dp.gruplar.map((g) => g.ad).join(', ')}` : ' · server-group yok'}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function KutuphaneListesi({ l }: { l: EarKutuphane[] }) {
  if (!l.length)
    return (
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Kütüphane yok.
      </div>
    );
  return (
    <div className="max-h-64 overflow-auto rounded border" style={{ borderColor: 'var(--border)' }}>
      <table className={TABLO}>
        <thead>
          <tr>
            {['Kütüphane', 'Sürüm', 'Boyut'].map((b) => (
              <th key={b} className={TH} style={thStil}>
                {b}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {l.map((k, i) => (
            <tr
              key={`${k.ad}@${k.surum}#${i}`}
              className="border-t"
              style={{ borderColor: 'var(--border)' }}
            >
              <td className={TD}>
                <Kirp v={k.ad} en="max-w-[22rem]" mono />
              </td>
              <td className={TD}>
                <Kirp v={k.surum || '(sürümsüz)'} en="max-w-[10rem]" mono />
              </td>
              <td className={TD}>{boyutMetni(k.boyut)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WarKarti({ w }: { w: EarWar }) {
  const [acik, setAcik] = useState(false);
  const teknoloji: [string, string | null][] = [
    ['Spring Boot', w.spring_boot],
    ['Spring FW', w.spring_framework],
    ['Spring Security', w.spring_security],
    ['log4j', w.log4j],
    ['logback', w.logback],
    ['jackson', w.jackson],
    ['thymeleaf', w.thymeleaf],
    ['struts', w.struts],
    ['servlet', w.servlet],
  ];
  return (
    <div className="rounded-lg border p-2 space-y-1.5" style={{ borderColor: 'var(--border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold">
          <Kirp v={w.ad} en="max-w-[24rem]" />
        </span>
        <Rozet d={uygulamaDurumu(w.durum)} kucuk />
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {w.bicim === 'ACIK'
            ? 'açık dizin'
            : w.bicim === 'ARSIV'
              ? 'paketli .war'
              : w.bicim === 'ARSIV_ICINDE'
                ? '.ear arşivinin içinde'
                : w.bicim}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-0.5 text-[11px]">
        <span>JSP / JSPX: {say(w.jsp)}</span>
        <span>TLD: {say(w.tld)}</span>
        <span>tld dizini: {evet(w.tld_dizini)}</span>
        <span>JAR: {say(w.jar)}</span>
        <span>CLASS: {say(w.class_sayisi)}</span>
        <span>web.xml: {evet(w.web_xml)}</span>
        <span>web.&lt;ortam&gt;.xml: {w.web_varyantlari || '—'}</span>
        <span>jboss-web.xml: {evet(w.jboss_web_xml)}</span>
        <span>jboss-deployment-structure: {evet(w.jboss_deployment_structure)}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {teknoloji
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <span key={k}>
              <span style={{ color: 'var(--text-muted)' }}>{k}:</span>{' '}
              <span className="font-mono">{v}</span>
            </span>
          ))}
      </div>
      <button type="button" className={BTN} style={btnStil()} onClick={() => setAcik(!acik)}>
        {acik ? 'Kütüphaneleri gizle' : `Kütüphaneler (${say(w.kutuphane_sayisi)})`}
      </button>
      {acik && <KutuphaneListesi l={w.kutuphaneler} />}
    </div>
  );
}

/** ls -lrtiR benzeri sanal liste: inode mod uid gid boyut mtime yol. */
export function AgacGoruntuleyici({ agac }: { agac: EarAgac }) {
  const [q, setQ] = useState('');
  const satirlar = useMemo(() => agacSuz(agac.satirlar, q), [agac.satirlar, q]);
  const kap = useRef<HTMLDivElement>(null);
  const [ust, setUst] = useState(0);
  const [bas, son] = pencereAraligi(ust, satirlar.length);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          aria-label="Ağaçta ara"
          placeholder="yol içinde ara (ör. WEB-INF/lib)"
          className={`${GIRDI} w-72`}
          style={girdiStil}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setUst(0);
            if (kap.current) kap.current.scrollTop = 0;
          }}
        />
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {fmtNumber(satirlar.length)} / {fmtNumber(agac.satirlar.length)} giriş
        </span>
      </div>
      {agac.satirlar.length === 0 ? (
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Ağaç satırı yok: bu koşu ÖZET kipteydi (ÖZET dosya başına stat yapmaz). Ağaç için TAM
          kipte tarayın.
        </div>
      ) : (
        <div
          ref={kap}
          onScroll={(e) => setUst(e.currentTarget.scrollTop)}
          data-testid="ear-agac"
          className="h-80 overflow-auto rounded border font-mono text-[11px]"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          <div style={{ height: satirlar.length * SATIR_YUKSEKLIK, position: 'relative' }}>
            {satirlar.slice(bas, son).map((s, i) => {
              return (
                <div
                  key={bas + i}
                  className="absolute left-0 right-0 px-2 whitespace-pre truncate"
                  style={{
                    top: (bas + i) * SATIR_YUKSEKLIK,
                    height: SATIR_YUKSEKLIK,
                    lineHeight: `${SATIR_YUKSEKLIK}px`,
                  }}
                  title={String(s[0])}
                >
                  {`${String(s[7] === '' ? '-' : s[7]).padStart(10)} ${String(s[2] || '-').padEnd(10)} ${String(s[3] === '' ? '-' : s[3]).padStart(5)} ${String(s[4] === '' ? '-' : s[4]).padStart(5)} ${boyutMetni(s[5]).padStart(9)} ${s[6] ? fmtDateTime(Number(s[6]) * 1000) : '-'}  ${s[0]}${s[8] ? ` -> ${s[8]}` : ''}`}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function EarEnvanterDetay({
  hedef,
  onClose,
}: {
  hedef: { kosu: number; host: string; uyg: number };
  onClose: () => void;
}) {
  const [d, setD] = useState<EarUygulamaDetay | null>(null);
  const [hata, setHata] = useState('');
  const [agac, setAgac] = useState<EarAgac | null>(null);
  const [agacHata, setAgacHata] = useState('');
  const [agacYukleniyor, setAgacYukleniyor] = useState(false);
  const [tazele, setTazele] = useState(0);
  useAsyncEffect(
    async (alive) => {
      setHata('');
      setD(null);
      try {
        const r = await earApi.uygulama(hedef.kosu, hedef.host, hedef.uyg);
        if (alive()) setD(r);
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [hedef.kosu, hedef.host, hedef.uyg, tazele],
  );
  const agaciYukle = async () => {
    setAgacYukleniyor(true);
    setAgacHata('');
    try {
      setAgac(await earApi.agac(hedef.kosu, hedef.host, hedef.uyg));
    } catch (e) {
      setAgacHata(e instanceof Error ? e.message : String(e));
    } finally {
      setAgacYukleniyor(false);
    }
  };
  const u = d && d.uygulama;
  let uyarilar: string[] = [];
  try {
    uyarilar = u && u.uyarilar ? (JSON.parse(u.uyarilar) as string[]) : [];
  } catch {
    uyarilar = [];
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      icon={CubeIcon}
      title={u ? `${u.host} · ${u.kok}/${u.ad}` : hedef.host}
      subtitle={u ? `koşu #${u.kosu_id} · ${u.kip === 'TAM' ? 'TAM' : 'ÖZET'} kip` : undefined}
    >
      {hata ? (
        <LoadError
          title="Uygulama ayrıntısı okunamadı"
          message={hata}
          onRetry={() => setTazele((n) => n + 1)}
        />
      ) : !d || !u ? (
        <div className="py-10 flex justify-center">
          <LoadingLogo />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Rozet d={uygulamaDurumu(u.durum)} />
            <span>JBoss {u.jboss}</span>
            <span style={{ color: 'var(--text-muted)' }}>· {u.ortam || 'ortam ?'}</span>
            <span style={{ color: 'var(--text-muted)' }}>
              ·{' '}
              {u.bicim === 'ARSIV'
                ? '.ear arşivi'
                : u.bicim === 'BAG'
                  ? 'sembolik bağ'
                  : 'açık dizin'}
            </span>
            {u.bag_hedefi && <span className="font-mono">→ {u.bag_hedefi}</span>}
            <span style={{ color: 'var(--text-muted)' }}>· {say(u.giris)} giriş</span>
            <span style={{ color: 'var(--text-muted)' }}>
              · application.xml {evet(u.application_xml)}
            </span>
            <span className="font-mono" title="yapı izi / kütüphane izi">
              · iz {kisaIz(u.yapi_izi)}/{kisaIz(u.kutuphane_izi)}
            </span>
            {u.taranma_utc && (
              <span style={{ color: 'var(--text-muted)' }}>
                · taranma {fmtDateTime(u.taranma_utc)}
              </span>
            )}
          </div>
          {uyarilar.length > 0 && (
            <div
              className="rounded-lg border px-3 py-2 text-[11px] space-y-0.5"
              style={{
                borderColor: 'var(--status-warning)',
                background: 'var(--status-warning-bg)',
              }}
            >
              <div className="font-semibold" style={{ color: 'var(--status-warning-text)' }}>
                {fmtNumber(u.uyari_sayisi ?? uyarilar.length)} uyarı
              </div>
              {uyarilar.map((x, i) => (
                <div key={i} className="font-mono" style={{ color: 'var(--text-primary)' }}>
                  {x}
                </div>
              ))}
            </div>
          )}
          <JbossEslesmesi ham={u.xml_eslesme} />
          <section className="space-y-2">
            <h3 className="text-xs font-semibold">WAR'lar ({d.warlar.length})</h3>
            {d.warlar.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                WAR bulunamadı.
              </div>
            ) : (
              d.warlar.map((w) => <WarKarti key={w.war_no} w={w} />)
            )}
            {d.earKutuphaneleri.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-[11px] font-semibold">
                  EAR lib/ ({d.earKutuphaneleri.length})
                </h4>
                <KutuphaneListesi l={d.earKutuphaneleri} />
              </div>
            )}
          </section>
          <section className="space-y-1">
            <h3 className="text-xs font-semibold">Aynı adlı kopyalar ({d.kopyalar.length})</h3>
            <div
              className="overflow-x-auto rounded-lg border"
              style={{ borderColor: 'var(--border)' }}
            >
              <table className={TABLO}>
                <thead>
                  <tr>
                    {['Sunucu', 'Ortam', 'Kök', 'Durum', 'Kip', 'Yapı izi', 'Kütüphane izi'].map(
                      (b) => (
                        <th key={b} className={TH} style={thStil}>
                          {b}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {d.kopyalar.map((k) => {
                    const ben = k.host === u.host && k.kok === u.kok;
                    const ayniKutuphane = k.kutuphane_izi && k.kutuphane_izi === u.kutuphane_izi;
                    return (
                      <tr
                        key={`${k.host}|${k.kok}`}
                        className="border-t"
                        style={{ borderColor: 'var(--border)', fontWeight: ben ? 600 : undefined }}
                      >
                        <td className={TD}>{k.host}</td>
                        <td className={TD}>{k.ortam || '—'}</td>
                        <td className={TD}>{k.kok}</td>
                        <td className={TD}>
                          <Rozet d={uygulamaDurumu(k.durum)} kucuk />
                        </td>
                        <td className={TD}>{k.kip === 'TAM' ? 'TAM' : 'ÖZET'}</td>
                        <td className={`${TD} font-mono`}>{kisaIz(k.yapi_izi)}</td>
                        <td
                          className={`${TD} font-mono`}
                          title={
                            ben
                              ? 'bu kopya'
                              : ayniKutuphane
                                ? 'bu kopyayla aynı'
                                : 'bu kopyadan farklı'
                          }
                        >
                          {kisaIz(k.kutuphane_izi)} {ben ? '' : ayniKutuphane ? '=' : '≠'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-semibold">Dosya ağacı</h3>
              {!agac && (
                <button
                  type="button"
                  className={BTN}
                  style={btnStil(true)}
                  disabled={agacYukleniyor}
                  onClick={agaciYukle}
                >
                  {agacYukleniyor ? 'Yükleniyor…' : 'Ağacı göster'}
                </button>
              )}
              <IndirBag
                href={earIndir.agacTxt(hedef.kosu, hedef.host, hedef.uyg)}
                title="ls -lrtiR benzeri, insan ve yapay zekâ için"
              >
                tree.txt
              </IndirBag>
              <IndirBag href={earIndir.inventory(hedef.kosu, hedef.host, hedef.uyg)}>
                inventory.json
              </IndirBag>
              <IndirBag
                href={earIndir.zip(hedef.kosu, hedef.host)}
                title="Bu sunucudaki bütün uygulamalar"
              >
                Sunucu ZIP
              </IndirBag>
            </div>
            {agacHata && (
              <LoadError
                title="Ağaç okunamadı"
                message={agacHata}
                onRetry={agaciYukle}
                retrying={agacYukleniyor}
                compact
              />
            )}
            {agac && <AgacGoruntuleyici agac={agac} />}
          </section>
        </div>
      )}
    </Modal>
  );
}
