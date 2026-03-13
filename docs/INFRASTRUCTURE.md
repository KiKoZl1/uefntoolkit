# Infrastructure & Configuration

## Serviços de Infra Encontrados
- Supabase (Functions + Postgres migrations). (fonte: supabase/config.toml:1, supabase/migrations)
- Build frontend via Vite/Node. (fonte: package.json)
- Kubernetes/Terraform/Docker Compose: Não determinado a partir do código.

## Variáveis de Ambiente Requeridas
### Frontend
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_BRAND_NAME`
- `VITE_CANONICAL_URL`
(fonte: .env.example:1)

### Backend Core
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `DATA_SUPABASE_URL`, `DATA_SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_BRIDGE_SECRET`
- `LOOKUP_DATA_TIMEOUT_MS`, `SERVING_CACHE_TTL_SECONDS`, `DISCOVERY_DPPI_PROXY_STRICT`
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TRANSLATION_MODEL`
- `NVIDIA_API_KEY`, `NVIDIA_LOOKUP_MODEL`
(fonte: .env.example:5)

### Commerce
- `APP_BASE_URL`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PACK_250`, `STRIPE_PRICE_PACK_650`, `STRIPE_PRICE_PACK_1400`
- `COMMERCE_GATEWAY_SECRET`, `COMMERCE_GATEWAY_ENFORCE`, `COMMERCE_INTERNAL_SECRET`
- `COMMERCE_RATE_LIMIT_*`
(fonte: .env.example:29)

## Topologia de Comunicação
- Frontend -> Supabase (Auth, PostgREST, Edge Functions). (fonte: src/integrations/supabase/client.ts:11)
- Edge Functions -> Postgres (service role / user context).
- Discover bridge opcional: App Supabase -> Data Supabase (`DATA_SUPABASE_URL`). (fonte: .env.example:14)
- Commerce -> Stripe API.
