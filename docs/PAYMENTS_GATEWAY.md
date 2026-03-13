# Payments Gateway (Commerce)

Documentação aprofundada do subsistema de pagamento, créditos e antiabuso.

## 1. Visão geral
O gateway de pagamentos está centralizado em `supabase/functions/commerce/index.ts`.
Ele unifica:
- autenticação de usuário
- cobrança por uso de tools
- assinatura e packs via Stripe
- webhook processing
- operações financeiras administrativas

(fonte: `supabase/functions/commerce/index.ts:1555`)

## 2. Endpoints e superfícies
### 2.1 Catálogo e créditos
- `GET /functions/v1/commerce/catalog/tool-costs`
- `GET /functions/v1/commerce/me/credits`
- `GET /functions/v1/commerce/me/credits/summary`
- `GET /functions/v1/commerce/me/ledger`
- `GET /functions/v1/commerce/me/usage-summary`

(fonte: `supabase/functions/commerce/index.ts:1563`)

### 2.2 Cobrança por execução
- `POST /functions/v1/commerce/tools/execute`
- `POST /functions/v1/commerce/tools/reverse`

(fonte: `supabase/functions/commerce/index.ts:1587`)

### 2.3 Billing Stripe
- `POST /functions/v1/commerce/billing/subscription/checkout`
- `GET /functions/v1/commerce/billing/packs`
- `POST /functions/v1/commerce/billing/packs/{packCode}/checkout`
- `POST /functions/v1/commerce/billing/webhooks/provider`

(fonte: `supabase/functions/commerce/index.ts:1615`)

### 2.4 Admin + Internal jobs
- Admin: lookup/user overview/credit grant/debit/abuse-review/suspend
- Internal: weekly-release e reconcile

(fonte: `supabase/functions/commerce/index.ts:1662`)

## 3. Modelo de autenticação e autorização
### 3.1 Contexto de usuário
- Função resolve usuário a partir de bearer token + leitura de role.
- Papéis são reduzidos em flags (`isAdmin`, `isEditor`).

(fonte: `supabase/functions/commerce/index.ts:252`, `supabase/functions/_shared/commerceAuthz.ts:11`)

### 3.2 Regras de acesso
- Endpoints `me/*` e `tools/*` exigem usuário autenticado.
- Endpoints `admin/*` exigem `requireFinancialAdmin`.
- Endpoints `internal/jobs/*` exigem `x-commerce-internal-secret` válido ou admin.

(fonte: `supabase/functions/commerce/index.ts:280`, `supabase/functions/commerce/index.ts:284`)

## 4. Fluxo de execução de tools (crédito por consumo)
## 4.1 Requisição frontend
Frontend envia:
- `Authorization: Bearer <session token>`
- `Idempotency-Key`
- `x-device-fingerprint-hash`

(fonte: `src/lib/commerce/client.ts:56`)

## 4.2 Pipeline no backend
1. Valida `idempotency_key` e `tool_code`.
2. Garante conta (`commerce_ensure_account`).
3. Calcula hash do payload.
4. Debita créditos (`commerce_debit_tool_credits`).
5. Se tool for WidgetKit (`psd_to_umg`, `umg_to_verse`): marca sucesso `client_local`.
6. Caso contrário, faz dispatch para função tgis mapeada.
7. Em falha elegível, faz auto-reverse (`commerce_reverse_operation`).
8. Marca resultado de tentativa.

Evidência:
- validação e débito. (fonte: `supabase/functions/commerce/index.ts:724`)
- branch client_local WidgetKit. (fonte: `supabase/functions/commerce/index.ts:761`)
- dispatch para tgis. (fonte: `supabase/functions/commerce/index.ts:784`)
- auto-reversal. (fonte: `supabase/functions/commerce/index.ts:818`)

## 4.3 Mapping tool -> executor
- `surprise_gen` -> `tgis-generate`
- `edit_studio` -> `tgis-edit-studio`
- `camera_control` -> `tgis-camera-control`
- `layer_decomposition` -> `tgis-layer-decompose`
- `psd_to_umg` e `umg_to_verse` -> `client_local`

