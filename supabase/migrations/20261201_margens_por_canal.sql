-- Margem e preço de venda por canal (salvos pela calculadora e mostrados no Armazém).
-- A margem do Mercado Livre continua em promo_min_margin (já existente).
alter table public.products add column if not exists tiktok_margem numeric;
alter table public.products add column if not exists tiktok_preco numeric;
alter table public.products add column if not exists tiktok_config jsonb;
alter table public.products add column if not exists shopee_margem numeric;
alter table public.products add column if not exists shopee_preco numeric;
alter table public.products add column if not exists shopee_config jsonb;
alter table public.products add column if not exists ml_preco numeric;
alter table public.products add column if not exists ml_config jsonb;

-- Peso e medidas do produto (peso cúbico e frete do Mercado Livre)
alter table public.products add column if not exists peso_kg numeric;
alter table public.products add column if not exists comprimento_cm numeric;
alter table public.products add column if not exists largura_cm numeric;
alter table public.products add column if not exists altura_cm numeric;
