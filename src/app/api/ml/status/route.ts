import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, getConnection, mlGet } from "@/lib/server/ml";

export const dynamic = "force-dynamic";

// Estado da conexão + reputação do vendedor. Nunca devolve os tokens.
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  try {
    const conn = await getConnection(user.id);
    if (!conn) return NextResponse.json({ connected: false });

    const base = {
      connected: true,
      ml_user_id: conn.ml_user_id as string | null,
      last_synced_at: conn.last_synced_at as string | null,
    };

    try {
      const token = await getAccessToken(user.id);
      if (!token) return NextResponse.json({ connected: false });
      const me = await mlGet(token, "/users/me");
      const rep = me.seller_reputation || {};
      return NextResponse.json({
        ...base,
        nickname: me.nickname,
        level_id: rep.level_id || null,
        power_seller_status: rep.power_seller_status || null,
        transactions: rep.transactions || null,
        metrics: rep.metrics || null,
      });
    } catch (e) {
      // Conexão existe, mas o ML recusou (ex.: acesso revogado). A tela pede para reconectar.
      return NextResponse.json({ ...base, ml_error: e instanceof Error ? e.message : "Erro no Mercado Livre" });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
