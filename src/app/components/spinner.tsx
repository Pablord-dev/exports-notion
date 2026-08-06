import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Mismo API del Spinner previo: los callsites pasan tamaño/color por className.
export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn("h-4 w-4 animate-spin", className)} />;
}
