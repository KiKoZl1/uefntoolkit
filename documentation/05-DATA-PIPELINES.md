# 05 - Data Pipelines

## Overview

Epic Insight Engine operates multiple automated data pipelines that collect, process, and analyze Fortnite UGC data. These pipelines run on Supabase Edge Functions orchestrated by pg_cron jobs.

## Pipeline Architecture

```
+-------------------------------------------------------------+
|                     PIPELINE ORCHESTRATOR                    |
|                        (pg_cron)                             |
+-------------------------------------------------------------+
                              |
        +---------------------+---------------------+
        v                     v                     v
+--------------+    +--------------+    +--------------+
|   WEEKLY     |    |   EXPOSURE   |    |   METADATA   |
|   REPORT     |    |   TRACKING   |    |   REFRESH    |
|   PIPELINE   |    |   PIPELINE   |    |   PIPELINE   |
+------+-------+    +------+-------+    +------+-------+
       |                   |                   |
       v                   v                   v
+--------------+    +--------------+    +--------------+
| discover-    |    | discover-    |    | discover-    |
| collector    |    | exposure-    |    | links-       |
|              |    | collector    |    | metadata-    |
+------+-------+    +--------------+    | collector    |
       |                                 +--------------+
       v
+--------------+
| discover-    |
| report-      |
| rebuild      |
+------+-------+
       |
       v
+--------------+
| discover-    |
| report-ai    |
| ai-analyst   |
+--------------+
```

## 1. Weekly Report Pipeline

### Purpose
Generates comprehensive weekly discovery reports with AI-powered narratives analyzing trending islands, creators, and game modes.

### Pipeline Flow

```
+---------+    +-------------+    +-------------+    +---------+
|  Cron   |--->|  discover-  |--->|  discover-  |--->|  AI     |
| (Sun 0:00)   |  collector  |    |  report-    |    | Narrative|
+---------+    |             |    |  rebuild    |    +---------+
               +-------------+    +-------------+
                                          |
                                          v
                                   +-------------+
                                   |  weekly_    |
                                   |  reports    |
                                   |  (public)   |
                                   +-------------+
```

### Components

#### Step 1: Data Collection (`discover-collector`)

**Function**: `supabase/functions/discover-collector/`

**Purpose**: Collects raw island data from Fortnite API

**Process**:
1. Fetches island catalog from `api.fortnite.com/ecosystem/v1`
2. Retrieves detailed metrics for each island
3. Stores raw data in `discover_report_islands` (temporary)
4. Populates `discover_islands_cache` for quick lookups

**Key Metrics Collected**:
- Island code and name
- Creator information
- Game mode/category
- Play counts (total, unique players)
- Minutes played
- Peak concurrent users (CCU)
- Retention rates
- Rating and review counts

**Output Tables**:
- `discover_report_islands` - Raw collection data
- `discover_islands_cache` - Cached island metadata

#### Step 2: Report Rebuild (`discover-report-rebuild`)

**Function**: `supabase/functions/discover-report-rebuild/`

**Purpose**: Processes raw data into structured report format

**Process**:
1. Reads from `discover_report_islands`
2. Calculates trends and comparisons (week-over-week)
3. Identifies top movers (gainers/losers)
4. Generates category breakdowns
5. Creates distribution charts data
6. Stores processed data in `discover_reports`

**Calculations**:
- Trend direction (up/down/flat)
- Percentage change from previous week
- Category rankings
- Creator performance scores

**Output Tables**:
- `discover_reports` - Processed report data
- `discover_report_rebuild_runs` - Pipeline run logs

#### Step 3: AI Narrative Generation (`discover-report-ai` + `ai-analyst`)

**Functions**: 
- `supabase/functions/discover-report-ai/`
- `supabase/functions/ai-analyst/`

**Purpose**: Generates human-readable narrative analysis

**Process**:
1. Reads processed report data
2. Analyzes trends and patterns
3. Generates insights using OpenAI/NVIDIA APIs
4. Creates structured narrative sections:
   - Executive summary
   - Top trends
   - Notable movers
   - Category highlights
   - Creator spotlights

**AI Prompts Include**:
- Week-over-week trend analysis
- Emerging pattern identification
- Notable creator achievements
- Category performance insights

**Output**:
- `weekly_reports` - Public-facing report with AI narrative
- Stored as JSON with structured sections

### Schedule

| Job | Schedule | Description |
|-----|----------|-------------|
| `discover-collector-orchestrate-minute` | `* * * * *` | Continuous orchestrator (`mode=orchestrate`) |
| `discover-collector-weekly-v2` | `0 6 * * 1` | Weekly kickoff (`mode=start`) |

### Data Retention

| Table | Retention | Notes |
|-------|-----------|-------|
| `discover_report_islands` | 30 days | Raw collection data |
| `discover_reports` | 1 year | Processed reports |
| `weekly_reports` | Indefinite | Public reports archive |
| `discover_report_rebuild_runs` | 90 days | Pipeline logs |

## 2. Exposure Tracking Pipeline

