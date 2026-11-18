"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/supabase/client";
import { ABAS, TODAS_AS_ABAS } from "@/lib/abas";

type Membro = { id: string; email: string; nome: string | null; created_at: string; ultimo_login: string | null; permissoes?: string[] | null };
type Resp = { papel: "master" | "convidado"; loja: { id: string; nome: string }; membros: Membro[]; precisaSQL?: boolean; precisaSQLPermissoes?: boolean };

// Caixas de seleção das abas, agrupadas
function EscolherAbas({ valor, onChange }: { valor: string[]; onChange: (v: string[]) => void }) {
  const grupos = Array.from(new Set(ABAS.map((a) => a.grupo)));
  const alternar = (ids: string[], on: boolean) => {
    const n = new Set(valor);
    ids.forEach((i) => (on ? n.add(i) : n.delete(i)));
    onChange(TODAS_AS_ABAS.filter((a) => n.has(a)));
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs">
        <button type="button" className="font-medium text-brand hover:underline" onClick={() => onChange([...TODAS_AS_ABAS])}>Marcar todas</button>
        <button type="button" className="text-slate-500 hover:underline" onClick={() => onChange([])}>Desmarcar todas</button>
        <span className="text-slate-400">{valor.length} de {TODAS_AS_ABAS.length} abas</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {grupos.map((g) => {
          const ids = ABAS.filter((a) => a.grupo === g).map((a) => a.id as string);
          const qtd = ids.filter((i) => valor.includes(i)).length;
          return (
            <div key={g} className="rounded-xl border border-slate-200 p-3">
              <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <input type="checkbox" checked={qtd === ids.length} ref={(el) => { if (el) el.indeterminate = qtd > 0 && qtd < ids.length; }} onChange={(e) => alternar(ids, e.target.checked)} />
                {g}
              </label>
              {ABAS.filter((a) => a.grupo === g).map((a) => (
                <label key={a.id} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-slate-700">
                  <input type="checkbox" checked={valor.includes(a.id)} onChange={(e) => alternar([a.id], e.target.checked)} />
                  {a.label}
                </label>
              ))}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">Integrações e Configurações (contas, CNPJs, senha master e usuários) ficam sempre só com você.</p>
    </div>
  );
}

const data = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function UsuariosPage() {
  const [r, setR] = useState<Resp | null>(null);
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [abasNovo, setAbasNovo] = useState<string[]>([...TODAS_AS_ABAS]);
  const [editando, setEditando] = useState<{ id: string; abas: string[] } | null>(null);
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
      await apiFetch("/api/equipe", { method: "POST", body: JSON.stringify({ email, nome, permissoes: abasNovo }) });
      setMsg({ ok: true, t: `Convite enviado para ${email}. A pessoa recebe um e-mail para criar a senha e já entra na sua loja.` });
      setEmail("");
      setNome("");
      setAbasNovo([...TODAS_AS_ABAS]);
      carregar();
    } catch (err) {
      setMsg({ ok: false, t: err instanceof Error ? err.message : String(err) });
    } finally {
      setEnviando(false);
    }
  }

  async function salvarAbas() {
    if (!editando) return;
    if (!editando.abas.length) return setMsg({ ok: false, t: "Libere pelo menos uma aba." });
    try {
      await apiFetch("/api/equipe", { method: "PATCH", body: JSON.stringify({ id: editando.id, permissoes: editando.abas }) });
      setMsg({ ok: true, t: "Acessos atualizados. Valem no próximo carregamento de página do colaborador." });
      setEditando(null);
      carregar();
    } catch (err) {
      setMsg({ ok: false, t: err instanceof Error ? err.message : String(err) });
    }
  }

  const resumoAbas = (p?: string[] | null) =>
    !p || p.length === TODAS_AS_ABAS.length ? "Todas as abas" : p.map((id) => ABAS.find((a) => a.id === id)?.label ?? id).join(", ");

  async function reenviar(m: Membro) {
    try {
      await apiFetch("/api/equipe", { method: "PUT", body: JSON.stringify({ id: m.id }) });
      setMsg({ ok: true, t: `E-mail reenviado para ${m.email}. O link vale por pouco tempo e só pode ser usado uma vez.` });
    } catch (err) {
      setMsg({ ok: false, t: err instanceof Error ? err.message : String(err) });
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
            <li>Só as abas que você liberar para cada pessoa</li>
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

      {r?.precisaSQLPermissoes && (
        <div className="card border border-amber-200 bg-amber-50 text-sm text-amber-800">
          Para escolher as abas de cada colaborador, rode no Supabase: <code>alter table public.store_members add column if not exists permissoes text[];</code>
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
              <button className="btn" disabled={enviando || abasNovo.length === 0}>{enviando ? "Enviando…" : "Enviar convite"}</button>
            </div>
            <div>
              <p className="label mb-2">Abas que essa pessoa pode acessar</p>
              <EscolherAbas valor={abasNovo} onChange={setAbasNovo} />
            </div>
            <p className="text-xs text-slate-500">Use um e-mail que ainda não tenha conta no sistema. A pessoa recebe o link para criar a senha.</p>
            {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.t}</p>}
          </form>

          <div className="card p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100"><th className="th">Usuário</th><th className="th">Acesso</th><th className="th">Situação</th><th className="th" /></tr></thead>
              <tbody>
                {!r ? (
                  <tr><td className="td text-slate-500" colSpan={4}>Carregando…</td></tr>
                ) : r.membros.length === 0 ? (
                  <tr><td className="td text-slate-500" colSpan={4}>Nenhum convidado ainda.</td></tr>
                ) : (
                  r.membros.map((m) => (
                    <Fragment key={m.id}>
                    <tr className="border-t border-slate-100">
                      <td className="td"><p className="font-medium">{m.nome || "—"}</p><p className="text-xs text-slate-500">{m.email} · convidado em {data(m.created_at)}</p></td>
                      <td className="td max-w-xs text-xs text-slate-600">{resumoAbas(m.permissoes)}</td>
                      <td className="td">
                        {m.ultimo_login ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Ativo · último acesso {data(m.ultimo_login)}</span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Convite pendente</span>
                        )}
                      </td>
                      <td className="td whitespace-nowrap text-right">
                        <button className="btn-ghost" onClick={() => setEditando(editando?.id === m.id ? null : { id: m.id, abas: m.permissoes?.length ? [...m.permissoes] : [...TODAS_AS_ABAS] })}>{editando?.id === m.id ? "Fechar" : "Editar acessos"}</button>
                        {!m.ultimo_login && <button className="btn-ghost" onClick={() => reenviar(m)}>Reenviar convite</button>}
                        <button className="btn-ghost text-red-700" onClick={() => remover(m)}>Remover</button>
                      </td>
                    </tr>
                    {editando?.id === m.id && (
                      <tr><td colSpan={4} className="bg-slate-50 p-4">
                        <EscolherAbas valor={editando.abas} onChange={(v) => setEditando({ id: m.id, abas: v })} />
                        <div className="mt-3 flex gap-2"><button className="btn" onClick={salvarAbas}>Salvar acessos</button><button className="btn-ghost" onClick={() => setEditando(null)}>Cancelar</button></div>
                      </td></tr>
                    )}
                    </Fragment>
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
