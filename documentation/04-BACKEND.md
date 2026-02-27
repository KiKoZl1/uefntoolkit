# 04 - Backend Documentation

## Overview

The Epic Insight Engine backend is built on **Supabase**, a Backend-as-a-Service platform providing PostgreSQL database, authentication, Edge Functions, and real-time capabilities.

## Backend Architecture

```
+-------------------------------------------------------------+
|                    SUPABASE PLATFORM                         |
|                                                              |
|  +--------------+  +--------------+  +--------------+       |
|  |  PostgreSQL  |  |    Auth      |  |   Storage    |       |
|  |  Database    |  |  (GoTrue)    |  |   (S3 API)   |       |
|  |              |  |              |  |              |       |
|  | • Tables     |  | • Email/Pass |  | • Buckets    |       |
|  | • RLS        |  | • OAuth      |  | • Files      |       |
|  | • RPCs       |  | • JWT        |  | • CDN        |       |
|  +------+-------+  +-------------+  +--------------+       |
|         |                                                    |
|         +-----------------+-----------------+                 |
|                           |                 |                |
|                    +------+------+  +------+------+         |
|                    |  PostgREST  |  |  Realtime   |         |
|                    |  REST API   |  |  WebSocket  |         |
|                    +-------------+  +-------------+         |
|                                                              |
|  +----------------------------------------------------+    |
|  |              Edge Functions (Deno)                  |    |
|  |  • discover-collector      • ai-analyst            |    |
|  |  • discover-report-rebuild • discover-exposure-*   |    |
|  |  • discover-island-lookup  • discover-links-*      |    |
|  +----------------------------------------------------+    |
|                                                              |
|  +----------------------------------------------------+    |
|  |              pg_cron Jobs                           |    |
|  |  • Weekly report pipeline                           |    |
|  |  • Exposure data collection                         |    |
|  |  • Metadata refresh                                 |    |
|  +----------------------------------------------------+    |
|                                                              |
+-------------------------------------------------------------+
```

## Database Schema

### Schema Organization

The database is organized into logical domains:

```
public (app schema)
+-- Identity & App
+-- Weekly Report Pipeline
+-- Discovery Cache & Metadata
+-- Exposure Pipeline
+-- Public Intel & Monitoring
+-- Ralph Operations & Memory
```

### Table Domains

#### 1. Identity and App

| Table | Purpose |
|-------|---------|
| `profiles` | User profile information |
| `user_roles` | Role-based access control (admin, editor, client) |
| `projects` | User projects |
| `uploads` | File upload records |
| `reports` | User-generated reports |
| `chat_messages` | In-app chat messages |

#### 2. Weekly Report Pipeline

| Table | Purpose |
|-------|---------|
| `discover_reports` | Weekly discovery reports |
| `discover_report_queue` | Processing queue for reports |
| `discover_report_islands` | Island data per report |
| `discover_report_rebuild_runs` | Pipeline execution logs |
| `weekly_reports` | Public-facing reports with AI narratives |

#### 3. Discovery Cache and Metadata

| Table | Purpose |
|-------|---------|
| `discover_islands` | Island catalog |
| `discover_islands_cache` | Cached island metadata |
| `discover_link_metadata` | Link metadata for islands |
| `discover_link_metadata_events` | Metadata change events |
| `discover_link_edges` | Island relationship graph |
| `discover_island_page_cache` | Public island page hot cache (cache-first, access-based) |

#### 4. Exposure Pipeline

| Table | Purpose |
|-------|---------|
| `discovery_exposure_targets` | Islands to track |
| `discovery_exposure_ticks` | Collection time windows |
| `discovery_exposure_entries_raw` | Raw exposure snapshots |
| `discovery_exposure_link_state` | Link state tracking |
| `discovery_exposure_presence_events` | Presence change events |
| `discovery_exposure_presence_segments` | Time-based presence |
| `discovery_exposure_rank_segments` | Rank distributions |
| `discovery_exposure_rollup_daily` | Daily summaries |

#### 5. Public Intel and Monitoring

| Table | Purpose |
|-------|---------|
| `discovery_panel_tiers` | Panel tier history |
| `discovery_public_premium_now` | Premium islands |
| `discovery_public_emerging_now` | Rising stars |
| `discovery_public_pollution_creators_now` | Quality concerns |
| `system_alerts_current` | Active system alerts |
| `discover_lookup_pipeline_runs` | Lookup pipeline logs |
| `discovery_panel_intel_snapshot` | Panel intelligence snapshot used by timeline modal |

#### 6. Ralph Operations and Memory

| Table | Purpose |
|-------|---------|
| `ralph_runs` | Ralph execution runs |
| `ralph_actions` | Action execution logs |
| `ralph_eval_results` | Evaluation results |
| `ralph_incidents` | Incident tracking |
| `ralph_memory_snapshots` | System state snapshots |
| `ralph_memory_items` | Key-value memory |
| `ralph_memory_decisions` | Decision history |
| `ralph_memory_documents` | Document embeddings |

## Row Level Security (RLS)

### Security Model

All application tables have RLS enabled. Access is controlled through policies based on:

