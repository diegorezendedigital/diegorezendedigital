// Modelo e leitura da planilha de produtos (Excel). Só roda no navegador.

export type LinhaProduto = {
  linha: number; // número da linha na planilha (para mensagens de erro)
  sku: string;
  nome: string;
  custo: number | null; // null = sem custo na planilha (não mexe no custo que já existe)
  ean: string | null;
  ncm: string | null;
  estoque: number | null; // null = não informado (mantém o que já existe)
  cnpj: string | null;
};

const COLUNAS = ["SKU", "Nome", "Custo", "EAN", "NCM", "Estoque", "CNPJ de compra"];

export async function baixarModelo(): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const produtos = XLSX.utils.aoa_to_sheet([
    COLUNAS,
    ["CAM-001", "Camiseta básica preta", 39.9, "7891234567895", "61091000", 50, ""],
    ["CAM-002", "Camiseta básica branca", 39.9, "", "61091000", 30, ""],
  ]);
  produtos["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, produtos, "Produtos");

  const ajuda = XLSX.utils.aoa_to_sheet([
    ["Como preencher"],
    ["SKU", "Obrigatório. Código único do produto no seu armazém. Se o SKU já existe, o produto é atualizado."],
    ["Nome", "Obrigatório."],
    ["Custo", "Opcional. Custo de uma unidade, em reais (ex.: 39,90). Em branco: produto novo entra sem custo e produto existente mantém o custo atual, atualizando só nome e demais campos. Com custo: substitui o custo do SKU."],
    ["EAN", "Opcional. Código de barras, usado para casar com os itens do XML da nota."],
    ["NCM", "Opcional."],
    ["Estoque", "Opcional. Se ficar vazio, o estoque atual não muda."],
    ["CNPJ de compra", "Opcional. CNPJ (cadastrado em Configurações) que compra este produto."],
    [],
    ["Apague as duas linhas de exemplo antes de importar."],
  ]);
  ajuda["!cols"] = [{ wch: 18 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, ajuda, "Instruções");

  XLSX.writeFile(wb, "modelo-produtos-margemcerta.xlsx");
}

const chave = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

// "1.234,56" (pt-BR) e "39.9" (planilha em formato internacional) viram número.
function paraNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v ?? "")
    .replace(/R\$/gi, "")
    .trim();
  if (!t) return null;
  const x = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(x) ? x : null;
}

const texto = (v: unknown): string | null => {
  const t = String(v ?? "").trim();
  return t ? t : null;
};

export async function lerPlanilha(arquivo: File): Promise<{ linhas: LinhaProduto[]; erros: string[] }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: "array" });
  const aba = wb.Sheets[wb.SheetNames[0]];
  if (!aba) return { linhas: [], erros: ["A planilha está vazia."] };

  const brutas = XLSX.utils.sheet_to_json<Record<string, unknown>>(aba, { defval: "" });
  const linhas: LinhaProduto[] = [];
  const erros: string[] = [];
  const vistos = new Set<string>();

  brutas.forEach((bruta, i) => {
    const r: Record<string, unknown> = {};
    Object.keys(bruta).forEach((k) => (r[chave(k)] = bruta[k]));
    const linha = i + 2; // linha 1 é o cabeçalho

    const sku = texto(r["sku"]);
    const nome = texto(r["nome"] ?? r["produto"]);
    const custo = paraNumero(r["custo"]);
    if (!sku && !nome && custo == null) return; // linha em branco

    if (!sku) return void erros.push(`Linha ${linha}: falta o SKU.`);
    if (!nome) return void erros.push(`Linha ${linha}: falta o nome.`);
    const custoTexto = texto(r["custo"]);
    if (custoTexto != null && (custo == null || custo < 0)) return void erros.push(`Linha ${linha}: custo inválido (${custoTexto}).`);
    if (vistos.has(sku)) return void erros.push(`Linha ${linha}: o SKU ${sku} aparece mais de uma vez.`);
    vistos.add(sku);

    linhas.push({
      linha,
      sku,
      nome,
      custo: custoTexto == null ? null : custo,
      ean: texto(r["ean"] ?? r["gtin"]),
      ncm: texto(r["ncm"]),
      estoque: paraNumero(r["estoque"]),
      cnpj: texto(r["cnpjdecompra"] ?? r["cnpj"]),
    });
  });

  return { linhas, erros };
}
