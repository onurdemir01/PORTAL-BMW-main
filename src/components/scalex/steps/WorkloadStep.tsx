// src/components/scalex/steps/WorkloadStep.tsx — CANLI KEŞİF + çoklu uygulama seçimi.
//
// Bu adım sayfanın var oluş sebebi. Bugün kullanıcı uygulama adlarını ELLE yazıyor;
// replica sayısını, HPA olup olmadığını ve uygulamanın zaten durdurulmuş olup olmadığını
// hiç görmüyor. Yazım hatası ancak iş çalıştıktan sonra "workload detection failed"
// olarak ortaya çıkıyor.
//
// Keşif SALT OKUNUR bir AWX işidir (`discovery_mode: workloads`) — hiçbir mutasyon yapmaz.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  BoltSlashIcon,
} from '@heroicons/react/24/outline';
import {
  scalexApi,
  type ScaleXWorkload,
  type ScaleXScope,
  type ScaleXKindReport,
} from '@/api/scalexApi';

interface Props {
  scope: ScaleXScope;
  busy: boolean;
  initial?: string[];
  onSubmit: (v: {
    apps: string[];
    /** Ad+tip anahtarlari — `initial` olarak geri verilince secim korunur. */
    selectedKeys: string[];
    workloads: ScaleXWorkload[];
    fetchedAt: number;
  }) => void;
  /** Kesif asilirsa kullaniciya bir CIKIS yolu vermek icin (bkz. bekleme ekrani). */
  onBack: () => void;
}

const POLL_MS = 3000;
const MAX_POLL_ERRORS = 5;

