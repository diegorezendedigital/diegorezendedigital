// Leitor de XML de NF-e (modelo 55). Sem dependências: roda no navegador e no Node.

export type ItemNFe = {
  numero: number;
  codigo: string; // cProd (código do fornecedor)
  ean: string | null;
  descricao: string;
  ncm: string | null;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorProduto: number;
  frete: number;
  seguro: number;
  desconto: number;
  outras: number;
  ipi: number;
  icmsSt: number;
  icms: number;
  pis: number;
  cofins: number;
};

export type NFe = {
  chave: string;
  numero: string;
  serie: string;
  emitidaEm: string | null;
  emitenteNome: string;
  emitenteCnpj: string;
  destinatarioCnpj: string;
  total: number;
  itens: ItemNFe[];
};

function tag(bloco: string, nome: string): string | null {
  const m = bloco.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`));
  return m ? m[1].trim() : null;
}

function valor(bloco: string, nome: string): number {
  const v = tag(bloco, nome);
  const x = v == null ? 0 : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function decodificar(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function lerNFe(xml: string): NFe {
  const texto = xml.replace(/^﻿/, "");
  const inf = texto.match(/<infNFe[^>]*>[\s\S]*<\/infNFe>/);
  if (!inf) throw new Error("Este arquivo não parece ser um XML de NF-e.");
  const corpo = inf[0];

  const chave = (corpo.match(/<infNFe[^>]*\sId="NFe(\d{44})"/) || [])[1] || "";
  if (!chave) throw new Error("Não encontrei a chave de acesso da nota.");

  const ide = tag(corpo, "ide") || "";
  const emit = tag(corpo, "emit") || "";
  const dest = tag(corpo, "dest") || "";
  const totais = tag(corpo, "ICMSTot") || "";

  const itens: ItemNFe[] = [];
  const re = /<det\s[^>]*nItem="(\d+)"[^>]*>([\s\S]*?)<\/det>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(corpo))) {
    const det = m[2];
    const prod = tag(det, "prod") || "";
    const imposto = tag(det, "imposto") || "";
    const ean = tag(prod, "cEAN");
    const eanTrib = tag(prod, "cEANTrib");
    const gtin = [ean, eanTrib].find((x) => x && /^\d{8,14}$/.test(x)) || null;
    itens.push({
      numero: Number(m[1]),
      codigo: decodificar(tag(prod, "cProd") || ""),
      ean: gtin,
      descricao: decodificar(tag(prod, "xProd") || ""),
      ncm: tag(prod, "NCM"),
      unidade: tag(prod, "uCom") || "UN",
      quantidade: valor(prod, "qCom"),
      valorUnitario: valor(prod, "vUnCom"),
      valorProduto: valor(prod, "vProd"),
      frete: valor(prod, "vFrete"),
      seguro: valor(prod, "vSeg"),
      desconto: valor(prod, "vDesc"),
      outras: valor(prod, "vOutro"),
      ipi: valor(imposto, "vIPI"),
      icmsSt: valor(imposto, "vICMSST"),
      icms: valor(tag(imposto, "ICMS") || "", "vICMS"),
      pis: valor(tag(imposto, "PIS") || "", "vPIS"),
      cofins: valor(tag(imposto, "COFINS") || "", "vCOFINS"),
    });
  }
  if (itens.length === 0) throw new Error("A nota não tem itens.");

  return {
    chave,
    numero: tag(ide, "nNF") || "",
    serie: tag(ide, "serie") || "",
    emitidaEm: tag(ide, "dhEmi") || tag(ide, "dEmi"),
    emitenteNome: decodificar(tag(emit, "xNome") || ""),
    emitenteCnpj: tag(emit, "CNPJ") || tag(emit, "CPF") || "",
    destinatarioCnpj: tag(dest, "CNPJ") || tag(dest, "CPF") || "",
    total: valor(totais, "vNF"),
    itens,
  };
}

// Custo de uma unidade comprada: produto + frete + seguro + outras despesas + IPI + ICMS-ST − desconto.
// Os créditos (ICMS/PIS/COFINS destacados) ficam separados: só valem para quem é Lucro Real.
export function custoUnitario(i: ItemNFe): { custo: number; icms: number; pis: number; cofins: number } {
  const q = i.quantidade > 0 ? i.quantidade : 1;
  const bruto = i.valorProduto + i.frete + i.seguro + i.outras + i.ipi + i.icmsSt - i.desconto;
  const arred = (v: number) => Math.round(v * 10000) / 10000;
  return { custo: arred(bruto / q), icms: arred(i.icms / q), pis: arred(i.pis / q), cofins: arred(i.cofins / q) };
}
