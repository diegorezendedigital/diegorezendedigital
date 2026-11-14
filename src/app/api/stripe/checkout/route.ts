import { NextResponse } from "next/server";
import { PlanoId, precoDoPlano, stripe } from "@/lib/server/stripe";

export const dynamic = "force-dynamic";

// Abre o checkout da Stripe para a assinatura. Body: { plano: "mensal" | "anual", email }.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const plano: PlanoId = body.plano === "anual" ? "anual" : "mensal";
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
  }
  const price = precoDoPlano(plano);
  if (!price) return NextResponse.json({ error: "Assinatura ainda não configurada." }, { status: 503 });
  try {
    const origem = new URL(req.url).origin;
    const sessao = await stripe("POST", "/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      customer_email: email,
      locale: "pt-BR",
      allow_promotion_codes: "true",
      "metadata[plano]": plano,
      "subscription_data[metadata][email]": email,
      "subscription_data[metadata][plano]": plano,
      success_url: `${origem}/signup?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origem}/planos?cancelado=1`,
    });
    return NextResponse.json({ url: sessao.url });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao abrir o pagamento." }, { status: 502 });
  }
}
