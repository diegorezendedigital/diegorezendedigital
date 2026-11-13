import type { Company, Listing, Product } from "@/lib/types";
import { calcularLucro, precoParaMargem, type EntradaPreco } from "@/lib/pricing";
import { entradaDoAnuncio } from "@/lib/anuncio";
import { freteML } from "./frete-ml";
import { itensDoML, mlDelete, mlGet, mlPost, taxaDoAnuncio } from "./ml";
import { margemMinimaDoSku, type CacheML } from "./promocoes-motor";

// Desconto próprio (o "Criar desconto por porcentagem" do Mercado Livre): para anúncio que NÃO está em nenhuma promoção,
// cria um desconto com preço riscado no valor que entrega exatamente a margem do SKU. O preço base do anúncio nunca é alterado.
// Se o anúncio está numa promoção do Mercado Livre (preço fixo ou faixa), ela manda: esta fase não mexe nele.

export const ID_DESCONTO_PROPRIO = "DESCONTO_PROPRIO";
export const NOME_DESCONTO_PROPRIO = "Desconto próprio (preço riscado)";

const DIAS_DE_DESCONTO = 14; // o Mercado Livre aceita no máximo 14 dias no desconto individual
const ATIVOS = ["started", "pending", "programmed", "sync_requested"];
const TOLERANCIA_PP = 0.5; // pontos de margem: dentro disso o desconto atual é mantido

const centavos = (v: number) => Math.round(v * 100) / 100;
const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const porcento = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

type PromoDoItem = { id?: string; type?: string; status?: string; price?: number; original_price?: number; finish_date?: string | null; name?: string | null };
type ItemML = { id?: string; status?: string; price?: number; original_price?: number | null };

export type ResultadoProprio = {
  status: "criado" | "mantido" | "recusada" | "erro" | "pulado";
  preco: number | null;
  margem: number | null;
  minimo: number;
  mensagem: string;
};

// Data (AAAA-MM-DD) no horário de Brasília, com deslocamento em dias
function dataBR(dias = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + dias * 86_400_000));
}

type Entrada = {
  token: string;
  mlUserId: string;
  anuncio: Listing;
  produto: Product | undefined;
  empresa: Company | null;
  cache: CacheML;
};

