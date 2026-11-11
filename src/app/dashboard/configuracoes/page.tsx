"use client";

import PainelML from "@/components/PainelML";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { Company, ContaML, campo, formatarCnpj, mensagemErro, num } from "@/lib/types";
import type { Regime } from "@/lib/pricing";

type Form = {
  id: string | null;
  name: string;
  cnpj: string;
  regime: Regime;
  simples: string;
  icms: string;
  pis: string;
  cofins: string;
  ir: string;
  padrao: boolean;
};

const vazio: Form = {
  id: null,
  name: "",
  cnpj: "",
  regime: "simples",
  simples: "",
  icms: "",
  pis: "1,65",
  cofins: "7,6",
  ir: "34",
  padrao: false,
};

function deEmpresa(c: Company): Form {
  return {
    id: c.id,
    name: c.name,
    cnpj: formatarCnpj(c.cnpj),
    regime: c.regime,
    simples: campo(Number(c.simples_aliquota)),
    icms: campo(Number(c.icms_pct)),
    pis: campo(Number(c.pis_pct)),
    cofins: campo(Number(c.cofins_pct)),
    ir: campo(Number(c.irpj_csll_pct)),
    padrao: c.is_default,
  };
}

export default function ConfiguracoesPage() {
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
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

  const carregar = useCallback(async () => {
    const r = await supabase.from("companies").select("*").order("created_at");
    if (r.error) setErro(r.error.message);
    setEmpresas((r.data ?? []) as Company[]);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setErro("");
    setSalvando(true);
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) throw new Error("Sessão expirada. Entre novamente.");

      const dados = {
        name: form.name.trim(),
        cnpj: form.cnpj.replace(/\D/g, "") || null,
        regime: form.regime,
        simples_aliquota: num(form.simples),
        icms_pct: num(form.icms),
        pis_pct: num(form.pis),
        cofins_pct: num(form.cofins),
        irpj_csll_pct: num(form.ir),
      };

      // Só um CNPJ pode ser o padrão: tira a marca dos outros antes.
      const primeira = empresas.length === 0;
      const padrao = form.padrao || primeira;
      if (padrao) await supabase.from("companies").update({ is_default: false }).eq("store_id", uid).neq("id", form.id ?? "00000000-0000-0000-0000-000000000000");

      const r = form.id
        ? await supabase.from("companies").update({ ...dados, is_default: padrao }).eq("id", form.id)
        : await supabase.from("companies").insert({ ...dados, store_id: uid, is_default: padrao });
      if (r.error) throw new Error(r.error.message);
      setForm(null);
      await carregar();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setSalvando(false);
    }
  }

  async function remover(c: Company) {
    if (!confirm(`Excluir o CNPJ "${c.name}"? Os anúncios ligados a ele ficam sem CNPJ.`)) return;
    const r = await supabase.from("companies").delete().eq("id", c.id);
    if (r.error) setErro(r.error.message);
    else carregar();
  }

  const set = (k: keyof Form, v: string | boolean) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="page-title">Configurações</h1>
        <p className="mt-1 text-sm text-slate-600">
          Conecte suas contas do Mercado Livre, cadastre cada CNPJ que vende nos marketplaces e escolha o regime. O lucro dos anúncios usa o CNPJ ligado a cada um.
        </p>
      </div>

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

      {erro && <p className="text-sm text-red-700">{erro}</p>}

      <PainelML />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-wider text-slate-500">CNPJs e regime tributário</h2>
          {!form && (
            <button className="btn" onClick={() => setForm({ ...vazio })}>
              Adicionar CNPJ
            </button>
          )}
        </div>

        {empresas.length === 0 && !form && (
          <div className="card text-sm text-slate-600">
            Nenhum CNPJ cadastrado. Sem CNPJ, o sistema calcula o lucro sem impostos.
          </div>
        )}

        {empresas.map((c) => (
          <div key={c.id} className="card flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                {c.name}
                {c.is_default && <span className="badge ml-2 bg-brand-light text-brand">Padrão</span>}
              </p>
              <p className="mt-0.5 font-mono text-xs text-slate-500">
                {formatarCnpj(c.cnpj) || "sem CNPJ informado"} ·{" "}
                {c.regime === "simples"
                  ? `Simples Nacional, alíquota ${campo(Number(c.simples_aliquota))}%`
                  : `Lucro Real, ICMS ${campo(Number(c.icms_pct))}% · PIS ${campo(Number(c.pis_pct))}% · COFINS ${campo(Number(c.cofins_pct))}% · IRPJ/CSLL ${campo(Number(c.irpj_csll_pct))}%`}
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => setForm(deEmpresa(c))}>Editar</button>
              <button className="btn-ghost" onClick={() => remover(c)}>Excluir</button>
            </div>
          </div>
        ))}

        {form && (
          <form onSubmit={salvar} className="card space-y-4">
            <h3 className="font-medium">{form.id ? "Editar CNPJ" : "Novo CNPJ"}</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="label">Nome da empresa</label>
                <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} required />
              </div>
              <div>
                <label className="label">CNPJ</label>
                <input className="input" inputMode="numeric" value={form.cnpj} onChange={(e) => set("cnpj", e.target.value)} placeholder="00.000.000/0000-00" />
              </div>
            </div>

            <div>
              <span className="label">Regime tributário</span>
              <div className="flex gap-2">
                {(["simples", "lucro_real"] as Regime[]).map((r) => (
                  <button
                    type="button"
                    key={r}
                    onClick={() => set("regime", r)}
                    className={`rounded-md border px-4 py-2 text-sm ${
                      form.regime === r ? "border-brand bg-brand text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {r === "simples" ? "Simples Nacional" : "Lucro Real"}
                  </button>
                ))}
              </div>
            </div>

            {form.regime === "simples" ? (
              <div className="max-w-xs">
                <label className="label">Alíquota efetiva sobre a venda (%)</label>
                <input className="input" inputMode="decimal" value={form.simples} onChange={(e) => set("simples", e.target.value)} placeholder="Ex.: 6" required />
                <p className="mt-1 text-xs text-slate-500">Use a alíquota efetiva da sua faixa (consta no extrato do PGDAS).</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <label className="label">ICMS na venda (%)</label>
                  <input className="input" inputMode="decimal" value={form.icms} onChange={(e) => set("icms", e.target.value)} placeholder="Ex.: 18" required />
                </div>
                <div>
                  <label className="label">PIS (%)</label>
                  <input className="input" inputMode="decimal" value={form.pis} onChange={(e) => set("pis", e.target.value)} required />
                </div>
                <div>
                  <label className="label">COFINS (%)</label>
                  <input className="input" inputMode="decimal" value={form.cofins} onChange={(e) => set("cofins", e.target.value)} required />
                </div>
                <div>
                  <label className="label">IRPJ + CSLL (% do lucro)</label>
                  <input className="input" inputMode="decimal" value={form.ir} onChange={(e) => set("ir", e.target.value)} required />
                </div>
                <p className="text-xs text-slate-500 md:col-span-4">
                  No Lucro Real, ICMS, PIS e COFINS pagos nas compras viram crédito (vêm do XML da nota) e abatem o imposto da venda. IRPJ/CSLL incide sobre o lucro.
                </p>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.padrao} onChange={(e) => set("padrao", e.target.checked)} />
              Usar como CNPJ padrão dos anúncios sem CNPJ definido
            </label>

            <div className="flex gap-2">
              <button className="btn" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
