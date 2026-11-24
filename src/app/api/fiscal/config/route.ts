import { NextResponse } from "next/server";
import { exigirAba, masterOuIntegracoes, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { chamarFocus, listarRecebidas, mensagemFocus, type Ambiente } from "@/lib/server/focus";
import { erroTabela, mascara, soDigitos, type ConfigFiscal } from "@/lib/server/fiscal";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Empresa = { id: string; name: string; cnpj: string | null; regime: string };

// Token novo: sem espaços e com tamanho razoável. undefined = não mexer.
function limparToken(x: unknown): string | undefined | "invalido" {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  if (!t) return undefined;
  if (/\s/.test(t) || t.length < 12 || t.length > 200) return "invalido";
  return t;
}

// GET: CNPJs da loja com o estado da configuração fiscal. Os tokens nunca saem inteiros do servidor.
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const bloqueio = user.permissoes?.includes("integracoes") ? null : exigirAba(user, ["nf_entrada", "nf_saida"]);
  if (bloqueio) return bloqueio;
  const admin = supabaseAdmin();
  const emp = await admin.from("companies").select("id, name, cnpj, regime").eq("store_id", user.id).order("created_at");
  if (emp.error) return NextResponse.json({ error: emp.error.message }, { status: 500 });
  const cfg = await admin.from("fiscal_config").select("*").eq("store_id", user.id);
  const precisaSQL = !!cfg.error && /fiscal_config|schema cache|does not exist/i.test(cfg.error.message);
  if (cfg.error && !precisaSQL) return NextResponse.json({ error: cfg.error.message }, { status: 500 });
  const porEmpresa = new Map(((cfg.data ?? []) as ConfigFiscal[]).map((c) => [c.company_id, c]));
  return NextResponse.json({
    precisaSQL,
    podeEditar: user.papel === "master" || !!user.permissoes?.includes("integracoes"),
    empresas: ((emp.data ?? []) as Empresa[]).map((e) => {
      const c = porEmpresa.get(e.id);
      return {
        id: e.id,
        nome: e.name,
        cnpj: e.cnpj,
        regime: e.regime,
        configurado: !!(c?.token_producao || c?.token_homologacao),
        tokenProducao: mascara(c?.token_producao),
        tokenHomologacao: mascara(c?.token_homologacao),
        entradaAtiva: c ? c.entrada_ativa : true,
        cienciaAutomatica: c ? c.ciencia_automatica : true,
        ultimaBusca: c?.entrada_ultima_busca ?? null,
        erro: c?.entrada_erro ?? null,
      };
    }),
  });
}

async function validarToken(token: string, amb: Ambiente): Promise<{ ok: boolean; mensagem: string }> {
  // Consulta uma referência que não existe: com token bom a Focus responde 404 em JSON; com token ruim, 401.
  const r = await chamarFocus(token, amb, "GET", "/nfe/conexao-teste-diego-rezende");
  if (r.status === 401) return { ok: false, mensagem: mensagemFocus(r) };
  if (r.status === 404 || r.ok) return { ok: true, mensagem: "A Focus NFe aceitou o token." };
  return { ok: false, mensagem: mensagemFocus(r) };
}

// POST { acao: "salvar" | "testar", companyId, ... }
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const bloqueio = masterOuIntegracoes(user);
  if (bloqueio) return bloqueio;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const companyId = String(b.companyId || "");
  const admin = supabaseAdmin();
  const emp = await admin.from("companies").select("id, name, cnpj, regime").eq("store_id", user.id).eq("id", companyId).maybeSingle();
  if (!emp.data) return NextResponse.json({ error: "Escolha um CNPJ da sua loja." }, { status: 400 });
  const empresa = emp.data as Empresa;
  const atual = await admin.from("fiscal_config").select("*").eq("store_id", user.id).eq("company_id", companyId).maybeSingle();
  if (atual.error) {
    if (/fiscal_config|schema cache|does not exist/i.test(atual.error.message)) return NextResponse.json({ error: erroTabela(atual.error.message), precisaSQL: true }, { status: 400 });
    return NextResponse.json({ error: atual.error.message }, { status: 500 });
  }
  const cfg = (atual.data ?? null) as ConfigFiscal | null;

  if (b.acao === "salvar") {
    const prod = limparToken(b.tokenProducao);
    const homolog = limparToken(b.tokenHomologacao);
    if (prod === "invalido" || homolog === "invalido") {
      return NextResponse.json({ error: "O token tem espaços ou tamanho estranho. Copie de novo, sem espaços, do painel da Focus NFe." }, { status: 400 });
    }
    const linha: Record<string, unknown> = {
      store_id: user.id,
      company_id: companyId,
      provedor: "focus",
      atualizado_em: new Date().toISOString(),
    };
    if (prod) linha.token_producao = prod;
    if (homolog) linha.token_homologacao = homolog;
    if (b.removerProducao === true) linha.token_producao = null;
    if (b.removerHomologacao === true) linha.token_homologacao = null;
    if (typeof b.entradaAtiva === "boolean") linha.entrada_ativa = b.entradaAtiva;
    if (typeof b.cienciaAutomatica === "boolean") linha.ciencia_automatica = b.cienciaAutomatica;
    // Trocou o token de produção: recomeça a busca do zero (a versão guardada era de outro cadastro)
    if (prod && cfg?.token_producao && cfg.token_producao !== prod) linha.entrada_versao = 0;
    const r = await admin.from("fiscal_config").upsert(linha, { onConflict: "store_id,company_id" });
    if (r.error) return NextResponse.json({ error: erroTabela(r.error.message), precisaSQL: /fiscal_config|schema cache|does not exist/i.test(r.error.message) }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (b.acao === "testar") {
    if (!cfg || (!cfg.token_producao && !cfg.token_homologacao)) return NextResponse.json({ error: "Salve o token da Focus NFe antes de testar." }, { status: 400 });
    const resultados: { ambiente: Ambiente; ok: boolean; mensagem: string }[] = [];
    for (const amb of ["producao", "homologacao"] as Ambiente[]) {
      const token = amb === "producao" ? cfg.token_producao : cfg.token_homologacao;
      if (!token) continue;
      try {
        const v = await validarToken(token, amb);
        let mensagem = v.mensagem;
        let ok = v.ok;
        // Produção: confere também se o recebimento de notas está ligado para este CNPJ
        if (ok && amb === "producao") {
          const cnpj = soDigitos(empresa.cnpj);
          if (cnpj.length !== 14) {
            ok = false;
            mensagem = "O CNPJ cadastrado não tem 14 números. Corrija em Configurações.";
          } else {
            try {
              await listarRecebidas(token, amb, cnpj, 999_999_999_999);
              mensagem = "Token aceito e recebimento de notas liberado para este CNPJ.";
            } catch (e) {
              ok = false;
              mensagem = e instanceof Error ? e.message : "Não consegui consultar as notas recebidas.";
            }
          }
        }
        resultados.push({ ambiente: amb, ok, mensagem });
      } catch (e) {
        resultados.push({ ambiente: amb, ok: false, mensagem: e instanceof Error ? e.message : "Falha ao testar." });
      }
    }
    return NextResponse.json({ ok: resultados.every((x) => x.ok), resultados });
  }

  return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
}
