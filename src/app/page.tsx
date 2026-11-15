import Link from "next/link";
import RodapeLegal from "@/components/RodapeLegal";

const marketplaces = [
  { nome: "Mercado Livre", taxa: "10% a 14% + taxa fixa abaixo de R$ 79" },
  { nome: "Shopee", taxa: "14% a 20% + R$ 4,50 a R$ 26 por item" },
  { nome: "TikTok Shop", taxa: "6% a 10% + 6% de frete grátis + R$ 4 a R$ 6 por item" },
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
            <Link href="#quem-sou" className="hidden sm:inline hover:text-gold transition-colors">
              Quem sou
            </Link>
            <Link href="#videos" className="hidden sm:inline hover:text-gold transition-colors">
              Vídeos
            </Link>
            <Link href="#como-funciona" className="hidden md:inline hover:text-gold transition-colors">
              Como trabalho
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
              Gestão de marketplace · Aulas · Ferramentas
            </p>
            <h1 className="font-display text-5xl md:text-6xl font-semibold leading-[1.05] tracking-tight">
              Cada venda tem um preço.
              <br />
              Poucas têm <span className="text-gold">margem real.</span>
            </h1>
            <p className="mt-6 text-lg text-ink/70 max-w-md leading-relaxed">
              Sou o Diego. Trabalho com marketplace desde os 16 anos e ensino, no YouTube e aqui, como vender
              online olhando para o número que importa: quanto sobra de verdade em cada venda.
            </p>
            <div className="mt-10 flex items-center gap-4">
              <Link
                href="#videos"
                className="rounded-full bg-ink text-paper px-7 py-3.5 font-medium hover:bg-inkdeep transition-colors"
              >
                Assistir ao vídeo
              </Link>
              <Link
                href="/calculadora-gratis"
                className="text-ink/70 hover:text-ink underline underline-offset-4 decoration-line"
              >
                Usar a calculadora grátis
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

      {/* Quem sou */}
      <section id="quem-sou" className="border-t border-line bg-white/40">
        <div className="mx-auto max-w-6xl px-6 py-20 grid md:grid-cols-5 gap-12">
          <div className="md:col-span-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-clay mb-4">Quem sou</p>
            <h2 className="font-display text-3xl md:text-4xl font-semibold leading-tight">
              Marketplace é o meu trabalho desde os 16 anos.
            </h2>
          </div>
          <div className="md:col-span-3 space-y-5 text-ink/75 text-lg leading-relaxed">
            <p>
              Fui gestor de várias empresas, criei processos e levei para o marketplace negócios que ainda não vendiam
              online. Passei por sistemas, ERPs e integradores do dia a dia do vendedor, como Bling, Olist e Upseller.
            </p>
            <p>
              O Diego Rezende Digital nasceu para juntar isso em um lugar só: conteúdo para quem quer aprender e uma
              gestão próxima para quem quer resultado.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              {["Gestão de marketplace", "Processos", "ERP e integradores", "Bling", "Olist", "Upseller"].map((t) => (
                <span key={t} className="rounded-full border border-line bg-paper px-4 py-1.5 text-sm text-ink/80">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Vídeos */}
      <section id="videos" className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-clay mb-4">Canal no YouTube</p>
          <h2 className="font-display text-3xl md:text-4xl font-semibold mb-3">Videoaulas gratuitas</h2>
          <p className="text-ink/60 mb-10 max-w-2xl">
            Conteúdo direto sobre vender melhor em marketplace. Esse é o primeiro vídeo, e novos vão aparecer aqui à
            medida que eu publicar.
          </p>
          <div className="grid lg:grid-cols-3 gap-8 items-start">
            <div className="lg:col-span-2 overflow-hidden rounded-2xl bg-inkdeep shadow-xl">
              <div className="aspect-video">
                <iframe
                  className="h-full w-full"
                  src="https://www.youtube-nocookie.com/embed/pkPr5KZJ5UA"
                  title="Vídeo do canal Diego Rezende Digital"
                  loading="lazy"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
            </div>
            <div className="space-y-5">
              <div className="rounded-2xl border border-line bg-white/60 p-6">
                <p className="font-mono text-xs uppercase tracking-widest text-clay mb-2">Material gratuito</p>
                <h3 className="font-display text-xl font-medium mb-2">Calculadora de lucro</h3>
                <p className="text-ink/70 leading-relaxed mb-4">
                  Para acompanhar as aulas: simule uma venda e veja quanto cada marketplace desconta antes de definir o
                  preço.
                </p>
                <Link
                  href="/calculadora-gratis"
                  className="inline-block rounded-full bg-ink text-paper px-6 py-3 font-medium hover:bg-inkdeep transition-colors"
                >
                  Abrir a calculadora
                </Link>
              </div>
              <div className="rounded-2xl border border-dashed border-line p-6 text-ink/60">
                <p className="font-medium text-ink/80 mb-1">Em breve</p>
                <p className="leading-relaxed">Mais videoaulas gratuitas e cursos pagos mais aprofundados.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Como trabalho */}
      <section id="como-funciona" className="border-t border-line bg-white/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-clay mb-4">Para quem quer resultado</p>
          <h2 className="font-display text-3xl md:text-4xl font-semibold mb-3">Gestão de marketplace com sistema próprio</h2>
          <p className="text-ink/60 mb-12 max-w-2xl">
            Além do conteúdo, eu cuido da operação de lojas como uma agência. Os clientes ficam conectados ao meu
            sistema, e isso me deixa acompanhar de perto e mostrar o resultado com número.
          </p>
          <div className="grid md:grid-cols-3 gap-10">
            <div>
              <p className="font-mono text-clay text-sm mb-3">01 · Operação</p>
              <h3 className="font-display text-xl font-medium mb-2">Processos e gestão</h3>
              <p className="text-ink/70 leading-relaxed">
                Estruturo a venda online da empresa: anúncios, preços, estoque e rotina, do início ou de uma operação
                que já existe.
              </p>
            </div>
            <div>
              <p className="font-mono text-clay text-sm mb-3">02 · Sistema</p>
              <h3 className="font-display text-xl font-medium mb-2">Lucro real por venda</h3>
              <p className="text-ink/70 leading-relaxed">
                Pedidos, taxas, frete, impostos e custo do produto no mesmo painel, para cada decisão de preço sair do
                número e não do palpite.
              </p>
            </div>
            <div>
              <p className="font-mono text-clay text-sm mb-3">03 · Resultado</p>
              <h3 className="font-display text-xl font-medium mb-2">Acompanhamento e DRE</h3>
              <p className="text-ink/70 leading-relaxed">
                Você enxerga onde a loja ganha e onde perde dinheiro, com relatórios claros para decidir o próximo passo.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Marketplaces */}
      <section id="marketplaces" className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-display text-3xl font-semibold mb-2">Marketplaces que acompanho</h2>
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
          <h2 className="font-display text-3xl md:text-4xl font-semibold mb-3">Pare de vender no escuro.</h2>
          <p className="text-paper/70 mb-8 max-w-xl mx-auto">
            Comece pela calculadora grátis ou fale comigo para ter a gestão da sua loja acompanhada de perto.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/calculadora-gratis"
              className="inline-block rounded-full bg-gold text-inkdeep px-8 py-4 font-medium hover:bg-goldlight transition-colors"
            >
              Usar a calculadora grátis
            </Link>
            <a
              href="mailto:contato@diegorezendedigital.com.br?subject=Quero%20conversar%20sobre%20gest%C3%A3o%20de%20marketplace"
              className="inline-block rounded-full border border-paper/40 px-8 py-4 font-medium hover:bg-paper hover:text-inkdeep transition-colors"
            >
              Falar com o Diego
            </a>
            <Link href="/login" className="text-paper/60 hover:text-paper underline underline-offset-4">
              Já sou cliente
            </Link>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-sm text-ink/50">
        © {new Date().getFullYear()} Diego Rezende Digital · Assessoria Marketplace.
        <RodapeLegal />
      </footer>
    </main>
  );
}
