# 07 - Deployment Guide

## Overview

This guide covers deploying Epic Insight Engine to production environments. The application consists of a React frontend, Supabase backend, and optional Ralph AI system.

## Deployment Architecture

```
+-------------------------------------------------------------+
|                     PRODUCTION SETUP                         |
|                                                              |
|  +--------------+  +--------------+  +--------------+       |
|  |   Frontend   |  |   Supabase   |  |    Ralph     |       |
|  |   (Vite)     |  |   (Backend)  |  |   (Local)    |       |
|  |              |  |              |  |              |       |
|  | • Static     |  | • Postgres   |  | • AI Runner  |       |
|  |   Hosting    |  | • Auth       |  | • Memory     |       |
|  | • CDN        |  | • Functions  |  | • Automation |       |
|  | • HTTPS      |  | • Storage    |  |              |       |
|  +--------------+  +--------------+  +--------------+       |
|                                                              |
+-------------------------------------------------------------+
```

## Prerequisites

### System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Node.js | 18.x | 20.x LTS |
| npm/bun | 9.x | 10.x |
| Git | 2.x | Latest |
| Supabase CLI | 1.x | Latest |

### Accounts Required

| Service | Purpose | Free Tier |
|---------|---------|-----------|
| Supabase | Backend, Auth, Database | ✅ Yes |
| Vercel/Netlify | Frontend hosting | ✅ Yes |
| OpenAI | AI narrative generation | ❌ Paid |
| NVIDIA | Alternative AI provider | ✅ Limited |

## Environment Setup

### 1. Clone Repository

```bash
git clone <repository-url>
cd epic-insight-engine
```

### 2. Install Dependencies

```bash
# Using npm
npm install

# Using bun (faster)
bun install
```

### 3. Environment Variables

Create `.env` file in project root:

```env
# Supabase Configuration (Required)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# AI Providers (At least one required)
OPENAI_API_KEY=sk-your-openai-key
OPENAI_MODEL=gpt-4.1-mini

# OR
NVIDIA_API_KEY=your-nvidia-api-key

# Optional: Ralph Configuration
RALPH_LOG_LEVEL=info
RALPH_INTERVAL_MS=60000
```

## Supabase Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click "New Project"
3. Choose organization and name
4. Select region closest to your users
5. Wait for project creation (2-3 minutes)

### 2. Get API Keys

In Supabase Dashboard:
1. Go to **Project Settings** → **API**
2. Copy `URL` → `VITE_SUPABASE_URL` and `SUPABASE_URL`
3. Copy `anon public` → `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Copy `service_role secret` → `SUPABASE_SERVICE_ROLE_KEY`

**⚠️ Security**: Never commit `SUPABASE_SERVICE_ROLE_KEY` to git!

### 3. Database Setup

#### Option A: Using Supabase CLI (Recommended)

```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Push migrations
supabase db push
```

#### Option B: Manual SQL Execution

1. Go to Supabase Dashboard → SQL Editor
2. Open migration files from `supabase/migrations/`
3. Execute in order (by timestamp)

### 4. Edge Functions Deployment

```bash
# Deploy all functions
supabase functions deploy

# Or deploy specific functions
supabase functions deploy discover-collector
supabase functions deploy discover-report-rebuild
supabase functions deploy discover-report-ai
# ... etc
```

### 5. Configure Authentication

In Supabase Dashboard:
1. Go to **Authentication** → **Providers**
2. Enable **Email** provider
3. (Optional) Enable **Google** OAuth:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create OAuth 2.0 credentials
   - Add redirect URL: `https://your-project.supabase.co/auth/v1/callback`
   - Copy Client ID and Secret to Supabase

### 6. Set Up Cron Jobs

Preferred: apply migrations (`supabase db push`). Cron jobs are provisioned by migration SQL.

If you need to validate after deploy, check `cron.job` for these names:

| Job name | Schedule | Target |
|---|---|---|
| `discover-collector-orchestrate-minute` | `* * * * *` | `discover-collector` (`mode=orchestrate`) |
| `discover-collector-weekly-v2` | `0 6 * * 1` | `discover-collector` (`mode=start`) |
| `discover-links-metadata-orchestrate-minute` | `* * * * *` | `discover-links-metadata-collector` (`mode=orchestrate`) |
| `discover-exposure-collector-orchestrate-minute` | `* * * * *` | `discover-exposure-collector` (`mode=orchestrate`) |
| `discover-exposure-maintenance-daily` | `7 0 * * *` | `discover-exposure-collector` (`mode=maintenance`) |
| `discover-exposure-raw-cleanup-hourly` | `5 * * * *` | `discover-exposure-collector` (`mode=maintenance`, raw cleanup) |
| `discover-island-page-cache-refresh-5min` | `*/5 * * * *` | `discover-island-page` (`mode=refresh_cache`) |
| `discover-island-page-cache-cleanup-hourly` | `0 * * * *` | SQL cleanup by `last_accessed_at` |
| `discover-panel-intel-refresh-10min` | `*/10 * * * *` | `discover-panel-intel-refresh` |

All mutating cron calls must run with service-role authorization (Bearer + apikey where required by migration).`r`n`r`n### 7. Configure Storage (Optional)

For file uploads:
1. Go to **Storage** → **New Bucket**
2. Create `uploads` bucket
3. Set RLS policies for access control

## Frontend Deployment

### Option 1: Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Production deployment
vercel --prod
```

**Configuration**:
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

**Environment Variables in Vercel**:
Add these in Vercel Dashboard → Project Settings → Environment Variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

### Option 2: Netlify

```bash
# Install Netlify CLI
npm i -g netlify-cli

