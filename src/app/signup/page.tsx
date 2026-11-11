"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

const campo =
  "w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-gold/30";

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

  async function entrarComGoogle() {
    setErro("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard/produtos` },
    });
    if (error) setErro("Não foi possível continuar com o Google. Tente novamente.");
  }

  return (
    <main className="min-h-screen bg-paper font-body text-ink antialiased flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="font-display text-xl font-semibold">
          Diego Rezende <span className="text-gold">Digital</span>
        </Link>
        <h1 className="font-display text-2xl font-medium mt-8 mb-1">Criar conta</h1>
        <p className="text-ink/60 text-sm mb-8">Comece a calcular a margem real das suas vendas. É grátis.</p>

        <button
          type="button"
          onClick={entrarComGoogle}
          className="w-full rounded-full border border-ink px-4 py-3 text-sm font-medium hover:bg-ink hover:text-paper transition-colors"
        >
          Continuar com Google
        </button>

        <div className="my-6 flex items-center gap-3 text-xs text-ink/40">
          <span className="h-px flex-1 bg-line" />
          ou
          <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={criar} className="space-y-4">
          <div>
            <label htmlFor="nome" className="mb-1 block font-mono text-xs uppercase tracking-widest text-clay">
              Nome da loja
            </label>
            <input id="nome" className={campo} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Minha Loja" />
          </div>
          <div>
            <label htmlFor="email" className="mb-1 block font-mono text-xs uppercase tracking-widest text-clay">
              E-mail
            </label>
            <input id="email" type="email" className={campo} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="senha" className="mb-1 block font-mono text-xs uppercase tracking-widest text-clay">
              Senha
            </label>
            <input id="senha" type="password" className={campo} value={senha} onChange={(e) => setSenha(e.target.value)} required />
          </div>
          {erro && <p className="text-sm text-red-700">{erro}</p>}
          {aviso && <p className="text-sm text-emerald-800">{aviso}</p>}
          <button
            disabled={enviando}
            className="w-full rounded-full bg-ink px-4 py-3 text-sm font-medium text-paper hover:bg-inkdeep transition-colors disabled:opacity-60"
          >
            {enviando ? "Criando…" : "Criar conta"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink/60">
          Já tem conta?{" "}
          <Link href="/login" className="font-medium text-ink underline underline-offset-4">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
