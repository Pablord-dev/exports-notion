"use client";
// Renderiza markdown (respuestas del asistente) con estilos del brandbook.
// Se estiliza vía variantes arbitrarias de Tailwind sobre el contenedor para
// no tener que pasar componentes por elemento (evita el prop `node`).
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const CLS = [
  "text-sm leading-relaxed text-fg break-words",
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_a]:text-sky [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:brightness-110",
  "[&_strong]:font-semibold [&_strong]:text-fg [&_em]:italic",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1",
  "[&_li]:my-0.5",
  "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:font-display [&_h1]:text-lg [&_h1]:font-bold",
  "[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:font-display [&_h2]:text-base [&_h2]:font-bold",
  "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-display [&_h3]:text-sm [&_h3]:font-bold",
  "[&_code]:rounded [&_code]:bg-dark-blue [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-sky",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-dark-blue [&_pre]:p-3 [&_pre]:text-xs",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-fg",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted",
  "[&_table]:my-2 [&_table]:block [&_table]:w-max [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-xs",
  "[&_th]:border [&_th]:border-border [&_th]:bg-surface [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
  "[&_hr]:my-3 [&_hr]:border-border",
].join(" ");

export function MarkdownMessage({ children }: { children: string }) {
  return (
    <div className={CLS}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
