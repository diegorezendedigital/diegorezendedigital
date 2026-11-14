-- Margem e preço de venda por canal (salvos pela calculadora e mostrados no Armazém).
-- A margem do Mercado Livre continua em promo_min_margin (já existente).
alter table public.products add column if not exists tiktok_margem numeric;
alter table public.products add column if not exists tiktok_preco numeric;
alter table public.products add column if not exists tiktok_config jsonb;
alter table public.products add column if not exists shopee_margem numeric;
alter table public.products add column if not exists shopee_preco numeric;
