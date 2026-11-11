import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

// Desconecta uma conta do Mercado Livre. Anúncios e vendas já importados ficam guardados;
// o preço automático dos anúncios dessa conta é desligado (sem acesso, o sistema não consegue alterar preços).
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const mlUserId = String(body.ml_user_id || "");
    if (!mlUserId) return NextResponse.json({ error: "Informe a conta" }, { status: 400 });

    const admin = supabaseAdmin();
    const { data: apagadas, error } = await admin
      .from("ml_connections")
      .delete()
      .eq("store_id", user.id)
      .eq("ml_user_id", mlUserId)
      .select("ml_user_id");
    if (error) throw new Error(error.message);
    console.log(`[disconnect] store=${user.id} conta=${mlUserId} removidas=${apagadas?.length ?? 0}`);
    if (!apagadas || apagadas.length === 0) return NextResponse.json({ error: "Essa conta não foi encontrada no banco (já removida?)." }, { status: 404 });
    await admin.from("listings").update({ auto_price: false }).eq("store_id", user.id).eq("ml_user_id", mlUserId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
