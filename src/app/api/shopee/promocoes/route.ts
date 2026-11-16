import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/supabase-admin";
import { shopeeGet, tokenShopee } from "@/lib/server/shopee";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Relampago = {
  flash_sale_id: number;
  timeslot_id?: number;
  status?: number; // 1 ativa, 2 desativada, 3 recusada pela Shopee, 0 excluída
  start_time: number;
  end_time: number;
  enabled_item_count?: number;
  item_count?: number;
  type?: number; // 1 programada, 2 acontecendo, 3 encerrada
  remindme_count?: number;
  click_count?: number;
};
type Desconto = { discount_id: number; discount_name: string; status: string; start_time: number; end_time: number; source?: number };
type Cupom = {
  voucher_id: number;
  voucher_code?: string;
  voucher_name?: string;
  voucher_type?: number; // 1 loja toda, 2 produtos
  reward_type?: number; // 1 valor fixo, 2 percentual, 3 moedas
  usage_quantity?: number;
  current_usage?: number;
  start_time: number;
  end_time: number;
  voucher_purpose?: number; // 0 público, 1 privado, 2 live, ...
  discount_amount?: number;
  percentage?: number;
  max_price?: number;
  min_basket_price?: number;
};

const LIMITE = 100;

// Lê as promoções da loja Shopee: ofertas relâmpago, descontos e cupons.
// periodo=ativas traz as que estão acontecendo e as programadas; periodo=encerradas traz as que já acabaram.
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const url = new URL(req.url);
  const shopId = url.searchParams.get("shop_id") ?? "";
  const encerradas = url.searchParams.get("periodo") === "encerradas";
  if (!shopId) return NextResponse.json({ error: "Informe a loja" }, { status: 400 });
  const token = await tokenShopee(user.id, shopId);
  if (!token) return NextResponse.json({ error: "Conecte sua loja da Shopee primeiro (Integrações)" }, { status: 400 });

  const erros: Record<string, string> = {};
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // Oferta relâmpago: tipo 1 programada, 2 acontecendo, 3 encerrada
  async function relampagos(): Promise<Relampago[]> {
    const tipos = encerradas ? [3] : [2, 1];
    const out: Relampago[] = [];
    for (const type of tipos) {
      for (let offset = 0; offset < 500; offset += LIMITE) {
        const r = await shopeeGet<{ response?: { flash_sale_list?: Relampago[]; total_count?: number } }>(
          token!, shopId, "/api/v2/shop_flash_sale/get_shop_flash_sale_list", { type, offset, limit: LIMITE }
        );
        const lista = r.response?.flash_sale_list ?? [];
        out.push(...lista);
        if (lista.length < LIMITE) break;
      }
    }
    return out;
  }

  async function paginar<T>(path: string, chaveLista: string, statusParam: string, status: string[]): Promise<T[]> {
    const out: T[] = [];
    for (const st of status) {
      for (let page_no = 1; page_no <= 5; page_no++) {
        const r = await shopeeGet<{ response?: Record<string, unknown> & { more?: boolean } }>(token!, shopId, path, { [statusParam]: st, page_no, page_size: LIMITE });
        out.push(...(((r.response?.[chaveLista] as T[] | undefined) ?? [])));
        if (!r.response?.more) break;
      }
    }
    return out;
  }

  const status = encerradas ? ["expired"] : ["ongoing", "upcoming"];
  const [rel, des, cup] = await Promise.all([
    relampagos().catch((e) => ((erros.relampago = msg(e)), [] as Relampago[])),
    paginar<Desconto>("/api/v2/discount/get_discount_list", "discount_list", "discount_status", status).catch((e) => ((erros.descontos = msg(e)), [] as Desconto[])),
    paginar<Cupom>("/api/v2/voucher/get_voucher_list", "voucher_list", "status", status).catch((e) => ((erros.cupons = msg(e)), [] as Cupom[])),
  ]);

  return NextResponse.json({ relampago: rel, descontos: des, cupons: cup, erros });
}
