"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { Company, Product, brl, formatarCnpj, mensagemErro } from "@/lib/types";
import { ItemNFe, NFe, custoUnitario, lerNFe } from "@/lib/nfe";

const NOVO = "__novo";
const IGNORAR = "__ignorar";

type Linha = { item: ItemNFe; destino: string };
type Nota = { nfe: NFe; arquivo: string; duplicada: boolean; linhas: Linha[] };

const soDigitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

export default function NfePage() {
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [notas, setNotas] = useState<Nota[]>([]);
  const [somarEstoque, setSomarEstoque] = useState(true);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [lendo, setLendo] = useState(false);
  const [aplicando, setAplicando] = useState(false);

  const carregar = useCallback(async () => {
    const [p, c] = await Promise.all([
      supabase.from("products").select("*").order("name"),
      supabase.from("companies").select("*").order("created_at"),
    ]);
    setProdutos((p.data ?? []) as Product[]);
    const lista = (c.data ?? []) as Company[];
    setEmpresas(lista);
    setEmpresaId((atual) => atual || lista.find((x) => x.is_default)?.id || lista[0]?.id || "");
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function sugerir(item: ItemNFe): string {
    const porEan = item.ean ? produtos.find((p) => p.ean === item.ean) : undefined;
    if (porEan) return porEan.id;
    const porSku = produtos.find((p) => p.sku === item.codigo);
    return porSku ? porSku.id : NOVO;
  }

  async function lerArquivos(files: FileList | null) {
    setErro("");
    setAviso("");
    setNotas([]);
    if (!files || files.length === 0) return;
    setLendo(true);
    try {
      const lidas: Nota[] = [];
      for (const f of Array.from(files)) {
        let nfe: NFe;
        try {
          nfe = lerNFe(await f.text());
        } catch (e) {
          throw new Error(`${f.name}: ${mensagemErro(e)}`);
        }
        if (lidas.some((n) => n.nfe.chave === nfe.chave)) continue;
        const ja = await supabase.from("nfe_imports").select("id").eq("chave", nfe.chave).maybeSingle();
        lidas.push({
          nfe,
          arquivo: f.name,
          duplicada: !!ja.data,
          linhas: nfe.itens.map((item) => ({ item, destino: sugerir(item) })),
        });
      }
      setNotas(lidas);
      // Se o destinatário da nota é um dos seus CNPJs, já seleciona.
      const dest = soDigitos(lidas[0]?.nfe.destinatarioCnpj);
      const achada = empresas.find((c) => dest && soDigitos(c.cnpj) === dest);
      if (achada) setEmpresaId(achada.id);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setLendo(false);
    }
  }

  function trocarDestino(ni: number, li: number, destino: string) {
    setNotas((ns) => ns.map((n, i) => (i !== ni ? n : { ...n, linhas: n.linhas.map((l, j) => (j !== li ? l : { ...l, destino })) })));
  }

  async function aplicar() {
    setErro("");
    setAviso("");
    setAplicando(true);
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) throw new Error("Sessão expirada. Entre novamente.");

      const atuais = new Map(produtos.map((p) => [p.id, p]));
      let notasOk = 0;
      let atualizados = 0;
      let criados = 0;

      for (const nota of notas) {
        if (nota.duplicada) continue;
        const { nfe } = nota;

        // Registra a nota primeiro: a chave única impede lançar a mesma nota duas vezes.
        const reg = await supabase
          .from("nfe_imports")
          .insert({
            store_id: uid,
            company_id: empresaId || null,
            chave: nfe.chave,
            numero: nfe.numero,
            serie: nfe.serie,
            emitente_nome: nfe.emitenteNome,
            emitente_cnpj: nfe.emitenteCnpj,
            emitida_em: nfe.emitidaEm,
            total: nfe.total,
            itens: nota.linhas.filter((l) => l.destino !== IGNORAR).length,
          })
          .select("id")
          .single();
        if (reg.error) {
          if (reg.error.code === "23505") continue;
          throw new Error(reg.error.message);
        }

        try {
          for (const { item, destino } of nota.linhas) {
            if (destino === IGNORAR) continue;
            const c = custoUnitario(item);
            const agora = new Date().toISOString();

            if (destino === NOVO) {
              const r = await supabase.from("products").insert({
                store_id: uid,
                sku: item.codigo,
                name: item.descricao,
                cost_price: c.custo,
                ean: item.ean,
                ncm: item.ncm,
                stock_qty: somarEstoque ? item.quantidade : 0,
                icms_credit: c.icms,
                pis_credit: c.pis,
                cofins_credit: c.cofins,
                company_id: empresaId || null,
                cost_updated_at: agora,
              });
              if (r.error) throw new Error(`Item ${item.codigo}: ${r.error.message}`);
              criados++;
            } else {
              const antigo = atuais.get(destino);
              if (!antigo) continue;
              const novoEstoque = Number(antigo.stock_qty) + (somarEstoque ? item.quantidade : 0);
              const r = await supabase
                .from("products")
                .update({
                  cost_price: c.custo,
                  icms_credit: c.icms,
                  pis_credit: c.pis,
                  cofins_credit: c.cofins,
                  ncm: antigo.ncm || item.ncm,
                  ean: antigo.ean || item.ean,
                  stock_qty: novoEstoque,
                  company_id: empresaId || antigo.company_id,
                  cost_updated_at: agora,
                })
                .eq("id", destino);
              if (r.error) throw new Error(`Item ${item.codigo}: ${r.error.message}`);
              antigo.stock_qty = novoEstoque; // dois itens da nota podem apontar para o mesmo produto
              await supabase.rpc("recalc_sales_cost", { p_product: destino });
              atualizados++;
            }
          }
          notasOk++;
        } catch (e) {
          await supabase.from("nfe_imports").delete().eq("id", reg.data.id);
          throw e;
        }
      }

      setAviso(`${notasOk} nota(s) lançada(s): ${atualizados} produtos atualizados e ${criados} criados.`);
      setNotas([]);
      carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAplicando(false);
    }
  }

  const pendentes = notas.filter((n) => !n.duplicada);
  const empresa = empresas.find((c) => c.id === empresaId);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/dashboard/produtos/armazem" className="text-sm text-slate-500 hover:text-slate-900">← Produtos armazém</Link>
        <h1 className="page-title mt-1">Importar custos pelo XML da nota</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Envie o XML da NF-e de compra. O custo de cada produto passa a ser o valor da nota (produto + frete + seguro + outras despesas + IPI + ICMS-ST − desconto) dividido pela quantidade.
          O ICMS, o PIS e a COFINS destacados ficam guardados como crédito e entram no cálculo dos CNPJs em Lucro Real.
        </p>
      </div>

      <div className="card grid gap-4 md:grid-cols-3">
        <div>
          <label className="label">CNPJ que comprou</label>
          <select className="input" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
            <option value="">Não informar</option>
            {empresas.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {empresa && empresa.regime === "simples" && (
            <p className="mt-1 text-xs text-slate-500">No Simples Nacional os créditos da nota não são usados no cálculo.</p>
          )}
        </div>
        <div className="md:col-span-2">
          <label className="label">Arquivos XML</label>
          <input
            type="file"
            accept=".xml,text/xml,application/xml"
            multiple
            onChange={(e) => lerArquivos(e.target.files)}
            className="block text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-sm hover:file:bg-slate-100"
          />
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={somarEstoque} onChange={(e) => setSomarEstoque(e.target.checked)} />
            Somar as quantidades da nota ao estoque
          </label>
        </div>
      </div>

      {lendo && <p className="text-sm text-slate-500">Lendo as notas…</p>}
      {erro && <p className="text-sm text-red-700">{erro}</p>}
      {aviso && <p className="text-sm text-emerald-800">{aviso}</p>}

      {notas.map((n, ni) => (
        <div key={n.nfe.chave} className="card space-y-3 p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <div>
              <p className="font-medium">
                NF-e {n.nfe.numero} <span className="text-slate-500">· série {n.nfe.serie}</span>
              </p>
              <p className="font-mono text-xs text-slate-500">
                {n.nfe.emitenteNome} · {formatarCnpj(n.nfe.emitenteCnpj)} · total {brl(n.nfe.total)}
              </p>
            </div>
            {n.duplicada && <span className="badge bg-slate-200 text-slate-700">Já importada</span>}
          </div>
          {!n.duplicada && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">Item da nota</th>
                    <th className="th">Qtd</th>
                    <th className="th">Custo un.</th>
                    <th className="th">Créditos un.</th>
                    <th className="th">Lançar em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {n.linhas.map((l, li) => {
                    const c = custoUnitario(l.item);
                    return (
                      <tr key={l.item.numero}>
                        <td className="td max-w-[300px]">
                          <p className="truncate" title={l.item.descricao}>{l.item.descricao}</p>
                          <p className="font-mono text-[11px] text-slate-500">cód. {l.item.codigo}{l.item.ean ? ` · EAN ${l.item.ean}` : ""}</p>
                        </td>
                        <td className="td">{l.item.quantidade} {l.item.unidade}</td>
                        <td className="td font-medium">{brl(c.custo)}</td>
                        <td className="td text-slate-600">{c.icms + c.pis + c.cofins > 0 ? brl(c.icms + c.pis + c.cofins) : "—"}</td>
                        <td className="td">
                          <select className="input py-1" value={l.destino} onChange={(e) => trocarDestino(ni, li, e.target.value)}>
                            <option value={NOVO}>Criar produto novo (SKU {l.item.codigo})</option>
                            <option value={IGNORAR}>Ignorar este item</option>
                            <optgroup label="Atualizar produto existente">
                              {produtos.map((p) => (
                                <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>
                              ))}
                            </optgroup>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {pendentes.length > 0 && (
        <button className="btn" onClick={aplicar} disabled={aplicando}>
          {aplicando ? "Lançando…" : `Lançar ${pendentes.length} nota(s)`}
        </button>
      )}
    </div>
  );
}
