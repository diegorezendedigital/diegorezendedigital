"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { Company, ContaML, mensagemErro } from "@/lib/types";
import PainelML from "@/components/PainelML";

const MARKETPLACES = [
  "Mercado Livre", "Shopee", "Amazon", "Shein", "TikTok Shop", "Shopify", "Nuvemshop", "WooCommerce",
  "Temu", "Walmart", "Falabella", "AliExpress", "Magalu", "Kwai", "Americanas", "Loja Física",
];

export default function IntegracoesPage() {
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [selecionado, setSelecionado] = useState("Mercado Livre");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [buscaLoja, setBuscaLoja] = useState("");
  const [versao, setVersao] = useState(0); // muda quando as contas mudam, para o painel de reputação recarregar
  const [contas, setContas] = useState<ContaML[]>([]);
  const [erroML, setErroML] = useState("");
  const [avisoML, setAvisoML] = useState("");

  const carregarContas = useCallback(async () => {
    try {
      const r = await apiFetch<{ accounts: ContaML[] }>("/api/ml/accounts");
      setContas(r.accounts);
    } catch (e) {
      setErroML(mensagemErro(e));
    }
  }, []);

  useEffect(() => {
    // Volta do Mercado Livre depois de autorizar (ou negar) o acesso.
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("conectado")) setAvisoML("Conta do Mercado Livre conectada!");
    const e = qs.get("erro");
    if (e === "negado") setErroML("Você não autorizou o acesso no Mercado Livre.");
    else if (e) {
      const d = qs.get("detalhe");
      setErroML("Não foi possível concluir a conexão." + (d ? ` Motivo: ${d}` : " Tente novamente."));
    }
    carregarContas();
  }, [carregarContas]);


  async function conectarML() {
    setErroML("");
    setAvisoML("");
    try {
      const { url } = await apiFetch<{ url: string }>("/api/ml/connect", { method: "POST" });
      window.location.href = url;
    } catch (e) {
      setErroML(mensagemErro(e));
    }
  }

  async function desconectarML(c: ContaML) {
    if (!confirm(`Desconectar ${c.nickname ?? c.ml_user_id}? Os anúncios e vendas já importados ficam guardados, mas o preço automático dessa conta é desligado.`)) return;
    setErroML("");
    try {
      await apiFetch("/api/ml/disconnect", { method: "POST", body: JSON.stringify({ ml_user_id: c.ml_user_id }) });
      setAvisoML("Conta desconectada.");
      carregarContas();
    } catch (e) {
      setErroML(mensagemErro(e));
    }
  }

  async function trocarCnpjConta(c: ContaML, companyId: string) {
    setErroML("");
    try {
      await apiFetch("/api/ml/account", { method: "POST", body: JSON.stringify({ ml_user_id: c.ml_user_id, company_id: companyId || null }) });
      setContas((l) => l.map((x) => (x.ml_user_id === c.ml_user_id ? { ...x, company_id: companyId || null } : x)));
    } catch (e) {
      setErroML(mensagemErro(e));
    }
  }

  const visiveis = contas.filter((c) => {
    if (filtroStatus !== "todos" && c.status !== filtroStatus) return false;
    const q = buscaLoja.trim().toLowerCase();
    return !q || (c.store_name ?? "").toLowerCase().includes(q) || (c.nickname ?? "").toLowerCase().includes(q);
  });

  async function renomearConta(c: ContaML, nome: string) {
    if (nome.trim() === (c.store_name ?? "")) return;
    setErroML("");
    try {
      await apiFetch("/api/ml/account", { method: "POST", body: JSON.stringify({ ml_user_id: c.ml_user_id, store_name: nome }) });
      setContas((l) => l.map((x) => (x.ml_user_id === c.ml_user_id ? { ...x, store_name: nome.trim() || null } : x)));
    } catch (e) {
      setErroML(mensagemErro(e));
    }
  }

  const expira = (c: ContaML) => {
    if (!c.expires_at) return "—";
    const d = new Date(c.expires_at);
    d.setMonth(d.getMonth() + 6);
    return d.toLocaleString("pt-BR");
  };

  const contagem = (nome: string) => (nome === "Mercado Livre" ? contas.length : 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Integrações</h1>
        <p className="mt-1 text-sm text-slate-600">Conecte as contas dos marketplaces onde você vende. Cada conta pode usar um CNPJ diferente.</p>
      </div>

      <div className="grid gap-5 md:grid-cols-[220px_1fr]">
        <nav className="card h-fit space-y-0.5 p-2">
          {MARKETPLACES.map((m) => (
            <button
              key={m}
              onClick={() => setSelecionado(m)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                selecionado === m ? "bg-brand-light font-medium text-brand" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span>{m}</span>
              <span className="font-mono text-xs text-slate-400">{contagem(m)}</span>
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-5">
          {selecionado !== "Mercado Livre" ? (
            <div className="card text-sm text-slate-600">A integração com {selecionado} ainda não está disponível. Por enquanto, só o Mercado Livre é sincronizado automaticamente.</div>
          ) : (
            <>
              <section className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select className="input w-44 py-1.5" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
                    <option value="todos">Todos os status</option>
                    <option value="ativo">Ativo</option>
                    <option value="reconectar">Precisa reconectar</option>
                  </select>
                  <input className="input w-64 py-1.5" placeholder="Nome da sua loja" value={buscaLoja} onChange={(e) => setBuscaLoja(e.target.value)} />
                  <button className="btn ml-auto" onClick={conectarML}>+ Conectar loja</button>
                </div>

                {avisoML && <p className="text-sm text-emerald-800">{avisoML}</p>}
                {erroML && <p className="text-sm text-red-700">{erroML}</p>}

                <div className="card overflow-x-auto p-0">
                  <table className="w-full min-w-[980px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left font-mono text-[11px] uppercase tracking-wider text-slate-500">
                        <th className="p-3">Nome da sua loja</th>
                        <th className="p-3">Site</th>
                        <th className="p-3">Conta / ID</th>
                        <th className="p-3">CNPJ</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Autenticação</th>
                        <th className="p-3">Expira (aprox.)</th>
                        <th className="p-3">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiveis.length === 0 && (
                        <tr>
                          <td className="p-4 text-slate-500" colSpan={8}>
                            {contas.length === 0 ? "Nenhuma loja conectada. Clique em “Conectar loja”." : "Nenhuma loja encontrada para esse filtro."}
                          </td>
                        </tr>
                      )}
                      {visiveis.map((c) => (
                        <tr key={c.ml_user_id} className="border-b border-slate-100 align-top">
                          <td className="p-3">
                            <input
                              key={`n${c.ml_user_id}${c.store_name ?? ""}`}
                              className="input w-48 py-1"
                              placeholder={c.nickname ?? "Dê um nome"}
                              defaultValue={c.store_name ?? ""}
                              onBlur={(e) => renomearConta(c, e.target.value)}
                            />
                          </td>
                          <td className="p-3">BR</td>
                          <td className="p-3">
                            <div>{c.nickname ?? "—"}</div>
                            <div className="font-mono text-xs text-slate-500">{c.ml_user_id}</div>
                          </td>
                          <td className="p-3">
                            <select className="input w-44 py-1" value={c.company_id ?? ""} onChange={(e) => trocarCnpjConta(c, e.target.value)}>
                              <option value="">CNPJ padrão</option>
                              {empresas.map((x) => (
                                <option key={x.id} value={x.id}>{x.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-3">
                            <span className={`inline-flex items-center gap-1.5 ${c.status === "ativo" ? "text-emerald-700" : "text-red-700"}`}>
                              <span className={`h-2 w-2 rounded-full ${c.status === "ativo" ? "bg-emerald-600" : "bg-red-600"}`} />
                              {c.status === "ativo" ? "Ativo" : "Precisa reconectar"}
                            </span>
                          </td>
                          <td className="p-3 font-mono text-xs">{new Date(c.connected_at).toLocaleString("pt-BR")}</td>
                          <td className="p-3 font-mono text-xs">{expira(c)}</td>
                          <td className="whitespace-nowrap p-3">
                            <button className="mr-4 text-brand hover:underline" onClick={conectarML}>Reconectar</button>
                            <button className="text-red-700 hover:underline" onClick={() => desconectarML(c)}>Desconectar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-xs text-slate-500">
                  Reconectar e Conectar loja abrem o Mercado Livre com a conta que estiver aberta neste navegador. Para conectar outra conta, entre antes nela (ou use uma janela anônima).
                  “Expira” é uma estimativa: o acesso se renova sozinho a cada uso, e só expira se ficar cerca de 6 meses sem ser usado.
                </p>
              </section>

              <PainelML key={versao} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
