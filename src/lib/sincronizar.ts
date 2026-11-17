import { apiFetch } from "@/lib/supabase/client";
import type { ContaML } from "@/lib/types";

type SyncResp = { processed: number; imported: number; listings_created: number; total: number; next_offset: number; has_more: boolean };

// Importa/reprocessa as vendas de todas as contas, página por página. Vendas que já têm custo gravado não mudam de custo.
// onProgresso recebe o texto e a fração do total (0 a 1), para a barra de progresso.
export async function sincronizarVendas(dias: number, onProgresso: (texto: string, fracao?: number) => void, lojaIds: string[] = []): Promise<{ vendas: number; anuncios: number; contas: number }> {
  const todas = await apiFetch<{ accounts: ContaML[] }>("/api/ml/accounts");
  const sh = await apiFetch<{ accounts: { shop_id: string; shop_name: string | null; store_name?: string | null }[] }>("/api/shopee/accounts").catch(() => ({ accounts: [] }));
  const lojasSh = (sh.accounts ?? []).filter((x) => !lojaIds.length || lojaIds.includes(String(x.shop_id)));
  // lojaIds vazio = todas as lojas; senão só as escolhidas (Mercado Livre ou Shopee)
  const accounts = lojaIds.length ? todas.accounts.filter((c) => lojaIds.includes(String(c.ml_user_id))) : todas.accounts;
  let vendas = 0;
  let anuncios = 0;
  const totalLojas = Math.max(accounts.length + lojasSh.length, 1);
  let feitas = 0;
  const fracao = (parcial: number) => Math.min(1, (feitas + Math.min(Math.max(parcial, 0), 1)) / totalLojas);
  onProgresso("Começando…", 0);
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
      onProgresso(`${nome}: ${Math.min(offset, r.total)} de ${r.total} pedidos…`, fracao(r.total ? offset / r.total : 1));
      if (!r.has_more) break;
    }
    feitas++;
  }
  // Lojas da Shopee: pedidos em janelas de 15 dias (limite da Shopee)
  let lojasShopee = 0;
  try {
    for (const c of lojasSh) {
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
        onProgresso(`${nome} (Shopee): período ${Math.min(r.janela + 1, r.total_janelas)} de ${r.total_janelas}…`, fracao(r.total_janelas ? Math.min(r.janela, r.total_janelas) / r.total_janelas : 1));
        if (!r.has_more) break;
      }
      feitas++;
    }
  } catch (e) {
    if (lojasShopee > 0) throw e;
    /* sem lojas da Shopee conectadas */
  }
  return { vendas, anuncios, contas: accounts.length + lojasShopee };
}
