"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

// Troca a senha de login da conta que está entrada. A senha vai direto para o Supabase; o sistema não guarda nem vê.
export default function AlterarSenha({ aoConcluir, classeCampo = "input", classeBotao = "btn" }: { aoConcluir?: () => void; classeCampo?: string; classeBotao?: string }) {
  const [nova, setNova] = useState("");
  const [repetir, setRepetir] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (nova.length < 8) return setMsg({ ok: false, t: "A senha precisa ter pelo menos 8 caracteres." });
    if (nova !== repetir) return setMsg({ ok: false, t: "As duas senhas não são iguais." });
    setEnviando(true);
    const { error } = await supabase.auth.updateUser({ password: nova });
    setEnviando(false);
    if (error) return setMsg({ ok: false, t: /different|same/i.test(error.message) ? "A nova senha precisa ser diferente da atual." : `Não foi possível trocar a senha: ${error.message}` });
    setNova("");
    setRepetir("");
    setMsg({ ok: true, t: "Senha alterada. Use a nova senha no próximo login." });
    aoConcluir?.();
  }

  return (
    <form onSubmit={salvar} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Nova senha</label>
          <input type="password" autoComplete="new-password" className={classeCampo} value={nova} onChange={(e) => setNova(e.target.value)} required />
        </div>
        <div>
          <label className="label">Repetir nova senha</label>
          <input type="password" autoComplete="new-password" className={classeCampo} value={repetir} onChange={(e) => setRepetir(e.target.value)} required />
        </div>
      </div>
      <p className="text-xs text-slate-500">Mínimo de 8 caracteres. Use letras, números e um símbolo.</p>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.t}</p>}
      <button className={classeBotao} disabled={enviando}>{enviando ? "Salvando…" : "Trocar senha"}</button>
    </form>
  );
}
