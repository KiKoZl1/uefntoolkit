# 09 - APIs Reference

## Overview

Epic Insight Engine integrates with multiple external APIs for data collection, AI processing, and backend services. This document details all APIs used, their endpoints, authentication methods, and usage patterns.

## API Architecture

```
+-------------------------------------------------------------+
|                    EPIC INSIGHT ENGINE                       |
|                                                              |
|  +--------------+  +--------------+  +--------------+       |
|  |   Frontend   |  |   Backend    |  |    Ralph     |       |
|  |   (React)    |  |  (Supabase)  |  |   (Local)    |       |
|  +------+-------+  +------+-------+  +------+-------+       |
|         |                 |                 |                |
|         +-----------------+-----------------+                |
|                           |                                  |
|         +-----------------+-----------------+              |
|         v                 v                 v                  |
|  +--------------+  +--------------+  +--------------+       |
|  |   Fortnite   |  |   OpenAI/    |  |   Supabase   |       |
|  |     API      |  |   NVIDIA     |  |   Platform   |       |
|  |              |  |    APIs      |  |              |       |
|  +--------------+  +--------------+  +--------------+       |
|                                                              |
+-------------------------------------------------------------+
```

## 1. Fortnite API

### Purpose
Primary data source for Fortnite UGC (User-Generated Content) island information, metrics, and discovery data.

### Base URL
```
https://api.fortnite.com/ecosystem/v1
```

### Authentication
- **Type**: OAuth 2.0 / API Key (varies by endpoint)
- **Header**: `Authorization: Bearer {token}` or `X-Epic-Api-Key: {key}`
- **Token Source**: Epic Games Developer Portal

### Endpoints

#### Island Catalog
```http
GET /islands/catalog
```

**Description**: Retrieves list of all available islands

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer | No | Max results (default: 100, max: 1000) |
| `offset` | integer | No | Pagination offset |
| `sort` | string | No | Sort field (plays, rating, created) |
| `order` | string | No | Sort order (asc, desc) |

**Response**:
```json
{
  "islands": [
    {
      "code": "1234-5678-9012",
      "name": "Island Name",
      "creator": "CreatorName",
      "description": "Island description",
      "gameMode": "Battle Royale",
      "plays": 1000000,
      "uniquePlayers": 500000,
      "minutesPlayed": 2000000,
      "peakCcu": 15000,
      "rating": 4.5,
      "reviewCount": 2500,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-06-15T14:20:00Z"
    }
  ],
  "total": 50000,
  "limit": 100,
  "offset": 0
}
```

#### Island Details
```http
GET /islands/{islandCode}
```

**Description**: Retrieves detailed information for a specific island

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `islandCode` | string | Yes | Island code (format: XXXX-XXXX-XXXX) |

**Response**:
```json
{
  "code": "1234-5678-9012",
  "name": "Island Name",
  "creator": {
    "id": "creator-uuid",
    "name": "CreatorName",
    "islandCount": 15
  },
  "description": "Detailed description",
  "tags": ["pvp", "competitive", "seasonal"],
  "gameMode": "Battle Royale",
  "metrics": {
    "plays": 1000000,
    "uniquePlayers": 500000,
    "minutesPlayed": 2000000,
    "peakCcu": 15000,
    "retentionRate": 0.65,
    "avgSessionMinutes": 12.5
  },
  "rating": {
    "average": 4.5,
    "count": 2500,
    "distribution": {
      "5": 1500,
      "4": 600,
      "3": 250,
      "2": 100,
      "1": 50
    }
  },
  "discovery": {
    "panelAppearances": 150,
    "featuredCount": 5,
    "lastFeatured": "2024-06-10T08:00:00Z"
  }
}
```

#### Discovery Panels
```http
GET /discovery/panels
```

**Description**: Retrieves current discovery panel composition

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `region` | string | No | Region (NA-East, EU, BR, Asia) |
| `surface` | string | No | Surface type (browse, featured, search) |

**Response**:
```json
{
  "panels": [
    {
      "id": "panel-uuid",
      "name": "Featured Battle Royale",
      "surface": "featured",
      "region": "NA-East",
      "islands": [
        {
          "code": "1234-5678-9012",
          "position": 1,
          "featured": true
        }
      ],
      "updatedAt": "2024-06-15T14:20:00Z"
    }
  ]
}
```

