"use client";
// Shell de las páginas autenticadas: sidebar de navegación anclable/ocultable.
// - Anclada (default en desktop): fija a la izquierda, el contenido se corre.
// - Desanclada: panel flotante (aire arriba y abajo, esquinas y sombra)
//   escondido tras el botón hamburguesa. El cursor encima lo hace asomar (peek,
//   sin backdrop: el contenido de atrás sigue usable) y se va solo al alejarse;
//   el click lo fija. La preferencia persiste en localStorage.
// - Overlay con backdrop: sólo en móvil y para el paso del tour.
// En móvil (<lg) siempre se comporta como overlay: anclar no aplica.
// Diseño: chrome #04122F (bg-sidebar), header con logotipo + producto, grupos
// con label versalitas, item activo con superficie accent, footer de sesión.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  ChevronsUpDown,
  Clock,
  HelpCircle,
  Home,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  Table2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { DATABASES } from "@/lib/databases";
import { SettingsModal, type SectionId } from "@/app/components/settings/settings-modal";
import type { Role } from "@/lib/authz";
import type { CacheMeta } from "@/lib/types";
import type { SessionUser } from "@/lib/session";
import { Spinner } from "@/app/components/spinner";
import { TourLayer, type TourBinding } from "@/app/components/tour/tour-layer";

const PIN_KEY = "sidebar-pinned";

// Intención de hover del peek: abrir con retardo evita que la barra salte
// cuando el cursor sólo pasa de largo camino a otra cosa, y cerrar con retardo
// perdona el roce del borde al bajar del botón al panel.
const PEEK_OPEN_MS = 200;
const PEEK_CLOSE_MS = 150;
// Frontera para decidir "el cursor se fue": canto derecho del panel (w-64 =
// 256px) más una gracia. Se compara contra la posición del puntero y no con los
// pointerenter/leave del <aside>: la barra aparece DEBAJO del cursor, así que
// el navegador nunca registra un enter sobre ella —y sin enter previo tampoco
// dispara el leave—, y el peek se quedaba pegado para siempre.
const PEEK_HIT_X = 256 + 32;
// Mismo breakpoint que las clases `lg:` de la barra: debajo de él anclar no
// aplica y el botón abre el overlay de siempre.
const LG_QUERY = "(min-width: 1024px)";

// Icono de cada BD en la navegación, por slug (default: tabla genérica).
const DB_ICONS: Record<string, React.ReactNode> = {
  tiempos: <Clock className="h-4 w-4 shrink-0" />,
};

// Contador compacto para el badge de la BD: 21307 → "21.3k".
const fmtCompact = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

/** Hasta dos iniciales. Un correo sin espacios da una sola, que es correcto:
 *  inventar la segunda a partir del dominio produciría "PH" para pablo@hiuman. */
function initials(nameOrEmail: string): string {
  const parts = nameOrEmail.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return letters.join("");
}

