# Epic Insight Engine

A comprehensive data analytics platform for Fortnite UGC (User-Generated Content) discovery, providing insights into island metrics, trends, rankings, and AI-powered analysis.

## Overview

Epic Insight Engine collects and analyzes data from Fortnite's island ecosystem, providing:

- **Weekly Discovery Reports** - Comprehensive analysis of trending islands
- **Island Metrics** - Plays, unique players, minutes played, peak CCU, retention
- **Creator Analytics** - Track creator performance and trends
- **Category Analysis** - Breakdowns by game mode (Battle Royale, Prop Hunt, etc.)
- **AI-Powered Insights** - Automated narrative generation and trend detection
- **Public Report Portal** - Shareable reports with public slugs

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| UI Framework | Tailwind CSS, shadcn/ui |
| State Management | React Query (TanStack Query) |
| Routing | React Router DOM v6 |
| Backend | Supabase (Auth, Database, Edge Functions) |
| Charts | Recharts |
| Forms | React Hook Form + Zod |
| Testing | Vitest |

## Project Structure

```
epic-insight-engine/
├── src/
│   ├── components/           # React components
│   │   ├── ui/              # shadcn/ui components
│   │   ├── discover/        # Discovery-specific components
│   │   └── *.tsx            # Layout and routing components
│   ├── pages/               # Page components
│   │   ├── public/          # Public-facing pages
│   │   ├── admin/           # Admin dashboard pages
│   │   └── *.tsx            # Main app pages
│   ├── hooks/               # Custom React hooks
│   │   ├── useAuth.tsx      # Authentication context
│   │   └── useMobile.tsx    # Mobile detection
│   ├── integrations/        # Third-party integrations
│   │   └── supabase/        # Supabase client & types
│   ├── lib/                 # Utility libraries
│   │   └── parsing/         # Data processing utilities
│   └── test/                # Test files
├── supabase/
│   ├── functions/           # Edge Functions
│   │   ├── ai-analyst/      # AI analysis function
│   │   ├── discover-collector/  # Data collection
│   │   ├── discover-island-lookup/ # Island lookup
│   │   └── discover-report-ai/    # Report AI
│   └── migrations/          # Database migrations
└── public/                  # Static assets
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or bun
- Supabase account (for backend)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd epic-insight-engine

# Install dependencies
npm install
# or
bun install
```

### Environment Variables

Create a `.env` file in the root directory:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
```

### Running the Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:8080`

### Building for Production

```bash
npm run build
```

## User Roles

The application supports three user roles:

| Role | Permissions |
|------|-------------|
| `admin` | Full access to all features, user management |
| `editor` | Create and edit reports, access admin features |
| `client` | Access personal dashboard and owned projects |

## Key Features

### Public Portal
- Home page with platform overview
- Public reports list with search
- Individual report viewing with shareable links

### Client Dashboard
- Project management
- Report dashboards with detailed metrics
- Island lookup tool

### Admin Panel
- Overview dashboard with platform KPIs
- Reports management (create, edit, publish)
- Report editor with AI assistance

## Database Schema

The application uses Supabase with the following key tables:

- `discover_reports` - Weekly discovery reports
- `discover_report_islands` - Island data per report
- `discover_report_queue` - Processing queue
- `discover_islands_cache` - Cached island metadata
- `weekly_reports` - CMS for public reports
- `user_roles` - Role-based access control

## API Integration

The backend integrates with:
- **Fortnite API** (`api.fortnite.com/ecosystem/v1`) - Island catalog and metrics

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

Private - All rights reserved

## Support

For issues or questions, please contact the development team.

