"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { AcaoPromo, Company, Listing, Marketplace, Product, brl, campo, mensagemErro, num, pct } from "@/lib/types";
import { entradaDoAnuncio } from "@/lib/anuncio";
import { calcularLucro } from "@/lib/pricing";

type Promo = {
  id: string;
  type: string;
  sub_type: string | null;
  status: string;
  name: string;
  start_date: string | null;
  finish_date: string | null;
  deadline_date: string | null;
};
type ContaPromos = { ml_user_id: string; conta: string; promocoes: Promo[]; erro?: string };
type Item = {
  id: string;
  status: string;
  price: number | null;
  original_price: number | null;
  min_price: number | null;
  max_price: number | null;
  suggested_price: number | null;
  start_date: string | null;
  end_date: string | null;
  meli_percentage?: number | null;
  seller_percentage?: number | null;
};
type Resumo = {
  promocoes: number;
  promocoesComVaga: number;
  candidatos: number;
  participando: number;
  aguardando: number;
  aceite: number | null;
  bonus: number;
  parcial: boolean;
  erros: string[];
  porPromocao: { conta: string; id: string; nome: string; tipo: string; candidatos: number; participando: number; aguardando: number; bonus: number }[];
};
type EntradaPromo = Item & { promo_id: string; promo_type: string; promo_name: string };
type PorAnuncio = { item_id: string; ml_user_id: string; promocoes: EntradaPromo[]; erro?: string };
type Aberta = { ml_user_id: string; promo: Promo };

const TIPOS: Record<string, string> = {
  DEAL: "Campanha tradicional",
  DOD: "Oferta do dia",
  LIGHTNING: "Oferta relâmpago",
  MARKETPLACE_CAMPAIGN: "Campanha do Mercado Livre",
  PRICE_DISCOUNT: "Desconto do vendedor",
  SELLER_CAMPAIGN: "Campanha do vendedor",
  SMART: "Campanha automática",
  PRE_NEGOTIATED: "Pré-negociada",
  UNHEALTHY_STOCK: "Estoque parado (Full)",
  VOLUME: "Desconto por volume",
  PRICE_MATCHING: "Preço competitivo",
};
const STATUS_PROMO: Record<string, string> = {
  started: "Em andamento",
  pending: "Programada",
  candidate: "Pode participar",
  finished: "Encerrada",
  programmed: "Programada",
};
const STATUS_ITEM: Record<string, [string, string]> = {
  candidate: ["Pode participar", "bg-slate-200 text-slate-700"],
  pending: ["Aguardando", "bg-amber-100 text-amber-800"],
  started: ["Participando", "bg-emerald-100 text-emerald-800"],
  programmed: ["Programada", "bg-blue-100 text-blue-800"],
  finished: ["Encerrada", "bg-slate-100 text-slate-500"],
};

