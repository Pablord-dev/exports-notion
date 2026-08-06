import type { Metadata } from "next";
import { Raleway, Poppins, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Trío tipográfico: Raleway (display: títulos y logotipo, 700/800) +
// Poppins (sans: cuerpo, navegación y botones, 400/500/600) +
// JetBrains Mono (cifras tabulares y datos técnicos, 400/500).
// Respaldo: Lato → Arial.
const raleway = Raleway({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-raleway",
  display: "swap",
  fallback: ["Lato", "Arial", "sans-serif"],
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-poppins",
  display: "swap",
  fallback: ["Lato", "Arial", "sans-serif"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
  fallback: ["Consolas", "monospace"],
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
    <html lang="es" className={`${raleway.variable} ${poppins.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