(fonte: `supabase/functions/commerce/index.ts:36`, `supabase/functions/commerce/index.ts:761`)

## 5. Custos e catálogo
### 5.1 Custos padrão frontend
- `surprise_gen: 15`
- `edit_studio: 4`
- `camera_control: 3`
- `layer_decomposition: 8`
- `psd_to_umg: 2`
- `umg_to_verse: 2`

(fonte: `src/lib/commerce/toolCosts.ts:11`)

### 5.2 Custos dinâmicos backend
Commerce pode entregar custos via `commerce_config` e endpoint de catálogo.

(fonte: `supabase/functions/commerce/index.ts:542`, `supabase/functions/commerce/index.ts:1563`)

## 6. Stripe billing
## 6.1 Criação de checkout session
- Usa `STRIPE_SECRET_KEY`.
- Monta request para `https://api.stripe.com/v1/checkout/sessions`.

(fonte: `supabase/functions/commerce/index.ts:375`)

## 6.2 Assinatura PRO
- Usa `STRIPE_PRICE_PRO_MONTHLY`.
- Salva sessão e metadados para reconciliação.

(fonte: `supabase/functions/commerce/index.ts:1085`)

## 6.3 Packs
- `pack_250`, `pack_650`, `pack_1400` mapeados para price IDs.

(fonte: `supabase/functions/commerce/index.ts:1130`)

## 6.4 Webhook
- Header `stripe-signature` obrigatório.
- Verifica assinatura e tolerância de tempo.
- Processa eventos de checkout/subscription/invoice e sincroniza estado local.

(fonte: `supabase/functions/commerce/index.ts:1179`, `supabase/functions/commerce/index.ts:564`)

## 7. Antiabuso e rate limit
- Device fingerprint é coletado no client e enviado ao backend.
- Rate limits por escopo controlados por env vars `COMMERCE_RATE_LIMIT_*`.
- Abuse review e suspensão via endpoints admin.

Evidência:
- fingerprint transport. (fonte: `src/lib/commerce/client.ts:56`)
- limits por escopo. (fonte: `.env.example:45`, `supabase/functions/commerce/index.ts:1594`)
- abuse-review/suspend. (fonte: `supabase/functions/commerce/index.ts:1687`)

## 8. Variáveis de ambiente críticas
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_PRICE_PACK_250`
- `STRIPE_PRICE_PACK_650`
- `STRIPE_PRICE_PACK_1400`
- `COMMERCE_GATEWAY_SECRET`
- `COMMERCE_INTERNAL_SECRET`
- `COMMERCE_RATE_LIMIT_*`

(fonte: `.env.example:31`)

## 9. Operação e troubleshooting
### 9.1 Erros comuns
- `missing_user_session`: sessão frontend inválida/expirada.
- `missing_idempotency_key`: client não enviou chave.
- `INSUFFICIENT_CREDITS`: saldo insuficiente para tool.
- `stripe_not_configured`: segredo Stripe não definido.
- `stripe_webhook_secret_not_configured`: webhook secret ausente.

Evidência:
- checagens de erro no client/backend. (fonte: `src/lib/commerce/client.ts:43`, `supabase/functions/commerce/index.ts:724`, `supabase/functions/commerce/index.ts:747`, `supabase/functions/commerce/index.ts:384`, `supabase/functions/commerce/index.ts:1182`)

### 9.2 Verificações administrativas rápidas
- `GET /functions/v1/commerce/admin/user-lookup?email=...`
- `GET /functions/v1/commerce/admin/user/{id}`
- Checar ledger e abuse signals no payload admin.

(fonte: `supabase/functions/commerce/index.ts:1662`, `supabase/functions/commerce/index.ts:1349`)

## 10. Limites de documentação
- Não há contrato OpenAPI nativo no código com schemas completos para todos payloads; docs detalham o comportamento observável e marcam incompletude onde necessário.
