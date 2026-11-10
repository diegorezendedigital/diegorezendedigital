import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, listConnections, mlGet } from "@/lib/server/ml";

export const dynamic = "force-dynamic";

// Contas conectadas + reputação de cada uma. Nunca devolve os tokens.
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  try {
    const contas = await listConnections(user.id);
    const accounts = await Promise.all(
      contas.map(async (c) => {
        const base = {
          ml_user_id: c.ml_user_id,
          nickname: c.nickname,
          company_id: c.company_id,
          last_synced_at: c.last_synced_at,
          connected_at: c.connected_at,
        };
        try {
          const token = await getAccessToken(user.id, c.ml_user_id);
          if (!token) return { ...base, ml_error: "Sem acesso" };
          const me = await mlGet(token, "/users/me");
          const rep = me.seller_reputation || {};
          return {
            ...base,
            nickname: me.nickname ?? c.nickname,
            level_id: rep.level_id || null,
            power_seller_status: rep.power_seller_status || null,
            transactions: rep.transactions || null,
            metrics: rep.metrics || null,
          };
        } catch (e) {
          // Conexão existe, mas o ML recusou (ex.: acesso revogado). A tela pede para reconectar.
          return { ...base, ml_error: e instanceof Error ? e.message : "Erro no Mercado Livre" };
        }
      })
    );
    return NextResponse.json({ accounts });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
