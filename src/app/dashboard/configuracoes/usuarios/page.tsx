"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/supabase/client";

type Membro = { id: string; email: string; nome: string | null; created_at: string; ultimo_login: string | null };
type Resp = { papel: "master" | "convidado"; loja: { id: string; nome: string }; membros: Membro[]; precisaSQL?: boolean };

const data = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function UsuariosPage() {
  const [r, setR] = useState<Resp | null>(null);
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const carregar = useCallback(() => {
    apiFetch<Resp>("/api/equipe").then(setR).catch((e) => setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) }));
  }, []);
  useEffect(carregar, [carregar]);

  async function convidar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setMsg(null);
    try {
      await apiFetch("/api/equipe", { method: "POST", body: JSON.stringify({ email, nome }) });
      setMsg({ ok: true, t: `Convite enviado para ${email}. A pessoa recebe um e-mail para criar a senha e já entra na sua loja.` });
      setEmail("");
      setNome("");
      carregar();
    } catch (err) {
      setMsg({ ok: false, t: err instanceof Error ? err.message : String(err) });
    } finally {
      setEnviando(false);
    }
  }

  async function remover(m: Membro) {
    if (!confirm(`Remover ${m.nome || m.email} da loja? O login dessa pessoa será apagado e ela perde o acesso na hora.`)) return;
    try {
      await apiFetch(`/api/equipe?id=${m.id}`, { method: "DELETE" });
      setMsg({ ok: true, t: `${m.nome || m.email} foi removido.` });
      carregar();
    } catch (err) {
      setMsg({ ok: false, t: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="page-title">Usuários da loja</h1>
        <p className="mt-1 text-sm text-slate-600">
          Convide pessoas para trabalhar na sua loja{r?.loja.nome ? ` (${r.loja.nome})` : ""}. Cada uma entra com o próprio e-mail e senha e vê os mesmos produtos, anúncios, pedidos, promoções e relatórios.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <p className="flex items-center gap-2 font-semibold"><span className="rounded-full bg-brand-light px-2 py-0.5 text-xs text-brand">Master</span> Você</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Acesso a tudo</li>
            <li>Conecta e desconecta contas (Integrações)</li>
            <li>Cadastra CNPJs e a senha master</li>
            <li>Convida e remove usuários</li>
          </ul>
        </div>
        <div className="card">
          <p className="flex items-center gap-2 font-semibold"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Convidado</span> Sua equipe</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Produtos, anúncios, pedidos, promoções, calculadora, relatórios e DRE</li>
            <li>Não vê Integrações nem Configurações</li>
            <li>Ações protegidas continuam pedindo a senha master</li>
          </ul>
        </div>
      </div>

      {r?.precisaSQL && (
        <div className="card border border-amber-200 bg-amber-50 text-sm text-amber-800">
          Rode no Supabase o SQL de usuários da loja (arquivo <code>supabase/migrations/20261205_usuarios_da_loja.sql</code>) para começar a convidar.
        </div>
      )}

      {r?.papel === "convidado" ? (
        <div className="card text-sm text-slate-600">Só o usuário master pode gerenciar os usuários da loja.</div>
      ) : (
        <>
          <form onSubmit={convidar} className="card space-y-3">
            <p className="font-semibold">Convidar usuário</p>
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <div><label className="label">Nome</label><input className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Maria (expedição)" /></div>
              <div><label className="label">E-mail</label><input type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="maria@email.com" /></div>
              <button className="btn" disabled={enviando}>{enviando ? "Enviando…" : "Enviar convite"}</button>
            </div>
            <p className="text-xs text-slate-500">Use um e-mail que ainda não tenha conta no sistema. A pessoa recebe o link para criar a senha.</p>
            {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.t}</p>}
          </form>

          <div className="card p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100"><th className="th">Usuário</th><th className="th">Convidado em</th><th className="th">Situação</th><th className="th" /></tr></thead>
              <tbody>
                {!r ? (
                  <tr><td className="td text-slate-500" colSpan={4}>Carregando…</td></tr>
                ) : r.membros.length === 0 ? (
                  <tr><td className="td text-slate-500" colSpan={4}>Nenhum convidado ainda.</td></tr>
                ) : (
                  r.membros.map((m) => (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="td"><p className="font-medium">{m.nome || "—"}</p><p className="text-xs text-slate-500">{m.email}</p></td>
                      <td className="td text-slate-600">{data(m.created_at)}</td>
                      <td className="td">
                        {m.ultimo_login ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Ativo · último acesso {data(m.ultimo_login)}</span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Convite pendente</span>
                        )}
                      </td>
                      <td className="td text-right"><button className="btn-ghost text-red-700" onClick={() => remover(m)}>Remover</button></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
