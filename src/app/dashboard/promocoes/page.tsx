"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { Company, Listing, Marketplace, Product, brl, campo, mensagemErro, num, pct } from "@/lib/types";
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
};
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

  const carregar = useCallback(async () => {
    setErro("");
    try {
      const [r, l, p, c, m] = await Promise.all([
        apiFetch<{ contas: ContaPromos[] }>("/api/ml/promocoes"),
        supabase.from("listings").select("*"),
        supabase.from("products").select("*"),
        supabase.from("companies").select("*"),
        supabase.from("marketplaces").select("*"),
      ]);
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
    carregar();
  }, [carregar]);

  const porItem = useMemo(() => new Map(anuncios.map((a) => [a.external_id, a])), [anuncios]);
  const prodPorId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);
  const empresaPadrao = empresas.find((c) => c.is_default) ?? null;

  // Lucro e margem do anúncio se o preço for `preco`
  function simular(a: Listing | undefined, preco: number) {
    if (!a || !(preco > 0)) return null;
    const prod = a.product_id ? prodPorId.get(a.product_id) : undefined;
    const emp = (a.company_id && empresas.find((c) => c.id === a.company_id)) || empresaPadrao;
    const mp = mps.find((m) => m.id === a.marketplace_id);
    const pctTaxa = a.fee_percent != null ? Number(a.fee_percent) : mp ? Number(mp.commission_percent) + Number(mp.extra_percent) : 12;
    const fixo = a.fee_fixed != null ? Number(a.fee_fixed) : mp ? Number(mp.fixed_fee) : 6;
    const e = entradaDoAnuncio(a, prod, emp, pctTaxa, fixo);
    if (!e) return null;
    const r = calcularLucro(preco, e);
    return { taxa: r.taxaMarketplace, imposto: r.impostos, frete: e.frete, custo: e.custo, lucro: r.lucro, margem: r.margem, ok: r.margem >= Number(a.target_margin) };
  }

  const precoEscolhido = (i: Item): number => {
    const digitado = precos[i.id];
    if (digitado !== undefined && digitado !== "") return num(digitado);
    return i.suggested_price ?? i.max_price ?? i.price ?? 0;
  };

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

  async function aderir(i: Item): Promise<boolean> {
    if (!aberta) return false;
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
        body: JSON.stringify({ ml_user_id: aberta.ml_user_id, item_id: i.id, promotion_id: aberta.promo.id, promotion_type: aberta.promo.type, deal_price: preco }),
      });
      setItens((l) => l.map((x) => (x.id === i.id ? { ...x, status: "started", price: preco } : x)));
      return true;
    } catch (e) {
      setErro(`${i.id}: ${mensagemErro(e)}`);
      return false;
    } finally {
      setTrabalhando("");
    }
  }

  async function sair(i: Item) {
    if (!aberta) return;
    setErro("");
    setTrabalhando(i.id);
    try {
      await apiFetch("/api/ml/promocoes/sair", {
        method: "POST",
        body: JSON.stringify({ ml_user_id: aberta.ml_user_id, item_id: i.id, promotion_id: aberta.promo.id, promotion_type: aberta.promo.type }),
      });
      setItens((l) => l.map((x) => (x.id === i.id ? { ...x, status: "candidate" } : x)));
    } catch (e) {
      setErro(`${i.id}: ${mensagemErro(e)}`);
    } finally {
      setTrabalhando("");
    }
  }

  // Candidatos cuja margem, no preço escolhido, atinge a meta do anúncio
  const lucrativos = itens.filter((i) => {
    if (i.status !== "candidate") return false;
    const s = simular(porItem.get(i.id), precoEscolhido(i));
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
                  <tr className="border-b border-slate-200 text-left font-mono text-[11px] uppercase tracking-wider text-slate-500">
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
                  {c.promocoes.map((p) => {
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

      {aberta && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {aberta.promo.name} <span className="text-sm font-normal text-slate-500">· {TIPOS[aberta.promo.type] ?? aberta.promo.type}</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {total != null && <span className="font-mono text-xs text-slate-500">{itens.length} de {total} anúncios</span>}
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
                <tr className="border-b border-slate-200 text-left font-mono text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="p-3">Anúncio</th>
                  <th className="p-3 text-right">Preço atual</th>
                  <th className="p-3">Faixa permitida</th>
                  <th className="p-3">Preço na promoção</th>
                  <th className="p-3 text-right">Taxa</th>
                  <th className="p-3 text-right">Frete</th>
                  <th className="p-3 text-right">Imposto</th>
                  <th className="p-3 text-right">Custo</th>
                  <th className="p-3 text-right">Sobra</th>
                  <th className="p-3 text-right">Margem</th>
                  <th className="p-3">Status</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {itens.length === 0 && !carregandoItens && (
                  <tr>
                    <td className="p-4 text-slate-500" colSpan={11}>Nenhum anúncio nesta promoção.</td>
                  </tr>
                )}
                {itens.map((i) => {
                  const a = porItem.get(i.id);
                  const preco = precoEscolhido(i);
                  const s = simular(a, preco);
                  const st = STATUS_ITEM[i.status] ?? [i.status, "bg-slate-100 text-slate-600"];
                  const dentro = i.status === "started" || i.status === "pending" || i.status === "programmed";
                  return (
                    <tr key={i.id} className="border-b border-slate-100 align-top">
                      <td className="max-w-[300px] p-3">
                        <div className="truncate" title={a?.title}>{a?.title ?? "Anúncio fora do sistema"}</div>
                        <div className="font-mono text-[11px] text-slate-500">{i.id}</div>
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
                      <td className="p-3 text-right text-slate-700">{s ? brl(s.taxa) : "—"}</td>
                      <td className="p-3 text-right text-slate-700">{s ? brl(s.frete) : "—"}</td>
                      <td className="p-3 text-right text-slate-700">{s ? brl(s.imposto) : "—"}</td>
                      <td className="p-3 text-right text-slate-700">{s ? brl(s.custo) : <span className="text-amber-700">sem custo</span>}</td>
                      <td className={`p-3 text-right font-semibold ${s && s.lucro < 0 ? "text-red-700" : "text-emerald-800"}`}>
                        {s ? `${s.lucro < 0 ? "− " : "+ "}${brl(Math.abs(s.lucro))}` : "—"}
                      </td>
                      <td className={`p-3 text-right ${s && !s.ok ? "text-red-700" : ""}`} title={a ? `Meta: ${pct(Number(a.target_margin))}` : "Importe o anúncio e ligue a um produto para calcular"}>
                        {s ? pct(s.margem) : "—"}
                        {s && <div className={`text-[11px] ${s.lucro < 0 ? "text-red-700" : s.ok ? "text-emerald-700" : "text-amber-700"}`}>{s.lucro < 0 ? "prejuízo" : s.ok ? "atinge a meta" : "abaixo da meta"}</div>}
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
    </div>
  );
}
