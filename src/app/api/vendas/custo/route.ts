import { NextResponse } from "next/server";
import { exigirAba, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { conferirSenha } from "@/lib/server/senha";

export const dynamic = "force-dynamic";

// Informa à mão o custo de uma venda que está sem custo. Exige a senha master.
// body: { sale_id, custo (total da venda, R$), senha }
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  { const semAcesso = exigirAba(user, ["pedidos"]); if (semAcesso) return semAcesso; }
  try {
    const body = await req.json().catch(() => ({}));
    const custo = Number(body.custo);
    if (!body.sale_id || !Number.isFinite(custo) || custo <= 0) return NextResponse.json({ error: "Informe um custo maior que zero." }, { status: 400 });

    const situacao = await conferirSenha(user.id, String(body.senha ?? ""));
    if (situacao === "sem_senha") return NextResponse.json({ error: "Defina primeiro a senha master em Configurações." }, { status: 400 });
    if (situacao === "errada") return NextResponse.json({ error: "Senha master errada." }, { status: 403 });

    const admin = supabaseAdmin();
    const { data: venda } = await admin.from("sales").select("id, cost_price, quantity, product_id, listing_id, sku").eq("id", String(body.sale_id)).eq("store_id", user.id).maybeSingle();
    if (!venda) return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });
    if (Number(venda.cost_price) > 0) return NextResponse.json({ error: "Esta venda já tem custo." }, { status: 400 });

    const { error } = await admin.from("sales").update({ cost_price: Math.round(custo * 100) / 100, cost_manual: true }).eq("id", venda.id);
    if (error) throw new Error(error.message);

    // Atualiza também o produto do armazém (custo unitário = custo da venda ÷ quantidade).
    // Só preenche se o produto estiver sem custo: um custo já cadastrado não é sobrescrito por uma venda.
    let produto: { id: string; sku: string; cost_price: number | null } | null = null;
    let produtoId: string | null = venda.product_id ?? null;
    if (!produtoId && venda.listing_id) {
      const { data: an } = await admin.from("listings").select("product_id").eq("id", venda.listing_id).maybeSingle();
      produtoId = an?.product_id ?? null;
    }
    if (produtoId) {
      const { data } = await admin.from("products").select("id, sku, cost_price").eq("id", produtoId).eq("store_id", user.id).maybeSingle();
      produto = data;
    } else if (venda.sku) {
      const { data } = await admin.from("products").select("id, sku, cost_price").eq("store_id", user.id).eq("sku", venda.sku).limit(2);
      if (data && data.length === 1) produto = data[0];
    }
    let produtoAtualizado: "sim" | "ja_tinha_custo" | "sem_produto" = "sem_produto";
    if (produto) {
      if (Number(produto.cost_price) > 0) produtoAtualizado = "ja_tinha_custo";
      else {
        const qtd = Math.max(1, Number(venda.quantity) || 1);
        const unit = Math.round((custo / qtd) * 100) / 100;
        const r = await admin.from("products").update({ cost_price: unit, cost_updated_at: new Date().toISOString() }).eq("id", produto.id);
        if (!r.error) produtoAtualizado = "sim";
      }
      if (!venda.product_id) await admin.from("sales").update({ product_id: produto.id }).eq("id", venda.id);
    }
    return NextResponse.json({ ok: true, produto: produtoAtualizado, sku: produto?.sku ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao salvar o custo" }, { status: 500 });
  }
}
