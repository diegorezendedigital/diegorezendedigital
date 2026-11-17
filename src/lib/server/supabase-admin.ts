import { createClient } from "@supabase/supabase-js";

// Cliente com a chave service_role: ignora o RLS. Use SOMENTE em código de servidor (rotas /api).
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
  // O Next.js guarda em cache as consultas GET feitas com fetch, o que mostrava dados velhos (conta removida que "continuava",
  // apelido que não aparecia). no-store garante que cada consulta lê o banco de verdade.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}

// Descobre quem está logado a partir do "Authorization: Bearer <token>" enviado pelo navegador.
// Usuário convidado age na loja de quem o convidou: "id" é sempre a LOJA (store_id), "authId" é o login de verdade.
export type UsuarioLoja = { id: string; authId: string; papel: "master" | "convidado"; permissoes: string[] | null; email?: string; user_metadata?: Record<string, unknown> };
export async function userFromRequest(req: Request): Promise<UsuarioLoja | null> {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const u = data.user;
  const base = { authId: u.id, email: u.email, user_metadata: u.user_metadata };
  // Tabela ainda não criada (SQL não rodado): todo mundo é master da própria loja
  let { data: m, error: e1 } = await admin.from("store_members").select("store_id, permissoes").eq("user_id", u.id).maybeSingle();
  if (e1) ({ data: m } = await admin.from("store_members").select("store_id").eq("user_id", u.id).maybeSingle()); // coluna permissoes ainda não criada
  if (m?.store_id) return { ...base, id: m.store_id as string, papel: "convidado", permissoes: ((m as { permissoes?: string[] | null }).permissoes ?? null) };
  return { ...base, id: u.id, papel: "master", permissoes: null };
}

// Ações que só o usuário master da loja pode fazer (conectar contas, CNPJ, senha master, usuários).
export function apenasMaster(u: UsuarioLoja): Response | null {
  return u.papel === "master" ? null : Response.json({ error: "Só o usuário master da loja pode fazer isso." }, { status: 403 });
}

// Bloqueia o colaborador que não tem nenhuma das abas indicadas liberada.
export function exigirAba(u: UsuarioLoja, abas: string[]): Response | null {
  if (u.papel === "master" || !u.permissoes) return null;
  return abas.some((a) => u.permissoes!.includes(a)) ? null : Response.json({ error: "Você não tem acesso a esta área. Peça ao usuário master para liberar." }, { status: 403 });
}
