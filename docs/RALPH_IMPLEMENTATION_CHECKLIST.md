# Ralph Implementation Checklist (Deploy by Lovable)

## Scope
This checklist is the implementation baseline to enable Ralph operations safely.

## Database
- [ ] Apply migration: `supabase/migrations/20260216123000_ralph_ops_foundation.sql`
- [ ] Apply migration: `supabase/migrations/20260218154000_ralph_memory_context.sql`
- [ ] Confirm tables exist:
  - [ ] `public.ralph_runs`
  - [ ] `public.ralph_actions`
  - [ ] `public.ralph_eval_results`
  - [ ] `public.ralph_incidents`
- [ ] Confirm RPCs exist and execute:
  - [ ] `start_ralph_run`
  - [ ] `finish_ralph_run`
  - [ ] `record_ralph_action`
  - [ ] `record_ralph_eval`
  - [ ] `raise_ralph_incident`
  - [ ] `resolve_ralph_incident`
  - [ ] `get_ralph_health`

## Policy / Access
- [ ] `service_role` has write access to Ralph tables.
- [ ] `authenticated` (admin/editor) can read run telemetry.

## App / Ops Docs
- [ ] `docs/RALPH_OPERATING_MODEL.md`
- [ ] `docs/RALPH_GATES_AND_SLO.md`
- [ ] `docs/RALPH_RUNBOOKS.md`
- [ ] `docs/RALPH_BRANCH_STRATEGY_MAIN_ONLY.md`

## Branch Strategy
- [ ] No direct commit to `main` for Ralph loops.
- [ ] Use short-lived branch per run scope.
- [ ] PR + gate checks before merge.

## Go-Live (Shadow Mode)
- [ ] Start in non-promoting mode.
- [ ] Run at least 10 shadow runs.
- [ ] Validate fail/rollback behavior.
- [ ] Promote only after stable gate pass rate.

## Suggested First SQL Smoke
```sql
select public.start_ralph_run(
  p_mode := 'qa',
  p_target_scope := array['csv','lookup'],
  p_summary := '{"source":"manual_smoke"}'::jsonb
) as run_id;
```

```sql
select public.get_ralph_health(24);
```

```sql
-- replace with real run_id
select public.finish_ralph_run(
  p_run_id := '00000000-0000-0000-0000-000000000000'::uuid,
  p_status := 'completed',
  p_summary := '{"smoke":"ok"}'::jsonb
);
```
