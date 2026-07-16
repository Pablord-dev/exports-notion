import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Única familia tipográfica (decisión 2026-07-16: minimalista, reemplaza el
// par Raleway/Poppins del brandbook). Variable font: cubre todos los pesos.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  fallback: ["system-ui", "Arial", "sans-serif"],
});

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
    <html lang="es" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
