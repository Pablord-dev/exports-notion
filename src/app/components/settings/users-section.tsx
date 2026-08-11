"use client";
// Tabla de usuarios: quién entró, con qué rol, y las dos acciones que hay.
// Después de cada acción la lista se refetchea entera en vez de mutar el estado
// local: son decenas de filas y la simplicidad vale más que el ahorro.
import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Spinner } from "@/app/components/spinner";
import { normalizeEmail, type Role } from "@/lib/authz";
import type { UserRow } from "@/lib/store-shared";

function fmtAcceso(iso: string | null): string {
  if (!iso) return "nunca";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

export function UsersSection({ meEmail }: { meEmail: string }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const yo = normalizeEmail(meEmail);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/users");
      if (!r.ok) { setError("No se pudo cargar la lista."); return; }
      setUsers((await r.json()).users as UserRow[]);
      setError(null);
    } catch {
      setError("No se pudo cargar la lista.");
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function cambiarRol(email: string, role: Role) {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      if (!r.ok) { setError("No se pudo cambiar el rol."); return; }
      setError(null);
      await load();
    } finally { setBusy(false); }
  }

  async function borrar(email: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/users?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      if (!r.ok) { setError("No se pudo borrar el usuario."); return; }
      setError(null);
      setConfirming(null);
      await load();
    } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-[15px] font-semibold text-foreground">Usuarios</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Quienes entraron alguna vez. Un administrador puede reconstruir el snapshot completo;
          lectura alcanza para reportes, exportación y el Asistente.
        </p>
      </div>

      {error && <p role="alert" className="text-[13px] font-medium text-danger">{error}</p>}

      {users === null ? (
        <div className="flex items-center gap-2 py-6 text-muted-foreground">
          <Spinner className="h-4 w-4 text-sky" />
          <span className="text-[13px]">Cargando…</span>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {users.map((u) => {
            const propio = normalizeEmail(u.email) === yo;
            const enConfirmacion = confirming === u.email;
            return (
              <li key={u.email} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {u.name ?? u.email}
                    {propio && <span className="ml-1.5 text-[11.5px] font-normal text-subtle">(vos)</span>}
                  </p>
                  <p className="truncate text-[11.5px] text-muted-foreground">{u.email}</p>
                </div>

                {enConfirmacion ? (
                  // Confirmación en la propia fila y no en un segundo diálogo: un
                  // Dialog de Radix anidado dentro de otro trae problemas de foco
                  // que no valen la pena por una confirmación de una línea.
                  <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
                    <p className="text-[12px] text-muted-foreground">
                      Se le quita el rol y sale de la lista. <span className="text-subtle">No pierde el acceso: vuelve como lectura si entra de nuevo.</span>
                    </p>
                    <Button size="sm" variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
                      Cancelar
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => borrar(u.email)} disabled={busy}>
                      Borrar
                    </Button>
                  </div>
                ) : (
                  <>
                    <span className="w-[6.5rem] shrink-0 text-right text-[11.5px] text-subtle">
                      {fmtAcceso(u.lastLoginAt)}
                    </span>

                    {/* ⚠️ La fila propia va vedada con aria-disabled y SIN onClick,
                        no con `disabled`: un control deshabilitado no emite
                        eventos de puntero y el tooltip que explica el veto nunca
                        aparecería. Se muestra en vez de ocultarse porque el
                        control existe en todas las demás filas. */}
                    {propio ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="outline" size="sm" aria-disabled="true"
                                  className="w-[7.5rem] shrink-0 justify-start opacity-60">
                            {u.role === "admin" ? "Administrador" : "Lectura"}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>No podés cambiar tu propio rol</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Select value={u.role} disabled={busy}
                              onValueChange={(v) => cambiarRol(u.email, v as Role)}>
                        <SelectTrigger size="sm" className="w-[7.5rem] shrink-0"
                                       aria-label={`Rol de ${u.name ?? u.email}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="viewer">Lectura</SelectItem>
                        </SelectContent>
                      </Select>
                    )}

                    {propio ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" aria-disabled="true"
                                  aria-label={`Borrar a ${u.name ?? u.email}`}
                                  className="h-8 w-8 shrink-0 text-muted-foreground opacity-60">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>No podés borrar tu propio usuario</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button variant="ghost" size="icon" disabled={busy}
                              onClick={() => setConfirming(u.email)}
                              aria-label={`Borrar a ${u.name ?? u.email}`}
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-danger">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
