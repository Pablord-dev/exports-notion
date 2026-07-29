"use client";
// Shell de las páginas autenticadas: sidebar de navegación anclable/ocultable.
// - Anclada (default en desktop): fija a la izquierda, el contenido se corre.
// - Oculta: botón hamburguesa fijo que la abre como overlay (cierra con Esc,
//   backdrop o al navegar). La preferencia persiste en localStorage.
// En móvil (<lg) siempre se comporta como overlay: anclar no aplica.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  Database,
  Home,
  LogOut,
  Menu,
  MessageSquare,
  Pin,
  PinOff,
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

function NavLink({ href, label, icon, onNavigate }: {
  href: string; label: string; icon: React.ReactNode; onNavigate: () => void;
}) {
  const pathname = usePathname();
  // Prefijo: /db/tiempos queda activo también en sus subrutas (p. ej. reports).
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} onClick={onNavigate}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
            active ? "bg-background font-medium text-foreground" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
          }`}>
      {icon}
      {label}
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

  // La preferencia se lee tras montar: localStorage no existe en SSR y leerla
  // en el initializer del useState produciría un hydration mismatch.
  useEffect(() => {
    const saved = localStorage.getItem(PIN_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved !== null) setPinned(saved === "1");
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
                className={`fixed top-4 left-4 z-30 bg-card text-muted-foreground hover:text-blue ${pinned ? "lg:hidden" : ""}`}>
          <Menu className="h-5 w-5" />
        </Button>
      )}

      {/* Backdrop del modo overlay */}
      {open && (
        <div className="fixed inset-0 z-40 bg-background/70 lg:bg-background/40" onClick={close} aria-hidden />
      )}

      <aside aria-label="Navegación" data-tour="shell-sidebar"
             className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-card transition-transform duration-200 ${
               open ? "translate-x-0" : "-translate-x-full"
             } ${pinned ? "lg:translate-x-0" : ""}`}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <Link href="/" onClick={close} className="font-display text-base font-bold tracking-tight text-foreground">
            iU Corp
          </Link>
          <div className="flex items-center gap-1">
            {/* Anclar/desanclar: solo tiene sentido en desktop */}
            <Button variant="ghost" size="icon" onClick={togglePin}
                    aria-label={pinned ? "Desanclar menú" : "Anclar menú"} title={pinned ? "Desanclar" : "Anclar"}
                    className={`hidden h-8 w-8 lg:inline-flex ${pinned ? "text-sky" : "text-muted-foreground"}`}>
              {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </Button>
            {/* Cerrar el overlay */}
            <Button variant="ghost" size="icon" onClick={close} aria-label="Cerrar menú"
                    className={`h-8 w-8 text-muted-foreground ${pinned ? "lg:hidden" : ""}`}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          <NavLink href="/" label="Menú principal" icon={<Home className="h-4 w-4 shrink-0" />} onNavigate={close} />
          <NavLink href="/asistente" label="Asistente IA" icon={<MessageSquare className="h-4 w-4 shrink-0" />} onNavigate={close} />
          {/* Grupo desplegable: una entrada por BD registrada */}
          <Collapsible open={dbsOpen} onOpenChange={setDbsOpen}>
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-background/60 hover:text-foreground">
                <Database className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">Bases de datos</span>
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${dbsOpen ? "rotate-90" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 space-y-1 pl-4">
              {DATABASES.map((db) => (
                <NavLink key={db.slug} href={`/db/${db.slug}/reports`} label={db.name}
                         icon={<Table2 className="h-4 w-4 shrink-0" />} onNavigate={close} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        </nav>

        <div className="border-t border-border p-4">
          <Button variant="outline" onClick={logout} disabled={loggingOut}
                  className="w-full text-muted-foreground hover:border-danger hover:bg-transparent hover:text-danger">
            {loggingOut ? <Spinner className="h-3.5 w-3.5" /> : <LogOut className="h-4 w-4" />}
            {loggingOut ? "Saliendo…" : "Cerrar sesión"}
          </Button>
        </div>
      </aside>

      {/* pt-12: aire para la hamburguesa cuando está visible (móvil siempre;
          desktop solo con la sidebar oculta) */}
      <div className={pinned ? "pt-12 lg:pl-60 lg:pt-0" : "pt-12"}>
        {tour && (
          <TourLayer tour={tour} justLoggedIn={justLoggedIn}
                     shellActions={{ openSidebar: () => setOpen(true), closeSidebar: () => setOpen(false) }} />
        )}
        {children}
      </div>
    </>
  );
}
