// src/components/admin/tabs/kurumayari/FarkOnizleme.tsx — kaydetmeden önce değişen anahtar yolları.
// Eklenen / silinen / değişen alanlar ve listelerde eklenen / çıkan değerler okunur biçimde.
import React from 'react';
import { anahtarli, kisaDeger, type Fark } from './duzenleyici';

const yolStili: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: '0.8rem' };

function Deger({ v }: { v: unknown }) {
  const tam = JSON.stringify(v, null, 2) ?? String(v);
  return (
    <code className="truncate inline-block max-w-full align-bottom" title={tam} style={yolStili}>
      {kisaDeger(v)}
    </code>
  );
}

function Cip({ v, ton }: { v: unknown; ton: 'ekle' | 'cikar' }) {
  const ekle = ton === 'ekle';
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 mr-1 mb-1"
      style={{
        ...yolStili,
        background: ekle ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
        color: ekle ? 'var(--status-success)' : 'var(--status-danger-text)',
      }}
    >
      {ekle ? '+ ' : '− '}
      {kisaDeger(v, 60)}
    </span>
  );
}

function Grup({
  baslik,
  adet,
  children,
}: {
  baslik: string;
  adet: number;
  children: React.ReactNode;
}) {
  if (!adet) return null;
  return (
    <section className="space-y-1">
      <h4
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: 'var(--text-muted)' }}
      >
        {baslik} ({adet})
      </h4>
      <ul className="space-y-1">{children}</ul>
    </section>
  );
}

const yolGoster = (yol: string) => yol || '(kök)';

export default function FarkOnizleme({ fark }: { fark: Fark }) {
  return (
    <div className="space-y-3" data-testid="fark-onizleme">
      <Grup baslik="Eklenen" adet={fark.eklenen.length}>
        {fark.eklenen.map((x) => (
          <li key={x.yol} className="min-w-0">
            <span style={{ ...yolStili, color: 'var(--status-success)' }}>
              + {yolGoster(x.yol)}
            </span>{' '}
            <Deger v={x.deger} />
          </li>
        ))}
      </Grup>
      <Grup baslik="Silinen" adet={fark.silinen.length}>
        {fark.silinen.map((x) => (
          <li key={x.yol} className="min-w-0">
            <span style={{ ...yolStili, color: 'var(--status-danger-text)' }}>
              − {yolGoster(x.yol)}
            </span>{' '}
            <Deger v={x.deger} />
          </li>
        ))}
      </Grup>
      <Grup baslik="Değişen" adet={fark.degisen.length}>
        {fark.degisen.map((x) => (
          <li key={x.yol} className="min-w-0">
            <span style={yolStili}>~ {yolGoster(x.yol)}</span> <Deger v={x.eski} />{' '}
            <span style={{ color: 'var(--text-muted)' }}>→</span> <Deger v={x.yeni} />
          </li>
        ))}
      </Grup>
      <Grup baslik="Değişen listeler" adet={fark.listeler.length}>
        {fark.listeler.map((x) => (
          <li key={x.yol} className="min-w-0">
            <div style={yolStili}>~ {yolGoster(x.yol)}</div>
            <div className="mt-1">
              {anahtarli(x.eklenen).map(({ k, v }) => (
                <Cip key={`e${k}`} v={v} ton="ekle" />
              ))}
              {anahtarli(x.cikan).map(({ k, v }) => (
                <Cip key={`c${k}`} v={v} ton="cikar" />
              ))}
              {x.siraDegisti && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  yalnız sıra değişti
                </span>
              )}
            </div>
          </li>
        ))}
      </Grup>
    </div>
  );
}