# Deploy
netlify deploy

# Production deployment
netlify deploy --prod
```

**Configuration**:
- Build Command: `npm run build`
- Publish Directory: `dist`

### Option 3: Static Hosting

Build locally and upload:

```bash
# Build for production
npm run build

# Output is in dist/ folder
# Upload dist/ contents to your static host
```

## Ralph AI Deployment

### Local Machine Setup

Ralph runs on a local machine (not serverless):

```bash
# 1. Ensure environment variables are set
# See .env configuration above

# 2. Start Ralph
npm run ralph:local

# 3. Or use the loop harness for auto-restart
npm run ralph:loop
```

### Server Deployment (Optional)

For 24/7 operation, deploy to a VPS or dedicated server:

```bash
# Using PM2 for process management
npm install -g pm2

pm2 start scripts/ralph_local_runner.mjs --name ralph

# Save PM2 config
pm2 save
pm2 startup
```

### Docker Deployment (Optional)

Create `Dockerfile`:
```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

CMD ["node", "scripts/ralph_local_runner.mjs"]
```

Build and run:
```bash
docker build -t epic-ralph .
docker run -d --env-file .env epic-ralph
```

## Post-Deployment Verification

### 1. Frontend Checks

- [ ] Homepage loads without errors
- [ ] Authentication works (sign up/in)
- [ ] Public reports are accessible
- [ ] Admin panel loads (with admin account)
- [ ] No console errors

### 2. Backend Checks

```bash
# Test Edge Functions
curl https://your-project.supabase.co/functions/v1/discover-island-lookup \
  -H "Authorization: Bearer YOUR_ANON_KEY"

# Check database tables
supabase db dump --data-only
```

### 3. Pipeline Checks

- [ ] Weekly report pipeline runs (check `discover_report_rebuild_runs`)
- [ ] Exposure data is collecting (check `discovery_exposure_entries_raw`)
- [ ] Cron jobs are scheduled (query `cron.job` table)

### 4. Ralph Checks

```bash
# Check Ralph is running
npm run ralph:memory:query

# Verify memory tables are populated
# Check ralph_runs for execution logs
```

## Environment-Specific Configurations

### Development

```env
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_PUBLISHABLE_KEY=local-anon-key
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=local-service-key
```

### Staging

```env
VITE_SUPABASE_URL=https://staging-project.supabase.co
# ... other staging credentials
```

### Production

```env
VITE_SUPABASE_URL=https://prod-project.supabase.co
# ... production credentials
RALPH_LOG_LEVEL=warn  # Less verbose in production
```

## Security Checklist

- [ ] **Service Role Key**: Never exposed to frontend
- [ ] **RLS Policies**: Enabled on all tables
- [ ] **CORS**: Configured for your domain only
- [ ] **HTTPS**: Enforced in production
- [ ] **Secrets**: Stored in environment variables, not code
- [ ] **API Keys**: Rotated regularly
- [ ] **Database**: Regular backups enabled
- [ ] **Functions**: Rate limiting configured

## Monitoring & Logging

### Supabase Monitoring

1. **Database**: Dashboard → Database → Usage
2. **Auth**: Dashboard → Authentication → Users
3. **Functions**: Dashboard → Edge Functions → Logs
4. **API**: Dashboard → API → Usage

### Application Monitoring

Add to frontend:
```typescript
// Error tracking (e.g., Sentry)
import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: 'your-sentry-dsn',
  environment: 'production',
});
```

### Ralph Monitoring

Ralph logs to:
- Console (stdout/stderr)
- `ralph_runs` table
- `ralph_incidents` table

## Backup & Recovery

### Database Backups

Supabase provides automatic backups:
- Daily backups retained for 7 days (free tier)
- Point-in-time recovery (paid tier)

Manual backup:
```bash
supabase db dump --file backup.sql
```

### Code Backups

- Repository hosted on GitHub/GitLab
- Branch protection rules
- Regular tags for releases

## Scaling Considerations

### Database

| Metric | Free Tier | Pro Tier | Team/Business |
|--------|-----------|----------|---------------|
| Database Size | 500 MB | 8 GB | 100+ GB |
| Bandwidth | 2 GB | 100 GB | 1 TB+ |
| Connections | 30 | 60 | 300+ |

### Edge Functions

- Stateless and auto-scaling
- Monitor execution counts
- Optimize cold starts

### Frontend

- Static hosting scales automatically
- Use CDN for global distribution
- Implement caching strategies

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Build fails | Check Node version (18+) |
| Functions timeout | Increase timeout in config |
| CORS errors | Verify CORS settings in Supabase |
| Auth not working | Check redirect URLs match |
| Ralph won't start | Verify all env vars set |

### Getting Help

1. Check logs: `supabase functions logs discover-collector`
2. Review migrations: Ensure all applied
3. Test locally: `npm run dev` before deploying
4. Check status: [status.supabase.com](https://status.supabase.com)

## Maintenance

### Regular Tasks

| Task | Frequency | Command/Action |
|------|-----------|--------------|
| Dependency updates | Monthly | `npm update` |
| Security patches | As needed | Monitor advisories |
| Database cleanup | Weekly | Run retention jobs |
| Log rotation | Daily | Automated |
| Backup verification | Monthly | Restore test |

### Update Procedure

1. Test updates in staging
2. Create database backup
3. Deploy code changes
4. Run migrations if needed
5. Verify deployment
6. Monitor for issues

---

**Next**: Read [08-DEVELOPMENT.md](./08-DEVELOPMENT.md) for development workflow.


