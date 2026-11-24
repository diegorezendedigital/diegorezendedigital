"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { brl, formatarCnpj, mensagemErro } from "@/lib/types";
import { custoUnitario, lerNFe, type ItemNFe } from "@/lib/nfe";

type Linha = {
  id: string;
  chave: string;
  numero: string | null;
  serie: string | null;
  emitente_nome: string | null;
  emitente_cnpj: string | null;
  destinatario_cnpj: string | null;
  emitida_em: string | null;
  total: number | null;
  itens: number | null;
  situacao: string;
  manifestacao: string | null;
  completa: boolean;
  origem: string;
  lancada_em: string | null;
  company_id: string | null;
  atualizado_em: string;
};

type EmpresaCfg = {
  id: string;
  nome: string;
  cnpj: string | null;
  configurado: boolean;
  entradaAtiva: boolean;
  ultimaBusca: string | null;
  erro: string | null;
};
type ConfigResp = { precisaSQL: boolean; podeEditar: boolean; empresas: EmpresaCfg[] };
type ResumoBusca = { empresaId: string; empresa: string; novas: number; atualizadas: number; xmls: number; ciencias: number; avisos: string[]; parcial: boolean; erro?: string };
type BuscaResp = { resultados: ResumoBusca[]; puladas: string[]; semConfig: boolean; precisaSQL?: boolean; error?: string };

type Estado = "a_lancar" | "aguardando" | "lancada" | "cancelada" | "denegada";
const ESTADOS: Record<Estado, { texto: string; classe: string }> = {
  a_lancar: { texto: "A lançar", classe: "bg-amber-100 text-amber-800" },
  aguardando: { texto: "Aguardando XML", classe: "bg-slate-200 text-slate-700" },
  lancada: { texto: "Lançada", classe: "bg-emerald-100 text-emerald-800" },
  cancelada: { texto: "Cancelada", classe: "bg-red-100 text-red-700" },
  denegada: { texto: "Denegada", classe: "bg-red-100 text-red-700" },
};
const FILTROS: { id: "todas" | Estado; texto: string }[] = [
  { id: "todas", texto: "Todas" },
  { id: "a_lancar", texto: "A lançar" },
  { id: "aguardando", texto: "Aguardando XML" },
  { id: "lancada", texto: "Lançadas" },
  { id: "cancelada", texto: "Canceladas" },
];

function estadoDe(l: Linha): Estado {
  if (l.situacao === "cancelada") return "cancelada";
  if (l.situacao === "denegada") return "denegada";
  if (l.lancada_em) return "lancada";
  return l.completa ? "a_lancar" : "aguardando";
}

const dataBr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const dataHoraBr = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca";

const CAMPOS = "id, chave, numero, serie, emitente_nome, emitente_cnpj, destinatario_cnpj, emitida_em, total, itens, situacao, manifestacao, completa, origem, lancada_em, company_id, atualizado_em";

