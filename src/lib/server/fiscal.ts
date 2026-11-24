// Nota Fiscal (servidor): configuração por CNPJ e busca das notas de entrada pela Focus NFe.
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerNFe, type NFe } from "@/lib/nfe";
import { baixarXmlRecebida, listarRecebidas, manifestar, type Ambiente, type NotaRecebida } from "./focus";

export type ConfigFiscal = {
  store_id: string;
  company_id: string;
  provedor: string;
  token_homologacao: string | null;
  token_producao: string | null;
  ambiente: Ambiente;
  entrada_ativa: boolean;
  ciencia_automatica: boolean;
  entrada_versao: number | string | null;
  entrada_ultima_busca: string | null;
  entrada_erro: string | null;
};

export type EmpresaFiscal = { id: string; name: string; cnpj: string | null };

export type ResumoBusca = {
  empresaId: string;
  empresa: string;
  novas: number;
  atualizadas: number;
  xmls: number;
  ciencias: number;
  avisos: string[];
  parcial: boolean;
  erro?: string;
};

export const soDigitos = (s: string | null | undefined): string => String(s ?? "").replace(/\D/g, "");

// "••••1234": o navegador nunca recebe o token inteiro
export function mascara(token: string | null | undefined): string | null {
  const t = String(token ?? "");
  if (!t) return null;
  return `••••${t.slice(-4)}`;
}

// Mensagem clara quando o SQL das notas fiscais ainda não foi rodado
export function erroTabela(msg: string): string {
  return /nfe_entradas|fiscal_config|schema cache|does not exist/i.test(msg)
    ? "Falta rodar o SQL das notas fiscais no Supabase (arquivo 20261213_notas_fiscais.sql)."
    : msg;
}

// A busca de notas recebidas usa o token de produção (são notas reais). Sem ele, cai no de testes.
export function credencialEntrada(cfg: Pick<ConfigFiscal, "token_producao" | "token_homologacao">): { token: string; amb: Ambiente } | null {
  if (cfg.token_producao) return { token: cfg.token_producao, amb: "producao" };
  if (cfg.token_homologacao) return { token: cfg.token_homologacao, amb: "homologacao" };
  return null;
}

// Chave de acesso: UF(2) AAMM(4) CNPJ(14) modelo(2) série(3) número(9) tipo(1) código(8) DV(1)
export function numeroDaChave(chave: string): { serie: string; numero: string } {
  const sem = (s: string) => s.replace(/^0+/, "") || "0";
  return { serie: sem(chave.slice(22, 25)), numero: sem(chave.slice(25, 34)) };
}

type Contexto = {
  admin: SupabaseClient;
  empresa: EmpresaFiscal;
  cfg: ConfigFiscal;
  cred: { token: string; amb: Ambiente };
  prazoFinal: number;
  resumo: ResumoBusca;
};

const agora = () => new Date().toISOString();
const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : "erro inesperado");
const rotuloNota = (n: NotaRecebida) => `${numeroDaChave(n.chave).numero}${n.emitenteNome ? ` de ${n.emitenteNome}` : ""}`;