function NavLink({ href, label, icon, badge, onNavigate }: {
  href: string; label: string; icon: React.ReactNode; badge?: string; onNavigate: () => void;
}) {
  const pathname = usePathname();
  // Prefijo: /db/tiempos queda activo también en sus subrutas (p. ej. reports).
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} onClick={onNavigate}
          className={`flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] transition ${
            // El hover va a bg-card y no a bg-accent/50: sobre el chrome de la
            // barra el translúcido componía rgb(8,27,65), que es bg-card
            // (rgb(7,27,64)) — mismo color, sin alpha.
            active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-card hover:text-foreground"
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
  // La preferencia se lee en el initializer, no en un efecto. Todas las páginas
  // montan AppShell sólo en su rama autenticada —después del fetch de sesión—,
  // así que la sidebar nunca sale en el HTML del servidor y no hay hydration
  // mismatch posible. Leerla después del primer paint hacía que con la barra
  // desanclada entrara y saliera con su transición de 200ms en cada carga y en
  // cada navegación.
  const [pinned, setPinned] = useState(() =>
    typeof window === "undefined" ? true : localStorage.getItem(PIN_KEY) !== "0");
  const [open, setOpen] = useState(false);
  // Barra asomada por hover: visible pero sin backdrop y sin correr el
  // contenido, así se lee como flotante y no como el estado anclado.
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dbsOpen, setDbsOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [settings, setSettings] = useState<SectionId | null>(null);
  const [role, setRole] = useState<Role>("viewer");
  const [meta, setMeta] = useState<CacheMeta | null>(null);

  // Contador de registros para el badge de la BD. El shell solo se monta en
  // ramas autenticadas; si el fetch falla, simplemente no hay badge.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/sync/status");
        if (!r.ok || !alive) return;
        const s = await r.json();
        if (!alive) return;
        if (typeof s?.meta?.count === "number") setCount(s.meta.count);
        // Mismo fetch, no uno nuevo: la sección «Acerca de» muestra la fecha del
        // último sync, que ya viene acá.
        if (s?.meta) setMeta(s.meta as CacheMeta);
      } catch { /* sin badge */ }
    })();
    return () => { alive = false; };
  }, []);

  // El shell sólo se monta autenticado, así que esta respuesta siempre trae
  // usuario. Es el único consumidor de la identidad en toda la app: por eso la
  // pide él y no se le pasa por props desde las tres páginas.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/auth/session");
        if (!r.ok) return;
        const j = (await r.json()) as { user?: SessionUser | null; role?: Role };
        if (!alive) return;
        if (j.user) setUser(j.user);
        // Decorativo: decide si el panel dibuja la sección Usuarios. Quien
        // autoriza de verdad es /api/admin/users.
        if (j.role) setRole(j.role);
      } catch { /* sin identidad el footer cae al correo vacío, no rompe */ }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Un timer suelto tras desmontar el shell (logout) haría setState en un
  // componente que ya no existe.
  useEffect(() => () => { if (peekTimer.current) clearTimeout(peekTimer.current); }, []);

  // Mientras la barra está asomada, el puntero decide cuándo se va: cruzar su
  // frontera programa el cierre, volver dentro lo cancela. Va por posición y no
  // por los boundary events del <aside> (ver PEEK_HIT_X). Sin las helpers de
  // abajo a propósito: recrearse en cada render re-suscribiría el listener.
  useEffect(() => {
    // Con el menú de sesión abierto la barra se queda: si no, el cursor se va a
    // un item, cruza la frontera del peek y la barra desaparece dejando el menú
    // flotando sobre el contenido.
    if (!peek || menuOpen) return;
    const onMove = (e: PointerEvent) => {
      if (e.clientX <= PEEK_HIT_X) {
        if (peekTimer.current) { clearTimeout(peekTimer.current); peekTimer.current = null; }
      } else if (!peekTimer.current) {
        peekTimer.current = setTimeout(() => { peekTimer.current = null; setPeek(false); }, PEEK_CLOSE_MS);
      }
    };
    document.addEventListener("pointermove", onMove);
    return () => document.removeEventListener("pointermove", onMove);
  }, [peek, menuOpen]);

  const clearPeekTimer = () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = null;
  };
  const schedulePeek = (next: boolean, ms: number) => {
    clearPeekTimer();
    peekTimer.current = setTimeout(() => { peekTimer.current = null; setPeek(next); }, ms);
  };

  // Esconder la barra desde su propio header: si estaba anclada la desancla —y
  // guarda la preferencia—, si sólo estaba asomada o en overlay la cierra.
  // Debajo de lg no toca la preferencia: ahí la barra ya es overlay y anclar no
  // aplica, así que esconderla no debería cambiar cómo se ve en desktop.
  function hide() {
    clearPeekTimer();
    setPeek(false);
    setOpen(false);
    if (pinned && window.matchMedia(LG_QUERY).matches) {
      setPinned(false);
      localStorage.setItem(PIN_KEY, "0");
    }
  }

  // Click en la hamburguesa: en desktop fija la barra y guarda la preferencia
  // —el hover ya la muestra, así que el click sólo puede querer decir "quédate"—
  // y en móvil, donde anclar no aplica, abre el overlay de siempre.
  function showSidebar() {
    clearPeekTimer();
    setPeek(false);
    if (window.matchMedia(LG_QUERY).matches) {
      setPinned(true);
      setOpen(false);
      localStorage.setItem(PIN_KEY, "1");
    } else {
      setOpen(true);
    }
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      onLogout();
    } finally { setLoggingOut(false); }
  }

  const close = () => { clearPeekTimer(); setPeek(false); setOpen(false); };

  return (
    <>
      {/* Hamburguesa: visible mientras la barra no esté anclada ni en overlay.
          Sigue ahí con el panel asomado —el `top-16` del panel lo deja libre—,
          así que el click para fijar la barra nunca queda tapado. */}
      {!open && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" onClick={showSidebar}
                    onPointerEnter={(e) => { if (e.pointerType === "mouse") schedulePeek(true, PEEK_OPEN_MS); }}
                    onPointerLeave={clearPeekTimer}
                    aria-label="Abrir menú"
                    className={`fixed top-4 left-4 z-30 bg-card text-muted-foreground hover:text-foreground ${pinned ? "lg:hidden" : ""}`}>
              <Menu className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          {/* A la derecha: el panel asomado arranca en top-16, así que ahí no
              hay nada que tapar ni por qué taparlo. */}
          <TooltipContent side="right">Click para fijar el menú</TooltipContent>
        </Tooltip>
      )}

      {/* Backdrop del modo overlay */}
      {open && (
        <div className="fixed inset-0 z-40 bg-background/70 lg:bg-background/40" onClick={close} aria-hidden />
      )}

      {/* Panel flotante por default (aire arriba y abajo, esquinas derechas
          redondeadas y sombra, pegado al canto izquierdo) y chrome a ras sólo
          cuando está anclada Y hay ancho para anclar: debajo de `lg` la barra se
          comporta como overlay aunque `pinned` sea true, así que la geometría a
          ras se aplica en la variante `lg:` y no según `pinned` a secas — si no,
          en ventanas angostas el panel se pegaba a y=0 y tapaba la hamburguesa.
          `top-16` es aritmética, no gusto: 16px del botón + 36px de su alto
          (size="icon") + 12px de aire. Ese gap fijo es lo que deja la
          hamburguesa clickeable con el panel asomado, y lo cubre el E2E.
          La forma no depende de `peek` para que el asomo mueva sólo el
          deslizamiento: si el margen y el radio aparecieran junto con el asomo,
          la barra cambiaría de forma mientras entra. Al FIJARLA sí cambia de
          forma, y por eso la transición no es sólo del deslizamiento: top,
          bottom, radio y sombra se animan con la misma duración, así crecer a
          pantalla completa y el corrimiento del contenido se leen como un gesto.
          ⚠️ La lista dice `translate` y NO `transform`: en Tailwind v4 las
          utilidades `-translate-x-*` compilan a la propiedad CSS `translate`, no
          a `transform: translateX()`. Con `transform` en la lista la clase se
          genera igual y la barra entraba y salía DE GOLPE (medido por frame:
          -256 → 0 sin valores intermedios).
          overflow-hidden: los bordes del header y del footer llegan al canto y
          sin recorte se verían cruzar las esquinas redondeadas. */}
      <aside aria-label="Navegación" data-tour="shell-sidebar"
             className={`fixed top-16 bottom-4 left-0 z-50 flex w-64 flex-col overflow-hidden rounded-r-xl border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl shadow-black/50 transition-[translate,top,bottom,border-radius,box-shadow] duration-[250ms] ease-out ${
               open || peek ? "translate-x-0" : "-translate-x-full"
             } ${
               pinned
                 ? "lg:top-0 lg:bottom-0 lg:translate-x-0 lg:rounded-none lg:border-y-0 lg:border-l-0 lg:shadow-none"
                 : ""
             }`}>
        {/* Header: logotipo + producto + control de ocultado */}
        <div className="flex items-center gap-2.5 border-b border-sidebar-border py-3 pl-4 pr-3">
          <Link href="/" onClick={close} aria-label="Ir al menú principal"
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-blue font-display text-xs font-extrabold tracking-tight text-white">
            iU
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight text-foreground">iU Corp</p>
            <p className="truncate text-[11px] leading-tight text-muted-foreground">iU Notion Reports</p>
          </div>
          {/* Un solo control, no dos: desde la vista del usuario "desanclar" y
              "cerrar" hacían lo mismo —la barra se va— y el par anclaje/cierre
              obligaba a distinguir dos estados que sólo existen en el código.
              Vuelve con la hamburguesa. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={hide} aria-label="Ocultar menú"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Ocultar menú</TooltipContent>
          </Tooltip>
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

        {/* Footer de sesión: identidad + menú. modal={false} por el mismo motivo
            que AppModal: el default de Radix vuelve inert todo lo de afuera, y
            con la barra asomada eso deja el resto del shell muerto mientras el
            menú está abierto. */}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <DropdownMenuTrigger asChild>
            <button aria-label="Menú de sesión"
                    className="flex w-full items-center gap-2.5 border-t border-sidebar-border px-4 py-2.5 text-left transition hover:bg-card">
              {/* Iniciales en vez de la foto de Google: la imagen vive en
                  lh3.googleusercontent.com, lo que obliga a declarar
                  images.remotePatterns y dispara una petición externa en cada
                  carga. El nombre cae al correo cuando Google no manda `name`. */}
              <span aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
                {initials(user?.name ?? user?.email ?? "")}
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-xs text-sidebar-foreground">{user?.name ?? "Sesión activa"}</span>
                {user?.email && <span className="truncate text-[10.5px] text-subtle">{user.email}</span>}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[15.5rem]">
            <DropdownMenuItem onSelect={() => setSettings("cuenta")}>
              <Settings className="h-4 w-4" />
              Configuración
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSettings("acerca")}>
              <HelpCircle className="h-4 w-4" />
              Ayuda
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={logout} disabled={loggingOut}>
              {loggingOut ? <Spinner className="h-3.5 w-3.5" /> : <LogOut className="h-4 w-4" />}
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </aside>

      {/* --shell-top: aire para la hamburguesa. Sale de globals.css y no de un
          `pt-12` literal porque las páginas que llenan el viewport tienen que
          restar exactamente este valor a 100dvh (si no, la página mide
          100dvh + este padding y el documento entero scrollea).
          Fijo y NO condicionado a `pinned`: con `lg:pt-0` el contenido subía
          48px al anclar y bajaba al ocultar, un salto vertical en una acción que
          sólo debería correrlo a la derecha. La transición acompaña al pl-64
          para que ese corrimiento no sea un brinco; misma duración que la de la
          barra, así se leen como un gesto. */}
      <div className={`pt-[var(--shell-top)] transition-[padding] duration-[250ms] ease-out ${pinned ? "lg:pl-64" : ""}`}>
        {tour && (
          <TourLayer tour={tour} justLoggedIn={justLoggedIn}
                     shellActions={{ openSidebar: () => setOpen(true), closeSidebar: () => setOpen(false) }} />
        )}
        {settings && (
          <SettingsModal section={settings} onSection={setSettings}
                         onClose={() => setSettings(null)}
                         user={user} role={role} meta={meta} />
        )}
        {children}
      </div>
    </>
  );
}
