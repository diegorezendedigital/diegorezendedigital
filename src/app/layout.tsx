import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Margem Certa",
  description: "Saiba o lucro real de cada venda nos marketplaces.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
