"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { Company, mensagemErro } from "@/lib/types";

type Metrica = { rate?: number; value?: number; completed?: number };
type Conta = {
  ml_user_id: string;
  nickname: string | null;
  company_id: string | null;
  last_synced_at: string | null;
  level_id?: string | null;
  power_seller_status?: string | null;
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
  "1_red": ["Vermelho", "bg-red-600"],
  "2_orange": ["Laranja", "bg-orange-500"],
  "3_yellow": ["Amarelo", "bg-yellow-500"],
  "4_light_green": ["Verde claro", "bg-lime-600"],
  "5_green": ["Verde", "bg-green-700"],
};
const LIDER: Record<string, string> = {
  silver: "MercadoLíder",
  gold: "MercadoLíder Gold",
  platinum: "MercadoLíder Platinum",
};

const taxa = (m?: Metrica) => (m && m.rate != null ? `${(m.rate * 100).toFixed(1).replace(".", ",")}%` : "—");

export default function PainelML() {
  const [contas, setContas] = useState<Conta[] | null>(null);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [dias, setDias] = useState("30");
  const [sincronizando, setSincronizando] = useState(false);
  const [progresso, setProgresso] = useState("");

  const carregar = useCallback(async () => {
    try {
      const r = await apiFetch<{ accounts: Conta[] }>("/api/ml/status");
      setContas(r.accounts);
      const c = await supabase.from("companies").select("*");
      setEmpresas((c.data ?? []) as Company[]);
    } catch (e) {
      setErro(mensagemErro(e));
      setContas([]);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Importa as vendas de uma conta, página por página, até terminar.
  async function sincronizarConta(c: Conta): Promise<{ vendas: number; anuncios: number }> {
    let offset = 0;
    let vendas = 0;
    let anuncios = 0;
    const nome = c.nickname ?? c.ml_user_id;
    for (;;) {
      const r = await apiFetch<SyncResp>("/api/ml/sync", {
        method: "POST",
        body: JSON.stringify({ days: Number(dias), offset, ml_user_id: c.ml_user_id }),
      });
      vendas += r.imported;
      anuncios += r.listings_created;
      offset = r.next_offset;
      setProgresso(`${nome}: ${Math.min(offset, r.total)} de ${r.total} pedidos…`);
      if (!r.has_more) break;
    }
    return { vendas, anuncios };
  }

  async function sincronizar(lista: Conta[]) {
    setErro("");
    setAviso("");
    setSincronizando(true);
    let vendas = 0;
    let anuncios = 0;
    try {
      for (const c of lista) {
        const r = await sincronizarConta(c);
        vendas += r.vendas;
        anuncios += r.anuncios;
      }
      setAviso(
        `Sincronização concluída: ${vendas} vendas novas e ${anuncios} anúncios novos. ` +
          (anuncios > 0 ? "Ligue os anúncios novos a um produto do armazém (Produtos > Anúncios Marketplace) para o lucro ficar correto." : "")
      );
      carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSincronizando(false);
      setProgresso("");
    }
  }

  if (!contas && !erro) return null;

  const lista = contas ?? [];

  return (
    <div className="space-y-5">
      {aviso && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</p>}
      {erro && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      {lista.length > 0 && (
        <div className="card flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Período das vendas</label>
            <select className="input" value={dias} onChange={(e) => setDias(e.target.value)} disabled={sincronizando}>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="60">Últimos 60 dias</option>
              <option value="90">Últimos 90 dias</option>
            </select>
          </div>
          <button className="btn" onClick={() => sincronizar(lista)} disabled={sincronizando}>
            {sincronizando ? "Sincronizando…" : lista.length > 1 ? "Sincronizar todas as contas" : "Sincronizar agora"}
          </button>
          {progresso && <span className="font-mono text-xs text-slate-500">{progresso}</span>}
          <p className="basis-full text-xs text-slate-500">
            Traz os pedidos pagos do período como vendas (preço, taxa e frete do Mercado Livre). O custo vem do produto do armazém ligado ao anúncio e o imposto, do regime do CNPJ da conta.
            Pode repetir sem duplicar. Sem produto ligado ao anúncio, o custo fica em R$ 0,00.
          </p>
        </div>
      )}

      {lista.map((c) => {
        const nivel = c.level_id ? NIVEIS[c.level_id] : undefined;
        const m = c.metrics;
        const empresa = empresas.find((e) => e.id === c.company_id);
        return (
          <div key={c.ml_user_id} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{c.nickname ?? `Conta ${c.ml_user_id}`}</h2>
                {nivel && <span className={`badge text-white ${nivel[1]}`}>Reputação {nivel[0]}</span>}
                {c.power_seller_status && LIDER[c.power_seller_status] && (
                  <span className="badge bg-blue-700 text-white">{LIDER[c.power_seller_status]}</span>
                )}
                {empresa && <span className="badge bg-slate-200 text-slate-700">{empresa.name}</span>}
              </div>
              <button className="btn-ghost" onClick={() => sincronizar([c])} disabled={sincronizando}>
                Sincronizar só esta
              </button>
            </div>
            {c.ml_error ? (
              <p className="text-sm text-red-700">
                O Mercado Livre recusou o acesso ({c.ml_error}). Reconecte a conta acima, em "Contas do Mercado Livre".
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Metric t="Reclamações" v={taxa(m?.claims)} s={m?.claims?.value} />
                <Metric t="Atrasos no envio" v={taxa(m?.delayed_handling_time)} s={m?.delayed_handling_time?.value} />
                <Metric t="Cancelamentos" v={taxa(m?.cancellations)} s={m?.cancellations?.value} />
                <Metric t="Vendas (período)" v={m?.sales?.completed != null ? String(m.sales.completed) : "—"} />
              </div>
            )}
            {c.last_synced_at && (
              <p className="text-xs text-slate-500">Última sincronização completa: {new Date(c.last_synced_at).toLocaleString("pt-BR")}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Metric({ t, v, s }: { t: string; v: string; s?: number }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="text-[13px] font-medium text-slate-500">{t}</div>
      <div className="text-xl font-semibold">{v}</div>
      {s != null && <div className="text-xs text-slate-500">{s} ocorrências</div>}
    </div>
  );
}
