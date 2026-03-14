# UEFN Toolkit

Code-first technical documentation for onboarding, operation, and long-term maintenance.

This README is intentionally operational and implementation-focused. Every technical claim below is tied to code evidence.

## 0. Canonical Platform Name

The canonical platform name is `UEFN Toolkit`.

Do not use any alternative platform naming in documentation.

## 1. What This Project Is

UEFN Toolkit is a React + Supabase platform with four major product surfaces:

1. Public Discover and reports experience.
2. Authenticated workspace tools (analytics, thumb tools, widget tools).
3. Admin Center for Discover, DPPI, TGIS, Ralph, and Commerce operations.
4. ML and worker runtime for DPPI (prediction) and TGIS (thumbnail generation and model lifecycle).

Evidence:
- Public, app, and admin route tree is defined in `src/App.tsx`. (source: src/App.tsx:103)
- Admin route tree includes DPPI, TGIS, and Commerce domains. (source: src/App.tsx:147)
- Tool hub catalog is defined in frontend registry. (source: src/tool-hubs/registry.ts:23)
- Supabase edge functions include discover, dppi, tgis, and commerce handlers. (source: supabase/config.toml:3)
- ML runtime code exists under `ml/dppi` and `ml/tgis`. (source: ml/dppi/runtime.py:1, ml/tgis/runtime/worker_tick.py:1)

## 2. Repository Map

- `src/`: frontend app, routes, admin UI, tool pages.
- `supabase/functions/`: edge functions (HTTP APIs).
- `supabase/migrations/`: authoritative database schema and RPC logic.
- `ml/dppi/`: DPPI training, calibration, inference, release tooling.
- `ml/tgis/`: TGIS training/runtime pipelines and trainer integrations.
- `scripts/`: operator scripts (Ralph runner, setup, SQL helpers, migration utilities).
- `docs/`: full technical documentation package.

Evidence:
- Function-level routing and operation wrappers in frontend data client. (source: src/lib/discoverDataApi.ts:60)
- Worker orchestration entrypoints in ML runtime. (source: ml/dppi/pipelines/worker_tick.py:25, ml/tgis/runtime/worker_tick.py:11)

## 3. Runtime Architecture

### 3.1 Frontend Runtime

- React 18 + Vite + TypeScript.
- React Router defines public/app/admin surfaces.
- React Query provides client caching behavior.
- Supabase auth is used for session and role-aware routing.

Evidence:
- Frontend dependencies and scripts in `package.json`. (source: package.json:69)
- Query client and route assembly in app root. (source: src/App.tsx:74)
- Admin guard checks `isAdmin || isEditor`. (source: src/components/AdminRoute.tsx:5)

### 3.2 Backend Runtime (Edge Functions)

- Backend is built as Supabase edge functions with per-domain handlers.
- JWT verification behavior is configured per function in `supabase/config.toml`.
- Many handlers still enforce role checks in code even if `verify_jwt = false`.

Evidence:
- Function auth mode toggles in config file. (source: supabase/config.toml:60)
- `dppi-health` checks role from `user_roles`. (source: supabase/functions/dppi-health/index.ts:72)
- `tgis-admin-*` handlers resolve `admin/editor` role from `user_roles`. (source: supabase/functions/tgis-admin-sync-manifest/index.ts:66)

### 3.3 Database Runtime

- PostgreSQL schema is migration-driven.
- DPPI, TGIS, and Ralph each have dedicated table families and RPC functions.
- RLS is enabled and service-role RPC controls are applied for sensitive operations.

Evidence:
- DPPI base tables. (source: supabase/migrations/20260227113000_dppi_tables.sql:3)
- DPPI service-role guard function. (source: supabase/migrations/20260227150000_dppi_rpc_and_policies.sql:21)
- TGIS foundation schema. (source: supabase/migrations/20260228103000_tgis_foundation.sql:3)
- Ralph ops and memory schemas. (source: supabase/migrations/20260216123000_ralph_ops_foundation.sql:3, supabase/migrations/20260218154000_ralph_memory_context.sql:7)