### Purpose
Tracks island visibility and exposure across Fortnite's discovery panels and surfaces.

### What is "Exposure"^

**Exposure** refers to how visible an island is to players within Fortnite's UI:
- **Panel Placement**: Position in discovery panels
- **Surface Visibility**: Appearances in featured sections
- **Browse Exposure**: Visibility in browse/categories
- **Search Ranking**: Position in search results

### Pipeline Flow

```
+---------+    +-------------+    +-------------+    +---------+
|  Cron   |--->|  discover-  |--->|   Raw Data  |--->|  Rollup |
| (Every minute orchestrator) |  exposure-   |    |   Storage   |    |  Daily  |
+---------+    |  collector   |    |             |    +---------+
               +-------------+    +-------------+
                                          |
                                          v
                                   +-------------+
                                   |  discover-  |
                                   |  exposure-    |
                                   |  report       |
                                   +-------------+
```

### Components

#### Step 1: Exposure Collection (`discover-exposure-collector`)

**Function**: `supabase/functions/discover-exposure-collector/`

**Purpose**: Captures island visibility snapshots

**Process**:
1. Queries Fortnite API for panel data
2. Records island positions across surfaces
3. Tracks presence/absence in discovery
4. Stores in `discovery_exposure_entries_raw`

**Data Captured**:
- Island code
- Surface/panel name
- Position/rank
- Region (NA-East, EU, BR, Asia)
- Timestamp
- Presence boolean

**Frequency**: Orchestrated every minute; each target runs by `next_due_at` (typical interval: 10 minutes).

**Output Tables**:
- `discovery_exposure_entries_raw` - Raw exposure snapshots
- `discovery_exposure_presence_events` - Presence change events

#### Step 2: Data Processing

**Process**:
1. Aggregates raw entries into time segments
2. Calculates presence statistics
3. Generates rank distributions
4. Stores processed data

**Output Tables**:
- `discovery_exposure_presence_segments` - Time-based presence data
- `discovery_exposure_rank_segments` - Rank distribution over time
- `discovery_exposure_rollup_daily` - Daily summaries

#### Step 3: Exposure Reporting (`discover-exposure-report`)

**Function**: `supabase/functions/discover-exposure-report/`

**Purpose**: Generates exposure analytics reports

**Reports Include**:
- Island exposure history
- Panel performance metrics
- Competitive positioning
- Trend analysis

**Output**:
- Dashboard data for admin exposure health page
- API endpoints for exposure queries

### Schedule

| Job | Schedule | Description |
|-----|----------|-------------|
| `discover-exposure-collector-orchestrate-minute` | `* * * * *` | Continuous collection orchestrator |
| `discover-exposure-maintenance-daily` | `7 0 * * *` | Daily maintenance + rollup |
| `discover-exposure-raw-cleanup-hourly` | `5 * * * *` | Limpeza de raw com short retention (3h) |

### Data Retention

| Table | Retention | Notes |
|-------|-----------|-------|
| `discovery_exposure_entries_raw` | 3 hours | High-volume raw data |
| `discovery_exposure_presence_events` | 7 days | Event log |
| `discovery_exposure_presence_segments` | 30 days | Processed segments |
| `discovery_exposure_rollup_daily` | 1 year | Historical analytics |

## 3. Metadata Refresh Pipeline

### Purpose
Maintains up-to-date island metadata, link relationships, and collection information.

### Pipeline Flow

```
+---------+    +-------------+    +-------------+    +---------+
|  Cron   |--->|  discover-  |--->|  Link Graph  |--->|  Cache  |
| (Every minute orchestrator)     |  links-      |    |  Processing |    |  Update |
+---------+    |  metadata-   |    |             |    +---------+
               |  collector   |    +-------------+
               +-------------+
```

### Components

#### Step 1: Metadata Collection (`discover-links-metadata-collector`)

**Function**: `supabase/functions/discover-links-metadata-collector/`

**Purpose**: Collects island metadata and link relationships

**Data Collected**:
- Island descriptions
- Tags and categories
- Creator links
- Collection memberships
- Related islands
- Thumbnail URLs

**Output Tables**:
- `discover_link_metadata` - Island metadata
- `discover_link_edges` - Relationship graph
- `discover_link_metadata_events` - Change events

#### Step 2: Rails Resolution (`discover-rails-resolver`)

**Function**: `supabase/functions/discover-rails-resolver/`

**Purpose**: Resolves link relationships and validates connections

**Process**:
1. Reads link edges
2. Validates island references
3. Resolves circular references
4. Updates link graph statistics

### Schedule

| Job | Schedule | Description |
|-----|----------|-------------|
| `discover-links-metadata-orchestrate-minute` | `* * * * *` | Continuous metadata orchestrator |
| `discover-rails-resolver` | on-demand | Rails resolution via explicit invocation |

## 4. Panel Intelligence Pipeline

### Purpose
Analyzes discovery panel composition and identifies premium/emerging content.

### Components

#### Panel Intel Refresh (`discover-panel-intel-refresh`)

