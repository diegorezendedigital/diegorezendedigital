# Margem Certa

Mostra o lucro real de cada venda nos marketplaces (taxas, frete e impostos) e se conecta ao Mercado Livre para importar pedidos automaticamente.

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind · Supabase (login e banco) · Vercel.

## O que tem

- **Produtos**: custo e preço, com taxas, lucro e margem por marketplace.
- **Calculadora**: lucro por venda e preço mínimo para atingir a margem desejada.
- **Mercado Livre**: conecta a conta (OAuth), mostra a reputação e importa pedidos pagos como vendas, com a taxa e o frete reais. Pode sincronizar quantas vezes quiser sem duplicar.
- **Relatórios** e **DRE** por mês, com despesas.
- **Admin**: visão de todas as lojas (só para usuários da tabela `admins`).

## Como configurar

### 1. Supabase
No SQL Editor do projeto, rode `supabase/migrations/20261110_integracao_mercado_livre.sql`. Ela:
- cria `external_id` em `products` e `sales` (evita duplicar vendas a cada sincronização);
- tira o acesso do navegador à tabela `ml_connections`: os tokens do Mercado Livre só são lidos pelo servidor;
- cria a função que recalcula o custo das vendas quando o custo do produto muda.

É segura para rodar mais de uma vez.

### 2. App no Mercado Livre
Em https://developers.mercadolivre.com.br/devcenter crie uma aplicação com:
- **URI de redirect:** `https://SEU-DOMINIO/api/ml/callback` (igual a `ML_REDIRECT_URI`);
- **Fluxos:** Authorization Code e Refresh Token;
- **PKCE:** desmarcado;
- **Negócios:** Mercado Livre;
- **Permissões (leitura):** Usuários, Vendas e envios, Publicação e sincronização.

### 3. Vercel
Importe este repositório e cadastre as variáveis de `.env.example` **antes do primeiro deploy** (as `NEXT_PUBLIC_*` são usadas já no build). Depois do deploy, confira o endereço real do projeto e use-o em `ML_REDIRECT_URI` e no DevCenter.

## Rodar localmente

```bash
npm install
cp .env.example .env.local   # preencha os valores
npm run dev
```

## Segurança

- `SUPABASE_SERVICE_ROLE_KEY`, `ML_CLIENT_SECRET` e `ML_STATE_SECRET` ficam só no servidor. Nunca commite o `.env`.
- Os dados de cada loja são isolados por RLS no Supabase (`auth.uid() = store_id`).
- As rotas `/api/ml/*` exigem o token de sessão do Supabase e nunca devolvem os tokens do Mercado Livre.

## Como o lucro é calculado

Em `sales`, `sale_price` e `cost_price` são o **total da linha** (já multiplicados pela quantidade):

`lucro = sale_price − cost_price − fees_total − shipping_cost − tax_amount`

## Limitações conhecidas

- Impostos não vêm do Mercado Livre; entram como R$ 0,00 na importação.
- O frete é buscado em melhor esforço; se o Mercado Livre não responder, fica R$ 0,00.
- O custo dos produtos criados pela importação começa em 0: preencha em **Produtos** e o lucro das vendas é recalculado.
- Confira os valores da primeira importação (em especial a taxa por item) contra o painel do Mercado Livre.
