"use client";

import { useState } from "react";

// Selo do marketplace. Usa o logo oficial em /public/marcas/<id>.png quando o arquivo existir;
// enquanto não existir, mostra a sigla colorida.
const SIGLA: Record<string, { sigla: string; cls: string; nome: string }> = {
  mercado_livre: { sigla: "ML", cls: "bg-[#FFE600] text-[#333]", nome: "Mercado Livre" },
  shopee: { sigla: "SH", cls: "bg-[#EE4D2D] text-white", nome: "Shopee" },
  tiktok_shop: { sigla: "TT", cls: "bg-[#111] text-white", nome: "TikTok Shop" },
};

export default function MarcaMP({ mp, tamanho = 20 }: { mp: string; tamanho?: number }) {
  const [semLogo, setSemLogo] = useState(false);
  const s = SIGLA[mp] ?? SIGLA.mercado_livre;
  if (!semLogo)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/marcas/${mp}.png`} alt={s.nome} title={s.nome} width={tamanho} height={tamanho} className="inline-block shrink-0 object-contain" onError={() => setSemLogo(true)} />
    );
  return (
    <span title={s.nome} style={{ height: tamanho, minWidth: tamanho + 4 }} className={`inline-flex items-center justify-center rounded-full px-1 text-[10px] font-bold ${s.cls}`}>
      {s.sigla}
    </span>
  );
}
