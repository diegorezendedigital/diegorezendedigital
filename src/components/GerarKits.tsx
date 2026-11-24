"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/supabase/client";
import { brl, mensagemErro } from "@/lib/types";
import MarcaMP from "@/components/MarcaMP";
import type { ItemPlano, ItemRevisar, MotivoRevisar } from "@/lib/kits";

type ItemPrevia = Omit<ItemPlano, "anunciosIds"> & { anuncios: number };
type Previa = { criar: ItemPrevia[]; revisar: ItemRevisar[]; ligarAnuncios: number; jaOk: number };
type RespCriar = { criados: number; completados: number; ligados: number; falhas: { chave: string; sku: string; erro: string }[]; ignorados: number; parcial: boolean; feitos: string[] };
type Resultado = { criados: number; completados: number; ligados: number; falhas: { chave: string; sku: string; erro: string }[]; ignorados: number };

// Texto de cada motivo da lista "precisa de você"
function explicar(i: ItemRevisar): string {
  const m: MotivoRevisar = i.motivo;
  const modelo = i.modelo ? `${i.modelo}` : "";
  const tam = i.tamanho ? `${i.tamanho}` : "";
  if (m === "sem_numero") return "O SKU começa com KIT mas não tem a quantidade de peças (o certo é KIT2-…, KIT3-…).";
  if (m === "padrao") return "Não consegui separar modelo e tamanho neste SKU. O padrão esperado é KIT2-MODELO-COR-TAMANHO.";
  if (m === "nao_achou") return `Não achei no armazém nenhuma peça do modelo ${modelo || "?"} no tamanho ${tam || "?"}. Confira se o SKU da peça começa assim.`;
  if (m === "sem_custo") return `As peças do modelo ${modelo} tamanho ${tam} estão sem custo no armazém. Cadastre o custo e procure de novo.`;
  if (m === "custo_diferente") return `As cores do modelo ${modelo} tamanho ${tam} têm custos diferentes entre si. Deixe o custo igual nelas e procure de novo.`;
  return `Já existe um produto com este SKU${i.existente ? ` (tipo ${i.existente.tipo === "multi" ? "Multi-variantes" : i.existente.tipo === "kit" ? "Kit" : "Único"})` : ""} sem custo. Informe o custo nele, ou apague-o para eu criar o kit.`;
}