**Function**: `supabase/functions/discover-panel-intel-refresh/`

**Purpose**: Analyzes panel data for intelligence insights

**Process**:
1. Reads exposure data
2. Identifies premium islands (high visibility)
3. Detects emerging islands (rising visibility)
4. Flags pollution creators (low quality, high visibility)
5. Updates public intel tables

**Output Tables**:
- `discovery_public_premium_now` - Currently premium islands
- `discovery_public_emerging_now` - Rising stars
- `discovery_public_pollution_creators_now` - Quality concerns

#### Panel Timeline (`discover-panel-timeline`)

**Function**: `supabase/functions/discover-panel-timeline/`

**Purpose**: On-demand panel timeline with panel-intelligence snapshot read

**Output**:
- `discovery_panel_tiers` - Panel tier history

### Schedule

| Job | Schedule | Description |
|-----|----------|-------------|
| `discover-panel-intel-refresh-10min` | `*/10 * * * *` | Panel intelligence snapshot refresh |
| `discover-panel-timeline` | on-demand | Calcula timeline na abertura do modal (com stale refresh de snapshot) |

## 5. Island Lookup and Island Page Pipeline

### Purpose
Provides real-time island lookup and a public island analytics page with hot cache.

### Components

#### Island Lookup (`discover-island-lookup`)

**Function**: `supabase/functions/discover-island-lookup/`

**Purpose**: Basic island information retrieval

**Process**:
1. Check cache (`discover_islands_cache`)
2. If stale/missing, fetch from Fortnite API
3. Update cache
4. Return island data

**Output**:
- Island metadata
- Current metrics
- Historical data

#### AI-Enhanced Lookup (`discover-island-lookup-ai`)

**Function**: `supabase/functions/discover-island-lookup-ai/`

**Purpose**: AI-powered island analysis

**Features**:
- Performance prediction
- Similar island recommendations
- Trend analysis
- Creator insights

### Island Page Cache (`discover-island-page`)

- Cache-first read for `/island^code=...`
- Resposta inclui `seriesByRange` (`1D/1W/1M/ALL`) para instant chart-range switching in frontend
- Hot refresh cron: `discover-island-page-cache-refresh-5min`
- Inactivity cleanup: `discover-island-page-cache-cleanup-hourly` (removes islands without access for 3 days)

### On-Demand
Lookup and island page requests are on-demand; cache refresh is cron-driven.

## 6. Gap Filling Pipeline

### Purpose
Handles missing data by enqueued gap-filling operations.

### Components

#### Gap Enqueue (`discover-enqueue-gap`)

**Function**: `supabase/functions/discover-enqueue-gap/`

**Purpose**: Identifies and queues missing data for backfill

**Triggered By**:
- Data quality checks
- User requests for historical data
- Pipeline failure recovery

## Pipeline Monitoring

### Health Checks

| Check | Method | Frequency |
|-------|--------|-----------|
| Pipeline runs | Query `*_runs` tables | Real-time |
| Data freshness | Check last update timestamps | Every minute (orchestrators) |
| Error rates | Query error logs | Every 15 min |
| Queue depth | Query `discover_report_queue` | Every minute |

### Alerting

Alerts are triggered via:
- `system_alerts_current` table
- Ralph incident system
- Admin dashboard notifications

### Common Issues

| Issue | Cause | Resolution |
|-------|-------|------------|
| Collection timeout | Fortnite API slow | Retry with backoff |
| Missing islands | API pagination | Gap fill enqueue |
| AI generation failure | LLM API error | Fallback to cached narrative |
| Data inconsistency | Race condition | Rebuild from raw data |

## Data Quality

### Validation Rules

1. **Completeness**: All expected islands present
2. **Timeliness**: Data within expected time window
3. **Consistency**: Metrics align with historical patterns
4. **Accuracy**: Cross-reference with API source

### Quality Checks

```sql
-- Example: Check for missing islands
SELECT code 
FROM discover_islands_cache 
WHERE last_updated < NOW() - INTERVAL '1 hour';

-- Example: Detect anomalous metrics
SELECT island_code, plays, unique_players
FROM discover_report_islands
WHERE plays > unique_players * 10; -- Suspicious ratio
```

## Performance Optimization

### Strategies

1. **Caching**: `discover_islands_cache` for frequent lookups
2. **Batching**: Process islands in batches to reduce API calls
3. **Incremental Updates**: Only fetch changed data when possible
4. **Parallel Processing**: Multiple Edge Function instances
5. **Data Retention**: Aggressive cleanup of high-volume tables

### Throughput

| Pipeline | Records/Hour | Data Volume |
|----------|--------------|-------------|
| Weekly Report | ~50,000 islands | ~100 MB |
| Exposure | ~1M snapshots | ~500 MB/day |
| Metadata | ~10,000 updates | ~50 MB/day |

---

**Next**: Read [06-RALPH-AI-SYSTEM.md](./06-RALPH-AI-SYSTEM.md) for AI system documentation.




