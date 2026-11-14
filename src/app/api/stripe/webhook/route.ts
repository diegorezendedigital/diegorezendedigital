import { NextResponse } from "next/server";
import { salvarAssinatura, stripe, webhookValido } from "@/lib/server/stripe";

export const dynamic = "force-dynamic";

// Mantém o estado da assinatura em dia (renovação, cancelamento, falha de pagamento).
export async function POST(req: Request) {
  const bruto = await req.text();
  if (!webhookValido(bruto, req.headers.get("stripe-signature"))) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 400 });
  }
  const ev = JSON.parse(bruto);
  try {
    if (ev.type === "checkout.session.completed") {
      const s = ev.data.object;
      const email = String(s.customer_details?.email ?? s.customer_email ?? "").toLowerCase();
      if (email && s.subscription) {
        const sub = await stripe("GET", `/subscriptions/${s.subscription}`);
        await salvarAssinatura(email, sub, s.metadata?.plano);
      }
    } else if (String(ev.type).startsWith("customer.subscription.")) {
      const sub = ev.data.object;
      let email = String(sub.metadata?.email ?? "").toLowerCase();
      if (!email && sub.customer) {
        const c = await stripe("GET", `/customers/${sub.customer}`);
        email = String(c.email ?? "").toLowerCase();
      }
      if (email) await salvarAssinatura(email, sub);
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
