"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, supabase } from "@/lib/supabase/client";
import { Company, campo, formatarCnpj, mensagemErro, num } from "@/lib/types";
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
  const [senhaDefinida, setSenhaDefinida] = useState<boolean | null>(null);
  const [senhaAtual, setSenhaAtual] = useState("");
  const [senhaNova, setSenhaNova] = useState("");
  const [msgSenha, setMsgSenha] = useState("");

  useEffect(() => {
    apiFetch<{ definida: boolean }>("/api/senha-master")
      .then((r) => setSenhaDefinida(r.definida))
      .catch(() => setSenhaDefinida(null));
  }, []);

  async function salvarSenha() {
    setMsgSenha("");
    try {
      await apiFetch("/api/senha-master", { method: "POST", body: JSON.stringify({ nova: senhaNova, atual: senhaAtual }) });
      setSenhaDefinida(true);
      setSenhaAtual("");
      setSenhaNova("");
      setMsgSenha("Senha master salva.");
    } catch (e) {
      setMsgSenha(mensagemErro(e));
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
          Cadastre cada CNPJ que vende nos marketplaces e escolha o regime. O lucro dos anúncios usa o CNPJ ligado a cada um.
        </p>
      </div>

      <p className="text-sm text-slate-600">
        As contas do Mercado Livre (conectar, reconectar, desconectar) ficam em <Link href="/dashboard/integracoes" className="underline">Integrações</Link>.
      </p>

      <section className="space-y-3">
        <h2 className="font-mono text-xs uppercase tracking-wider text-slate-500">Senha master</h2>
        <div className="card flex flex-wrap items-end gap-3">
          <p className="basis-full text-sm text-slate-600">
            Pede esta senha para informar à mão o custo de uma venda que ficou sem custo. Ela é guardada criptografada e nunca aparece na tela.
          </p>
          {senhaDefinida && (
            <div>
              <label className="label">Senha atual</label>
              <input type="password" className="input w-48" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} autoComplete="off" />
            </div>
          )}
          <div>
            <label className="label">{senhaDefinida ? "Nova senha" : "Criar senha (mín. 6 caracteres)"}</label>
            <input type="password" className="input w-48" value={senhaNova} onChange={(e) => setSenhaNova(e.target.value)} autoComplete="new-password" />
          </div>
          <button className="btn" onClick={salvarSenha}>{senhaDefinida ? "Trocar senha" : "Salvar senha"}</button>
          {msgSenha && <span className="text-sm text-slate-700">{msgSenha}</span>}
        </div>
      </section>

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
