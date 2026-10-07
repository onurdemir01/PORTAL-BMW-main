// src/components/admin/tabs/LongJobCancelTokenSection.tsx — "İptal token'ı" (Admin > Ansible Info >
// Uzun süren işleri iptal).
//
// Kullanıcı (2026-10-03): "Portal'ın AWX servis kullanıcısına yetki verme hakkım yok. Şimdilik kendi
// onurdemir3 kullanıcımın token'ını Portal admin panelinden vereyim; uzun süren işleri onunla iptal et."
//
// Sunucu tarafı: server/ansible/long-job-cancel-token.cjs (şifreli saklama, ENV_OVERRIDES_ENCRYPTION_KEY)
// + long-job-cancel.cjs uçları (/api/ansible/longjob-cancel/tokens). Ekran sözleşmesi:
//   - Alan YALNIZ YAZILIR: sunucu değeri hiçbir yanıtta geri döndürmez; ekran yalnız "tanımlı / tanımlı
//     değil", token sahibi kullanıcı, kim ve ne zaman girdi, son doğrulama sonucunu gösterir. Kayıttan
//     sonra giriş kutusu boşaltılır.
//   - Kayıtta AWX GET /api/v2/me/ ile doğrulanır (geçersizse kaydedilmez). Anahtar tanımlı değilse
//     kayıt reddedilir (düz metin saklanmaz) — ekran bunu baştan söyler ve Kaydet kapalıdır.
//   - Token YALNIZ otomatik iptal ve yetki ön kontrolünde kullanılır; Portal'ın diğer AWX işlemleri
//     servis kullanıcısıyla devam eder.
import React, { useCallback, useState } from "react";
import { safeJson } from "@/api/http";
import { fmtDateTime } from "@/utils/datetime";
import { useAsyncEffect } from "@/hooks/useAsyncEffect";

interface TokenVerify {
  at: string | null;
  ok: boolean;
  httpStatus: number | null;
  result: string;
  message: string | null;
  by: string | null;
}
export interface CancelTokenRow {
  serverId: number;
  serverName: string;
  serverKnown?: boolean;
  defined: boolean;
  owner: string | null;
  ownerIsSuperuser?: boolean;
  setBy: string | null;
  setAt: string | null;
  lastVerify: TokenVerify | null;
  invalid: boolean;
  invalidInfo?: { at: string; httpStatus: number | null; message: string | null; reason?: string } | null;
  // Adres bağlama: token kaydedildiği AWX adresine (origin + API tabanı) bağlıdır. Sunucunun adresi
  // değişirse token yeni adrese GÖNDERİLMEZ; ekran bunu iptal denenmeden önce söyler.
  boundTo?: string | null;
  addressChanged?: boolean | null;
  addressMessage?: string | null;
}
interface TokensResp {
  ok: boolean;
  encryptionKeyConfigured: boolean;
  readError: { at: string; message: string } | null;
  measured: boolean;
  servers: CancelTokenRow[];
  message?: string;
}
type Tone = "ok" | "warn" | "bad";

export const TOKENS_API = "/api/ansible/longjob-cancel/tokens";
export const TOKEN_TEMP_WARNING =
  "Kişisel token geçici çözümdür; Portal servis kullanıcısına template Admin rolü verilince silin.";

const VERIFY_LABEL: Record<string, string> = {
  gecerli: "geçerli",
  gecersiz: "GEÇERSİZ",
  cozulemedi: "çözülemedi",
};

/** Kırmızı rozet: token neden kullanılamıyor (adres değişti / çözülemedi / AWX'te geçersiz). */
function invalidLabel(row: CancelTokenRow): string {
  if (row.addressChanged || row.invalidInfo?.reason === "adres_degisti") return "ADRES DEĞİŞTİ — token gönderilmiyor";
  if (row.invalidInfo?.reason === "cozulemedi") return "İPTAL TOKEN'I ÇÖZÜLEMEDİ";
  return "İPTAL TOKEN'I GEÇERSİZ";
}

function VerifyLine({ v }: { v: TokenVerify | null }) {
  if (!v) return <span className="text-gray-400">son doğrulama yok</span>;
  return (
    <span className={v.ok ? "text-emerald-700" : "text-red-700 font-semibold"}>
      son doğrulama: {VERIFY_LABEL[v.result] || v.result}
      {v.httpStatus && !v.ok ? ` (AWX ${v.httpStatus})` : ""} · {fmtDateTime(v.at)}
      {v.by ? ` · ${v.by}` : ""}
      {v.message ? ` — ${v.message}` : ""}
    </span>
  );
}

