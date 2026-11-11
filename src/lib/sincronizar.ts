import { apiFetch } from "@/lib/supabase/client";
import type { ContaML } from "@/lib/types";

type SyncResp = { processed: number; imported: number; listings_created: number; total: number; next_offset: number; has_more: boolean };

// Importa/reprocessa as vendas de todas as contas, página por página. Vendas que já têm custo gravado não mudam de custo.
export async function sincronizarVendas(dias: number, onProgresso: (texto: string) => void): Promise<{ vendas: number; anuncios: number; contas: number }> {
  const { accounts } = await apiFetch<{ accounts: ContaML[] }>("/api/ml/accounts");
  let vendas = 0;
  let anuncios = 0;
  for (const c of accounts) {
    let offset = 0;
    const nome = c.store_name || c.nickname || c.ml_user_id;
    for (;;) {
      const r = await apiFetch<SyncResp>("/api/ml/sync", {
        method: "POST",
        body: JSON.stringify({ days: dias, offset, ml_user_id: c.ml_user_id }),
      });
      vendas += r.imported;
      anuncios += r.listings_created;
      offset = r.next_offset;
      onProgresso(`${nome}: ${Math.min(offset, r.total)} de ${r.total} pedidos…`);
      if (!r.has_more) break;
    }
  }
  return { vendas, anuncios, contas: accounts.length };
}
