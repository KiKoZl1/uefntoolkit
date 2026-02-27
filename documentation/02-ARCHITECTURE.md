# 02 - System Architecture

## Runtime Model

Epic Insight Engine operates on a **three-tier architecture**:

```
+-------------------------------------------------------------+
|                        CLIENT LAYER                          |
|  +--------------+  +--------------+  +--------------+      |
|  |   Public     |  |     App      |  |    Admin     |      |
|  |   (React)    |  |   (React)    |  |   (React)    |      |
|  |              |  |              |  |              |      |
|  |  • Home      |  |  • Dashboard |  |  • Overview  |      |
|  |  • Reports   |  |  • Projects  |  |  • Reports   |      |
|  |  • Island    |  |  • Lookup    |  |  • Exposure  |      |
|  +------+-------+  +------+-------+  +------+-------+      |
+---------+-----------------+-----------------+------------+
          |                 |                 |
          +-----------------+-----------------+
                            |
                            v
+-------------------------------------------------------------+
|                      BACKEND LAYER                           |
|                    (Supabase Platform)                       |
|  +--------------+  +--------------+  +--------------+     |
|  |   Auth       |  |  Database    |  |   Storage    |     |
|  |  (GoTrue)    |  | (PostgreSQL) |  |   (S3 API)   |     |
|  +------+-------+  +------+-------+  +---------------+     |
|         |                 |                                |
|         +-----------------+-----------------+             |
|                           |                 |              |
|                    +------+------+  +-------+------+       |
|                    |  PostgREST  |  | Realtime     |       |
|                    |  (REST API) |  | (WebSocket)  |       |
|                    +-------------+  +--------------+       |
|                                                            |
|  +----------------------------------------------------+   |
|  |              Edge Functions (Deno)                  |   |
|  |  • discover-collector      • ai-analyst            |   |
|  |  • discover-report-rebuild • discover-exposure-*   |   |
|  |  • discover-island-lookup  • discover-links-*        |   |
|  +----------------------------------------------------+   |
|                                                            |
|  +----------------------------------------------------+   |
|  |              pg_cron Jobs                           |   |
|  |  • Weekly report pipeline                         |   |
|  |  • Exposure data collection                       |   |
|  |  • Metadata refresh                               |   |
|  +----------------------------------------------------+   |
+-------------------------------------------------------------+
          |
          v
+-------------------------------------------------------------+
|                    AUTOMATION LAYER                          |
|  +--------------+  +--------------+  +--------------+      |
|  |    Ralph     |  |   Scripts    |  |   External   |      |
|  |   (Local)    |  |   (Node.js)  |  |     APIs     |      |
|  |              |  |              |  |              |      |
|  | • Memory     |  | • ralph_loop |  | • OpenAI     |      |
|  | • Actions    |  | • migration  |  | • NVIDIA     |      |
|  | • Incidents  |  | • export     |  | • Fortnite   |      |
|  +--------------+  +--------------+  +--------------+      |
+-------------------------------------------------------------+
```

## Component Breakdown

### 1. Frontend (React + Vite)

**Route Groups:**

| Route Group | Path Prefix | Purpose | Auth Required |
|-------------|-------------|---------|---------------|
| **Public** | `/` | Home, Discover Live, public reports, island page | No |
| **App** | `/app` | User dashboard, projects, personal reports | Yes |
| **Admin** | `/admin` | Platform management, report editing | admin/editor |

**Layout System:**

`SmartLayout` selects layout at runtime:

- Authenticated user: `AppLayout` (internal sidebar)
- Anonymous user: `PublicLayout` (top nav + footer, no public sidebar)
- Admin routes: `AdminLayout` under `AdminRoute`

**Key Frontend Components:**

| Component | Purpose |
|-----------|---------|
| `SmartLayout.tsx` | Auth-aware layout selector (`AppLayout` ou `PublicLayout`) |
| `ProtectedRoute.tsx` | Authentication guard |
| `AdminRoute.tsx` | Role-based access control |
| `LanguageSwitcher.tsx` | i18n locale switching (`en`, `pt-BR`) |
| `ZipUploader.tsx` | Bulk data upload |

### 2. Backend (Supabase)

#### Authentication
- **Provider**: Supabase Auth (GoTrue)
- **Methods**: Email/password, Google OAuth
- **Roles**: Stored in `public.user_roles` table
- **RLS**: Row Level Security policies on all tables

#### Database Architecture

**Schema Organization:**

```
public (app schema)
+-- Identity & App
|   +-- profiles
|   +-- user_roles
|   +-- projects
|   +-- uploads
|   +-- reports
|   +-- chat_messages
|
+-- Weekly Report Pipeline
|   +-- discover_reports
|   +-- discover_report_queue
|   +-- discover_report_islands
|   +-- discover_report_rebuild_runs
|   +-- weekly_reports
|
+-- Discovery Cache & Metadata
|   +-- discover_islands
|   +-- discover_islands_cache
|   +-- discover_link_metadata
|   +-- discover_link_metadata_events
|   +-- discover_link_edges
|
+-- Exposure Pipeline
|   +-- discovery_exposure_targets
|   +-- discovery_exposure_ticks
|   +-- discovery_exposure_entries_raw
|   +-- discovery_exposure_link_state
|   +-- discovery_exposure_presence_events
|   +-- discovery_exposure_presence_segments
|   +-- discovery_exposure_rank_segments
|   +-- discovery_exposure_rollup_daily
|
+-- Public Intel & Monitoring
|   +-- discovery_panel_tiers
|   +-- discovery_public_premium_now
|   +-- discovery_public_emerging_now
|   +-- discovery_public_pollution_creators_now
|   +-- system_alerts_current
|   +-- discover_lookup_pipeline_runs
|
+-- Ralph Operations & Memory
    +-- ralph_runs
    +-- ralph_actions
    +-- ralph_eval_results
    +-- ralph_incidents
    +-- ralph_memory_snapshots
    +-- ralph_memory_items
    +-- ralph_memory_decisions
    +-- ralph_memory_documents
```