## 4. Product Surfaces and Tooling

### 4.1 Public Routes

- `/`
- `/discover`
- `/island`
- `/reports`
- `/reports/:slug`
- `/tools/analytics`
- `/tools/thumb-tools`
- `/tools/widgetkit`

Evidence: route declarations. (source: src/App.tsx:103)

### 4.2 Authenticated Workspace Routes

- `/app`
- `/app/analytics-tools`
- `/app/island-lookup`
- `/app/billing`
- `/app/credits`
- `/app/thumb-tools/*`
- `/app/widgetkit/*`

Evidence: route declarations. (source: src/App.tsx:116)

### 4.3 Admin Routes

- `/admin`
- `/admin/reports`
- `/admin/exposure`
- `/admin/intel`
- `/admin/panels`
- `/admin/dppi/*`
- `/admin/tgis/*`
- `/admin/commerce`

Evidence: route declarations. (source: src/App.tsx:140)

## 5. Tool Hubs and Credits

### 5.1 Hub Definitions

Three hubs are defined in frontend config:

- `analyticsTools`
- `thumbTools`
- `widgetKit`

Evidence: hub registry. (source: src/tool-hubs/registry.ts:23)

### 5.2 Tool Codes

Commerce tool codes currently in use:

- `surprise_gen`
- `edit_studio`
- `camera_control`
- `layer_decomposition`
- `psd_to_umg`
- `umg_to_verse`

Evidence: type definition. (source: src/lib/commerce/toolCosts.ts:1)

### 5.3 Default Cost Baseline

Default costs are hardcoded client-side as fallback and are also requested from backend catalog endpoint.

Evidence:
- Defaults map. (source: src/lib/commerce/toolCosts.ts:11)
- Catalog endpoint call. (source: src/lib/commerce/toolCosts.ts:91)

## 6. Environment Configuration

## 6.1 Baseline Variables

Core required variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Evidence: `.env.example`. (source: .env.example:1)

### 6.2 LLM and Inference Keys

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_TRANSLATION_MODEL`
- `NVIDIA_API_KEY`
- `NVIDIA_LOOKUP_MODEL`

Evidence: `.env.example`. (source: .env.example:20)

### 6.3 Commerce and Stripe

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_*`
- `COMMERCE_GATEWAY_SECRET`
- `COMMERCE_GATEWAY_ENFORCE`
- `COMMERCE_INTERNAL_SECRET`

Evidence: `.env.example`. (source: .env.example:29)

## 7. Local Setup

### 7.1 Install and Start Frontend

```bash
npm install
npm run dev
```

Default local app URL is `http://localhost:8080`.

Evidence:
- `dev` script uses Vite. (source: package.json:7)
- Vite server port is 8080. (source: vite.config.ts:9)

### 7.2 Optional Supabase Target Rewrite

Use migration target helper when switching environments:

```bash
npm run migration:set-target -- -ProjectRef <ref> -SupabaseUrl https://<ref>.supabase.co -PublishableKey <anon>
```

Evidence: script registration. (source: package.json:22)

### 7.3 SQL Operations

Use the SQL wrapper for direct DB actions:

```powershell
scripts\run-sql.bat -Query "select now();"
scripts\run-sql.bat -File supabase\migrations\<migration>.sql
```

Evidence: SQL script wrapper exists. (source: scripts/sql.ps1:1)

## 8. Test and Validation

### 8.1 Unit and Integration

```bash
npm run test
npm run test:watch
```

Evidence: scripts. (source: package.json:12)

### 8.2 End-to-End

```bash
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:report
```

Evidence: scripts. (source: package.json:14)

## 9. Deployment and Operations

### 9.1 Frontend Build

```bash
npm run build
npm run preview
```

