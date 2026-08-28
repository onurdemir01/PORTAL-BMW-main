// src/components/ai_analyst/AiAnalystPage.tsx — AI Analist: herkes için tek kanal
//
// Copilot deneyiminin portal karşılığı: kullanıcı doğal dilde sorar, LLM Dynatrace +
// Instana MCP araçlarını zincirleme çağırarak analiz eder; her araç çağrısı ayrı
// "adım" balonu olarak canlı akar (SSE).
import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  SparklesIcon, PaperAirplaneIcon, StopIcon, WrenchScrewdriverIcon,
  CheckCircleIcon, XCircleIcon, ChevronDownIcon,
  ChatBubbleLeftRightIcon, DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { aiAnalystApi, type AnalystEvent, type ChatSources, type AiConversation } from "@/api/aiAnalystApi";
import LogAnalysisPanel from "./LogAnalysisPanel";

// ── Sohbet öğe tipleri ────────────────────────────────────────────────────────
type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "step"; name: string; args: string; result?: string; ok?: boolean }
  | { kind: "status"; text: string }
  | { kind: "error"; text: string };

const STARTER_PROMPTS = [
  "Açık problemleri özetle ve önceliklendir",
  "Son 1 saatteki CONTAINER_RESTART event'lerini listele",
  "Son 24 saatte OOMKilled olan uygulamaları bul ve analiz et",
  "Ortamların genel sağlık durumunu değerlendir",
  "app-server-01 hostundaki /var/log/jboss/server.log'da son hataları bul ve Dynatrace event'leriyle karşılaştır",
  "Envanterde 'jboss' geçen hostları listele, birinde ERROR loglarını çek ve kök neden analizi yap",
  "Açık güvenlik bulgularını (security problems) önceliklendir",
];

