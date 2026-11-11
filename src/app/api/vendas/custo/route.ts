import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { conferirSenha } from "@/lib/server/senha";

export const dynamic = "force-dynamic";

// Informa à mão o custo de uma venda que está sem custo. Exige a senha master.
// body: { sale_id, custo (total da venda, R$), senha }
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const custo = Number(body.custo);
    if (!body.sale_id || !Number.isFinite(custo) || custo <= 0) return NextResponse.json({ error: "Informe um custo maior que zero." }, { status: 400 });

    const situacao = await conferirSenha(user.id, String(body.senha ?? ""));
    if (situacao === "sem_senha") return NextResponse.json({ error: "Defina primeiro a senha master em Configurações." }, { status: 400 });
    if (situacao === "errada") return NextResponse.json({ error: "Senha master errada." }, { status: 403 });

    const admin = supabaseAdmin();
    const { data: venda } = await admin.from("sales").select("id, cost_price").eq("id", String(body.sale_id)).eq("store_id", user.id).maybeSingle();
    if (!venda) return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });
    if (Number(venda.cost_price) > 0) return NextResponse.json({ error: "Esta venda já tem custo." }, { status: 400 });

    const { error } = await admin.from("sales").update({ cost_price: Math.round(custo * 100) / 100, cost_manual: true }).eq("id", venda.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao salvar o custo" }, { status: 500 });
  }
}
