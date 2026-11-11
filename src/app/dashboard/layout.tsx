"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type Item = { label: string; href: string };
type Menu = { label: string; href?: string; base?: string; filhos?: Item[] };

const menus: Menu[] = [
  {
    label: "Produtos",
    base: "/dashboard/produtos",
    filhos: [
      { label: "Produtos armazém", href: "/dashboard/produtos/armazem" },
      { label: "Anúncios Marketplace", href: "/dashboard/produtos/anuncios" },
    ],
  },
  { label: "Pedidos", href: "/dashboard/pedidos" },
  { label: "Calculadora", href: "/dashboard/calculadora" },
  { label: "Relatórios", href: "/dashboard/relatorios" },
  { label: "DRE", href: "/dashboard/dre" },
  { label: "Integrações", href: "/dashboard/integracoes" },
  { label: "Configurações", href: "/dashboard/configuracoes" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [carregando, setCarregando] = useState(true);
  const [nomeLoja, setNomeLoja] = useState("");
  const [ehAdmin, setEhAdmin] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const barra = useRef<HTMLElement | null>(null);

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

  // Fecha o submenu ao trocar de página ou clicar fora dele.
  useEffect(() => {
    setAberto(null);
  }, [pathname]);
  useEffect(() => {
    function fora(e: MouseEvent) {
      if (barra.current && !barra.current.contains(e.target as Node)) setAberto(null);
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  async function sair() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (carregando) return <p className="p-8 text-sm text-slate-500">Carregando…</p>;

  const todos: Menu[] = ehAdmin ? [...menus, { label: "Admin", href: "/dashboard/admin" }] : menus;
  const ativo = (m: Menu) => (m.base ? pathname.startsWith(m.base) : pathname === m.href);

  return (
    <div className="min-h-screen">
      <header ref={barra} className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-[3.5rem] max-w-7xl flex-wrap items-stretch gap-x-8 px-5">
          <Link href="/dashboard/produtos/armazem" className="flex shrink-0 items-center font-display text-lg font-semibold tracking-tight">
            Margem<span className="text-gold">Certa</span>
          </Link>

          <nav className="flex flex-1 flex-wrap items-stretch gap-1 py-0">
            {todos.map((m) => {
              const on = ativo(m);
              const base = `flex items-center gap-1 whitespace-nowrap border-b-2 px-3 py-4 text-sm ${
                on ? "border-brand font-medium text-slate-900" : "border-transparent text-slate-600 hover:text-slate-900"
              }`;
              if (!m.filhos) {
                return (
                  <Link key={m.label} href={m.href as string} className={base}>
                    {m.label}
                  </Link>
                );
              }
              const abertoAqui = aberto === m.label;
              return (
                <div
                  key={m.label}
                  className="relative flex"
                  onMouseEnter={() => setAberto(m.label)}
                  onMouseLeave={() => setAberto(null)}
                >
                  <button
                    type="button"
                    className={base}
                    aria-haspopup="menu"
                    aria-expanded={abertoAqui}
                    onClick={() => setAberto(abertoAqui ? null : m.label)}
                  >
                    {m.label}
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className={abertoAqui ? "rotate-180" : ""}>
                      <path d="M1 3.5 5 7.5 9 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  </button>
                  {abertoAqui && (
                    <div role="menu" className="absolute left-0 top-full min-w-[220px] rounded-b-md border border-t-0 border-slate-200 bg-white py-1">
                      {m.filhos.map((f) => (
                        <Link
                          key={f.href}
                          href={f.href}
                          role="menuitem"
                          className={`block px-4 py-2 text-sm hover:bg-slate-100 ${
                            pathname === f.href ? "font-medium text-brand" : "text-slate-700"
                          }`}
                        >
                          {f.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-4">
            {nomeLoja && <span className="hidden font-mono text-xs text-slate-500 md:inline">{nomeLoja}</span>}
            <button onClick={sair} className="text-sm text-slate-600 hover:text-slate-900">
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-5">{children}</main>
      <div className="pointer-events-none fixed bottom-1.5 left-2 font-mono text-[10px] leading-tight text-slate-400">
        v{process.env.NEXT_PUBLIC_APP_VERSION} · atualizado em{" "}
        {process.env.NEXT_PUBLIC_BUILD_TIME
          ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "—"}
      </div>
    </div>
  );
}
