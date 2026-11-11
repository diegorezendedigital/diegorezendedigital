import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Diego Rezende Digital — Assessoria Marketplace",
  description: "Centralize seus produtos, calcule taxas de cada marketplace e acompanhe o lucro real das suas vendas.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
