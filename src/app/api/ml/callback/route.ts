import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { exchangeCode, mlGet, verifyState } from "@/lib/server/ml";

export const dynamic = "force-dynamic";

// O Mercado Livre volta aqui com ?code=...&state=... depois que o vendedor autoriza.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const voltar = (qs: string) => NextResponse.redirect(new URL(`/dashboard/integracoes?${qs}`, url));

  try {
    if (url.searchParams.get("error")) return voltar("erro=negado");

    const storeId = verifyState(url.searchParams.get("state"));
    const code = url.searchParams.get("code");
    if (!storeId || !code) return voltar("erro=state");

    const t = await exchangeCode(code, url.searchParams.get("state") as string);
    const admin = supabaseAdmin();

    // Garante que a loja existe (a tabela de conexões depende dela).
    await admin.from("stores").upsert({ id: storeId, name: "Minha Loja" }, { onConflict: "id", ignoreDuplicates: true });

    let apelido: string | null = null;
    try {
      const eu = await mlGet<{ nickname?: string }>(t.access_token, "/users/me");
      apelido = eu.nickname ?? null;
    } catch {
      /* o apelido é só para exibir */
    }

    const { error } = await admin.from("ml_connections").upsert(
      {
        store_id: storeId,
        ml_user_id: String(t.user_id),
        ...(apelido ? { nickname: apelido } : {}),
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
        connected_at: new Date().toISOString(),
      },
      { onConflict: "store_id,ml_user_id" }
    );
    if (error) throw new Error(error.message);

    return voltar("conectado=1");
  } catch (e) {
    console.error(e);
    // Mostra o motivo na tela (vem do Mercado Livre ou do banco; nunca contém segredos).
    const detalhe = e instanceof Error ? e.message.slice(0, 200) : "";
    return voltar(`erro=conexao&detalhe=${encodeURIComponent(detalhe)}`);
  }
}
