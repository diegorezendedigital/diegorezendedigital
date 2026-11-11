import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

// Atualiza uma conta do Mercado Livre: CNPJ ligado (company_id vazio = sem CNPJ) e/ou nome da loja (store_name).
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const mlUserId = String(body.ml_user_id || "");
    const companyId: string | null = body.company_id ? String(body.company_id) : null;
    const mudaCnpj = "company_id" in body;
    const mudaNome = "store_name" in body;
    if (!mlUserId) return NextResponse.json({ error: "Informe a conta" }, { status: 400 });

    const admin = supabaseAdmin();
    if (mudaCnpj && companyId) {
      const { data } = await admin.from("companies").select("id").eq("id", companyId).eq("store_id", user.id).maybeSingle();
      if (!data) return NextResponse.json({ error: "CNPJ não encontrado" }, { status: 400 });
    }
    const { error } = await admin
      .from("ml_connections")
      .update({
        ...(mudaCnpj ? { company_id: companyId } : {}),
        ...(mudaNome ? { store_name: String(body.store_name ?? "").trim().slice(0, 80) || null } : {}),
      })
      .eq("store_id", user.id)
      .eq("ml_user_id", mlUserId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
