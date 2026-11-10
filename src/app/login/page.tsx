"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEnviando(false);
    if (error) {
      setErro("E-mail ou senha incorretos.");
      return;
    }
    router.push("/dashboard/produtos");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-bold text-brand">Margem Certa</h1>
      <p className="mb-6 text-sm text-slate-600">Entre para ver o lucro real das suas vendas.</p>
      <form onSubmit={entrar} className="card space-y-3">
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="senha">Senha</label>
          <input id="senha" type="password" className="input" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </div>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <button className="btn w-full" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        Ainda não tem conta? <Link href="/signup" className="font-medium text-brand underline">Criar conta</Link>
      </p>
    </main>
  );
}
