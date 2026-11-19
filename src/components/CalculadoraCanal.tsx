"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Product, brl, campo, num, pct } from "@/lib/types";
import { calcularLucro, precoParaMargem, type EntradaPreco } from "@/lib/pricing";
import { CANAIS, type CanalId } from "@/lib/taxas-publicas";
import { medidasDoProduto, pesoCubicoKg, pesoFaturavelKg } from "@/lib/frete-ml";
import { linkContato } from "@/lib/contato";

// O que muda de um canal para outro: onde a margem/preço são salvos no produto e quais campos aparecem.
const CFG: Record<CanalId, {
  margemKey: string; precoKey: string; configKey: string;
  freteGratis: boolean; fretePago: boolean; comissaoEditavel: boolean; cpf: boolean; rotuloTarifa: string; afiliadoSeparado: boolean; adsSempreAberto: boolean;
}> = {
  tiktok_shop: { margemKey: "tiktok_margem", precoKey: "tiktok_preco", configKey: "tiktok_config", freteGratis: true, fretePago: false, comissaoEditavel: false, cpf: false, rotuloTarifa: "Tarifa por item", afiliadoSeparado: false, adsSempreAberto: false },
  shopee: { margemKey: "shopee_margem", precoKey: "shopee_preco", configKey: "shopee_config", freteGratis: false, fretePago: false, comissaoEditavel: false, cpf: true, rotuloTarifa: "Taxa fixa por item", afiliadoSeparado: true, adsSempreAberto: true },
  mercado_livre: { margemKey: "promo_min_margin", precoKey: "ml_preco", configKey: "ml_config", freteGratis: false, fretePago: true, comissaoEditavel: true, cpf: false, rotuloTarifa: "Taxa fixa por item", afiliadoSeparado: true, adsSempreAberto: false },
};

const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const arred2 = (v: number) => Math.round(v * 100) / 100;

type Comp = { kit_id: string; component_id: string; quantity: number };

