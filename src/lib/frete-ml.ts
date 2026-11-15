// Peso e medidas do produto para o frete do Mercado Livre.
// Peso cúbico (kg) = comprimento x largura x altura (cm) / 6000. A regra de frete por faixa de
// valor e peso entra aqui quando for definida; o peso faturável é o maior entre o real e o cúbico.
export const DIVISOR_CUBICO = 6000;

export type Medidas = { pesoKg: number; comprimentoCm: number; larguraCm: number; alturaCm: number };

export function pesoCubicoKg(m: Pick<Medidas, "comprimentoCm" | "larguraCm" | "alturaCm">): number {
  const v = m.comprimentoCm * m.larguraCm * m.alturaCm;
  return v > 0 ? v / DIVISOR_CUBICO : 0;
}

export function pesoFaturavelKg(m: Medidas): number {
  return Math.max(m.pesoKg, pesoCubicoKg(m));
}

export function medidasDoProduto(p: {
  peso_kg?: number | null;
  comprimento_cm?: number | null;
  largura_cm?: number | null;
  altura_cm?: number | null;
}): Medidas {
  return {
    pesoKg: Number(p.peso_kg ?? 0),
    comprimentoCm: Number(p.comprimento_cm ?? 0),
    larguraCm: Number(p.largura_cm ?? 0),
    alturaCm: Number(p.altura_cm ?? 0),
  };
}
