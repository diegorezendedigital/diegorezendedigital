// Cliente da Focus NFe (documentação: https://doc.focusnfe.com.br). Só roda no servidor.
// Autenticação: HTTP Basic, com o token no lugar do usuário e a senha em branco.

export type Ambiente = "homologacao" | "producao";

const RAIZ: Record<Ambiente, string> = {
  producao: "https://api.focusnfe.com.br",
  homologacao: "https://homologacao.focusnfe.com.br",
};

export class FocusErro extends Error {
  status: number;
  codigo?: string;
  constructor(mensagem: string, status: number, codigo?: string) {
    super(mensagem);
    this.name = "FocusErro";
    this.status = status;
    this.codigo = codigo;
  }
}

export type RespostaFocus = { status: number; ok: boolean; cabecalhos: Headers; texto: string; json: unknown };

export async function chamarFocus(
  token: string,
  amb: Ambiente,
  metodo: "GET" | "POST" | "DELETE",
  caminho: string,
  corpo?: unknown,
  limiteMs = 20_000
): Promise<RespostaFocus> {
  const basic = Buffer.from(`${token}:`).toString("base64");
  let res: Response;
  try {
    res = await fetch(`${RAIZ[amb]}/v2${caminho}`, {
      method: metodo,
      headers: { Authorization: `Basic ${basic}`, ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(limiteMs),
      cache: "no-store",
    });
  } catch (e) {
    const demorou = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new FocusErro(demorou ? "A Focus NFe demorou demais para responder." : "Não consegui falar com a Focus NFe agora.", 0);
  }
  const texto = await res.text();
  let json: unknown = null;
  if (texto && /^\s*[[{]/.test(texto)) {
    try {
      json = JSON.parse(texto);
    } catch {
      json = null;
    }
  }
  return { status: res.status, ok: res.ok, cabecalhos: res.headers, texto, json };
}

type CorpoErro = { mensagem?: unknown; codigo?: unknown; erros?: { mensagem?: unknown; campo?: unknown }[] };

export function codigoFocus(r: RespostaFocus): string | undefined {
  const j = r.json as CorpoErro | null;
  return j && typeof j.codigo === "string" ? j.codigo : undefined;
}

// Texto de erro da Focus em português simples (mensagem + campos com problema)
export function mensagemFocus(r: RespostaFocus): string {
  if (r.status === 401) return "A Focus NFe não aceitou o token. Confira se ele é do CNPJ certo e do ambiente certo (produção ou homologação).";
  const j = r.json as CorpoErro | null;
  const partes: string[] = [];
  if (j && typeof j.mensagem === "string" && j.mensagem) partes.push(j.mensagem);
  if (j && Array.isArray(j.erros)) {
    for (const e of j.erros.slice(0, 6)) {
      if (e && typeof e.mensagem === "string" && e.mensagem) partes.push(typeof e.campo === "string" && e.campo ? `${e.mensagem} (${e.campo})` : e.mensagem);
    }
  }
  if (partes.length) return partes.join(" · ");
  return `A Focus NFe respondeu com erro ${r.status}.`;
}

// ---------------------------------------------------------------------------------------------
// Notas recebidas (entrada): a Focus consulta a SEFAZ com o certificado do CNPJ e guarda as notas
// emitidas contra ele. Só vem o resumo até a manifestação (ciência) do destinatário.
// ---------------------------------------------------------------------------------------------

export type NotaRecebida = {
  chave: string;
  emitenteNome: string;
  emitenteDoc: string;
  destinatarioCnpj: string;
  total: number;
  emitidaEm: string | null;
  situacao: "autorizada" | "cancelada" | "denegada";
  manifestacao: string | null;
  completa: boolean;
  versao: number;
};

const txt = (x: unknown): string => (typeof x === "string" ? x : x == null ? "" : String(x));
const verdadeiro = (x: unknown): boolean => x === true || x === "true" || x === 1 || x === "1";

export function lerNotaRecebida(o: Record<string, unknown>): NotaRecebida | null {
  const chave = txt(o.chave_nfe).replace(/\D/g, "");
  if (chave.length !== 44) return null;
  const sit = txt(o.situacao).toLowerCase();
  const man = txt(o.manifestacao_destinatario).toLowerCase();
  const total = Number(txt(o.valor_total).replace(",", "."));
  const versao = Number(txt(o.versao));
  return {
    chave,
    emitenteNome: txt(o.nome_emitente),
    emitenteDoc: txt(o.documento_emitente).replace(/\D/g, ""),
    destinatarioCnpj: txt(o.cnpj_destinatario).replace(/\D/g, ""),
    total: Number.isFinite(total) ? total : 0,
    emitidaEm: txt(o.data_emissao) || null,
    situacao: sit.startsWith("cancel") ? "cancelada" : sit.startsWith("deneg") ? "denegada" : "autorizada",
    manifestacao: man && man !== "null" ? man : null,
    completa: verdadeiro(o.nfe_completa),
    versao: Number.isFinite(versao) ? versao : 0,
  };
}

// Lista até 100 notas com versão maior que a informada. X-Max-Version é a maior versão devolvida.
export async function listarRecebidas(
  token: string,
  amb: Ambiente,
  cnpj: string,
  versao: number
): Promise<{ notas: NotaRecebida[]; total: number; maxVersao: number | null }> {
  const r = await chamarFocus(token, amb, "GET", `/nfes_recebidas?cnpj=${encodeURIComponent(cnpj)}&versao=${Math.max(0, Math.floor(versao))}`);
  if (!r.ok) {
    let msg = mensagemFocus(r);
    if (r.status === 400 || r.status === 403) {
      msg += " Se o recebimento de notas ainda não foi ligado para este CNPJ, ative a Manifestação do Destinatário na empresa, dentro do painel da Focus NFe.";
    }
    throw new FocusErro(msg, r.status, codigoFocus(r));
  }
  if (!Array.isArray(r.json)) throw new FocusErro("A Focus NFe devolveu uma resposta inesperada ao listar as notas recebidas.", r.status);
  const notas = (r.json as unknown[])
    .map((x) => (x && typeof x === "object" ? lerNotaRecebida(x as Record<string, unknown>) : null))
    .filter((x): x is NotaRecebida => !!x);
  const total = Number(r.cabecalhos.get("x-total-count"));
  const maxV = Number(r.cabecalhos.get("x-max-version"));
  return { notas, total: Number.isFinite(total) && total > 0 ? total : notas.length, maxVersao: Number.isFinite(maxV) && maxV > 0 ? maxV : null };
}

// XML completo (nfeProc). Devolve null quando ainda não está disponível (sem manifestação, ou a SEFAZ ainda não entregou).
export async function baixarXmlRecebida(token: string, amb: Ambiente, chave: string): Promise<string | null> {
  const r = await chamarFocus(token, amb, "GET", `/nfes_recebidas/${chave}.xml`);
  if (r.status === 404) return null;
  if (!r.ok) throw new FocusErro(mensagemFocus(r), r.status, codigoFocus(r));
  return /<infNFe[\s>]/.test(r.texto) ? r.texto : null;
}

export type TipoManifestacao = "ciencia" | "confirmacao" | "desconhecimento" | "nao_realizada";

// Manifestação do destinatário. Resposta 200 também pode trazer rejeição da SEFAZ; por isso olha o status dentro do corpo.
export async function manifestar(
  token: string,
  amb: Ambiente,
  chave: string,
  tipo: TipoManifestacao,
  justificativa?: string
): Promise<{ ok: boolean; jaFeita: boolean; mensagem: string }> {
  const r = await chamarFocus(token, amb, "POST", `/nfes_recebidas/${chave}/manifesto`, { tipo, ...(justificativa ? { justificativa } : {}) });
  if (!r.ok) throw new FocusErro(mensagemFocus(r), r.status, codigoFocus(r));
  const j = (r.json ?? {}) as { status?: unknown; status_sefaz?: unknown; mensagem_sefaz?: unknown };
  const st = txt(j.status);
  const cs = txt(j.status_sefaz);
  const msg = txt(j.mensagem_sefaz);
  if (st === "evento_registrado" || cs === "135" || cs === "136") return { ok: true, jaFeita: false, mensagem: msg };
  if (cs === "573") return { ok: true, jaFeita: true, mensagem: msg }; // duplicidade: a manifestação já estava registrada
  return { ok: false, jaFeita: false, mensagem: msg || "A SEFAZ recusou a manifestação." };
}
