import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// O TikTok Shop volta aqui depois que o vendedor autoriza o app.
// A troca do código pelo acesso à loja será feita quando o app for aprovado e as chaves estiverem ativas.
export async function GET(req: Request) {
  const url = new URL(req.url);
  return NextResponse.redirect(new URL("/dashboard/integracoes?canal=tiktok&em_breve=1", url));
}
