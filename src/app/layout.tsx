import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ExportNotion",
  description: "Exportar datos de Notion a CSV",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
