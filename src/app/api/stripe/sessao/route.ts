import { NextResponse } from "next/server";
import { salvarAssinatura, stripe } from "@/lib/server/stripe";

export const dynamic = "force-dynamic";

// Depois do pagamento, a tela de cadastro confere a sessão e recebe o e-mail liberado.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return NextResponse.json({ error: "Sessão inválida." }, { status: 400 });
  try {
    const s = await stripe("GET", `/checkout/sessions/${id}`, { "expand[]": "subscription" });
    const email = String(s.customer_details?.email ?? s.customer_email ?? "").toLowerCase();
    const sub = s.subscription;
    const ok = s.status === "complete" && sub && ["active", "trialing"].includes(sub.status);
    if (!ok || !email) return NextResponse.json({ pago: false });
    await salvarAssinatura(email, sub, s.metadata?.plano);
    return NextResponse.json({ pago: true, email });
  } catch (e) {
    return NextResponse.json({ pago: false, error: e instanceof Error ? e.message : "Erro" }, { status: 502 });
  }
}