1. **Authentication status** - `auth.role() = 'authenticated'`
2. **User roles** - `user_roles` table
3. **Ownership** - `user_id` or `created_by` fields
4. **Public access** - For public-facing data

### Example Policies

```sql
-- Users can only see their own profile
CREATE POLICY "Users can view own profile"
ON profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

-- Admins can see all reports
CREATE POLICY "Admins can view all reports"
ON discover_reports
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
  )
);

-- Public can view published weekly reports
CREATE POLICY "Public can view published reports"
ON weekly_reports
FOR SELECT
TO anon
USING (published = true);
```

## Edge Functions

### Function Categories

#### Weekly Report Pipeline

| Function | Purpose | Trigger |
|----------|---------|---------|
| `discover-collector` | Collect island/report data from Fortnite API | Cron (`discover-collector-orchestrate-minute` + Weekly kickoff) |
| `discover-report-rebuild` | Process raw data into reports | Internally orchestrated (on-demand) |
| `discover-report-ai` | Generate AI narratives | Internally orchestrated (on-demand) |
| `ai-analyst` | Advanced AI analysis | On-demand |

#### Discovery & Exposure

| Function | Purpose | Trigger |
|----------|---------|---------|
| `discover-exposure-collector` | Collect panel visibility | Cron orchestrator every minute |
| `discover-exposure-report` | Generate exposure reports | On-demand |
| `discover-exposure-timeline` | Timeline visualization | On-demand |
| `discover-panel-timeline` | Panel composition history + panel intel payload | On-demand |
| `discover-panel-intel-refresh` | Refresh panel intelligence snapshots | Cron every 10 minutes |

#### Metadata & Links

| Function | Purpose | Trigger |
|----------|---------|---------|
| `discover-links-metadata-collector` | Collect island metadata | Cron orchestrator every minute |
| `discover-rails-resolver` | Resolve link relationships | On-demand |
| `discover-enqueue-gap` | Queue missing data backfill | On-demand |

#### Island Lookup

| Function | Purpose | Trigger |
|----------|---------|---------|
| `discover-island-lookup` | Basic island lookup | On-demand (API) |
| `discover-island-lookup-ai` | AI-enhanced lookup | On-demand |
| `discover-island-page` | Full island page data | On-demand |

### Function Structure

```typescript
// supabase/functions/discover-collector/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  // CORS handling
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Business logic
    const data = await collectIslandData();
    
    // Store results
    const { error } = await supabase
      .from('discover_report_islands')
      .insert(data);

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, count: data.length }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
```

## RPC Functions

### Report Pipeline RPCs

| RPC | Purpose |
|-----|---------|
| `claim_report_queue_item` | Claim item for processing |
| `apply_report_queue_item` | Mark item as processed |
| `requeue_report_item` | Return item to queue |
| `report_finalize_weekly` | Complete weekly report |
| `report_rebuild_coverage` | Check rebuild coverage |

### Exposure Pipeline RPCs

| RPC | Purpose |
|-----|---------|
| `claim_exposure_tick` | Claim tick for collection |
| `apply_exposure_tick` | Mark tick as collected |
| `exposure_rollup_daily` | Generate daily rollup |
| `exposure_maintenance_cleanup` | Clean old data |

### Metadata RPCs

| RPC | Purpose |
|-----|---------|
| `metadata_enqueue` | Queue metadata refresh |
| `metadata_claim` | Claim metadata job |
| `link_graph_stats` | Get link statistics |
| `link_cleanup_orphans` | Remove orphaned links |

### Admin RPCs

| RPC | Purpose |
|-----|---------|
| `compute_system_alerts` | Generate system alerts |
| `admin_enable_discover_cron` | Enable cron jobs |
| `admin_disable_discover_cron` | Disable cron jobs |
| `lookup_stats` | Get lookup statistics |

### Ralph RPCs

| RPC | Purpose |
|-----|---------|
| `start_ralph_run` | Begin Ralph execution |
| `finish_ralph_run` | Complete Ralph run |
| `record_ralph_action` | Log Ralph action |
| `record_ralph_eval` | Store evaluation |
| `raise_ralph_incident` | Create incident |
| `resolve_ralph_incident` | Resolve incident |
| `get_ralph_health` | Get health status |
| `get_ralph_memory_context` | Retrieve memory |

## Cron Jobs

### Current production jobs (source: migrations)

| Job name | Schedule | Target |
|---|---|---|
| `discover-collector-orchestrate-minute` | `* * * * *` | `discover-collector` (`mode=orchestrate`) |
| `discover-collector-weekly-v2` | `0 6 * * 1` | `discover-collector` (`mode=start`) |
| `discover-links-metadata-orchestrate-minute` | `* * * * *` | `discover-links-metadata-collector` (`mode=orchestrate`) |
| `discover-exposure-collector-orchestrate-minute` | `* * * * *` | `discover-exposure-collector` (`mode=orchestrate`) |
| `discover-exposure-maintenance-daily` | `7 0 * * *` | `discover-exposure-collector` (`mode=maintenance`, with rollup) |
| `discover-exposure-raw-cleanup-hourly` | `5 * * * *` | `discover-exposure-collector` (`mode=maintenance`, raw cleanup) |
| `discover-island-page-cache-refresh-5min` | `*/5 * * * *` | `discover-island-page` (`mode=refresh_cache`) |
| `discover-island-page-cache-cleanup-hourly` | `0 * * * *` | SQL cleanup (`last_accessed_at < now()-3 days`) |
| `discover-panel-intel-refresh-10min` | `*/10 * * * *` | `discover-panel-intel-refresh` |

