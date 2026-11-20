import { NextResponse } from "next/server";
import { verifyState } from "@/lib/server/ml";
import { guardarConexao, lojasAutorizadas, trocarCodigo } from "@/lib/server/tiktok";

export const dynamic = "force-dynamic";

// A TikTok Shop volta aqui com ?code=...&state=... depois que o vendedor autoriza o app.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const voltar = (qs: string) => NextResponse.redirect(new URL(`/dashboard/integracoes?canal=tiktok&${qs}`, url));
  try {
    const storeId = verifyState(url.searchParams.get("state"));
    const code = url.searchParams.get("code");
    if (!code) return voltar("erro=negado");
    if (!storeId) return voltar("erro=conexao&detalhe=" + encodeURIComponent("O link de autorização expirou. Clique em Conectar de novo."));
    const t = await trocarCodigo(code);
    const lojas = await lojasAutorizadas(t.access_token);
    await guardarConexao(storeId, t, lojas);
    return voltar(`conectado=${lojas.length}`);
  } catch (e) {
    console.error(e);
    return voltar(`erro=conexao&detalhe=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 200) : "")}`);
  }
}
