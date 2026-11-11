import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { getAccessToken, listConnections, mlGet } from "@/lib/server/ml";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Bruta = {
  id?: string;
  type?: string;
  status?: string;
  name?: string;
  start_date?: string;
  finish_date?: string;
  deadline_date?: string;
  sub_type?: string;
};

// Promoções que o Mercado Livre oferece às contas conectadas (campanhas, ofertas relâmpago, descontos etc.).
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const contas = await listConnections(user.id);
    const saida = await Promise.all(
      contas.map(async (c) => {
        const base = { ml_user_id: c.ml_user_id, conta: c.store_name || c.nickname || c.ml_user_id };
        try {
          const token = await getAccessToken(user.id, c.ml_user_id);
          if (!token) return { ...base, promocoes: [], erro: "Sem acesso: reconecte a conta em Integrações." };
          const r = await mlGet<{ results?: Bruta[] } | Bruta[]>(token, `/seller-promotions/users/${c.ml_user_id}?app_version=v2`);
          const lista = Array.isArray(r) ? r : r.results ?? [];
          return {
            ...base,
            promocoes: lista.map((p) => ({
              id: p.id ?? "",
              type: p.type ?? "",
              sub_type: p.sub_type ?? null,
              status: p.status ?? "",
              name: p.name ?? p.id ?? "Promoção",
              start_date: p.start_date ?? null,
              finish_date: p.finish_date ?? null,
              deadline_date: p.deadline_date ?? null,
            })),
          };
        } catch (e) {
          return { ...base, promocoes: [], erro: e instanceof Error ? e.message : "Erro no Mercado Livre" };
        }
      })
    );
    return NextResponse.json({ contas: saida });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
