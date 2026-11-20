// Abas que o usuário master pode liberar para cada colaborador.
// Integrações e Configurações ficam sempre só com o master.
export type AbaId = "inicio" | "armazem" | "anuncios" | "pedidos" | "devolucoes" | "promo_ml" | "promo_shopee" | "promo_tiktok" | "calculadora" | "relatorios" | "dre";

export const ABAS: { id: AbaId; label: string; grupo: string; exato?: string[]; prefixo?: string[] }[] = [
  { id: "inicio", label: "Início (painel)", grupo: "Geral", exato: ["/dashboard"] },
  { id: "pedidos", label: "Pedidos", grupo: "Geral", prefixo: ["/dashboard/pedidos"] },
  { id: "devolucoes", label: "Devoluções e reclamações", grupo: "Geral", prefixo: ["/dashboard/devolucoes"] },
  { id: "armazem", label: "Produtos armazém e NF-e", grupo: "Produtos", prefixo: ["/dashboard/produtos/armazem", "/dashboard/produtos/nfe"] },
  { id: "anuncios", label: "Anúncios Marketplace", grupo: "Produtos", prefixo: ["/dashboard/produtos/anuncios"] },
  { id: "promo_ml", label: "Promoções Mercado Livre", grupo: "Promoções", exato: ["/dashboard/promocoes"] },
  { id: "promo_shopee", label: "Promoções Shopee", grupo: "Promoções", prefixo: ["/dashboard/promocoes/shopee"] },
  { id: "promo_tiktok", label: "Promoções TikTok Shop", grupo: "Promoções", prefixo: ["/dashboard/promocoes/tiktok"] },
  { id: "calculadora", label: "Calculadora", grupo: "Análises", prefixo: ["/dashboard/calculadora"] },
  { id: "relatorios", label: "Relatórios", grupo: "Análises", prefixo: ["/dashboard/relatorios"] },
  { id: "dre", label: "DRE", grupo: "Análises", prefixo: ["/dashboard/dre"] },
];

export const TODAS_AS_ABAS: AbaId[] = ABAS.map((a) => a.id);

// Qual aba um endereço representa (null = página sem controle por aba)
export function abaDoCaminho(caminho: string): AbaId | null {
  for (const a of ABAS) if (a.exato?.includes(caminho)) return a.id;
  let melhor: { id: AbaId; tam: number } | null = null;
  for (const a of ABAS)
    for (const p of a.prefixo ?? [])
      if ((caminho === p || caminho.startsWith(p + "/")) && (!melhor || p.length > melhor.tam)) melhor = { id: a.id, tam: p.length };
  return melhor?.id ?? null;
}

// permissoes null/undefined = acesso a todas as abas (master ou convidado antigo)
export function pode(permissoes: string[] | null | undefined, aba: AbaId | null): boolean {
  if (!aba || !permissoes) return true;
  return permissoes.includes(aba);
}

// Primeiro endereço liberado, para mandar o colaborador quando ele cair numa aba bloqueada
export function primeiraAba(permissoes: string[] | null | undefined): string {
  const a = ABAS.find((x) => pode(permissoes, x.id));
  return a ? (a.exato?.[0] ?? a.prefixo![0]) : "/dashboard";
}