function StepBubble({ item }: { item: Extract<ChatItem, { kind: "step" }> }) {
  const [open, setOpen] = useState(false);
  const pending = item.result === undefined;
  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-xs">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-left">
        <WrenchScrewdriverIcon className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
        <code className="font-mono text-indigo-700 truncate">{item.name}</code>
        {pending ? (
          <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
        ) : item.ok ? (
          <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
        ) : (
          <XCircleIcon className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
        )}
        <ChevronDownIcon className={`w-3 h-3 text-indigo-300 ml-auto flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          <div>
            <p className="text-[10px] font-semibold text-indigo-400 uppercase">Argümanlar</p>
            <pre className="font-mono text-[11px] text-indigo-800 whitespace-pre-wrap break-all">{item.args}</pre>
          </div>
          {item.result !== undefined && (
            <div>
              <p className="text-[10px] font-semibold text-indigo-400 uppercase">Sonuç (önizleme)</p>
              <pre className="font-mono text-[11px] text-slate-600 whitespace-pre-wrap break-all max-h-40 overflow-auto">{item.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type AnalystMode = "chat" | "logs";

const AiAnalystPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode]           = useState<AnalystMode>(searchParams.get("mode") === "logs" ? "logs" : "chat");
  const [items, setItems]         = useState<ChatItem[]>([]);
  const [input, setInput]         = useState("");
  const [running, setRunning]     = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [healthMsg, setHealthMsg] = useState<string | null>(null);
  const [sources, setSources]     = useState<ChatSources>({ dynatrace: true, instana: false });
  const [instanaEnv, setInstanaEnv] = useState<"nonprod" | "prod">("nonprod");
  // LogX handoff'u: sessionStorage'dan prefill al (bir kez, sonra temizle)
  const [logPrefill, setLogPrefill] = useState<string>("");
  const [logAutorun, setLogAutorun] = useState(false);
  const [logHostHint, setLogHostHint] = useState<string>("");
  // Sohbet kaliciligi (ai_conversations) — restart/refresh sonrasi devam edilebilir.
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  function refreshConversations() {
    aiAnalystApi.listConversations().then(setConversations).catch(() => {});
  }

  // Kayitli sohbeti yukler — mesajlar ChatItem'lara donusturulur (tool → adim karti).
  async function loadConversation(id: number) {
    if (running) return;
    const data = await aiAnalystApi.getConversation(id).catch(() => null);
    if (!data) return;
    setConversationId(id);
    setMode("chat");
    setItems(
      data.messages.map((m): ChatItem =>
        m.role === "user" ? { kind: "user", text: m.content }
        : m.role === "assistant" ? { kind: "assistant", text: m.content }
        : { kind: "step", name: m.tool_name || "tool", args: m.content.slice(0, 800), result: "", ok: true }
      )
    );
  }

  function newConversation() {
    if (running) return;
    setConversationId(null);
    setItems([]);
  }

  async function removeConversation(id: number) {
    // Geri alınamaz bir işlem: portalın diğer silme akışlarıyla aynı onay deseni.
    if (!window.confirm("Bu sohbet kalıcı olarak silinecek. Devam edilsin mi?")) return;
    await aiAnalystApi.deleteConversation(id).catch(() => {});
    if (id === conversationId) {
      setConversationId(null);
      setItems([]);
    }
    refreshConversations();
  }

  useEffect(() => {
    aiAnalystApi.health().then((h) => {
      setConfigured(h.configured);
      setHealthMsg(h.message || null);
    }).catch(() => setConfigured(false));
    refreshConversations();

    const prefill = sessionStorage.getItem("aiAnalystPrefill");
    if (prefill) {
      setLogPrefill(prefill);
      setLogAutorun(searchParams.get("autorun") === "1");
      setLogHostHint(sessionStorage.getItem("aiAnalystPrefillHost") || "");
      setMode("logs");
      sessionStorage.removeItem("aiAnalystPrefill");
      sessionStorage.removeItem("aiAnalystPrefillHost");
      // URL'i temizle (yenilemede tekrar autorun tetiklenmesin)
      setSearchParams({}, { replace: true });
    }

    // Sohbet moduna köprü: Performance/Instana sayfasındaki "AI ile analiz et"
    // butonları bu anahtara seed mesajını yazıp buraya yönlendirir (aynı desen,
    // logx prefill'in sohbet karşılığı — bkz. dynatrace/DynatracePage.tsx).
    const chatPrefill = sessionStorage.getItem("aiAnalystChatPrefill");
    if (chatPrefill) {
      sessionStorage.removeItem("aiAnalystChatPrefill");
      setMode("chat");
      setTimeout(() => send(chatPrefill), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Log raporundan sohbete köprü: mod değiştir + bulguları ilk mesaj olarak gönder
  function deepDiveFromLogs(summary: string) {
    setMode("chat");
    setTimeout(() => send(summary), 50);
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [items]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || running) return;
    setInput("");
    setRunning(true);

    const history = items
      .filter((it): it is Extract<ChatItem, { kind: "user" | "assistant" }> => it.kind === "user" || it.kind === "assistant")
      .map((it) => ({ role: it.kind === "user" ? ("user" as const) : ("assistant" as const), content: it.text }));

    setItems((prev) => [...prev, { kind: "user", text: msg }]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await aiAnalystApi.chat(
        { messages: [...history, { role: "user", content: msg }], sources, instanaEnv, conversationId },
        (e: AnalystEvent) => {
          if (e.type === "conversation") {
            setConversationId(e.id);
            refreshConversations();
            return;
          }
          setItems((prev) => {
            const next = [...prev];
            if (e.type === "status") next.push({ kind: "status", text: e.text });
            else if (e.type === "tool_call") next.push({ kind: "step", name: e.name, args: JSON.stringify(e.args, null, 1).slice(0, 800) });
            else if (e.type === "tool_result") {
              // son eşleşen bekleyen adımı güncelle
              for (let i = next.length - 1; i >= 0; i--) {
                const it = next[i];
                if (it.kind === "step" && it.name === e.name && it.result === undefined) {
                  next[i] = { ...it, result: e.preview, ok: e.ok };
                  break;
                }
              }
            } else if (e.type === "text") {
              const last = next[next.length - 1];
              if (last?.kind === "assistant") next[next.length - 1] = { kind: "assistant", text: last.text + "\n" + e.text };
              else next.push({ kind: "assistant", text: e.text });
            } else if (e.type === "error") next.push({ kind: "error", text: e.message });
            return next;
          });
        },
        ac.signal,
      );
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setItems((prev) => [...prev, { kind: "error", text: (err as Error).message }]);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
  }

  const hasChat = items.length > 0;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 7.5rem)" }}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <SparklesIcon className="w-6 h-6" style={{ color: "var(--status-info)" }} />
            AI Analist
          </h1>
          <p className="text-sm font-medium mt-1" style={{ color: "var(--text-muted)" }}>
            Doğal dilde sorun — AI, Dynatrace ve Instana araçlarını zincirleme çağırarak analiz eder
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Kaynak seçimi (sadece sohbet modunda anlamlı) */}
          {mode === "chat" && (
            <>
              {/* Sohbet gecmisi — DB'de kalici; secim eski sohbeti yukler */}
              {conversations.length > 0 && (
                <select
                  value={conversationId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) loadConversation(Number(v));
                    else newConversation();
                  }}
                  disabled={running}
                  className="text-xs border rounded-full px-2.5 py-1.5 outline-none bg-white max-w-[220px]"
                  title="Kayitli sohbetler"
                >
                  <option value="">Yeni sohbet</option>
                  {conversations.map((c) => (
                    <option key={c.id} value={c.id}>{c.title || `Sohbet #${c.id}`}</option>
                  ))}
                </select>
              )}
              {conversationId != null && (
                <button
                  onClick={() => removeConversation(conversationId)}
                  disabled={running}
                  className="text-xs font-medium px-3 py-1.5 rounded-full border bg-white text-red-500 hover:bg-red-50"
                  title="Bu sohbeti sil"
                >
                  Sohbeti Sil
                </button>
              )}
              <label className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border cursor-pointer bg-white">
                <input type="checkbox" checked={sources.dynatrace}
                  onChange={(e) => setSources((s) => ({ ...s, dynatrace: e.target.checked }))}
                  className="rounded border-gray-300" />
                Dynatrace
              </label>
              <label className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border cursor-pointer bg-white">
                <input type="checkbox" checked={sources.instana}
                  onChange={(e) => setSources((s) => ({ ...s, instana: e.target.checked }))}
                  className="rounded border-gray-300" />
                Instana
              </label>
              {sources.instana && (
                <select value={instanaEnv} onChange={(e) => setInstanaEnv(e.target.value as "nonprod" | "prod")}
                  className="text-xs border rounded-full px-2.5 py-1.5 outline-none bg-white">
                  <option value="nonprod">nonprod</option>
                  <option value="prod">prod</option>
                </select>
              )}
            </>
          )}
        </div>
      </div>

      {/* Mod seçici: Kaynak Analizi (MCP sohbet) | Log Analizi (tek atımlık rapor) */}
      <div className="flex gap-1 rounded-xl p-1 w-fit mb-4" style={{ background: "var(--bg-elevated)" }}>
        {([
          { id: "chat" as const, label: "Kaynak Analizi", icon: ChatBubbleLeftRightIcon },
          { id: "logs" as const, label: "Log Analizi",    icon: DocumentTextIcon },
        ]).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setMode(id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              mode === id ? "bg-white text-[#3c3d99]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
            style={mode === id ? { boxShadow: "var(--shadow-sm)" } : {}}>
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Yapılandırma uyarısı */}
      {configured === false && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {healthMsg || "AI sağlayıcı anahtarı tanımlı değil — AI Analist devre dışı."}
        </div>
      )}

      {/* Log Analizi modu */}
      {mode === "logs" && (
        <div className="flex-1 overflow-y-auto card p-5">
          <LogAnalysisPanel
            initialText={logPrefill || undefined}
            autorun={logAutorun}
            disabled={configured === false}
            hostHint={logHostHint || undefined}
            onDeepDive={deepDiveFromLogs}
          />
        </div>
      )}

      {/* Sohbet alanı */}
      {mode === "chat" && (
      <div className="flex-1 overflow-y-auto card p-5 space-y-3">
        {!hasChat && (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <SparklesIcon className="w-10 h-10 opacity-20" style={{ color: "var(--status-info)" }} />
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Bir soru sorun ya da hazır analizlerden birini seçin:
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-xl">
              {STARTER_PROMPTS.map((p) => (
                <button key={p} onClick={() => send(p)} disabled={running || configured === false}
                  className="text-xs px-3 py-2 rounded-full border bg-white hover:border-[#5752d1] hover:text-[#3c3d99] transition-colors disabled:opacity-50">
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {items.map((item, i) => {
          if (item.kind === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm text-white" style={{ background: "var(--accent)" }}>
                  {item.text}
                </div>
              </div>
            );
          }
          if (item.kind === "assistant") {
            return (
              <div key={i} className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm whitespace-pre-wrap bg-white border" style={{ color: "var(--text-primary)" }}>
                  {item.text}
                </div>
              </div>
            );
          }
          if (item.kind === "step") return <div key={i} className="max-w-[85%]"><StepBubble item={item} /></div>;
          if (item.kind === "status") {
            return <p key={i} className="text-xs text-center" style={{ color: "var(--text-muted)" }}>{item.text}</p>;
          }
          return (
            <div key={i} className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              {item.text}
            </div>
          );
        })}

        {running && (
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
            <span className="w-3.5 h-3.5 border-2 border-[#5752d1] border-t-transparent rounded-full animate-spin" />
            Analiz ediliyor…
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      )}

      {/* Giriş alanı (sohbet modu) */}
      {mode === "chat" && (
      <div className="mt-3 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder={configured === false ? "AI anahtarı tanımlı değil" : "Örn: payment servisinde son 1 saatte ne oldu?"}
          disabled={running || configured === false}
          className="flex-1 rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#5752d1]/30 bg-white disabled:opacity-60"
        />
        {running ? (
          <button onClick={stop} className="px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm font-medium flex items-center gap-1.5">
            <StopIcon className="w-4 h-4" /> Durdur
          </button>
        ) : (
          <button onClick={() => send()} disabled={!input.trim() || configured === false}
            className="btn-primary px-4 py-2.5 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
            <PaperAirplaneIcon className="w-4 h-4" /> Gönder
          </button>
        )}
      </div>
      )}
    </div>
  );
};

export default AiAnalystPage;