Build output is `dist` because project uses Vite build defaults.

Evidence:
- Build script command. (source: package.json:8)
- Vite usage as build system. (source: package.json:104)

### 9.2 Deploy Order (Code-Derived)

Recommended order from repository structure:

1. Build and verify frontend artifacts.
2. Apply database migrations.
3. Deploy/update edge functions.
4. Validate admin and tool flows.
5. Resume/monitor DPPI and TGIS worker loops.

Evidence:
- Frontend build scripts. (source: package.json:8)
- Migration-driven schema model. (source: supabase/migrations/20260227113000_dppi_tables.sql:3, supabase/migrations/20260228103000_tgis_foundation.sql:3)
- Function inventory. (source: supabase/config.toml:3)
- Worker tick entrypoints. (source: ml/dppi/pipelines/worker_tick.py:25, ml/tgis/runtime/worker_tick.py:11)

### 9.3 Edge Functions and API Runtime

Function domains currently defined:

- Discover/public data APIs
- DPPI domain
- TGIS domain
- Commerce domain

Evidence:
- Function declarations and JWT flags. (source: supabase/config.toml:3, supabase/config.toml:60, supabase/config.toml:75, supabase/config.toml:126)

### 9.4 Worker Operations

DPPI worker tick orchestrates heartbeat, queue processing, inference, and drift checks.

Evidence: orchestration step list. (source: ml/dppi/pipelines/worker_tick.py:34)

TGIS worker tick orchestrates heartbeat, training queue processing, and cost sync.

Evidence: orchestration step list. (source: ml/tgis/runtime/worker_tick.py:30)

### 9.5 Detailed Deployment/Operations Guides

For complete step-by-step operator instructions use:

- `docs/DEPLOYMENT_RUNBOOK.md`

### 9.6 Support AI Memory Sync (Incremental)

Keep support AI knowledge fresh with incremental reingest:

```bash
npm run support:memory:sync -- --paths=docs --scope=support,docs
```

Behavior:

- scans documentation paths
- hashes content chunks
- upserts only new/changed chunks
- skips unchanged chunks (no extra embedding cost)
- deactivates stale chunks for files that changed chunk count

Recurring job:

- GitHub Actions workflow: `.github/workflows/support-memory-sync.yml`
- runs every 6 hours and on `docs/**` updates to `main`
- `docs/OPERATIONS_RUNBOOK.md`
- `docs/PAYMENTS_GATEWAY.md`
- `docs/LLM_ML_RUNBOOK.md`

These files contain expanded operational procedures and validation checklists.

## 10. Domain Documentation

Primary docs that cover full domain behavior:

- `docs/ADMIN_CENTER.md`
- `docs/DDPI_ML_SYSTEM.md`
- `docs/TGIS_LLM_ML_SYSTEM.md`
- `docs/RALPH_SYSTEM.md`
- `docs/LLM_ML_RUNBOOK.md`
- `docs/TOOLS_CATALOG.md`
- `docs/DEVELOPER_GUIDE.md`
- `docs/tools/README.md` (deep-dive doc per tool)
- `docs/BRAND_AND_DESIGN_STANDARDS.md`
- `docs/TOOL_ARCHITECTURE_TEMPLATE.md`
- `docs/SYSTEM_COVERAGE_MATRIX.md`

See index: `docs/README.md`.

## 11. Known Non-Determinable Items

The following are intentionally not asserted because they are not fully encoded in repo automation:

- End-to-end cloud provider rollout sequence for frontend static hosting (Not determined from code).
- Full rollback policy for all migrations in production (Not determined from code).
- External SLO policy contract documents (Not determined from code).

## 12. Maintenance Policy

- Documentation must be code-derived.
- Claims must include source file and line.
- When behavior cannot be proved from code, document it as unknown rather than inferred.

This policy is aligned with `.doc-agent` snapshot and diff process used by the documentation automation.



