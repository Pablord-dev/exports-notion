import Link from "next/link";

// Breadcrumb de navegación: los items con href son clickeables; el último
// (la página actual) va sin href y se muestra en color de texto normal.
export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-muted-foreground/60">/</span>}
          {it.href ? (
            <Link href={it.href} className="transition hover:text-sky">{it.label}</Link>
          ) : (
            <span className="text-foreground">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
