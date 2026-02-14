# Setup Guide

This guide covers the complete setup process for Epic Insight Engine.

## Prerequisites

### Software Requirements

| Software | Version | Notes |
|----------|---------|-------|
| Node.js | 18+ | LTS recommended |
| npm | 9+ | Or bun for faster installs |
| Git | 2.30+ | For version control |
| Supabase CLI | Latest | For local development |

### Account Requirements

- Supabase project (free tier works)
- Fortnite API access (for production data collection)

## Step 1: Clone the Repository

```bash
git clone <repository-url>
cd epic-insight-engine
```

## Step 2: Install Dependencies

Using npm:
```bash
npm install
```

Or using bun (faster):
```bash
bun install
```

## Step 3: Environment Configuration

### Creating Environment Files

Create the following files in the project root:

#### `.env` (Required)
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
```

#### `.env.local` (Optional - for development)
```env
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_PUBLISHABLE_KEY=your-local-anon-key
```

### Getting Supabase Credentials

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Create a new project or select existing
3. Go to **Project Settings** → **API**
4. Copy the **Project URL** and **anon public** key

## Step 4: Database Setup

### Option A: Local Development

```bash
# Install Supabase CLI
npm install -g supabase

# Start local Supabase
supabase start
```

### Option B: Production Database

Run the migrations in `supabase/migrations/`:

```bash
supabase db push
```

Or manually execute the SQL files in your Supabase dashboard's SQL editor.

## Step 5: Run the Application

### Development Mode

```bash
npm run dev
```

The application will be available at `http://localhost:8080`

### Production Build

```bash
npm run build
npm run preview
```

## Step 6: Verify Setup

### Check Application Loads

1. Open `http://localhost:8080`
2. Verify the home page renders
3. Check browser console for errors

### Check Authentication

1. Navigate to `/auth`
2. Try signing up with a test account
3. Verify email confirmation works

### Check Database Connection

1. Sign in to the application
2. Open browser DevTools
3. Check network tab for successful Supabase requests

## Development Tools

### Running Tests

```bash
# Run tests once
npm run test

# Watch mode
npm run test:watch
```

### Linting

```bash
npm run lint
```

### Type Checking

```bash
npx tsc --noEmit
```

## Troubleshooting

### Common Issues

#### "VITE_SUPABASE_URL is not set"
- Ensure `.env` file exists in project root
- Restart dev server after creating `.env`

#### "CORS errors"
- Check Supabase dashboard → API → CORS settings
- Add `http://localhost:8080` to allowed origins

#### "Authentication not working"
- Verify Supabase Auth settings in dashboard
- Check email confirmation settings

#### "Database tables not found"
- Run migrations: `supabase db push`
- Check if tables exist in Supabase dashboard

### Getting Help

- Check Supabase logs in dashboard
- Review Edge Function logs
- Check browser console for errors

