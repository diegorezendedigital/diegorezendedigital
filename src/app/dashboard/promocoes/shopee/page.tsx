"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/supabase/client";
import { brl, campo, num, pct } from "@/lib/types";

type Loja = { shop_id: string; shop_name: string | null; store_name?: string | null };
type Relampago = { flash_sale_id: number; status?: number; start_time: number; end_time: number; enabled_item_count?: number; item_count?: number; type?: number; remindme_count?: number; click_count?: number };
type Desconto = { discount_id: number; discount_name: string; status: string; start_time: number; end_time: number };
type Cupom = {
  voucher_id: number; voucher_code?: string; voucher_name?: string; voucher_type?: number; reward_type?: number;
  usage_quantity?: number; current_usage?: number; start_time: number; end_time: number; voucher_purpose?: number;
  discount_amount?: number; percentage?: number; max_price?: number; min_basket_price?: number;
};
type Dados = { relampago: Relampago[]; descontos: Desconto[]; cupons: Cupom[]; erros: Record<string, string> };
type Aba = "relampago" | "descontos" | "cupons" | "robo";
type ItemOferta = { item_id: number; model_id: number | null; nome: string; variacao: string | null; preco_original: number; preco_promo: number; estoque: number; limite_compra: number; ativo?: boolean; custo?: number; margem?: number | null };
type Horario = { timeslot_id: number; start_time: number; end_time: number; ocupado?: boolean };
type Regra = {
  id: string; shop_id: string; nome: string; modelo_flash_sale_id: number | null; modelo_itens: ItemOferta[]; modo: "todos" | "diario" | "agenda";
  dias_semana: number[]; hora_inicio: number; hora_fim: number; dias_a_frente: number; margem_minima: number; imposto_pct: number; taxa_extra_pct: number;
  ativo: boolean; ultima_execucao: string | null; total_criadas: number;
  ultimo_resultado: { em: string; criadas: { inicio: number; itens: number; recusados: number }[]; pulados: { nome: string; motivo: string }[]; erros: string[]; aviso: string } | null;
};
const msgErro = (e: unknown) => (e instanceof Error ? e.message : String(e));
const off = (orig: number, promo: number) => (orig > 0 ? ((orig - promo) / orig) * 100 : 0);
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const dataHora = (s: number) =>
  new Date(s * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function situacao(inicio: number, fim: number) {
  const agora = Date.now() / 1000;
  if (agora < inicio) return { t: "Programada", c: "bg-sky-50 text-sky-700" };
  if (agora > fim) return { t: "Encerrada", c: "bg-slate-100 text-slate-500" };
  return { t: "Acontecendo", c: "bg-emerald-50 text-emerald-700" };
}

function Selo({ inicio, fim }: { inicio: number; fim: number }) {
  const s = situacao(inicio, fim);
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.c}`}>{s.t}</span>;
}

const RELAMPAGO_STATUS: Record<number, string> = { 0: "Excluída", 1: "Ativa", 2: "Desativada", 3: "Recusada pela Shopee" };
const PROPOSITO: Record<number, string> = { 0: "Público", 1: "Privado", 2: "Live", 3: "Vídeo" };

function beneficio(c: Cupom) {
  if (c.reward_type === 2) return `${c.percentage ?? 0}% off${c.max_price ? ` (até ${brl(c.max_price)})` : ""}`;
  if (c.reward_type === 3) return `${c.percentage ?? 0}% em moedas`;
  return `${brl(c.discount_amount ?? 0)} off`;
}

export default function PromocoesShopeePage() {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [loja, setLoja] = useState("");
  const [periodo, setPeriodo] = useState<"ativas" | "encerradas">("ativas");
  const [aba, setAba] = useState<Aba>("relampago");
  const [dados, setDados] = useState<Dados | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    apiFetch<{ accounts: Loja[] }>("/api/shopee/accounts")
      .then((r) => {
        setLojas(r.accounts ?? []);
        if (r.accounts?.[0]) setLoja(r.accounts[0].shop_id);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : String(e)));
  }, []);

  const carregar = useCallback(async () => {
    if (!loja) return;
    setCarregando(true);
    setErro("");
    try {
      setDados(await apiFetch<Dados>(`/api/shopee/promocoes?shop_id=${loja}&periodo=${periodo}`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [loja, periodo]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const contagem = { relampago: dados?.relampago.length ?? 0, descontos: dados?.descontos.length ?? 0, cupons: dados?.cupons.length ?? 0 };
  const ABAS: [Aba, string][] = [["relampago", "Oferta relâmpago"], ["descontos", "Promoções de desconto"], ["cupons", "Cupons"], ["robo", "Robô de relâmpago"]];
  const [abertaRel, setAbertaRel] = useState<number | null>(null);
  const [abertoDesc, setAbertoDesc] = useState<number | null>(null);
  const [duplicando, setDuplicando] = useState<number | null>(null);
  const [criando, setCriando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [paraRobo, setParaRobo] = useState<number | null>(null);

  async function mudarStatus(id: number, ativar: boolean) {
    try {
      await apiFetch("/api/shopee/relampago", { method: "POST", body: JSON.stringify({ acao: "status", shop_id: loja, flash_sale_id: id, ativar }) });
      setAviso(ativar ? "Oferta ativada." : "Oferta desativada.");
      carregar();
    } catch (e) {
      setAviso(msgErro(e));
    }
  }
  const erroAba = dados?.erros?.[aba];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Central de promoções · Shopee</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Acompanhe as ofertas relâmpago, as promoções de desconto e os cupons da sua loja na Shopee.
        </p>
      </div>

      {lojas.length === 0 && !erro ? (
        <div className="card text-sm text-slate-600">
          Nenhuma loja da Shopee conectada. <Link href="/dashboard/integracoes" className="text-brand underline">Conectar em Integrações</Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Loja</label>
            <select className="input" value={loja} onChange={(e) => setLoja(e.target.value)}>
              {lojas.map((l) => (
                <option key={l.shop_id} value={l.shop_id}>{l.store_name || l.shop_name || l.shop_id}</option>
              ))}
            </select>
          </div>
          <div className="flex rounded-xl bg-white p-1 shadow-sm">
            {(["ativas", "encerradas"] as const).map((p) => (
              <button key={p} onClick={() => setPeriodo(p)} className={`rounded-lg px-4 py-2 text-sm font-medium ${periodo === p ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                {p === "ativas" ? "Acontecendo e programadas" : "Encerradas"}
              </button>
            ))}
          </div>
          <button onClick={carregar} disabled={carregando} className="btn-ghost">{carregando ? "Atualizando…" : "Atualizar"}</button>
        </div>
      )}

      {erro && <div className="card border-red-200 bg-red-50 text-sm text-red-700">{erro}</div>}

      {loja && (
        <>
          <div className="flex flex-wrap gap-2" role="tablist">
            {ABAS.map(([id, nome]) => (
              <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
                className={`rounded-full px-4 py-2 text-sm font-medium ${aba === id ? "bg-brand text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                {nome} {id !== "robo" && <span className="ml-1 opacity-70">{contagem[id]}</span>}
              </button>
            ))}
          </div>

          {aviso && <div className="card flex items-center justify-between text-sm"><span>{aviso}</span><button className="btn-ghost" onClick={() => setAviso("")}>Fechar</button></div>}
          {aba === "relampago" && (
            <div className="flex justify-end">
              <button className="btn" onClick={() => setCriando(true)}>Criar oferta relâmpago</button>
            </div>
          )}
          {erroAba && (
            <div className="card border-amber-200 bg-amber-50 text-sm text-amber-800">
              A Shopee não liberou esta consulta: {erroAba}. Pode faltar permissão de promoções no app da Shopee.
            </div>
          )}

          {aba === "robo" ? (
            <Robo loja={loja} ofertas={dados?.relampago ?? []} preModelo={paraRobo} limparPre={() => setParaRobo(null)} />
          ) : (
          <div className="card overflow-x-auto p-0 tabela-pro">
            {carregando ? (
              <p className="p-5 text-sm text-slate-500">Carregando…</p>
            ) : aba === "relampago" ? (
              <table className="w-full text-sm">
                <thead><tr><th className="th">Início</th><th className="th">Fim</th><th className="th">Situação</th><th className="th">Status</th><th className="th text-right">Produtos ativos</th><th className="th text-right">Lembretes</th><th className="th text-right">Cliques</th><th className="th"></th></tr></thead>
                <tbody>
                  {dados?.relampago.length ? dados.relampago.sort((a, b) => a.start_time - b.start_time).map((f) => (
                    <Fragment key={f.flash_sale_id}>
                    <tr className="border-t border-slate-100">
                      <td className="td">{dataHora(f.start_time)}</td>
                      <td className="td">{dataHora(f.end_time)}</td>
                      <td className="td"><Selo inicio={f.start_time} fim={f.end_time} /></td>
                      <td className="td">{RELAMPAGO_STATUS[f.status ?? -1] ?? "—"}</td>
                      <td className="td text-right">{f.enabled_item_count ?? 0} de {f.item_count ?? 0}</td>
                      <td className="td text-right">{f.remindme_count ?? 0}</td>
                      <td className="td text-right">{f.click_count ?? 0}</td>
                      <td className="td whitespace-nowrap text-right">
                        <button className="btn-ghost" onClick={() => setAbertaRel(abertaRel === f.flash_sale_id ? null : f.flash_sale_id)}>{abertaRel === f.flash_sale_id ? "Fechar" : "Produtos"}</button>
                        <button className="btn-ghost" onClick={() => setDuplicando(f.flash_sale_id)}>Duplicar</button>
                        <button className="btn-ghost" onClick={() => { setParaRobo(f.flash_sale_id); setAba("robo"); }}>Usar no robô</button>
                        {f.type !== 3 && (f.status === 1
                          ? <button className="btn-ghost" onClick={() => mudarStatus(f.flash_sale_id, false)}>Desativar</button>
                          : f.status === 2 ? <button className="btn-ghost" onClick={() => mudarStatus(f.flash_sale_id, true)}>Ativar</button> : null)}
                      </td>
                    </tr>
                    {abertaRel === f.flash_sale_id && (
                      <tr><td colSpan={8} className="bg-slate-50 p-3"><ProdutosRelampago loja={loja} id={f.flash_sale_id} /></td></tr>
                    )}
                    </Fragment>
                  )) : <tr><td className="td text-slate-500" colSpan={8}>Nenhuma oferta relâmpago {periodo === "ativas" ? "acontecendo ou programada" : "encerrada"}.</td></tr>}
                </tbody>
              </table>
            ) : aba === "descontos" ? (
              <table className="w-full text-sm">
                <thead><tr><th className="th">Promoção</th><th className="th">Início</th><th className="th">Fim</th><th className="th">Situação</th><th className="th"></th></tr></thead>
                <tbody>
                  {dados?.descontos.length ? dados.descontos.sort((a, b) => a.start_time - b.start_time).map((d) => (
                    <Fragment key={d.discount_id}>
                    <tr className="border-t border-slate-100">
                      <td className="td font-medium">{d.discount_name}</td>
                      <td className="td">{dataHora(d.start_time)}</td>
                      <td className="td">{dataHora(d.end_time)}</td>
                      <td className="td"><Selo inicio={d.start_time} fim={d.end_time} /></td>
                      <td className="td text-right">
                        <button className="btn-ghost" onClick={() => setAbertoDesc(abertoDesc === d.discount_id ? null : d.discount_id)}>{abertoDesc === d.discount_id ? "Fechar" : "Ver e editar"}</button>
                      </td>
                    </tr>
                    {abertoDesc === d.discount_id && (
                      <tr><td colSpan={5} className="bg-slate-50 p-3"><ProdutosDesconto loja={loja} id={d.discount_id} encerrada={d.end_time * 1000 < Date.now()} /></td></tr>
                    )}
                    </Fragment>
                  )) : <tr><td className="td text-slate-500" colSpan={5}>Nenhuma promoção de desconto {periodo === "ativas" ? "acontecendo ou programada" : "encerrada"}.</td></tr>}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead><tr><th className="th">Cupom</th><th className="th">Código</th><th className="th">Benefício</th><th className="th">Pedido mínimo</th><th className="th">Vale para</th><th className="th">Tipo</th><th className="th text-right">Usados</th><th className="th">Período</th><th className="th">Situação</th></tr></thead>
                <tbody>
                  {dados?.cupons.length ? dados.cupons.sort((a, b) => a.start_time - b.start_time).map((c) => (
                    <tr key={c.voucher_id} className="border-t border-slate-100">
                      <td className="td font-medium">{c.voucher_name || "—"}</td>
                      <td className="td font-mono text-xs">{c.voucher_code || "—"}</td>
                      <td className="td">{beneficio(c)}</td>
                      <td className="td">{c.min_basket_price ? brl(c.min_basket_price) : "—"}</td>
                      <td className="td">{c.voucher_type === 2 ? "Produtos" : "Loja toda"}</td>
                      <td className="td">{PROPOSITO[c.voucher_purpose ?? -1] ?? "—"}</td>
                      <td className="td text-right">{c.current_usage ?? 0} de {c.usage_quantity ?? 0}</td>
                      <td className="td whitespace-nowrap">{dataHora(c.start_time)} a {dataHora(c.end_time)}</td>
                      <td className="td"><Selo inicio={c.start_time} fim={c.end_time} /></td>
                    </tr>
                  )) : <tr><td className="td text-slate-500" colSpan={9}>Nenhum cupom {periodo === "ativas" ? "acontecendo ou programado" : "encerrado"}.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
          )}
        </>
      )}
      {duplicando != null && <ModalDuplicar loja={loja} id={duplicando} fechar={() => setDuplicando(null)} pronto={(m) => { setDuplicando(null); setAviso(m); carregar(); }} />}
      {criando && <ModalCriar loja={loja} fechar={() => setCriando(false)} pronto={(m) => { setCriando(false); setAviso(m); carregar(); }} />}
    </div>
  );
}

// ---------- Produtos de uma oferta relâmpago ----------
function ProdutosRelampago({ loja, id }: { loja: string; id: number }) {
  const [itens, setItens] = useState<ItemOferta[] | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    apiFetch<{ itens: ItemOferta[] }>(`/api/shopee/relampago?shop_id=${loja}&flash_sale_id=${id}`).then((r) => setItens(r.itens)).catch((e) => setErro(msgErro(e)));
  }, [loja, id]);
  if (erro) return <p className="text-sm text-red-700">{erro}</p>;
  if (!itens) return <p className="text-sm text-slate-500">Carregando produtos…</p>;
  if (!itens.length) return <p className="text-sm text-slate-500">Oferta sem produtos.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr><th className="th">Produto</th><th className="th text-right">Preço normal</th><th className="th text-right">Preço relâmpago</th><th className="th text-right">Desconto</th><th className="th text-right">Estoque</th><th className="th text-right">Margem</th></tr></thead>
      <tbody>
        {itens.map((i) => (
          <tr key={`${i.item_id}:${i.model_id}`} className="border-t border-slate-200">
            <td className="td">{i.nome}{i.variacao && <span className="text-slate-500"> · {i.variacao}</span>}{i.ativo === false && <span className="ml-1 text-xs text-slate-400">(inativo)</span>}</td>
            <td className="td text-right">{brl(i.preco_original)}</td>
            <td className="td text-right font-medium">{brl(i.preco_promo)}</td>
            <td className="td text-right">{pct(off(i.preco_original, i.preco_promo))}</td>
            <td className="td text-right">{i.estoque}</td>
            <td className={`td text-right ${i.margem != null && i.margem < 0 ? "text-red-700" : ""}`}>{i.margem == null ? <span className="text-xs text-slate-400">sem custo</span> : pct(i.margem)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Produtos de uma promoção de desconto (formato da Shopee: produto e variações embaixo) ----------
type VarDesc = { model_id: number; nome: string; sku: string | null; preco_original: number; preco_promo: number | null; estoque: number; estoque_promo: number | null; ativo: boolean };
type ProdDesc = { item_id: number; nome: string; imagem: string | null; limite_compra: number; variacoes: VarDesc[] };

function ProdutosDesconto({ loja, id, encerrada }: { loja: string; id: number; encerrada: boolean }) {
  const [produtos, setProdutos] = useState<ProdDesc[] | null>(null);
  const [precos, setPrecos] = useState<Record<string, string>>({});
  const [limites, setLimites] = useState<Record<number, string>>({});
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [trocando, setTrocando] = useState("");
  const [msg, setMsg] = useState("");
  const k = (p: ProdDesc, v: VarDesc) => `${p.item_id}:${v.model_id}`;

  const carregar = useCallback(() => {
    apiFetch<{ produtos: ProdDesc[] }>(`/api/shopee/descontos?shop_id=${loja}&discount_id=${id}`)
      .then((r) => {
        setProdutos(r.produtos);
        setPrecos(Object.fromEntries(r.produtos.flatMap((p) => p.variacoes.map((v) => [k(p, v), v.preco_promo != null ? campo(v.preco_promo) : ""]))));
        setLimites(Object.fromEntries(r.produtos.map((p) => [p.item_id, String(p.limite_compra || "")])));
      })
      .catch((e) => setErro(msgErro(e)));
  }, [loja, id]);
  useEffect(carregar, [carregar]);

  if (erro) return <p className="text-sm text-red-700">{erro}</p>;
  if (!produtos) return <p className="text-sm text-slate-500">Carregando produtos e variações…</p>;

  const mudouPreco = (p: ProdDesc, v: VarDesc) => v.ativo && num(precos[k(p, v)] ?? "") > 0 && num(precos[k(p, v)] ?? "") !== v.preco_promo;
  const mudouLimite = (p: ProdDesc) => num(limites[p.item_id] ?? "") !== p.limite_compra;
  const alterados = produtos.filter((p) => mudouLimite(p) || p.variacoes.some((v) => mudouPreco(p, v)));
  const termos = busca.toLowerCase().split(/\s+/).filter(Boolean);
  const visiveis = termos.length ? produtos.filter((p) => termos.every((t) => `${p.nome} ${p.item_id}`.toLowerCase().includes(t))) : produtos;

  async function salvar() {
    setSalvando(true); setMsg("");
    try {
      const r = await apiFetch<{ falhas: { motivo: string }[] }>("/api/shopee/descontos", {
        method: "POST",
        body: JSON.stringify({
          acao: "salvar", shop_id: loja, discount_id: id,
          produtos: alterados.map((p) => ({
            item_id: p.item_id, limite_compra: Math.round(num(limites[p.item_id] ?? "")),
            variacoes: p.variacoes.filter((v) => v.ativo).map((v) => ({ model_id: v.model_id, preco_promo: num(precos[k(p, v)] ?? "") || v.preco_promo })),
          })),
        }),
      });
      setMsg(r.falhas?.length ? `Salvo, mas a Shopee recusou ${r.falhas.length}: ${r.falhas.map((f) => f.motivo).join("; ")}` : "Alterações salvas na Shopee.");
      carregar();
    } catch (e) { setMsg(msgErro(e)); } finally { setSalvando(false); }
  }

  async function alternar(p: ProdDesc, v: VarDesc) {
    const chave = k(p, v);
    setTrocando(chave); setMsg("");
    try {
      await apiFetch("/api/shopee/descontos", {
        method: "POST",
        body: JSON.stringify(v.ativo
          ? { acao: "desativar", shop_id: loja, discount_id: id, item_id: p.item_id, model_id: v.model_id }
          : { acao: "ativar", shop_id: loja, discount_id: id, item_id: p.item_id, model_id: v.model_id, preco_promo: num(precos[chave] ?? ""), limite_compra: Math.round(num(limites[p.item_id] ?? "")) }),
      });
      setMsg(v.ativo ? `${v.nome} saiu da promoção.` : `${v.nome} entrou na promoção.`);
      carregar();
    } catch (e) { setMsg(msgErro(e)); } finally { setTrocando(""); }
  }

  const total = produtos.length;
  return (
    <div className="space-y-3 rounded-2xl bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input className="input max-w-sm" placeholder="Buscar pelo nome ou ID do anúncio" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className="text-sm text-slate-500"><b>{total}</b> {total === 1 ? "produto" : "produtos"} no total</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Nome do produto</th><th className="th">Preço original</th><th className="th">Preço com desconto</th><th className="th">Desconto</th>
              <th className="th text-right">Estoque</th><th className="th text-right">Estoque de promoção</th><th className="th">Limite de compra</th><th className="th text-center">Habilitar / Desabilitar</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((p) => (
              <Fragment key={p.item_id}>
                <tr className="border-t border-slate-200 bg-slate-50/70">
                  <td className="td" colSpan={6}>
                    <div className="flex items-center gap-3">
                      {p.imagem ? <img src={p.imagem} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <div className="h-10 w-10 rounded-lg bg-slate-200" />}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{p.nome}</div>
                        <div className="text-xs text-slate-500">ID do anúncio: <span className="font-mono">{p.item_id}</span></div>
                      </div>
                    </div>
                  </td>
                  <td className="td" colSpan={2}>
                    <div className="flex items-center gap-2">
                      <input className="input w-24" inputMode="numeric" disabled={encerrada} placeholder="Sem limite" value={limites[p.item_id] ?? ""} onChange={(e) => setLimites({ ...limites, [p.item_id]: e.target.value.replace(/\D/g, "") })} />
                      <span className="text-xs text-slate-500">por comprador</span>
                    </div>
                  </td>
                </tr>
                {p.variacoes.map((v) => {
                  const chave = k(p, v);
                  const preco = num(precos[chave] ?? "");
                  const pctOff = v.preco_original > 0 && preco > 0 ? ((v.preco_original - preco) / v.preco_original) * 100 : 0;
                  const desab = encerrada;
                  return (
                    <tr key={chave} className={`border-t border-slate-100 ${v.ativo ? "" : "text-slate-400"}`}>
                      <td className="td pl-14">
                        <div>{v.nome}</div>
                        <div className="text-xs text-slate-500">ID da variação: <span className="font-mono">{v.model_id || "—"}</span>{v.sku ? ` · SKU ${v.sku}` : ""}</div>
                        {v.estoque === 0 && <div className="text-xs text-red-600">Esgotado</div>}
                      </td>
                      <td className="td whitespace-nowrap">{brl(v.preco_original)}</td>
                      <td className="td">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-slate-500">R$</span>
                          <input className="input w-24" inputMode="decimal" disabled={desab} value={precos[chave] ?? ""} placeholder={campo(v.preco_original)}
                            onChange={(e) => setPrecos({ ...precos, [chave]: e.target.value })} />
                        </div>
                      </td>
                      <td className="td">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-slate-500">ou</span>
                          <input className="input w-16" inputMode="decimal" disabled={desab} value={preco > 0 ? campo(Math.round(pctOff * 10) / 10) : ""}
                            onChange={(e) => {
                              const pc = num(e.target.value);
                              setPrecos({ ...precos, [chave]: pc > 0 && pc < 100 ? campo(Math.round(v.preco_original * (1 - pc / 100) * 100) / 100) : "" });
                            }} />
                          <span className="text-xs text-slate-500">%OFF</span>
                        </div>
                      </td>
                      <td className="td text-right">{v.estoque}</td>
                      <td className="td text-right">{v.estoque_promo ?? "Sem limite"}</td>
                      <td className="td" />
                      <td className="td text-center">
                        <button type="button" role="switch" aria-checked={v.ativo} disabled={encerrada || trocando === chave} onClick={() => alternar(p, v)}
                          title={v.ativo ? "Tirar da promoção" : "Colocar na promoção com o preço informado"}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${v.ativo ? "bg-emerald-500" : "bg-slate-300"}`}>
                          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${v.ativo ? "translate-x-5" : "translate-x-0.5"}`} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {!encerrada && (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" disabled={!alterados.length || salvando} onClick={salvar}>
            {salvando ? "Salvando…" : alterados.length ? `Salvar alterações (${alterados.length} ${alterados.length === 1 ? "produto" : "produtos"})` : "Salvar alterações"}
          </button>
          <span className="text-xs text-slate-500">A chave liga e desliga na hora. Para ligar uma variação, informe antes o preço com desconto.</span>
        </div>
      )}
      {msg && <p className="text-sm text-slate-700">{msg}</p>}
    </div>
  );
}

// ---------- Escolha de horários da Shopee ----------
function useHorarios(loja: string) {
  const [horarios, setHorarios] = useState<Horario[] | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    apiFetch<{ horarios: Horario[] }>(`/api/shopee/relampago?shop_id=${loja}&horarios=1&dias=7`).then((r) => setHorarios(r.horarios)).catch((e) => setErro(msgErro(e)));
  }, [loja]);
  return { horarios, erro };
}
const faixaHorario = (h: Horario) =>
  `${new Date(h.start_time * 1000).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })} · ${new Date(h.start_time * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} às ${new Date(h.end_time * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

function Modal({ titulo, fechar, children }: { titulo: string; fechar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={fechar}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">{titulo}</h2><button className="btn-ghost" onClick={fechar}>Fechar</button></div>
        {children}
      </div>
    </div>
  );
}

function ModalDuplicar({ loja, id, fechar, pronto }: { loja: string; id: number; fechar: () => void; pronto: (m: string) => void }) {
  const { horarios, erro } = useHorarios(loja);
  const [sel, setSel] = useState<number[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState("");
  async function duplicar() {
    setEnviando(true); setFalha("");
    try {
      const r = await apiFetch<{ criadas: { flash_sale_id?: number; erro?: string; recusados?: number }[] }>("/api/shopee/relampago", { method: "POST", body: JSON.stringify({ acao: "duplicar", shop_id: loja, flash_sale_id: id, timeslot_ids: sel }) });
      const ok = r.criadas.filter((c) => c.flash_sale_id).length;
      const erros = r.criadas.filter((c) => c.erro).map((c) => c.erro);
      pronto(`${ok} ${ok === 1 ? "oferta criada" : "ofertas criadas"}.${erros.length ? ` Falharam ${erros.length}: ${erros.join("; ")}` : ""}`);
    } catch (e) { setFalha(msgErro(e)); setEnviando(false); }
  }
  return (
    <Modal titulo="Duplicar oferta relâmpago" fechar={fechar}>
      <p className="mb-3 text-sm text-slate-600">Escolha os horários. Os mesmos produtos, preços e estoques da oferta são copiados para cada horário.</p>
      {erro && <p className="text-sm text-red-700">{erro}</p>}
      {!horarios && !erro && <p className="text-sm text-slate-500">Buscando horários da Shopee…</p>}
      {horarios && (
        <div className="max-h-80 space-y-1 overflow-auto">
          {horarios.length === 0 && <p className="text-sm text-slate-500">A Shopee não ofereceu horários nos próximos 7 dias.</p>}
          {horarios.map((h) => (
            <label key={h.timeslot_id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${h.ocupado ? "text-slate-400" : "hover:bg-slate-50"}`}>
              <input type="checkbox" disabled={h.ocupado} checked={sel.includes(h.timeslot_id)} onChange={(e) => setSel(e.target.checked ? [...sel, h.timeslot_id] : sel.filter((x) => x !== h.timeslot_id))} />
              {faixaHorario(h)} {h.ocupado && "· já tem oferta"}
            </label>
          ))}
        </div>
      )}
      {falha && <p className="mt-2 text-sm text-red-700">{falha}</p>}
      <div className="mt-4 flex justify-end"><button className="btn" disabled={!sel.length || enviando} onClick={duplicar}>{enviando ? "Criando…" : `Duplicar em ${sel.length} ${sel.length === 1 ? "horário" : "horários"}`}</button></div>
    </Modal>
  );
}

type Anuncio = { external_id: string; title: string; price: number; thumbnail: string | null; sku: string | null; status: string | null };
type Familia = { item_id: string; nome: string; foto: string | null; filhos: (Anuncio & { variacao: string; model_id: string | null })[] };

// Agrupa as variações pelo anúncio principal (pai). O título da variação na base é "Nome - Variação".
function agruparFamilias(lista: Anuncio[]): Familia[] {
  const grupos = new Map<string, Anuncio[]>();
  for (const a of lista) {
    const pai = a.external_id.split(":")[0];
    grupos.set(pai, [...(grupos.get(pai) ?? []), a]);
  }
  return Array.from(grupos.entries()).map(([item_id, g]) => {
    let prefixo = g[0].title;
    for (const x of g.slice(1)) while (prefixo && !x.title.startsWith(prefixo)) prefixo = prefixo.slice(0, -1);
    const corte = g.length > 1 ? prefixo.lastIndexOf(" - ") : -1;
    const nome = corte > 0 ? prefixo.slice(0, corte) : g.length > 1 ? prefixo.trim() : g[0].title;
    return {
      item_id, nome, foto: g.find((x) => x.thumbnail)?.thumbnail ?? null,
      filhos: g
        .map((x) => ({ ...x, model_id: x.external_id.split(":")[1] ?? null, variacao: x.external_id.includes(":") ? x.title.slice(nome.length).replace(/^\s*-\s*/, "") || x.title : "Sem variação" }))
        .sort((p, q) => p.variacao.localeCompare(q.variacao, "pt-BR", { numeric: true })),
    };
  }).sort((p, q) => p.nome.localeCompare(q.nome, "pt-BR"));
}

function ModalCriar({ loja, fechar, pronto }: { loja: string; fechar: () => void; pronto: (m: string) => void }) {
  const { horarios, erro } = useHorarios(loja);
  const [slot, setSlot] = useState<number | null>(null);
  const [anuncios, setAnuncios] = useState<Anuncio[] | null>(null);
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set<string>());
  const [abertos, setAbertos] = useState<Set<string>>(new Set<string>());
  const [valores, setValores] = useState<Record<string, { preco: string; estoque: string }>>({});
  const [descTodos, setDescTodos] = useState("10");
  const [estTodos, setEstTodos] = useState("10");
  const [passo, setPasso] = useState<"escolher" | "precos">("escolher");
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState("");

  useEffect(() => {
    apiFetch<{ anuncios: Anuncio[] }>(`/api/shopee/relampago?shop_id=${loja}&anuncios=1`)
      .then((r) => setAnuncios(r.anuncios.filter((a) => !a.status || a.status === "active")))
      .catch((e) => setFalha(msgErro(e)));
  }, [loja]);

  const familias = agruparFamilias(anuncios ?? []);
  const termos = busca.toLowerCase().split(/\s+/).filter(Boolean);
  const visiveis = termos.length
    ? familias.filter((f) => termos.every((t) => `${f.nome} ${f.item_id} ${f.filhos.map((x) => `${x.variacao} ${x.model_id ?? ""} ${x.sku ?? ""}`).join(" ")}`.toLowerCase().includes(t)))
    : familias;
  const porId = new Map<string, Anuncio>((anuncios ?? []).map((a) => [a.external_id, a] as [string, Anuncio]));

  function marcar(ids: string[], on: boolean) {
    const n = new Set(marcados);
    ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
    setMarcados(n);
  }
  function alternarAberto(id: string) {
    const n = new Set(abertos);
    if (n.has(id)) n.delete(id); else n.add(id);
    setAbertos(n);
  }
  const precoComDesconto = (p: number, d: string) => campo(Math.floor(p * (1 - num(d) / 100) * 100) / 100);

  function irParaPrecos() {
    const v: Record<string, { preco: string; estoque: string }> = {};
    marcados.forEach((id) => (v[id] = valores[id] ?? { preco: precoComDesconto(Number(porId.get(id)?.price ?? 0), descTodos), estoque: estTodos }));
    setValores(v);
    setPasso("precos");
  }
  function aplicarTodos() {
    const v = { ...valores };
    marcados.forEach((id) => (v[id] = { preco: precoComDesconto(Number(porId.get(id)?.price ?? 0), descTodos), estoque: estTodos }));
    setValores(v);
  }

  const selecionados = Array.from(marcados).map((id: string) => porId.get(id)).filter(Boolean) as Anuncio[];
  const familiasSel = agruparFamilias(selecionados);
  const valido = slot != null && selecionados.length > 0 && selecionados.every((a) => num(valores[a.external_id]?.preco ?? "") > 0 && num(valores[a.external_id]?.preco ?? "") < Number(a.price) && num(valores[a.external_id]?.estoque ?? "") > 0);

  async function criar() {
    setEnviando(true); setFalha("");
    const itens = selecionados.map((a) => {
      const [item, modelo] = a.external_id.split(":");
      return { item_id: Number(item), model_id: modelo ? Number(modelo) : null, nome: a.title, variacao: null, preco_original: Number(a.price), preco_promo: num(valores[a.external_id].preco), estoque: Math.round(num(valores[a.external_id].estoque)), limite_compra: 0 };
    });
    try {
      const r = await apiFetch<{ flash_sale_id: number; recusados: { motivo: string }[] }>("/api/shopee/relampago", { method: "POST", body: JSON.stringify({ acao: "criar", shop_id: loja, timeslot_id: slot, itens }) });
      pronto(`Oferta criada com ${itens.length - r.recusados.length} ${itens.length - r.recusados.length === 1 ? "variação" : "variações"}.${r.recusados.length ? ` A Shopee recusou ${r.recusados.length}: ${r.recusados.map((x) => x.motivo).join("; ")}` : ""}`);
    } catch (e) { setFalha(msgErro(e)); setEnviando(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={fechar}>
      <div className="flex h-[90vh] w-full max-w-6xl flex-col rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Criar oferta relâmpago</h2>
            <p className="text-xs text-slate-500">{passo === "escolher" ? "1. Escolha o horário e marque os produtos" : "2. Defina o preço relâmpago e o estoque"}</p>
          </div>
          <button className="btn-ghost" onClick={fechar}>Fechar</button>
        </div>

        {passo === "escolher" ? (
          <>
            <div className="grid gap-3 border-b border-slate-100 px-6 py-4 md:grid-cols-2">
              <div>
                <label className="label">Horário</label>
                {erro && <p className="text-sm text-red-700">{erro}</p>}
                <select className="input" value={slot ?? ""} onChange={(e) => setSlot(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{horarios ? "Escolha o horário" : "Buscando horários…"}</option>
                  {horarios?.filter((h) => !h.ocupado).map((h) => <option key={h.timeslot_id} value={h.timeslot_id}>{faixaHorario(h)}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Buscar</label>
                <input className="input" placeholder="Nome, ID do anúncio, ID da variação ou SKU" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
            </div>
            <div className="flex-1 overflow-auto px-6">
              {!anuncios ? (
                <p className="py-6 text-sm text-slate-500">Carregando anúncios…</p>
              ) : visiveis.length === 0 ? (
                <p className="py-6 text-sm text-slate-500">Nenhum anúncio encontrado. Importe os anúncios da Shopee em Produtos &gt; Anúncios Marketplace.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-white">
                    <tr className="border-b border-slate-200">
                      <th className="th w-10">
                        <input type="checkbox" title="Marcar todos os da lista"
                          checked={visiveis.length > 0 && visiveis.every((f) => f.filhos.every((x) => marcados.has(x.external_id)))}
                          onChange={(e) => marcar(visiveis.flatMap((f) => f.filhos.map((x) => x.external_id)), e.target.checked)} />
                      </th>
                      <th className="th">Produto</th><th className="th">ID</th><th className="th">SKU</th><th className="th text-right">Preço</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((f) => {
                      const ids = f.filhos.map((x) => x.external_id);
                      const qtd = ids.filter((id) => marcados.has(id)).length;
                      const aberto = abertos.has(f.item_id) || termos.length > 0;
                      const precos = f.filhos.map((x) => Number(x.price));
                      const min = Math.min(...precos), max = Math.max(...precos);
                      const temVariacao = f.filhos.some((x) => x.model_id);
                      return (
                        <Fragment key={f.item_id}>
                          <tr className="border-t border-slate-100 bg-slate-50/70">
                            <td className="td">
                              <input type="checkbox" checked={qtd === ids.length} ref={(el) => { if (el) el.indeterminate = qtd > 0 && qtd < ids.length; }}
                                onChange={(e) => marcar(ids, e.target.checked)} />
                            </td>
                            <td className="td">
                              <button type="button" className="flex items-center gap-3 text-left" onClick={() => temVariacao && alternarAberto(f.item_id)}>
                                {f.foto ? <img src={f.foto} alt="" className="h-9 w-9 rounded-lg object-cover" /> : <div className="h-9 w-9 rounded-lg bg-slate-200" />}
                                <span>
                                  <span className="block font-medium">{f.nome}</span>
                                  {temVariacao && <span className="text-xs text-brand">{aberto ? "▾" : "▸"} {f.filhos.length} variações{qtd ? ` · ${qtd} marcadas` : ""}</span>}
                                </span>
                              </button>
                            </td>
                            <td className="td font-mono text-xs text-slate-600">{f.item_id}</td>
                            <td className="td text-xs text-slate-500">{!temVariacao ? f.filhos[0].sku ?? "—" : ""}</td>
                            <td className="td whitespace-nowrap text-right">{min === max ? brl(min) : `${brl(min)} a ${brl(max)}`}</td>
                          </tr>
                          {temVariacao && aberto && f.filhos.map((x) => (
                            <tr key={x.external_id} className="border-t border-slate-100">
                              <td className="td pl-6"><input type="checkbox" checked={marcados.has(x.external_id)} onChange={(e) => marcar([x.external_id], e.target.checked)} /></td>
                              <td className="td pl-14">{x.variacao}</td>
                              <td className="td font-mono text-xs text-slate-500">{x.model_id}</td>
                              <td className="td text-xs text-slate-500">{x.sku ?? "—"}</td>
                              <td className="td text-right">{brl(Number(x.price))}</td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
              <span className="text-sm text-slate-600"><b>{marcados.size}</b> {marcados.size === 1 ? "variação marcada" : "variações marcadas"}{marcados.size > 0 && <button className="ml-3 text-xs text-slate-500 underline" onClick={() => setMarcados(new Set<string>())}>limpar</button>}</span>
              <button className="btn" disabled={!marcados.size} onClick={irParaPrecos}>Continuar</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-6 py-4">
              <div><label className="label">Desconto para todos (%)</label><input className="input w-28" inputMode="decimal" value={descTodos} onChange={(e) => setDescTodos(e.target.value)} /></div>
              <div><label className="label">Estoque para todos</label><input className="input w-28" inputMode="numeric" value={estTodos} onChange={(e) => setEstTodos(e.target.value)} /></div>
              <button className="btn-ghost" onClick={aplicarTodos}>Aplicar a todos</button>
              <span className="ml-auto text-sm text-slate-500">{slot ? horarios?.find((h) => h.timeslot_id === slot) && faixaHorario(horarios.find((h) => h.timeslot_id === slot)!) : "Sem horário escolhido"}</span>
            </div>
            <div className="flex-1 overflow-auto px-6">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white">
                  <tr className="border-b border-slate-200"><th className="th">Produto</th><th className="th">ID</th><th className="th text-right">Preço</th><th className="th">Preço relâmpago</th><th className="th text-right">Desconto</th><th className="th">Estoque</th><th className="th"></th></tr>
                </thead>
                <tbody>
                  {familiasSel.map((f) => (
                    <Fragment key={f.item_id}>
                      <tr className="border-t border-slate-100 bg-slate-50/70">
                        <td className="td" colSpan={7}>
                          <div className="flex items-center gap-3">
                            {f.foto ? <img src={f.foto} alt="" className="h-8 w-8 rounded-lg object-cover" /> : <div className="h-8 w-8 rounded-lg bg-slate-200" />}
                            <span className="font-medium">{f.nome}</span>
                            <span className="font-mono text-xs text-slate-500">ID {f.item_id}</span>
                          </div>
                        </td>
                      </tr>
                      {f.filhos.map((x) => {
                        const v = valores[x.external_id] ?? { preco: "", estoque: "" };
                        const p = num(v.preco);
                        const ruim = p <= 0 || p >= Number(x.price);
                        return (
                          <tr key={x.external_id} className="border-t border-slate-100">
                            <td className="td pl-14">{x.variacao}</td>
                            <td className="td font-mono text-xs text-slate-500">{x.model_id ?? "—"}</td>
                            <td className="td text-right">{brl(Number(x.price))}</td>
                            <td className="td"><input className={`input w-28 ${ruim ? "border-amber-400" : ""}`} inputMode="decimal" value={v.preco} onChange={(e) => setValores({ ...valores, [x.external_id]: { ...v, preco: e.target.value } })} /></td>
                            <td className="td text-right">{p > 0 ? pct(off(Number(x.price), p)) : "—"}</td>
                            <td className="td"><input className="input w-20" inputMode="numeric" value={v.estoque} onChange={(e) => setValores({ ...valores, [x.external_id]: { ...v, estoque: e.target.value.replace(/\D/g, "") } })} /></td>
                            <td className="td"><button className="btn-ghost" onClick={() => marcar([x.external_id], false)}>Tirar</button></td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
              <button className="btn-ghost" onClick={() => setPasso("escolher")}>Voltar</button>
              <div className="flex items-center gap-3">
                {falha && <span className="text-sm text-red-700">{falha}</span>}
                {!slot && <span className="text-xs text-amber-700">Escolha o horário no passo 1</span>}
                <button className="btn" disabled={!valido || enviando} onClick={criar}>{enviando ? "Criando…" : `Criar oferta com ${selecionados.length} ${selecionados.length === 1 ? "variação" : "variações"}`}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Robô de relâmpago ----------
const REGRA_NOVA = { nome: "Robô de relâmpago", modo: "todos" as const, dias_semana: [0, 1, 2, 3, 4, 5, 6], hora_inicio: 0, hora_fim: 24, dias_a_frente: 3, margem_minima: 10, imposto_pct: 10, taxa_extra_pct: 5, ativo: true };
type Rascunho = Partial<Regra> & { modelo_atual?: number | null };

function Robo({ loja, ofertas, preModelo, limparPre }: { loja: string; ofertas: Relampago[]; preModelo: number | null; limparPre: () => void }) {
  const [regras, setRegras] = useState<Regra[] | null>(null);
  const [precisaSQL, setPrecisaSQL] = useState(false);
  const [edit, setEdit] = useState<Rascunho | null>(null);
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState("");
  const carregar = useCallback(() => {
    apiFetch<{ regras: Regra[]; precisaSQL?: boolean }>(`/api/shopee/robo?shop_id=${loja}`).then((r) => { setRegras(r.regras); setPrecisaSQL(!!r.precisaSQL); }).catch((e) => setMsg(msgErro(e)));
  }, [loja]);
  useEffect(carregar, [carregar]);
  useEffect(() => {
    if (preModelo != null) { setEdit({ ...REGRA_NOVA, modelo_flash_sale_id: preModelo }); limparPre(); }
  }, [preModelo, limparPre]);

  async function salvar() {
    if (!edit) return;
    setOcupado("salvar"); setMsg("");
    try {
      await apiFetch("/api/shopee/robo", { method: "POST", body: JSON.stringify({ acao: "salvar", regra: { ...edit, shop_id: loja } }) });
      setEdit(null); setMsg("Regra salva."); carregar();
    } catch (e) { setMsg(msgErro(e)); } finally { setOcupado(""); }
  }
  async function rodar(id: string) {
    setOcupado(id); setMsg("");
    try {
      const r = await apiFetch<{ resultado: NonNullable<Regra["ultimo_resultado"]> }>("/api/shopee/robo", { method: "POST", body: JSON.stringify({ acao: "rodar", id }) });
      setMsg(`${r.resultado.criadas.length} ${r.resultado.criadas.length === 1 ? "oferta criada" : "ofertas criadas"}.${r.resultado.erros.length ? ` Erros: ${r.resultado.erros.join("; ")}` : ""} ${r.resultado.aviso}`);
      carregar();
    } catch (e) { setMsg(msgErro(e)); } finally { setOcupado(""); }
  }
  async function alternar(r: Regra) {
    await apiFetch("/api/shopee/robo", { method: "POST", body: JSON.stringify({ acao: "salvar", regra: { ...r, ativo: !r.ativo, modelo_atual: r.modelo_flash_sale_id } }) }).catch((e) => setMsg(msgErro(e)));
    carregar();
  }
  async function excluir(id: string) {
    if (!confirm("Excluir esta regra? As ofertas já criadas continuam na Shopee.")) return;
    await apiFetch(`/api/shopee/robo?id=${id}`, { method: "DELETE" }).catch((e) => setMsg(msgErro(e)));
    carregar();
  }

  const MODOS = { todos: "Todos os horários livres", diario: "Uma oferta por dia", agenda: "Dias e horários escolhidos" };
  if (precisaSQL)
    return (
      <div className="card text-sm">
        Rode este SQL no Supabase para usar o robô: o arquivo <code>supabase/migrations/20261204_shopee_robo_relampago.sql</code>.
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="card text-sm text-slate-600">
        O robô copia os produtos e preços de uma oferta modelo para os horários livres de relâmpago da Shopee. Ele roda sozinho uma vez por dia (8h30) e agenda até alguns dias à frente; produto sem custo no armazém ou abaixo da margem mínima fica de fora.
      </div>
      {msg && <div className="card text-sm">{msg}</div>}
      {!edit && <div className="flex justify-end"><button className="btn" onClick={() => setEdit({ ...REGRA_NOVA })}>Nova regra</button></div>}

      {edit && (
        <div className="card space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="label">Nome</label><input className="input" value={edit.nome ?? ""} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></div>
            <div>
              <label className="label">Oferta modelo (produtos e preços)</label>
              <select className="input" value={edit.modelo_flash_sale_id ?? ""} onChange={(e) => setEdit({ ...edit, modelo_flash_sale_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">{edit.modelo_itens?.length ? `Manter o modelo atual (${edit.modelo_itens.length} produtos)` : "Escolha uma oferta"}</option>
                {ofertas.map((o) => <option key={o.flash_sale_id} value={o.flash_sale_id}>{dataHora(o.start_time)} · {o.item_count ?? 0} produtos</option>)}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">Lista as ofertas do filtro de cima. Para usar uma encerrada, troque o filtro para Encerradas.</p>
            </div>
            <div>
              <label className="label">Frequência</label>
              <select className="input" value={edit.modo} onChange={(e) => setEdit({ ...edit, modo: e.target.value as Regra["modo"] })}>
                {Object.entries(MODOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><label className="label">Agendar até quantos dias à frente</label><input className="input" inputMode="numeric" value={edit.dias_a_frente ?? 3} onChange={(e) => setEdit({ ...edit, dias_a_frente: Number(e.target.value) || 1 })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Começar a partir de (hora)</label><input className="input" inputMode="numeric" value={edit.hora_inicio ?? 0} onChange={(e) => setEdit({ ...edit, hora_inicio: Number(e.target.value) || 0 })} /></div>
              <div><label className="label">Até (hora)</label><input className="input" inputMode="numeric" value={edit.hora_fim ?? 24} onChange={(e) => setEdit({ ...edit, hora_fim: Number(e.target.value) || 24 })} /></div>
            </div>
            {edit.modo === "agenda" && (
              <div>
                <label className="label">Dias da semana</label>
                <div className="flex flex-wrap gap-2">
                  {DIAS.map((d, i) => {
                    const on = edit.dias_semana?.includes(i);
                    return <button key={d} type="button" onClick={() => setEdit({ ...edit, dias_semana: on ? edit.dias_semana!.filter((x) => x !== i) : [...(edit.dias_semana ?? []), i] })} className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>{d}</button>;
                  })}
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3 md:col-span-2">
              <div><label className="label">Margem mínima (%)</label><input className="input" inputMode="decimal" value={edit.margem_minima ?? 0} onChange={(e) => setEdit({ ...edit, margem_minima: num(e.target.value) })} /></div>
              <div><label className="label">Imposto (%)</label><input className="input" inputMode="decimal" value={edit.imposto_pct ?? 10} onChange={(e) => setEdit({ ...edit, imposto_pct: num(e.target.value) })} /></div>
              <div><label className="label">Outras taxas Shopee (%)</label><input className="input" inputMode="decimal" value={edit.taxa_extra_pct ?? 5} onChange={(e) => setEdit({ ...edit, taxa_extra_pct: num(e.target.value) })} /></div>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn" disabled={ocupado === "salvar" || (!edit.modelo_flash_sale_id && !edit.modelo_itens?.length)} onClick={salvar}>{ocupado === "salvar" ? "Salvando…" : "Salvar regra"}</button>
            <button className="btn-ghost" onClick={() => setEdit(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {regras?.length === 0 && !edit && <div className="card text-sm text-slate-500">Nenhuma regra ainda. Crie uma ou use “Usar no robô” numa oferta relâmpago.</div>}
      {regras?.map((r) => (
        <div key={r.id} className="card space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold">{r.nome} <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${r.ativo ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{r.ativo ? "Ligado" : "Desligado"}</span></p>
              <p className="text-sm text-slate-600">
                {MODOS[r.modo]}{r.modo === "agenda" ? ` (${r.dias_semana.map((d) => DIAS[d]).join(", ")})` : ""} · das {r.hora_inicio}h às {r.hora_fim}h · até {r.dias_a_frente} dias à frente · {r.modelo_itens?.length ?? 0} produtos · margem mínima {pct(Number(r.margem_minima))}
              </p>
              <p className="text-xs text-slate-500">{r.total_criadas} ofertas criadas no total{r.ultima_execucao ? ` · última rodada ${new Date(r.ultima_execucao).toLocaleString("pt-BR")}` : ""}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              <button className="btn-ghost" disabled={ocupado === r.id} onClick={() => rodar(r.id)}>{ocupado === r.id ? "Rodando…" : "Rodar agora"}</button>
              <button className="btn-ghost" onClick={() => alternar(r)}>{r.ativo ? "Desligar" : "Ligar"}</button>
              <button className="btn-ghost" onClick={() => setEdit({ ...r, modelo_atual: r.modelo_flash_sale_id, modelo_flash_sale_id: null })}>Editar</button>
              <button className="btn-ghost text-red-700" onClick={() => excluir(r.id)}>Excluir</button>
            </div>
          </div>
          {r.ultimo_resultado && (
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-600">Última rodada: {r.ultimo_resultado.criadas.length} criadas, {r.ultimo_resultado.pulados.length} produtos pulados, {r.ultimo_resultado.erros.length} erros</summary>
              <div className="mt-2 space-y-1 text-slate-600">
                {r.ultimo_resultado.criadas.map((c) => <p key={c.inicio}>Criada: {dataHora(c.inicio)} · {c.itens} produtos{c.recusados ? ` · ${c.recusados} recusados` : ""}</p>)}
                {r.ultimo_resultado.pulados.map((p, i) => <p key={i} className="text-amber-700">Pulado: {p.nome} ({p.motivo})</p>)}
                {r.ultimo_resultado.erros.map((e, i) => <p key={i} className="text-red-700">Erro: {e}</p>)}
                {r.ultimo_resultado.aviso && <p>{r.ultimo_resultado.aviso}</p>}
              </div>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
