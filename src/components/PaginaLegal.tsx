import Link from "next/link";
import type { ReactNode } from "react";

export default function PaginaLegal({ titulo, atualizado, children }: { titulo: string; atualizado: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-slate-800">
      <Link href="/" className="text-sm text-slate-500 hover:underline">
        Diego Rezende Digital
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">{titulo}</h1>
      <p className="mt-1 text-sm text-slate-500">Última atualização: {atualizado}</p>
      <div className="mt-8 space-y-4 leading-relaxed [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1">{children}</div>
    </main>
  );
}
