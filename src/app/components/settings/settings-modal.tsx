"use client";
// Panel de configuración: modal grande centrado con secciones a la izquierda.
//
// NO reúsa AppModal a propósito. Ese es deliberadamente no-modal (modal={false})
// y está anclado a top-16 porque el onboarding guiado necesita clickear su
// popover con el modal abierto. Acá se quiere lo contrario —grande y centrado— y
// no hay tour con el que convivir.
import { Info, User, Users } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UsersSection } from "@/app/components/settings/users-section";
import { canManageUsers, type Role } from "@/lib/authz";
import type { SessionUser } from "@/lib/session";
import type { CacheMeta } from "@/lib/types";

export type SectionId = "cuenta" | "usuarios" | "acerca";

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
  { id: "cuenta", label: "Cuenta", icon: <User className="h-4 w-4 shrink-0" /> },
  { id: "usuarios", label: "Usuarios", icon: <Users className="h-4 w-4 shrink-0" />, adminOnly: true },
  { id: "acerca", label: "Acerca de", icon: <Info className="h-4 w-4 shrink-0" /> },
];

const ROLE_LABEL: Record<Role, string> = { admin: "Administrador", viewer: "Lectura" };

function fmtFecha(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

export function SettingsModal({ section, onSection, onClose, user, role, meta }: {
  section: SectionId;
  onSection: (s: SectionId) => void;
  onClose: () => void;
  user: SessionUser | null;
  role: Role;
  meta: CacheMeta | null;
}) {
  const visible = SECTIONS.filter((s) => !s.adminOnly || canManageUsers(role));
  // El rol llega por fetch y puede cambiar bajo los pies (una degradación en
  // otra pestaña): si la sección activa deja de existir, cae a la primera en vez
  // de dejar el panel en blanco.
  const active = visible.some((s) => s.id === section) ? section : visible[0].id;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* aria-describedby en undefined: el panel no tiene bajada y sin esto
          Radix avisa por consola en cada apertura. */}
      <DialogContent aria-describedby={undefined}
                     className="grid-rows-[auto_1fr] gap-0 overflow-hidden p-0 sm:max-w-5xl"
                     style={{ height: "min(760px, 88vh)" }}>
        <DialogHeader className="border-b border-border px-5 py-3.5">
          <DialogTitle className="font-display text-base font-semibold">Configuración</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-col sm:flex-row">
          {/* Nav: columna en desktop, tira horizontal abajo de sm */}
          <nav aria-label="Secciones"
               className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 sm:w-[11.5rem] sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r">
            {visible.map((s) => (
              <button key={s.id} onClick={() => onSection(s.id)}
                      aria-current={active === s.id ? "page" : undefined}
                      className={`flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] transition ${
                        active === s.id
                          ? "bg-accent font-medium text-foreground"
                          : "text-muted-foreground hover:bg-card hover:text-foreground"
                      }`}>
                {s.icon}
                {s.label}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            {active === "cuenta" && <Cuenta user={user} role={role} />}
            {active === "usuarios" && <UsersSection meEmail={user?.email ?? ""} />}
            {active === "acerca" && <Acerca meta={meta} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Cuenta({ user, role }: { user: SessionUser | null; role: Role }) {
  return (
    <section className="space-y-5">
      <h2 className="font-display text-[15px] font-semibold text-foreground">Cuenta</h2>
      <div className="flex items-center gap-3">
        <span aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
          {(user?.name ?? user?.email ?? "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("")}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{user?.name ?? "Sesión activa"}</p>
          <p className="truncate text-[12.5px] text-muted-foreground">{user?.email}</p>
        </div>
      </div>
      <dl className="space-y-2 border-t border-border pt-4 text-[13px]">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Permisos</dt>
          <dd className="font-medium text-foreground">{ROLE_LABEL[role]}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Ingreso</dt>
          <dd className="text-foreground">Google · cuenta institucional</dd>
        </div>
      </dl>
      <div className="rounded-xl border border-dashed border-border p-4">
        <p className="text-[13px] font-medium text-muted-foreground">Preferencias personales</p>
        <p className="mt-1 text-[12.5px] text-subtle">
          Próximamente: idioma, formato de fecha y qué reporte abrir primero.
        </p>
      </div>
    </section>
  );
}

function Acerca({ meta }: { meta: CacheMeta | null }) {
  const ultimo = meta?.lastIncrementalAt ?? meta?.lastFullAt ?? null;
  return (
    <section className="space-y-4">
      <h2 className="font-display text-[15px] font-semibold text-foreground">Acerca de</h2>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">iU Notion Reports</span> sirve reportes y
        exportaciones a partir de una copia de las bases de Notion de iU Corp. Las consultas no
        salen a Notion en vivo: leen esa copia, que se actualiza sola todos los días.
      </p>
      <dl className="space-y-2 border-t border-border pt-4 text-[13px]">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Última actualización</dt>
          <dd className="text-foreground">{fmtFecha(ultimo)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Registros</dt>
          <dd className="text-foreground tabular-nums">{(meta?.count ?? 0).toLocaleString("es-MX")}</dd>
        </div>
      </dl>
      <p className="text-[12.5px] text-subtle">
        ¿Algo no cuadra? Escribile a quien administra la herramienta antes de rehacer un reporte a mano.
      </p>
    </section>
  );
}
