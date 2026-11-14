import Link from "next/link";

const marketplaces = [
  { nome: "Mercado Livre", taxa: "10% a 14% + taxa fixa abaixo de R$ 79" },
  { nome: "Shopee", taxa: "14% a 20% + R$ 4,50 a R$ 26 por item" },
  { nome: "TikTok Shop", taxa: "6% a 10% + R$ 4 a R$ 6 por item" },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-paper font-body text-ink antialiased">
      {/* Header */}
      <header className="border-b border-line">
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
          <span className="font-display text-xl font-semibold tracking-tight">
            Diego Rezende <span className="text-gold">Digital</span>
          </span>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="#como-funciona" className="hover:text-gold transition-colors">
              Como funciona
            </Link>
            <Link href="#marketplaces" className="hover:text-gold transition-colors">
              Marketplaces
            </Link>
            <Link href="/calculadora-gratis" className="hover:text-gold transition-colors">
              Calculadora grátis
            </Link>
            <Link
              href="/login"
              className="rounded-full border border-ink px-4 py-2 hover:bg-ink hover:text-paper transition-colors"
            >
              Entrar
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-24">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-clay mb-6">
              Gestão de lucro para quem vende em marketplace
            </p>
            <h1 className="font-display text-5xl md:text-6xl font-semibold leading-[1.05] tracking-tight">
              Cada venda tem um preço.
              <br />
              Poucas têm <span className="text-gold">margem real.</span>
            </h1>
            <p className="mt-6 text-lg text-ink/70 max-w-md leading-relaxed">
              Conecte suas lojas, cadastre seus produtos e descubra, taxa por taxa, quanto sobra de verdade em cada
              marketplace.
            </p>
            <div className="mt-10 flex items-center gap-4">
              <Link
                href="/calculadora-gratis"
                className="rounded-full bg-ink text-paper px-7 py-3.5 font-medium hover:bg-inkdeep transition-colors"
              >
                Usar a calculadora grátis
              </Link>
              <Link
                href="/login"
                className="text-ink/70 hover:text-ink underline underline-offset-4 decoration-line"
              >
                Já tenho conta
              </Link>
            </div>
          </div>

          <div className="bg-inkdeep text-paper rounded-2xl p-8 font-mono text-sm shadow-xl">
            <p className="text-goldlight text-xs uppercase tracking-widest mb-6">Exemplo — Tênis Runner Pro</p>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-paper/60">Preço de venda</span>
                <span>R$ 199,90</span>
              </div>
              <div className="flex justify-between">
                <span className="text-paper/60">Custo do produto</span>
                <span>− R$ 89,00</span>
              </div>
              <div className="flex justify-between">
                <span className="text-paper/60">Comissão Mercado Livre (14%)</span>
                <span>− R$ 27,99</span>
              </div>
              <div className="flex justify-between">
                <span className="text-paper/60">Taxa fixa (acima de R$ 79)</span>
                <span>− R$ 0,00</span>
              </div>
            </div>
            <div className="receipt-tick my-6" />
            <div className="flex justify-between items-baseline">
              <span className="text-goldlight uppercase text-xs tracking-widest">Lucro real</span>
              <span className="text-2xl text-goldlight font-semibold">R$ 82,91</span>
            </div>
            <p className="text-paper/40 text-xs mt-2">41,5% de margem líquida</p>
          </div>
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="border-t border-line bg-white/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-display text-3xl font-semibold mb-12">Três telas. Uma resposta.</h2>
          <div className="grid md:grid-cols-3 gap-10">
            <div>
              <p className="font-mono text-clay text-sm mb-3">Produtos</p>
              <h3 className="font-display text-xl font-medium mb-2">Custo e preço lado a lado</h3>
              <p className="text-ink/70 leading-relaxed">
                Cadastre cada item com seu custo real e o preço praticado em cada marketplace.
              </p>
            </div>
            <div>
              <p className="font-mono text-clay text-sm mb-3">Calculadora</p>
              <h3 className="font-display text-xl font-medium mb-2">Taxas por marketplace</h3>
              <p className="text-ink/70 leading-relaxed">
                Simule qualquer venda e veja exatamente quanto cada canal desconta antes de você decidir o preço.
              </p>
            </div>
            <div>
              <p className="font-mono text-clay text-sm mb-3">Relatórios</p>
              <h3 className="font-display text-xl font-medium mb-2">Lucro consolidado</h3>
              <p className="text-ink/70 leading-relaxed">
                Acompanhe o lucro real de todas as suas vendas, por produto e por canal.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Marketplaces */}
      <section id="marketplaces" className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-display text-3xl font-semibold mb-2">Os 3 marketplaces que atendemos</h2>
          <p className="text-ink/60 mb-10">Taxas de referência prontas — ajuste conforme sua categoria.</p>
          <div className="divide-y divide-line border-y border-line">
            {marketplaces.map((m) => (
              <div key={m.nome} className="flex items-center justify-between py-4 font-mono text-sm">
                <span className="font-body text-base">{m.nome}</span>
                <span className="text-clay">{m.taxa}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="border-t border-line bg-inkdeep text-paper">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-semibold mb-6">Pare de vender no escuro.</h2>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/calculadora-gratis"
              className="inline-block rounded-full bg-gold text-inkdeep px-8 py-4 font-medium hover:bg-goldlight transition-colors"
            >
              Usar a calculadora grátis
            </Link>
            <Link
              href="/login"
              className="inline-block rounded-full border border-paper/40 px-8 py-4 font-medium hover:bg-paper hover:text-inkdeep transition-colors"
            >
              Entrar
            </Link>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-sm text-ink/50">
        © {new Date().getFullYear()} Diego Rezende Digital · Assessoria Marketplace.
      </footer>
    </main>
  );
}
