import { apiFetch } from "@/lib/supabase/client";
import type { ContaML } from "@/lib/types";

type SyncResp = { processed: number; imported: number; listings_created: number; total: number; next_offset: number; has_more: boolean };

// Importa/reprocessa as vendas de todas as contas, página por página. Vendas que já têm custo gravado não mudam de custo.
export async function sincronizarVendas(dias: number, onProgresso: (texto: string) => void, lojaId = ""): Promise<{ vendas: number; anuncios: number; contas: number }> {
  const todas = await apiFetch<{ accounts: ContaML[] }>("/api/ml/accounts");
  // lojaId vazio = todas as lojas; senão só a loja escolhida (Mercado Livre ou Shopee)
  const accounts = lojaId ? todas.accounts.filter((c) => String(c.ml_user_id) === lojaId) : todas.accounts;
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
  // Lojas da Shopee: pedidos em janelas de 15 dias (limite da Shopee)
  let lojasShopee = 0;
  try {
    const sh = await apiFetch<{ accounts: { shop_id: string; shop_name: string | null; store_name?: string | null }[] }>("/api/shopee/accounts");
    for (const c of (sh.accounts ?? []).filter((x) => !lojaId || String(x.shop_id) === lojaId)) {
      lojasShopee++;
      const nome = c.store_name || c.shop_name || c.shop_id;
      let janela = 0;
      let cursor = "";
      for (;;) {
        const r = await apiFetch<{ imported: number; listings_created: number; janela: number; cursor: string; total_janelas: number; has_more: boolean }>("/api/shopee/sync", {
          method: "POST",
          body: JSON.stringify({ days: dias, shop_id: c.shop_id, janela, cursor }),
        });
        vendas += r.imported;
        anuncios += r.listings_created;
        janela = r.janela;
        cursor = r.cursor;
        onProgresso(`${nome} (Shopee): período ${Math.min(r.janela + 1, r.total_janelas)} de ${r.total_janelas}…`);
        if (!r.has_more) break;
      }
    }
  } catch (e) {
    if (lojasShopee > 0) throw e;
    /* sem lojas da Shopee conectadas */
  }
  return { vendas, anuncios, contas: accounts.length + lojasShopee };
}
