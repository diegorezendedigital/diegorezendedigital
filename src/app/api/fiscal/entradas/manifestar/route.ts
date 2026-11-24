import { NextResponse } from "next/server";
import { exigirAba, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { FocusErro, manifestar, type TipoManifestacao } from "@/lib/server/focus";
import { credencialEntrada, erroTabela, type ConfigFiscal } from "@/lib/server/fiscal";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TIPOS: TipoManifestacao[] = ["ciencia", "confirmacao", "desconhecimento", "nao_realizada"];

// POST { chave, tipo, justificativa? }: manifestação do destinatário numa nota de entrada.
// "ciencia" libera o XML completo; confirmação, desconhecimento e "não realizada" são posições formais perante a SEFAZ.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const bloqueio = exigirAba(user, ["nf_entrada"]);
  if (bloqueio) return bloqueio;
  const b = (await req.json().catch(() => ({}))) as { chave?: string; tipo?: string; justificativa?: string };
  const chave = String(b.chave || "").replace(/\D/g, "");
  const tipo = TIPOS.find((t) => t === b.tipo);
  if (chave.length !== 44 || !tipo) return NextResponse.json({ error: "Informe a chave da nota e o tipo de manifestação." }, { status: 400 });
  if (tipo === "nao_realizada" && String(b.justificativa || "").trim().length < 15) {
    return NextResponse.json({ error: "Para \"operação não realizada\" a justificativa precisa ter ao menos 15 caracteres." }, { status: 400 });
  }
  const admin = supabaseAdmin();
  const nota = await admin.from("nfe_entradas").select("id, company_id").eq("store_id", user.id).eq("chave", chave).maybeSingle();
  if (nota.error) return NextResponse.json({ error: erroTabela(nota.error.message) }, { status: 400 });
  if (!nota.data?.company_id) return NextResponse.json({ error: "Nota não encontrada, ou sem CNPJ vinculado." }, { status: 404 });
  const c = await admin.from("fiscal_config").select("*").eq("store_id", user.id).eq("company_id", nota.data.company_id).maybeSingle();
  const cred = c.data ? credencialEntrada(c.data as ConfigFiscal) : null;
  if (!cred) return NextResponse.json({ error: "Este CNPJ não tem token da Focus NFe configurado." }, { status: 400 });
  try {
    const r = await manifestar(cred.token, cred.amb, chave, tipo, b.justificativa?.trim());
    if (!r.ok) return NextResponse.json({ error: r.mensagem }, { status: 400 });
    await admin.from("nfe_entradas").update({ manifestacao: tipo, atualizado_em: new Date().toISOString() }).eq("id", nota.data.id);
    return NextResponse.json({ ok: true, jaFeita: r.jaFeita });
  } catch (e) {
    const msg = e instanceof FocusErro ? e.message : "Não consegui registrar a manifestação agora.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
