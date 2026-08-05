"use client";
// Shell de las páginas autenticadas: sidebar de navegación anclable/ocultable.
// - Anclada (default en desktop): fija a la izquierda, el contenido se corre.
// - Oculta: botón hamburguesa fijo que la abre como overlay (cierra con Esc,
//   backdrop o al navegar). La preferencia persiste en localStorage.
// En móvil (<lg) siempre se comporta como overlay: anclar no aplica.
// Diseño: chrome #04122F (bg-sidebar), header con logotipo + producto, grupos
// con label versalitas, item activo con superficie accent, footer de sesión.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  Clock,
  Home,
  LogOut,
  Menu,
  MessageSquare,
  PanelLeft,
  Table2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { DATABASES } from "@/lib/databases";
import { Spinner } from "@/app/components/spinner";
import { TourLayer, type TourBinding } from "@/app/components/tour/tour-layer";

const PIN_KEY = "sidebar-pinned";

// Icono de cada BD en la navegación, por slug (default: tabla genérica).
const DB_ICONS: Record<string, React.ReactNode> = {
  tiempos: <Clock className="h-4 w-4 shrink-0" />,
};

// Contador compacto para el badge de la BD: 21307 → "21.3k".
const fmtCompact = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

function NavLink({ href, label, icon, badge, onNavigate }: {
  href: string; label: string; icon: React.ReactNode; badge?: string; onNavigate: () => void;
}) {
  const pathname = usePathname();
  // Prefijo: /db/tiempos queda activo también en sus subrutas (p. ej. reports).
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} onClick={onNavigate}
          className={`flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] transition ${
            active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          }`}>
      {icon}
      <span className="flex-1 truncate text-left">{label}</span>
      {badge && (
        <span className="rounded-full bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
          {badge}
        </span>
      )}
    </Link>
  );
}

export function AppShell({ children, onLogout, tour, justLoggedIn }: {
  children: React.ReactNode;
  onLogout: () => void;
  /** Guión de esta página. Sin él no hay botón "?" ni overlay. */
  tour?: TourBinding;
  /** true sólo tras un login exitoso en esta carga de página. */
  justLoggedIn?: boolean;
}) {
  const [pinned, setPinned] = useState(true);
  const [open, setOpen] = useState(false);
  const [dbsOpen, setDbsOpen] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  // La preferencia se lee tras montar: localStorage no existe en SSR y leerla
  // en el initializer del useState produciría un hydration mismatch.
  useEffect(() => {
    const saved = localStorage.getItem(PIN_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved !== null) setPinned(saved === "1");
  }, []);

  // Contador de registros para el badge de la BD. El shell solo se monta en
  // ramas autenticadas; si el fetch falla, simplemente no hay badge.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/sync/status");
        if (!r.ok || !alive) return;
        const s = await r.json();
        if (alive && typeof s?.meta?.count === "number") setCount(s.meta.count);
      } catch { /* sin badge */ }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function togglePin() {
    const next = !pinned;
    setPinned(next);
    setOpen(false);
    localStorage.setItem(PIN_KEY, next ? "1" : "0");
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/login", { method: "DELETE" });
      onLogout();
    } finally { setLoggingOut(false); }
  }

  const close = () => setOpen(false);

  return (
    <>
      {/* Hamburguesa: visible cuando la sidebar no está a la vista */}
      {!open && (
        <Button variant="outline" size="icon" onClick={() => setOpen(true)} aria-label="Abrir menú"
                className={`fixed top-4 left-4 z-30 bg-card text-muted-foreground hover:text-foreground ${pinned ? "lg:hidden" : ""}`}>
          <Menu className="h-5 w-5" />
        </Button>
      )}

      {/* Backdrop del modo overlay */}
      {open && (
        <div className="fixed inset-0 z-40 bg-background/70 lg:bg-background/40" onClick={close} aria-hidden />
      )}

      <aside aria-label="Navegación" data-tour="shell-sidebar"
             className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-200 ${
               open ? "translate-x-0" : "-translate-x-full"
             } ${pinned ? "lg:translate-x-0" : ""}`}>
        {/* Header: logotipo + producto + control de anclaje/cierre */}
        <div className="flex items-center gap-2.5 border-b border-sidebar-border py-3 pl-4 pr-3">
          <Link href="/" onClick={close} aria-label="Ir al menú principal"
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-blue font-display text-xs font-extrabold tracking-tight text-white">
            iU
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight text-foreground">iU Corp</p>
            <p className="truncate text-[11px] leading-tight text-muted-foreground">iU Notion Reports</p>
          </div>
          {/* Anclar/desanclar: solo tiene sentido en desktop */}
          <Button variant="ghost" size="icon" onClick={togglePin}
                  aria-label={pinned ? "Desanclar menú" : "Anclar menú"} title={pinned ? "Desanclar" : "Anclar"}
                  className="hidden h-7 w-7 text-muted-foreground hover:text-foreground lg:inline-flex">
            <PanelLeft className="h-4 w-4" />
          </Button>
          {/* Cerrar el overlay */}
          <Button variant="ghost" size="icon" onClick={close} aria-label="Cerrar menú"
                  className={`h-7 w-7 text-muted-foreground ${pinned ? "lg:hidden" : ""}`}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3.5">
          <div>
            <p className="px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-widest text-subtle">Plataforma</p>
            <div className="space-y-0.5">
              <NavLink href="/" label="Menú principal" icon={<Home className="h-4 w-4 shrink-0" />} onNavigate={close} />
              <NavLink href="/asistente" label="Asistente IA" icon={<MessageSquare className="h-4 w-4 shrink-0" />} onNavigate={close} />
            </div>
          </div>
          {/* Grupo desplegable: una entrada por BD registrada */}
          <Collapsible open={dbsOpen} onOpenChange={setDbsOpen}>
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center gap-1.5 px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-widest text-subtle transition hover:text-muted-foreground">
                Bases de datos
                <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${dbsOpen ? "rotate-90" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-0.5">
              {DATABASES.map((db) => (
                <NavLink key={db.slug} href={`/db/${db.slug}/reports`} label={db.name}
                         icon={DB_ICONS[db.slug] ?? <Table2 className="h-4 w-4 shrink-0" />}
                         badge={count !== null && count > 0 ? fmtCompact(count) : undefined}
                         onNavigate={close} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        </nav>

        {/* Footer de sesión: estado + logout como icono */}
        <div className="flex items-center gap-2.5 border-t border-sidebar-border px-4 py-2.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden />
          <span className="flex-1 truncate text-xs text-muted-foreground">Sesión activa</span>
          <Button variant="ghost" size="icon" onClick={logout} disabled={loggingOut}
                  aria-label="Cerrar sesión" title="Cerrar sesión"
                  className="h-7 w-7 text-muted-foreground hover:text-danger">
            {loggingOut ? <Spinner className="h-3.5 w-3.5" /> : <LogOut className="h-4 w-4" />}
          </Button>
        </div>
      </aside>

      {/* pt-12: aire para la hamburguesa cuando está visible (móvil siempre;
          desktop solo con la sidebar oculta) */}
      <div className={pinned ? "pt-12 lg:pl-64 lg:pt-0" : "pt-12"}>
        {tour && (
          <TourLayer tour={tour} justLoggedIn={justLoggedIn}
                     shellActions={{ openSidebar: () => setOpen(true), closeSidebar: () => setOpen(false) }} />
        )}
        {children}
      </div>
    </>
  );
}
