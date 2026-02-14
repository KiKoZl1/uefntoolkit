# Architecture Guide

This document provides an in-depth look at the Epic Insight Engine architecture.

## System Overview

Epic Insight Engine is a full-stack analytics platform that:

1. **Collects** data from Fortnite's public API
2. **Processes** and normalizes the data
3. **Stores** in Supabase database
4. **Serves** through a React frontend with role-based access

## High-Level Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Fortnite API  │────▶│  Edge Functions  │────▶│    Supabase     │
│  (ecosystem/v1) │     │ (discover-       │     │   (Database)    │
└─────────────────┘     │   collector)      │     └────────┬────────┘
                       └────────┬─────────┘              │
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐     ┌─────────────────┐
                       │  Data Processing │     │   React App     │
                       │  & Normalization │     │   (Frontend)    │
                       └──────────────────┘     └────────┬────────┘
                                                       │
                                ┌──────────────────────┘
                                ▼
                       ┌──────────────────┐
                       │   Public Portal │
                       │   /reports/:slug │
                       └──────────────────┘
```

## Frontend Architecture

### Tech Stack

- **Vite** - Build tool and dev server
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **shadcn/ui** - Component library
- **React Router** - Client-side routing
- **React Query** - Server state management

### Component Structure

```
src/
├── components/
│   ├── ui/              # Base UI components (shadcn)
│   ├── discover/        # Discovery-specific components
│   ├── AdminLayout.tsx  # Admin panel layout
│   ├── AppLayout.tsx    # Client app layout
│   ├── PublicLayout.tsx # Public pages layout
│   └── *.tsx            # Shared components
├── pages/
│   ├── public/          # Unauthenticated pages
│   ├── admin/           # Admin dashboard pages
│   └── *.tsx            # Main application pages
├── hooks/
│   ├── useAuth.tsx      # Authentication context
│   └── useMobile.tsx    # Mobile detection
├── integrations/
│   └── supabase/        # Supabase client
└── lib/
    └── parsing/         # Data utilities
```

### Routing Structure

| Path | Component | Access |
|------|-----------|--------|
| `/` | Home | Public |
| `/reports` | ReportsList | Public |
| `/reports/:slug` | ReportView | Public |
| `/auth` | Auth | Public |
| `/app` | AppLayout | Auth |
| `/app/*` | Client pages | Auth |
| `/admin` | AdminLayout | Admin/Editor |
| `/admin/*` | Admin pages | Admin/Editor |

## Backend Architecture

### Supabase Components

#### Authentication
- Email/password authentication
- Row Level Security (RLS) policies
- Role-based access control

#### Database Tables

| Table | Purpose |
|-------|---------|
| `discover_reports` | Weekly report metadata |
| `discover_report_islands` | Island data per report |
| `discover_report_queue` | Processing queue |
| `discover_islands_cache` | Cached island metadata |
| `discover_islands` | Master island list |
| `weekly_reports` | CMS for public reports |
| `user_roles` | Role assignments |

### Edge Functions

#### discover-collector

The main data collection function that:

1. **Catalog Phase** - Fetches island catalog from Fortnite API
2. **Metrics Phase** - Collects 7-day metrics for each island
3. **Finalize Phase** - Computes rankings and KPIs

```typescript
// Modes
type CollectorMode = "start" | "catalog" | "metrics" | "finalize";
```

#### ai-analyst

Generates AI-powered insights and narratives using:
- Platform KPIs
- Island rankings
- Trend data

#### discover-island-lookup

Provides search functionality for islands by code.

#### discover-report-ai

AI generation for weekly reports.

## Data Flow

### Collection Flow

```
1. Admin initiates report
   └─▶ discover-collector?mode=start

2. Fetch island catalog (paginated)
   └─▶ discover-collector?mode=catalog

3. Collect metrics for each island
   └─▶ discover-collector?mode=metrics

4. Finalize and compute rankings
   └─▶ discover-collector?mode=finalize

5. AI analysis
   └─▶ ai-analyst

6. Generate public report
   └─▶ discover-report-ai
```

### Query Flow

```
User Request
    │
    ▼
React Router
    │
    ▼
Auth Check (ProtectedRoute/AdminRoute)
    │
    ▼
Page Component
    │
    ▼
React Query (TanStack Query)
    │
    ▼
Supabase Client
    │
    ▼
RLS Policy Check
    │
    ▼
Database / Edge Function
```

## Security

### Authentication Flow

1. User signs in via Supabase Auth
2. Session stored in localStorage
3. Token sent with each request
4. Role fetched from `user_roles` table

### Role-Based Access

```typescript
type AppRole = "admin" | "editor" | "client";

// Middleware checks
AdminRoute → isAdmin || isEditor
ProtectedRoute → authenticated user
```

### Row Level Security

- Public reports: Readable by all (anon + authenticated)
- Private data: Restricted by user_id
- Admin operations: Admin-only via service_role

## State Management

### Client State
- React Context for auth
- Local state for UI

### Server State
- React Query for caching
- Automatic refetch on window focus
- Stale-while-revalidate pattern

## Performance Optimizations

### Frontend
- Code splitting by route
- Component lazy loading
- React Query caching
- Virtual scrolling for large lists

### Backend
- Batch database operations
- Adaptive concurrency in collectors
- Rate limiting handling
- Chunked processing

## Deployment

### Frontend
- Vite build to static files
- Deploy to any static host (Vercel, Netlify, etc.)

### Backend
- Supabase managed services
- Edge Functions on Supabase Edge Network
- Database on Supabase

### Environment Variables
```
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

## Development Workflow

1. **Local Development**
   - Vite dev server on port 8080
   - Supabase local or cloud

2. **Testing**
   - Vitest for unit tests
   - React Testing Library for components

3. **Building**
   - TypeScript compilation
   - ESLint linting
   - Vite production build

4. **Deployment**
   - Push to git
   - Automatic deployment via platform