// publico = versão da calculadora grátis: sem buscar produto do armazém e sem salvar.
export default function CalculadoraCanal({ canal, publico = false }: { canal: CanalId; publico?: boolean }) {
  const CAN = CANAIS.find((c) => c.id === canal)!;
  const cfgCanal = CFG[canal];

  const [produtos, setProdutos] = useState<Product[]>([]);
  const [componentes, setComponentes] = useState<Comp[]>([]);
  const [carregando, setCarregando] = useState(!publico);

  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState(false);
  const [produto, setProduto] = useState<Product | null>(null);

  const [imposto, setImposto] = useState("10");
  const [preco, setPreco] = useState("");
  const [custo, setCusto] = useState("");
  const [extra, setExtra] = useState("0");
  const [frete, setFrete] = useState("0");
  const [comissao, setComissao] = useState("");
  const [cpf, setCpf] = useState(false);
  // Peso e medidas do produto (frete do Mercado Livre).
  const [peso, setPeso] = useState("");
  const [comp, setComp] = useState("");
  const [larg, setLarg] = useState("");
  const [alt, setAlt] = useState("");
  const [freteGratis, setFreteGratis] = useState("6");

  // Anúncios: ao ligar, ROAS e ACOS andam juntos (ACOS = 100 / ROAS) e entra a comissão do afiliado.
  // Na Shopee a janela de ads fica sempre aberta e já ligada; o botão liga e desliga.
  const [usarAds, setUsarAds] = useState(CFG[canal].adsSempreAberto);
  const [roas, setRoas] = useState("10");
  const [acos, setAcos] = useState("10");
  const [afiliado, setAfiliado] = useState(CFG[canal].afiliadoSeparado ? "0" : "2");
  // TikTok: afiliado sem ads (padrão 8%). Com ads ligado ele fica em 0 e vale o afiliado do bloco de ads (padrão 2%).
  const [afiliadoSemAds, setAfiliadoSemAds] = useState("8");

  const [margemAlvo, setMargemAlvo] = useState("15");
  const [sobraAlvo, setSobraAlvo] = useState("");
  // Qual dos dois a pessoa digitou por último: o outro é calculado.
  const [base, setBase] = useState<"pct" | "valor">("pct");
  // Enquanto a pessoa não digita o preço à mão, ele acompanha a meta (margem ou sobra).
  const [precoManual, setPrecoManual] = useState(false);

  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState("");
  const [erroSalvar, setErroSalvar] = useState("");
  const abriuDoLink = useRef(false);

  useEffect(() => {
    if (publico) return;
    (async () => {
      const todos: Product[] = [];
      for (let i = 0; ; i += 1000) {
        const r = await supabase.from("products").select("*").order("name").order("id").range(i, i + 999);
        const lote = (r.data ?? []) as Product[];
        todos.push(...lote);
        if (lote.length < 1000) break;
      }
      const c = await supabase.from("product_components").select("kit_id, component_id, quantity");
      setProdutos(todos);
      setComponentes((c.data ?? []) as Comp[]);
      setCarregando(false);
    })();
  }, []);

  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);

  // Custo por unidade; o kit soma as peças.
  function custoDe(p: Product): number {
    if (p.tipo === "kit") {
      return componentes
        .filter((c) => c.kit_id === p.id)
        .reduce((t, c) => t + c.quantity * Number(porId.get(c.component_id)?.cost_price ?? 0), 0);
    }
    return Number(p.cost_price ?? 0);
  }

  // Todos os que combinam com a busca (antes só 8 apareciam, escondendo as outras cores e tamanhos).
  const achados = useMemo(() => {
    const termos = semAcento(busca).split(/\s+/).filter(Boolean);
    if (termos.length === 0) return [];
    return produtos
      .filter((p) => p.tipo !== "multi")
      .filter((p) => {
        const alvo = semAcento(`${p.name} ${p.sku ?? ""} ${p.ean ?? ""}`);
        return termos.every((t) => alvo.includes(t));
      });
  }, [busca, produtos]);
  const LIMITE_LISTA = 100;
  const sugestoes = achados.slice(0, LIMITE_LISTA);

  function escolher(p: Product) {
    setProduto(p);
    setBusca(p.name);
    setAberta(false);
    setCusto(campo(custoDe(p)));
    const med = medidasDoProduto(p);
    setPeso(med.pesoKg > 0 ? campo(med.pesoKg) : "");
    setComp(med.comprimentoCm > 0 ? campo(med.comprimentoCm) : "");
    setLarg(med.larguraCm > 0 ? campo(med.larguraCm) : "");
    setAlt(med.alturaCm > 0 ? campo(med.alturaCm) : "");
    setSalvo("");
    setErroSalvar("");
    const reg = p as unknown as Record<string, unknown>;
    const margemSalva = reg[cfgCanal.margemKey];
    const precoSalvo = reg[cfgCanal.precoKey];
    const cfg = (reg[cfgCanal.configKey] ?? null) as Record<string, string | boolean> | null;
    if (margemSalva != null) {
      // Já tem margem salva para este canal: volta como foi salva.
      if (cfg) {
        setImposto(String(cfg.imposto ?? "10"));
        setFreteGratis(String(cfg.freteGratis ?? "6"));
        setExtra(String(cfg.extra ?? "0"));
        setFrete(String(cfg.frete ?? "0"));
        setComissao(String(cfg.comissao ?? ""));
        setCpf(cfg.cpf === true);
        setUsarAds(cfg.usarAds === true || (cfg.usarAds === undefined && cfgCanal.adsSempreAberto));
        setRoas(String(cfg.roas ?? "10"));
        setAcos(String(cfg.acos ?? "10"));
        setAfiliado(String(cfg.afiliado ?? (cfgCanal.afiliadoSeparado ? "0" : "2")));
        setAfiliadoSemAds(String(cfg.afiliadoSemAds ?? "8"));
      }
      setMargemAlvo(campo(Number(margemSalva)));
      setBase("pct");
      if (precoSalvo != null) {
        setPreco(campo(Number(precoSalvo)));
        setPrecoManual(true);
      } else setPrecoManual(false);
      return;
    }
    if (Number(p.sale_price) > 0) {
      setPreco(campo(Number(p.sale_price)));
      setPrecoManual(true);
    }
  }

  // Abre direto num produto quando vem do Armazém (?produto=id).
  useEffect(() => {
    if (carregando || abriuDoLink.current) return;
    abriuDoLink.current = true;
    const id = new URLSearchParams(window.location.search).get("produto");
    const p = id ? produtos.find((x) => x.id === id) : null;
    if (p) escolher(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando]);

  async function salvar() {
    if (!produto || precoN <= 0) return;
    setSalvando(true);
    setSalvo("");
    setErroSalvar("");
    const margemSalva = base === "pct" ? margemN : arred2(r.margem);
    const dados = {
      [cfgCanal.margemKey]: margemSalva,
      [cfgCanal.precoKey]: precoN,
      [cfgCanal.configKey]: { imposto, freteGratis, extra, frete, comissao, cpf, usarAds, roas, acos, afiliado, afiliadoSemAds },
      ...(cfgCanal.fretePago
        ? {
            peso_kg: peso.trim() ? num(peso) : null,
            comprimento_cm: comp.trim() ? num(comp) : null,
            largura_cm: larg.trim() ? num(larg) : null,
            altura_cm: alt.trim() ? num(alt) : null,
          }
        : {}),
    };
    const { error } = await supabase.from("products").update(dados).eq("id", produto.id);
    setSalvando(false);
    if (error) {
      setErroSalvar(
        /column|schema cache/i.test(error.message)
          ? "Faltou criar as colunas no Supabase. Rode o SQL das margens por canal e tente de novo."
          : error.message
      );
      return;
    }
    setProdutos((lista) => lista.map((x) => (x.id === produto.id ? { ...x, ...dados } : x)));
    setSalvo(`Salvo no armazém: margem ${pct(margemSalva)} · vende a ${brl(precoN)}`);
  }

  function limpar() {
    setProduto(null);
    setBusca("");
    setCusto("");
  }

  function mudarRoas(v: string) {
    setRoas(v);
    const r = num(v);
    setAcos(r > 0 ? campo(arred2(100 / r)) : "");
  }
  function mudarAcos(v: string) {
    setAcos(v);
    const a = num(v);
    setRoas(a > 0 ? campo(arred2(100 / a)) : "");
  }

  // Imposto simples: % sobre o preço de venda, editável (padrão 10%).
  const empresa: EntradaPreco["empresa"] = {
    regime: "simples",
    simples_aliquota: num(imposto),
    icms_pct: 0,
    pis_pct: 0,
    cofins_pct: 0,
    irpj_csll_pct: 0,
  };
  const precoN = num(preco);
  const custoN = num(custo);
  const margemN = num(margemAlvo);
  const adsPct = usarAds ? num(acos) : 0;
  // Na Shopee o afiliado vale com ou sem publicidade; nos outros canais ele faz parte do bloco de ads.
  const afiliadoPct = cfgCanal.afiliadoSeparado || usarAds ? num(afiliado) : num(afiliadoSemAds);

  // Comissão e tarifa da faixa do preço (a tabela de cada canal está em taxas-publicas).
  // "metade" (Mercado Livre abaixo de R$ 12,50): a taxa fixa é metade do preço, tratada como +50% de comissão.
  function taxasDe(p: number) {
    const f = CAN.faixas.find((x) => p <= x.ate) ?? CAN.faixas[CAN.faixas.length - 1];
    const metade = f.fixa === "metade";
    const com = cfgCanal.comissaoEditavel && comissao.trim() ? num(comissao) : f.comissao;
    const fixa = (typeof f.fixa === "number" ? f.fixa : 0) + (cfgCanal.cpf && cpf ? 3 : 0);
    return { com, fixa, metade };
  }

  function entrada(p: number): EntradaPreco {
    const t = taxasDe(p);
    return {
      custo: custoN,
      credito: 0,
      feePct: t.com + (t.metade ? 50 : 0) + afiliadoPct + (cfgCanal.freteGratis ? num(freteGratis) : 0) + adsPct,
      feeFixo: t.fixa,
      frete: num(extra) + (cfgCanal.fretePago ? num(frete) : 0),
      empresa,
    };
  }

  const medidas = { pesoKg: num(peso), comprimentoCm: num(comp), larguraCm: num(larg), alturaCm: num(alt) };
  const cubico = pesoCubicoKg(medidas);
  const faturavel = pesoFaturavelKg(medidas);

  const t = taxasDe(precoN);
  const r = calcularLucro(precoN, entrada(precoN));
  const roi = custoN > 0 ? (r.lucro / custoN) * 100 : 0;

  // Menor preço que entrega a margem, faixa por faixa (a tarifa muda no limite de R$ 50).
  function precoMinimo(m: number): number | null {
    let inicio = 0;
    for (const f of CAN.faixas) {
      const ent = entrada(Math.min(f.ate, inicio + 0.01));
      const p = precoParaMargem(m, ent);
      if (p != null && p <= f.ate) {
        if (p > inicio) return p;
        const piso = inicio + 0.01;
        if (calcularLucro(piso, entrada(piso)).margem >= m) return piso;
      }
      inicio = f.ate;
    }
    return null;
  }

  // Menor preço que deixa "v" reais de sobra por venda, faixa por faixa.
  function precoParaSobra(v: number): number | null {
    let inicio = 0;
    for (const f of CAN.faixas) {
      const ent = entrada(Math.min(f.ate, inicio + 0.01));
      const denom = 1 - (ent.feePct + num(imposto)) / 100;
      if (denom > 0) {
        const p = (v + custoN + ent.frete + ent.feeFixo) / denom;
        if (p <= f.ate) {
          if (p > inicio) return p;
          const piso = inicio + 0.01;
          if (calcularLucro(piso, entrada(piso)).lucro >= v) return piso;
        }
      }
      inicio = f.ate;
    }
    return null;
  }

  const sobraN = num(sobraAlvo);
  const metaOk = custoN > 0 && (base === "pct" ? true : sobraN > 0);
  const precoMeta = !metaOk ? null : base === "pct" ? precoMinimo(margemN) : precoParaSobra(sobraN);
  const rMeta = precoMeta != null ? calcularLucro(precoMeta, entrada(precoMeta)) : null;

  // O preço (e todo o resto) acompanha a meta até a pessoa digitar o preço à mão.
  useEffect(() => {
    if (!precoManual && precoMeta != null) setPreco(campo(Math.ceil(precoMeta * 100) / 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precoManual, precoMeta]);

  const margemMostrada = base === "pct" ? margemAlvo : rMeta ? campo(arred2(rMeta.margem)) : "";
  const sobraMostrada = base === "valor" ? sobraAlvo : rMeta ? campo(arred2(rMeta.lucro)) : "";

  // Fatias da pizza: para onde vai cada real do preço de venda.
  const fatias: Fatia[] = [
    { nome: "Custo do produto", valor: custoN, cor: "#6366f1" },
    { nome: `Comissão ${CAN.nome} (${pct(t.com)})`, valor: (precoN * t.com) / 100, cor: "#f43f5e" },
    { nome: cfgCanal.rotuloTarifa, valor: precoN > 0 ? (t.metade ? precoN / 2 : t.fixa) : 0, cor: "#fb923c" },
    { nome: `Frete grátis (${pct(num(freteGratis))})`, valor: cfgCanal.freteGratis ? (precoN * num(freteGratis)) / 100 : 0, cor: "#f59e0b" },
    { nome: "Frete pago por você", valor: cfgCanal.fretePago ? num(frete) : 0, cor: "#14b8a6" },
    { nome: `Afiliado (${pct(afiliadoPct)})`, valor: (precoN * afiliadoPct) / 100, cor: "#a855f7" },
    { nome: `Publicidade (${pct(adsPct)})`, valor: (precoN * adsPct) / 100, cor: "#06b6d4" },
    { nome: `Imposto (${pct(num(imposto))})`, valor: r.impostos, cor: "#64748b" },
    { nome: "Custo extra", valor: num(extra), cor: "#94a3b8" },
    { nome: "Sobra (lucro)", valor: Math.max(r.lucro, 0), cor: "#10b981", destaque: true },
  ].filter((f) => f.valor > 0.004);

  const prejuizo = precoN > 0 && r.lucro < 0;

  if (carregando) return <p className="text-sm text-slate-500">Carregando seus produtos…</p>;

  return (
    <div className="space-y-5">
      {/* Busca */}
      {!publico && (
      <div className="card">
        <div className="relative">
          <label className="label">Buscar produto pelo nome, SKU ou EAN</label>
          <div className="flex gap-2">
            <input
              className="input"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setAberta(true);
                if (produto) setProduto(null);
              }}
              onFocus={() => setAberta(true)}
              onBlur={() => setTimeout(() => setAberta(false), 150)}
              placeholder={produtos.length ? "Digite para buscar…" : "Nenhum produto cadastrado ainda"}
            />
            {(produto || busca) && (
              <button type="button" className="btn-ghost" onClick={limpar}>
                Limpar
              </button>
            )}
          </div>
          {aberta && sugestoes.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-96 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl" role="listbox">
              <li className="sticky top-0 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
                {achados.length} {achados.length === 1 ? "produto encontrado" : "produtos encontrados"}
                {achados.length > LIMITE_LISTA ? ` (mostrando os ${LIMITE_LISTA} primeiros: digite mais para filtrar)` : ""}
              </li>
              {sugestoes.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => escolher(p)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block text-xs text-slate-500">
                        {p.sku ? `SKU ${p.sku}` : "sem SKU"}
                        {p.tipo === "kit" ? " · kit" : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-600">custo {brl(custoDe(p))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {aberta && busca.trim() && sugestoes.length === 0 && (
            <p className="mt-1 text-xs text-slate-500">Nenhum produto encontrado. Você também pode digitar o custo abaixo.</p>
          )}
        </div>
      </div>
      )}

      {/* Meta */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-5 text-white shadow-lg">
        <h2 className="text-lg font-semibold">Quanto quero ganhar</h2>
        <p className="mb-4 text-sm text-white/75">Digite a margem ou o valor que quer que sobre. O outro campo, o preço e o resto são preenchidos sozinhos.</p>
        <div className={`grid gap-3 ${publico ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
          {publico && (
            <div>
              <label className="mb-1 block text-xs font-medium text-white/80">Custo do produto (R$)</label>
              <input
                className="input !bg-white/95 !text-slate-900"
                inputMode="decimal"
                value={custo}
                onChange={(e) => setCusto(e.target.value)}
                placeholder="ex.: 40,00"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-white/80">Margem desejada (%)</label>
            <input
              className="input !bg-white/95 !text-slate-900"
              inputMode="decimal"
              value={margemMostrada}
              onChange={(e) => {
                setMargemAlvo(e.target.value);
                setBase("pct");
                setPrecoManual(false);
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-white/80">Quero que sobre por venda (R$)</label>
            <input
              className="input !bg-white/95 !text-slate-900"
              inputMode="decimal"
              value={sobraMostrada}
              onChange={(e) => {
                setSobraAlvo(e.target.value);
                setBase("valor");
                setPrecoManual(false);
              }}
              placeholder="ex.: 10,00"
            />
          </div>
          <div className="rounded-xl bg-white/15 p-3 backdrop-blur">
            <div className="text-xs text-white/80">Preço de venda</div>
            <div className="text-3xl font-bold leading-tight">
              {custoN <= 0 ? "informe o custo" : precoMeta != null ? brl(precoMeta) : metaOk ? "impossível" : "—"}
            </div>
            {rMeta && precoMeta != null && (
              <div className="text-xs text-white/80">
                Sobra {brl(rMeta.lucro)} · margem {pct(rMeta.margem)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Entradas */}
        <div className="card space-y-4 lg:col-span-2">
          <h2 className="font-semibold">Custos da venda</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Preço de venda (R$)</label>
              <input
                className="input"
                inputMode="decimal"
                value={preco}
                onChange={(e) => {
                  setPreco(e.target.value);
                  setPrecoManual(true);
                }}
              />
              <p className="mt-1 text-[11px] text-slate-500">Depois do desconto do vendedor</p>
            </div>
            {!publico && (
              <div>
                <label className="label">Custo do produto (R$)</label>
                <input className="input" inputMode="decimal" value={custo} onChange={(e) => setCusto(e.target.value)} />
                {produto && <p className="mt-1 text-[11px] text-slate-500">Puxado do armazém</p>}
              </div>
            )}
            <div>
              <label className="label">Imposto (%)</label>
              <input className="input" inputMode="decimal" value={imposto} onChange={(e) => setImposto(e.target.value)} />
            </div>
            {cfgCanal.freteGratis && (
              <div>
                <label className="label">Frete grátis (%)</label>
                <input className="input" inputMode="decimal" value={freteGratis} onChange={(e) => setFreteGratis(e.target.value)} />
                <p className="mt-1 text-[11px] text-slate-500">Nas 2 faixas de preço</p>
              </div>
            )}
            {!cfgCanal.afiliadoSeparado && (
              <div>
                <label className="label">Comissão do afiliado (%)</label>
                <input
                  className="input disabled:bg-slate-100 disabled:text-slate-400"
                  inputMode="decimal"
                  disabled={usarAds}
                  value={usarAds ? "0" : afiliadoSemAds}
                  onChange={(e) => setAfiliadoSemAds(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-slate-500">{usarAds ? "Com ads ligado vale o afiliado do bloco de ads" : "Sem ads"}</p>
              </div>
            )}
            {cfgCanal.afiliadoSeparado && (
              <div>
                <label className="label">Comissão do afiliado (%)</label>
                <input className="input" inputMode="decimal" value={afiliado} onChange={(e) => setAfiliado(e.target.value)} />
                <p className="mt-1 text-[11px] text-slate-500">Vale com ou sem publicidade</p>
              </div>
            )}
            {cfgCanal.fretePago && (
              <div>
                <label className="label">Frete pago por você (R$)</label>
                <input className="input" inputMode="decimal" value={frete} onChange={(e) => setFrete(e.target.value)} />
                <p className="mt-1 text-[11px] text-slate-500">Envio que sai do seu bolso</p>
              </div>
            )}
            {cfgCanal.comissaoEditavel && (
              <div>
                <label className="label">Comissão (%)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={comissao}
                  onChange={(e) => setComissao(e.target.value)}
                  placeholder={String(CAN.faixas[CAN.faixas.length - 1].comissao)}
                />
                <p className="mt-1 text-[11px] text-slate-500">Depende da categoria (10% a 14% no Clássico)</p>
              </div>
            )}
            {cfgCanal.cpf && (
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cpf} onChange={(e) => setCpf(e.target.checked)} />
                Vendo como pessoa física (CPF): R$ 3 a mais por item
              </label>
            )}
            <div className="col-span-2">
              <label className="label">Custo extra por venda (R$)</label>
              <input className="input" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} />
              <p className="mt-1 text-[11px] text-slate-500">Embalagem, brinde, o que mais pesar na venda</p>
            </div>
          </div>

          {cfgCanal.fretePago && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-sm font-semibold">Peso e medidas</p>
              <div className="grid grid-cols-4 gap-2">
                {([["Peso (kg)", peso, setPeso], ["Compr. (cm)", comp, setComp], ["Larg. (cm)", larg, setLarg], ["Alt. (cm)", alt, setAlt]] as const).map(([rot, val, set]) => (
                  <div key={rot}>
                    <label className="label">{rot}</label>
                    <input className="input px-2" inputMode="decimal" value={val} onChange={(e) => set(e.target.value)} />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-600">
                {cubico > 0 || num(peso) > 0
                  ? `Peso cúbico ${campo(Math.round(cubico * 1000) / 1000)} kg · peso que o frete considera ${campo(Math.round(faturavel * 1000) / 1000)} kg`
                  : "Informe o peso e as 3 medidas para calcular o peso cúbico."}
              </p>
              {!publico && <p className="mt-1 text-[11px] text-slate-500">Vem do armazém e é salvo junto. A regra de frete por faixa de valor e peso entra aqui em seguida.</p>}
            </div>
          )}

          {/* Anúncios */}
          <div className={`rounded-xl border p-3 transition-colors ${usarAds ? "border-cyan-300 bg-cyan-50/60" : "border-slate-200 bg-slate-50"}`}>
            <button
              type="button"
              onClick={() => {
                // Ao ligar o ads: ROAS 10 (ACOS 10%) e afiliado em 2%; dá para editar depois.
                if (!usarAds) {
                  mudarRoas("10");
                  if (!cfgCanal.afiliadoSeparado) setAfiliado("2");
                }
                setUsarAds((v) => !v);
              }}
              aria-pressed={usarAds}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                usarAds ? "bg-cyan-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
              }`}
            >
              <span>{usarAds ? "Usando ads" : cfgCanal.adsSempreAberto ? "Ads desligado" : "Usar ads"}</span>
              <span className="text-xs font-normal opacity-80">{usarAds ? "clique para desligar" : cfgCanal.adsSempreAberto ? "clique para ligar" : "ROAS e ACOS"}</span>
            </button>
            {(usarAds || cfgCanal.adsSempreAberto) && (
              <div className={`mt-3 grid grid-cols-2 gap-3 ${usarAds ? "" : "opacity-50"}`}>
                <div>
                  <label className="label">ROAS</label>
                  <input className="input" inputMode="decimal" disabled={!usarAds} value={roas} onChange={(e) => mudarRoas(e.target.value)} />
                </div>
                <div>
                  <label className="label">ACOS (%)</label>
                  <input className="input" inputMode="decimal" disabled={!usarAds} value={acos} onChange={(e) => mudarAcos(e.target.value)} />
                </div>
                <p className="col-span-2 -mt-1 text-[11px] text-slate-600">
                  ROAS e ACOS andam juntos: ROAS {num(roas) > 0 ? campo(num(roas)) : "—"} = {pct(adsPct)} do preço de venda.
                </p>
                {!cfgCanal.afiliadoSeparado && (
                  <div className="col-span-2">
                    <label className="label">Comissão do afiliado (%)</label>
                    <input className="input" inputMode="decimal" value={afiliado} onChange={(e) => setAfiliado(e.target.value)} />
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-500">
            {CAN.nota} Aplicado sozinho pelo preço. Confira na sua central do vendedor.
          </p>
        </div>

        {/* Resultado com pizza */}
        <div className="card lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Para onde vai o dinheiro</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">Preço {brl(precoN)}</span>
          </div>
          <div className="grid items-center gap-6 md:grid-cols-2">
            <Pizza fatias={fatias} margem={precoN > 0 ? r.margem : null} prejuizo={prejuizo} />
            <ul className="space-y-1.5 text-sm">
              {fatias.length === 0 && <li className="text-slate-500">Informe o custo e a meta para ver a divisão.</li>}
              {fatias.map((f) => (
                <li
                  key={f.nome}
                  className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1 ${f.destaque ? "bg-emerald-50 font-semibold text-emerald-800" : ""}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: f.cor }} />
                    <span className="truncate">{f.nome}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {brl(f.valor)} <span className="text-xs text-slate-400">{precoN > 0 ? pct((f.valor / precoN) * 100) : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className={`mt-5 grid grid-cols-3 gap-3 rounded-xl p-4 ${prejuizo ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
            <div>
              <div className="text-xs opacity-80">{prejuizo ? "Prejuízo por venda" : "Sobra por venda"}</div>
              <div className="text-2xl font-bold">{brl(precoN > 0 ? r.lucro : 0)}</div>
            </div>
            <div>
              <div className="text-xs opacity-80">Margem</div>
              <div className="text-2xl font-bold">{pct(precoN > 0 ? r.margem : 0)}</div>
            </div>
            <div>
              <div className="text-xs opacity-80">Retorno sobre o custo</div>
              <div className="text-2xl font-bold">{pct(precoN > 0 ? roi : 0)}</div>
            </div>
          </div>

          {publico ? (
            <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
              <p className="text-base font-semibold text-slate-900">Deseja salvar o histórico e saber mais?</p>
              <p className="mt-1 text-sm text-slate-600">
                Na versão completa você puxa seus produtos e custos, guarda o histórico de cada cálculo e acompanha o lucro real das suas vendas.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={linkContato("Olá, Diego! Usei a calculadora e quero saber mais sobre a assinatura.")}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:opacity-90"
                >
                  Quero conhecer a assinatura
                </a>
                <a
                  href={linkContato("Olá, Diego! Vim pela calculadora grátis e quero falar com você.")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-500 bg-white px-5 py-2.5 text-sm font-semibold text-emerald-700 shadow-[0_0_14px_rgba(16,185,129,0.45)] transition hover:bg-emerald-50 hover:shadow-[0_0_22px_rgba(16,185,129,0.8)]"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 drop-shadow-[0_0_4px_rgba(16,185,129,0.9)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 20.5l1.6-5.4A8.5 8.5 0 1 1 21 11.5z" />
                    <circle cx="8.5" cy="11.5" r="0.6" fill="currentColor" />
                    <circle cx="12" cy="11.5" r="0.6" fill="currentColor" />
                    <circle cx="15.5" cy="11.5" r="0.6" fill="currentColor" />
                  </svg>
                  Falar no WhatsApp
                </a>
              </div>
            </div>
          ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={salvar}
                disabled={!produto || precoN <= 0 || salvando}
                className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {salvando ? "Salvando…" : "Salvar no armazém"}
              </button>
              {!produto && <span className="text-xs text-slate-500">Escolha um produto na busca para poder salvar.</span>}
              {salvo && <span className="text-sm font-medium text-emerald-700">{salvo}</span>}
              {erroSalvar && <span className="text-sm text-red-700">{erroSalvar}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type Fatia = { nome: string; valor: number; cor: string; destaque?: boolean };

// Pizza em anel (SVG puro): cada fatia é um arco; no centro, a margem que sobra.
function Pizza({ fatias, margem, prejuizo }: { fatias: Fatia[]; margem: number | null; prejuizo: boolean }) {
  const R = 76;
  const C = 2 * Math.PI * R;
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  const folga = fatias.length > 1 ? 2.5 : 0;
  let acumulado = 0;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[260px]">
      <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90" role="img" aria-label="Divisão do preço de venda">
        <circle cx="100" cy="100" r={R} fill="none" stroke="#eef0f6" strokeWidth="28" />
        {total > 0 &&
          fatias.map((f) => {
            const comp = (f.valor / total) * C;
            const arco = Math.max(comp - folga, 0.5);
            const el = (
              <circle
                key={f.nome}
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={f.cor}
                strokeWidth="28"
                strokeDasharray={`${arco} ${C - arco}`}
                strokeDashoffset={-acumulado}
                style={{ transition: "stroke-dasharray 0.4s ease, stroke-dashoffset 0.4s ease" }}
              >
                <title>{`${f.nome}: ${brl(f.valor)}`}</title>
              </circle>
            );
            acumulado += comp;
            return el;
          })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[11px] uppercase tracking-wide text-slate-400">{prejuizo ? "Prejuízo" : "Margem"}</span>
        <span className={`text-3xl font-bold ${prejuizo ? "text-red-600" : "text-emerald-600"}`}>
          {margem == null ? "—" : pct(margem)}
        </span>
        <span className="text-[11px] text-slate-400">do preço de venda</span>
      </div>
    </div>
  );
}
