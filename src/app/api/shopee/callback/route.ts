import { NextResponse } from "next/server";
import { verifyState } from "@/lib/server/ml";
import { guardarConexao, shopeeGet, trocarCodigo } from "@/lib/server/shopee";

export const dynamic = "force-dynamic";

// A Shopee volta aqui com ?code=...&shop_id=... (e o nosso state) depois que o vendedor autoriza.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const voltar = (qs: string) => NextResponse.redirect(new URL(`/dashboard/integracoes?canal=shopee&${qs}`, url));
  try {
    const storeId = verifyState(url.searchParams.get("state"));
    const code = url.searchParams.get("code");
    const shopId = url.searchParams.get("shop_id");
    if (!storeId || !code) return voltar("erro=state");
    if (!shopId) return voltar("erro=conexao&detalhe=" + encodeURIComponent("A Shopee não informou a loja (conta principal ainda não é suportada). Autorize uma loja."));

    const t = await trocarCodigo(code, shopId);
    let nome: string | null = null;
    let regiao: string | null = null;
    try {
      const info = await shopeeGet<{ shop_name?: string; region?: string }>(t.access_token, shopId, "/api/v2/shop/get_shop_info");
      nome = info.shop_name ?? null;
      regiao = info.region ?? null;
    } catch {
      /* o nome é só para exibir */
    }
    await guardarConexao(storeId, shopId, t, { shop_name: nome, region: regiao });
    return voltar("conectado=1");
  } catch (e) {
    console.error(e);
    const detalhe = e instanceof Error ? e.message.slice(0, 200) : "";
    return voltar(`erro=conexao&detalhe=${encodeURIComponent(detalhe)}`);
  }
}
