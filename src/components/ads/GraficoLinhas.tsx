import React from "react";

// Gráfico de linhas (SVG em pixels reais). Várias séries no mesmo eixo, curvas suaves,
// estilos sólido / tracejado / pontilhado, área em degradê e um dia em foco.

export type SerieLinha = {
  id: string;
  nome: string;
  cor: string;
  valores: (number | null)[]; // null = sem valor naquele ponto (a linha é interrompida)
  estilo?: "solida" | "tracejada" | "pontilhada";
  area?: boolean;
  espessura?: number;
  pontoFinal?: boolean; // marca o último ponto com valor
};

export const MARGEM_L = { esq: 64, dir: 20, topo: 22, baixo: 30 };

export function escalaLinhas(max: number, divisoes = 4) {
  if (!(max > 0)) return { topo: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const bruto = max / divisoes;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map((k) => k * pot).find((x) => x >= bruto * 0.999) ?? 10 * pot;
  const n = Math.ceil(max / passo - 1e-9);
  return { topo: passo * n, ticks: Array.from({ length: n + 1 }, (_, i) => i * passo) };
}

// Curva monotônica (não "passa do ponto" entre dois valores) — Fritsch–Carlson
function curva(p: [number, number][]) {
  const n = p.length;
  if (n === 0) return "";
  if (n === 1) return `M${p[0][0]},${p[0][1]}`;
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(p[i + 1][0] - p[i][0]);
    m.push((p[i + 1][1] - p[i][1]) / (dx[i] || 1));
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
  t.push(m[n - 2]);
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(p[i][0] + h).toFixed(1)},${(p[i][1] + h * t[i]).toFixed(1)} ${(p[i + 1][0] - h).toFixed(1)},${(p[i + 1][1] - h * t[i + 1]).toFixed(1)} ${p[i + 1][0].toFixed(1)},${p[i + 1][1].toFixed(1)}`;
  }
  return d;
}

// Quebra a série nos trechos contínuos (sem null)
function trechos(vals: (number | null)[]) {
  const r: { i0: number; v: number[] }[] = [];
  let atual: { i0: number; v: number[] } | null = null;
  vals.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { atual = null; return; }
    if (!atual) { atual = { i0: i, v: [] }; r.push(atual); }
    atual.v.push(v);
  });
  return r;
}

export function GraficoLinhasSvg({
  rotulosX,
  series,
  largura,
  altura,
  sobre,
  rotuloEixo,
  marcaX,
}: {
  rotulosX: string[]; // um rótulo por ponto (ex.: "05/11")
  series: SerieLinha[];
  largura: number;
  altura: number;
  sobre: number | null;
  rotuloEixo: (v: number) => string;
  marcaX?: { indice: number; texto: string } | null; // linha vertical (ex.: "hoje")
}) {
  const n = rotulosX.length;
  const W = Math.max(240, largura);
  const H = altura;
  const pw = W - MARGEM_L.esq - MARGEM_L.dir;
  const ph = H - MARGEM_L.topo - MARGEM_L.baixo;
  const max = Math.max(0, ...series.flatMap((s) => s.valores.filter((v): v is number => v != null && Number.isFinite(v))));
  const { topo, ticks } = escalaLinhas(max * 1.08);
  const x = (i: number) => MARGEM_L.esq + (n <= 1 ? pw / 2 : (pw * i) / (n - 1));
  const y = (v: number) => MARGEM_L.topo + ph - (v / topo) * ph;

  const alvo = Math.max(2, Math.min(9, Math.floor(pw / 72)));
  const cada = Math.max(1, Math.ceil(n / alvo));
  const base = (i: number) => i === 0 || i === n - 1 || (i % cada === 0 && n - 1 - i >= cada * 0.6);
  const passoPx = n > 1 ? pw / (n - 1) : pw;
  const mostra = (i: number) => base(i) && !(sobre != null && i !== sobre && Math.abs(i - sobre) * passoPx < 46);

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", fontFamily: "inherit", overflow: "visible" }} role="img">
      <defs>
        {series.filter((s) => s.area).map((s) => (
          <linearGradient key={s.id} id={`area-${s.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.cor} stopOpacity={0.28} />
            <stop offset="100%" stopColor={s.cor} stopOpacity={0.02} />
          </linearGradient>
        ))}
      </defs>

      {/* Grade */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={MARGEM_L.esq} x2={W - MARGEM_L.dir} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#cbd5e1" : "#eef1f6"} strokeWidth={1} />
          <text x={MARGEM_L.esq - 10} y={y(t)} dy="0.35em" textAnchor="end" fontSize={11} fill="#94a3b8" style={{ fontVariantNumeric: "tabular-nums" }}>
            {rotuloEixo(t)}
          </text>
        </g>
      ))}

      {/* Marca vertical (hoje) */}
      {marcaX && marcaX.indice >= 0 && marcaX.indice < n && (
        <g>
          <line x1={x(marcaX.indice)} x2={x(marcaX.indice)} y1={MARGEM_L.topo - 6} y2={MARGEM_L.topo + ph} stroke="#c7d2fe" strokeWidth={1} strokeDasharray="3 3" />
          <rect x={x(marcaX.indice) - 22} y={MARGEM_L.topo - 20} width={44} height={16} rx={8} fill="#eef2ff" />
          <text x={x(marcaX.indice)} y={MARGEM_L.topo - 12} dy="0.35em" textAnchor="middle" fontSize={10} fontWeight={700} fill="#4f46e5">
            {marcaX.texto}
          </text>
        </g>
      )}

      {/* Linha guia do dia em foco */}
      {sobre != null && sobre < n && <line x1={x(sobre)} x2={x(sobre)} y1={MARGEM_L.topo} y2={MARGEM_L.topo + ph} stroke="#94a3b8" strokeWidth={1} />}

      {/* Áreas primeiro (ficam atrás das linhas) */}
      {series.filter((s) => s.area).map((s) =>
        trechos(s.valores).map((tr) => {
          const pts = tr.v.map((v, k) => [x(tr.i0 + k), y(v)] as [number, number]);
          const d = curva(pts);
          if (!d) return null;
          return <path key={`${s.id}-a-${tr.i0}`} d={`${d}L${pts[pts.length - 1][0].toFixed(1)},${y(0)}L${pts[0][0].toFixed(1)},${y(0)}Z`} fill={`url(#area-${s.id})`} />;
        })
      )}

      {/* Linhas */}
      {series.map((s) =>
        trechos(s.valores).map((tr) => {
          const pts = tr.v.map((v, k) => [x(tr.i0 + k), y(v)] as [number, number]);
          return (
            <path
              key={`${s.id}-l-${tr.i0}`}
              d={curva(pts)}
              fill="none"
              stroke={s.cor}
              strokeWidth={s.espessura ?? 2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={s.estilo === "tracejada" ? "7 6" : s.estilo === "pontilhada" ? "1 6" : undefined}
            />
          );
        })
      )}

      {/* Ponto final de cada série (ex.: valor de hoje e da projeção) */}
      {series.filter((s) => s.pontoFinal).map((s) => {
        let i = s.valores.length - 1;
        while (i >= 0 && (s.valores[i] == null || !Number.isFinite(s.valores[i] as number))) i--;
        if (i < 0) return null;
        return <circle key={`${s.id}-fim`} cx={x(i)} cy={y(s.valores[i] as number)} r={4.5} fill="#fff" stroke={s.cor} strokeWidth={2.5} />;
      })}

      {/* Pontos do dia em foco */}
      {sobre != null &&
        series.map((s) => {
          const v = s.valores[sobre];
          if (v == null || !Number.isFinite(v)) return null;
          return <circle key={`${s.id}-f`} cx={x(sobre)} cy={y(v)} r={5} fill={s.cor} stroke="#fff" strokeWidth={2} />;
        })}

      {/* Eixo X */}
      {rotulosX.map((r, i) =>
        mostra(i) ? (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill={sobre === i ? "#334155" : "#94a3b8"} fontWeight={sobre === i ? 600 : 400}>
            {r}
          </text>
        ) : null
      )}
      {sobre != null && sobre < n && !base(sobre) && (
        <text x={x(sobre)} y={H - 8} textAnchor="middle" fontSize={11} fill="#334155" fontWeight={600}>
          {rotulosX[sobre]}
        </text>
      )}
    </svg>
  );
}
