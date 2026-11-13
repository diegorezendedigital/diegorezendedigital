"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/supabase/client";
import { Company, mensagemErro } from "@/lib/types";

type LojaShopee = {
  shop_id: string;
  shop_name: string | null;
  store_name: string | null;
  region: string | null;
  company_id: string | null;
  connected_at: string;
  last_synced_at: string | null;
  teste: boolean;
  status: "ativo" | "reconectar";
};

export default function PainelShopee({ empresas, aoContar }: { empresas: Company[]; aoContar?: (n: number) => void }) {
  const [lojas, setLojas] = useState<LojaShopee[]>([]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [precisaSQL, setPrecisaSQL] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await apiFetch<{ accounts: LojaShopee[]; precisaSQL?: boolean; error?: string }>("/api/shopee/accounts");
      setLojas(r.accounts);
      setPrecisaSQL(!!r.precisaSQL);
      if (r.error) setErro(r.error);
      aoContar?.(r.accounts.length);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }, [aoContar]);

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("canal") === "shopee") {
      if (qs.get("conectado")) setAviso("Loja da Shopee conectada!");
      const e = qs.get("erro");
      if (e) setErro("Não foi possível concluir a conexão com a Shopee." + (qs.get("detalhe") ? ` Motivo: ${qs.get("detalhe")}` : " Tente novamente."));
    }
    carregar();
  }, [carregar]);

  async function conectar() {
    setErro("");
    setAviso("");
    try {
      const { url } = await apiFetch<{ url: string }>("/api/shopee/connect", { method: "POST" });
      setAviso("Abrindo a Shopee para autorizar…");
      window.location.href = url;
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function alterar(shopId: string, campos: Record<string, unknown>) {
    try {
      await apiFetch("/api/shopee/accounts", { method: "PATCH", body: JSON.stringify({ shop_id: shopId, ...campos }) });
      await carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function remover(shopId: string) {
    try {
      await apiFetch("/api/shopee/disconnect", { method: "POST", body: JSON.stringify({ shop_id: shopId }) });
      setConfirmando(null);
      setAviso("Loja removida.");
      await carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  const SQL = `create table if not exists public.shopee_connections (
  store_id uuid not null references public.stores(id) on delete cascade,
  shop_id text not null,
  shop_name text,
  region text,
  host text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  store_name text,
  company_id uuid references public.companies(id) on delete set null,
  primary key (store_id, shop_id)
);
alter table public.shopee_connections enable row level security;
notify pgrst, 'reload schema';`;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn ml-auto" onClick={conectar} disabled={precisaSQL}>+ Conectar loja Shopee</button>
      </div>

      {aviso && <p className="text-sm text-emerald-800">{aviso}</p>}
      {erro && <p className="text-sm text-red-700">{erro}</p>}

      {precisaSQL && (
        <div className="card space-y-2 border-amber-300 bg-amber-50 text-sm">
          <p className="font-medium text-amber-900">Falta criar a tabela da Shopee no Supabase (uma vez só).</p>
          <p className="text-amber-900">Copie, abra o SQL Editor do Supabase, cole e clique em Run. Depois volte aqui e atualize a página.</p>
          <button
            className="btn"
            onClick={async () => {
              await navigator.clipboard.writeText(SQL);
              setCopiado(true);
            }}
          >
            {copiado ? "Copiado!" : "Copiar o SQL"}
          </button>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[13px] font-medium text-slate-500">
              <th className="p-3">Nome da sua loja</th>
              <th className="p-3">Loja / ID</th>
              <th className="p-3">CNPJ</th>
              <th className="p-3">Ambiente</th>
              <th className="p-3">Status</th>
              <th className="p-3">Conectada em</th>
              <th className="p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {lojas.length === 0 && (
              <tr>
                <td className="p-4 text-slate-500" colSpan={7}>Nenhuma loja da Shopee conectada. Clique em “Conectar loja Shopee”.</td>
              </tr>
            )}
            {lojas.map((c) => (
              <tr key={c.shop_id} className="border-b border-slate-100 align-top">
                <td className="p-3">
                  <input
                    key={`n${c.shop_id}${c.store_name ?? ""}`}
                    className="input w-48 py-1"
                    placeholder={c.shop_name ?? "Dê um nome"}
                    defaultValue={c.store_name ?? ""}
                    onBlur={(e) => e.target.value.trim() !== (c.store_name ?? "") && alterar(c.shop_id, { store_name: e.target.value })}
                  />
                </td>
                <td className="p-3">
                  <div>{c.shop_name ?? "—"}{c.region ? ` · ${c.region}` : ""}</div>
                  <div className="font-mono text-xs text-slate-500">{c.shop_id}</div>
                </td>
                <td className="p-3">
                  <select className="input w-44 py-1" value={c.company_id ?? ""} onChange={(e) => alterar(c.shop_id, { company_id: e.target.value || null })}>
                    <option value="">CNPJ padrão</option>
                    {empresas.map((x) => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                  </select>
                </td>
                <td className="p-3">{c.teste ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Teste (sandbox)</span> : "Produção"}</td>
                <td className="p-3">
                  <span className={`inline-flex items-center gap-1.5 ${c.status === "ativo" ? "text-emerald-700" : "text-red-700"}`}>
                    <span className={`h-2 w-2 rounded-full ${c.status === "ativo" ? "bg-emerald-600" : "bg-red-600"}`} />
                    {c.status === "ativo" ? "Ativo" : "Precisa reconectar"}
                  </span>
                </td>
                <td className="p-3 font-mono text-xs">{new Date(c.connected_at).toLocaleString("pt-BR")}</td>
                <td className="whitespace-nowrap p-3">
                  <button className="mr-4 text-brand hover:underline" onClick={conectar}>Reconectar</button>
                  {confirmando === c.shop_id ? (
                    <span className="text-xs">
                      Remover esta loja?{" "}
                      <button className="font-semibold text-red-700 hover:underline" onClick={() => remover(c.shop_id)}>Sim, remover</button>{" "}
                      <button className="text-slate-600 hover:underline" onClick={() => setConfirmando(null)}>Não</button>
                    </span>
                  ) : (
                    <button className="text-red-700 hover:underline" onClick={() => setConfirmando(c.shop_id)}>Remover</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        Nesta etapa a Shopee só é conectada e fica com o acesso renovado sozinho. A importação de pedidos e anúncios vem na próxima etapa.
        Conectar abre a Shopee com a conta que estiver aberta neste navegador.
      </p>
    </section>
  );
}
