import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MargemCerta — Gestão de lucro para marketplaces",
  description: "Centralize seus produtos, calcule taxas de cada marketplace e acompanhe o lucro real das suas vendas.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
