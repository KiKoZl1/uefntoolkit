# Database Schema

This document details the database schema for Epic Insight Engine.

## Overview

The database is built on Supabase with PostgreSQL. It uses Row Level Security (RLS) for access control and includes role-based permissions.

## Tables

### discover_reports

Weekly discovery reports containing metadata and computed metrics.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `week_start` | DATE | Start date of the week |
| `week_end` | DATE | End date of the week |
| `week_number` | INTEGER | ISO week number |
| `year` | INTEGER | Year |
| `status` | TEXT | Report status |
| `phase` | TEXT | Collection phase |
| `estimated_total` | INTEGER | Estimated island count |
| `catalog_cursor` | TEXT | Pagination cursor |
| `catalog_discovered_count` | INTEGER | Islands discovered |
| `catalog_done` | BOOLEAN | Catalog phase complete |
| `queue_total` | INTEGER | Total queue items |
| `metrics_done_count` | INTEGER | Metrics collected count |
| `reported_count` | INTEGER | Reported islands count |
| `suppressed_count` | INTEGER | Suppressed islands count |
| `error_count` | INTEGER | Error count |
| `progress_pct` | INTEGER | Progress percentage |
| `platform_kpis` | JSONB | Platform-wide KPIs |
| `computed_rankings` | JSONB | Pre-computed rankings |
| `ai_narratives` | JSONB | AI-generated content |
| `island_count` | INTEGER | Total islands |
| `started_at` | TIMESTAMPTZ | Collection start time |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update |

### discover_report_islands

Individual island data for each report.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `report_id` | UUID | FK to discover_reports |
| `island_code` | TEXT | Fortnite island code |
| `title` | TEXT | Island name |
| `creator_code` | TEXT | Creator identifier |
| `category` | TEXT | Island category |
| `tags` | TEXT[] | Island tags |
| `created_in` | TEXT | Island creation metadata |
| `status` | TEXT | Status (pending/reported/suppressed) |
| `probe_unique` | INTEGER | Yesterday's unique players |
| `probe_plays` | INTEGER | Yesterday's plays |
| `probe_minutes` | INTEGER | Yesterday's minutes |
| `probe_peak_ccu` | INTEGER | Yesterday's peak CCU |
| `probe_date` | DATE | Probe date |
| `week_unique` | INTEGER | Week's unique players |
| `week_plays` | INTEGER | Week's total plays |
| `week_minutes` | INTEGER | Week's total minutes |
| `week_minutes_per_player_avg` | FLOAT | Average minutes per player |
| `week_peak_ccu_max` | INTEGER | Week's peak CCU |
| `week_favorites` | INTEGER | Week's favorites |
| `week_recommends` | INTEGER | Week's recommendations |
| `week_d1_avg` | FLOAT | Day 1 retention avg |
| `week_d7_avg` | FLOAT | Day 7 retention avg |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

### discover_report_queue

Processing queue for islands.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `report_id` | UUID | FK to discover_reports |
| `island_code` | TEXT | Fortnite island code |
| `priority` | INTEGER | Processing priority |
| `status` | TEXT | Queue status |
| `locked_at` | TIMESTAMPTZ | Lock timestamp |
| `last_error` | TEXT | Last error message |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

### discover_islands_cache

Cached island metadata for performance.

| Column | Type | Description |
|--------|------|-------------|
| `island_code` | TEXT | Primary key |
| `title` | TEXT | Island name |
| `creator_code` | TEXT | Creator identifier |
| `category` | TEXT | Island category |
| `tags` | TEXT[] | Island tags |
| `created_in` | TEXT | Creation metadata |
| `first_seen_at` | TIMESTAMPTZ | First seen timestamp |
| `last_seen_at` | TIMESTAMPTZ | Last seen timestamp |
| `last_status` | TEXT | Last status |
| `last_report_id` | UUID | Last report reference |
| `last_reported_at` | TIMESTAMPTZ | Last reported timestamp |
| `last_suppressed_at` | TIMESTAMPTZ | Last suppressed timestamp |
| `suppressed_streak` | INTEGER | Consecutive suppressed count |
| `reported_streak` | INTEGER | Consecutive reported count |
| `last_week_unique` | INTEGER | Last week's unique players |
| `last_week_plays` | INTEGER | Last week's plays |
| `last_week_minutes` | INTEGER | Last week's minutes |
| `last_week_peak_ccu` | INTEGER | Last week's peak CCU |
| `last_week_favorites` | INTEGER | Last week's favorites |
| `last_week_recommends` | INTEGER | Last week's recommendations |
| `last_week_d1_avg` | FLOAT | Last week's D1 retention |
| `last_week_d7_avg` | FLOAT | Last week's D7 retention |
| `last_week_minutes_per_player_avg` | FLOAT | Last week's avg minutes |
| `updated_at` | TIMESTAMPTZ | Last update |

### discover_islands

Master island list.

| Column | Type | Description |
|--------|------|-------------|
| `island_code` | TEXT | Primary key |
| `title` | TEXT | Island name |
| `creator_code` | TEXT | Creator identifier |
| `category` | TEXT | Island category |
| `tags` | TEXT[] | Island tags |
| `created_in` | TEXT | Creation metadata |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

### weekly_reports

CMS table for public reports.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `discover_report_id` | UUID | FK to discover_reports |
| `week_key` | TEXT | Week identifier |
| `date_from` | DATE | Week start |
| `date_to` | DATE | Week end |
| `status` | TEXT | Report status |
| `public_slug` | TEXT | Public URL slug (unique) |
| `title_public` | TEXT | Public title |
| `subtitle_public` | TEXT | Public subtitle |
| `editor_note` | TEXT | Editor note |
| `kpis_json` | JSONB | KPIs |
| `rankings_json` | JSONB | Rankings |
| `sections_json` | JSONB | Custom sections |
| `ai_sections_json` | JSONB | AI sections |
| `editor_sections_json` | JSONB | Editor sections |
| `published_at` | TIMESTAMPTZ | Publication timestamp |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update |

### user_roles

Role assignments for users.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK to auth.users |
| `role` | APP_ROLE | Role (admin/editor/client) |

## Enums

### app_role

```sql
CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'client');
```

## Functions

### has_role(user_id, role)

Checks if a user has a specific role.

```sql
SELECT * FROM has_role('user-uuid', 'admin');
```

## Row Level Security

### Policies

| Table | Policy | Condition |
|-------|--------|-----------|
| `user_roles` | Users can view own roles | auth.uid() = user_id |
| `user_roles` | Admins can manage roles | has_role('admin') |
| `weekly_reports` | Anyone can view published | status = 'published' |
| `weekly_reports` | Admins/editors can view all | has_role('admin'/'editor') |
| `discover_reports` | Service role full access | auth.role = 'service_role' |

## Indexes

Key indexes for performance:

- `discover_report_islands.report_id`
- `discover_report_islands.island_code`
- `discover_report_queue.report_id`
- `discover_report_queue.status`
- `discover_islands_cache.island_code`
- `weekly_reports.public_slug`
- `user_roles.user_id`

