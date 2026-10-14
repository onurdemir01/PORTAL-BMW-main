// src/components/admin/LdapUserPicker.tsx — yetki verirken LDAP'tan kullanıcı seçme.
//
// Kullanıcı (2026-09-28): "Portalda ekranlara yetki verirken genel olarak tüm LDAP
// kullanıcılarını çeksem, ben oradan seçerek yetkileri versem olur mu? Küçük harf büyük
// harf sorunu yaşıyoruz."
//
// NEDEN "HEPSİNİ ÇEK" DEĞİL DE ARAMA: kurumsal AD'de on binlerce hesap var; hepsini
// tarayıcıya indirmek hem yavaş hem gereksiz. En az 3 karakterden sonra sunucu tarafında
// aranır, sonuç tavanlıdır.
//
// HARF SORUNUNU KÖKÜNDEN ÇÖZER: seçilen kullanıcının adı sunucuda `normalizeUsername` ile
// (küçük harf, domain eki atılmış) döner ve kurala o yazılır. Elle yazım kalkınca hem
// yazım hatası hem büyük/küçük harf farkı ortadan kalkar.
//
// ELLE YAZMA KAPATILMADI: LDAP kapalıysa ya da arama düşerse kullanıcı yine de yazabilmeli
// — yoksa dizin erişimi olmayan bir ortamda yetki verilemez hale gelirdi. Ama elle yazılan
// değer de kaydedilirken küçük harfe çevrilir (sunucu tarafında da ayrıca çevriliyor).
import React, { useEffect, useRef, useState } from 'react';
import {
  MagnifyingGlassIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

export interface LdapUser {
  username: string;
  displayName: string;
  mail: string;
  department: string | null;
  title: string | null;
}

/** Aramayı yapan uç. Ayrı durur ki test sahte bir uygulamayla çalışabilsin. */
export async function ldapUserSearch(q: string): Promise<{ users: LdapUser[]; error?: string }> {
  const r = await fetch(`/api/visibility/ldap-users?q=${encodeURIComponent(q)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) return { users: [], error: j.error || 'LDAP araması yapılamadı.' };
  return { users: Array.isArray(j.users) ? j.users : [] };
}

export function LdapUserPicker({
  value,
  onChange,
  placeholder,
  className,
  search = ldapUserSearch,
  field = 'username',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** test için enjekte edilebilir */
  search?: (q: string) => Promise<{ users: LdapUser[]; error?: string }>;
  /**
   * Seçilen kişiden HANGİ alan yazılsın (2026-10-01).
   *
   * Kullanıcı: "LDAP'tan tüm kullanıcıları getiriyorsun ama o kullanıcıya tıkladığımda
   * seçtiğim kişiye işlemiyor." Seçim alana işliyordu; sorun YAZILAN DEĞERDİ. Picker her
   * zaman `username` döndürüyordu, ama kural türü `email` ise motor o kuralı KULLANICI
   * ADIYLA değil E-POSTAYLA eşleştirir — yani yazılan kural hiçbir zaman tutmuyordu.
   * Crypto Hub kuralları üretimde e-postayla giriliyor (bkz. ekran görüntüsündeki üç
   * kayıt), dolayısıyla panel e-posta kipindeyken picker da e-posta yazmalı.
   */
  field?: 'username' | 'mail';
}) {
  const [sonuc, setSonuc] = useState<LdapUser[]>([]);
  const [acik, setAcik] = useState(false);
  const [hata, setHata] = useState('');
  const [ariyor, setAriyor] = useState(false);
  // SECIM GORUNUR (kullanici, 2026-10-14: "yazdigim kullanici adinin gercekten secildigini
  // anlayamiyorum"): kutuda yalniz kullanici adi kaliyordu; listeden secilmis mi elle mi
  // yazilmis ayirt edilmiyordu. Secilen kisi kutunun altinda adi + e-postasiyla yazar;
  // listeden secilmeden yazilan deger ayrica "dizinde dogrulanmadi" diye soylenir.
  const [secili, setSecili] = useState<LdapUser | null>(null);
  const [elle, setElle] = useState(false);
  // SIRA KORUMASI: yavas LDAP'ta "osm" yaniti "osman"dan SONRA gelirse eski liste yenisinin
  // ustune yaziliyordu. Yalniz EN SON istegin yaniti islenir.
  const istekNo = useRef(0);
  const zaman = useRef<number | null>(null);
  const kutu = useRef<HTMLDivElement | null>(null);

  useEffect(
    () => () => {
      if (zaman.current) window.clearTimeout(zaman.current);
    },
    [],
  );

  // Dışarı tıklayınca liste kapanır (aksi halde seçim yapmadan devam eden kullanıcının
  // önünü kapatır).
  useEffect(() => {
    const dinle = (e: MouseEvent) => {
      if (kutu.current && !kutu.current.contains(e.target as Node)) setAcik(false);
    };
    document.addEventListener('mousedown', dinle);
    return () => document.removeEventListener('mousedown', dinle);
  }, []);

  const yaz = (v: string) => {
    // Elle yazım da küçük harfe çevrilir: kural kaydına giden değer tek biçim olsun.
    onChange(v.trim().toLowerCase());
    setHata('');
    setSecili(null);
    setElle(true);
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
        setSonuc(r.users);
        setHata(r.error || '');
      } catch (e: unknown) {
        if (no !== istekNo.current) return;
        setSonuc([]);
        setHata(e instanceof Error ? e.message : 'LDAP araması yapılamadı.');
      } finally {
        if (no === istekNo.current) setAriyor(false);
      }
    }, 300);
  };

  const sec = (u: LdapUser) => {
    const deger = field === 'mail' ? String(u.mail || '').trim().toLowerCase() : u.username;
    // E-POSTASI OLMAYAN KAYIT SESSIZCE GECILMEZ: kullanici adini e-posta kuralina yazmak,
    // asla eslesmeyecek bir kural uretirdi - sikayetin ta kendisi.
    if (!deger) {
      setHata(
        `${u.displayName || u.username} için dizinde e-posta yok; e-posta kuralı yazılamaz.`,
      );
      return;
    }
    onChange(deger);
    setSecili(u);
    setElle(false);
    setAcik(false);
    setSonuc([]);
  };
  // Secim YALNIZ kutudaki deger hala o kisininse gecerlidir (deger disaridan degisirse - kayit
  // sonrasi temizleme, mevcut kurali duzenleme - eski secim gosterilmez).
  const seciliDeger = secili
    ? field === 'mail'
      ? String(secili.mail || '').trim().toLowerCase()
      : secili.username
    : '';
  const seciliGecerli = secili && value && value === seciliDeger ? secili : null;

  return (
    <div ref={kutu} className="relative">
      <div className="relative">
        <input
          value={value}
          onChange={(e) => yaz(e.target.value)}
          onFocus={() => {
            if (sonuc.length) setAcik(true);
          }}
          placeholder={placeholder || 'ad, kullanıcı adı ya da e-posta ile ara (en az 3 karakter)'}
          className={className}
          autoComplete="off"
        />
        <MagnifyingGlassIcon
          className="h-3.5 w-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: ariyor ? 'var(--accent)' : 'var(--text-muted)' }}
        />
      </div>

      {acik && (
        <div
          className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-lg border shadow-lg"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          {/* ARAMA DUSTUYSE "SONUC YOK" DEMEYIZ: kullanici olmayan bir sorunu arar. */}
          {ariyor ? (
            <div
              className="px-3 py-2 text-[11px] flex items-center gap-1.5"
              style={{ color: 'var(--text-muted)' }}
              data-testid="ldap-ariyor"
            >
              <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
              Dizinde aranıyor…
            </div>
          ) : hata ? (
            <div
              className="px-3 py-2 text-[11px] flex items-start gap-1.5"
              style={{ color: 'var(--status-danger)' }}
            >
              <ExclamationTriangleIcon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{hata} Elle yazmaya devam edebilirsiniz.</span>
            </div>
          ) : sonuc.length === 0 ? (
            <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Eşleşen kullanıcı bulunamadı — elle yazabilirsiniz.
            </div>
          ) : (
            sonuc.map((u) => (
              <button
                key={u.username}
                type="button"
                onClick={() => sec(u)}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-elevated)]"
              >
                <div className="text-xs" style={{ color: 'var(--text-primary)' }}>
                  {u.displayName || u.username}
                  <span
                    className="ml-2 font-mono text-[10px]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {u.username}
                  </span>
                </div>
                {(u.mail || u.department) && (
                  <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                    {[u.mail, u.department, u.title].filter(Boolean).join(' · ')}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {seciliGecerli ? (
        <div
          className="mt-1 flex items-start gap-1.5 rounded-md border px-2 py-1 text-[11px]"
          style={{
            borderColor: 'var(--status-success)',
            background: 'var(--status-success-bg)',
            color: 'var(--text-secondary)',
          }}
          data-testid="ldap-secili"
        >
          <CheckCircleIcon className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: 'var(--status-success)' }} />
          <span>
            Seçildi:{' '}
            <b style={{ color: 'var(--text-primary)' }}>
              {seciliGecerli.displayName || seciliGecerli.username}
            </b>{' '}
            <span className="font-mono">{seciliGecerli.username}</span>
            {seciliGecerli.mail ? ` · ${seciliGecerli.mail}` : ''}
            {seciliGecerli.department ? ` · ${seciliGecerli.department}` : ''}
          </span>
        </div>
      ) : (
        elle &&
        value &&
        !ariyor && (
          <div className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }} data-testid="ldap-elle">
            Listeden seçilmedi — yazılan değer olduğu gibi kaydedilir (dizinde doğrulanmadı).
          </div>
        )
      )}

    </div>
  );
}

export default LdapUserPicker;
