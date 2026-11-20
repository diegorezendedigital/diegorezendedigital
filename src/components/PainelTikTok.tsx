"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/supabase/client";
import { Company, mensagemErro } from "@/lib/types";

type LojaTikTok = {
  shop_id: string;
  shop_name: string | null;
  store_name: string | null;
  seller_name: string | null;
  region: string | null;
  company_id: string | null;
  connected_at: string;
  refresh_expires_at: string | null;
  last_synced_at: string | null;
};

const SQL = `create table if not exists public.tiktok_connections (
  store_id uuid not null references public.stores(id) on delete cascade,
  shop_id text not null,
  shop_name text,
  shop_cipher text,
  shop_code text,
  region text,
  open_id text,
  seller_name text,
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
alter table public.tiktok_connections enable row level security;
notify pgrst, 'reload schema';`;

export default function PainelTikTok({ empresas, aoContar }: { empresas: Company[]; aoContar?: (n: number) => void }) {
  const [lojas, setLojas] = useState<LojaTikTok[]>([]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [precisaSQL, setPrecisaSQL] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await apiFetch<{ accounts: LojaTikTok[]; precisaSQL?: boolean }>("/api/tiktok/accounts");
      setLojas(r.accounts);
      setPrecisaSQL(!!r.precisaSQL);
      aoContar?.(r.accounts.length);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }, [aoContar]);

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("canal") === "tiktok") {
      const c = qs.get("conectado");
      if (c) setAviso(`TikTok Shop conectada! ${c === "1" ? "1 loja autorizada." : `${c} lojas autorizadas.`}`);
      const e = qs.get("erro");
      if (e === "negado") setErro("Você não autorizou o acesso na TikTok Shop.");
      else if (e) setErro("Não foi possível concluir a conexão com a TikTok Shop." + (qs.get("detalhe") ? ` Motivo: ${qs.get("detalhe")}` : " Tente novamente."));
    }
    carregar();
  }, [carregar]);

  async function conectar() {
    setErro("");
    setAviso("");
    try {
      const { url } = await apiFetch<{ url: string }>("/api/tiktok/connect", { method: "POST" });
      setAviso("Abrindo a TikTok Shop para autorizar…");
      window.location.href = url;
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function salvar(l: LojaTikTok, campo: "store_name" | "company_id", valor: string) {
    try {
      await apiFetch("/api/tiktok/accounts", { method: "PATCH", body: JSON.stringify({ shop_id: l.shop_id, [campo]: valor }) });
      setLojas((x) => x.map((y) => (y.shop_id === l.shop_id ? { ...y, [campo]: valor || null } : y)));
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function desconectar(l: LojaTikTok) {
    try {
      await apiFetch("/api/tiktok/disconnect", { method: "POST", body: JSON.stringify({ shop_id: l.shop_id }) });
      setConfirmando(null);
      setAviso(`Loja ${l.store_name || l.shop_name || l.shop_id} removida. As vendas já importadas continuam guardadas.`);
      carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-600">Conecte sua loja da TikTok Shop para importar pedidos, taxas e produtos.</p>
        <button className="btn ml-auto" onClick={conectar} disabled={precisaSQL}>+ Conectar TikTok Shop</button>
      </div>

      {aviso && <p className="text-sm text-emerald-800">{aviso}</p>}
      {erro && <p className="text-sm text-red-700">{erro}</p>}

      {precisaSQL && (
        <div className="card space-y-2 border-amber-300 bg-amber-50 text-sm">
          <p className="font-medium text-amber-900">Falta criar a tabela da TikTok Shop no Supabase (uma vez só).</p>
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
              <th className="p-3">Loja na TikTok / ID</th>
              <th className="p-3">CNPJ</th>
              <th className="p-3">Conectada em</th>
              <th className="p-3">Autorização expira em</th>
              <th className="p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {lojas.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-slate-500">Nenhuma loja da TikTok Shop conectada.</td></tr>
            )}
            {lojas.map((l) => (
              <tr key={l.shop_id} className="border-b border-slate-100">
                <td className="p-3">
                  <input className="input py-1" defaultValue={l.store_name ?? ""} placeholder={l.shop_name ?? "Nome"} onBlur={(e) => e.target.value !== (l.store_name ?? "") && salvar(l, "store_name", e.target.value)} />
                </td>
                <td className="p-3">
                  <p>{l.shop_name ?? "—"}</p>
                  <p className="font-mono text-[11px] text-slate-500">{l.shop_id}{l.region ? ` · ${l.region}` : ""}</p>
                </td>
                <td className="p-3">
                  <select className="input py-1" value={l.company_id ?? ""} onChange={(e) => salvar(l, "company_id", e.target.value)}>
                    <option value="">—</option>
                    {empresas.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </td>
                <td className="p-3 text-slate-600">{new Date(l.connected_at).toLocaleString("pt-BR")}</td>
                <td className="p-3 text-slate-600">{l.refresh_expires_at ? new Date(l.refresh_expires_at).toLocaleDateString("pt-BR") : "—"}</td>
                <td className="p-3">
                  {confirmando === l.shop_id ? (
                    <span className="flex gap-2">
                      <button className="text-red-700 hover:underline" onClick={() => desconectar(l)}>Confirmar</button>
                      <button className="text-slate-500 hover:underline" onClick={() => setConfirmando(null)}>Cancelar</button>
                    </span>
                  ) : (
                    <button className="text-red-700 hover:underline" onClick={() => setConfirmando(l.shop_id)}>Remover</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
