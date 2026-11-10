import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Diagnóstico temporário: mostra só o identificador (público) do projeto Supabase que o site usa.
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  let ref = "";
  try {
    ref = new URL(url).hostname.split(".")[0];
  } catch {
    ref = "invalida";
  }
  return NextResponse.json({ supabase_ref: ref });
}