#### Island Metrics (Bulk)
```http
POST /islands/metrics
```

**Description**: Retrieves metrics for multiple islands in one request

**Request Body**:
```json
{
  "islandCodes": ["1234-5678-9012", "9876-5432-1098"],
  "metrics": ["plays", "uniquePlayers", "minutesPlayed", "peakCcu"]
}
```

**Response**:
```json
{
  "metrics": [
    {
      "code": "1234-5678-9012",
      "plays": 1000000,
      "uniquePlayers": 500000,
      "minutesPlayed": 2000000,
      "peakCcu": 15000,
      "timestamp": "2024-06-15T14:20:00Z"
    }
  ]
}
```

### Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| Catalog | 100 | 1 minute |
| Island Details | 1000 | 1 minute |
| Discovery Panels | 60 | 1 minute |
| Bulk Metrics | 100 | 1 minute |

### Error Codes

| Code | Description | Resolution |
|------|-------------|------------|
| 401 | Unauthorized | Check API key/token |
| 429 | Rate Limited | Implement backoff |
| 404 | Island Not Found | Verify island code |
| 500 | Server Error | Retry with exponential backoff |
| 503 | Service Unavailable | Wait and retry |

### Usage in Epic Insight Engine

**Edge Functions Using Fortnite API**:
- `discover-collector` - Fetches island catalog and metrics
- `discover-exposure-collector` - Retrieves discovery panel data
- `discover-island-lookup` - Gets island details
- `discover-links-metadata-collector` - Fetches metadata

**Implementation Pattern**:
```typescript
// supabase/functions/discover-collector/index.ts
const FORTNITE_API_BASE = 'https://api.fortnite.com/ecosystem/v1';

async function fetchIslandCatalog() {
  const response = await fetch(`${FORTNITE_API_BASE}/islands/catalog?limit=1000`, {
    headers: {
      'Authorization': `Bearer ${Deno.env.get('FORTNITE_API_TOKEN')}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Fortnite API error: ${response.status}`);
  }
  
  return await response.json();
}
```

## 2. Supabase APIs

### Purpose
Backend-as-a-Service platform providing database, authentication, storage, and real-time APIs.

### Base URLs
```
REST API:     https://your-project.supabase.co/rest/v1
Auth API:     https://your-project.supabase.co/auth/v1
Storage API:  https://your-project.supabase.co/storage/v1
Realtime:     wss://your-project.supabase.co/realtime/v1
Functions:    https://your-project.supabase.co/functions/v1
```

### Authentication

#### Client-Side (Anon Key)
```javascript
const supabase = createClient(
  'https://your-project.supabase.co',
  'your-anon-key'
);
```

#### Server-Side (Service Role Key)
```javascript
const supabase = createClient(
  'https://your-project.supabase.co',
  'your-service-role-key',
  {
    auth: { autoRefreshToken: false, persistSession: false }
  }
);
```

### REST API (PostgREST)

#### Querying Data
```http
GET /rest/v1/discover_reports?select=*&week_start=gte.2024-01-01&order=week_start.desc
```

**Headers**:
| Header | Value |
|--------|-------|
| `apikey` | `your-anon-key` |
| `Authorization` | `Bearer {jwt-token}` |

**Query Parameters**:
| Parameter | Description | Example |
|-----------|-------------|---------|
| `select` | Columns to return | `select=id,name,metrics` |
| `eq` | Equals | `code=eq.1234-5678` |
| `gt`, `gte` | Greater than | `plays=gte.1000000` |
| `lt`, `lte` | Less than | `created_at=lte.2024-06-01` |
| `like` | Pattern match | `name=like.*Battle*` |
| `in` | In array | `code=in.(1234,5678)` |
| `order` | Sorting | `order=plays.desc` |
| `limit` | Max results | `limit=100` |
| `offset` | Pagination | `offset=200` |

#### Inserting Data
```http
POST /rest/v1/discover_reports
Content-Type: application/json

{
  "week_start": "2024-06-15",
  "title": "Weekly Report",
  "data": {...}
}
```

