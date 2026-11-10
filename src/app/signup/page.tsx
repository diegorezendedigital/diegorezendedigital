"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setAviso("");
    if (senha.length < 6) {
      setErro("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    setEnviando(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: senha,
      options: { data: { full_name: nome.trim() || "Minha Loja" } },
    });
    setEnviando(false);
    if (error) {
      setErro(error.message);
      return;
    }
    if (data.session) router.push("/dashboard/produtos");
    else setAviso("Conta criada! Confirme o e-mail que enviamos para você e depois entre.");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-bold text-brand">Criar conta</h1>
      <p className="mb-6 text-sm text-slate-600">Comece a calcular a margem real das suas vendas.</p>
      <form onSubmit={criar} className="card space-y-3">
        <div>
          <label className="label" htmlFor="nome">Nome da loja</label>
          <input id="nome" className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Minha Loja" />
        </div>
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="senha">Senha</label>
          <input id="senha" type="password" className="input" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </div>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        {aviso && <p className="text-sm text-emerald-700">{aviso}</p>}
        <button className="btn w-full" disabled={enviando}>{enviando ? "Criando…" : "Criar conta"}</button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        Já tem conta? <Link href="/login" className="font-medium text-brand underline">Entrar</Link>
      </p>
    </main>
  );
}
