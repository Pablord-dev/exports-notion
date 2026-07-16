"use client";
// Shell de las páginas autenticadas: sidebar de navegación anclable/ocultable.
// - Anclada (default en desktop): fija a la izquierda, el contenido se corre.
// - Oculta: botón hamburguesa fijo que la abre como overlay (cierra con Esc,
//   backdrop o al navegar). La preferencia persiste en localStorage.
// En móvil (<lg) siempre se comporta como overlay: anclar no aplica.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DATABASES } from "@/lib/databases";
import { Spinner } from "@/app/components/spinner";

const PIN_KEY = "sidebar-pinned";

function NavLink({ href, label, onNavigate }: { href: string; label: string; onNavigate: () => void }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link href={href} onClick={onNavigate}
          className={`block rounded-lg px-3 py-2 text-sm transition ${
            active ? "bg-dark-blue font-medium text-fg" : "text-muted hover:bg-dark-blue/60 hover:text-fg"
          }`}>
      {label}
    </Link>
  );
}

export function AppShell({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const [pinned, setPinned] = useState(true);
  const [open, setOpen] = useState(false);
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
        <button onClick={() => setOpen(true)} aria-label="Abrir menú"
                className={`fixed top-4 left-4 z-30 rounded-lg border border-border bg-surface p-2 text-muted transition hover:border-blue hover:text-blue ${pinned ? "lg:hidden" : ""}`}>
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}

      {/* Backdrop del modo overlay */}
      {open && (
        <div className="fixed inset-0 z-40 bg-dark-blue/70 lg:bg-dark-blue/40" onClick={close} aria-hidden />
      )}

      <aside aria-label="Navegación"
             className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-surface transition-transform duration-200 ${
               open ? "translate-x-0" : "-translate-x-full"
             } ${pinned ? "lg:translate-x-0" : ""}`}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <Link href="/" onClick={close} className="font-display text-base font-bold tracking-tight text-fg">
            ExportNotion
          </Link>
          <div className="flex items-center gap-1">
            {/* Anclar/desanclar: solo tiene sentido en desktop */}
            <button onClick={togglePin} aria-label={pinned ? "Desanclar menú" : "Anclar menú"}
                    title={pinned ? "Desanclar" : "Anclar"}
                    className={`hidden rounded-lg p-1.5 transition hover:text-blue lg:block ${pinned ? "text-sky" : "text-muted"}`}>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 17v5M9 4h6l1 7 2.5 2.5H5.5L8 11l1-7z" />
              </svg>
            </button>
            {/* Cerrar el overlay */}
            <button onClick={close} aria-label="Cerrar menú"
                    className={`rounded-lg p-1.5 text-muted transition hover:text-blue ${pinned ? "lg:hidden" : ""}`}>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto p-4">
          <NavLink href="/" label="Menú principal" onNavigate={close} />
          {DATABASES.map((db) => (
            <div key={db.slug} className="space-y-1">
              <p className="px-3 text-xs uppercase tracking-wide text-muted">{db.name}</p>
              <NavLink href={`/db/${db.slug}/reports`} label="Reportes" onNavigate={close} />
              <NavLink href={`/db/${db.slug}`} label="Exportar y sincronizar" onNavigate={close} />
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-4">
          <button onClick={logout} disabled={loggingOut}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted transition hover:border-blue hover:text-blue disabled:cursor-not-allowed disabled:opacity-60">
            {loggingOut && <Spinner className="h-3.5 w-3.5" />}
            {loggingOut ? "Saliendo…" : "Cerrar sesión"}
          </button>
        </div>
      </aside>

      {/* pt-12: aire para la hamburguesa cuando está visible (móvil siempre;
          desktop solo con la sidebar oculta) */}
      <div className={pinned ? "pt-12 lg:pl-60 lg:pt-0" : "pt-12"}>{children}</div>
    </>
  );
}
