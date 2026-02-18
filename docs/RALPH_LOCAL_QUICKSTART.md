# Ralph Local Quickstart

Use this to test Ralph locally before any deploy.

## 1) Prerequisites

Set environment variables in PowerShell:

```powershell
$env:SUPABASE_URL="https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
```

Runner also loads a local `.env` file automatically when variables are not present in the shell.

Optional for LLM mode:

```powershell
$env:OPENAI_API_KEY="<openai-key>"
# or
$env:ANTHROPIC_API_KEY="<anthropic-key>"
```

## 2) Ensure DB foundation exists

Apply migration:

`supabase/migrations/20260216123000_ralph_ops_foundation.sql`

Without this migration, runner RPC calls will fail.

## 3) Run dry mode (no LLM cost)

```powershell
scripts\run-ralph-local-runner.bat --mode=qa --dry-run=true --scope=csv,lookup --max-iterations=3
```

Expected:
- creates one row in `ralph_runs`
- creates action/eval rows
- finishes with `completed`
- writes local summary under `scripts/_out/ralph_local_runner/run_*/ralph_local_runner_summary.json`

## 4) Run with LLM (real loop)

OpenAI:

```powershell
scripts\run-ralph-local-runner.bat --mode=qa --dry-run=false --llm-provider=openai --llm-model=gpt-4.1-mini --scope=csv,lookup --max-iterations=3
```

Anthropic:

```powershell
scripts\run-ralph-local-runner.bat --mode=qa --dry-run=false --llm-provider=anthropic --llm-model=claude-3-5-sonnet-latest --scope=csv,lookup --max-iterations=3
```

## 4.1) Enable site/platform edits (safe modes)

Propose edit operations only (no code changes applied):

```powershell
scripts\run-ralph-local-runner.bat --mode=dev --dry-run=false --llm-provider=openai --llm-model=gpt-4.1-mini --scope=csv,lookup --max-iterations=2 --edit-mode=propose --edit-max-files=2 --edit-allowlist=src/,index.html,docs/
```

Apply edit operations automatically (requires non-main branch by default):

```powershell
git checkout -b feat/ralph-autofix-test
scripts\run-ralph-local-runner.bat --mode=dev --dry-run=false --llm-provider=openai --llm-model=gpt-4.1-mini --scope=csv,lookup --max-iterations=2 --edit-mode=apply --edit-max-files=2 --edit-allowlist=src/,index.html,docs/ --gate-build=true --gate-test=true
```

Use a dedicated prompt file:

```powershell
scripts\run-ralph-local-runner.bat --mode=dev --dry-run=false --llm-provider=openai --llm-model=gpt-4.1-mini --scope=csv,lookup --max-iterations=2 --edit-mode=apply --edit-max-files=2 --edit-allowlist=src/,index.html,docs/ --prompt-file=docs/RALPH_SITE_IMPROVEMENT_PROMPT.md --gate-build=true --gate-test=true
```

Notes:
- `--edit-mode=apply` is blocked on `main/master` unless `--require-non-main-branch=false`.
- Proposed operations are saved under `scripts/_out/ralph_local_runner/run_*/patches/*_ops.json`.
- Scope control is enforced by allowlist and max touched files.
- In `--edit-mode=apply`, if zero operations are applied, run status is `failed`.

## 5) Optional quality gates

Enable build/test gates:

```powershell
scripts\run-ralph-local-runner.bat --mode=dev --dry-run=true --gate-build=true --gate-test=true
```

Note: existing project build/test failures will mark run as `failed`.

Lint gate is also available:

```powershell
scripts\run-ralph-local-runner.bat --mode=dev --dry-run=true --gate-lint=true
```

## 6) Useful checks

```sql
select * from public.ralph_runs order by started_at desc limit 5;
select * from public.ralph_actions order by created_at desc limit 20;
select * from public.ralph_eval_results order by created_at desc limit 20;
select public.get_ralph_health(24);
```

Memory context checks:

```sql
select * from public.ralph_memory_snapshots order by created_at desc limit 10;
select * from public.ralph_memory_items order by importance desc, last_seen_at desc limit 20;
select public.get_ralph_context_pack(array['csv','lookup'], 72, 20);
```

## 7) Recommended first validation

1. Run dry mode with 3 iterations.
2. Verify rows + health JSON.
3. Run one LLM mode run with 1-2 iterations.
4. Decide if worth deploying orchestrator via Lovable.

## 8) Autonomous loop (60 minutes / every 5 minutes)

```powershell
git checkout -b feat/ralph-loop-60m
scripts\run-ralph-loop.bat -Mode dev -DurationMinutes 60 -IntervalSeconds 300 -MaxIterations 2 -EditMode apply -EditMaxFiles 2 -EditAllowlist "src/,index.html,docs/" -LlmProvider openai -LlmModel gpt-4.1-mini -Scope "csv,lookup" -PromptFile "docs/RALPH_SITE_IMPROVEMENT_PROMPT.md"
```

The loop writes a consolidated summary in:
- `scripts/_out/ralph_loop/run_*/ralph_loop_summary.json`
