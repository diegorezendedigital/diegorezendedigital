import { NextResponse } from "next/server";
import { exigirAba, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { buscarEntradas, erroTabela, type ConfigFiscal, type EmpresaFiscal, type ResumoBusca } from "@/lib/server/fiscal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INTERVALO_MS = 20 * 60_000; // busca automática ao abrir a tela: no máximo a cada 20 minutos por CNPJ

// POST { companyId?, forcar? }: busca as notas novas de entrada na Focus NFe.
// Sem "forcar", pula o CNPJ que já foi buscado há menos de 20 minutos (é o que a tela faz ao abrir).
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const bloqueio = exigirAba(user, ["nf_entrada"]);
  if (bloqueio) return bloqueio;
  const b = (await req.json().catch(() => ({}))) as { companyId?: string; forcar?: boolean };
  const inicio = Date.now();
  const prazoFinal = inicio + 52_000;
  const admin = supabaseAdmin();

  const c = await admin.from("fiscal_config").select("*").eq("store_id", user.id);
  if (c.error) {
    const precisaSQL = /fiscal_config|schema cache|does not exist/i.test(c.error.message);
    return NextResponse.json({ error: erroTabela(c.error.message), precisaSQL }, { status: precisaSQL ? 200 : 500 });
  }
  let configs = ((c.data ?? []) as ConfigFiscal[]).filter((x) => x.entrada_ativa && (x.token_producao || x.token_homologacao));
  if (b.companyId) configs = configs.filter((x) => x.company_id === b.companyId);
  if (!configs.length) return NextResponse.json({ resultados: [], puladas: [], semConfig: true });

  const emp = await admin.from("companies").select("id, name, cnpj").eq("store_id", user.id).in("id", configs.map((x) => x.company_id));
  const empresas = new Map(((emp.data ?? []) as EmpresaFiscal[]).map((e) => [e.id, e]));

  const resultados: ResumoBusca[] = [];
  const puladas: string[] = [];
  for (const cfg of configs) {
    const empresa = empresas.get(cfg.company_id);
    if (!empresa) continue;
    const ultima = cfg.entrada_ultima_busca ? Date.parse(cfg.entrada_ultima_busca) : 0;
    if (!b.forcar && ultima && Date.now() - ultima < INTERVALO_MS) {
      puladas.push(empresa.name);
      continue;
    }
    if (prazoFinal - Date.now() < 12_000) {
      resultados.push({ empresaId: empresa.id, empresa: empresa.name, novas: 0, atualizadas: 0, xmls: 0, ciencias: 0, avisos: [], parcial: true });
      continue;
    }
    resultados.push(await buscarEntradas(admin, empresa, cfg, prazoFinal));
  }
  return NextResponse.json({ resultados, puladas, semConfig: false });
}
