"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { lojaAtual } from "@/lib/loja";
import { abaDoCaminho, pode, podeIntegrar, primeiraAba } from "@/lib/abas";

type Item = { label: string; href: string };
type Menu = { label: string; href?: string; base?: string; filhos?: Item[] };

const menus: Menu[] = [
  { label: "Início", href: "/dashboard" },
  {
    label: "Produtos",
    base: "/dashboard/produtos",
    filhos: [
      { label: "Produtos armazém", href: "/dashboard/produtos/armazem" },
      { label: "Anúncios Marketplace", href: "/dashboard/produtos/anuncios" },
    ],
  },
  { label: "Pedidos", href: "/dashboard/pedidos" },
  { label: "Devoluções", href: "/dashboard/devolucoes" },
  {
    label: "Promoções",
    base: "/dashboard/promocoes",
    filhos: [
      { label: "Mercado Livre", href: "/dashboard/promocoes" },
      { label: "Shopee", href: "/dashboard/promocoes/shopee" },
      { label: "TikTok Shop", href: "/dashboard/promocoes/tiktok" },
    ],
  },
  { label: "Calculadora", href: "/dashboard/calculadora" },
  { label: "Relatórios", href: "/dashboard/relatorios" },
  { label: "DRE", href: "/dashboard/dre" },
  { label: "Integrações", href: "/dashboard/integracoes" },
  {
    label: "Configurações",
    base: "/dashboard/configuracoes",
    filhos: [
      { label: "CNPJs e senha", href: "/dashboard/configuracoes" },
      { label: "Usuários da loja", href: "/dashboard/configuracoes/usuarios" },
    ],
  },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState(false);
  const [nomeLoja, setNomeLoja] = useState("");
  const [ehAdmin, setEhAdmin] = useState(false);
  const [convidado, setConvidado] = useState(false);
  const [permissoes, setPermissoes] = useState<string[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const barra = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let ativo = true;

    // Nenhuma etapa pode deixar a tela presa em "Carregando…"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comLimite = (p: PromiseLike<any>, ms = 12000): Promise<any> =>
      Promise.race([Promise.resolve(p), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("tempo esgotado")), ms))]);

    async function verificarSessao() {
      const { data } = await comLimite(supabase.auth.getSession());
      const user = data.session?.user;
      if (!user) {
        router.push("/login");
        return;
      }

      const lojaId = (await comLimite(lojaAtual()).catch(() => undefined)) ?? user.id;
      const convidado = lojaId !== user.id;
      const lojaResp = await comLimite(supabase.from("stores").select("name").eq("id", lojaId).maybeSingle()).catch(() => ({ data: null as { name: string } | null }));
      let nome: string = lojaResp.data?.name ?? "";
      if (!lojaResp.data && !convidado && "error" in lojaResp && !lojaResp.error) {
        // Conta antiga sem loja: cria agora (a regra do banco permite só a própria loja).
        nome = (user.user_metadata?.full_name as string | undefined) || "Minha Loja";
        await supabase.from("stores").insert({ id: user.id, name: nome });
      }
      const adminResp = await comLimite(supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle()).catch(() => ({ data: null }));
      let perms: string[] | null = null;
      if (convidado) perms = await comLimite(apiFetch<{ permissoes?: string[] | null }>("/api/equipe")).then((r) => r.permissoes ?? null).catch(() => null);

      if (ativo) {
        setNomeLoja(nome);
        setEhAdmin(!!adminResp.data);
        setConvidado(convidado);
        setPermissoes(perms);
        setCarregando(false);
      }
    }

    verificarSessao().catch(() => {
      if (ativo) setFalhou(true);
    });
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

  if (carregando)
    return falhou ? (
      <div className="p-8 text-sm text-slate-600">
        <p>Não consegui confirmar o seu login agora.</p>
        <button className="btn mt-3" onClick={() => window.location.reload()}>Tentar de novo</button>
        <p className="mt-3 text-[12px] text-slate-500">Se continuar, feche as outras abas do sistema e entre de novo.</p>
      </div>
    ) : (
      <p className="p-8 text-sm text-slate-500">Carregando…</p>
    );

  // Convidado não vê Configurações (CNPJ, senha master e usuários são do master).
  // Integrações só com a permissão "integracoes" liberada pelo master.
  const SO_MASTER = ["/dashboard/configuracoes", ...(podeIntegrar(convidado, permissoes) ? [] : ["/dashboard/integracoes"])];
  // Colaborador: só as abas que o master liberou
  const liberado = (href: string) => !convidado || pode(permissoes, abaDoCaminho(href));
  const base: Menu[] = convidado
    ? menus
        .filter((m) => !SO_MASTER.includes(m.href ?? m.base ?? ""))
        .map((m) => (m.filhos ? { ...m, filhos: m.filhos.filter((f) => liberado(f.href)) } : m))
        .filter((m) => (m.filhos ? m.filhos.length > 0 : liberado(m.href as string)))
    : menus;
  if (convidado && !liberado(pathname)) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="card max-w-md">
          <p className="font-semibold">Você não tem acesso a esta área</p>
          <p className="mt-1 text-sm text-slate-600">Peça ao usuário master da loja para liberar esta aba para você.</p>
          <Link href={primeiraAba(permissoes)} className="btn mt-4">Ir para uma área liberada</Link>
        </div>
      </div>
    );
  }
  const todos: Menu[] = ehAdmin ? [...base, { label: "Admin", href: "/dashboard/admin" }] : base;
  if (convidado && SO_MASTER.some((p) => pathname.startsWith(p))) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="card max-w-md">
          <p className="font-semibold">Área do usuário master</p>
          <p className="mt-1 text-sm text-slate-600">Esta área é gerenciada pelo dono da conta. Peça a ele para liberar se precisar.</p>
          <Link href="/dashboard" className="btn mt-4">Voltar ao início</Link>
        </div>
      </div>
    );
  }
  const ativo = (m: Menu) => (m.base ? pathname.startsWith(m.base) : pathname === m.href);

  return (
    <div className="min-h-screen">
      <header ref={barra} className="sticky top-0 z-30 px-3 pt-3">
        <div className="mx-auto flex min-h-[3.5rem] max-w-none items-center gap-x-4 rounded-3xl bg-white px-5 py-1.5 shadow-card">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2 font-display text-lg font-bold tracking-tight">
            <svg width="28" height="28" viewBox="0 0 30 30" aria-hidden="true">
              <circle cx="15" cy="15" r="15" fill="#5B3DF5" />
              <path d="M7.5 19.5 L12.5 12 L16 16 L22.5 8.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="22.5" cy="8.5" r="2" fill="#FFD66B" />
            </svg>
            <span className="flex flex-col leading-tight">
              <span>Diego Rezende Digital</span>
              <span className="text-[11px] font-medium text-slate-500">Assessoria Marketplace</span>
            </span>
          </Link>

          <nav className="flex min-w-0 flex-1 items-center gap-0.5 py-0">
            {todos.map((m) => {
              const on = ativo(m);
              const base = `flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-2 text-sm ${
                on ? "bg-brand font-semibold text-white" : "font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
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
                    onClick={() => setAberto(m.label)}
                  >
                    {m.label}
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className={abertoAqui ? "rotate-180" : ""}>
                      <path d="M1 3.5 5 7.5 9 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  </button>
                  {abertoAqui && (
                    <div className="absolute left-0 top-full z-40 pt-2">
                    <div role="menu" className="min-w-[220px] rounded-2xl bg-white py-2 shadow-card">
                      {m.filhos.map((f) => (
                        <Link
                          key={f.href}
                          href={f.href}
                          role="menuitem"
                          className={`mx-1 block rounded-xl px-4 py-2 text-sm hover:bg-slate-100 ${
                            pathname === f.href ? "font-medium text-brand" : "text-slate-700"
                          }`}
                        >
                          {f.label}
                        </Link>
                      ))}
                    </div>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-4">
            {nomeLoja && (
              <span className="hidden items-center gap-1.5 font-mono text-xs text-slate-500 md:inline-flex">
                {nomeLoja}
                <span className={`rounded-full px-1.5 py-0.5 font-sans text-[10px] font-semibold ${convidado ? "bg-slate-100 text-slate-600" : "bg-brand-light text-brand"}`}>{convidado ? "convidado" : "master"}</span>
              </span>
            )}
            <button onClick={sair} className="text-sm text-slate-600 hover:text-slate-900">
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className={`mx-auto p-5 ${(pathname === "/dashboard" || pathname.startsWith("/dashboard/dre") || pathname.startsWith("/dashboard/pedidos") || pathname.startsWith("/dashboard/devolucoes") || pathname.startsWith("/dashboard/produtos/armazem") || pathname.startsWith("/dashboard/produtos/anuncios") || pathname.startsWith("/dashboard/promocoes")) ? "max-w-none px-6" : "max-w-7xl"} pb-12`}>{children}</main>
      <div className="pointer-events-none fixed bottom-2 left-2 z-50 rounded bg-white/90 px-2 py-1 font-mono text-[11px] leading-tight text-slate-600 shadow-sm ring-1 ring-slate-200">
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
