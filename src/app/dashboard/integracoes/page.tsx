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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-mono text-xs uppercase tracking-wider text-slate-500">Contas do Mercado Livre</h2>
                  <button className="btn" onClick={conectarML}>
                    {contas.length === 0 ? "Conectar conta do Mercado Livre" : "Conectar outra conta"}
                  </button>
                </div>

                {avisoML && <p className="text-sm text-emerald-800">{avisoML}</p>}
                {erroML && <p className="text-sm text-red-700">{erroML}</p>}

                {contas.length === 0 && !erroML && (
                  <div className="card text-sm text-slate-600">
                    Nenhuma conta conectada. Conecte para importar anúncios e vendas e para o preço automático funcionar.
                  </div>
                )}

                {contas.map((c) => (
                  <div key={c.ml_user_id} className="card flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{c.nickname ?? `Conta ${c.ml_user_id}`}</p>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">
                        ID {c.ml_user_id} · conectada em {new Date(c.connected_at).toLocaleDateString("pt-BR")}
                        {c.last_synced_at ? ` · vendas sincronizadas em ${new Date(c.last_synced_at).toLocaleString("pt-BR")}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="label">CNPJ desta conta</label>
                        <select className="input w-52 py-1.5" value={c.company_id ?? ""} onChange={(e) => trocarCnpjConta(c, e.target.value)}>
                          <option value="">Usar o CNPJ padrão</option>
                          {empresas.map((x) => (
                            <option key={x.id} value={x.id}>{x.name}</option>
                          ))}
                        </select>
                      </div>
                      <button className="btn-ghost" title="Autoriza de novo esta conta (use depois de mudar as permissões do app ou se o acesso expirar)" onClick={conectarML}>
                        Reconectar
                      </button>
                      <button className="btn-ghost text-red-700" onClick={() => desconectarML(c)}>Desconectar</button>
                    </div>
                  </div>
                ))}

                <p className="text-xs text-slate-500">
                  Reconectar autoriza de novo a conta que estiver aberta no Mercado Livre neste navegador (ela mantém o CNPJ escolhido). Para conectar outra conta, entre antes no Mercado Livre com ela (ou use uma janela anônima); senão o Mercado Livre reaproveita a conta que já estiver aberta.
                  Os anúncios novos dessa conta já entram ligados ao CNPJ escolhido aqui.
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
