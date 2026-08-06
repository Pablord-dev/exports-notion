"use client";
// Modal NO bloqueante sobre Radix Dialog con modal={false}: el onboarding
// guiado necesita clickear su popover con un modal abierto, y un Dialog modal
// vuelve inert todo lo de afuera. En modo no-modal Radix no monta el Overlay,
// así que el backdrop es propio; el click fuera cierra por el
// onPointerDownOutside default de Radix y Esc por su listener de documento.
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function AppModal({ open, onClose, title, anchor, wide, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** valor para data-tour en el contenido (ancla del onboarding) */
  anchor?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  if (!open) return null; // el backdrop propio no debe quedar montado cerrado
  return (
    <>
      <div className="fixed inset-0 z-40 bg-background/80" aria-hidden />
      <Dialog open modal={false} onOpenChange={(o) => { if (!o) onClose(); }}>
        {/* Convivencia con el tour (verificado empíricamente 2026-07-29):
            - onFocusOutside prevenido: el popover del tour enfoca su botón al
              montar y un Dialog no-modal se cierra por focus-outside.
            - onOpenAutoFocus prevenido: robar el foco al abrir provoca el mismo
              ping-pong en sentido contrario.
            - onPointerDownOutside: el dismiss de Radix se despacha DESPUÉS del
              click, cuando el tour ya avanzó de paso y abrió el modal
              siguiente — su onClose pisaría ese setModal y el paso se saltaría.
              Con el tour activo (o si el pointerdown nació en su popover, que
              puede estar ya desmontado) los modals los maneja el guión
              before/after; sin tour, el click fuera cierra normal.
            - top-10 en vez del centrado default: con el modal centrado, el
              globo del tour (que se coloca debajo del ancla) sale del viewport
              y sus botones quedan inalcanzables. */}
        <DialogContent data-tour={anchor}
                       onOpenAutoFocus={(e) => e.preventDefault()}
                       onFocusOutside={(e) => e.preventDefault()}
                       onPointerDownOutside={(e) => {
                         const target = e.target as HTMLElement | null;
                         if (target?.closest?.('[data-testid="tour-popover"]')
                             || document.querySelector('[data-testid="tour-popover"]')) {
                           e.preventDefault();
                         }
                       }}
                       className={`top-10 translate-y-0 ${wide ? "max-h-[85vh] overflow-y-auto sm:max-w-4xl" : "sm:max-w-lg"}`}>
          <DialogHeader>
            <DialogTitle className="font-display text-base font-semibold">{title}</DialogTitle>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    </>
  );
}
