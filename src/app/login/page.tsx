"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

const campo =
  "w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-gold/30";

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

  async function entrarComGoogle() {
    setErro("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard/produtos` },
    });
    if (error) setErro("Não foi possível entrar com o Google. Tente novamente.");
  }

  return (
    <main className="min-h-screen bg-paper font-body text-ink antialiased flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="font-display text-xl font-semibold">
          Diego Rezende <span className="text-gold">Digital</span>
        </Link>
        <h1 className="font-display text-2xl font-medium mt-8 mb-1">Entrar na sua loja</h1>
        <p className="text-ink/60 text-sm mb-8">Acesse seus produtos e acompanhe o lucro real das suas vendas.</p>

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

        <form onSubmit={entrar} className="space-y-4">
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
          <button
            disabled={enviando}
            className="w-full rounded-full bg-ink px-4 py-3 text-sm font-medium text-paper hover:bg-inkdeep transition-colors disabled:opacity-60"
          >
            {enviando ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink/60">
          Ainda não tem conta?{" "}
          <Link href="/signup" className="font-medium text-ink underline underline-offset-4">
            Criar conta
          </Link>
        </p>
      </div>
    </main>
  );
}
