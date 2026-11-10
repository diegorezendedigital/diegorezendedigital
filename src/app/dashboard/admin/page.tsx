"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { brl } from "@/lib/types";

type Loja = { id: string; name: string; created_at: string };
type Resumo = { vendas: number; receita: number; lucro: number };

export default function AdminPage() {
  const [permitido, setPermitido] = useState<boolean | null>(null);
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [resumo, setResumo] = useState<Record<string, Resumo>>({});

  useEffect(() => {
    async function carregar() {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      const adm = await supabase.from("admins").select("user_id").eq("user_id", uid ?? "").maybeSingle();
      if (!adm.data) {
        setPermitido(false);
        return;
      }
      setPermitido(true);
      const [l, s] = await Promise.all([
        supabase.from("stores").select("*").order("created_at", { ascending: false }),
        supabase.from("sales").select("store_id, sale_price, profit").limit(10000),
      ]);
      setLojas((l.data ?? []) as Loja[]);
      const r: Record<string, Resumo> = {};
      (s.data ?? []).forEach((v: { store_id: string; sale_price: number; profit: number }) => {
        const cur = r[v.store_id] ?? { vendas: 0, receita: 0, lucro: 0 };
        cur.vendas += 1;
        cur.receita += Number(v.sale_price);
        cur.lucro += Number(v.profit);
        r[v.store_id] = cur;
      });
      setResumo(r);
    }
    carregar();
  }, []);

  if (permitido === null) return <p className="text-sm text-slate-500">Carregando…</p>;
  if (!permitido) return <p className="text-sm text-red-600">Acesso restrito a administradores.</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Admin</h1>
      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Loja</th>
              <th className="th">Criada em</th>
              <th className="th">Vendas</th>
              <th className="th">Receita</th>
              <th className="th">Lucro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lojas.length === 0 && (
              <tr>
                <td className="td text-slate-500" colSpan={5}>Nenhuma loja.</td>
              </tr>
            )}
            {lojas.map((l) => {
              const r = resumo[l.id] ?? { vendas: 0, receita: 0, lucro: 0 };
              return (
                <tr key={l.id}>
                  <td className="td">{l.name}</td>
                  <td className="td">{new Date(l.created_at).toLocaleDateString("pt-BR")}</td>
                  <td className="td">{r.vendas}</td>
                  <td className="td">{brl(r.receita)}</td>
                  <td className="td">{brl(r.lucro)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
