"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/supabase/client";
import { mensagemErro } from "@/lib/types";

type Metrica = { rate?: number; value?: number; completed?: number };
type Status = {
  connected: boolean;
  ml_user_id?: string | null;
  last_synced_at?: string | null;
  nickname?: string;
  level_id?: string | null;
  power_seller_status?: string | null;
  transactions?: { total?: number } | null;
  metrics?: {
    claims?: Metrica;
    delayed_handling_time?: Metrica;
    cancellations?: Metrica;
    sales?: Metrica;
  } | null;
  ml_error?: string;
};
type SyncResp = {
  processed: number;
  imported: number;
  listings_created: number;
  total: number;
  next_offset: number;
  has_more: boolean;
};

const NIVEIS: Record<string, [string, string]> = {
  "1_red": ["Vermelho", "bg-red-500"],
  "2_orange": ["Laranja", "bg-orange-500"],
  "3_yellow": ["Amarelo", "bg-yellow-500"],
  "4_light_green": ["Verde claro", "bg-lime-500"],
  "5_green": ["Verde", "bg-green-600"],
};
const LIDER: Record<string, string> = {
  silver: "MercadoLíder",
  gold: "MercadoLíder Gold",
  platinum: "MercadoLíder Platinum",
};

const taxa = (m?: Metrica) => (m && m.rate != null ? `${(m.rate * 100).toFixed(1).replace(".", ",")}%` : "—");

export default function MercadoLivrePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [dias, setDias] = useState("30");
  const [sincronizando, setSincronizando] = useState(false);
  const [progresso, setProgresso] = useState("");

  const carregar = useCallback(async () => {
    try {
      setStatus(await apiFetch<Status>("/api/ml/status"));
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }, []);

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("conectado")) setAviso("Conta do Mercado Livre conectada com sucesso!");
    const e = qs.get("erro");
    if (e === "negado") setErro("Você não autorizou o acesso no Mercado Livre.");
    else if (e) setErro("Não foi possível concluir a conexão. Tente novamente.");
    carregar();
  }, [carregar]);

  async function conectar() {
    setErro("");
    try {
      const { url } = await apiFetch<{ url: string }>("/api/ml/connect", { method: "POST" });
      window.location.href = url;
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function sincronizar() {
    setErro("");
    setAviso("");
    setSincronizando(true);
    let offset = 0;
    let importadas = 0;
    let produtos = 0;
    try {
      for (;;) {
        const r = await apiFetch<SyncResp>("/api/ml/sync", {
          method: "POST",
          body: JSON.stringify({ days: Number(dias), offset }),
        });
        importadas += r.imported;
        produtos += r.listings_created;
        offset = r.next_offset;
        setProgresso(`${Math.min(offset, r.total)} de ${r.total} pedidos…`);
        if (!r.has_more) break;
      }
      setAviso(
        `Sincronização concluída: ${importadas} vendas novas e ${produtos} anúncios novos. ` +
          (produtos > 0 ? "Ligue os anúncios novos a um produto do armazém (Produtos > Anúncios Marketplace) para o lucro ficar correto." : "")
      );
      carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSincronizando(false);
      setProgresso("");
    }
  }

  if (!status && !erro) return <p className="text-sm text-slate-500">Carregando…</p>;

  const nivel = status?.level_id ? NIVEIS[status.level_id] : undefined;
  const m = status?.metrics;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Mercado Livre</h1>

      {aviso && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</p>}
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      {!status?.connected && (
        <div className="card space-y-3">
          <p className="text-sm text-slate-600">
            Conecte sua conta de vendedor para importar pedidos como vendas, com a taxa e o frete reais, e ver sua reputação.
          </p>
          <button className="btn" onClick={conectar}>Conectar com Mercado Livre</button>
        </div>
      )}

      {status?.connected && (
        <>
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{status.nickname ?? `Conta ${status.ml_user_id}`}</h2>
              {nivel && <span className={`rounded-full px-3 py-1 text-xs font-semibold text-white ${nivel[1]}`}>Reputação: {nivel[0]}</span>}
              {status.power_seller_status && LIDER[status.power_seller_status] && (
                <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">{LIDER[status.power_seller_status]}</span>
              )}
            </div>
            {status.ml_error ? (
              <p className="text-sm text-red-700">
                O Mercado Livre recusou o acesso ({status.ml_error}). Reconecte a conta.{" "}
                <button onClick={conectar} className="font-medium underline">Reconectar</button>
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Metric t="Reclamações" v={taxa(m?.claims)} s={m?.claims?.value} />
                <Metric t="Atrasos no envio" v={taxa(m?.delayed_handling_time)} s={m?.delayed_handling_time?.value} />
                <Metric t="Cancelamentos" v={taxa(m?.cancellations)} s={m?.cancellations?.value} />
                <Metric t="Vendas (período)" v={m?.sales?.completed != null ? String(m.sales.completed) : "—"} />
              </div>
            )}
          </div>

          <div className="card space-y-3">
            <h2 className="font-semibold">Importar vendas</h2>
            <p className="text-sm text-slate-600">
              Traz os pedidos pagos do período como vendas (preço, taxa e frete do Mercado Livre). O custo vem do produto do armazém ligado ao anúncio e o imposto, do regime do CNPJ do anúncio.
              Pode repetir sem duplicar.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label">Período</label>
                <select className="input" value={dias} onChange={(e) => setDias(e.target.value)} disabled={sincronizando}>
                  <option value="7">Últimos 7 dias</option>
                  <option value="30">Últimos 30 dias</option>
                  <option value="60">Últimos 60 dias</option>
                  <option value="90">Últimos 90 dias</option>
                </select>
              </div>
              <button className="btn" onClick={sincronizar} disabled={sincronizando}>
                {sincronizando ? "Sincronizando…" : "Sincronizar agora"}
              </button>
              {progresso && <span className="text-sm text-slate-500">{progresso}</span>}
            </div>
            {status.last_synced_at && (
              <p className="text-xs text-slate-500">Última sincronização completa: {new Date(status.last_synced_at).toLocaleString("pt-BR")}</p>
            )}
            <p className="text-xs text-slate-500">
              Os impostos são calculados pelo regime do CNPJ (Configurações). Sem produto ligado ao anúncio, o custo fica em R$ 0,00. Confira os valores na primeira importação.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ t, v, s }: { t: string; v: string; s?: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs text-slate-500">{t}</div>
      <div className="text-xl font-bold">{v}</div>
      {s != null && <div className="text-xs text-slate-500">{s} ocorrências</div>}
    </div>
  );
}
