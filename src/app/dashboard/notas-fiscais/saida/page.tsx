"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/supabase/client";
import { formatarCnpj } from "@/lib/types";

type Empresa = { id: string; nome: string; cnpj: string | null; configurado: boolean; tokenHomologacao: string | null; tokenProducao: string | null };
type Config = { precisaSQL: boolean; podeEditar: boolean; empresas: Empresa[] };

export default function SaidaPage() {
  const [cfg, setCfg] = useState<Config | null>(null);

  useEffect(() => {
    apiFetch<Config>("/api/fiscal/config")
      .then(setCfg)
      .catch(() => setCfg(null));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Nota fiscal de saída</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Aqui vão ficar as notas das suas vendas: escolher o pedido, conferir os dados, emitir e baixar o XML e o DANFE, sem sair do sistema.
        </p>
      </div>

      <div className="card space-y-2 border border-amber-300 bg-amber-50">
        <p className="font-semibold text-amber-900">A emissão ainda não está ligada</p>
        <p className="text-sm text-amber-900">
          Esta tela é a próxima etapa. Hoje nenhuma nota é emitida por aqui, então continue emitindo normalmente pelo Upseller. Quando a emissão chegar, ela começa em homologação
          (ambiente de teste, sem valor fiscal) e você libera a produção só quando quiser.
        </p>
      </div>

      <div className="card space-y-3">
        <p className="font-semibold text-slate-900">O que já dá para deixar pronto</p>
        <p className="text-sm text-slate-600">A emissão usa a mesma conta da Focus NFe da Entrada. Cada CNPJ que vai emitir precisa de token salvo:</p>
        {!cfg ? (
          <p className="text-sm text-slate-500">Carregando…</p>
        ) : cfg.empresas.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhum CNPJ cadastrado ainda.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {cfg.empresas.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-medium">{e.nome}</p>
                  <p className="font-mono text-[11px] text-slate-500">{e.cnpj ? formatarCnpj(e.cnpj) : "CNPJ não cadastrado"}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className={`badge ${e.tokenHomologacao ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                    Homologação {e.tokenHomologacao ? "ok" : "sem token"}
                  </span>
                  <span className={`badge ${e.tokenProducao ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                    Produção {e.tokenProducao ? "ok" : "sem token"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {cfg?.podeEditar && (
          <Link href="/dashboard/notas-fiscais/configuracao" className="btn-ghost">
            Abrir a Configuração fiscal
          </Link>
        )}
      </div>

      <div className="card space-y-2">
        <p className="font-semibold text-slate-900">Como vai funcionar</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Você escolhe os pedidos que precisam de nota (Mercado Livre, Shopee e TikTok Shop).</li>
          <li>O sistema busca no marketplace os dados do comprador e monta a nota com os dados fiscais dos produtos.</li>
          <li>Você confere e ajusta a nota numa tela de revisão antes de enviar.</li>
          <li>A Focus NFe transmite para a SEFAZ; o XML e o DANFE ficam aqui, ligados ao pedido, e dá para cancelar dentro do prazo.</li>
        </ol>
      </div>
    </div>
  );
}