export default function GerarKits({ onConcluido }: { onConcluido: () => void | Promise<void> }) {
  const [carregando, setCarregando] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [criando, setCriando] = useState(false);
  const [progresso, setProgresso] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState("");
  const [verRevisar, setVerRevisar] = useState(true);

  async function procurar() {
    setErro("");
    setResultado(null);
    setCarregando(true);
    try {
      const p = await apiFetch<Previa>("/api/kits/gerar", { method: "POST", body: JSON.stringify({ acao: "previa" }) });
      setPrevia(p);
      setMarcados(new Set(p.criar.map((i) => i.chave)));
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setCarregando(false);
    }
  }

  async function criar() {
    if (!previa) return;
    const chaves = previa.criar.filter((i) => marcados.has(i.chave)).map((i) => i.chave);
    if (chaves.length === 0 && previa.ligarAnuncios === 0) return;
    setErro("");
    setCriando(true);
    const acc: Resultado = { criados: 0, completados: 0, ligados: 0, falhas: [], ignorados: 0 };
    try {
      const LOTE = 100;
      let primeira = true;
      for (let i = 0; i < Math.max(chaves.length, 1); i += LOTE) {
        let restantes = chaves.slice(i, i + LOTE);
        // O servidor trabalha no máximo ~45 s por chamada; se parar no meio, o resto segue na chamada seguinte
        for (let rodada = 0; rodada < 6 && (restantes.length > 0 || primeira); rodada++) {
          setProgresso(chaves.length ? `Criando kits… ${acc.criados + acc.completados + acc.falhas.length} de ${chaves.length}` : "Ligando anúncios…");
          const r = await apiFetch<RespCriar>("/api/kits/gerar", { method: "POST", body: JSON.stringify({ acao: "criar", chaves: restantes, ligar: primeira }) });
          primeira = false;
          acc.criados += r.criados;
          acc.completados += r.completados;
          acc.ligados += r.ligados;
          acc.falhas.push(...r.falhas);
          acc.ignorados += r.ignorados;
          const prontas = new Set([...r.feitos, ...r.falhas.map((f) => f.chave)]);
          restantes = r.parcial ? restantes.filter((c) => !prontas.has(c)) : [];
        }
      }
      setResultado(acc);
      setPrevia(null);
      await onConcluido();
    } catch (e) {
      setErro(`${mensagemErro(e)}${acc.criados + acc.completados > 0 ? ` (até aqui: ${acc.criados + acc.completados} kits já foram criados — procure de novo para ver o que falta)` : ""}`);
      if (acc.criados + acc.completados > 0) await onConcluido();
    } finally {
      setCriando(false);
      setProgresso("");
    }
  }

  const todos = previa ? previa.criar.length > 0 && marcados.size === previa.criar.length : false;
  const alternar = (chave: string) =>
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="font-display text-lg font-semibold text-slate-900">Gerar kits dos anúncios</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Lê os SKUs dos seus anúncios (KIT2-BERM-SP-CINZACAZUL-G…), acha no armazém a peça do mesmo modelo e tamanho e cria o kit com o custo já calculado (quantidade × custo da peça).
            Como o custo é o mesmo em todas as cores, as cores do kit não precisam ser cadastradas.
          </p>
        </div>
        <button className={previa ? "btn-ghost" : "btn"} onClick={procurar} disabled={carregando || criando}>
          {carregando ? "Procurando…" : previa ? "Procurar de novo" : "Procurar kits nos anúncios"}
        </button>
      </div>

      {erro && <p className="text-sm text-red-700">{erro}</p>}

      {resultado && (
        <div className="space-y-2 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">
            {resultado.criados + resultado.completados > 0
              ? `${resultado.criados} kit(s) criado(s)${resultado.completados ? ` e ${resultado.completados} completado(s)` : ""}, com o custo calculado pela peça.`
              : "Nenhum kit novo foi criado."}{" "}
            {resultado.ligados > 0 && `${resultado.ligados} anúncio(s) ligado(s) ao kit.`}
          </p>
          {resultado.falhas.length > 0 && (
            <div className="rounded-xl bg-white/70 p-3 text-red-800">
              <p className="font-medium">{resultado.falhas.length} kit(s) não puderam ser criados:</p>
              <ul className="mt-1 list-disc pl-5">
                {resultado.falhas.slice(0, 8).map((f) => (
                  <li key={f.chave}>
                    <span className="font-mono text-xs">{f.sku}</span>: {f.erro}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {resultado.ignorados > 0 && <p className="text-xs text-emerald-800">{resultado.ignorados} kit(s) já tinham sido criados ou mudaram desde a busca e foram pulados.</p>}
          <p>
            Para as vendas antigas receberem o custo, vá em{" "}
            <Link href="/dashboard/pedidos" className="font-medium underline">
              Pedidos
            </Link>{" "}
            e clique em <strong>Reprocessar sem custo</strong>. As vendas novas já entram com o custo certo.
          </p>
        </div>
      )}

      {previa && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-brand-light px-3 py-1 font-medium text-brand">{previa.criar.length} kit(s) para criar</span>
            <span className={`rounded-full px-3 py-1 font-medium ${previa.revisar.length ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600"}`}>{previa.revisar.length} precisam de você</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{previa.jaOk} já resolvidos</span>
            {previa.ligarAnuncios > 0 && <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{previa.ligarAnuncios} anúncio(s) soltos serão ligados a kits que já existem</span>}
          </div>

          {previa.criar.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="max-h-[420px] overflow-auto">
                <table className="tabela-pro w-full">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="th w-8">
                        <input
                          type="checkbox"
                          checked={todos}
                          onChange={() => setMarcados(todos ? new Set() : new Set(previa.criar.map((i) => i.chave)))}
                          aria-label="Marcar todos os kits"
                          title="Marcar todos"
                        />
                      </th>
                      <th className="th">SKU do kit</th>
                      <th className="th">Peças</th>
                      <th className="th">Peça usada no custo</th>
                      <th className="th text-right">Custo da peça</th>
                      <th className="th text-right">Custo do kit</th>
                      <th className="th text-right">Anúncios</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previa.criar.map((i) => (
                      <tr key={i.chave} className="hover:bg-slate-50">
                        <td className="td">
                          <input type="checkbox" checked={marcados.has(i.chave)} onChange={() => alternar(i.chave)} aria-label={`Criar o kit ${i.sku}`} />
                        </td>
                        <td className="td">
                          <div className="font-mono text-xs text-slate-900">{i.sku}</div>
                          <div className="max-w-[360px] truncate text-[11px] text-slate-500" title={i.nome}>
                            {i.nome}
                          </div>
                        </td>
                        <td className="td">{i.n}</td>
                        <td className="td">
                          <div className="font-mono text-xs">{i.pecaSku}</div>
                          <div className="text-[11px] text-slate-500">
                            {i.modelo} · tam. {i.tamanho} · {i.cores} {i.cores === 1 ? "peça" : "cores"} com o mesmo custo
                            {i.coresSemCusto > 0 ? ` (${i.coresSemCusto} sem custo, ignorada${i.coresSemCusto > 1 ? "s" : ""})` : ""}
                          </div>
                        </td>
                        <td className="td text-right">{brl(i.custoPeca)}</td>
                        <td className="td text-right font-semibold">{brl(i.custoKit)}</td>
                        <td className="td text-right">
                          {i.anuncios > 0 ? i.anuncios : i.vendas > 0 ? <span title="Só aparece em vendas, sem anúncio ligado">{i.vendas} venda(s)</span> : "—"}
                          {i.existenteId && <div className="text-[11px] text-slate-500">completa kit existente</div>}
                          {i.marketplaces.length > 0 && (
                            <div className="mt-0.5 flex justify-end gap-1">
                              {i.marketplaces.map((m) => (
                                <MarcaMP key={m} mp={m} tamanho={16} />
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {previa.criar.length === 0 && previa.revisar.length === 0 && previa.ligarAnuncios === 0 && (
            <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">Não encontrei nenhum kit para criar: todos os anúncios com SKU de kit já estão com produto e custo.</p>
          )}

          {(previa.criar.length > 0 || previa.ligarAnuncios > 0) && (
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn" onClick={criar} disabled={criando || (marcados.size === 0 && previa.ligarAnuncios === 0)}>
                {criando ? progresso || "Criando…" : `Criar ${marcados.size} kit(s)${previa.ligarAnuncios ? ` e ligar ${previa.ligarAnuncios} anúncio(s)` : ""}`}
              </button>
              <span className="text-xs text-slate-500">O custo de cada kit acompanha a peça: se o custo dela mudar, o do kit muda junto.</span>
            </div>
          )}

          {previa.revisar.length > 0 && (
            <div className="rounded-2xl bg-amber-50 p-4">
              <button className="flex w-full items-center justify-between text-left text-sm font-semibold text-amber-900" onClick={() => setVerRevisar(!verRevisar)}>
                <span>Precisam de você ({previa.revisar.length})</span>
                <span className="text-xs font-normal text-amber-800">{verRevisar ? "esconder" : "ver"}</span>
              </button>
              {verRevisar && (
                <ul className="mt-3 space-y-3">
                  {previa.revisar.map((i) => (
                    <li key={i.chave} className="rounded-xl bg-white p-3 text-sm shadow-soft">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-mono text-xs text-slate-900">{i.sku}</span>
                        <span className="text-[11px] text-slate-500">
                          {i.anuncios > 0 ? `${i.anuncios} anúncio(s)` : ""}
                          {i.anuncios > 0 && i.vendas > 0 ? " · " : ""}
                          {i.vendas > 0 ? `${i.vendas} venda(s) sem custo` : ""}
                        </span>
                      </div>
                      {i.nome && <div className="truncate text-[11px] text-slate-500" title={i.nome}>{i.nome}</div>}
                      <p className="mt-1 text-slate-700">{explicar(i)}</p>
                      {i.custos && (
                        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                          {i.custos.map((c) => (
                            <li key={c.custo}>
                              <strong>{brl(c.custo)}</strong>: {c.skus.slice(0, 4).join(", ")}
                              {c.skus.length > 4 ? ` e mais ${c.skus.length - 4}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
