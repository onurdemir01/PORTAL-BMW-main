// src/components/server_hub/KurallarTab.tsx — Server Hub › Kurallar & Limitler (2026-10-20).
//
// Kullanıcı: "Hangi maddeler taranıyor ve hangi maddelerin hangi çıktıları kritik, uyarı, bilgi ve
// sorun yok olarak algılanıyor? Bunları liste halinde görebilmek istiyorum ve istediğimde bunların
// kritiklik seviyesini değiştirebilmek istiyorum." Ve: "tek seferde kaç sunucu yazılabileceğini
// oraya göstermeni ... bu limitin arttırılabilmesi için de adminlere yetki vermeni istiyorum."
//
// Liste sunucudaki TEK kaynaktan gelir (server/server-hub/kural-katalogu.cjs; bekçi onu assess.cjs
// ile karşılaştırır). Seviye değişikliği yalnız SEVİYEYİ değiştirir: sunucu durumu, sayaçlar,
// sıralama. Açılış Hazırlığı ve özet kartları koda bakar, değişmez — ekran bunu söyler.
import React, { useMemo, useState } from 'react';
import { ArrowPathIcon, MagnifyingGlassIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import {
  serverHubApi,
  type ShKurallar,
  type ShKuralCikti,
  type ShKuralMadde,
  type ShLimit,
  type ShSeverity,
  type ShAyarGecmis,
} from '@/api/serverHubApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { toast } from '@/hooks/useToast';
import { fmtNumber, fmtDateTime } from '@/utils/datetime';
import { LoadingLogo } from '@/components/common/LoadingLogo';

const OK_METIN = 'color-mix(in srgb, var(--status-success) 55%, var(--text-primary))';
export const SEVIYE: Record<ShSeverity, { etiket: string; renk: string; zemin: string; metin: string; etki: string }> = {
  danger: {
    etiket: 'kritik',
    renk: 'var(--status-danger)',
    zemin: 'var(--status-danger-bg)',
    metin: 'var(--status-danger-text)',
    etki: 'Sunucu durumu kritik olur, kritik sayacına girer.',
  },
  warning: {
    etiket: 'uyarı',
    renk: 'var(--status-warning)',
    zemin: 'var(--status-warning-bg)',
    metin: 'var(--status-warning-text)',
    etki: 'Sunucu durumu uyarı olur, uyarı sayacına girer.',
  },
  info: {
    etiket: 'bilgi',
    renk: 'var(--status-info)',
    zemin: 'var(--status-info-bg)',
    metin: 'var(--status-info)',
    etki: 'Listelenir, bilgi sayacına girer; sunucu durumu en fazla “bilgi” olur.',
  },
  ok: {
    etiket: 'sorun yok',
    renk: 'var(--status-success)',
    zemin: 'var(--status-success-bg)',
    metin: OK_METIN,
    etki: 'Bulgu listede kalır ama sayılmaz, sunucu durumunu etkilemez.',
  },
};
const SIRA: ShSeverity[] = ['danger', 'warning', 'info', 'ok'];
const BTN =
  'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
const btnStil = (birincil = false): React.CSSProperties =>
  birincil
    ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--text-on-accent, #fff)' }
    : { background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' };
const say = (n: number | null | undefined) => (n == null ? '—' : fmtNumber(n));

export function SeviyeRozeti({ s, kucuk = false }: { s: ShSeverity; kucuk?: boolean }) {
  const v = SEVIYE[s];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 ${kucuk ? 'py-0 text-[10px]' : 'py-0.5 text-[11px]'} font-semibold whitespace-nowrap`}
      style={{ background: v.zemin, color: v.metin }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: v.renk }} aria-hidden />
      {v.etiket}
    </span>
  );
}

/** Geçmiş satırının okunur adı: 'seviye:REBOOT_RISK' → "REBOOT_RISK seviyesi". */
function ayarAdi(anahtar: string, limitler: ShLimit[]): string {
  if (anahtar.startsWith('seviye:')) return `${anahtar.slice(7)} seviyesi`;
  if (anahtar.startsWith('limit:')) {
    const l = limitler.find((x) => x.ad === anahtar.slice(6));
    return `${l ? l.etiket : anahtar.slice(6)} · tek seferde sunucu`;
  }
  return anahtar;
}
const degerAdi = (anahtar: string, v: string | null) =>
  v == null ? '—' : anahtar.startsWith('seviye:') && v in SEVIYE ? SEVIYE[v as ShSeverity].etiket : v;

export default function KurallarTab() {
  const [veri, setVeri] = useState<ShKurallar | null>(null);
  const [hata, setHata] = useState('');
  const [yukleniyor, setYukleniyor] = useState(true);
  const [tazele, setTazele] = useState(0);
  const [q, setQ] = useState('');
  const [alan, setAlan] = useState('');
  const [yalnizDegisen, setYalnizDegisen] = useState(false);

  useAsyncEffect(
    async (alive) => {
      setYukleniyor(true);
      try {
        const r = await serverHubApi.kurallar(tazele > 0);
        if (!alive()) return;
        if (r.ok) {
          setVeri(r);
          setHata('');
        } else setHata(r.message || 'Kurallar alınamadı.');
      } catch (e) {
        if (alive()) setHata(String(e));
      } finally {
        if (alive()) setYukleniyor(false);
      }
    },
    [tazele],
  );
  const yenile = () => setTazele((n) => n + 1);

  const maddeler = useMemo(() => {
    if (!veri) return [] as ShKuralMadde[];
    // Türkçe küçük harf "I"yı "ı" yapar (SYNTAX_FAIL → syntax_faıl): kod araması için ı/i eşitlenir.
    const norm = (t: string) => t.toLocaleLowerCase('tr').replace(/ı/g, 'i');
    const aranan = norm(q.trim());
    return veri.maddeler
      .filter((m) => !alan || m.alan === alan)
      .filter((m) => !yalnizDegisen || m.ciktilar.some((c) => c.kod && c.gecerli !== c.varsayilan))
      .filter(
        (m) =>
          !aranan ||
          norm([m.ad, m.neTaranir, ...m.ciktilar.flatMap((c) => [c.kod || '', c.kosul])].join(' ')).includes(aranan),
      );
  }, [veri, q, alan, yalnizDegisen]);

  if (yukleniyor && !veri)
    return (
      <div className="py-10 flex justify-center">
        <LoadingLogo />
      </div>
    );
  if (!veri)
    return <div className="text-sm rounded-xl border px-3 py-2" style={{ color: 'var(--status-danger-text)', borderColor: 'var(--status-danger)' }}>{hata}</div>;

  const degisen = veri.maddeler.flatMap((m) => m.ciktilar).filter((c) => c.kod && c.gecerli !== c.varsayilan).length;
  const alanlar = [...new Set(veri.maddeler.map((m) => m.alan))];
  const gruplar = alanlar
    .map((a) => ({ alan: a, ad: veri.alanlar[a] || a, maddeler: maddeler.filter((m) => m.alan === a) }))
    .filter((g) => g.maddeler.length);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="max-w-3xl">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Tarama maddeleri ve seviyeleri</h2>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Server Hub her gün aşağıdaki <b style={{ color: 'var(--text-secondary)' }}>{fmtNumber(veri.maddeler.length)}</b> maddeyi tarar. Her maddenin
              çıktısı bir seviyeyle raporlanır; seviyeyi buradan değiştirebilirsiniz. Değişiklik sunucu durumunu, sayaçları ve
              sıralamayı hemen etkiler. <b style={{ color: 'var(--text-secondary)' }}>Açılış Hazırlığı ve özet kartları</b> (reboot riski, retire adayı…)
              bulgu koduna bakar; seviye değişse de onlar değişmez.
            </p>
          </div>
          <button type="button" className={BTN} style={btnStil()} onClick={yenile} disabled={yukleniyor}>
            <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin' : ''}`} /> Yenile
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Seviyelerin etkisi">
          {SIRA.map((s) => (
            <div key={s} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <SeviyeRozeti s={s} />
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>{SEVIYE[s].etki}</p>
            </div>
          ))}
        </div>
        {veri.okunamadi && (
          <div className="text-[12px] rounded-lg border px-3 py-2" style={{ color: 'var(--status-warning-text)', borderColor: 'var(--status-warning)' }}>
            Server Hub ayarları okunamadı ({veri.hata || 'bilinmeyen hata'}): şu an <b>varsayılan</b> seviyeler ve limitler uygulanıyor, değişiklik
            kaydedilemez.
          </div>
        )}
        {!veri.sayimOlculdu && (
          <div className="text-[11px]" style={{ color: 'var(--status-warning-text)' }}>
            Son tarama okunamadı: “son tarama” sütunu ölçülemedi (—), “0” değildir.
          </div>
        )}
      </section>

      <LimitlerBolumu limitler={veri.limitler} kilitli={veri.okunamadi} onKaydedildi={yenile} />

      <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="relative">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Madde, kod ya da koşul ara"
              aria-label="Madde, kod ya da koşul ara"
              className="h-7 pl-7 pr-2 text-[12px] rounded-lg border w-64 max-w-full"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            />
          </div>
          <select
            value={alan}
            onChange={(e) => setAlan(e.target.value)}
            aria-label="Alana göre süz"
            className="h-7 px-2 text-[12px] rounded-lg border"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
          >
            <option value="">Tüm alanlar</option>
            {alanlar.map((a) => (
              <option key={a} value={a}>
                {veri.alanlar[a] || a}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={yalnizDegisen} onChange={(e) => setYalnizDegisen(e.target.checked)} />
            Yalnız seviyesi değiştirilenler ({fmtNumber(degisen)})
          </label>
          {veri.taramaTarihi && (
            <span className="ml-auto text-[11px]" style={{ color: 'var(--text-muted)' }}>
              son tarama: {veri.taramaTarihi}
            </span>
          )}
        </div>
        {gruplar.length === 0 && (
          <p className="px-4 py-6 text-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Süzgece uyan madde yok.
          </p>
        )}
        {gruplar.map((g) => (
          <div key={g.alan} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
            <h3 className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              {g.ad}
            </h3>
            <div className="px-4 pb-3 space-y-3 mt-2">
              {g.maddeler.map((m) => (
                <MaddeKarti key={m.id} m={m} kilitli={veri.okunamadi} onKaydedildi={yenile} />
              ))}
            </div>
          </div>
        ))}
      </section>

      <GecmisBolumu gecmis={veri.gecmis} limitler={veri.limitler} />
    </div>
  );
}

function MaddeKarti({ m, kilitli, onKaydedildi }: { m: ShKuralMadde; kilitli: boolean; onKaydedildi: () => void }) {
  return (
    <article className="rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }} aria-label={m.ad}>
      <header className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
        <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{m.ad}</div>
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Ne taranır: {m.neTaranir}</div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="px-3 py-1.5 text-left font-medium">Çıktı</th>
              <th className="px-3 py-1.5 text-left font-medium">Kod</th>
              <th className="px-3 py-1.5 text-left font-medium">Varsayılan</th>
              <th className="px-3 py-1.5 text-left font-medium">Geçerli seviye</th>
              <th className="px-3 py-1.5 text-right font-medium" title="Son taramada bu kodla üretilen bulgu ve sunucu sayısı">Son tarama</th>
            </tr>
          </thead>
          <tbody>
            {m.ciktilar.map((c, i) => (
              <CiktiSatiri key={c.kod || `ok-${i}`} c={c} kilitli={kilitli} onKaydedildi={onKaydedildi} />
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function CiktiSatiri({ c, kilitli, onKaydedildi }: { c: ShKuralCikti; kilitli: boolean; onKaydedildi: () => void }) {
  const [bekleyen, setBekleyen] = useState<ShSeverity | null>(null);
  const [not, setNot] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const degisti = !!c.kod && c.gecerli !== c.varsayilan;

  const kaydet = async (seviye: ShSeverity) => {
    if (!c.kod) return;
    setGonderiliyor(true);
    try {
      const r = await serverHubApi.seviyeDegistir(c.kod, seviye, not);
      if (!r.ok) {
        toast.error(r.message || 'Seviye kaydedilemedi.');
        return;
      }
      toast.success(
        r.degismedi
          ? `${c.kod} zaten ${SEVIYE[seviye].etiket}.`
          : `${c.kod}: ${SEVIYE[c.gecerli].etiket} → ${SEVIYE[seviye].etiket}. Sunucu durumları yeni seviyeyle hesaplanıyor.`,
      );
      setBekleyen(null);
      setNot('');
      onKaydedildi();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setGonderiliyor(false);
    }
  };

  if (!c.kod)
    return (
      <tr className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <td className="px-3 py-1.5" style={{ color: 'var(--text-secondary)' }}>{c.kosul}</td>
        <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)' }}>—</td>
        <td className="px-3 py-1.5"><SeviyeRozeti s="ok" kucuk /></td>
        <td className="px-3 py-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>bulgu üretilmez</td>
        <td className="px-3 py-1.5" />
      </tr>
    );

  return (
    <>
      <tr className="border-t align-top" style={{ borderColor: 'var(--border-subtle)', background: degisti ? 'var(--bg-elevated)' : undefined }}>
        <td className="px-3 py-1.5" style={{ color: 'var(--text-primary)' }}>{c.kosul}</td>
        <td className="px-3 py-1.5 font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>{c.kod}</td>
        <td className="px-3 py-1.5"><SeviyeRozeti s={c.varsayilan} kucuk /></td>
        <td className="px-3 py-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <select
              value={bekleyen || c.gecerli}
              disabled={kilitli || gonderiliyor}
              onChange={(e) => {
                const s = e.target.value as ShSeverity;
                setBekleyen(s === c.gecerli ? null : s);
              }}
              aria-label={`${c.kod} seviyesi`}
              className="h-7 px-1.5 text-[12px] rounded-lg border font-semibold"
              style={{ borderColor: SEVIYE[bekleyen || c.gecerli].renk, color: SEVIYE[bekleyen || c.gecerli].metin, background: 'var(--bg-surface)' }}
            >
              {SIRA.map((s) => (
                <option key={s} value={s}>
                  {SEVIYE[s].etiket}
                  {s === c.varsayilan ? ' (varsayılan)' : ''}
                </option>
              ))}
            </select>
            {degisti && !bekleyen && (
              <button
                type="button"
                className={BTN}
                style={btnStil()}
                disabled={kilitli || gonderiliyor}
                onClick={() => kaydet(c.varsayilan)}
                title={`Varsayılana döndür (${SEVIYE[c.varsayilan].etiket})`}
              >
                <ArrowUturnLeftIcon className="w-3.5 h-3.5" /> Varsayılana dön
              </button>
            )}
          </div>
          {degisti && (
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              değiştiren {c.degistiren || '?'}{c.zaman ? ` · ${fmtDateTime(c.zaman)}` : ''}
              {c.aciklama ? ` · “${c.aciklama}”` : ''}
            </div>
          )}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
          {c.bulgu == null ? (
            <span title="Son tarama okunamadı — ölçülemedi">—</span>
          ) : (
            <span title={`${fmtNumber(c.bulgu)} bulgu · ${fmtNumber(c.sunucu ?? 0)} sunucu`}>
              {say(c.bulgu)} bulgu · {say(c.sunucu)} sunucu
            </span>
          )}
        </td>
      </tr>
      {bekleyen && (
        <tr style={{ background: 'var(--bg-elevated)' }}>
          <td colSpan={5} className="px-3 pb-2">
            <div className="flex items-center gap-2 flex-wrap text-[12px]">
              <span style={{ color: 'var(--text-secondary)' }}>
                <b className="font-mono">{c.kod}</b>: <SeviyeRozeti s={c.gecerli} kucuk /> → <SeviyeRozeti s={bekleyen} kucuk />
                {c.bulgu != null && c.bulgu > 0 ? ` · son taramadaki ${fmtNumber(c.bulgu)} bulgu yeni seviyeyle sayılır` : ''}
              </span>
              <input
                value={not}
                onChange={(e) => setNot(e.target.value)}
                maxLength={500}
                placeholder="Açıklama (opsiyonel; geçmişte görünür)"
                aria-label={`${c.kod} değişiklik açıklaması`}
                className="h-7 px-2 text-[12px] rounded-lg border flex-1 min-w-[12rem]"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              />
              <button type="button" className={BTN} style={btnStil(true)} disabled={gonderiliyor} onClick={() => kaydet(bekleyen)}>
                Kaydet
              </button>
              <button type="button" className={BTN} style={btnStil()} disabled={gonderiliyor} onClick={() => { setBekleyen(null); setNot(''); }}>
                İptal
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function LimitlerBolumu({ limitler, kilitli, onKaydedildi }: { limitler: ShLimit[]; kilitli: boolean; onKaydedildi: () => void }) {
  return (
    <section className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Tek seferde girilebilecek sunucu sayısı</h2>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Sunucu listesi alan ekranların tek seferde kabul ettiği en fazla sunucu. Üst sınır, işin AWX’e taşıdığı veri ve süre yüzünden
          sabittir.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
              <th className="px-3 py-1.5 text-left font-medium">Ekran</th>
              <th className="px-3 py-1.5 text-right font-medium">Şu an</th>
              <th className="px-3 py-1.5 text-right font-medium">Varsayılan</th>
              <th className="px-3 py-1.5 text-right font-medium">Üst sınır</th>
              <th className="px-3 py-1.5 text-left font-medium">Değiştir</th>
            </tr>
          </thead>
          <tbody>
            {limitler.map((l) => (
              <LimitSatiri key={l.ad} l={l} kilitli={kilitli} onKaydedildi={onKaydedildi} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LimitSatiri({ l, kilitli, onKaydedildi }: { l: ShLimit; kilitli: boolean; onKaydedildi: () => void }) {
  const [deger, setDeger] = useState(String(l.gecerli));
  const [not, setNot] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const n = Number(deger);
  const gecerli = Number.isInteger(n) && n >= 1 && n <= l.ust;
  const kaydet = async (yeni: number) => {
    setGonderiliyor(true);
    try {
      const r = await serverHubApi.limitDegistir(l.ad, yeni, not);
      if (!r.ok) {
        toast.error(r.message || 'Limit kaydedilemedi.');
        return;
      }
      toast.success(`${l.etiket}: tek seferde en fazla ${fmtNumber(yeni)} sunucu.`);
      setNot('');
      onKaydedildi();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setGonderiliyor(false);
    }
  };
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
      <td className="px-3 py-2">
        <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{l.etiket}</div>
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{l.aciklama}</div>
        {l.degistiren && (
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            değiştiren {l.degistiren}{l.zaman ? ` · ${fmtDateTime(l.zaman)}` : ''}{l.not ? ` · “${l.not}”` : ''}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtNumber(l.gecerli)}</td>
      <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmtNumber(l.varsayilan)}</td>
      <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmtNumber(l.ust)}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <input
            type="number"
            min={1}
            max={l.ust}
            value={deger}
            disabled={kilitli || gonderiliyor}
            onChange={(e) => setDeger(e.target.value)}
            aria-label={`${l.etiket} tek seferde en fazla sunucu`}
            aria-invalid={!gecerli}
            className="h-7 w-20 px-2 text-[12px] rounded-lg border tabular-nums"
            style={{ borderColor: gecerli ? 'var(--border)' : 'var(--status-danger)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
          />
          <input
            value={not}
            disabled={kilitli || gonderiliyor}
            onChange={(e) => setNot(e.target.value)}
            maxLength={500}
            placeholder="Açıklama (opsiyonel)"
            aria-label={`${l.etiket} limit açıklaması`}
            className="h-7 px-2 text-[12px] rounded-lg border w-40"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            className={BTN}
            style={btnStil(true)}
            disabled={kilitli || gonderiliyor || !gecerli || n === l.gecerli}
            onClick={() => kaydet(n)}
          >
            Kaydet
          </button>
          {l.gecerli !== l.varsayilan && (
            <button type="button" className={BTN} style={btnStil()} disabled={kilitli || gonderiliyor} onClick={() => { setDeger(String(l.varsayilan)); kaydet(l.varsayilan); }}>
              <ArrowUturnLeftIcon className="w-3.5 h-3.5" /> Varsayılana dön
            </button>
          )}
        </div>
        {!gecerli && (
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--status-danger-text)' }}>
            1 ile {fmtNumber(l.ust)} arasında bir tam sayı girin.
          </div>
        )}
      </td>
    </tr>
  );
}

function GecmisBolumu({ gecmis, limitler }: { gecmis: ShAyarGecmis[] | null; limitler: ShLimit[] }) {
  const [acik, setAcik] = useState(false);
  return (
    <section className="rounded-xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <button
        type="button"
        onClick={() => setAcik((v) => !v)}
        aria-expanded={acik}
        className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-semibold"
        style={{ color: 'var(--text-primary)' }}
      >
        Değişiklik geçmişi
        <span className="text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>
          {gecmis == null ? 'okunamadı' : `${fmtNumber(gecmis.length)} kayıt`} · {acik ? 'gizle' : 'göster'}
        </span>
      </button>
      {acik && (
        <div className="overflow-x-auto border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          {gecmis == null ? (
            <p className="px-4 py-3 text-[12px]" style={{ color: 'var(--status-warning-text)' }}>Geçmiş okunamadı.</p>
          ) : gecmis.length === 0 ? (
            <p className="px-4 py-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>Henüz değişiklik yok; tüm seviyeler ve limitler varsayılan.</p>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                  <th className="px-3 py-1.5 text-left font-medium">Zaman</th>
                  <th className="px-3 py-1.5 text-left font-medium">Kim</th>
                  <th className="px-3 py-1.5 text-left font-medium">Ayar</th>
                  <th className="px-3 py-1.5 text-left font-medium">Değişiklik</th>
                  <th className="px-3 py-1.5 text-left font-medium">Açıklama</th>
                </tr>
              </thead>
              <tbody>
                {gecmis.map((g, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{g.zaman ? fmtDateTime(g.zaman) : '—'}</td>
                    <td className="px-3 py-1.5" style={{ color: 'var(--text-secondary)' }}>{g.degistiren}</td>
                    <td className="px-3 py-1.5" style={{ color: 'var(--text-primary)' }}>{ayarAdi(g.anahtar, limitler)}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                      {degerAdi(g.anahtar, g.eski)} → {degerAdi(g.anahtar, g.yeni)}
                    </td>
                    <td className="px-3 py-1.5" style={{ color: 'var(--text-secondary)' }}>{g.aciklama || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
