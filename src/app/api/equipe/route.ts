import { NextResponse } from "next/server";
import { apenasMaster, supabaseAdmin, userFromRequest } from "@/lib/server/supabase-admin";
import { TODAS_AS_ABAS } from "@/lib/abas";

// Só aceita abas conhecidas; lista vazia ou com todas = acesso total (null)
function limparAbas(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null;
  const v = x.map(String).filter((a) => (TODAS_AS_ABAS as string[]).includes(a));
  return v.length === 0 || v.length === TODAS_AS_ABAS.length ? null : v;
}

export const dynamic = "force-dynamic";

const falta = (m: string) => /store_members|schema cache|does not exist/i.test(m);

// GET: quem sou eu na loja + (para o master) a lista de convidados
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: loja } = await admin.from("stores").select("name").eq("id", user.id).maybeSingle();
  if (user.papel === "convidado") {
    await admin.from("store_members").update({ last_seen_at: new Date().toISOString() }).eq("user_id", user.authId);
    return NextResponse.json({ papel: user.papel, permissoes: user.permissoes, loja: { id: user.id, nome: loja?.name ?? "" }, membros: [] });
  }
  type Linha = { id: string; email: string; nome: string | null; user_id: string | null; created_at: string; last_seen_at: string | null; permissoes?: string[] | null };
  const campos = "id, email, nome, user_id, created_at, last_seen_at";
  let semColuna = false;
  let r: { data: unknown; error: { message: string } | null } = await admin.from("store_members").select(`${campos}, permissoes`).eq("store_id", user.id).order("created_at");
  if (r.error && /permissoes/.test(r.error.message)) {
    semColuna = true;
    r = await admin.from("store_members").select(campos).eq("store_id", user.id).order("created_at");
  }
  const data = ((r.data as Linha[] | null) ?? []);
  const error = r.error;
  if (error) return NextResponse.json({ papel: user.papel, loja: { id: user.id, nome: loja?.name ?? "" }, membros: [], precisaSQL: falta(error.message) });
  // Convite aceito = o convidado já entrou alguma vez
  const ids = data.map((m) => m.user_id).filter(Boolean) as string[];
  const entrou = new Map<string, string | null>();
  for (const id of ids) {
    const r = await admin.auth.admin.getUserById(id);
    entrou.set(id, r.data.user?.last_sign_in_at ?? null);
  }
  return NextResponse.json({
    precisaSQLPermissoes: semColuna,
    papel: user.papel,
    loja: { id: user.id, nome: loja?.name ?? "" },
    membros: data.map((m) => ({ ...m, ultimo_login: m.user_id ? entrou.get(m.user_id) ?? null : null })),
  });
}

// POST { email, nome } → convida: cria o login e manda o e-mail para a pessoa criar a senha
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const bloqueio = apenasMaster(user);
  if (bloqueio) return bloqueio;
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim().toLowerCase();
  const nome = String(b.nome ?? "").trim().slice(0, 80);
  const permissoes = limparAbas(b.permissoes);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  if (email === (user.email ?? "").toLowerCase()) return NextResponse.json({ error: "Esse é o seu próprio e-mail." }, { status: 400 });
  const admin = supabaseAdmin();
  const { error: e0 } = await admin.from("store_members").select("id").limit(1);
  if (e0) return NextResponse.json({ error: falta(e0.message) ? "Rode o SQL de usuários da loja no Supabase antes de convidar." : e0.message }, { status: 400 });

  // 1) Registra o convite antes de criar o login: a trava de assinatura do cadastro libera e-mails convidados
  await admin.from("store_members").delete().eq("store_id", user.id).eq("email", email).is("user_id", null);
  const linha: Record<string, unknown> = { store_id: user.id, email, nome: nome || null, invited_by: user.authId };
  if (permissoes) linha.permissoes = permissoes;
  const { data: conv, error: eConv } = await admin.from("store_members").insert(linha).select("id").single();
  if (eConv || !conv) {
    const m = eConv?.message ?? "";
    if (/duplicate|unique/i.test(m)) return NextResponse.json({ error: "Esse e-mail já é usuário da sua loja." }, { status: 400 });
    return NextResponse.json({ error: m || "Não foi possível registrar o convite" }, { status: 500 });
  }

  // 2) Cria o login e manda o e-mail para a pessoa criar a senha
  const origem = req.headers.get("origin") || `https://${req.headers.get("host")}`;
  const r = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${origem}/redefinir-senha`, data: { name: nome, convidado_por: user.id } });
  if (r.error || !r.data.user) {
    await admin.from("store_members").delete().eq("id", conv.id);
    const msg = r.error?.message ?? "";
    if (/already|registered|exists/i.test(msg))
      return NextResponse.json({ error: "Esse e-mail já tem conta no sistema. Para evitar misturar lojas, use outro e-mail para o convidado." }, { status: 400 });
    if (/rate limit/i.test(msg)) return NextResponse.json({ error: "Limite de e-mails do Supabase atingido. Tente de novo em uma hora." }, { status: 429 });
    if (/database error/i.test(msg))
      return NextResponse.json({ error: "O banco recusou a criação do login. Rode no Supabase o SQL que libera convidados na trava de assinatura (20261208_convite_libera_cadastro.sql)." }, { status: 500 });
    return NextResponse.json({ error: `Não foi possível convidar: ${msg}` }, { status: 500 });
  }

  // 3) Liga o login ao convite
  const { error } = await admin.from("store_members").update({ user_id: r.data.user.id }).eq("id", conv.id);
  if (error) {
    await admin.auth.admin.deleteUser(r.data.user.id).catch(() => {});
    await admin.from("store_members").delete().eq("id", conv.id);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// DELETE ?id= → remove o convidado da loja e apaga o login dele (foi criado só para esta loja)
export async function DELETE(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const bloqueio = apenasMaster(user);
  if (bloqueio) return bloqueio;
  const id = new URL(req.url).searchParams.get("id");
  const admin = supabaseAdmin();
  const { data: m } = await admin.from("store_members").select("id, user_id").eq("id", id).eq("store_id", user.id).maybeSingle();
  if (!m) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (m.user_id) await admin.auth.admin.deleteUser(m.user_id as string).catch(() => {});
  await admin.from("store_members").delete().eq("id", m.id);
  return NextResponse.json({ ok: true });
}

// PATCH { id, permissoes } → muda as abas que o colaborador pode acessar
export async function PATCH(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const bloqueio = apenasMaster(user);
  if (bloqueio) return bloqueio;
  const b = await req.json().catch(() => ({}));
  const { error } = await supabaseAdmin().from("store_members").update({ permissoes: limparAbas(b.permissoes) }).eq("id", String(b.id ?? "")).eq("store_id", user.id);
  if (error) return NextResponse.json({ error: /permissoes/.test(error.message) ? "Rode o SQL das permissões (coluna permissoes) no Supabase." : error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
