# Runbook Producao: Split App/Data (Fail-Closed)

## 1) Arquitetura final

- `App Supabase (managed)`:
  - Auth, sessao, users, core app, uploads/reports/auth/core.
  - `tgis_*` e `ralph_*` (processamento + dados) **App-only**.
- `Data Supabase (managed)`:
  - `discover_*`, `discovery_*`, `dppi_*`, `weekly_reports`, `discover_reports`.
  - Coleta/pipeline discovery + DPPI **Data-only**.
- Frontend chama funcoes no App; App faz bridge server-to-server para Data quando o dominio e discovery/dppi.

## 2) Principios ativos (obrigatorios)

- Modo estrito: sem fallback local no App para discovery/dppi.
- Falha App->Data: resposta `503` com `code=DATA_BRIDGE_UNAVAILABLE`.
- Respostas bridged com header `x-backend-owner: data`.

## 3) Funcoes e bridge

### Shared
- `supabase/functions/_shared/dataBridge.ts`

### Discovery/DPPI proxied (App -> Data)
- `discover-collector`
- `discover-dppi-island`
- `discover-dppi-panel`
- `discover-enqueue-gap`
- `discover-exposure-collector`
- `discover-exposure-report`
- `discover-exposure-timeline`
- `discover-island-lookup`
- `discover-island-lookup-ai`
- `discover-island-page`
- `discover-links-metadata-collector`
- `discover-panel-timeline`
- `discover-rails-resolver`
- `discover-report-ai`
- `discover-report-rebuild`
- `dppi-health`
- `dppi-refresh-batch`
- `dppi-release-set`
- `dppi-train-dispatch`
- `discover-data-api` (proxy de leitura/escrita controlado para frontend/admin)
- `discover-cron-admin` (controle de cron discovery via Data)

## 4) Frontend/Admin

- Nao ha mais leitura direta no App DB para tabelas:
  - `discover_*`, `discovery_*`, `dppi_*`, `weekly_reports`, `discover_reports`, `discover_report_*`.
- Essas consultas agora passam por `discover-data-api` (via App, owner data).

## 5) Ownership de cron

### APP
- `discover-*`: inativo
- `dppi-*`: inativo
- `tgis-*`: ativo

### DATA
- `discover-*`: ativo
- `dppi-*`: ativo
- `tgis-*`: inativo

Funcoes SQL de controle:
- `public.admin_list_pipeline_crons(domain)`
- `public.admin_set_pipeline_cron_domain_active(domain, active)`
- `public.admin_set_pipeline_cron_job_active(jobname, active)`

Migration:
- `supabase/migrations/20260311090000_admin_cron_domain_controls.sql`

## 6) Limpeza de duplicacao

Executado:
- **App**: `TRUNCATE ... CASCADE` de `discover_*`, `discovery_*`, `dppi_*`, `weekly_reports`, `discover_reports`.
- **Data**: `TRUNCATE ... CASCADE` de `tgis_*` e `ralph_*`.

Resultado de tamanho:
- App (dominio discover/dppi): ~`10 GB` -> ~`1.5 MB`.
- Data (dominio tgis/ralph): ~`19 MB` -> ~`2.5 MB`.

## 7) Env/secrets

### App
- `DATA_SUPABASE_URL`
- `DATA_SUPABASE_SERVICE_ROLE_KEY`
- `INTERNAL_BRIDGE_SECRET`
- `LOOKUP_DATA_TIMEOUT_MS`
- `SERVING_CACHE_TTL_SECONDS`
- `DISCOVERY_DPPI_PROXY_STRICT=true`

### Data
- `INTERNAL_BRIDGE_SECRET`
- `DISCOVERY_DPPI_PROXY_STRICT=true`
- Segredos de providers (Epic/OpenAI/NVIDIA etc.)

## 8) Validacao rapida (smoke)

1. `discover-island-lookup` e `discover-island-lookup-ai` respondem pelo App com `x-backend-owner: data`.
2. `discover-island-page` e `discover-panel-timeline` respondem pelo App com owner `data`.
3. Admin discovery/dppi carrega sem query direta de tabela no App.
4. Se bridge indisponivel, rotas discovery/dppi retornam `503 DATA_BRIDGE_UNAVAILABLE`.
5. `tgis-*` roda no App; discovery/dppi nao roda no App.

## 9) Rollback manual

1. Reverter deploy das funcoes alteradas no App.
2. Reativar cron domain no ambiente afetado via `admin_set_pipeline_cron_domain_active`.
3. Restaurar snapshot pre-cleanup se necessario.
4. Revalidar owner por header e status de cron.

## 10) Rotina operacional (Data)

- Backup gerenciado Supabase: diario (plano managed).
- Drill semanal obrigatorio de restore:
  - Registrar via `public.ops_record_backup_restore_drill('success'|'partial'|'failed', rpo_min, rto_min, notes)`.
  - SLA alvo: pelo menos 1 sucesso a cada 7 dias.
- Alertas consolidados:
  - `public.compute_system_alerts()` a cada 10 min (`ops-compute-system-alerts-10min`).
  - `public.ops_refresh_operational_alerts()` a cada 10 min (`ops-refresh-operational-alerts-10min`).
  - Alert keys operacionais:
    - `ops_backup_restore_weekly`
    - `ops_discover_dppi_cron_failures_24h`