// Grava um lote de notas (a Focus devolve até 100 por vez). Devolve false se o tempo acabou no meio.
async function processarLote(ctx: Contexto, notas: NotaRecebida[]): Promise<boolean> {
  const { admin, empresa, cfg, cred, prazoFinal, resumo } = ctx;
  const { data, error } = await admin
    .from("nfe_entradas")
    .select("id, chave, situacao, manifestacao, completa, versao")
    .eq("store_id", cfg.store_id)
    .in("chave", notas.map((n) => n.chave));
  if (error) throw new Error(erroTabela(error.message));
  type Antes = { id: string; chave: string; situacao: string; manifestacao: string | null; completa: boolean; versao: number | string | null };
  const antes = new Map(((data ?? []) as Antes[]).map((x) => [x.chave, x]));
  const novos: Record<string, unknown>[] = [];
  let inteiro = true;

  const gravarNovos = async () => {
    if (!novos.length) return;
    const r = await admin.from("nfe_entradas").upsert(novos.splice(0), { onConflict: "store_id,chave" });
    if (r.error) throw new Error(erroTabela(r.error.message));
  };

  for (const n of notas) {
    if (prazoFinal - Date.now() < 5_000) {
      inteiro = false;
      break;
    }
    const ant = antes.get(n.chave);
    let manifestacao = n.manifestacao;

    // Ciência da operação: sem ela a SEFAZ só entrega o resumo da nota, sem os itens.
    if (n.situacao === "autorizada" && !manifestacao && cfg.ciencia_automatica) {
      try {
        const m = await manifestar(cred.token, cred.amb, n.chave, "ciencia");
        if (m.ok) {
          manifestacao = "ciencia";
          resumo.ciencias++;
        } else resumo.avisos.push(`Ciência da nota ${rotuloNota(n)}: ${m.mensagem}`);
      } catch (e) {
        resumo.avisos.push(`Ciência da nota ${rotuloNota(n)}: ${mensagemDe(e)}`);
      }
    }

    // XML completo, quando a Focus já recebeu da SEFAZ e ainda não guardamos
    let xml: string | null = null;
    let nfe: NFe | null = null;
    if (n.completa && !ant?.completa) {
      try {
        xml = await baixarXmlRecebida(cred.token, cred.amb, n.chave);
        if (xml) {
          resumo.xmls++;
          try {
            nfe = lerNFe(xml);
          } catch {
            nfe = null;
          }
        }
      } catch (e) {
        resumo.avisos.push(`XML da nota ${rotuloNota(n)}: ${mensagemDe(e)}`);
      }
    }

    const { numero, serie } = numeroDaChave(n.chave);
    const base = {
      company_id: empresa.id,
      numero: nfe?.numero || numero,
      serie: nfe?.serie || serie,
      emitente_nome: nfe?.emitenteNome || n.emitenteNome || null,
      emitente_cnpj: soDigitos(nfe?.emitenteCnpj || n.emitenteDoc) || null,
      destinatario_cnpj: soDigitos(nfe?.destinatarioCnpj || n.destinatarioCnpj) || null,
      emitida_em: nfe?.emitidaEm || n.emitidaEm,
      total: nfe ? nfe.total : n.total,
      situacao: n.situacao,
      manifestacao,
      versao: n.versao,
      atualizado_em: agora(),
    };

    if (!ant) {
      novos.push({ ...base, store_id: cfg.store_id, chave: n.chave, itens: nfe ? nfe.itens.length : null, completa: !!xml, xml, origem: "focus" });
      resumo.novas++;
    } else if (Number(ant.versao) !== n.versao || xml || ant.manifestacao !== manifestacao || ant.situacao !== n.situacao) {
      const mudancas: Record<string, unknown> = { ...base };
      if (xml) {
        mudancas.xml = xml;
        mudancas.completa = true;
        if (nfe) mudancas.itens = nfe.itens.length;
      }
      const r = await admin.from("nfe_entradas").update(mudancas).eq("id", ant.id);
      if (r.error) throw new Error(erroTabela(r.error.message));
      resumo.atualizadas++;
    }
    if (novos.length >= 25) await gravarNovos();
  }
  await gravarNovos();
  return inteiro;
}

// Notas que já guardamos mas ainda sem XML: tenta baixar de novo (a SEFAZ demora um pouco depois da ciência)
// e dá a ciência nas que ficaram sem, se a ciência automática foi ligada depois.
async function conferirPendentes(ctx: Contexto): Promise<void> {
  const { admin, empresa, cfg, cred, prazoFinal, resumo } = ctx;

  const semXml = await admin
    .from("nfe_entradas")
    .select("id, chave")
    .eq("store_id", cfg.store_id)
    .eq("company_id", empresa.id)
    .eq("completa", false)
    .eq("situacao", "autorizada")
    .in("manifestacao", ["ciencia", "confirmacao"])
    .order("atualizado_em", { ascending: true })
    .limit(10);
  for (const p of (semXml.data ?? []) as { id: string; chave: string }[]) {
    if (prazoFinal - Date.now() < 5_000) return;
    const mudancas: Record<string, unknown> = { atualizado_em: agora() }; // quem ficou sem XML vai para o fim da fila
    try {
      const xml = await baixarXmlRecebida(cred.token, cred.amb, p.chave);
      if (xml) {
        mudancas.xml = xml;
        mudancas.completa = true;
        resumo.xmls++;
        try {
          const nfe = lerNFe(xml);
          mudancas.itens = nfe.itens.length;
          mudancas.total = nfe.total;
          if (nfe.emitenteNome) mudancas.emitente_nome = nfe.emitenteNome;
        } catch {
          /* XML guardado mesmo assim */
        }
      }
    } catch {
      /* tenta de novo na próxima busca */
    }
    await admin.from("nfe_entradas").update(mudancas).eq("id", p.id);
  }

  if (!cfg.ciencia_automatica) return;
  const semCiencia = await admin
    .from("nfe_entradas")
    .select("id, chave")
    .eq("store_id", cfg.store_id)
    .eq("company_id", empresa.id)
    .eq("completa", false)
    .eq("situacao", "autorizada")
    .is("manifestacao", null)
    .order("atualizado_em", { ascending: true })
    .limit(10);
  for (const p of (semCiencia.data ?? []) as { id: string; chave: string }[]) {
    if (prazoFinal - Date.now() < 5_000) return;
    try {
      const m = await manifestar(cred.token, cred.amb, p.chave, "ciencia");
      if (m.ok) {
        resumo.ciencias++;
        await admin.from("nfe_entradas").update({ manifestacao: "ciencia", atualizado_em: agora() }).eq("id", p.id);
      } else resumo.avisos.push(`Ciência da nota ${numeroDaChave(p.chave).numero}: ${m.mensagem}`);
    } catch (e) {
      resumo.avisos.push(`Ciência da nota ${numeroDaChave(p.chave).numero}: ${mensagemDe(e)}`);
      return; // se uma falhou por token/permissão, as outras também falham
    }
  }
}

