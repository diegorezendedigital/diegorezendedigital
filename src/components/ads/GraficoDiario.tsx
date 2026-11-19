import React from "react";

// Desenho do gráfico diário (SVG em pixels reais: texto nítido, sem esticar).
// Função pura: o estado (largura, dia em foco) fica no componente que a usa.

export type PontoGrafico = { data: string; a: number; b: number }; // a = Mercado Livre, b = Shopee (no modo linha só "a" vale)

export const CORES = { a: "#2a78d6", b: "#eb6834", linha: "#1baf7a", grade: "#eef1f6", base: "#cbd5e1", texto: "#94a3b8", foco: "rgba(91,61,245,0.06)" };

export const MARGEM = { esq: 64, dir: 16, topo: 18, baixo: 30 };

export function escalaRedonda(max: number, divisoes = 4) {
  if (!(max > 0)) return { topo: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const bruto = max / divisoes;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map((k) => k * pot).find((x) => x >= bruto * 0.999) ?? 10 * pot;
  const n = Math.ceil(max / passo - 1e-9);
  return { topo: passo * n, ticks: Array.from({ length: n + 1 }, (_, i) => i * passo) };
}

// Retângulo com só os cantos de cima arredondados
function topoArredondado(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function GraficoDiarioSvg({
  serie,
  modo,
  largura,
  altura,
  sobre,
  rotuloEixo,
  media,
}: {
  serie: PontoGrafico[];
  modo: "barras" | "linha";
  largura: number;
  altura: number;
  sobre: number | null;
  rotuloEixo: (v: number) => string;
  media?: number | null;
}) {
  const n = serie.length;
  const W = Math.max(200, largura);
  const H = altura;
  const pw = W - MARGEM.esq - MARGEM.dir;
  const ph = H - MARGEM.topo - MARGEM.baixo;
  const max = Math.max(0, ...serie.map((p) => (modo === "barras" ? p.a + p.b : p.a)), media ?? 0);
  const { topo, ticks } = escalaRedonda(max * 1.05);
  const y = (v: number) => MARGEM.topo + ph - (v / topo) * ph;
  const faixa = pw / Math.max(1, n);
  const cx = (i: number) => MARGEM.esq + faixa * (i + 0.5);
  const larguraBarra = Math.max(2, Math.min(34, faixa * (n > 40 ? 0.7 : 0.58)));

  // Rótulos de data: no máximo ~8, sempre o primeiro e o último
  const alvo = Math.max(2, Math.min(8, Math.floor(pw / 70)));
  const cada = Math.max(1, Math.ceil(n / alvo));
  const base = (i: number) => i === 0 || i === n - 1 || (i % cada === 0 && n - 1 - i >= cada * 0.6);
  // Com um dia em foco, some com as datas vizinhas que encostariam no rótulo dele
  const mostraData = (i: number) => base(i) && !(sobre != null && i !== sobre && Math.abs(i - sobre) * (pw / Math.max(1, n)) < 46);
  const fmtData = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

  const pontos = serie.map((p, i) => [cx(i), y(p.a)] as const);
  const caminhoLinha = pontos.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
  const caminhoArea = n ? `${caminhoLinha}L${pontos[n - 1][0].toFixed(1)},${y(0)}L${pontos[0][0].toFixed(1)},${y(0)}Z` : "";

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", fontFamily: "inherit" }} role="img">
      <defs>
        <linearGradient id="adsArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={CORES.linha} stopOpacity={0.22} />
          <stop offset="100%" stopColor={CORES.linha} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Faixa do dia em foco */}
      {sobre != null && sobre < n && <rect x={MARGEM.esq + faixa * sobre} y={MARGEM.topo} width={faixa} height={ph} fill={CORES.foco} rx={6} />}

      {/* Grade e eixo Y */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={MARGEM.esq} x2={W - MARGEM.dir} y1={y(t)} y2={y(t)} stroke={t === 0 ? CORES.base : CORES.grade} strokeWidth={1} />
          <text x={MARGEM.esq - 10} y={y(t)} dy="0.35em" textAnchor="end" fontSize={11} fill={CORES.texto} style={{ fontVariantNumeric: "tabular-nums" }}>
            {rotuloEixo(t)}
          </text>
        </g>
      ))}

      {/* Barras empilhadas: Mercado Livre embaixo, Shopee em cima, 2px de respiro entre elas */}
      {modo === "barras" &&
        serie.map((p, i) => {
          const x0 = cx(i) - larguraBarra / 2;
          const hA = p.a > 0 ? Math.max(2, y(0) - y(p.a)) : 0;
          const hB = p.b > 0 ? Math.max(2, y(0) - y(p.b)) : 0;
          const vao = hA && hB ? 2 : 0;
          const apagado = sobre != null && sobre !== i;
          return (
            <g key={p.data} opacity={apagado ? 0.62 : 1}>
              {hA > 0 && (hB ? <rect x={x0} y={y(0) - hA} width={larguraBarra} height={hA} fill={CORES.a} /> : <path d={topoArredondado(x0, y(0) - hA, larguraBarra, hA, 4)} fill={CORES.a} />)}
              {hB > 0 && <path d={topoArredondado(x0, y(0) - hA - vao - hB, larguraBarra, hB, 4)} fill={CORES.b} />}
            </g>
          );
        })}

      {/* Linha com área (ROAS) */}
      {modo === "linha" && n > 0 && (
        <g>
          <path d={caminhoArea} fill="url(#adsArea)" />
          <path d={caminhoLinha} fill="none" stroke={CORES.linha} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {pontos.map(([px, py], i) =>
            n <= 45 || sobre === i ? (
              <circle key={i} cx={px} cy={py} r={sobre === i ? 5 : 3.5} fill={CORES.linha} stroke="#fff" strokeWidth={2} />
            ) : null
          )}
        </g>
      )}

      {/* Média do período */}
      {media != null && media > 0 && (
        <g>
          <line x1={MARGEM.esq} x2={W - MARGEM.dir} y1={y(media)} y2={y(media)} stroke="#64748b" strokeWidth={1} strokeDasharray="4 4" />
          <rect x={W - MARGEM.dir - 92} y={y(media) - 20} width={92} height={18} rx={9} fill="#fff" stroke="#e2e8f0" />
          <text x={W - MARGEM.dir - 46} y={y(media) - 11} dy="0.35em" textAnchor="middle" fontSize={10.5} fill="#475569" fontWeight={600}>
            média {rotuloEixo(media)}
          </text>
        </g>
      )}

      {/* Eixo X */}
      {serie.map((p, i) =>
        mostraData(i) ? (
          <text key={p.data} x={cx(i)} y={H - 8} textAnchor={i === 0 && faixa < 40 ? "start" : i === n - 1 && faixa < 40 ? "end" : "middle"} fontSize={11} fill={sobre === i ? "#334155" : CORES.texto} fontWeight={sobre === i ? 600 : 400}>
            {fmtData(p.data)}
          </text>
        ) : null
      )}
      {sobre != null && sobre < n && !base(sobre) && (
        <text x={cx(sobre)} y={H - 8} textAnchor="middle" fontSize={11} fill="#334155" fontWeight={600}>
          {fmtData(serie[sobre].data)}
        </text>
      )}
    </svg>
  );
}
