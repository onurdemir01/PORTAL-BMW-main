// src/components/self_service/SsErisimBolumu.tsx — "Alanları Yönet" penceresindeki Erişim
// bölümü: bu Self Service otomasyonunu kimler görüp çalıştırabilir?
//
// Kullanıcı (2026-10-26): "bazı playbookları sadece bazı ekiplere açabilmek istiyoruz ...
// default olarak kullanıcılara kapalı gelsin ... istersek tüm ekiplere de açabilelim. Tek bir
// ekip olmayabilir ... LDAP'tan grupları çekip yetki tanımlayabiliyorduk." Ayar admin
// panelinde değil, otomasyonun kendi penceresinde.
//
// Karar SUNUCUDA verilir (server/ansible/ss-erisim.cjs): liste, form ve başlatma uçları
// yetkisiz kullanıcıya servisi hiç göstermez. Bu bileşen yalnız ayarı düzenler.
import React, { useEffect, useRef, useState } from 'react';
import {
  LockClosedIcon,
  UserGroupIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import type { AnsibleSsItem, SsErisimModu } from '@/api/ansibleApi';

export interface LdapGroup {
  dn: string;
  cn: string;
  description: string | null;
}

/** Arama ucu. Ayrı durur ki test sahte bir uygulamayla çalışabilsin. */
export async function ldapGroupSearch(q: string): Promise<{ groups: LdapGroup[]; error?: string }> {
  const r = await fetch(`/api/visibility/ldap-groups?q=${encodeURIComponent(q)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) return { groups: [], error: j.error || 'LDAP grup araması yapılamadı.' };
  return { groups: Array.isArray(j.groups) ? j.groups : [] };
}

/** Sunucudaki `ssErisimModu` ile aynı kural: eski kayıt (mod yok) + açık = herkes. */
export function ssErisimModu(item: Pick<AnsibleSsItem, 'enabled' | 'accessMode'>): SsErisimModu {
  if (!item.enabled) return 'kapali';
  const m = item.accessMode;
  if (m === undefined || m === null || (m as string) === '') return 'herkes';
  if (m === 'herkes' || m === 'ekipler') return m;
  return 'kapali';
}

/** "CN=GT-Middleware,OU=Groups,DC=..." -> "GT-Middleware"; yalın ad olduğu gibi kalır. */
export function grupEtiketi(g: string): string {
  const m = /^\s*cn=([^,]+)/i.exec(g);
  return m ? m[1].trim() : g.trim();
}

const grupAnahtari = (g: string) => g.trim().toLowerCase().replace(/\s*,\s*/g, ',');

const SECENEKLER: { mod: SsErisimModu; baslik: string; aciklama: string; icon: React.ElementType }[] = [
  { mod: 'kapali', baslik: 'Kapalı', aciklama: 'Yalnız yöneticiler görür ve çalıştırır.', icon: LockClosedIcon },
  { mod: 'ekipler', baslik: 'Seçili ekipler', aciklama: 'Seçtiğiniz LDAP gruplarının üyeleri.', icon: UserGroupIcon },
  { mod: 'herkes', baslik: 'Herkes', aciklama: 'Portala giren tüm kullanıcılar.', icon: GlobeAltIcon },
];

export function SsErisimBolumu({
  mode,
  groups,
  onChange,
  bozuk = false,
  search = ldapGroupSearch,
}: {
  mode: SsErisimModu;
  groups: string[];
  onChange: (next: { mode: SsErisimModu; groups: string[] }) => void;
  /** Kayıtlı ekip listesi sunucuda okunamadı (servis şu an kimseye açık değil). */
  bozuk?: boolean;
  /** test için enjekte edilebilir */
  search?: (q: string) => Promise<{ groups: LdapGroup[]; error?: string }>;
}) {
  const [q, setQ] = useState('');
  const [sonuc, setSonuc] = useState<LdapGroup[]>([]);
  const [acik, setAcik] = useState(false);
  const [ariyor, setAriyor] = useState(false);
  const [hata, setHata] = useState('');
  // Yalnız EN SON aramanın yanıtı işlenir (yavaş LDAP'ta eski yanıt yenisinin üstüne yazmasın).
  const istekNo = useRef(0);
  const zaman = useRef<number | null>(null);
  const kutu = useRef<HTMLDivElement | null>(null);

  useEffect(
    () => () => {
      if (zaman.current) window.clearTimeout(zaman.current);
    },
    [],
  );
  useEffect(() => {
    const dinle = (e: MouseEvent) => {
      if (kutu.current && !kutu.current.contains(e.target as Node)) setAcik(false);
    };
    document.addEventListener('mousedown', dinle);
    return () => document.removeEventListener('mousedown', dinle);
  }, []);

  const secili = new Set(groups.map(grupAnahtari));

  const ekle = (g: string) => {
    const t = g.trim();
    if (!t || secili.has(grupAnahtari(t))) return;
    onChange({ mode, groups: [...groups, t] });
  };
  const cikar = (g: string) => onChange({ mode, groups: groups.filter((x) => x !== g) });

  const yaz = (v: string) => {
    setQ(v);
    setHata('');
    if (zaman.current) window.clearTimeout(zaman.current);
    istekNo.current += 1;
    if (v.trim().length < 3) {
      setSonuc([]);
      setAcik(false);
      setAriyor(false);
      return;
    }
    zaman.current = window.setTimeout(async () => {
      const no = ++istekNo.current;
      setAriyor(true);
      setAcik(true);
      try {
        const r = await search(v.trim());
        if (no !== istekNo.current) return;
        setSonuc(r.groups);
        setHata(r.error || '');
      } catch (e: unknown) {
        if (no !== istekNo.current) return;
        setSonuc([]);
        setHata(e instanceof Error ? e.message : 'LDAP grup araması yapılamadı.');
      } finally {
        if (no === istekNo.current) setAriyor(false);
      }
    }, 300);
  };

  // Elle ekleme (LDAP kapalı ya da arama düştüyse): yazılan CN ya da tam DN olduğu gibi eklenir.
  const elleEkle = () => {
    if (!q.trim()) return;
    ekle(q);
    setQ('');
    setSonuc([]);
    setAcik(false);
  };

  return (
    <section
      className="rounded-xl border border-[var(--border)] px-3 py-3 space-y-3"
      data-testid="ss-erisim"
      aria-labelledby="ss-erisim-baslik"
    >
      <div>
        <h3 id="ss-erisim-baslik" className="text-sm font-semibold text-[var(--text-primary)]">
          Kimler kullanabilir?
        </h3>
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
          Yöneticiler her durumda görür ve çalıştırır. Yeni eklenen servis kapalı başlar.
        </p>
      </div>

      <div role="radiogroup" aria-labelledby="ss-erisim-baslik" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {SECENEKLER.map((s) => {
          const aktif = mode === s.mod;
          const Icon = s.icon;
          return (
            <label
              key={s.mod}
              className={
                'flex items-start gap-2 rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ' +
                'focus-within:ring-2 focus-within:ring-[var(--accent)] ' +
                (aktif
                  ? 'border-[var(--accent)] bg-[var(--bg-elevated)]'
                  : 'border-[var(--border)] hover:bg-[var(--bg-elevated)]')
              }
            >
              <input
                type="radio"
                name="ss-erisim-modu"
                value={s.mod}
                checked={aktif}
                onChange={() => onChange({ mode: s.mod, groups })}
                className="mt-0.5"
                data-testid={`ss-erisim-${s.mod}`}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-xs font-semibold text-[var(--text-primary)]">
                  <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: aktif ? 'var(--accent)' : 'var(--text-muted)' }} />
                  {s.baslik}
                </span>
                <span className="block text-[11px] text-[var(--text-muted)]">{s.aciklama}</span>
              </span>
            </label>
          );
        })}
      </div>

      {bozuk && (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px]"
          style={{ borderColor: 'var(--status-danger)', color: 'var(--status-danger)' }}
        >
          <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Kayıtlı ekip listesi okunamadı; servis şu an yöneticiler dışında kimseye açık değil. Ekipleri yeniden seçip kaydedin.
        </div>
      )}

      {mode === 'ekipler' && (
        <div className="space-y-2">
          {groups.length === 0 ? (
            <p className="text-[11px]" style={{ color: 'var(--status-warning-text)' }} data-testid="ss-erisim-ekip-yok">
              Henüz ekip seçilmedi. Kaydetmek için en az bir LDAP grubu ekleyin.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5" aria-label="Seçili ekipler" data-testid="ss-erisim-ekip-listesi">
              {groups.map((g) => (
                <li
                  key={g}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] pl-2.5 pr-1 py-0.5 text-[11px] text-[var(--text-primary)]"
                  title={g}
                >
                  {grupEtiketi(g)}
                  <button
                    type="button"
                    onClick={() => cikar(g)}
                    aria-label={`${grupEtiketi(g)} ekibini çıkar`}
                    className="rounded-full p-0.5 text-[var(--text-muted)] hover:text-[var(--status-danger)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    <XMarkIcon className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div ref={kutu} className="relative">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  value={q}
                  onChange={(e) => yaz(e.target.value)}
                  onFocus={() => {
                    if (sonuc.length) setAcik(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      elleEkle();
                    }
                  }}
                  placeholder="LDAP grubu ara (en az 3 karakter), ör. GT-Middleware"
                  aria-label="LDAP grubu ara"
                  autoComplete="off"
                  className="w-full text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1.5 pr-7 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <MagnifyingGlassIcon
                  className="h-3.5 w-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: ariyor ? 'var(--accent)' : 'var(--text-muted)' }}
                />
              </div>
              <button
                type="button"
                onClick={elleEkle}
                disabled={!q.trim()}
                className="shrink-0 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
                title="Yazılanı olduğu gibi ekle (CN ya da tam DN)"
              >
                Elle ekle
              </button>
            </div>

            {acik && (
              <div
                className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg"
                data-testid="ss-erisim-sonuc"
              >
                {ariyor ? (
                  <div className="px-3 py-2 text-[11px] flex items-center gap-1.5 text-[var(--text-muted)]">
                    <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                    Dizinde aranıyor…
                  </div>
                ) : hata ? (
                  // Arama düştüyse "grup yok" demeyiz: kullanıcı olmayan bir sorunu arar.
                  <div className="px-3 py-2 text-[11px] flex items-start gap-1.5" style={{ color: 'var(--status-danger)' }}>
                    <ExclamationTriangleIcon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{hata} Grup adını yazıp "Elle ekle" ile ekleyebilirsiniz.</span>
                  </div>
                ) : sonuc.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-[var(--text-muted)]">
                    Eşleşen grup bulunamadı. Grup adını yazıp "Elle ekle" ile ekleyebilirsiniz.
                  </div>
                ) : (
                  sonuc.map((g) => {
                    const var_ = secili.has(grupAnahtari(g.dn));
                    return (
                      <button
                        key={g.dn}
                        type="button"
                        disabled={var_}
                        onClick={() => {
                          ekle(g.dn);
                          setQ('');
                          setSonuc([]);
                          setAcik(false);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-elevated)] disabled:opacity-50 disabled:cursor-default"
                      >
                        <div className="text-xs text-[var(--text-primary)]">
                          {g.cn}
                          {var_ && <span className="ml-2 text-[10px] text-[var(--text-muted)]">seçili</span>}
                        </div>
                        <div className="text-[10px] truncate text-[var(--text-muted)]" title={g.dn}>
                          {[g.description, g.dn].filter(Boolean).join(' · ')}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            Eşleşme doğrudan grup üyeliğiyle yapılır; iç içe (nested) gruplar sayılmaz. Ayar kaydedilince hemen geçerlidir;
            bir kişinin AD'deki grup üyeliği değişirse bu, portala bir sonraki girişinde yansır.
          </p>
        </div>
      )}

      {mode !== 'ekipler' && groups.length > 0 && (
        <p className="text-[11px] text-[var(--text-muted)]">
          Kayıtlı {groups.length} ekip saklanıyor; "Seçili ekipler"e dönerseniz yeniden kullanılır.
        </p>
      )}
    </section>
  );
}

export default SsErisimBolumu;
