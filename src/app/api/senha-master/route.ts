import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { conferirSenha, gerarHash } from "@/lib/server/senha";

export const dynamic = "force-dynamic";

// GET: já existe senha master? POST {nova, atual?}: define ou troca (a troca exige a senha atual).
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { data, error } = await supabaseAdmin().from("store_secrets").select("store_id").eq("store_id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: `Banco de dados: ${error.message}` }, { status: 500 });
  return NextResponse.json({ definida: !!data });
}

export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const nova = String(body.nova ?? "");
    if (nova.length < 6) return NextResponse.json({ error: "A senha master precisa ter pelo menos 6 caracteres." }, { status: 400 });

    const situacao = await conferirSenha(user.id, String(body.atual ?? ""));
    if (situacao === "errada") return NextResponse.json({ error: "A senha atual está errada." }, { status: 403 });

    const admin = supabaseAdmin();
    await admin.from("stores").upsert({ id: user.id, name: "Minha Loja" }, { onConflict: "id", ignoreDuplicates: true });
    const { salt, hash } = gerarHash(nova);
    const { error } = await admin
      .from("store_secrets")
      .upsert({ store_id: user.id, master_salt: salt, master_hash: hash, updated_at: new Date().toISOString() }, { onConflict: "store_id" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao salvar a senha" }, { status: 500 });
  }
}
