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
        <DialogContent data-tour={anchor}
                       className={wide ? "max-h-[85vh] overflow-y-auto sm:max-w-4xl" : "sm:max-w-lg"}>
          <DialogHeader>
            <DialogTitle className="font-display text-base font-semibold">{title}</DialogTitle>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    </>
  );
}
