# 01 - Project Overview

## What is Epic Insight Engine^

**Epic Insight Engine** is a comprehensive data analytics platform designed specifically for **Fortnite's User-Generated Content (UGC) ecosystem**. It provides deep insights into island metrics, trends, rankings, and AI-powered analysis for creators, analysts, and platform operators.

## 🎯 Project Goals

### Primary Objectives
1. **Data Collection** - Automated gathering of island metrics from Fortnite's ecosystem API
2. **Trend Analysis** - Identify trending islands, creators, and game modes
3. **Weekly Reporting** - Generate comprehensive discovery reports with AI narratives
4. **Creator Analytics** - Track creator performance and growth patterns
5. **Public Portal** - Shareable reports with public slugs for external consumption

### Key Value Propositions
- **Real-time Insights** - Live data on island performance and player engagement
- **AI-Powered Analysis** - Automated narrative generation and trend detection
- **Creator Empowerment** - Tools for creators to understand their audience
- **Platform Intelligence** - Understanding of the broader UGC ecosystem

## 🏢 Target Users

| User Type | Use Case |
|-----------|----------|
| **UGC Creators** | Track their island performance, understand player behavior |
| **Platform Analysts** | Monitor ecosystem health, identify trends |
| **Content Curators** | Find high-quality islands for promotion |
| **Business Stakeholders** | Make data-driven decisions about the platform |

## 🛠️ Technology Stack

### Frontend Layer
| Technology | Purpose |
|------------|---------|
| **React 18** | UI framework with concurrent features |
| **TypeScript** | Type-safe development |
| **Vite** | Fast development server and build tool |
| **Tailwind CSS** | Utility-first styling |
| **shadcn/ui** | Pre-built accessible components |
| **Radix UI** | Headless UI primitives |
| **TanStack Query** | Server state management |
| **React Router v6** | Client-side routing |
| **Recharts** | Data visualization |
| **React Hook Form** | Form management |
| **i18next** | Internationalization |

### Backend Layer
| Technology | Purpose |
|------------|---------|
| **Supabase** | Backend-as-a-Service platform |
| **PostgreSQL** | Primary database |
| **PostgREST** | Auto-generated REST API |
| **Edge Functions** | Serverless TypeScript functions |
| **pg_cron** | Database job scheduling |
| **Row Level Security (RLS)** | Fine-grained access control |

### AI & Automation
| Technology | Purpose |
|------------|---------|
| **Ralph** | Local AI runner for operations |
| **OpenAI API** | LLM for narrative generation |
| **NVIDIA API** | Alternative LLM provider |

### Data Sources
| Source | Data Provided |
|--------|-------------|
| **Fortnite API** | Island catalog, metrics, player counts |
| **Internal Analytics** | Custom tracking and events |

## 📊 Core Features

### 1. Weekly Discovery Reports
- Automated collection of island metrics
- AI-generated narrative summaries
- Trending islands identification
- Category breakdowns (Battle Royale, Prop Hunt, etc.)
- Historical comparisons

### 2. Island Metrics Dashboard
- **Plays** - Total play sessions
- **Unique Players** - Distinct player count
- **Minutes Played** - Total engagement time
- **Peak CCU** - Concurrent users peak
- **Retention** - Player return rates

### 3. Creator Analytics
- Creator performance tracking
- Portfolio analysis
- Growth trend identification
- Comparative rankings

### 4. Public Report Portal
- SEO-friendly public pages
- Shareable report links (`/reports/:slug`)
- Search and filter capabilities
- Mobile-responsive design

### 5. Admin Tools
- Report creation and editing
- AI-assisted content generation
- User management
- System health monitoring

## 🔄 Data Flow Overview

```
+-----------------+
|  Fortnite API   |
|  (Data Source)  |
+--------+--------+
         |
         v
+-----------------+     +-----------------+
|  Edge Functions |---->|   PostgreSQL    |
|  • discover-*   |     |   (Raw Data)    |
|  • collector    |     |                 |
+-----------------+     +--------+--------+
                                 |
                    +------------+------------+
                    v            v            v
            +----------+  +----------+  +----------+
            |  Reports |  | Exposure |  |  Intel   |
            |  Tables  |  |  Tables  |  |  Tables  |
            +----+-----+  +----+-----+  +----+-----+
                 |             |             |
                 +-------------+-------------+
                               |
                               v
                    +-----------------+
                    |  AI Processing  |
                    |  • ai-analyst   |
                    |  • report-ai    |
                    +--------+--------+
                             |
                             v
                    +-----------------+
                    |  Public Portal  |
                    |  • React App    |
                    |  • Reports      |
                    +-----------------+
```

## 🗓️ Development Timeline

### Phase 1: Foundation
- Core React application setup
- Supabase integration
- Basic island lookup functionality

### Phase 2: Data Pipeline
- Weekly report automation
- Edge Functions for data collection
- Database schema expansion

### Phase 3: AI Integration
- Ralph AI system implementation
- Automated narrative generation
- Memory and context management

### Phase 4: Public Portal
- Public-facing pages
- SEO optimization
- Shareable report links

### Phase 5: Advanced Analytics
- Exposure tracking
- Panel intelligence
- Predictive analytics

## 📈 Success Metrics

- **Data Coverage** - % of islands tracked
- **Report Accuracy** - AI narrative quality scores
- **User Engagement** - Time spent on reports
- **System Uptime** - Pipeline reliability
- **Creator Satisfaction** - Feedback scores

## 🔮 Future Roadmap

- [ ] Real-time analytics dashboard
- [ ] Predictive trend modeling
- [ ] Creator collaboration tools
- [ ] Advanced filtering and search
- [ ] API access for partners
- [ ] Mobile application

---

**Next**: Read [02-ARCHITECTURE.md](./02-ARCHITECTURE.md) to understand the system architecture in detail.
