"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// Ajustes al Tooltip de shadcn, no la copia literal:
// - Superficie del sistema (bg-popover + border-border-strong + sombra) en vez
//   del `bg-primary` del default: sobre este tema oscuro el azul saturado
//   compite con los botones de acción, que son justamente lo que el tooltip
//   está explicando.
// - Sin flecha: con un tooltip que sí tiene borde, el cuadrado rotado de la
//   flecha corta el contorno y se ven sus propios lados. Para etiquetas de
//   iconos no hace falta apuntar.
// - `delayDuration` 300ms por default: un tooltip instantáneo dispara al pasar
//   el cursor de largo camino a otra cosa.
const TOOLTIP_DELAY_MS = 300

function TooltipProvider({
  delayDuration = TOOLTIP_DELAY_MS,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

// Cada Tooltip trae su Provider: así un botón suelto no depende de que alguien
// haya envuelto el árbol más arriba.
function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit max-w-64 origin-(--radix-tooltip-content-transform-origin) rounded-lg border border-border-strong bg-popover px-2.5 py-1.5 text-[12px] leading-snug text-balance text-foreground shadow-lg shadow-black/40",
          "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
          className
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