export default function EntradaPage() {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [cfg, setCfg] = useState<ConfigResp | null>(null);
  const [semTabela, setSemTabela] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [detalhesBusca, setDetalhesBusca] = useState<string[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [filtro, setFiltro] = useState<"todas" | Estado>("todas");
  const [busca, setBusca] = useState("");
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [aberta, setAberta] = useState<string | null>(null);
  const [itensAbertos, setItensAbertos] = useState<{ id: string; itens: ItemNFe[] | null; erro?: string } | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);
  const buscouAoAbrir = useRef(false);

  const carregar = useCallback(async () => {
    const [e, i, c] = await Promise.all([
      supabase.from("nfe_entradas").select(CAMPOS).order("emitida_em", { ascending: false, nullsFirst: false }).limit(1000),
      supabase.from("nfe_imports").select("id, chave, numero, serie, emitente_nome, emitente_cnpj, emitida_em, total, itens, company_id, created_at").order("created_at", { ascending: false }).limit(1000),
      apiFetch<ConfigResp>("/api/fiscal/config").catch(() => null),
    ]);
    const tabelaFalta = !!e.error && /nfe_entradas|schema cache|does not exist/i.test(e.error.message);
    setSemTabela(tabelaFalta);
    const doBanco = tabelaFalta ? [] : ((e.data ?? []) as unknown as Linha[]);
    const conhecidas = new Set(doBanco.map((x) => x.chave));
    // Notas lançadas antes desta tela existir (importação por XML): aparecem como lançadas, sem XML guardado
    type Antiga = { id: string; chave: string; numero: string | null; serie: string | null; emitente_nome: string | null; emitente_cnpj: string | null; emitida_em: string | null; total: number | null; itens: number | null; company_id: string | null; created_at: string };
    const antigas: Linha[] = ((i.data ?? []) as unknown as Antiga[])
      .filter((x) => !conhecidas.has(x.chave))
      .map((x) => ({
        id: `imp-${x.id}`,
        chave: x.chave,
        numero: x.numero,
        serie: x.serie,
        emitente_nome: x.emitente_nome,
        emitente_cnpj: x.emitente_cnpj,
        destinatario_cnpj: null,
        emitida_em: x.emitida_em,
        total: x.total,
        itens: x.itens,
        situacao: "autorizada",
        manifestacao: null,
        completa: false,
        origem: "importada",
        lancada_em: x.created_at,
        company_id: x.company_id,
        atualizado_em: x.created_at,
      }));
    const todas = [...doBanco, ...antigas].sort((a, b) => (Date.parse(b.emitida_em ?? b.atualizado_em) || 0) - (Date.parse(a.emitida_em ?? a.atualizado_em) || 0));
    setLinhas(todas);
    setCfg(c);
    return c;
  }, []);

  const buscar = useCallback(
    async (forcar: boolean) => {
      setBuscando(true);
      setErro("");
      if (forcar) {
        setAviso("");
        setDetalhesBusca([]);
      }
      try {
        const r = await apiFetch<BuscaResp>("/api/fiscal/entradas/buscar", { method: "POST", body: JSON.stringify({ forcar }) });
        if (r.error) throw new Error(r.error);
        const total = r.resultados.reduce((s, x) => ({ novas: s.novas + x.novas, atual: s.atual + x.atualizadas, xmls: s.xmls + x.xmls, ciencias: s.ciencias + x.ciencias }), { novas: 0, atual: 0, xmls: 0, ciencias: 0 });
        const detalhes: string[] = [];
        for (const x of r.resultados) {
          if (x.erro) detalhes.push(`${x.empresa}: ${x.erro}`);
          for (const a of x.avisos.slice(0, 4)) detalhes.push(`${x.empresa}: ${a}`);
          if (x.parcial) detalhes.push(`${x.empresa}: ainda há notas para buscar, clique em "Buscar notas agora" de novo.`);
        }
        setDetalhesBusca(detalhes);
        if (forcar || total.novas + total.atual + total.xmls + total.ciencias > 0) {
          if (total.novas + total.atual + total.xmls + total.ciencias === 0) setAviso(r.resultados.length ? "Nenhuma nota nova." : "Nada para buscar: nenhum CNPJ com a Focus NFe configurada.");
          else setAviso(`Busca concluída: ${total.novas} nota(s) nova(s), ${total.xmls} XML baixado(s), ${total.ciencias} ciência(s) registrada(s).`);
        }
        if (total.novas + total.atual + total.xmls + total.ciencias > 0 || r.resultados.some((x) => x.erro)) await carregar();
      } catch (e) {
        setErro(mensagemErro(e));
      } finally {
        setBuscando(false);
      }
    },
    [carregar]
  );

  useEffect(() => {
    (async () => {
      try {
        const c = await carregar();
        if (!buscouAoAbrir.current && c && c.empresas.some((x) => x.configurado && x.entradaAtiva)) {
          buscouAoAbrir.current = true;
          await buscar(false); // ao abrir a tela, confere se chegou nota nova (no máximo a cada 20 minutos)
        }
      } catch (e) {
        setErro(mensagemErro(e));
      } finally {
        setCarregando(false);
      }
    })();
  }, [carregar, buscar]);

  const empresas = cfg?.empresas ?? [];
  const nomeEmpresa = (id: string | null) => empresas.find((x) => x.id === id)?.nome ?? "—";
  const temConfig = empresas.some((x) => x.configurado && x.entradaAtiva);

  const doEscopo = useMemo(() => linhas.filter((l) => !empresaId || l.company_id === empresaId), [linhas, empresaId]);
  const contagem = useMemo(() => {
    const c: Record<string, number> = { todas: doEscopo.length, a_lancar: 0, aguardando: 0, lancada: 0, cancelada: 0, denegada: 0 };
    for (const l of doEscopo) c[estadoDe(l)]++;
    c.cancelada += c.denegada;
    return c;
  }, [doEscopo]);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return doEscopo.filter((l) => {
      const e = estadoDe(l);
      if (filtro !== "todas" && !(filtro === e || (filtro === "cancelada" && e === "denegada"))) return false;
      if (!q) return true;
      return [l.emitente_nome, l.emitente_cnpj, l.numero, l.chave].some((x) => String(x ?? "").toLowerCase().includes(q));
    });
  }, [doEscopo, filtro, busca]);
  const POR_PAGINA = 50;
  const paginas = Math.max(1, Math.ceil(visiveis.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, paginas - 1);
  const naPagina = visiveis.slice(paginaAtual * POR_PAGINA, (paginaAtual + 1) * POR_PAGINA);

  const lancaveis = naPagina.filter((l) => estadoDe(l) === "a_lancar");
  const todasMarcadas = lancaveis.length > 0 && lancaveis.every((l) => marcadas.has(l.chave));
  const MAX_MARCADAS = 100; // o lançamento roda no navegador, nota por nota: lotes menores terminam mais rápido e não estouram o endereço da página
  function alternar(chave: string) {
    setMarcadas((s) => {
      const n = new Set(s);
      if (n.has(chave)) n.delete(chave);
      else if (n.size < MAX_MARCADAS) n.add(chave);
      return n;
    });
  }
  function marcarPagina() {
    setMarcadas((s) => {
      const n = new Set(s);
      if (todasMarcadas) lancaveis.forEach((l) => n.delete(l.chave));
      else for (const l of lancaveis) if (n.size < MAX_MARCADAS) n.add(l.chave);
      return n;
    });
  }

  async function lerXml(l: Linha): Promise<string | null> {
    const r = await supabase.from("nfe_entradas").select("xml").eq("id", l.id).maybeSingle();
    return ((r.data as { xml: string | null } | null)?.xml) ?? null;
  }

  async function verItens(l: Linha) {
    if (aberta === l.id) {
      setAberta(null);
      return;
    }
    setAberta(l.id);
    setItensAbertos({ id: l.id, itens: null });
    try {
      const xml = await lerXml(l);
      if (!xml) throw new Error("O XML desta nota não está guardado aqui.");
      setItensAbertos({ id: l.id, itens: lerNFe(xml).itens });
    } catch (e) {
      setItensAbertos({ id: l.id, itens: null, erro: mensagemErro(e) });
    }
  }

  async function baixarXml(l: Linha) {
    setOcupada(l.id);
    try {
      const xml = await lerXml(l);
      if (!xml) throw new Error("O XML desta nota não está guardado aqui.");
      const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${l.chave}.xml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupada(null);
    }
  }

  async function darCiencia(l: Linha) {
    setOcupada(l.id);
    setErro("");
    try {
      await apiFetch("/api/fiscal/entradas/manifestar", { method: "POST", body: JSON.stringify({ chave: l.chave, tipo: "ciencia" }) });
      setAviso("Ciência registrada. O XML completo costuma chegar em alguns minutos: clique em \"Buscar notas agora\" depois.");
      await carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupada(null);
    }
  }

  const ultimaBusca = empresas.filter((x) => x.configurado).map((x) => x.ultimaBusca).filter(Boolean).sort().pop() ?? null;
  const errosEmpresas = empresas.filter((x) => x.configurado && x.erro);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Nota fiscal de entrada</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            As notas que os fornecedores emitem contra o seu CNPJ chegam sozinhas da SEFAZ, pela Focus NFe. Quando o XML completo chega, é só lançar o custo nos produtos.
            {ultimaBusca && <span className="text-slate-500"> Última busca: {dataHoraBr(ultimaBusca)}.</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => buscar(true)} disabled={buscando || !temConfig} title={temConfig ? "" : "Configure a Focus NFe para buscar sozinho"}>
            {buscando ? "Buscando…" : "Buscar notas agora"}
          </button>
          <Link href="/dashboard/produtos/nfe" className="btn-ghost">
            Enviar XML manualmente
          </Link>
          {marcadas.size > 0 && (
            <Link href={`/dashboard/produtos/nfe?chaves=${Array.from(marcadas).join(",")}`} className="btn" title={marcadas.size >= MAX_MARCADAS ? `Limite de ${MAX_MARCADAS} notas por vez` : ""}>
              Lançar custo de {marcadas.size} nota(s)
            </Link>
          )}
        </div>
      </div>

      {semTabela && (
        <div className="card border border-amber-300 bg-amber-50 text-sm text-amber-900">
          Falta rodar o SQL das notas fiscais no Supabase (arquivo <span className="font-mono">20261213_notas_fiscais.sql</span>). Enquanto isso, só aparecem as notas já lançadas por XML.
        </div>
      )}

      {!carregando && cfg && !temConfig && (
        <div className="card border border-brand/30 bg-brand-light text-sm">
          <p className="font-semibold text-slate-900">Falta conectar o emissor fiscal para as notas chegarem sozinhas</p>
          <p className="mt-1 text-slate-700">
            A busca automática usa a Focus NFe, que consulta a SEFAZ com o certificado digital do seu CNPJ. Enquanto isso, você pode enviar o XML da nota manualmente.
          </p>
          {cfg.podeEditar && (
            <Link href="/dashboard/notas-fiscais/configuracao" className="btn mt-3">
              Configurar agora
            </Link>
          )}
        </div>
      )}

      {errosEmpresas.map((x) => (
        <p key={x.id} className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-800">
          {x.nome}: a última busca deu erro. {x.erro}
        </p>
      ))}
      {erro && <p className="text-sm text-red-700">{erro}</p>}
      {aviso && <p className="text-sm text-emerald-800">{aviso}</p>}
      {detalhesBusca.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
          {detalhesBusca.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}

      <div className="card space-y-4 p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setFiltro(f.id);
                  setPagina(0);
                }}
                className={`rounded-full px-3 py-1.5 text-sm ${filtro === f.id ? "bg-brand font-semibold text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {f.texto} <span className={filtro === f.id ? "text-white/80" : "text-slate-400"}>{contagem[f.id] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {empresas.length > 1 && (
              <select className="input w-auto py-1.5" value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); setPagina(0); }}>
                <option value="">Todos os CNPJs</option>
                {empresas.map((x) => (
                  <option key={x.id} value={x.id}>{x.nome}</option>
                ))}
              </select>
            )}
            <input className="input w-56 py-1.5" placeholder="Fornecedor, número ou chave" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} />
          </div>
        </div>

        {carregando ? (
          <p className="px-4 pb-4 text-sm text-slate-500">Carregando as notas…</p>
        ) : visiveis.length === 0 ? (
          <p className="px-4 pb-6 text-sm text-slate-500">
            {linhas.length === 0
              ? "Nenhuma nota por aqui ainda. Quando um fornecedor emitir uma nota contra o seu CNPJ, ela aparece nesta lista."
              : "Nenhuma nota com esse filtro."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th w-8">
                    <input type="checkbox" checked={todasMarcadas} onChange={marcarPagina} disabled={lancaveis.length === 0} title="Marcar as notas a lançar desta página" />
                  </th>
                  <th className="th">Emissão</th>
                  <th className="th">Fornecedor</th>
                  <th className="th">Nota</th>
                  <th className="th">Itens</th>
                  <th className="th">Valor</th>
                  {empresas.length > 1 && <th className="th">Comprador</th>}
                  <th className="th">Situação</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {naPagina.map((l) => {
                  const e = estadoDe(l);
                  const rot = ESTADOS[e];
                  const semCiencia = l.situacao === "autorizada" && !l.manifestacao && !l.completa && l.origem === "focus";
                  return (
                    <Fragment key={l.id}>
                      <tr>
                        <td className="td">{e === "a_lancar" && <input type="checkbox" checked={marcadas.has(l.chave)} onChange={() => alternar(l.chave)} />}</td>
                        <td className="td whitespace-nowrap">{dataBr(l.emitida_em)}</td>
                        <td className="td max-w-[280px]">
                          <p className="truncate font-medium" title={l.emitente_nome ?? ""}>{l.emitente_nome || "—"}</p>
                          <p className="font-mono text-[11px] text-slate-500">{formatarCnpj(l.emitente_cnpj)}</p>
                        </td>
                        <td className="td whitespace-nowrap">
                          {l.numero || "—"} <span className="text-slate-500">· série {l.serie || "—"}</span>
                        </td>
                        <td className="td">{l.itens ?? "—"}</td>
                        <td className="td whitespace-nowrap font-medium">{l.total != null ? brl(l.total) : "—"}</td>
                        {empresas.length > 1 && <td className="td text-slate-600">{nomeEmpresa(l.company_id)}</td>}
                        <td className="td">
                          <span className={`badge ${rot.classe}`}>{rot.texto}</span>
                          {e === "aguardando" && <p className="mt-0.5 text-[11px] text-slate-500">{l.manifestacao ? "ciência dada, aguardando a SEFAZ" : "sem ciência da operação"}</p>}
                          {(e === "cancelada" || e === "denegada") && l.lancada_em && <p className="mt-0.5 text-[11px] text-red-700">custo já tinha sido lançado</p>}
                          {e === "lancada" && <p className="mt-0.5 text-[11px] text-slate-500">em {dataBr(l.lancada_em)}</p>}
                        </td>
                        <td className="td whitespace-nowrap text-right">
                          {e === "a_lancar" && (
                            <Link href={`/dashboard/produtos/nfe?chaves=${l.chave}`} className="btn-ghost mr-1 py-1">
                              Lançar custo
                            </Link>
                          )}
                          {semCiencia && (
                            <button className="btn-ghost mr-1 py-1" disabled={ocupada === l.id} onClick={() => darCiencia(l)} title="Registra a ciência da operação na SEFAZ para liberar o XML completo">
                              {ocupada === l.id ? "Enviando…" : "Dar ciência"}
                            </button>
                          )}
                          {l.completa && (
                            <>
                              <button className="btn-ghost mr-1 py-1" onClick={() => verItens(l)}>
                                {aberta === l.id ? "Fechar" : "Ver itens"}
                              </button>
                              <button className="btn-ghost py-1" disabled={ocupada === l.id} onClick={() => baixarXml(l)}>
                                XML
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {aberta === l.id && (
                        <tr>
                          <td colSpan={empresas.length > 1 ? 9 : 8} className="bg-slate-50 px-4 py-3">
                            {!itensAbertos || itensAbertos.id !== l.id ? null : itensAbertos.erro ? (
                              <p className="text-sm text-red-700">{itensAbertos.erro}</p>
                            ) : !itensAbertos.itens ? (
                              <p className="text-sm text-slate-500">Lendo os itens…</p>
                            ) : (
                              <table className="w-full">
                                <thead>
                                  <tr>
                                    <th className="th">Código</th>
                                    <th className="th">Descrição</th>
                                    <th className="th">NCM</th>
                                    <th className="th">Qtd</th>
                                    <th className="th">Custo un.</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {itensAbertos.itens.map((it) => (
                                    <tr key={it.numero}>
                                      <td className="td font-mono text-xs">{it.codigo}</td>
                                      <td className="td max-w-[420px] truncate" title={it.descricao}>{it.descricao}</td>
                                      <td className="td font-mono text-xs">{it.ncm ?? "—"}</td>
                                      <td className="td">{it.quantidade} {it.unidade}</td>
                                      <td className="td font-medium">{brl(custoUnitario(it).custo)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {paginas > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span>{visiveis.length} notas · página {paginaAtual + 1} de {paginas}</span>
            <div className="flex gap-2">
              <button className="btn-ghost py-1" disabled={paginaAtual === 0} onClick={() => setPagina(paginaAtual - 1)}>Anterior</button>
              <button className="btn-ghost py-1" disabled={paginaAtual >= paginas - 1} onClick={() => setPagina(paginaAtual + 1)}>Próxima</button>
            </div>
          </div>
        )}
      </div>

      <p className="max-w-3xl text-xs text-slate-500">
        A ciência da operação avisa a SEFAZ que você tomou conhecimento da nota e libera o XML completo; ela não confirma nem recusa a compra. A Focus NFe conta cada nota recebida no pacote do plano.
      </p>
    </div>
  );
}