All cron calls that mutate data use service-role authorization.


## Authentication

### Auth Providers

| Provider | Status | Configuration |
|----------|--------|---------------|
| Email/Password | ✅ Enabled | Default |
| Google OAuth | ✅ Optional | Client ID + Secret |
| GitHub OAuth | ❌ Disabled | - |
| Magic Link | ❌ Disabled | - |

### JWT Structure

```json
{
  "aud": "authenticated",
  "exp": 1234567890,
  "sub": "user-uuid",
  "email": "user@example.com",
  "role": "authenticated",
  "user_metadata": {
    "full_name": "User Name"
  }
}
```

### Role-Based Access

Roles stored in `user_roles` table:

| Role | Permissions |
|------|-------------|
| `admin` | Full access to all features |
| `editor` | Create/edit reports, admin features |
| `client` | Personal dashboard, owned projects |

Role check in RLS:
```sql
CREATE FUNCTION is_admin(user_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = user_uuid 
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Storage

### Buckets

| Bucket | Purpose | Public Access |
|--------|---------|---------------|
| `uploads` | User file uploads | No |
| `reports` | Generated report assets | Yes |
| `avatars` | User profile images | Yes |

### RLS Policies for Storage

```sql
-- Users can upload to their own folder
CREATE POLICY "Users can upload own files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'uploads' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
```

## Realtime

### Channels

| Channel | Events | Purpose |
|---------|--------|---------|
| `discover_reports` | INSERT, UPDATE | Live report updates |
| `chat_messages` | INSERT | Real-time chat |
| `system_alerts` | INSERT, UPDATE | Alert notifications |

### Subscription Example

```typescript
const channel = supabase
  .channel('discover_reports')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'discover_reports' },
    (payload) => {
      console.log('New report:', payload.new);
    }
  )
  .subscribe();
```

## Database Migrations

### Migration Files

Located in `supabase/migrations/` with naming convention:
```
YYYYMMDDHHMMSS_description.sql
```

Example: `20260215120000_add_island_index.sql`

### Migration Rules

1. **Never edit existing migrations** - Create new ones
2. **Use transactions** - Wrap in `BEGIN; ... COMMIT;`
3. **Make migrations idempotent** - Use `IF NOT EXISTS`
4. **Test locally** - Run `supabase db push` before committing

### Creating Migrations

```bash
# Create new migration
supabase migration new add_user_preferences

# Apply to local database
supabase db push

# Apply to production
supabase db push --linked
```

## Performance Optimization

### Indexes

```sql
-- Common query patterns
CREATE INDEX idx_islands_code ON discover_islands(code);
CREATE INDEX idx_reports_week ON discover_reports(week_start DESC);
CREATE INDEX idx_exposure_time ON discovery_exposure_entries_raw(created_at);

-- Composite indexes
CREATE INDEX idx_islands_creator_code ON discover_islands(creator, code);

-- Partial indexes
CREATE INDEX idx_active_islands ON discover_islands(code) 
WHERE status = 'active';
```

### Query Optimization

1. **Use EXPLAIN ANALYZE** - Check query plans
2. **Limit large results** - Use pagination
3. **Select specific columns** - Avoid `SELECT *`
4. **Use appropriate joins** - Prefer joins over subqueries

## Backup & Recovery

### Automatic Backups

Supabase provides:
- Daily backups (7-day retention on free tier)
- Point-in-time recovery (paid tiers)

### Manual Backup

```bash
# Dump database
supabase db dump --file backup.sql

# Restore from backup
supabase db restore --file backup.sql
```

## Monitoring

### Database Metrics

Monitor in Supabase Dashboard:
- Connection count
- Query performance
- Storage usage
- API requests

### Alerting

Set up alerts for:
- High connection count
- Slow queries
- Storage approaching limit
- Failed Edge Function invocations

## Security Best Practices

1. **Enable RLS** on all tables
2. **Use service role key** only in Edge Functions
3. **Validate input** in Edge Functions
4. **Rate limit** API endpoints
5. **Audit logs** for sensitive operations
6. **Rotate keys** regularly
7. **Review policies** periodically

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| RLS blocking query | Check policies, use `auth.uid()` |
| Function timeout | Increase timeout, optimize code |
| Connection limit | Use connection pooling |
| Migration fails | Check for conflicts, run manually |
| Realtime not working | Check channel permissions |

### Debug Queries

```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity;

-- Find slow queries
SELECT query, mean_exec_time 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;

-- Check RLS policies
SELECT schemaname, tablename, policyname 
FROM pg_policies;
```

---

**Next**: Read [05-DATA-PIPELINES.md](./05-DATA-PIPELINES.md) for pipeline documentation.



