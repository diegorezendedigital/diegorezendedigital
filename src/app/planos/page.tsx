"use client";

import { useState } from "react";
import Link from "next/link";

const campo =
  "w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-gold/30";

const precoMensal = process.env.NEXT_PUBLIC_PRECO_MENSAL || "A definir";
const precoAnual = process.env.NEXT_PUBLIC_PRECO_ANUAL || "A definir";

const recursos = [
  "Conexão com Mercado Livre, Shopee e TikTok Shop",
  "Margem real por produto e por venda",
  "Pedidos e relatórios consolidados",
  "Promoções automáticas respeitando a sua margem",
  "Calculadora completa com produtos cadastrados",
];

export default function PlanosPage() {
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState<"" | "mensal" | "anual">("");

  async function assinar(plano: "mensal" | "anual") {
    setErro("");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setErro("Informe o e-mail que você vai usar na conta.");
      return;
    }
    setCarregando(plano);
    const r = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plano, email: email.trim() }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) {
      setErro(j.error ?? "Não foi possível abrir o pagamento. Tente de novo.");
      setCarregando("");
      return;
    }
    window.location.href = j.url;
  }

  return (
    <main className="min-h-screen bg-paper font-body text-ink antialiased">
      <header className="border-b border-line">
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight">
            Diego Rezende <span className="text-gold">Digital</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/calculadora-gratis" className="hover:text-gold transition-colors">Calculadora grátis</Link>
            <Link href="/login" className="rounded-full border border-ink px-4 py-2 hover:bg-ink hover:text-paper transition-colors">Entrar</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-16">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-clay mb-4">Planos</p>
        <h1 className="font-display text-4xl md:text-5xl font-semibold leading-[1.05] tracking-tight">
          Assine para criar a sua conta.
        </h1>
        <p className="mt-4 max-w-xl text-ink/70 leading-relaxed">
          Depois do pagamento você volta aqui e cria o acesso com o mesmo e-mail. A calculadora gratuita continua aberta para todos.
        </p>

        <div className="mt-8 max-w-sm">
          <label htmlFor="email" className="mb-1 block font-mono text-xs uppercase tracking-widest text-clay">Seu e-mail</label>
          <input id="email" type="email" className={campo} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" />
          {erro && <p className="mt-2 text-sm text-red-700">{erro}</p>}
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <Plano nome="Mensal" preco={precoMensal} sufixo="/mês" carregando={carregando === "mensal"} onClick={() => assinar("mensal")} />
          <Plano nome="Anual" preco={precoAnual} sufixo="/ano" destaque="Melhor preço" carregando={carregando === "anual"} onClick={() => assinar("anual")} />
        </div>

        <ul className="mt-10 grid gap-2 text-sm text-ink/80 md:grid-cols-2">
          {recursos.map((r) => (
            <li key={r} className="flex gap-2"><span className="text-gold">✓</span>{r}</li>
          ))}
        </ul>
        <p className="mt-8 text-sm text-ink/60">
          Já assinou? <Link href="/signup" className="font-medium text-ink underline underline-offset-4">Criar minha conta</Link>
        </p>
      </section>
    </main>
  );
}

function Plano({ nome, preco, sufixo, destaque, carregando, onClick }: {
  nome: string; preco: string; sufixo: string; destaque?: string; carregando: boolean; onClick: () => void;
}) {
  return (
    <div className={`rounded-2xl border bg-white p-6 ${destaque ? "border-ink" : "border-line"}`}>
      <div className="flex items-center justify-between">
        <p className="font-display text-xl font-medium">{nome}</p>
        {destaque && <span className="rounded-full bg-gold px-3 py-1 text-xs font-medium text-inkdeep">{destaque}</span>}
      </div>
      <p className="mt-4 font-display text-4xl font-semibold">
        {preco} <span className="text-base font-normal text-ink/50">{sufixo}</span>
      </p>
      <button
        onClick={onClick}
        disabled={carregando}
        className="mt-6 w-full rounded-full bg-ink px-4 py-3 text-sm font-medium text-paper hover:bg-inkdeep transition-colors disabled:opacity-60"
      >
        {carregando ? "Abrindo pagamento…" : `Assinar ${nome.toLowerCase()}`}
      </button>
    </div>
  );
}
