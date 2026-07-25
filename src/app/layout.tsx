import type { Metadata } from "next";
import { Raleway, Poppins } from "next/font/google";
import "./globals.css";

// Par tipográfico del brandbook iU: Raleway (display: títulos y logotipo,
// 700/800) + Poppins (sans: cuerpo, navegación y botones, 400/500/600).
// Respaldo: Lato → Arial. Los datos técnicos van en monoespaciada.
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
    <html lang="es" className={`${raleway.variable} ${poppins.variable}`}>
      <body>{children}</body>
    </html>
  );
}
