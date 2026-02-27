# 06 - Ralph AI System

## Overview

**Ralph** is Epic Insight Engine's local AI automation system. It provides intelligent operations, memory management, and autonomous decision-making capabilities for platform maintenance and optimization.

## What is Ralph^

Ralph is a **local-first AI runner** that operates alongside the main application. Unlike cloud-based AI services, Ralph runs on your local machine, providing:

- **Autonomous Operations**: Self-directed maintenance and optimization
- **Memory System**: Long-term context and learning
- **Incident Management**: Automatic detection and resolution
- **Decision Support**: AI-powered recommendations

## Architecture

```
+-------------------------------------------------------------+
|                      RALPH SYSTEM                           |
|                                                             |
|  +--------------+  +--------------+  +--------------+     |
|  |   Local      |  |   Memory     |  |   Action     |     |
|  |   Runner     |  |   System     |  |   Engine     |     |
|  |              |  |              |  |              |     |
|  | • Loop       |  | • Snapshots  |  | • Decisions  |     |
|  | • Scheduler  |  | • Items      |  | • Execution  |     |
|  | • Monitor    |  | • Context  |  | • Validation |     |
|  +------+-------+  +------+-------+  +------+-------+     |
|         |                 |                 |              |
|         +-----------------+-----------------+              |
|                           |                                |
|                    +------+------+                        |
|                    |   Supabase    |                        |
|                    |   (ralph_*    |                        |
|                    |    tables)    |                        |
|                    +---------------+                        |
|                                                             |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                   EXTERNAL SERVICES                          |
|  +--------------+  +--------------+  +--------------+     |
|  |   NVIDIA     |  |   OpenAI     |  |   Fortnite   |     |
|  |    API       |  |    API       |  |    API       |     |
|  |              |  |  (Fallback)   |  |              |     |
|  +--------------+  +--------------+  +--------------+     |
+-------------------------------------------------------------+
```

## Core Components

### 1. Local Runner (`scripts/ralph_local_runner.mjs`)

**Purpose**: Main entry point for Ralph operations

**Features**:
- Configuration loading
- Service initialization
- Loop management
- Graceful shutdown

**Usage**:
```bash
npm run ralph:local
# or
node scripts/ralph_local_runner.mjs
```

### 2. Loop Harness (`scripts/ralph_loop.ps1`)

**Purpose**: PowerShell wrapper for Windows environments

**Features**:
- Process monitoring
- Auto-restart on failure
- Log rotation
- Environment setup

**Usage**:
```bash
npm run ralph:loop
# or
powershell -File scripts/ralph_loop.ps1
```

### 3. Memory System

Ralph maintains several types of memory for context and learning:

#### Memory Tables

| Table | Purpose | Retention |
|-------|---------|-----------|
| `ralph_memory_snapshots` | System state snapshots | 30 days |
| `ralph_memory_items` | Key-value memory store | Indefinite |
| `ralph_memory_decisions` | Decision history | 90 days |
| `ralph_memory_documents` | Document embeddings | Indefinite |

#### Memory Types

**1. Snapshots**
```typescript
interface MemorySnapshot {
  id: string;
  timestamp: string;
  context: string;
  state: object;
  metrics: object;
}
```

Captures system state at regular intervals for trend analysis.

**2. Items**
```typescript
interface MemoryItem {
  id: string;
  key: string;
  value: any;
  category: string;
  importance: number;
  created_at: string;
}
```

Key-value store for learned information and preferences.

**3. Decisions**
```typescript
interface MemoryDecision {
  id: string;
  decision: string;
  context: object;
  outcome: string;
  confidence: number;
  timestamp: string;
}
```

Records decisions made and their outcomes for learning.

**4. Documents**
```typescript
interface MemoryDocument {
  id: string;
  content: string;
  embedding: number[]; // Vector embedding
  metadata: object;
  source: string;
}
```

Document storage with vector embeddings for semantic search.

### 4. Action Engine

Ralph can perform various actions based on its analysis:

#### Action Types

| Action | Description | Example |
|--------|-------------|---------|
| `alert` | Send notification | Data pipeline failure |
| `adjust` | Modify configuration | Increase cache TTL |
| `enqueue` | Queue background job | Gap fill missing data |
| `report` | Generate report | Weekly summary |
| `validate` | Run validation | Data quality check |
| `optimize` | Performance tuning | Query optimization |

#### Action Lifecycle

```
+---------+    +-------------+    +-------------+    +---------+
| Trigger |--->|  Analysis   |--->|  Decision   |--->|Execution|
| (Event) |    |   (AI)      |    |   (Rules)   |    |         |
+---------+    +-------------+    +-------------+    +----+----+
                                                         |
                              +-------------------------+
                              v
                       +-------------+
                       |   Record    |
                       |   Outcome   |
                       +-------------+
```

### 5. Incident Management

Ralph tracks and manages operational incidents:

#### Incident Tables

| Table | Purpose |
|-------|---------|
| `ralph_runs` | Execution run logs |
| `ralph_actions` | Action execution logs |
| `ralph_eval_results` | Evaluation results |
| `ralph_incidents` | Incident tracking |

#### Incident Lifecycle

```
+---------+    +-------------+    +-------------+    +---------+
| Detect  |--->|   Raise     |--->|  Investigate|--->| Resolve |
|         |    |  Incident   |    |   (AI)      |    |         |
+---------+    +-------------+    +-------------+    +---------+
      |                                              |
      +----------------------------------------------+
                         |
                         v
                  +-------------+
                  |   Learn     |
                  |  (Update    |
                  |   Memory)   |
                  +-------------+
```

