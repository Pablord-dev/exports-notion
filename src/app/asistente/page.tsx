"use client";
// Asistente IA (top-level): chat con tool-calling sobre los reportes de la BD
// seleccionada. Estilo tipo Claude — header (breadcrumb + título) a lo ancho;
// debajo, panel FIJO de historial (columna estática en desktop; cajón en móvil)
// + conversación. Selectores (BD/modelo) como dropdowns propios redondeados
// dentro del composer. Chats en localStorage. Respuestas en markdown.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/app/components/app-shell";
import { Breadcrumb } from "@/app/components/breadcrumb";
import { Dropdown } from "@/app/components/dropdown";
import { MarkdownMessage } from "@/app/components/markdown-message";
import { Spinner } from "@/app/components/spinner";
import { DATABASES } from "@/lib/databases";
import {
  loadChats, saveChat, deleteChat, deriveTitle, newChatId,
  type StoredChat, type StoredMsg,
} from "@/lib/chat-store";

interface ProviderInfo { id: string; label: string; model: string }

const fmtWhen = (ms: number): string => {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
};

export default function AsistentePage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState("");
  const [db, setDb] = useState(DATABASES[0]?.slug ?? "");
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const createdAtRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // localStorage no existe en SSR: se lee tras montar (evita hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChats(loadChats());
    (async () => {
      const r = await fetch("/api/chat/providers");
      if (r.status === 401) { setAuthed(false); return; }
      setAuthed(true);
      if (r.ok) {
        const data: { providers: ProviderInfo[]; default: string | null } = await r.json();
        setProviders(data.providers);
        setProvider(data.default ?? data.providers[0]?.id ?? "");
      }
    })();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const dbName = (slug: string) => DATABASES.find((d) => d.slug === slug)?.name ?? slug;
  const noProvider = providers.length === 0;

  function newChat() {
    setActiveId(null);
    createdAtRef.current = 0;
    setMessages([]);
    setInput("");
    setError(null);
    setDrawerOpen(false);
  }

  function openChat(c: StoredChat) {
    setActiveId(c.id);
    createdAtRef.current = c.createdAt;
    setMessages(c.messages);
    if (c.provider && providers.some((p) => p.id === c.provider)) setProvider(c.provider);
    if (c.db) setDb(c.db);
    setError(null);
    setDrawerOpen(false);
  }

  function removeChatHandler(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setChats(deleteChat(id));
    if (id === activeId) newChat();
  }

  async function send() {
    const text = input.trim();
    if (!text || sending || !provider) return;
    setError(null);
    const convo: StoredMsg[] = [...messages, { role: "user", content: text }];
    setMessages(convo);
    setInput("");
    setSending(true);

    let id = activeId;
    if (!id) { id = newChatId(); createdAtRef.current = Date.now(); setActiveId(id); }

    let finalConvo = convo;
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, db, messages: convo.map(({ role, content }) => ({ role, content })) }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Error del asistente");
      } else {
        finalConvo = [...convo, { role: "assistant", content: data.reply, trace: data.toolTrace }];
        setMessages(finalConvo);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falló la conexión");
    } finally {
      setSending(false);
      const chat: StoredChat = {
        id, title: deriveTitle(finalConvo), db, provider,
        messages: finalConvo, createdAt: createdAtRef.current, updatedAt: Date.now(),
      };
      setChats(saveChat(chat));
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  if (authed === null) {
    return (
      <main className="min-h-screen flex items-center justify-center gap-3 text-muted">
        <Spinner className="text-sky" /><span className="text-sm">Cargando…</span>
      </main>
    );
  }
  if (!authed) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center space-y-4">
          <h1 className="font-display text-2xl font-bold text-fg">Asistente IA</h1>
          <p className="text-sm text-muted">Necesitas iniciar sesión para usar el asistente.</p>
          <Link href="/" className="inline-block rounded-lg bg-blue px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110">
            Ir al inicio de sesión
          </Link>
        </div>
      </main>
    );
  }

  const dbOptions = DATABASES.map((d) => ({ value: d.slug, label: d.name }));
  const providerOptions = noProvider ? [{ value: "", label: "— sin modelo —" }] : providers.map((p) => ({ value: p.id, label: p.label }));

  // Cuadro de texto estilo Claude: textarea arriba, dropdowns propios (BD/modelo)
  // y botón enviar en una fila dentro del mismo recuadro. openUp = dirección del
  // menú de los dropdowns (abajo en el estado inicial; arriba en la barra al pie).
  const renderComposer = (openUp: boolean) => (
    <div data-tour="chat-composer"
         className="rounded-2xl border border-border bg-dark-blue transition focus-within:border-blue focus-within:ring-2 focus-within:ring-blue/30">
      <textarea
        value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
        rows={1} disabled={noProvider} placeholder="Escribe tu pregunta…"
        className="block max-h-40 min-h-[48px] w-full resize-none bg-transparent px-4 py-3 text-sm text-fg outline-none placeholder:text-muted [color-scheme:dark] disabled:opacity-60"
      />
      <div data-tour="chat-selectors" className="flex items-center gap-2 px-2.5 pb-2.5">
        <Dropdown value={db} options={dbOptions} onChange={setDb} ariaLabel="Base de datos" openUp={openUp} />
        <Dropdown value={provider} options={providerOptions} onChange={setProvider} disabled={noProvider} ariaLabel="Modelo" openUp={openUp} />
        <button onClick={() => void send()} disabled={sending || noProvider || !input.trim()}
                className="ml-auto flex items-center gap-2 rounded-full bg-blue px-4 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
          {sending ? <Spinner className="h-4 w-4" /> : "Enviar"}
        </button>
      </div>
    </div>
  );

  return (
    <AppShell onLogout={() => setAuthed(false)} tour={{ id: "asistente" }}>
      <div className="flex h-[100dvh] flex-col overflow-hidden">
        {/* Header a lo ancho. El espaciador (ancho del panel) alinea el breadcrumb
            y el título con la conversación, para que no queden pegados a la izquierda. */}
        <header className="flex border-b border-border">
          <div className="hidden w-64 shrink-0 md:block" />
          <div className="flex-1 space-y-2 px-4 py-4 sm:px-5">
            <Breadcrumb items={[{ label: "Menú", href: "/" }, { label: "Asistente IA" }]} />
            <div className="flex items-center gap-3">
              <button onClick={() => setDrawerOpen(true)} aria-label="Historial de chats"
                      className="rounded-lg border border-border p-1.5 text-muted transition hover:border-blue hover:text-fg md:hidden">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              <h1 className="font-display text-base font-bold tracking-tight text-fg">Asistente IA</h1>
            </div>
          </div>
        </header>

        {/* Debajo del título: panel de historial + conversación */}
        <div className="relative flex flex-1 overflow-hidden">
          {/* Backdrop solo en móvil cuando el panel está abierto como cajón */}
          {drawerOpen && <div className="absolute inset-0 z-20 bg-dark-blue/50 md:hidden" onClick={() => setDrawerOpen(false)} aria-hidden />}

          {/* Panel fijo de chats: columna estática en md+; cajón off-canvas en móvil. */}
          <aside data-tour="chat-history"
                 className={`absolute inset-y-0 left-0 z-30 flex w-64 shrink-0 flex-col border-r border-border bg-dark-blue transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${drawerOpen ? "translate-x-0" : "-translate-x-full"}`}>
            <div className="flex items-center justify-between p-3">
              <button onClick={newChat}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue px-3 py-2 text-sm font-medium text-white transition hover:brightness-110">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                Nuevo chat
              </button>
              <button onClick={() => setDrawerOpen(false)} aria-label="Cerrar historial"
                      className="ml-2 rounded p-1 text-muted transition hover:text-fg md:hidden">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
              {chats.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted">Sin chats guardados.</p>}
              {chats.map((c) => (
                <div key={c.id} onClick={() => openChat(c)}
                     className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition ${
                       c.id === activeId ? "bg-surface text-fg" : "text-muted hover:bg-surface/60 hover:text-fg"
                     }`}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{c.title}</div>
                    <div className="text-[11px] text-muted">{dbName(c.db)} · {fmtWhen(c.updatedAt)}</div>
                  </div>
                  <button onClick={(e) => removeChatHandler(c.id, e)} aria-label="Borrar chat"
                          className="shrink-0 rounded p-1 text-muted opacity-0 transition hover:text-danger group-hover:opacity-100">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
                  </button>
                </div>
              ))}
            </div>
          </aside>

          {/* Columna de conversación */}
          <div className="flex min-w-0 flex-1 flex-col">
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center p-4 sm:p-5">
                <div className="w-full max-w-3xl space-y-4">
                  <h2 className="text-center font-display text-2xl font-bold text-fg">¿Qué quieres saber de {dbName(db)}?</h2>
                  {renderComposer(false)}
                  {noProvider ? (
                    <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
                      No hay ningún modelo configurado. Define <code className="font-mono text-sky">LLM_OLLAMA_MODEL</code> (Ollama) o las variables de MiniMax en <code className="font-mono">.env.local</code> y reinicia el servidor.
                    </p>
                  ) : (
                    <p className="text-center text-xs text-muted">Pregunta por totales de horas por persona o subproyecto, evolución semanal, etc.</p>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto">
                  <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-5">
                    {messages.map((m, i) => (
                      m.role === "user" ? (
                        <div key={i} className="flex justify-end">
                          <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-blue px-4 py-2.5 text-sm text-white shadow-sm">{m.content}</div>
                        </div>
                      ) : (
                        <div key={i} className="flex justify-start">
                          <div className="max-w-[90%] space-y-2 rounded-2xl rounded-bl-md border border-border bg-surface px-4 py-3 text-sm shadow-sm">
                            <MarkdownMessage>{m.content}</MarkdownMessage>
                            {m.trace && m.trace.length > 0 && (
                              <details className="text-xs text-muted">
                                <summary className="cursor-pointer">consultó {m.trace.length} herramienta(s)</summary>
                                <ul className="mt-1 space-y-0.5">
                                  {m.trace.map((t, j) => <li key={j} className="font-mono">{t.ok ? "✓" : "✗"} {t.name}</li>)}
                                </ul>
                              </details>
                            )}
                          </div>
                        </div>
                      )
                    ))}
                    {sending && <div className="flex items-center gap-2 text-sm text-muted"><Spinner className="text-sky" /> pensando…</div>}
                    <div ref={endRef} />
                  </div>
                </div>
                <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                  <div className="mx-auto max-w-3xl space-y-2">
                    {error && <p className="text-sm text-danger">{error}</p>}
                    {renderComposer(true)}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
