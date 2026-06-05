import type { Metadata } from "next";
import { Raleway, Poppins } from "next/font/google";
import "./globals.css";

// Tipografía principal iU Corp — títulos, encabezados, alto impacto.
const raleway = Raleway({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-raleway",
  display: "swap",
  fallback: ["Lato", "Arial", "sans-serif"],
});

// Tipografía secundaria iU Corp — cuerpo, formularios, apoyo.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
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
