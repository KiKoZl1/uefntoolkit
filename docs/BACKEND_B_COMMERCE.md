# Backend B - Commerce Edge API

## Arquitetura Geral
- API HTTP multiplexada em uma única função Edge (`commerce`) com roteamento interno por sufixo de path. (fonte: supabase/functions/commerce/index.ts:149, supabase/functions/commerce/index.ts:1555)
- Domínios: catálogo de custos, créditos/carteira, execução/reversão de ferramentas, checkout/webhook Stripe, administração e jobs internos. (fonte: supabase/functions/commerce/index.ts:1563)

## Auth/AuthZ
- `verify_jwt=false` na configuração, mas a função aplica validação explícita de usuário/papel por rota. (fonte: supabase/config.toml:126, supabase/functions/commerce/index.ts:252)
- Endpoints admin exigem `requireFinancialAdmin`. (fonte: supabase/functions/commerce/index.ts:276, supabase/functions/commerce/index.ts:1662)
- Endpoints internos aceitam `x-commerce-internal-secret` ou admin. (fonte: supabase/functions/commerce/index.ts:281, supabase/functions/commerce/index.ts:1701)

## API Documentation

- `GET /functions/v1/commerce/catalog/tool-costs` (sem auth). Handler: `index.ts:1563`.
- `GET /functions/v1/commerce/me/credits` (Bearer). Handler: `index.ts:1567`.
- `GET /functions/v1/commerce/me/credits/summary` (Bearer). Handler: `index.ts:1572`.
- `GET /functions/v1/commerce/me/ledger` (Bearer). Handler: `index.ts:1577`.
- `GET /functions/v1/commerce/me/usage-summary` (Bearer). Handler: `index.ts:1582`.
- `POST /functions/v1/commerce/tools/execute` (Bearer + rate limit). Handler: `index.ts:1587`.
- `POST /functions/v1/commerce/tools/reverse` (Bearer + rate limit). Handler: `index.ts:1601`.
- `POST /functions/v1/commerce/billing/subscription/checkout` (Bearer + rate limit). Handler: `index.ts:1615`.
- `GET /functions/v1/commerce/billing/packs` (Bearer). Handler: `index.ts:1629`.
- `POST /functions/v1/commerce/billing/packs/{packCode}/checkout` (Bearer + rate limit). Handler: `index.ts:1634`.
- `POST /functions/v1/commerce/billing/webhooks/provider` (Stripe signature + rate limit). Handler: `index.ts:1649`.
- `GET /functions/v1/commerce/admin/user-lookup?email=...` (admin). Handler: `index.ts:1662`.
- `GET /functions/v1/commerce/admin/user/{userId}` (admin). Handler: `index.ts:1668`.
- `POST /functions/v1/commerce/admin/credits/grant` (admin). Handler: `index.ts:1675`.
- `POST /functions/v1/commerce/admin/credits/debit` (admin). Handler: `index.ts:1681`.
- `POST /functions/v1/commerce/admin/user/{userId}/abuse-review` (admin). Handler: `index.ts:1687`.
- `POST /functions/v1/commerce/admin/user/{userId}/suspend` (admin). Handler: `index.ts:1694`.
- `POST /functions/v1/commerce/internal/jobs/weekly-release` (internal secret or admin). Handler: `index.ts:1701`.
- `POST /functions/v1/commerce/internal/jobs/reconcile` (internal secret or admin). Handler: `index.ts:1708`.

### Campos mínimos não determinados
- Query/body/response detalhado por endpoint: parcialmente inferível, porém incompleto sem schema formal.
- `x-doc-status: incomplete` aplicado para contratos detalhados não extraíveis com alta confiança nesta execução.
