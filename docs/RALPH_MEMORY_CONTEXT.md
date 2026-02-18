# Ralph Memory Context

This document describes the first memory layer for Ralph and how it feeds future LLM V2 context.

## What was added

- `public.ralph_memory_snapshots`
  - periodic operational snapshots (exposure, metadata, alerts, report freshness).
- `public.ralph_memory_items`
  - durable memory entries keyed by `memory_key` with evidence and importance.
- `public.ralph_memory_decisions`
  - optional decision log linked to `ralph_runs`.

## New RPCs

- `public.upsert_ralph_memory_item(...)`
  - upsert/refresh one memory fact with evidence.
- `public.compute_ralph_memory_snapshot(...)`
  - computes a fresh snapshot and persists it (with min-interval guard).
- `public.get_ralph_context_pack(...)`
  - returns one context payload for Ralph/LLM use:
    - `latest_snapshot`
    - `recent_snapshots`
    - `memory_items` (active/watch)
    - `open_alerts`
    - `latest_reports`
    - `health_24h`

## Runtime integrations

- `discover-exposure-collector` (mode `orchestrate`) now piggybacks:
  - `compute_system_alerts()`
  - `compute_ralph_memory_snapshot(...)` (best-effort, 10 min cadence).
- `scripts/ralph_local_runner.mjs` now:
  - fetches `get_ralph_context_pack(...)` before planning,
  - injects context summary in plan/ops prompts,
  - writes a forced runner snapshot on completion (best-effort).

## Quick verification

```sql
select * from public.ralph_memory_snapshots order by created_at desc limit 10;
select * from public.ralph_memory_items order by importance desc, last_seen_at desc limit 20;
select public.get_ralph_context_pack(array['csv','lookup'], 72, 20);
```

## Why this matters

This is the bridge between:

1. Ralph as a platform-improvement operator.
2. Ralph as data specialist with durable operational memory.
3. LLM V2 consuming a structured `context pack` instead of ad-hoc prompts.
