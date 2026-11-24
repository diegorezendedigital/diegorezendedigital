"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/supabase/client";
import { formatarCnpj, mensagemErro } from "@/lib/types";

type Empresa = {
  id: string;
  nome: string;
  cnpj: string | null;
  regime: string;
  configurado: boolean;
  tokenProducao: string | null;
  tokenHomologacao: string | null;
  entradaAtiva: boolean;
  cienciaAutomatica: boolean;
  ultimaBusca: string | null;
  erro: string | null;
};
type Config = { precisaSQL: boolean; podeEditar: boolean; empresas: Empresa[] };
type Teste = { ambiente: "producao" | "homologacao"; ok: boolean; mensagem: string };

const REGIMES: Record<string, string> = { simples: "Simples Nacional", presumido: "Lucro Presumido", real: "Lucro Real" };

const dataHoraBr = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca";

function CartaoEmpresa({ emp, podeEditar, onMudou }: { emp: Empresa; podeEditar: boolean; onMudou: () => Promise<void> }) {
  const [tokenProd, setTokenProd] = useState("");
  const [tokenHom, setTokenHom] = useState("");
  const [removerProd, setRemoverProd] = useState(false);
  const [removerHom, setRemoverHom] = useState(false);
  const [entradaAtiva, setEntradaAtiva] = useState(emp.entradaAtiva);
  const [ciencia, setCiencia] = useState(emp.cienciaAutomatica);
  const [ocupado, setOcupado] = useState<"salvar" | "testar" | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [testes, setTestes] = useState<Teste[]>([]);

  const mexeu =
    !!tokenProd.trim() || !!tokenHom.trim() || removerProd || removerHom || entradaAtiva !== emp.entradaAtiva || ciencia !== emp.cienciaAutomatica;

  async function salvar(): Promise<boolean> {
    setErro("");
    setAviso("");
    setOcupado("salvar");
    try {
      await apiFetch("/api/fiscal/config", {
        method: "POST",
        body: JSON.stringify({
          acao: "salvar",
          companyId: emp.id,
          tokenProducao: tokenProd.trim() || undefined,
          tokenHomologacao: tokenHom.trim() || undefined,
          removerProducao: removerProd || undefined,
          removerHomologacao: removerHom || undefined,
          entradaAtiva,
          cienciaAutomatica: ciencia,
        }),
      });
      setTokenProd("");
      setTokenHom("");
      setRemoverProd(false);
      setRemoverHom(false);
      setAviso("Salvo.");
      await onMudou();
      return true;
    } catch (e) {
      setErro(mensagemErro(e));
      return false;
    } finally {
      setOcupado(null);
    }
  }

  async function testar() {
    setErro("");
    setAviso("");
    setTestes([]);
    if (mexeu && !(await salvar())) return; // testa o que está na tela: salva antes
    setOcupado("testar");
    try {
      const r = await apiFetch<{ ok: boolean; resultados: Teste[] }>("/api/fiscal/config", {
        method: "POST",
        body: JSON.stringify({ acao: "testar", companyId: emp.id }),
      });
      setTestes(r.resultados);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(null);
    }
  }

  const cnpjOk = (emp.cnpj ?? "").replace(/\D/g, "").length === 14;

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-semibold text-slate-900">{emp.nome}</p>
          <p className="font-mono text-xs text-slate-500">
            {emp.cnpj ? formatarCnpj(emp.cnpj) : "CNPJ não cadastrado"} · {REGIMES[emp.regime] ?? emp.regime}
          </p>
        </div>
        <span className={`badge ${emp.configurado ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{emp.configurado ? "Token salvo" : "Sem token"}</span>
      </div>

      {!cnpjOk && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Este CNPJ não tem 14 números cadastrados. Corrija em <Link href="/dashboard/configuracoes" className="underline">Configurações</Link> antes de buscar notas.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">Token de produção da Focus NFe</label>
          <input
            className="input font-mono"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            disabled={!podeEditar || removerProd}
            placeholder={emp.tokenProducao ? `Salvo: ${emp.tokenProducao} (cole outro para trocar)` : "Cole o token de produção"}
            value={tokenProd}
            onChange={(e) => setTokenProd(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">É com ele que as notas reais chegam. Fica guardado só no servidor.</p>
          {podeEditar && emp.tokenProducao && (
            <label className="mt-1 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={removerProd} onChange={(e) => setRemoverProd(e.target.checked)} />
              Remover o token de produção salvo
            </label>
          )}
        </div>
        <div>
          <label className="label">Token de homologação (opcional)</label>
          <input
            className="input font-mono"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            disabled={!podeEditar || removerHom}
            placeholder={emp.tokenHomologacao ? `Salvo: ${emp.tokenHomologacao} (cole outro para trocar)` : "Cole o token de homologação"}
            value={tokenHom}
            onChange={(e) => setTokenHom(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">Ambiente de testes da Focus, sem valor fiscal. Vai servir para treinar a emissão de notas de saída.</p>
          {podeEditar && emp.tokenHomologacao && (
            <label className="mt-1 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={removerHom} onChange={(e) => setRemoverHom(e.target.checked)} />
              Remover o token de homologação salvo
            </label>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" disabled={!podeEditar} checked={entradaAtiva} onChange={(e) => setEntradaAtiva(e.target.checked)} />
          <span>
            Buscar sozinho as notas que os fornecedores emitem para este CNPJ
            <span className="block text-xs text-slate-500">A busca roda quando você abre a tela de Entrada (no máximo a cada 20 minutos) ou ao clicar em &quot;Buscar notas agora&quot;.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" disabled={!podeEditar} checked={ciencia} onChange={(e) => setCiencia(e.target.checked)} />
          <span>
            Dar ciência da operação automaticamente
            <span className="block text-xs text-slate-500">
              Sem a ciência, a SEFAZ entrega só o resumo da nota. Com ela, o XML completo (itens, custos e impostos) chega alguns minutos depois. A ciência não confirma nem recusa a compra.
            </span>
          </span>
        </label>
      </div>

      {podeEditar && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={salvar} disabled={ocupado !== null || !mexeu}>
            {ocupado === "salvar" ? "Salvando…" : "Salvar"}
          </button>
          <button className="btn-ghost" onClick={testar} disabled={ocupado !== null || (!emp.configurado && !tokenProd.trim() && !tokenHom.trim())}>
            {ocupado === "testar" ? "Testando…" : "Testar conexão"}
          </button>
        </div>
      )}

      {erro && <p className="text-sm text-red-700">{erro}</p>}
      {aviso && <p className="text-sm text-emerald-800">{aviso}</p>}
      {testes.length > 0 && (
        <ul className="space-y-1 text-sm">
          {testes.map((t) => (
            <li key={t.ambiente} className={t.ok ? "text-emerald-800" : "text-red-700"}>
              <span className="font-semibold">{t.ambiente === "producao" ? "Produção" : "Homologação"}:</span> {t.mensagem}
            </li>
          ))}
        </ul>
      )}

      {emp.configurado && (
        <p className="text-xs text-slate-500">
          Última busca de notas: {dataHoraBr(emp.ultimaBusca)}.
          {emp.erro && <span className="text-red-700"> Último erro: {emp.erro}</span>}
        </p>
      )}
    </div>
  );
}

export default function ConfiguracaoFiscalPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    try {
      setCfg(await apiFetch<Config>("/api/fiscal/config"));
      setErro("");
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Configuração fiscal</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          As notas fiscais passam pela Focus NFe, um serviço que fala com a SEFAZ usando o certificado digital do seu CNPJ. Aqui você liga cada CNPJ à conta da Focus.
          O sistema guarda apenas o token da Focus; o certificado fica com a Focus.
        </p>
      </div>

      {erro && <p className="text-sm text-red-700">{erro}</p>}

      {cfg?.precisaSQL && (
        <div className="card border border-amber-300 bg-amber-50 text-sm text-amber-900">
          Falta rodar o SQL das notas fiscais no Supabase (arquivo <span className="font-mono">20261213_notas_fiscais.sql</span>). Depois de rodar, recarregue esta página.
        </div>
      )}

      <div className="card space-y-3">
        <p className="font-semibold text-slate-900">Como conectar</p>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li>
            Crie a conta na Focus NFe (<span className="font-mono">focusnfe.com.br</span>). É um serviço contratado à parte, com cobrança por pacote de notas, e as notas recebidas contam no pacote junto com as emitidas.
          </li>
          <li>Na Focus, cadastre a empresa com o mesmo CNPJ daqui e envie o certificado digital A1 (arquivo .pfx e a senha dele).</li>
          <li>Ainda na empresa, ligue a opção de manifestação do destinatário: é ela que permite buscar as notas emitidas contra o seu CNPJ.</li>
          <li>Copie o token de produção da empresa no painel da Focus e cole no campo abaixo.</li>
          <li>Clique em &quot;Testar conexão&quot;. Se estiver tudo certo, a tela de Entrada já começa a trazer as notas.</li>
        </ol>
      </div>

      {!cfg && !erro && <p className="text-sm text-slate-500">Carregando…</p>}
      {cfg && cfg.empresas.length === 0 && (
        <p className="text-sm text-slate-600">
          Nenhum CNPJ cadastrado ainda. Cadastre em <Link href="/dashboard/configuracoes" className="underline">Configurações</Link>.
        </p>
      )}
      {cfg && !cfg.podeEditar && <p className="text-sm text-slate-600">Só o usuário master (ou quem tem a permissão de Integrações) pode alterar estes dados.</p>}
      {cfg?.empresas.map((e) => (
        <CartaoEmpresa key={e.id} emp={e} podeEditar={cfg.podeEditar} onMudou={carregar} />
      ))}
    </div>
  );
}
