// Comparação de SKU entre o marketplace e o armazém.
// O mesmo produto aparece escrito de jeitos diferentes: "CAM-POLI-Verde-Água-M" no armazém e
// "CAM-POLI-Verde-Agua-M" na Shopee, "Chumbo Azulado" com espaço ou com hífen, maiúsculas e minúsculas...
// Por isso o SKU nunca é comparado "cru": sempre passa por estas chaves.

// Chave forte: sem acento, sem maiúsculas, espaço e "_" viram hífen, hífens repetidos viram um só.
export function chaveSku(x: string | null | undefined): string {
  return String(x ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Água = Agua
    .replace(/[​-‍⁠﻿]/g, "") // caracteres invisíveis que vêm de planilhas
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Chave fraca: só letras e números ("CAM-POLI-ChumboAzulado-M" = "CAM-POLI-Chumbo-Azulado-M").
// Só vale quando aponta para um único produto.
export function chaveSkuFraca(x: string | null | undefined): string {
  return chaveSku(x).replace(/[^a-z0-9]/g, "");
}

function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 4) return 99;
  let ant = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) atual[j] = Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    ant = atual;
  }
  return ant[b.length];
}

// Índice de SKUs do armazém: acha o produto de um SKU escrito de qualquer jeito.
// peso: se dois produtos têm o mesmo SKU, fica o de maior peso (use 1 para o que tem custo).
export class IndiceSku<T> {
  private forte = new Map<string, { valor: T; peso: number }>();
  private fraco = new Map<string, Set<T>>();
  private todos: { sku: string; fraca: string }[] = [];

  add(sku: string | null | undefined, valor: T, peso = 0): void {
    const k = chaveSku(sku);
    if (!k) return;
    const atual = this.forte.get(k);
    if (!atual || peso > atual.peso) this.forte.set(k, { valor, peso });
    const w = chaveSkuFraca(sku);
    if (w) {
      const s = this.fraco.get(w) ?? new Set<T>();
      s.add(valor);
      this.fraco.set(w, s);
    }
    this.todos.push({ sku: String(sku), fraca: w });
  }

  get(sku: string | null | undefined): T | undefined {
    const k = chaveSku(sku);
    if (!k) return undefined;
    const f = this.forte.get(k);
    if (f) return f.valor;
    const s = this.fraco.get(chaveSkuFraca(sku));
    return s && s.size === 1 ? Array.from(s)[0] : undefined;
  }

  // SKUs do armazém mais parecidos com o informado (para sugerir o acerto quando não bate)
  parecidos(sku: string | null | undefined, max = 2): string[] {
    const w = chaveSkuFraca(sku);
    if (!w) return [];
    const limite = Math.max(2, Math.round(w.length * 0.15));
    return this.todos
      .map((t) => ({ sku: t.sku, d: distancia(w, t.fraca) }))
      .filter((t) => t.d <= limite)
      .sort((a, b) => a.d - b.d)
      .filter((t, i, l) => l.findIndex((x) => x.sku === t.sku) === i)
      .slice(0, max)
      .map((t) => t.sku);
  }

  get tamanho(): number {
    return this.forte.size;
  }
}