export default function LongJobCancelTokenSection({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<TokensResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<Record<number, string | null>>({});
  const [msgs, setMsgs] = useState<Record<number, { tone: Tone; text: string } | undefined>>({});

  const setMsg = (id: number, m: { tone: Tone; text: string } | undefined) => setMsgs((x) => ({ ...x, [id]: m }));
  const setBusyFor = (id: number, v: string | null) => setBusy((x) => ({ ...x, [id]: v }));

  const load = useCallback(async () => {
    try {
      const r: TokensResp = await fetch(TOKENS_API).then(safeJson);
      if (r.ok) {
        setData(r);
        setErr(null);
      } else setErr(r.message || "İptal token'ı durumu alınamadı.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useAsyncEffect(
    async (alive) => {
      if (alive()) await load();
    },
    [load],
  );

  const save = async (row: CancelTokenRow) => {
    const value = (inputs[row.serverId] || "").trim();
    if (!value) {
      setMsg(row.serverId, { tone: "bad", text: "Token boş olamaz." });
      return;
    }
    setBusyFor(row.serverId, "save");
    setMsg(row.serverId, undefined);
    try {
      const r = await fetch(`${TOKENS_API}/${row.serverId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: value }),
      }).then(safeJson);
      if (r.ok) {
        // Değer ekranda TUTULMAZ: kayıttan sonra kutu boşaltılır.
        setInputs((x) => ({ ...x, [row.serverId]: "" }));
        setMsg(row.serverId, {
          tone: "ok",
          text:
            `Kaydedildi ve doğrulandı: token sahibi ${r.owner}${r.ownerIsSuperuser ? " (süperkullanıcı)" : ""}. ` +
            "İptal edilemeyen işler bir sonraki taramada bu token'la yeniden denenir.",
        });
        await load();
        onChanged?.();
      } else setMsg(row.serverId, { tone: "bad", text: r.message || "Kaydedilemedi." });
    } catch (e: unknown) {
      setMsg(row.serverId, { tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyFor(row.serverId, null);
    }
  };

  const remove = async (row: CancelTokenRow) => {
    if (
      !window.confirm(
        `${row.serverName} iptal token'ı (${row.owner || "?"}) silinsin mi? Sonraki iptaller Portal servis kullanıcısıyla denenir.`,
      )
    )
      return;
    setBusyFor(row.serverId, "delete");
    setMsg(row.serverId, undefined);
    try {
      const r = await fetch(`${TOKENS_API}/${row.serverId}`, { method: "DELETE" }).then(safeJson);
      if (r.ok) {
        setMsg(row.serverId, { tone: "ok", text: "Silindi. Otomatik iptal bu sunucuda Portal servis kullanıcısıyla denenir." });
        await load();
        onChanged?.();
      } else setMsg(row.serverId, { tone: "bad", text: r.message || "Silinemedi." });
    } catch (e: unknown) {
      setMsg(row.serverId, { tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyFor(row.serverId, null);
    }
  };

  const verify = async (row: CancelTokenRow) => {
    setBusyFor(row.serverId, "verify");
    setMsg(row.serverId, undefined);
    try {
      const r = await fetch(`${TOKENS_API}/${row.serverId}/verify`, { method: "POST" }).then(safeJson);
      if (r.ok) {
        const res = r.result || {};
        setMsg(
          row.serverId,
          res.ok
            ? { tone: "ok", text: `Geçerli: token sahibi ${res.owner}.${res.message ? ` ${res.message}` : ""}` }
            : res.measured === false
              ? { tone: "warn", text: res.message || "Ölçülemedi (geçersiz DEMEK DEĞİL)." }
              : { tone: "bad", text: res.message || "İPTAL TOKEN'I GEÇERSİZ." },
        );
        await load();
        onChanged?.();
      } else setMsg(row.serverId, { tone: "bad", text: r.message || "Doğrulanamadı." });
    } catch (e: unknown) {
      setMsg(row.serverId, { tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyFor(row.serverId, null);
    }
  };

  const keyMissing = data ? !data.encryptionKeyConfigured : false;
  const inputCls = "px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white w-64";
  const btn = "px-2 py-1 text-[11px] border rounded-lg disabled:opacity-50";

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-3 mb-3" data-testid="ljc-token-section">
      <div className="text-xs font-semibold text-gray-700 mb-1">İptal token'ı (AWX sunucusu başına)</div>
      <div className="text-xs mb-1 px-2 py-1 rounded border border-amber-300 bg-amber-100 text-amber-900" data-testid="ljc-token-warning">
        {TOKEN_TEMP_WARNING}
      </div>
      <p className="text-[11px] text-gray-600 mb-2">
        Tanımlıysa otomatik iptal ve yetki ön kontrolü bu token'la (token sahibinin AWX yetkisiyle) yapılır; Portal'ın diğer
        tüm AWX işlemleri servis kullanıcısıyla devam eder. Kayıtta AWX'te doğrulanır (geçersizse kaydedilmez), şifreli
        saklanır ve <b>bir daha gösterilmez</b> (yalnız yazılır). Tanımlı değilse Portal servis kullanıcısı kullanılır.
      </p>
      {err && <div className="text-xs text-red-600 mb-2">İptal token'ı durumu alınamadı: {err}</div>}
      {keyMissing && (
        <div className="text-xs mb-2 px-2 py-1 rounded border border-red-300 bg-red-50 text-red-700" data-testid="ljc-token-nokey">
          ENV_OVERRIDES_ENCRYPTION_KEY tanımlı değil: token şifrelenmeden saklanamaz, kayıt reddedilir. Operatör anahtarı
          tanımlayıp Portal'ı yeniden başlatmalı.
        </div>
      )}
      {data?.readError && (
        <div className="text-xs mb-2 px-2 py-1 rounded border border-red-300 bg-red-50 text-red-700">
          İptal token kaydı okunamadı (DB): {data.readError.message}
          {data.measured ? " — son geçerli kayıt gösteriliyor." : " — tanımlı olup olmadığı ÖLÇÜLEMEDİ."}
        </div>
      )}
      {data && (data.servers || []).length === 0 && <div className="text-[11px] text-gray-500">Tanımlı AWX sunucusu yok.</div>}
      <div className="space-y-2">
        {(data?.servers || []).map((row) => {
          const b = busy[row.serverId];
          const m = msgs[row.serverId];
          return (
            <div
              key={row.serverId}
              data-testid={`ljc-token-row-${row.serverId}`}
              className={`rounded-lg border p-2 ${row.invalid ? "border-red-300 bg-red-50" : "border-gray-200 bg-white"}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-gray-700">{row.serverName}</span>
                {row.defined ? (
                  <span className="text-[10px] px-1.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700">tanımlı</span>
                ) : (
                  <span className="text-[10px] px-1.5 rounded border border-gray-200 bg-gray-50 text-gray-500">tanımlı değil</span>
                )}
                {row.invalid && (
                  <span
                    data-testid={`ljc-token-invalid-${row.serverId}`}
                    className="text-[10px] px-1.5 rounded border border-red-300 bg-red-100 text-red-800 font-semibold"
                  >
                    {invalidLabel(row)}
                  </span>
                )}
                {row.serverKnown === false && <span className="text-[10px] text-amber-800">(Portal'da artık tanımlı değil)</span>}
              </div>
              {row.defined && (
                <div className="text-[11px] text-gray-600 mt-1 space-y-0.5">
                  <div>
                    Token sahibi: <b>{row.owner || "?"}</b>
                    {row.ownerIsSuperuser ? " (süperkullanıcı)" : ""} · giren: {row.setBy || "?"} · {fmtDateTime(row.setAt)}
                  </div>
                  <div>
                    <VerifyLine v={row.lastVerify} />
                  </div>
                  <div>
                    bağlı AWX adresi: <span className="font-mono">{row.boundTo || "kayıtta yok"}</span>
                  </div>
                  {row.addressMessage && (
                    <div className="text-red-700" data-testid={`ljc-token-address-${row.serverId}`}>
                      {row.addressMessage}
                    </div>
                  )}
                  {row.invalidInfo?.message && row.invalidInfo.message !== row.addressMessage && (
                    <div className="text-red-700">{row.invalidInfo.message}</div>
                  )}
                </div>
              )}
              {row.serverKnown !== false && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <input
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    aria-label={`${row.serverName} iptal token'ı`}
                    placeholder={row.defined ? "yeni token (değiştirmek için)" : "AWX kişisel token'ı"}
                    value={inputs[row.serverId] || ""}
                    onChange={(e) => setInputs((x) => ({ ...x, [row.serverId]: e.target.value }))}
                    className={inputCls}
                    disabled={keyMissing || !!b}
                  />
                  <button
                    onClick={() => void save(row)}
                    disabled={keyMissing || !!b || !(inputs[row.serverId] || "").trim()}
                    className={`${btn} border-[#1C69D4] text-white bg-[#1C69D4]`}
                  >
                    {b === "save" ? "Doğrulanıyor…" : "Kaydet"}
                  </button>
                  {row.defined && (
                    <button onClick={() => void verify(row)} disabled={!!b} className={`${btn} border-gray-200 hover:bg-gray-50`}>
                      {b === "verify" ? "Doğrulanıyor…" : "Doğrula"}
                    </button>
                  )}
                </div>
              )}
              {row.defined && (
                <div className="mt-1">
                  <button
                    onClick={() => void remove(row)}
                    disabled={!!b}
                    className={`${btn} border-red-200 text-red-700 hover:bg-red-50`}
                  >
                    {b === "delete" ? "Siliniyor…" : "Sil"}
                  </button>
                </div>
              )}
              {m && (
                <div
                  data-testid={`ljc-token-msg-${row.serverId}`}
                  className={`text-[11px] mt-1 ${m.tone === "ok" ? "text-emerald-700" : m.tone === "warn" ? "text-amber-800" : "text-red-600"}`}
                >
                  {m.text}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
