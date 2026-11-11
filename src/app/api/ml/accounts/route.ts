import { NextResponse } from "next/server";
import { supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, listConnections, mlGet } from "@/lib/server/ml";

export const dynamic = "force-dynamic";

// Lista leve das contas conectadas (só do banco, sem falar com o Mercado Livre).
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const contas = await listConnections(user.id);
    // Contas sem apelido gravado: busca no Mercado Livre e guarda para as próximas vezes.
    for (const c of contas) {
      if (c.nickname) continue;
      try {
        const token = await getAccessToken(user.id, c.ml_user_id);
        if (!token) continue;
        const eu = await mlGet<{ nickname?: string }>(token, `/users/${c.ml_user_id}`);
        if (eu.nickname) {
          c.nickname = eu.nickname;
          await supabaseAdmin().from("ml_connections").update({ nickname: eu.nickname }).eq("store_id", user.id).eq("ml_user_id", c.ml_user_id);
        }
      } catch {
        /* segue sem apelido */
      }
    }
    // Status: consegue renovar o acesso? (renova se preciso; falha = precisa reconectar)
    const status = await Promise.all(
      contas.map(async (c) => {
        try {
          return (await getAccessToken(user.id, c.ml_user_id)) ? "ativo" : "reconectar";
        } catch {
          return "reconectar";
        }
      })
    );
    const atuais = await listConnections(user.id);
    return NextResponse.json({
      accounts: atuais.map((c, i) => ({
        ml_user_id: c.ml_user_id,
        nickname: c.nickname,
        store_name: (c as { store_name?: string | null }).store_name ?? null,
        company_id: c.company_id,
        last_synced_at: c.last_synced_at,
        connected_at: c.connected_at,
        expires_at: c.expires_at,
        status: status[i] ?? "reconectar",
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
