"use client";
// Asistente IA (top-level): chat con tool-calling sobre los reportes de la BD
// seleccionada. Header estándar (breadcrumb → título + Nuevo chat); debajo,
// panel FIJO de historial agrupado por fecha (columna estática en desktop;
// Sheet en móvil) + conversación. La respuesta no es burbuja: bloque a lo
// ancho con etiqueta de rol y modelo, y el toolTrace como pills con check.
// Selectores (BD/modelo) como Select de shadcn dentro del composer.
// Chats en localStorage. Respuestas en markdown.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Check, Menu, MessageSquare, Plus, Trash2, X } from "lucide-react";
import { AppShell } from "@/app/components/app-shell";
import { MarkdownMessage } from "@/app/components/markdown-message";
import { Spinner } from "@/app/components/spinner";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
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

const isToday = (ms: number): boolean =>
  new Date(ms).toDateString() === new Date().toDateString();

// Prompts sugeridos del estado vacío: llenan el composer al click.
const SUGGESTIONS = [
  "Horas por persona este mes",
  "¿Quién cargó menos horas la semana pasada?",
  "Comparar KHOR 3 vs GestionKhor",
  "Horas de QUALITAS en junio",
];

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
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const dbName = (slug: string) => DATABASES.find((d) => d.slug === slug)?.name ?? slug;
  const noProvider = providers.length === 0;
  const providerLabel = providers.find((p) => p.id === provider)?.label ?? null;

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
      <main className="min-h-screen flex items-center justify-center gap-3 text-muted-foreground">
        <Spinner className="text-sky" /><span className="text-sm">Cargando…</span>
      </main>
    );
  }
  if (!authed) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center space-y-4">
          <h1 className="font-display text-2xl font-bold text-foreground">Asistente IA</h1>
          <p className="text-sm text-muted-foreground">Necesitas iniciar sesión para usar el asistente.</p>
          <Link href="/" className="inline-block rounded-lg bg-blue px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110">
            Ir al inicio de sesión
          </Link>
        </div>
      </main>
    );
  }

  const dbOptions = DATABASES.map((d) => ({ value: d.slug, label: d.name }));

  // Cuadro de texto estilo Claude: textarea arriba, Selects (BD/modelo) como
  // pills y el botón de enviar circular en una fila dentro del mismo recuadro.
  // Radix posiciona los menús solo.
  // ⚠️ Radix SelectItem prohíbe value="" — la rama sin proveedores va por el
  // placeholder del SelectValue, no por un item vacío.
  const composer = (
    <div>
      <div data-tour="chat-composer"
           className="rounded-2xl border border-border-strong bg-card transition focus-within:border-blue focus-within:ring-2 focus-within:ring-blue/30">
        <Textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
                  rows={1} disabled={noProvider} placeholder="Escribe tu pregunta…"
                  className="max-h-40 min-h-[48px] resize-none border-0 bg-transparent px-4 py-3 shadow-none focus-visible:ring-0 [color-scheme:dark]" />
        <div data-tour="chat-selectors" className="flex items-center gap-2 px-2.5 pb-2.5">
          <Select value={db} onValueChange={setDb}>
            <SelectTrigger size="sm" aria-label="Base de datos"
                           className="w-auto rounded-full border-border-strong bg-transparent text-xs text-muted-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dbOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={provider || undefined} onValueChange={setProvider} disabled={noProvider}>
            <SelectTrigger size="sm" aria-label="Modelo"
                           className="w-auto rounded-full border-border-strong bg-transparent text-xs text-muted-foreground">
              {provider && <span className="h-1 w-1 shrink-0 rounded-full bg-success" aria-hidden />}
              <SelectValue placeholder="— sin modelo —" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="icon" onClick={() => void send()} disabled={sending || noProvider || !input.trim()}
                  aria-label="Enviar" className="ml-auto h-8 w-8 rounded-full">
            {sending ? <Spinner className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <p className="pt-2 text-center text-[11px] text-subtle">Enter para enviar · Shift+Enter para salto de línea</p>
    </div>
  );

  // Panel de historial agrupado por fecha (Hoy / Anteriores). Se renderiza dos
  // veces (columna estática en desktop, Sheet en móvil). El botón de cerrar y
  // el Esc los aporta el Sheet de Radix.
  const chatGroups: [string, StoredChat[]][] = [
    ["Hoy", chats.filter((c) => isToday(c.updatedAt))],
    ["Anteriores", chats.filter((c) => !isToday(c.updatedAt))],
  ];
  const historyPanel = (
    <div className="flex-1 space-y-4 overflow-y-auto px-2.5 py-4">
      {chats.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">Sin chats guardados.</p>}
      {chatGroups.map(([label, group]) => group.length > 0 && (
        <div key={label}>
          <p className="px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-widest text-subtle">{label}</p>
          <div className="space-y-0.5">
            {group.map((c) => (
              <div key={c.id} onClick={() => openChat(c)}
                   className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition ${
                     c.id === activeId ? "bg-accent" : "hover:bg-accent/50"
                   }`}>
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-[12.5px] leading-snug ${c.id === activeId ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                    {c.title}
                  </div>
                  <div className="mt-0.5 text-[11px] text-subtle">{dbName(c.db)} · {fmtWhen(c.updatedAt)}</div>
                </div>
                <Button variant="ghost" size="icon" onClick={(e) => removeChatHandler(c.id, e)} aria-label="Borrar chat"
                        className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition hover:text-danger group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <AppShell onLogout={() => setAuthed(false)} tour={{ id: "asistente" }}>
      <div className="flex h-[100dvh] flex-col overflow-hidden">
        {/* Header estándar a lo ancho: breadcrumb → título + acción */}
        <header className="space-y-3 border-b border-border px-6 pb-4 pt-6 sm:px-8">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild><Link href="/">Menú</Link></BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbPage>Asistente IA</BreadcrumbPage></BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" onClick={() => setDrawerOpen(true)}
                      aria-label="Historial de chats" className="md:hidden">
                <Menu className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="font-display text-[22px] font-bold tracking-tight text-foreground">Asistente IA</h1>
                <p className="mt-0.5 text-[12.5px] text-subtle">Consulta los reportes de {dbName(db)} en lenguaje natural.</p>
              </div>
            </div>
            <Button onClick={newChat} className="shrink-0">
              <Plus className="h-4 w-4" />
              Nuevo chat
            </Button>
          </div>
        </header>

        {/* Debajo del título: panel de historial + conversación */}
        <div className="relative flex flex-1 overflow-hidden">
          {/* Panel fijo de chats: columna estática en md+; Sheet en móvil. */}
          <aside data-tour="chat-history"
                 className="hidden w-60 shrink-0 flex-col border-r border-border bg-background md:flex">
            {historyPanel}
          </aside>
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent side="left" className="w-64 bg-background p-0 pt-8">
              {historyPanel}
            </SheetContent>
          </Sheet>

          {/* Columna de conversación */}
          <div className="flex min-w-0 flex-1 flex-col">
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-4 sm:p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-sky">
                  <MessageSquare className="h-5 w-5" />
                </span>
                <div className="space-y-1.5 text-center">
                  <h2 className="font-display text-xl font-bold tracking-tight text-foreground">¿Qué quieres saber de {dbName(db)}?</h2>
                  <p className="text-[13px] text-subtle">Responde con datos reales de tus bases de Notion.</p>
                </div>
                {!noProvider && (
                  <div className="flex max-w-xl flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                              className="rounded-full border border-input bg-card px-3.5 py-1.5 text-[12.5px] text-secondary-foreground transition hover:border-border-strong hover:bg-accent">
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                <div className="w-full max-w-3xl space-y-4">
                  {composer}
                  {noProvider && (
                    <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                      No hay ningún modelo configurado. Define <code className="font-mono text-sky">LLM_OLLAMA_MODEL</code> (Ollama) o las variables de MiniMax en <code className="font-mono">.env.local</code> y reinicia el servidor.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto">
                  <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
                    {messages.map((m, i) => (
                      m.role === "user" ? (
                        <div key={i} className="flex justify-end">
                          <div className="max-w-[78%] whitespace-pre-wrap rounded-xl bg-secondary px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground">{m.content}</div>
                        </div>
                      ) : (
                        // Respuesta sin burbuja: bloque a lo ancho con etiqueta de rol
                        <div key={i} className="space-y-2.5">
                          <div className="flex items-center gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-sky" aria-hidden />
                            <span className="text-[10.5px] font-semibold uppercase tracking-widest text-subtle">Asistente</span>
                            {providerLabel && <span className="font-mono text-[11px] text-subtle">{providerLabel}</span>}
                          </div>
                          <div className="text-sm leading-relaxed">
                            <MarkdownMessage>{m.content}</MarkdownMessage>
                          </div>
                          {m.trace && m.trace.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                              {m.trace.map((t, j) => (
                                <span key={j}
                                      className="flex h-6 items-center gap-1.5 rounded-full bg-secondary px-2.5 font-mono text-[10.5px] text-muted-foreground"
                                      title={t.ok ? "Consulta exitosa" : "Consulta fallida"}>
                                  {t.ok
                                    ? <Check className="h-3 w-3 text-success" aria-label="ok" />
                                    : <X className="h-3 w-3 text-danger" aria-label="falló" />}
                                  {t.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    ))}
                    {sending && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Spinner className="text-sky" /> pensando…
                      </div>
                    )}
                    <div ref={endRef} />
                  </div>
                </div>
                <div className="px-4 pb-4 sm:px-6 sm:pb-5">
                  <div className="mx-auto max-w-3xl space-y-2">
                    {error && <p className="text-sm text-danger">{error}</p>}
                    {composer}
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