// Busca as notas novas de um CNPJ na Focus NFe e guarda em nfe_entradas. Só traz o que mudou desde a última busca.
export async function buscarEntradas(admin: SupabaseClient, empresa: EmpresaFiscal, cfg: ConfigFiscal, prazoFinal: number): Promise<ResumoBusca> {
  const resumo: ResumoBusca = { empresaId: empresa.id, empresa: empresa.name, novas: 0, atualizadas: 0, xmls: 0, ciencias: 0, avisos: [], parcial: false };
  const cred = credencialEntrada(cfg);
  const cnpj = soDigitos(empresa.cnpj);
  if (!cred) {
    resumo.erro = "Falta o token da Focus NFe deste CNPJ.";
    return resumo;
  }
  if (cnpj.length !== 14) {
    resumo.erro = "O CNPJ cadastrado não tem 14 números. Corrija em Configurações.";
    return resumo;
  }
  const ctx: Contexto = { admin, empresa, cfg, cred, prazoFinal, resumo };
  const registrar = (campos: Record<string, unknown>) =>
    admin.from("fiscal_config").update({ ...campos, atualizado_em: agora() }).eq("store_id", cfg.store_id).eq("company_id", cfg.company_id);

  let versao = Number(cfg.entrada_versao) || 0;
  try {
    // A Focus devolve até 100 notas por consulta e X-Max-Version é a maior versão entre as devolvidas. A documentação não
    // garante que venham em ordem de versão. Se a ordem fosse outra, avançar o cursor pularia notas em silêncio; por isso
    // confere se o total que falta bate com o esperado e avisa quando não bater.
    let faltavaDepoisDaAnterior: number | null = null;
    for (let pagina = 0; pagina < 30; pagina++) {
      if (prazoFinal - Date.now() < 8_000) {
        resumo.parcial = true;
        break;
      }
      const lote = await listarRecebidas(cred.token, cred.amb, cnpj, versao);
      if (faltavaDepoisDaAnterior !== null && lote.total < faltavaDepoisDaAnterior) {
        resumo.avisos.push("A Focus NFe devolveu menos notas do que o esperado ao paginar; pode haver nota antiga que não veio. Se faltar alguma na lista, envie o XML dela manualmente.");
      }
      if (lote.notas.length === 0) break;
      const inteiro = await processarLote(ctx, lote.notas);
      if (!inteiro) {
        resumo.parcial = true;
        break;
      }
      const proxima = lote.maxVersao ?? Math.max(...lote.notas.map((n) => n.versao));
      if (!(proxima > versao)) break;
      versao = proxima;
      await registrar({ entrada_versao: versao });
      const faltam = lote.total - lote.notas.length;
      if (faltam <= 0 && lote.notas.length < 100) break;
      faltavaDepoisDaAnterior = faltam > 0 ? faltam : null;
      if (pagina === 29) resumo.parcial = true;
    }
    if (!resumo.parcial) await conferirPendentes(ctx);
    await registrar({ entrada_ultima_busca: agora(), entrada_erro: null });
  } catch (e) {
    resumo.erro = erroTabela(mensagemDe(e));
    await registrar({ entrada_ultima_busca: agora(), entrada_erro: resumo.erro });
  }
  return resumo;
}
