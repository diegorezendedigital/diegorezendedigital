"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import AlterarSenha from "@/components/AlterarSenha";

const campo = "w-full rounded-lg border border-line bg-white px-4 py-3 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-gold/30";

// Página aberta pelo link do e-mail "Esqueci minha senha"
export default function RedefinirSenhaPage() {
  const router = useRouter();
  const [pronto, setPronto] = useState<boolean | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((evento, sessao) => {
      if (evento === "PASSWORD_RECOVERY" || sessao) setPronto(true);
    });
    supabase.auth.getSession().then(({ data }) => setPronto((p) => p || !!data.session));
    const t = setTimeout(() => setPronto((p) => (p === null ? false : p)), 4000);
    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(t);
    };
  }, []);

  return (
    <main className="min-h-screen bg-paper font-body text-ink antialiased flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <Link href="/" className="font-display text-xl font-semibold">
          Diego Rezende <span className="text-gold">Digital</span>
        </Link>
        <h1 className="font-display text-2xl font-medium mt-8 mb-1">Criar nova senha</h1>
        {pronto === null && <p className="text-sm text-ink/60">Validando o link…</p>}
        {pronto === false && (
          <p className="text-sm text-ink/70">
            Este link expirou ou já foi usado. Peça um novo em <Link href="/login" className="underline">Entrar › Esqueci minha senha</Link>.
          </p>
        )}
        {pronto && (
          <div className="mt-6">
            <AlterarSenha classeCampo={campo} classeBotao="w-full rounded-full bg-ink px-4 py-3 text-sm font-medium text-paper hover:bg-inkdeep transition-colors disabled:opacity-60" aoConcluir={() => setTimeout(() => router.push("/dashboard"), 1500)} />
          </div>
        )}
      </div>
    </main>
  );
}
