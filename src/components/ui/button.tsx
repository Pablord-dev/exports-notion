import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// ⚠️ Sin utilidades `dark:` a propósito. El tema de esta app es dark fijo por
// :root, y no hay clase .dark ni @custom-variant, así que en Tailwind v4 un
// `dark:` es @media (prefers-color-scheme: dark): las variantes de shadcn
// (`dark:bg-input/30`, `dark:hover:bg-accent/50`) se aplicaban sólo para quien
// tuviera el SO en oscuro, ganaban por orden de hoja sobre el `bg-card` del
// callsite y dejaban los botones flotantes translúcidos —el contenido se veía
// pasar por debajo del ☰ y del popover del tour—. Medido: alpha 0.3/0.5 con el
// SO oscuro contra opaco con el SO claro (tests/e2e/smoke.spec.ts cubre que las
// dos preferencias midan igual).
//
// Los rellenos opacos salen de la paleta, no de un ojo: `--secondary`/`--accent`
// (#0c2452) es la "superficie raised" del sistema y coincide con lo que
// componía el bg-input/30 translúcido sobre una tarjeta (rgb(12,36,77)), así
// que el aspecto no cambia; el hover sube a `--input` para que se note.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // El hover NO baja la opacidad como en el default de shadcn
        // (`hover:bg-primary/90`): sobre un fondo oscuro eso mezcla el azul con
        // el lienzo y lo APAGA, así que el hover iba en la dirección contraria a
        // la que debería —destacar—. Se aclara un poco y gana un halo pegado al
        // borde. Sin `ring-offset`: ese offset es lo que despegaba el anillo del
        // botón y hacía el efecto aparatoso.
        default: "bg-primary text-primary-foreground hover:brightness-110 hover:ring-2 hover:ring-blue/30",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40",
        outline:
          "border border-input bg-secondary shadow-xs hover:bg-input hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
