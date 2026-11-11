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
    // Procura pela mesma consulta que lista as contas e apaga pelo valor exato guardado no banco.
    const { data: linhas, error: errLista } = await admin.from("ml_connections").select("ml_user_id").eq("store_id", user.id);
    if (errLista) throw new Error(errLista.message);
    const alvo = (linhas ?? []).filter((l) => String(l.ml_user_id).trim() === mlUserId.trim());
    let removidas = 0;
    for (const l of alvo) {
      const { data: apagadas, error } = await admin
        .from("ml_connections")
        .delete()
        .eq("store_id", user.id)
        .eq("ml_user_id", l.ml_user_id)
        .select("ml_user_id");
      if (error) throw new Error(error.message);
      removidas += apagadas?.length ?? 0;
    }
    console.log(`[disconnect] store=${user.id} pedido=${JSON.stringify(mlUserId)} no_banco=${JSON.stringify((linhas ?? []).map((l) => l.ml_user_id))} removidas=${removidas}`);
    if (removidas === 0) {
      return NextResponse.json(
        { error: `Não consegui remover. Contas no banco: ${JSON.stringify((linhas ?? []).map((l) => l.ml_user_id))}; pedido: ${JSON.stringify(mlUserId)}.` },
        { status: 404 }
      );
    }
    await admin.from("listings").update({ auto_price: false }).eq("store_id", user.id).eq("ml_user_id", mlUserId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