#### Updating Data
```http
PATCH /rest/v1/discover_reports?id=eq.123
Content-Type: application/json

{
  "published": true
}
```

#### RPC Functions
```http
POST /rest/v1/rpc/start_ralph_run
Content-Type: application/json

{
  "context": "weekly_report_generation"
}
```

### Auth API

#### Sign Up
```http
POST /auth/v1/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword",
  "data": {
    "full_name": "User Name"
  }
}
```

#### Sign In
```http
POST /auth/v1/token?grant_type=password
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}
```

#### OAuth Sign In
```http
GET /auth/v1/authorize?provider=google
```

#### Refresh Token
```http
POST /auth/v1/token?grant_type=refresh_token
Content-Type: application/json

{
  "refresh_token": "refresh-token-here"
}
```

### Storage API

#### Upload File
```http
POST /storage/v1/object/uploads/user-id/filename.jpg
Content-Type: multipart/form-data

[binary file data]
```

#### Download File
```http
GET /storage/v1/object/public/avatars/user-id/avatar.jpg
```

#### List Files
```http
GET /storage/v1/object/list/uploads?prefix=user-id
```

### Realtime API (WebSocket)

```javascript
const channel = supabase
  .channel('discover_reports')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'discover_reports'
    },
    (payload) => {
      console.log('New report:', payload.new);
    }
  )
  .subscribe();
```

### Edge Functions API

#### Invoke Function
```http
POST /functions/v1/discover-island-lookup
Content-Type: application/json
Authorization: Bearer {jwt-token}

{
  "islandCode": "1234-5678-9012"
}
```

**Response**:
```json
{
  "island": {
    "code": "1234-5678-9012",
    "name": "Island Name",
    "metrics": {...}
  }
}
```

### Rate Limits

| API | Limit | Notes |
|-----|-------|-------|
| REST | 1000/min | Per IP |
| Auth | 100/min | Per IP |
| Storage | 100/min | Per user |
| Realtime | 1000 concurrent | Per project |
| Functions | 1000/min | Per project |

## 3. OpenAI API

### Purpose
Generates AI-powered narratives and analysis for weekly reports and island insights.

### Base URL
```
https://api.openai.com/v1
```

### Authentication
```http
Authorization: Bearer {OPENAI_API_KEY}
```

### Endpoints

#### Chat Completions
```http
POST /chat/completions
Content-Type: application/json

{
  "model": "gpt-4.1-mini",
  "messages": [
    {
      "role": "system",
      "content": "You are an analytics assistant for Fortnite UGC data."
    },
    {
      "role": "user",
      "content": "Generate a weekly report summary for islands with trending data: {...}"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 2000
}
```

**Response**:
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "gpt-4.1-mini",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "This week in Fortnite UGC, we observed significant growth in Battle Royale islands..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 1500,
    "completion_tokens": 500,
    "total_tokens": 2000
  }
}
```

#### Embeddings
```http
POST /embeddings
Content-Type: application/json

{
  "input": "Island description text for semantic search",
  "model": "text-embedding-3-small"
}
```

### Models Used

| Model | Purpose | Cost |
|-------|---------|------|
| `gpt-4.1-mini` | Report narratives | $0.15/1M tokens |
| `text-embedding-3-small` | Document embeddings | $0.02/1M tokens |

### Rate Limits

| Tier | RPM | TPM |
|------|-----|-----|
| Free | 20 | 150,000 |
| Tier 1 | 100 | 1,000,000 |
| Tier 2 | 500 | 5,000,000 |

### Usage in Epic Insight Engine

**Functions Using OpenAI**:
- `discover-report-ai` - Generates weekly report narratives
- `ai-analyst` - Advanced trend analysis
- `discover-island-lookup-ai` - AI-enhanced island insights
- `ralph_memory_ingest` - Document embedding generation

## 4. NVIDIA API

### Purpose
Alternative AI provider for LLM inference and embeddings, often more cost-effective.

### Base URL
```
https://integrate.api.nvidia.com/v1
```

### Authentication
```http
Authorization: Bearer {NVIDIA_API_KEY}
```

### Endpoints

#### Chat Completions
```http
POST /chat/completions
Content-Type: application/json

