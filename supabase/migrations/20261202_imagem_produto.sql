-- Imagem do produto (puxada da capa do anúncio relacionado)
alter table public.products add column if not exists imagem_url text;
