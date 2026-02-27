# Epic Insight Engine - Documentation

Fortnite UGC analytics platform documentation.

## Documentation Index

| Document | Description |
|----------|-------------|
| [01-PROJECT-OVERVIEW.md](./01-PROJECT-OVERVIEW.md) | Project scope, goals, and stack |
| [02-ARCHITECTURE.md](./02-ARCHITECTURE.md) | Runtime model and system architecture |
| [03-FRONTEND.md](./03-FRONTEND.md) | Frontend structure, routes, and UI behavior |
| [04-BACKEND.md](./04-BACKEND.md) | Supabase backend, functions, and schema |
| [05-DATA-PIPELINES.md](./05-DATA-PIPELINES.md) | Collector/exposure/metadata pipelines |
| [06-RALPH-AI-SYSTEM.md](./06-RALPH-AI-SYSTEM.md) | Ralph AI runtime and memory model |
| [07-DEPLOYMENT.md](./07-DEPLOYMENT.md) | Environment setup and deployment |
| [08-DEVELOPMENT.md](./08-DEVELOPMENT.md) | Dev workflow, testing, and contribution |
| [09-APIS.md](./09-APIS.md) | External API and endpoint reference |

## Quick Start

```bash
npm install
npm run dev
npm run test
```

## Architecture at a Glance

```text
+-----------------+     +-----------------+     +-----------------+
|   Frontend      |---->|   Supabase      |---->|   Fortnite API  |
|   (React/Vite)  |<----|   (Backend)     |<----|   (Data Source) |
+-----------------+     +-----------------+     +-----------------+
         |                       |
         |              +--------+--------+
         |              |  Edge Functions |
         |              |  - discover-*   |
         |              |  - ai-analyst   |
         |              |  - ralph-*      |
         |              +-----------------+
         |
+--------+--------+
|  Ralph AI       |
|  (Local Runner) |
|  - Automation   |
|  - Memory       |
+-----------------+
```

## Data Domains

1. Weekly Reports
2. Exposure Tracking
3. Metadata Graph
4. Public Panel Intelligence
5. Ralph Operations

## Roles

| Role | Access Level |
|------|-------------|
| `admin` | Full platform access |
| `editor` | Report/admin operations |
| `client` | Personal dashboard and owned projects |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| UI | Tailwind CSS, shadcn/ui, Radix UI |
| State | TanStack Query |
| Routing | React Router DOM v6 |
| Backend | Supabase (Postgres, Auth, Edge Functions) |
| Charts | Recharts |
| Testing | Vitest |
| AI | OpenAI and NVIDIA APIs |

## Operational Docs

Operational/runbook/specialized docs are kept in:
- `docs/README.md`

This includes Ralph runbooks and engineering deep dives such as:
- `docs/discover-panel-intelligence-algorithms.md`

## Notes

For historical references only:
- `docs/archive/`
