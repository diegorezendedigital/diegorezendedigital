"use client";

import { useState } from "react";
import Link from "next/link";
import RodapeLegal from "@/components/RodapeLegal";
import CalculadoraCanal from "@/components/CalculadoraCanal";
import { CANAIS, CanalId } from "@/lib/taxas-publicas";

export default function CalculadoraGratisPage() {
  const [canalId, setCanalId] = useState<CanalId>("tiktok_shop");

  return (
    <main className="min-h-screen bg-paper font-body text-ink antialiased">
      <header className="border-b border-line">
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight">
            Diego Rezende <span className="text-gold">Digital</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/login" className="rounded-full border border-ink px-4 py-2 hover:bg-ink hover:text-paper transition-colors">
              Entrar
            </Link>

          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-12 pb-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-clay mb-4">Calculadora gratuita</p>
        <h1 className="font-display text-4xl md:text-5xl font-semibold leading-[1.05] tracking-tight">
          Quanto sobra de verdade em cada venda?
        </h1>
        <p className="mt-4 max-w-xl text-lg text-ink/70 leading-relaxed">
          Mercado Livre, Shopee e TikTok Shop, com as taxas de cada canal, anúncios e afiliado. Sem cadastro, sem login.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Marketplace">
          {CANAIS.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={c.id === canalId}
              onClick={() => setCanalId(c.id)}
              className={`rounded-full px-5 py-2.5 text-sm font-medium transition-colors ${
                c.id === canalId ? "bg-ink text-paper" : "border border-line bg-white hover:border-ink"
              }`}
            >
              {c.nome}
            </button>
          ))}
        </div>
        <CalculadoraCanal key={canalId} canal={canalId} publico />
        <p className="mt-4 text-xs text-ink/50">Taxas de referência, sujeitas a mudança pelos marketplaces. Confira sempre na sua central do vendedor.</p>
      </section>

      <section className="border-t border-line bg-inkdeep text-paper">
        <div className="mx-auto max-w-6xl px-6 py-16 text-center">
          <h2 className="font-display text-3xl font-semibold mb-3">Quer controlar o catálogo inteiro?</h2>
          <p className="mx-auto mb-8 max-w-xl text-paper/70">
            Conexão das suas lojas, pedidos, margem real de cada venda e promoções automáticas.
          </p>
          <Link href="/login" className="inline-block rounded-full bg-gold px-8 py-4 font-medium text-inkdeep hover:bg-goldlight transition-colors">
            Já tenho conta
          </Link>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-sm text-ink/50">
        © {new Date().getFullYear()} Diego Rezende Digital · Conteúdo gratuito para e-commerce. Valores de referência, sujeitos a mudança pelos marketplaces.
        <RodapeLegal />
      </footer>
    </main>
  );
}

function Linha({ t, v }: { t: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-paper/60">{t}</span>
      <span>{v}</span>
    </div>
  );
}