{
  "model": "nvidia/llama-3.1-nemotron-70b-instruct",
  "messages": [
    {
      "role": "system",
      "content": "You are an analytics assistant."
    },
    {
      "role": "user",
      "content": "Analyze these island metrics: {...}"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 2000
}
```

#### Embeddings
```http
POST /embeddings
Content-Type: application/json

{
  "input": "Text to embed",
  "model": "nvidia/nv-embed-v1"
}
```

### Models Used

| Model | Purpose | Notes |
|-------|---------|-------|
| `nvidia/llama-3.1-nemotron-70b-instruct` | Text generation | High quality |
| `nvidia/nv-embed-v1` | Embeddings | Fast inference |

### Rate Limits

| Endpoint | Limit |
|----------|-------|
| Chat | 1000 RPM |
| Embeddings | 2000 RPM |

### Usage in Epic Insight Engine

**Primary Use**: Ralph AI system memory operations and narrative generation (preferred over OpenAI for cost savings).

## 5. External Service APIs

### Firecrawl (Optional)

**Purpose**: Web scraping for metadata collection

**Base URL**: `https://api.firecrawl.dev/v1`

**Usage**: `scripts/firecrawl_fngg_probe.mjs`

### Custom APIs

#### Ralph Memory API (Internal)

**Base**: Supabase Edge Functions

**Endpoints**:
- `POST /functions/v1/ralph-memory-ingest` - Add to memory
- `POST /functions/v1/ralph-memory-query` - Query memory

## API Security Best Practices

### 1. Key Management
- Store API keys in environment variables
- Never commit keys to version control
- Rotate keys regularly
- Use different keys for dev/staging/prod

### 2. Rate Limiting
- Implement client-side rate limiting
- Use exponential backoff for retries
- Cache responses when appropriate
- Monitor API usage

### 3. Error Handling
```typescript
async function safeApiCall() {
  try {
    const response = await fetch(apiUrl, options);
    
    if (response.status === 429) {
      // Rate limited - backoff and retry
      await delay(1000);
      return safeApiCall();
    }
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API call failed:', error);
    // Fallback or error response
    return null;
  }
}
```

### 4. Request Signing
For APIs requiring signed requests:
```typescript
import { createHmac } from 'crypto';

function signRequest(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}
```

## API Monitoring

### Metrics to Track

| Metric | Tool | Alert Threshold |
|--------|------|-----------------|
| Response Time | Supabase Logs | > 5 seconds |
| Error Rate | Sentry/LogRocket | > 5% |
| Rate Limit Hits | Custom logging | Any hit |
| Cost | Provider dashboards | > $100/day |

### Logging

```typescript
// Log all API calls
console.log(`[API] ${method} ${endpoint} - ${duration}ms - ${status}`);
```

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| 401 Unauthorized | Invalid/expired token | Refresh token, check env vars |
| 429 Rate Limited | Too many requests | Implement backoff, reduce frequency |
| 500 Server Error | Provider issue | Retry with exponential backoff |
| Timeout | Slow response | Increase timeout, implement caching |
| CORS Error | Missing headers | Check CORS configuration |

### Debug Commands

```bash
# Test Fortnite API
curl -H "Authorization: Bearer $FORTNITE_TOKEN" \
  https://api.fortnite.com/ecosystem/v1/islands/catalog?limit=10

# Test Supabase REST
curl -H "apikey: $SUPABASE_ANON_KEY" \
  https://your-project.supabase.co/rest/v1/discover_reports?limit=1

# Test OpenAI
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
  https://api.openai.com/v1/models
```

## API Configuration Summary

| Service | Env Var | Required | Default |
|---------|---------|----------|---------|
| Fortnite | `FORTNITE_API_TOKEN` | Yes | - |
| Supabase URL | `VITE_SUPABASE_URL` | Yes | - |
| Supabase Anon | `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | - |
| Supabase Service | `SUPABASE_SERVICE_ROLE_KEY` | Yes | - |
| OpenAI | `OPENAI_API_KEY` | Optional | - |
| NVIDIA | `NVIDIA_API_KEY` | Optional | - |

---

**Next**: Read [07-DEPLOYMENT.md](./07-DEPLOYMENT.md) for deployment instructions.
