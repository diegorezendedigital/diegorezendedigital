import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { listConnections } from "@/lib/server/ml";

export const dynamic = "force-dynamic";

// Lista leve das contas conectadas (só do banco, sem falar com o Mercado Livre).
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const contas = await listConnections(user.id);
    return NextResponse.json({
      accounts: contas.map((c) => ({
        ml_user_id: c.ml_user_id,
        nickname: c.nickname,
        company_id: c.company_id,
        last_synced_at: c.last_synced_at,
        connected_at: c.connected_at,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