const dia = (s: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—");

// Resumo geral das promoções: gráfico de pizza + métricas
function PainelPromos({ r, carregando, onAtualizar }: { r: Resumo | null; carregando: boolean; onAtualizar: () => void }) {
  const partes = r
    ? [
        { nome: "Para entrar", valor: r.candidatos, cor: "#B7A8FF" },
        { nome: "Participando", valor: r.participando, cor: "#5B3DF5" },
        { nome: "Aguardando/programadas", valor: r.aguardando, cor: "#FFB938" },
      ]
    : [];
  const soma = partes.reduce((a, p) => a + p.valor, 0);
  const R = 62;
  const C = 2 * Math.PI * R;
  let acumulado = 0;
  const Card = ({ t, v, sub }: { t: string; v: string; sub?: string }) => (
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="text-xs font-medium text-slate-500">{t}</div>
      <div className="mt-1 text-2xl font-semibold">{v}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Resumo das promoções</h2>
        <button className="btn-ghost" onClick={onAtualizar} disabled={carregando}>
          {carregando ? "Calculando…" : "Atualizar resumo"}
        </button>
      </div>
      {!r ? (
        <p className="text-sm text-slate-500">{carregando ? "Contando os anúncios de todas as promoções no Mercado Livre…" : "Não foi possível montar o resumo agora. Clique em “Atualizar resumo”."}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(380px,30%)_1fr]">
          <div className="flex items-center gap-4">
            <div className="relative h-[150px] w-[150px] shrink-0">
              <svg viewBox="0 0 160 160" className="h-[150px] w-[150px] -rotate-90" role="img" aria-label="Anúncios por situação nas promoções">
                <circle cx="80" cy="80" r={R} fill="none" stroke="#EFEAFF" strokeWidth="22" />
                {soma > 0 &&
                  partes.map((p) => {
                    const fatia = (p.valor / soma) * C;
                    const el = <circle key={p.nome} cx="80" cy="80" r={R} fill="none" stroke={p.cor} strokeWidth="22" strokeDasharray={`${fatia} ${C - fatia}`} strokeDashoffset={-acumulado} />;
                    acumulado += fatia;
                    return el;
                  })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-semibold">{r.aceite != null ? `${r.aceite.toFixed(0)}%` : "—"}</span>
                <span className="text-[11px] text-slate-500">de aceite</span>
              </div>
            </div>
            <ul className="min-w-0 flex-1 space-y-2 text-sm">
              {partes.map((p) => (
                <li key={p.nome} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.cor }} />
                  <span className="flex-1">{p.nome}</span>
                  <span className="font-mono text-xs text-slate-500">{p.valor}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card t="Promoções com vaga" v={String(r.promocoesComVaga)} sub={`de ${r.promocoes} promoções abertas`} />
            <Card t="Anúncios para entrar" v={String(r.candidatos)} />
            <Card t="Participando" v={String(r.participando)} sub={r.aguardando > 0 ? `+ ${r.aguardando} aguardando / programadas` : undefined} />
            <Card t="Taxa de aceite" v={r.aceite != null ? `${r.aceite.toFixed(1).replace(".", ",")}%` : "—"} sub="entraram ÷ ofertados" />
            <div className="col-span-2 rounded-2xl bg-brand p-4 text-white md:col-span-4">
              <div className="text-xs font-medium text-white/70">Bônus do Mercado Livre conquistado</div>
              <div className="mt-1 text-2xl font-semibold">{brl(r.bonus)}</div>
              <div className="mt-0.5 text-[11px] text-white/70">por unidade vendida, somando os anúncios que estão participando. O valor real recebido depende de quantas unidades vendem na promoção.</div>
            </div>
          </div>
        </div>
      )}
      {r?.parcial && <p className="text-xs text-amber-700">Resumo parcial: o Mercado Livre demorou para responder. Clique em “Atualizar resumo” para refazer.</p>}
      {r && r.erros.length > 0 && <p className="text-xs text-amber-700">{r.erros.join(" · ")}</p>}
    </div>
  );
}

// Percentual sobre o preço da promoção, embaixo do valor
function Sub({ v, base }: { v: number; base: number }) {
  if (!(base > 0) || !(v !== 0)) return null;
  return <div className="font-mono text-[11px] font-normal text-slate-500">{((v / base) * 100).toFixed(1).replace(".", ",")}%</div>;
}

export default function PromocoesPage() {
  const [contas, setContas] = useState<ContaPromos[] | null>(null);
  const [anuncios, setAnuncios] = useState<Listing[]>([]);
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [mps, setMps] = useState<Marketplace[]>([]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [aberta, setAberta] = useState<Aberta | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [depois, setDepois] = useState<string | null>(null);
  const [carregandoItens, setCarregandoItens] = useState(false);
  const [precos, setPrecos] = useState<Record<string, string>>({});
  const [trabalhando, setTrabalhando] = useState("");
  const [confirmaLote, setConfirmaLote] = useState(false);
  const [historico, setHistorico] = useState<AcaoPromo[]>([]);
  const [rodandoAuto, setRodandoAuto] = useState(false);
  const [busca, setBusca] = useState("");
  const [soBonus, setSoBonus] = useState(false);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [carregandoResumo, setCarregandoResumo] = useState(false);
  const [porAnuncio, setPorAnuncio] = useState<PorAnuncio[]>([]);
  const [buscandoAnuncio, setBuscandoAnuncio] = useState(false);
  const [buscaAtiva, setBuscaAtiva] = useState("");

  const carregarResumo = useCallback(async () => {
    setCarregandoResumo(true);
    try {
      setResumo(await apiFetch<Resumo>("/api/ml/promocoes/resumo"));
    } catch {
      setResumo(null);
    } finally {
      setCarregandoResumo(false);
    }
  }, []);

  const carregar = useCallback(async () => {
    setErro("");
    try {
      const [r, l, p, c, m, h] = await Promise.all([
        apiFetch<{ contas: ContaPromos[] }>("/api/ml/promocoes"),
        supabase.from("listings").select("*"),
        supabase.from("products").select("*"),
        supabase.from("companies").select("*"),
        supabase.from("marketplaces").select("*"),
        supabase.from("promo_actions").select("*").order("updated_at", { ascending: false }).limit(60),
      ]);
      setHistorico((h.data ?? []) as AcaoPromo[]);
      setContas(r.contas);
      setAnuncios((l.data ?? []) as Listing[]);
      setProdutos((p.data ?? []) as Product[]);
      setEmpresas((c.data ?? []) as Company[]);
      setMps((m.data ?? []) as Marketplace[]);
    } catch (e) {
      setErro(mensagemErro(e));
      setContas([]);
    }
  }, []);

  useEffect(() => {
    carregarResumo();
    carregar();
  }, [carregar, carregarResumo]);

  const porItem = useMemo(() => new Map(anuncios.map((a) => [a.external_id, a])), [anuncios]);
  const prodPorId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);
  const empresaPadrao = empresas.find((c) => c.is_default) ?? null;

  // Lucro e margem do anúncio se o preço for `preco`
  // Bônus do Mercado Livre: parte do desconto que o próprio ML paga (meli_percentage, sobre o preço original)
  function bonusDe(i: Item, a?: Listing): number {
    const pctML = Number(i.meli_percentage) || 0;
    const base = Number(i.original_price) || (a ? Number(a.price) : 0);
    return pctML > 0 && base > 0 ? Math.round(base * pctML) / 100 : 0;
  }

  function simular(a: Listing | undefined, preco: number, bonus = 0) {
    if (!a || !(preco > 0)) return null;
    const prod = a.product_id ? prodPorId.get(a.product_id) : undefined;
    const emp = (a.company_id && empresas.find((c) => c.id === a.company_id)) || empresaPadrao;
    const mp = mps.find((m) => m.id === a.marketplace_id);
    const pctTaxa = a.fee_percent != null ? Number(a.fee_percent) : mp ? Number(mp.commission_percent) + Number(mp.extra_percent) : 12;
    const fixo = a.fee_fixed != null ? Number(a.fee_fixed) : mp ? Number(mp.fixed_fee) : 6;
    let e: NonNullable<ReturnType<typeof entradaDoAnuncio>> | null = entradaDoAnuncio(a, prod, emp, pctTaxa, fixo);
    // Sem custo cadastrado, taxa, frete e imposto continuam sendo calculados; só lucro e margem ficam em aberto.
    const semCusto = !e;
    if (!e) e = { custo: 0, credito: 0, feePct: pctTaxa, feeFixo: fixo, frete: Number(a.shipping_cost) || 0, empresa: emp ?? null };
    const r = calcularLucro(preco, e);
    const lucro = r.lucro + bonus;
    const margem = preco > 0 ? (lucro / preco) * 100 : 0;
    return { repasse: preco - r.taxaMarketplace - e.frete + bonus, bonus, taxa: r.taxaMarketplace, imposto: r.impostos, frete: e.frete, custo: e.custo, semCusto, lucro, margem, ok: !semCusto && margem >= Number(a.target_margin) };
  }

  const precoEscolhido = (i: Item): number => {
    const digitado = precos[i.id];
    if (digitado !== undefined && digitado !== "") return num(digitado);
    return i.suggested_price ?? i.max_price ?? i.price ?? 0;
  };

  async function rodarAuto() {
    setErro("");
    setAviso("");
    setRodandoAuto(true);
    try {
      const r = await apiFetch<{ avaliados: number; entraram: number; recusados: number; erros: number; parcial: boolean }>("/api/ml/promocoes/auto", { method: "POST" });
      setAviso(
        `Promoções automáticas: ${r.avaliados} anúncios avaliados, ${r.entraram} entraram, ${r.recusados} ficaram de fora por margem ou falta de custo, ${r.erros} com erro.` +
          (r.parcial ? " A rodada foi parcial; rode de novo para continuar." : "")
      );
      await carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setRodandoAuto(false);
    }
  }

  async function abrir(ml_user_id: string, promo: Promo) {
    setAberta({ ml_user_id, promo });
    setItens([]);
    setTotal(null);
    setDepois(null);
    setPrecos({});
    setConfirmaLote(false);
    await carregarItens(ml_user_id, promo, null, true);
  }

  async function carregarItens(ml_user_id: string, promo: Promo, after: string | null, zerar: boolean) {
    setErro("");
    setCarregandoItens(true);
    try {
      const r = await apiFetch<{ itens: Item[]; total: number | null; search_after: string | null }>("/api/ml/promocoes/itens", {
        method: "POST",
        body: JSON.stringify({ ml_user_id, promotion_id: promo.id, promotion_type: promo.type, search_after: after }),
      });
      setItens((l) => (zerar ? r.itens : [...l, ...r.itens]));
      setTotal(r.total);
      setDepois(r.search_after);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setCarregandoItens(false);
    }
  }

  async function aderir(i: Item, ctx: { ml_user_id: string; promo: { id: string; type: string } } | null = aberta): Promise<boolean> {
    if (!ctx) return false;
    const preco = precoEscolhido(i);
    if (i.min_price != null && preco < i.min_price) {
      setErro(`${i.id}: o preço mínimo permitido é ${brl(i.min_price)}.`);
      return false;
    }
    if (i.max_price != null && preco > i.max_price) {
      setErro(`${i.id}: o preço máximo permitido é ${brl(i.max_price)}.`);
      return false;
    }
    setTrabalhando(i.id);
    try {
      await apiFetch("/api/ml/promocoes/aderir", {
        method: "POST",
        body: JSON.stringify({ ml_user_id: ctx.ml_user_id, item_id: i.id, promotion_id: ctx.promo.id, promotion_type: ctx.promo.type, deal_price: preco }),
      });
      setItens((l) => l.map((x) => (x.id === i.id && ctx === aberta ? { ...x, status: "started", price: preco } : x)));
      setPorAnuncio((l) => l.map((g) => (g.item_id === i.id ? { ...g, promocoes: g.promocoes.map((x) => (x.promo_id === ctx.promo.id ? { ...x, status: "started", price: preco } : x)) } : g)));
      return true;
    } catch (e) {
      setErro(`${i.id}: ${mensagemErro(e)}`);
      return false;
    } finally {
      setTrabalhando("");
    }
  }

  async function aderirAnuncio(item: string, i: EntradaPromo, chave: string, preco: number, ctx: { ml_user_id: string; promo: { id: string; type: string } }) {
    setErro("");
    if (i.min_price != null && preco < i.min_price) return setErro(`${item}: o preço mínimo permitido é ${brl(i.min_price)}.`);
    if (i.max_price != null && preco > i.max_price) return setErro(`${item}: o preço máximo permitido é ${brl(i.max_price)}.`);
    setPrecos((p) => ({ ...p, [chave]: campo(preco) }));
    await aderir({ ...i, id: item, suggested_price: preco, max_price: i.max_price, min_price: i.min_price }, ctx);
  }

  async function sair(i: Item, ctx: { ml_user_id: string; promo: { id: string; type: string } } | null = aberta) {
    if (!ctx) return;
    setErro("");
    setTrabalhando(i.id);
    try {
      await apiFetch("/api/ml/promocoes/sair", {
        method: "POST",
        body: JSON.stringify({ ml_user_id: ctx.ml_user_id, item_id: i.id, promotion_id: ctx.promo.id, promotion_type: ctx.promo.type }),
      });
      setItens((l) => l.map((x) => (x.id === i.id && ctx === aberta ? { ...x, status: "candidate" } : x)));
      setPorAnuncio((l) => l.map((g) => (g.item_id === i.id ? { ...g, promocoes: g.promocoes.map((x) => (x.promo_id === ctx.promo.id ? { ...x, status: "candidate" } : x)) } : g)));
    } catch (e) {
      setErro(`${i.id}: ${mensagemErro(e)}`);
    } finally {
      setTrabalhando("");
    }
  }

  // Pesquisa (várias entradas separadas por vírgula): nome ou SKU do anúncio, ou código MLB; e nome da promoção
  const termos = useMemo(() => busca.split(/[,\n]/).map((t) => t.trim().toLowerCase()).filter(Boolean), [busca]);
  const itensFiltrados = useMemo(() => {
    if (termos.length === 0 && !soBonus) return itens;
    return itens.filter((i) => {
      if (soBonus && !(Number(i.meli_percentage) > 0)) return false;
      if (termos.length === 0) return true;
      const a = porItem.get(i.id);
      const skuProd = a?.product_id ? prodPorId.get(a.product_id)?.sku ?? "" : "";
      const texto = `${a?.title ?? ""} ${i.id} ${a?.sku ?? ""} ${skuProd}`.toLowerCase();
      return termos.some((t) => texto.includes(t));
    });
  }, [itens, termos, soBonus, porItem, prodPorId]);
  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca), 500);
    return () => clearTimeout(t);
  }, [busca]);
  const anunciosBuscados = useMemo(() => {
    const ts = buscaAtiva.split(/[,\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (ts.length === 0) return [] as Listing[];
    return anuncios
      .filter((a) => {
        if (!a.ml_user_id) return false;
        const skuProd = a.product_id ? prodPorId.get(a.product_id)?.sku ?? "" : "";
        const texto = `${a.title} ${a.external_id} ${a.sku ?? ""} ${skuProd}`.toLowerCase();
        return ts.some((t) => texto.includes(t));
      })
      .slice(0, 20);
  }, [buscaAtiva, anuncios, prodPorId]);
  useEffect(() => {
    if (anunciosBuscados.length === 0) {
      setPorAnuncio([]);
      return;
    }
    let vivo = true;
    setBuscandoAnuncio(true);
    apiFetch<{ anuncios: { item_id: string; promocoes: Omit<EntradaPromo, "id">[]; erro?: string }[] }>("/api/ml/promocoes/anuncio", {
      method: "POST",
      body: JSON.stringify({ anuncios: anunciosBuscados.map((a) => ({ ml_user_id: a.ml_user_id, item_id: a.external_id })) }),
    })
      .then((r) => {
        if (!vivo) return;
        setPorAnuncio(
          r.anuncios.map((g) => ({
            item_id: g.item_id,
            ml_user_id: anunciosBuscados.find((a) => a.external_id === g.item_id)?.ml_user_id ?? "",
            erro: g.erro,
            promocoes: g.promocoes.map((p) => ({ ...p, id: g.item_id }) as EntradaPromo),
          }))
        );
      })
      .catch(() => vivo && setPorAnuncio([]))
      .finally(() => vivo && setBuscandoAnuncio(false));
    return () => {
      vivo = false;
    };
  }, [anunciosBuscados]);
  const qtdBonus = useMemo(() => itens.filter((i) => Number(i.meli_percentage) > 0).length, [itens]);
  const promoCasa = (nome: string) => termos.length === 0 || termos.some((t) => nome.toLowerCase().includes(t));

  // Candidatos cuja margem, no preço escolhido, atinge a meta do anúncio
  const lucrativos = itensFiltrados.filter((i) => {
    if (i.status !== "candidate") return false;
    const s = simular(porItem.get(i.id), precoEscolhido(i), bonusDe(i, porItem.get(i.id)));
    return !!s && s.ok;
  });

  async function aderirLucrativos() {
    setConfirmaLote(false);
    setErro("");
    setAviso("");
    let ok = 0;
    for (const i of lucrativos) {
      if (await aderir(i)) ok++;
    }
    setAviso(`${ok} de ${lucrativos.length} anúncios lucrativos foram colocados na promoção.`);
  }

  if (!contas) return <p className="text-sm text-slate-500">Carregando promoções…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Central de promoções</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Promoções que o Mercado Livre oferece às suas contas. Para cada anúncio o sistema calcula o lucro e a margem no preço da promoção, com o custo do armazém, a taxa, o frete e os
          impostos do CNPJ, e mostra se ainda atinge a sua meta.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input max-w-xl"
          placeholder="Pesquisar promoção, nome do anúncio, SKU ou código MLB (separe várias entradas com vírgula)"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        {busca && (
          <button type="button" className="text-sm font-medium text-brand hover:underline" onClick={() => setBusca("")}>
            Limpar
          </button>
        )}
      </div>

      <PainelPromos r={resumo} carregando={carregandoResumo} onAtualizar={carregarResumo} />

      <div className="card flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">
          <strong>Promoção automática:</strong> em <Link href="/dashboard/produtos/armazem" className="underline">Produtos armazém</Link>, marque “Promo auto” em cada SKU e defina a margem mínima dele (padrão 10%; pode ser negativa para aceitar prejuízo, ex.: -5).
          Todo dia o sistema entra sozinho nas promoções do Mercado Livre em que a margem, depois de taxa, frete, imposto e custo, atinge o mínimo. Ele sempre escolhe o maior preço permitido, com menos desconto.
        </p>
        <button className="btn" onClick={rodarAuto} disabled={rodandoAuto}>{rodandoAuto ? "Avaliando…" : "Rodar promoções automáticas agora"}</button>
      </div>

      {erro && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {aviso && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</p>}

      {contas.length === 0 && (
        <div className="card space-y-3 text-sm text-slate-600">
          <p>Nenhuma conta do Mercado Livre conectada.</p>
          <Link href="/dashboard/integracoes" className="btn">Conectar em Integrações</Link>
        </div>
      )}

      {contas.map((c) => (
        <section key={c.ml_user_id} className="space-y-2">
          <h2 className="font-mono text-xs uppercase tracking-wider text-slate-500">{c.conta}</h2>
          {c.erro && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{c.erro}</p>}
          {!c.erro && c.promocoes.length === 0 && <div className="card text-sm text-slate-600">O Mercado Livre não tem promoções disponíveis para esta conta agora.</div>}
          {c.promocoes.length > 0 && (
            <div className="card overflow-x-auto p-0">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[13px] font-medium text-slate-500">
                    <th className="p-3">Promoção</th>
                    <th className="p-3">Tipo</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Início</th>
                    <th className="p-3">Fim</th>
                    <th className="p-3">Prazo para entrar</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {c.promocoes.filter((p) => promoCasa(p.name) || (aberta?.promo.id === p.id && aberta.ml_user_id === c.ml_user_id)).map((p) => {
                    const ativa = aberta?.promo.id === p.id && aberta.ml_user_id === c.ml_user_id;
                    return (
                      <tr key={p.id} className={`border-b border-slate-100 ${ativa ? "bg-brand-light" : ""}`}>
                        <td className="p-3 font-medium">{p.name}</td>
                        <td className="p-3">{TIPOS[p.type] ?? p.type}</td>
                        <td className="p-3">{STATUS_PROMO[p.status] ?? p.status}</td>
                        <td className="p-3">{dia(p.start_date)}</td>
                        <td className="p-3">{dia(p.finish_date)}</td>
                        <td className="p-3">{dia(p.deadline_date)}</td>
                        <td className="p-3 text-right">
                          <button className="btn-ghost" onClick={() => abrir(c.ml_user_id, p)}>Ver anúncios</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      {(buscandoAnuncio || porAnuncio.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Promoções dos anúncios encontrados</h2>
          {buscandoAnuncio && porAnuncio.length === 0 && <p className="text-sm text-slate-500">Buscando as promoções desses anúncios no Mercado Livre…</p>}
          {porAnuncio.map((g) => {
            const a = porItem.get(g.item_id);
            const conta = contas.find((x) => x.ml_user_id === g.ml_user_id)?.conta ?? "";
            return (
              <div key={g.item_id} className="card overflow-x-auto p-0">
                <div className="border-b border-slate-100 p-3">
                  <div className="font-medium">{a?.title ?? g.item_id}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-slate-500">
                    <span title="Mercado Livre" className="inline-flex h-4 min-w-[20px] items-center justify-center rounded-full bg-[#FFE600] px-1 text-[9px] font-bold text-[#333]">ML</span>
                    <span className="font-sans text-xs text-slate-600">{conta}</span>
                    <span>· {g.item_id}</span>
                    {a?.sku && <span>· SKU {a.sku}</span>}
                    <span>· preço atual {brl(Number(a?.price ?? 0))}</span>
                    <span>· {g.promocoes.length} promoç{g.promocoes.length === 1 ? "ão" : "ões"}</span>
                  </div>
                </div>
                {g.erro && <p className="p-3 text-sm text-red-700">{g.erro}</p>}
                {!g.erro && g.promocoes.length === 0 && <p className="p-3 text-sm text-slate-500">Este anúncio não tem promoções disponíveis agora.</p>}
                {g.promocoes.length > 0 && (
                  <table className="w-full min-w-[1200px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[13px] font-medium text-slate-500">
                        <th className="p-3">Promoção</th>
                        <th className="p-3">Faixa permitida</th>
                        <th className="p-3">Preço na promoção</th>
                        <th className="p-3 text-right">Taxa</th>
                        <th className="p-3 text-right">Frete</th>
                        <th className="p-3 text-right">Bônus ML</th>
                        <th className="p-3 text-right">Repasse</th>
                        <th className="p-3 text-right">Imposto</th>
                        <th className="p-3 text-right">Custo</th>
                        <th className="p-3 text-right">Sobra</th>
                        <th className="p-3 text-right">Margem</th>
                        <th className="p-3">Status</th>
                        <th className="p-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.promocoes.map((i) => {
                        const chave = `${g.item_id}|${i.promo_id}`;
                        const ctx = { ml_user_id: g.ml_user_id, promo: { id: i.promo_id, type: i.promo_type } };
                        const preco = precos[chave] !== undefined && precos[chave] !== "" ? num(precos[chave]) : i.suggested_price ?? i.max_price ?? i.price ?? 0;
                        const bonus = bonusDe(i, a);
                        const s = simular(a, preco, bonus);
                        const st = STATUS_ITEM[i.status] ?? [i.status, "bg-slate-100 text-slate-600"];
                        const dentro = i.status === "started" || i.status === "pending" || i.status === "programmed";
                        return (
                          <tr key={chave} className="border-b border-slate-100 align-top">
                            <td className="p-3">
                              <div className="font-medium">{i.promo_name}</div>
                              <div className="text-xs text-slate-500">{TIPOS[i.promo_type] ?? i.promo_type}{i.end_date ? ` · até ${dia(i.end_date)}` : ""}</div>
                            </td>
                            <td className="p-3 font-mono text-xs text-slate-600">{i.min_price != null || i.max_price != null ? `${i.min_price != null ? brl(i.min_price) : "—"} a ${i.max_price != null ? brl(i.max_price) : "—"}` : "—"}</td>
                            <td className="p-3">
                              {dentro ? (
                                brl(i.price ?? preco)
                              ) : (
                                <input className="input w-28 py-1" inputMode="decimal" value={precos[chave] ?? (preco > 0 ? campo(preco) : "")} onChange={(e) => setPrecos((p) => ({ ...p, [chave]: e.target.value }))} />
                              )}
                            </td>
                            <td className="p-3 text-right text-slate-700">{s ? brl(s.taxa) : "—"}{s && <Sub v={s.taxa} base={preco} />}</td>
                            <td className="p-3 text-right text-slate-700">{s ? brl(s.frete) : "—"}{s && <Sub v={s.frete} base={preco} />}</td>
                            <td className="p-3 text-right text-slate-700">{bonus > 0 ? <span className="font-medium text-emerald-700">+ {brl(bonus)}</span> : "—"}{bonus > 0 && <Sub v={bonus} base={preco} />}</td>
                            <td className="p-3 text-right font-medium text-slate-900">{s ? brl(s.repasse) : "—"}{s && <Sub v={s.repasse} base={preco} />}</td>
                            <td className="p-3 text-right text-slate-700">{s ? brl(s.imposto) : "—"}{s && <Sub v={s.imposto} base={preco} />}</td>
                            <td className="p-3 text-right text-slate-700">{s && !s.semCusto ? brl(s.custo) : <span className="text-amber-700">sem custo</span>}{s && !s.semCusto && <Sub v={s.custo} base={preco} />}</td>
                            <td className={`p-3 text-right font-semibold ${s && !s.semCusto && s.lucro < 0 ? "text-red-700" : "text-emerald-800"}`}>{s && !s.semCusto ? `${s.lucro < 0 ? "− " : "+ "}${brl(Math.abs(s.lucro))}` : "—"}</td>
                            <td className={`p-3 text-right ${s && !s.ok ? "text-red-700" : ""}`}>
                              {s && !s.semCusto ? pct(s.margem) : "—"}
                              {s && !s.semCusto && <div className={`text-[11px] ${s.lucro < 0 ? "text-red-700" : s.ok ? "text-emerald-700" : "text-amber-700"}`}>{s.lucro < 0 ? "prejuízo" : s.ok ? "atinge a meta" : "abaixo da meta"}</div>}
                            </td>
                            <td className="p-3"><span className={`badge ${st[1]}`}>{st[0]}</span></td>
                            <td className="whitespace-nowrap p-3 text-right">
                              {dentro ? (
                                <button className="text-red-700 hover:underline" onClick={() => sair({ ...i, id: g.item_id }, ctx)} disabled={trabalhando === g.item_id}>Sair</button>
                              ) : i.status === "candidate" ? (
                                <button className="btn-ghost" onClick={() => aderirAnuncio(g.item_id, i, chave, preco, ctx)} disabled={trabalhando === g.item_id}>Participar</button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </section>
      )}

      {aberta && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {aberta.promo.name} <span className="text-sm font-normal text-slate-500">· {TIPOS[aberta.promo.type] ?? aberta.promo.type}</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSoBonus((v) => !v)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${soBonus ? "bg-brand text-white" : "bg-white text-slate-600 shadow-soft hover:bg-brand-light"}`}
                title="Mostra só os anúncios em que o Mercado Livre paga parte do desconto"
              >
                Com bônus do ML <span className={`ml-1 text-xs ${soBonus ? "text-white/70" : "text-slate-400"}`}>{qtdBonus}</span>
              </button>
              {total != null && <span className="font-mono text-xs text-slate-500">{itensFiltrados.length} de {total} anúncios</span>}
              {lucrativos.length > 0 &&
                (confirmaLote ? (
                  <span className="text-sm">
                    Colocar {lucrativos.length} anúncios na promoção?{" "}
                    <button className="font-semibold text-brand underline" onClick={aderirLucrativos}>Sim</button>{" "}
                    <button className="text-slate-600 underline" onClick={() => setConfirmaLote(false)}>Não</button>
                  </span>
                ) : (
                  <button className="btn" onClick={() => setConfirmaLote(true)} disabled={!!trabalhando}>
                    Entrar com os lucrativos ({lucrativos.length})
                  </button>
                ))}
            </div>
          </div>

          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[1280px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[13px] font-medium text-slate-500">
                  <th className="p-3">Anúncio</th>
                  <th className="p-3 text-right">Preço atual</th>
                  <th className="p-3">Faixa permitida</th>
                  <th className="p-3">Preço na promoção</th>
                  <th className="p-3 text-right">Taxa</th>
                  <th className="p-3 text-right">Frete</th>
                  <th className="p-3 text-right" title="Parte do desconto que o próprio Mercado Livre paga a você nesta promoção">Bônus ML</th>
                  <th className="p-3 text-right" title="Preço na promoção – taxa – frete + bônus do Mercado Livre: o que o Mercado Livre libera para você">Repasse</th>
                  <th className="p-3 text-right">Imposto</th>
                  <th className="p-3 text-right">Custo</th>
                  <th className="p-3 text-right">Sobra</th>
                  <th className="p-3 text-right">Margem</th>
                  <th className="p-3">Status</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {itensFiltrados.length === 0 && !carregandoItens && (
                  <tr>
                    <td className="p-4 text-slate-500" colSpan={13}>{termos.length > 0 || soBonus ? "Nenhum anúncio carregado bate com o filtro." + (depois ? " Clique em “Carregar mais anúncios” para procurar nos demais." : "") : "Nenhum anúncio nesta promoção."}</td>
                  </tr>
                )}
                {itensFiltrados.map((i) => {
                  const a = porItem.get(i.id);
                  const preco = precoEscolhido(i);
                  const bonus = bonusDe(i, a);
                  const s = simular(a, preco, bonus);
                  const st = STATUS_ITEM[i.status] ?? [i.status, "bg-slate-100 text-slate-600"];
                  const dentro = i.status === "started" || i.status === "pending" || i.status === "programmed";
                  return (
                    <tr key={i.id} className="border-b border-slate-100 align-top">
                      <td className="max-w-[300px] p-3">
                        <div className="truncate" title={a?.title}>{a?.title ?? "Anúncio fora do sistema"}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-slate-500">
                          <span title="Mercado Livre" className="inline-flex h-4 min-w-[20px] items-center justify-center rounded-full bg-[#FFE600] px-1 text-[9px] font-bold text-[#333]">ML</span>
                          <span className="font-sans text-xs text-slate-600">{contas.find((x) => x.ml_user_id === aberta.ml_user_id)?.conta ?? ""}</span>
                          <span>· {i.id}</span>
                        </div>
                      </td>
                      <td className="p-3 text-right">{brl(a ? Number(a.price) : i.original_price ?? 0)}</td>
                      <td className="p-3 font-mono text-xs text-slate-600">
                        {i.min_price != null || i.max_price != null ? `${i.min_price != null ? brl(i.min_price) : "—"} a ${i.max_price != null ? brl(i.max_price) : "—"}` : "—"}
                      </td>
                      <td className="p-3">
                        {dentro ? (
                          brl(i.price ?? preco)
                        ) : (
                          <input
                            className="input w-28 py-1"
                            inputMode="decimal"
                            value={precos[i.id] ?? (preco > 0 ? campo(preco) : "")}
                            onChange={(e) => setPrecos((p) => ({ ...p, [i.id]: e.target.value }))}
                          />
                        )}
                      </td>
                      <td className="p-3 text-right text-slate-700">{s ? brl(s.taxa) : "—"}{s && <Sub v={s.taxa} base={preco} />}</td>
                      <td className="p-3 text-right text-slate-700">{s ? brl(s.frete) : "—"}{s && <Sub v={s.frete} base={preco} />}</td>
                      <td className="p-3 text-right text-slate-700" title={bonus > 0 ? `O Mercado Livre paga ${Number(i.meli_percentage)}% do preço original (${brl(Number(i.original_price) || Number(a?.price) || 0)})` : "Esta promoção não tem bônus do Mercado Livre"}>
                        {bonus > 0 ? <span className="font-medium text-emerald-700">+ {brl(bonus)}</span> : "—"}
                        {bonus > 0 && <Sub v={bonus} base={preco} />}
                      </td>
                      <td className="p-3 text-right font-medium text-slate-900" title={s ? `${brl(preco)} − taxa ${brl(s.taxa)} − frete ${brl(s.frete)}${bonus > 0 ? ` + bônus ${brl(bonus)}` : ""} = ${brl(s.repasse)}` : undefined}>
                        {s ? brl(s.repasse) : "—"}
                        {s && <Sub v={s.repasse} base={preco} />}
                      </td>
                      <td className="p-3 text-right text-slate-700">{s ? brl(s.imposto) : "—"}{s && <Sub v={s.imposto} base={preco} />}</td>
                      <td className="p-3 text-right text-slate-700">{s && !s.semCusto ? brl(s.custo) : <span className="text-amber-700">sem custo</span>}{s && !s.semCusto && <Sub v={s.custo} base={preco} />}</td>
                      <td className={`p-3 text-right font-semibold ${s && !s.semCusto && s.lucro < 0 ? "text-red-700" : "text-emerald-800"}`}>
                        {s && !s.semCusto ? `${s.lucro < 0 ? "− " : "+ "}${brl(Math.abs(s.lucro))}` : "—"}
                      </td>
                      <td className={`p-3 text-right ${s && !s.ok ? "text-red-700" : ""}`} title={a ? `Meta: ${pct(Number(a.target_margin))}` : "Importe o anúncio e ligue a um produto para calcular"}>
                        {s && !s.semCusto ? pct(s.margem) : "—"}
                        {s && !s.semCusto && <div className={`text-[11px] ${s.lucro < 0 ? "text-red-700" : s.ok ? "text-emerald-700" : "text-amber-700"}`}>{s.lucro < 0 ? "prejuízo" : s.ok ? "atinge a meta" : "abaixo da meta"}</div>}
                      </td>
                      <td className="p-3">
                        <span className={`badge ${st[1]}`}>{st[0]}</span>
                      </td>
                      <td className="whitespace-nowrap p-3 text-right">
                        {dentro ? (
                          <button className="text-red-700 hover:underline" onClick={() => sair(i)} disabled={trabalhando === i.id}>Sair</button>
                        ) : i.status === "candidate" ? (
                          <button className="btn-ghost" onClick={() => aderir(i)} disabled={trabalhando === i.id}>
                            {trabalhando === i.id ? "Entrando…" : "Participar"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {(depois || carregandoItens) && (
            <button className="btn-ghost" onClick={() => aberta && carregarItens(aberta.ml_user_id, aberta.promo, depois, false)} disabled={carregandoItens || !depois}>
              {carregandoItens ? "Carregando…" : "Carregar mais anúncios"}
            </button>
          )}
          <p className="text-xs text-slate-500">
            Sobra = preço da promoção − taxa − frete − imposto − custo. Margem = sobra ÷ preço da promoção. Em promoções em que o Mercado Livre paga parte do desconto, o valor que você recebe pode ser maior que o calculado aqui. Anúncios sem custo (sem produto ligado) não têm lucro calculado e ficam de fora do
            “Entrar com os lucrativos”.
          </p>
        </section>
      )}

      {historico.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-mono text-xs uppercase tracking-wider text-slate-500">Histórico da participação automática</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[13px] font-medium text-slate-500">
                  <th className="p-3">Data</th>
                  <th className="p-3">Anúncio</th>
                  <th className="p-3">Promoção</th>
                  <th className="p-3 text-right">Preço</th>
                  <th className="p-3 text-right">Margem</th>
                  <th className="p-3">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((h) => (
                  <tr key={h.id} className="border-b border-slate-100 align-top">
                    <td className="p-3 font-mono text-xs">{new Date(h.updated_at).toLocaleString("pt-BR")}</td>
                    <td className="max-w-[260px] p-3">
                      <div className="truncate">{porItem.get(h.item_id)?.title ?? "—"}</div>
                      <div className="font-mono text-[11px] text-slate-500">{h.item_id}</div>
                    </td>
                    <td className="p-3">{h.promotion_name ?? h.promotion_id}</td>
                    <td className="p-3 text-right">{h.price != null ? brl(Number(h.price)) : "—"}</td>
                    <td className="p-3 text-right">{h.margin != null ? pct(Number(h.margin)) : "—"}</td>
                    <td className="p-3">
                      <span className={`badge ${h.status === "entrou" ? "bg-emerald-100 text-emerald-800" : h.status === "erro" ? "bg-red-100 text-red-700" : "bg-slate-200 text-slate-700"}`}>
                        {h.status === "entrou" ? "Entrou" : h.status === "erro" ? "Erro" : "Ficou de fora"}
                      </span>
                      {h.message && <div className="mt-0.5 text-xs text-slate-600">{h.message}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