export async function aplicarDescontoProprio(a: Entrada): Promise<ResultadoProprio> {
  const { token, mlUserId, anuncio, produto, empresa, cache } = a;
  const minimo = margemMinimaDoSku(produto);
  const id = anuncio.external_id;
  const vazio = { preco: null, margem: null, minimo };

  const entrada = entradaDoAnuncio(anuncio, produto, empresa, Number(anuncio.fee_percent ?? 12), Number(anuncio.fee_fixed ?? 6));
  if (!entrada) return { ...vazio, status: "recusada", mensagem: "SKU sem custo cadastrado: cadastre o custo no armazém para o desconto próprio ser calculado." };

  // 1) Está em alguma promoção do Mercado Livre? Então ela manda e o desconto próprio não entra.
  const r = await mlGet<PromoDoItem[] | { results?: PromoDoItem[] }>(token, `/seller-promotions/items/${encodeURIComponent(id)}?app_version=v2`);
  const lista = Array.isArray(r) ? r : r?.results ?? [];
  const ativas = lista.filter((p) => ATIVOS.includes(String(p.status)));
  const outra = ativas.find((p) => p.type && p.type !== "PRICE_DISCOUNT");
  if (outra) return { ...vazio, status: "pulado", mensagem: `Já está na promoção “${outra.name || outra.type}”.` };
  const minha = ativas.find((p) => p.type === "PRICE_DISCOUNT");

  // 2) Preço base e situação do anúncio no Mercado Livre
  const [item] = await itensDoML<ItemML>(token, [id]);
  if (!item || item.status !== "active") return { ...vazio, status: "pulado", mensagem: "Anúncio não está ativo." };
  const base = centavos(Number(minha?.original_price) || Number(item.original_price) || Number(item.price) || 0);
  if (!(base > 0)) return { ...vazio, status: "erro", mensagem: "O Mercado Livre não informou o preço do anúncio." };

  // Taxa e frete reais do Mercado Livre em um preço (com cache por rodada)
  const realEm = async (preco: number): Promise<EntradaPreco> => {
    const kTaxa = `${anuncio.category_id ?? ""}|${anuncio.listing_type_id ?? ""}|${preco.toFixed(2)}`;
    const kFrete = `${id}|${preco.toFixed(2)}`;
    const [taxa, frete] = await Promise.all([
      cache.taxa.has(kTaxa) ? Promise.resolve(cache.taxa.get(kTaxa) ?? null) : taxaDoAnuncio(token, preco, anuncio.category_id, anuncio.listing_type_id),
      cache.frete.has(kFrete) ? Promise.resolve(cache.frete.get(kFrete) ?? null) : freteML(token, mlUserId, id, preco),
    ]);
    cache.taxa.set(kTaxa, taxa);
    cache.frete.set(kFrete, frete);
    return { ...entrada, feePct: taxa?.pct ?? entrada.feePct, feeFixo: taxa?.fixo ?? entrada.feeFixo, frete: frete ?? entrada.frete };
  };
  const contaEm = (preco: number, e: EntradaPreco) => {
    const l = calcularLucro(preco, e);
    return { lucro: l.lucro, margem: preco > 0 ? (l.lucro / preco) * 100 : 0, taxa: l.taxaMarketplace, frete: e.frete };
  };

  // 3) Preço do desconto: o que entrega exatamente a margem, conferindo taxa e frete reais nesse preço
  let e: EntradaPreco = entrada;
  let alvo: number | null = null;
  let c: ReturnType<typeof contaEm> | null = null;
  for (let volta = 0; volta < 5; volta++) {
    const t = precoParaMargem(minimo, e);
    if (t == null) {
      alvo = null;
      break;
    }
    alvo = centavos(t);
    const real = await realEm(alvo);
    c = contaEm(alvo, real);
    const deNovo = precoParaMargem(minimo, real);
    if (c.margem >= minimo - 0.005 && (deNovo == null || deNovo >= alvo - 0.01)) break;
    e = real;
  }
  if (alvo == null || !c) return { ...vazio, status: "recusada", mensagem: `Com essa taxa e esse frete a margem de ${porcento(minimo)} é impossível.` };
  if (c.margem < minimo - 0.005) return { ...vazio, preco: alvo, margem: c.margem, status: "recusada", mensagem: `Não consegui fechar a margem de ${porcento(minimo)}: no preço ${reais(alvo)} fica em ${porcento(c.margem)}.` };

  const apagarMeu = () => mlDelete(token, `/seller-promotions/items/${encodeURIComponent(id)}?promotion_type=PRICE_DISCOUNT&app_version=v2`);

  // 4) Sem folga: no preço normal a margem já não passa da meta, então não há desconto possível
  if (alvo >= base - 0.005) {
    const noBase = contaEm(base, await realEm(base));
    let aviso = "";
    if (minha) {
      await apagarMeu().catch(() => null);
      aviso = " Retirei o desconto próprio que estava ativo.";
    }
    return { ...vazio, preco: base, margem: noBase.margem, status: "recusada", mensagem: `Sem folga para desconto: no preço normal (${reais(base)}) a margem é ${porcento(noBase.margem)}, abaixo ou igual à meta de ${porcento(minimo)}.${aviso}` };
  }

  // 5) Já tem desconto próprio perto da meta e com validade sobrando: mantém
  if (minha) {
    const atual = centavos(Number(minha.price) || Number(item.price) || 0);
    if (atual > 0) {
      const m = contaEm(atual, await realEm(atual)).margem;
      const restaMs = minha.finish_date ? new Date(minha.finish_date).getTime() - Date.now() : 0;
      if (Math.abs(m - minimo) <= TOLERANCIA_PP && restaMs > 86_400_000) {
        return { ...vazio, preco: atual, margem: m, status: "mantido", mensagem: `Desconto próprio já ativo a ${reais(atual)} (de ${reais(base)}), com ${porcento(m)} de margem (meta ${porcento(minimo)}).` };
      }
    }
    // Fora da meta ou perto de vencer: remove e cria de novo no preço certo
    await apagarMeu();
  }

  // 6) Cria o desconto (preço riscado) por 14 dias
  try {
    await mlPost(token, `/seller-promotions/items/${encodeURIComponent(id)}?app_version=v2`, {
      promotion_type: "PRICE_DISCOUNT",
      deal_price: alvo,
      start_date: `${dataBR(0)}T00:00:00`,
      finish_date: `${dataBR(DIAS_DE_DESCONTO - 1)}T23:59:59`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro do Mercado Livre";
    return { ...vazio, preco: alvo, margem: c.margem, status: "erro", mensagem: `O Mercado Livre recusou o desconto de ${reais(alvo)}: ${msg}` };
  }
  const desconto = ((base - alvo) / base) * 100;
  return {
    ...vazio,
    preco: alvo,
    margem: c.margem,
    status: "criado",
    mensagem: `Criei o desconto: ${reais(alvo)} (de ${reais(base)}, ${porcento(desconto)} off) por ${DIAS_DE_DESCONTO} dias · margem ${porcento(c.margem)} (meta ${porcento(minimo)}) · taxa ${reais(c.taxa)} · frete ${reais(c.frete)} · lucro ${reais(c.lucro)}.`,
  };
}