## Ralph Operations

### 1. Memory Ingestion

**Script**: `scripts/ralph_memory_ingest.mjs`

**Purpose**: Add information to Ralph's memory

**Usage**:
```bash
npm run ralph:memory:ingest
# or
node scripts/ralph_memory_ingest.mjs
```

**Process**:
1. Reads documents from specified sources
2. Generates embeddings using NVIDIA/OpenAI API
3. Stores in `ralph_memory_documents`
4. Updates related memory items

### 2. Memory Query

**Script**: `scripts/ralph_memory_query.mjs`

**Purpose**: Query Ralph's memory for information

**Usage**:
```bash
npm run ralph:memory:query
# or
node scripts/ralph_memory_query.mjs
```

**Features**:
- Semantic search via embeddings
- Context-aware responses
- Source attribution

### 3. Local Runner

**Script**: `scripts/ralph_local_runner.mjs`

**Purpose**: Main Ralph operation loop

**Operations**:
- System health monitoring
- Data pipeline validation
- Automated optimization
- Incident detection and response

## AI Integration

### LLM Providers

Ralph supports multiple LLM providers:

| Provider | Priority | Use Case |
|----------|----------|----------|
| **NVIDIA API** | Primary | Fast inference, cost-effective |
| **OpenAI API** | Fallback | Complex reasoning, GPT-4 quality |

### Prompt Engineering

Ralph uses structured prompts for different operations:

#### Analysis Prompt
```
You are Ralph, the AI operations assistant for Epic Insight Engine.

Current Context:
- System Status: {status}
- Recent Events: {events}
- Memory Context: {memory}

Task: Analyze the current situation and recommend actions.

Consider:
1. Data pipeline health
2. User experience impact
3. Resource optimization
4. Proactive maintenance

Provide:
1. Situation assessment
2. Recommended actions (prioritized)
3. Confidence level (0-1)
4. Expected outcomes
```

#### Decision Prompt
```
You are Ralph, making an operational decision.

Context: {context}
Options: {options}
Historical Outcomes: {memory_decisions}

Select the best action and explain your reasoning.
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NVIDIA_API_KEY` | Recommended | Primary LLM provider |
| `OPENAI_API_KEY` | Optional | Fallback LLM provider |
| `SUPABASE_URL` | Yes | Database connection |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Privileged DB access |
| `RALPH_LOG_LEVEL` | Optional | Logging verbosity (debug/info/warn/error) |
| `RALPH_INTERVAL_MS` | Optional | Loop interval (default: 60000) |

### Configuration File

Optional `ralph.config.json`:
```json
{
  "intervalMs": 60000,
  "memory": {
    "snapshotRetentionDays": 30,
    "maxDocuments": 10000
  },
  "actions": {
    "autoExecute": false,
    "requireApproval": ["adjust", "optimize"]
  },
  "incidents": {
    "autoResolve": true,
    "escalationThreshold": 3
  }
}
```

## Use Cases

### 1. Data Pipeline Monitoring

Ralph continuously monitors data pipelines and can:
- Detect collection failures
- Identify data quality issues
- Trigger gap-filling operations
- Alert on anomalies

### 2. Performance Optimization

Ralph analyzes query patterns and can:
- Suggest index additions
- Recommend cache configuration
- Identify slow queries
- Optimize batch sizes

### 3. Content Intelligence

Ralph processes report content and can:
- Generate executive summaries
- Identify trending topics
- Suggest report improvements
- Create narrative variations

### 4. System Maintenance

Ralph performs routine maintenance:
- Cleanup old data
- Archive historical records
- Update statistics
- Validate data integrity

## Ralph RPCs

Database functions for Ralph integration:

| RPC | Purpose |
|-----|---------|
| `start_ralph_run` | Begin a Ralph execution run |
| `finish_ralph_run` | Complete a run with status |
| `record_ralph_action` | Log an action execution |
| `record_ralph_eval` | Store evaluation result |
| `raise_ralph_incident` | Create an incident record |
| `resolve_ralph_incident` | Mark incident as resolved |
| `get_ralph_health` | Get current health status |
| `get_ralph_memory_context` | Retrieve memory for context |

## Best Practices

### 1. Memory Management
- Regular ingestion of relevant documents
- Periodic cleanup of old snapshots
- Embedding refresh for changing content

### 2. Action Safety
- Start with `autoExecute: false`
- Review actions before enabling auto-execution
- Maintain approval requirements for destructive actions

### 3. Incident Response
- Define clear escalation paths
- Document resolution procedures
- Learn from incident patterns

### 4. Monitoring
- Track Ralph's own performance
- Monitor API usage and costs
- Set up alerts for Ralph failures

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Ralph not starting | Missing env vars | Check `.env` configuration |
| Memory queries slow | Too many documents | Run cleanup or increase resources |
| Actions not executing | Auto-execute disabled | Enable in config or run manually |
| LLM API errors | Rate limiting | Switch provider or add backoff |

### Debug Mode

Enable debug logging:
```bash
RALPH_LOG_LEVEL=debug npm run ralph:local
```

### Manual Action Execution

Execute a specific action:
```bash
node scripts/ralph_local_runner.mjs --action=validate
```

## Future Roadmap

- [ ] Multi-agent Ralph (specialized sub-agents)
- [ ] Predictive incident detection
- [ ] Natural language interface
- [ ] Automated report generation
- [ ] Integration with external monitoring tools

---

**Next**: Read [07-DEPLOYMENT.md](./07-DEPLOYMENT.md) for deployment instructions.
