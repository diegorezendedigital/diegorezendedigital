"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

const abas = [
  { href: "/dashboard/produtos", label: "Produtos" },
  { href: "/dashboard/calculadora", label: "Calculadora" },
  { href: "/dashboard/mercadolivre", label: "Mercado Livre" },
  { href: "/dashboard/relatorios", label: "Relatórios" },
  { href: "/dashboard/dre", label: "DRE" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [carregando, setCarregando] = useState(true);
  const [nomeLoja, setNomeLoja] = useState("");
  const [ehAdmin, setEhAdmin] = useState(false);

  useEffect(() => {
    let ativo = true;

    async function verificarSessao() {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) {
        router.push("/login");
        return;
      }

      const lojaResp = await supabase.from("stores").select("name").eq("id", user.id).maybeSingle();
      let nome: string = lojaResp.data?.name ?? "";
      if (!lojaResp.data) {
        // Conta antiga sem loja: cria agora (a regra do banco permite só a própria loja).
        nome = (user.user_metadata?.full_name as string | undefined) || "Minha Loja";
        await supabase.from("stores").insert({ id: user.id, name: nome });
      }
      const adminResp = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();

      if (ativo) {
        setNomeLoja(nome);
        setEhAdmin(!!adminResp.data);
        setCarregando(false);
      }
    }

    verificarSessao();
    return () => {
      ativo = false;
    };
  }, [router]);

  async function sair() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (carregando) return <p className="p-8 text-sm text-slate-500">Carregando…</p>;

  const todas = ehAdmin ? [...abas, { href: "/dashboard/admin", label: "Admin" }] : abas;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <span className="text-lg font-bold text-brand">Margem Certa</span>
            {nomeLoja && <span className="ml-2 text-sm text-slate-500">{nomeLoja}</span>}
          </div>
          <button onClick={sair} className="btn-ghost">Sair</button>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {todas.map((a) => {
            const ativa = pathname === a.href;
            return (
              <Link
                key={a.href}
                href={a.href}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                  ativa ? "border-brand text-brand" : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                {a.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