const WorkloadStep: React.FC<Props> = ({ scope, busy, initial, onSubmit, onBack }) => {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [workloads, setWorkloads] = useState<ScaleXWorkload[]>([]);
  // ON-LISTE: paylasilan katalogdan gelen ad/tip listesi. Ekran bunu ANINDA acar;
  // canli sutunlar (replica, HPA, GitOps) kesif bitince dolar. Ad listesi yavas
  // degisir, canli veri degismez sayilamaz — bu yuzden yalnizca ADLAR onbellekten.
  const [preview, setPreview] = useState<{ name: string; clusters: string[] }[]>([]);
  const [previewHidden, setPreviewHidden] = useState(0);
  // Kesfin TAMAMLANDIGI an — onizlemedeki tazelik damgasi buradan gelir.
  const fetchedAtRef = useRef<number | null>(null);
  const [failedClusters, setFailedClusters] = useState<string[]>([]);
  const [problems, setProblems] = useState<{ cluster: string; detail: string }[]>([]);
  const [pdbWarning, setPdbWarning] = useState<string | null>(null);
  // KESFIN BAKTIGI HER TIP icin sonuc: kac tane bulundu, ya da NEDEN bakilamadi.
  const [kindReports, setKindReports] = useState<ScaleXKindReport[]>([]);
  // AWX'te kosan paket surumu vs. portalin bekledigi surum.
  const [pkg, setPkg] = useState<{ running: string; expected: string } | null>(null);
  const [pkgCopied, setPkgCopied] = useState(false);
  const [selected, setSelected] = useState<string[]>(initial || []);
  const [query, setQuery] = useState('');
  // ÇİFT TIK KORUMASI ref ile — `busy` state'i render'da yakalanır ve aynı tick'teki
  // iki tık iki AWX işi açabilirdi (LogX/Telnet'te bu bilinçli olarak ref).
  const startingRef = useRef(false);
  // UNMOUNT KORUMASI. `poll()` bir `for(;;)` dongusudur; bilesen unmount olduktan sonra
  // da donmeye devam ederse (a) her 3 saniyede bir gereksiz istek atar, (b) unmount
  // sonrasi `setState` cagirir. Sihirbaz `key={step}` ile remount ettigi icin bu yol
  // gercekten yasaniyor: kullanici adimlar arasinda gidip geldikce eski dongulerin
  // hepsi arka planda kosmaya devam ederdi.
  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  // KESIF ASILIRSA KULLANICI CIKMAZDA KALMASIN. `poll()` bir `for(;;)` dongusu ve
  // `MAX_POLL_ERRORS` yalnizca HTTP hatalarini sayiyor — AWX isi `pending`/`running`da
  // asili kalirsa `finished` hic true olmaz ve dongu SONSUZA DEK doner. Ekranda ise
  // yalnizca bir spinner vardi: gecen sure yok, AWX is numarasi yok, vazgecme yolu yok.
  // Tek cikis sayfayi yenilemekti ve o da sihirbazi bastan baslatiyordu.
  const [job, setJob] = useState<{ serverId: number; jobId: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (phase !== 'running') return;
    const t = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  async function startDiscovery() {
    if (startingRef.current) return;
    startingRef.current = true;
    setPhase('running');
    setMessage(null);
    setProblems([]);
    setFailedClusters([]);
    setJob(null);
    setElapsed(0);
    // ON-LISTE ONCE ve BEKLETMEDEN: AWX'e dokunmayan bir DB okumasi. Basarisiz
    // olursa akis etkilenmez — yalnizca ekran kesfi bekler (eski davranis).
    scalexApi
      .apps({
        env: scope.env,
        tenant: scope.tenant,
        namespace: scope.namespace,
        clusters: scope.clusters,
      })
      .then((r) => {
        if (!aliveRef.current || !r.ok) return;
        setPreview(
          (r.items || []).map((it) => ({
            name: it.name,
            clusters: r.clusters?.[it.name] || scope.clusters,
          })),
        );
        setPreviewHidden(r.hiddenCount || 0);
      })
      .catch(() => {
        /* on-liste BEST-EFFORT: kesif zaten gercegi getirecek */
      });

    try {
      const launched = await scalexApi.discover(scope, 'workloads');
      if (!aliveRef.current) return;
      if (!launched.ok) {
        setPhase('error');
        setMessage(launched.message || 'Keşif başlatılamadı.');
        return;
      }
      setJob({ serverId: launched.serverId, jobId: launched.jobId });
      await poll(launched.serverId, launched.jobId);
    } catch (e) {
      setPhase('error');
      setMessage((e as Error).message);
    } finally {
      startingRef.current = false;
    }
  }

  async function poll(serverId: number, jobId: number) {
    let errors = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (!aliveRef.current) return;
      try {
        const s = await scalexApi.discoverStatus(serverId, jobId);
        errors = 0;
        if (!s.finished) continue;
        if (s.result) {
          // KAYNAK ISARETLENIYOR: bu satirlar CANLI kesiften geliyor, yani
          // `specReplicas`/`readyReplicas`/`image`/`hasHpa` gercek degerler ve
          // onizlemede gosterilebilir. Aynadan turetilen sentetik satirlarda
          // (`mirror`) o alanlar uydurma olur.
          setWorkloads(
            (s.result.workloads || []).map((w) => ({ ...w, source: 'discovery' as const })),
          );
          fetchedAtRef.current = Date.now();
          setFailedClusters(s.result.failedClusters || []);
          setProblems(
            (s.result.problems || []).map((p) => ({ cluster: p.cluster, detail: p.detail })),
          );
          setPdbWarning(s.result.pdbWarning || null);
          setKindReports(s.result.kindReports || []);
          setPkg(
            s.result.expectedPackageVersion
              ? {
                  running: s.result.packageVersion || '0',
                  expected: s.result.expectedPackageVersion,
                }
              : null,
          );
          // Kısmi başarı GERÇEKTİR: üç cluster'dan biri düştüyse diğer ikisinin
          // uygulamaları gösterilir ama sorun da söylenir.
          setPhase('done');
        } else {
          setPhase('error');
          setMessage(
            "İş bitti ama yapılandırılmış sonuç gelmedi — playbook'un güncel sürümü AWX'e kopyalanmamış olabilir.",
          );
        }
        return;
      } catch (e) {
        // YETKI HATASI KALICIDIR: 401/403'te yeniden denemek kullaniciyi 15 sn
        // bekletir ve sunucuda gereksiz log biriktirir. safeJson artik `status`
        // property'si ekliyor; bunu okuyup hemen dur.
        const httpStatus = (e as Error & { status?: number }).status;
        if (httpStatus === 401 || httpStatus === 403) {
          setPhase('error');
          setMessage(
            httpStatus === 403
              ? 'Bu keşif için yetkiniz yok — yöneticinize başvurun.'
              : 'Oturumunuz sonlanmış; lütfen yeniden giriş yapın.',
          );
          return;
        }
        if (++errors >= MAX_POLL_ERRORS) {
          setPhase('error');
          setMessage(`Keşif durumu okunamadı: ${(e as Error).message}`);
          return;
        }
      }
    }
  }

  useEffect(() => {
    startDiscovery(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? workloads.filter((w) => w.name.toLowerCase().includes(q)) : workloads;
    // Aynı uygulama birden çok cluster'da olabilir — cluster boyutunda TEKİLLEŞTİRİLİR,
    // çünkü seçim uygulama adı bazındadır ve playbook (cluster × uygulama) çarpımını
    // kendi yapar.
    //
    // ANAHTAR AD + TİP. Eskiden yalnızca addı ve İLK satır tutuluyordu: aynı ada sahip
    // bir Deployment ile bir DeploymentConfig varsa ikincisi ekranda HİÇ görünmüyor,
    // sonra iş `ambiguous` ile düşüyordu. Kullanıcı ekranda tek satır gördüğü için
    // neyin çakıştığını da anlayamıyordu.
    const byKey = new Map<string, ScaleXWorkload>();
    for (const w of filtered) {
      const key = `${w.name}\u0000${w.kind}`;
      if (!byKey.has(key)) byKey.set(key, w);
    }
    return [...byKey.values()].sort(
      (a, b) => a.name.localeCompare(b.name, 'tr') || a.kind.localeCompare(b.kind, 'tr'),
    );
  }, [workloads, query]);

  // Aynı ad birden fazla tipte görüldü mü? Görüldüyse ekran bunu SÖYLER — iki satırın
  // neden yan yana durduğu ve neden ikisini birden seçmenin işi durduracağı belli olsun.
  const ambiguousNames = useMemo(() => {
    const kindsByName = new Map<string, Set<string>>();
    for (const w of workloads) {
      if (w.scalable === false) continue;
      if (!kindsByName.has(w.name)) kindsByName.set(w.name, new Set());
      kindsByName.get(w.name)!.add(w.kind);
    }
    return new Set([...kindsByName.entries()].filter(([, k]) => k.size > 1).map(([n]) => n));
  }, [workloads]);

  // BAKILAMAYAN TIPLER. Cluster basina ayni tip birden fazla kez bildirilebilir
  // (her cluster kendi satirini basar) — tip bazinda tekillestirilir; bir tip HERHANGI
  // bir cluster'da okunabildiyse "bakilamadi" denmez.
  const unreadableKinds = useMemo(() => {
    const readable = new Set(kindReports.filter((k) => k.readable).map((k) => k.kind));
    const out = new Map<string, ScaleXKindReport>();
    for (const k of kindReports) {
      if (k.readable || readable.has(k.kind) || out.has(k.kind)) continue;
      out.set(k.kind, k);
    }
    return [...out.values()];
  }, [kindReports]);

  // SECIM KIMLIGI HER ZAMAN ad+tip. Eskiden KOSULLU idi (yalniz belirsiz adlarda
  // `ad\0tip`, digerlerinde duz ad) ama gonderim her zaman duz ad yapiyordu ve
  // `ScaleXPage` o duz adi `initial` olarak geri veriyordu. Sonuc: "Geri" deyip adima
  // donuldugunde belirsiz bir uygulamanin kutusu BOS gorunuyor, alt bardaki sayac ise
  // "1 secili" diyordu; karsilikli kilit cozuluyor ve iki tip birden isaretlenebiliyordu
  // — ozelligin ortadan kaldirdigi `ambiguous` cikmazi geri geliyordu.
  const keyOf = (w: ScaleXWorkload) => `${w.name}\u0000${w.kind}`;

  const toggle = (w: ScaleXWorkload) => {
    const key = keyOf(w);
    setSelected((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  const isSelected = (w: ScaleXWorkload) => selected.includes(keyOf(w));

  // Belirsiz adda bir tip secildiginde diger tip devre disi kalir — kullanici
  // ikisini birden secemez cunku playbook (cluster × uygulama) carpiminda
  // hangisinin islenecegini bilemezdi.
  const isKindBlocked = (w: ScaleXWorkload) => {
    if (!ambiguousNames.has(w.name)) return false;
    return selected.some((s) => {
      const idx = s.indexOf('\u0000');
      return idx >= 0 && s.slice(0, idx) === w.name && s.slice(idx + 1) !== w.kind;
    });
  };

  if (phase === 'running') {
    return (
      <div className="py-10 flex flex-col items-center gap-3">
        {/* ON-LISTE: paylasilan katalogdan gelen adlar, AWX'e dokunmadan. Kullanici
            bos bir spinner'a degil, namespace'te NE OLDUGUNA bakarak bekliyor.
            SECIM ACILMAZ: replica/HPA/geri alinabilirlik gibi karar girdileri henuz
            gelmedi ve onlarsiz secim yaptirmak, kullaniciyi bilmedigi bir islemi
            onaylamaya birakmak olurdu. */}
        {preview.length > 0 && (
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] p-3">
            <p className="text-xs font-medium text-[var(--text-secondary)]">
              Bu namespace'te {preview.length} uygulama kayıtlı
              {previewHidden > 0 && ` · ${previewHidden} tanesi yetki kısıtı nedeniyle gizli`}
            </p>
            <p className="mt-1 flex flex-wrap gap-1.5">
              {preview.slice(0, 24).map((a) => (
                <span
                  key={a.name}
                  className="font-mono text-xs text-[var(--text-muted)] truncate max-w-[14rem]"
                  title={`${a.name} — ${a.clusters.join(', ')}`}
                >
                  {a.name}
                </span>
              ))}
              {preview.length > 24 && (
                <span className="text-xs text-[var(--text-muted)]">+{preview.length - 24}</span>
              )}
            </p>
          </div>
        )}
        <span
          aria-hidden="true"
          className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin"
        />
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {preview.length > 0 ? 'Canlı durum okunuyor…' : 'Uygulamalar keşfediliyor…'}
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          {scope.clusters.length} cluster · <span className="font-mono">{scope.namespace}</span> —
          salt okunur, hiçbir şey değiştirilmiyor.
        </p>
        <p className="text-xs text-[var(--text-muted)] tabular-nums">
          {Math.floor(elapsed / 60)} dk {String(elapsed % 60).padStart(2, '0')} sn
          {job && (
            <>
              {' '}
              · AWX işi <span className="font-mono">#{job.jobId}</span>
            </>
          )}
        </p>
        {elapsed >= 90 && (
          <p role="status" className="max-w-md text-center text-xs text-amber-700">
            Beklenenden uzun sürüyor — AWX kuyruğunda bekliyor olabilir. Keşif salt okunur olduğu
            için vazgeçmek hiçbir şeyi bozmaz.
          </p>
        )}
        {elapsed >= 30 && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              aliveRef.current = false;
              onBack();
            }}
          >
            İptal et ve geri dön
          </button>
        )}
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700"
        >
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{message}</span>
        </div>
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-1.5"
          onClick={startDiscovery}
        >
          <ArrowPathIcon aria-hidden="true" className="w-4 h-4" /> Tekrar dene
        </button>
      </div>
    );
  }

  // Taranamayan cluster sayisi secilen cluster sayisina esitse ortada "kismi basari"
  // yoktur — hicbir sey taranmamistir.
  const allClustersFailed =
    failedClusters.length > 0 && failedClusters.length >= scope.clusters.length;

  return (
    <div className="space-y-4">
      {allClustersFailed && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
        >
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Seçilen cluster'ların <strong>hiçbiri</strong> taranamadı — aşağıdaki liste boş olduğu
            için değil, tarama yapılamadığı için boş.
          </span>
        </div>
      )}

      {!allClustersFailed && !!failedClusters.length && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>{failedClusters.join(', ')}</strong> taranamadı — aşağıdaki liste EKSİK
            olabilir.
            {problems[0] ? ` (${problems[0].detail})` : ''}
          </span>
        </div>
      )}

      {/* ── BAKILAMAYAN TIPLER ────────────────────────────────────────────────
          Bir tip okunamadiginda eskiden HICBIR iz kalmiyordu: ekran "StatefulSet
          yok" ile "StatefulSet'e bakamadim"i ayirt edemiyordu ve uretimde
          hangisinin yasandigini kimse soyleyemiyordu. Iki neden kullanici icin
          tamamen farkli: biri platformdan ISTENEBILIR, digeri hakkinda yapacak
          bir sey olmayan bir olgu. */}
      {unreadableKinds.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>{unreadableKinds.map((k) => k.display).join(', ')}</strong>
            {
              ' nesnelerine bakılamadı — bu tipler listede YOK, ama gerçekten olmadıkları anlamına gelmiyor.'
            }
            <span className="mt-1.5 block space-y-0.5">
              {unreadableKinds.map((k) => (
                <span key={k.kind} className="block">
                  <span className="font-mono">{k.display}</span>
                  {k.reason === 'no_permission' ? (
                    <>
                      {' '}
                      — portalın OCP kullanıcısının bu namespace'te{' '}
                      <span className="font-mono">
                        {k.verb || 'list'} {k.kind}
                      </span>{' '}
                      yetkisi yok. Platform ekibinden isteyin (genellikle{' '}
                      <span className="font-mono">view</span> ClusterRole binding'i yeterli).
                    </>
                  ) : (
                    <>
                      {' '}
                      — bu cluster'da o nesne türü kurulu değil (API/CRD yok). Yapılacak bir şey
                      yok.
                    </>
                  )}
                </span>
              ))}
            </span>
          </span>
        </div>
      )}

      {/* ── PAKET SURUMU ─────────────────────────────────────────────────────
          Paket AWX'e ELLE kopyalaniyor. Ekran bunu bugune kadar TAHMIN ediyordu
          ("guncel surum kopyalanmamis olabilir"); artik kosan surumu biliyor. */}
      {pkg && pkg.running !== pkg.expected && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
        >
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1.5">
            <span>
              AWX'te{' '}
              <strong>
                {pkg.running === '0'
                  ? 'sürüm bildirmeyen eski bir paket'
                  : `${pkg.running} numaralı paket`}
              </strong>{' '}
              koşuyor, portal <strong>{pkg.expected}</strong> bekliyor. Sonuçlar eksik ya da eski
              biçimde olabilir —<span className="font-mono"> scalex_app/</span> klasörünün güncel
              hâli AWX projesine yeniden kopyalanmalı.
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="font-mono text-[11px] bg-amber-100 rounded px-1.5 py-0.5 select-all">
                running:&nbsp;{pkg.running} → expected:&nbsp;{pkg.expected}
              </code>
              <button
                type="button"
                data-testid="pkg-copy-btn"
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-200 transition-colors"
                onClick={() => {
                  navigator.clipboard
                    .writeText('cp -r server/ansible/scalex_file/scalex_app/ <AWX_PROJECT_DIR>/')
                    .then(() => {
                      setPkgCopied(true);
                      setTimeout(() => setPkgCopied(false), 2000);
                    });
                }}
              >
                {pkgCopied ? 'Kopyalandı' : 'Komutu kopyala'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pdbWarning && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{pdbWarning}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={busy}
            placeholder="Uygulama ara…"
            aria-label="Uygulama ara"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]
                       text-[var(--text-primary)] placeholder-[var(--text-muted)]
                       focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        <button
          type="button"
          onClick={startDiscovery}
          disabled={busy}
          title="Listeyi yeniden tara"
          className="p-2 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <ArrowPathIcon aria-hidden="true" className="w-4 h-4" />
        </button>
      </div>

      {/* LISTE DOLU AMA HICBIRI SECILEMIYOR. "Bulunamadi" bloku ateslenmez (liste bos
          degil), `Devam` pasiftir ve sebep hicbir yerde yazmazdi — kullanici neden
          ilerleyemedigini goremiyordu. Ekranin sustugu sinifin ta kendisi. */}
      {list.length > 0 && list.every((w) => w.scalable === false) && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <ExclamationTriangleIcon aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Bu namespace'te yalnızca <strong>replica ile ölçeklenemeyen</strong> nesneler var
            (DaemonSet düğüm sayısıyla ölçeklenir, CronJob{' '}
            <span className="font-mono">suspend</span> ile durdurulur). ScaleX bu tiplere dokunmaz —
            aşağıdaki liste bilgi amaçlıdır.
          </span>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border-subtle)] max-h-96 overflow-y-auto">
        {list.map((w) => {
          // ÖLÇEKLENEMEYEN TİPLER SEÇİLEMEZ. DaemonSet düğüm sayısıyla ölçeklenir,
          // CronJob `spec.suspend` ile durdurulur — replica ile bir şey yapılamaz.
          // Listede DURURLAR: kullanıcı "namespace'imde var ama ScaleX görmüyor"
          // demesin, ama neden dokunulamadığı yazsın.
          const locked = w.scalable === false;
          const kindBlocked = isKindBlocked(w);
          return (
            <label
              key={keyOf(w)}
              className={`flex items-start gap-3 px-3 py-2.5 text-sm hover:bg-[var(--bg-inset)] ${
                locked || kindBlocked ? 'cursor-default opacity-70' : 'cursor-pointer'
              }`}
              {...(kindBlocked
                ? { title: 'Aynı ada sahip farklı bir tip seçildi — ikisi birden seçilemez.' }
                : {})}
            >
              <input
                type="checkbox"
                className="mt-1"
                disabled={busy || locked || kindBlocked}
                checked={!locked && isSelected(w)}
                onChange={() => !locked && !kindBlocked && toggle(w)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[var(--text-primary)] truncate" title={w.name}>
                    {w.name}
                  </span>
                  <span className="pf-label pf-label--grey">{w.kind}</span>
                  {locked && <span className="pf-label pf-label--grey">ölçeklenemez</span>}
                  {/* Aynı ad iki tipte: kullanıcı hangisini seçtiğini görmeli ve
                    ikisini birden seçerse işin duracağını ÖNCEDEN bilmeli. */}
                  {ambiguousNames.has(w.name) && (
                    <span
                      className={`pf-label ${kindBlocked ? 'pf-label--orange' : 'pf-label--gold'}`}
                      title={
                        kindBlocked
                          ? 'Farklı tip seçildi — bu satır seçilemez'
                          : 'Bu ad birden fazla nesne tipinde var — yalnızca birini seçin'
                      }
                    >
                      {kindBlocked ? 'farklı tip seçildi' : 'aynı ad birden fazla tipte'}
                    </span>
                  )}
                  {/* HPA bir GÜVENLİK SİNYALİ: kullanıcı "bu uygulamayı durdurursam
                    otomatik ölçekleyici ne yapar?" sorusunu sormadan geçmemeli.
                    Playbook HPA'ya dokunmuyor — bunu açıkça yazıyoruz. */}
                  {w.hasHpa && <span className="pf-label pf-label--gold">HPA var</span>}
                  {/* GitOps: ArgoCD auto-sync acikken replica 0 birkac DAKIKADA sessizce
                    geri alinir. Dogrula-ve-tut penceresi (15 sn) bunu genellikle
                    yakalayamaz — o yuzden ONCEDEN uyariyoruz. */}
                  {w.gitops && (
                    <span className="pf-label pf-label--orange" title={w.gitops}>
                      GitOps ile yönetiliyor
                    </span>
                  )}
                  {w.specReplicas === 0 && w.restorable && (
                    <span className="pf-label pf-label--blue">
                      durdurulmuş · geri alınabilir ({w.previousReplicas})
                    </span>
                  )}
                  {w.specReplicas === 0 && !w.restorable && (
                    <span className="pf-label pf-label--grey">replica 0</span>
                  )}
                </span>
                <span className="block mt-0.5 text-xs text-[var(--text-muted)] tabular-nums">
                  {locked ? (
                    w.notScalableReason === 'suspend_not_replicas' ? (
                      <>
                        {w.suspended ? 'askıya alınmış' : 'etkin'}
                        {w.schedule ? (
                          <>
                            {' '}
                            · <span className="font-mono">{w.schedule}</span>
                          </>
                        ) : null}
                        {' · durdurmak için suspend gerekir, replica ile yapılamaz'}
                      </>
                    ) : (
                      <>
                        {w.desired ?? 0} düğümde çalışıyor · hazır {w.readyReplicas}
                        {' · düğüm sayısıyla ölçeklenir, replica ile yapılamaz'}
                      </>
                    )
                  ) : (
                    <>
                      replica {w.specReplicas} · hazır {w.readyReplicas}/{w.statusReplicas}
                    </>
                  )}
                  {w.image ? (
                    <>
                      {' '}
                      · <span className="font-mono">{w.image}</span>
                    </>
                  ) : null}
                </span>
              </span>
            </label>
          );
        })}
        {list.length === 0 && (
          <div className="px-3 py-10 text-center">
            <BoltSlashIcon
              aria-hidden="true"
              className="w-6 h-6 mx-auto text-[var(--text-muted)]"
            />
            {/* "HİÇBİRİ TARANAMADI" ile "NAMESPACE BOŞ" AYNI EKRAN DEĞİLDİR.
                Tüm cluster'lar düştüğünde `workloads` boş gelir ve akış yine "done"
                olur; ayırt edilmezse kullanıcı doğru namespace'i seçtiği halde yanlış
                seçtiğini sanıp oradan ayrılabilir. */}
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              {query
                ? 'Aramanla eşleşen uygulama yok.'
                : allClustersFailed
                  ? "Hiçbir cluster taranamadı — bu, namespace'in boş olduğu anlamına GELMEZ."
                  : "Bu namespace'te dc/deploy/sts/rollout bulunamadı."}
            </p>
            {!query && !allClustersFailed && (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Liste yalnızca dc/deploy/sts/rollout türlerini kapsar. Namespace adını ve bu
                namespace için yetkinizi de kontrol edin.
              </p>
            )}
            {!query && allClustersFailed && (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Yukarıdaki hata ayrıntısına bakın; bağlantı düzeldiğinde tekrar deneyin.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border)] pt-4">
        <span className="text-xs text-[var(--text-muted)]">
          {selected.length} uygulama × {scope.clusters.length} cluster ={' '}
          <strong className="text-[var(--text-primary)]">
            {selected.length * scope.clusters.length} hedef
          </strong>
        </span>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !selected.length}
          onClick={() => {
            // Sunucu uygulama ADI bekliyor; ekran ise ad+tip anahtarini SAKLAMALI ki
            // "Geri" ile donuldugunde secim aynen geri yuklensin (bkz. keyOf notu).
            const appNames = [
              ...new Set(
                selected.map((s) => {
                  const i = s.indexOf('\u0000');
                  return i >= 0 ? s.slice(0, i) : s;
                }),
              ),
            ];
            onSubmit({
              apps: appNames,
              selectedKeys: selected,
              workloads,
              fetchedAt: fetchedAtRef.current || Date.now(),
            });
          }}
        >
          Devam
        </button>
      </div>
    </div>
  );
};

export default WorkloadStep;
