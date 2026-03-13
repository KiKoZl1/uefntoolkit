# Deployment Runbook

Runbook de deploy e atualização operacional.

## 1. Pré-condições
- `.env` configurado com variáveis mínimas de app/backend.
- Dependências Node instaladas.
- Acesso ao projeto Supabase (project ref + credenciais).

Evidência:
- Variáveis em `.env.example`. (fonte: `.env.example:1`)
- scripts `dev/build/test` no npm. (fonte: `package.json:7`)
- resolução de project ref via env/config. (fonte: `scripts/set-discover-metrics-profile.ps1:30`)

## 2. Bootstrapping de ambiente
### 2.1 Configurar target Supabase
```powershell
npm run migration:set-target -- -ProjectRef <project-ref> -SupabaseUrl https://<project-ref>.supabase.co -PublishableKey <anon-key>
```
Este comando:
- cria backup de `.env` e `supabase/config.toml`
- atualiza `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`
- atualiza `project_id` em `supabase/config.toml`

Evidência: `scripts/migration-set-target.ps1:37`.

## 3. Deploy frontend
### 3.1 Build
```bash
npm run build
```

### 3.2 Validação local de artefato
```bash
npm run preview
```

Evidência: `package.json:8`.

Observação:
- Provider de hosting/CDN específico (Cloudflare/Vercel/etc.) **não está codificado explicitamente** neste repositório.
- Status: **Não determinado a partir do código**.

## 4. Deploy Supabase Functions
### 4.1 Comando evidenciado no repositório
```bash
npx supabase@latest functions deploy discover-collector --project-ref <ref>
```

Evidência: `scripts/set-discover-metrics-profile.ps1:145`.

### 4.2 Padrão inferido para outras funções
A mesma forma pode ser aplicada para qualquer função existente em `supabase/functions/<name>`:
```bash
npx supabase@latest functions deploy <function-name> --project-ref <ref>
```

Status: **Inferência operacional** baseada no padrão Supabase CLI + estrutura do repositório.

### 4.3 Funções existentes
- `discover-*`, `dppi-*`, `tgis-*`, `commerce`, `ai-analyst`

Evidência: listagem em `supabase/functions/*`, `supabase/config.toml:3`.

## 5. Secrets / Environment no Supabase
### 5.1 Aplicar perfil de métricas Discover
```powershell
powershell -File scripts/set-discover-metrics-profile.ps1 -Profile balanced -ProjectRef <ref>
```
Isso executa `supabase secrets set` com múltiplas variáveis de tuning.

Evidência: `scripts/set-discover-metrics-profile.ps1:126`.

### 5.2 Segredos críticos de produção
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `NVIDIA_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `COMMERCE_*`
- `DATA_SUPABASE_*` + `INTERNAL_BRIDGE_SECRET` (se data split)

Evidência: `.env.example:5`.

## 6. Banco de dados e migrations
### 6.1 Estado de schema
- Schema é versionado por SQL em `supabase/migrations`.

### 6.2 Execução SQL remota manual
```powershell
scripts\run-sql.bat -File supabase\migrations\<file>.sql
```
ou
```powershell
scripts\run-sql.bat -Query "select now();"
```

Evidência: `scripts/run-sql.bat:1`, `scripts/sql.ps1:69`.

### 6.3 Export de dados auxiliares
```bash
npm run migration:export:tables
```

Evidência: `package.json:23`, `scripts/export_supabase_tables.mjs:133`.

## 7. Pós-deploy (checklist)
1. Health frontend:
- abrir `/`, `/discover`, `/reports`
2. Health rotas protegidas:
- `/app`, `/admin` (com sessão)
3. Health commerce:
- `GET /functions/v1/commerce/catalog/tool-costs`
- `GET /functions/v1/commerce/me/credits` (autenticado)
4. Health discover gateway:
- chamada `discover-data-api` com operação `select`
5. Rodar smoke e2e:
```bash
npm run test:e2e
```

Evidência:
- smoke routes e guards nos testes. (fonte: `e2e/navigation-smoke.spec.ts:3`)
- endpoint catálogo commerce. (fonte: `supabase/functions/commerce/index.ts:1563`)

## 8. Rollback
## 8.1 Frontend
- Reverter commit e publicar build anterior.

## 8.2 Functions
- Reverter commit e redeploy da função afetada.

## 8.3 Banco
- Processo de rollback transacional por migration **não está codificado em runbook único** neste repo.
- Status: **Não determinado a partir do código**.

## 9. Deploy de workers ML (DPPI/TGIS)
### 9.1 TGIS
```bash
bash scripts/setup_tgis.sh
```
Opções:
- `--setup-aitk`
- `--rebuild-aitk`

Evidência: `scripts/setup_tgis.sh:62`.

### 9.2 DPPI/TGIS systemd
- Existem scripts e unidades systemd para instalação de worker timers/services em `ml/*/deploy/systemd`.

Evidência:
- `ml/dppi/deploy/systemd/dppi-worker.service`
- `ml/tgis/deploy/systemd/tgis-worker.service`

## 10. Responsabilidades recomendadas por área
- Frontend/app shell: `src/**`
- Backend discover/dppi/tgis: `supabase/functions/discover-*`, `supabase/functions/dppi-*`, `supabase/functions/tgis-*`
- Billing/credits: `supabase/functions/commerce/index.ts`, `src/lib/commerce/**`
- Banco/migrations: `supabase/migrations/**`
- Operação scripts: `scripts/**`, `ml/**/deploy/**`