### 3. Edge Functions

**Function Categories:**

#### Weekly Report Pipeline
| Function | Purpose |
|----------|---------|
| `discover-collector` | Collects island data from Fortnite API |
| `discover-report-rebuild` | Rebuilds report data from raw collection |
| `discover-report-ai` | Generates AI narratives for reports |
| `ai-analyst` | Advanced AI analysis and insights |

#### Discovery & Exposure
| Function | Purpose |
|----------|---------|
| `discover-exposure-collector` | Collects panel/surface exposure data |
| `discover-exposure-report` | Generates exposure reports |
| `discover-exposure-timeline` | Timeline visualization of exposure |
| `discover-panel-timeline` | Panel timeline + panel intelligence payload |
| `discover-panel-intel-refresh` | Refreshes panel intelligence |

#### Metadata & Links
| Function | Purpose |
|----------|---------|
| `discover-links-metadata-collector` | Collects link metadata |
| `discover-rails-resolver` | Resolves link relationships |
| `discover-enqueue-gap` | Handles data gap filling |

#### Island Lookup
| Function | Purpose |
|----------|---------|
| `discover-island-lookup` | Basic island information lookup |
| `discover-island-lookup-ai` | AI-enhanced island lookup |
| `discover-island-page` | Full island page data |

### 4. Ralph AI System

**Local Automation Runner:**

```
+-------------------------------------+
|         Ralph Local Runner          |
|     (scripts/ralph_local_runner.mjs)|
+-----------------+-----------------+
                  |
    +-------------+-------------+
    v             v             v
+-------+   +---------+   +---------+
| Memory |   | Actions |   |Incidents|
| System |   | Engine  |   | Handler |
+---+---+   +----+----+   +----+----+
    |            |             |
    v            v             v
+-------------------------------------+
|      Supabase (ralph_* tables)       |
+-------------------------------------+
```

## Data Flow Patterns

### Pattern 1: Weekly Report Generation

```
+---------+    +-------------+    +-------------+    +---------+
|  Cron   |--->|  discover-  |--->|  discover-  |--->|  AI     |
| Trigger |    |  collector  |    |  report-    |    | Narrative|
+---------+    +-------------+    |  rebuild     |    +---------+
                                  +-------------+
                                         |
                                         v
                                  +-------------+
                                  |  weekly_    |
                                  |  reports    |
                                  +-------------+
```

### Pattern 2: Island Lookup

```
+---------+    +-------------+    +-------------+    +---------+
|  User   |--->|  Frontend   |--->|  discover-  |--->|  Cache  |
| Request |    |   (React)    |    |island-lookup|    |  Check  |
+---------+    +-------------+    +-------------+    +----+----+
                                                          |
                                    +---------------------+
                                    v
                            +-------------+
                            |  Fortnite   |
                            |    API      |
                            +-------------+
```

### Pattern 3: Exposure Tracking

```
+---------+    +-------------+    +-------------+    +---------+
|  Cron   |--->|  discover-  |--->|  Raw Data   |--->|  Rollup |
| Trigger |    |exposure-collector|  |  Storage    |    |  Daily  |
+---------+    +-------------+    +-------------+    +---------+
```

## Security Model

### Authentication Flow

```
+---------+    +-------------+    +-------------+    +---------+
|  User   |--->|  Supabase   |--->|   JWT       |--->|  Access |
| Login   |    |   Auth      |    |  Token      |    | Granted |
+---------+    +-------------+    +-------------+    +---------+
                              |
                              v
                       +-------------+
                       |  user_roles |
                       |  (RBAC)     |
                       +-------------+
```

### Row Level Security (RLS)

All tables have RLS enabled with policies based on:
- **Authentication status** (is_authenticated())
- **User roles** (user_roles table)
- **Ownership** (created_by, user_id fields)
- **Public access** (for public-facing data)

### Role Permissions

| Role | Public | App | Admin | API Access |
|------|--------|-----|-------|------------|
| `admin` | ✅ | ✅ | ✅ | Full |
| `editor` | ✅ | ✅ | Limited | Limited |
| `client` | ✅ | ✅ | ❌ | Own data only |

## Configuration Management

### Environment Variables

| Variable | Purpose | Location |
|----------|---------|----------|
| `VITE_SUPABASE_URL` | Frontend Supabase connection | `.env` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend auth key | `.env` |
| `SUPABASE_URL` | Backend/Script connection | `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged operations | `.env` |
| `OPENAI_API_KEY` | AI narrative generation | `.env` |
| `NVIDIA_API_KEY` | Alternative AI provider | `.env` |

### Feature Flags

Features can be toggled via:
- Environment variables
- Database configuration tables
- Runtime context from Ralph

## Operational Notes

1. **Source of Truth**:
   - Schema: `supabase/migrations/`
   - Pipelines: Edge Functions + pg_cron
   - Historical: `docs/archive/` (read-only)

2. **Data Retention**:
   - Raw exposure data: 3 hours (configurable)
   - Rollup data: Indefinite
   - Island page cache: cleanup after 3 days without access
   - Ralph memory: Managed by cleanup jobs

3. **Scaling Considerations**:
   - Edge Functions: Stateless, auto-scaling
   - Database: Connection pooling via Supabase
   - Frontend: Static hosting, CDN-ready

---

**Next**: Read [03-FRONTEND.md](./03-FRONTEND.md) for detailed frontend documentation.


