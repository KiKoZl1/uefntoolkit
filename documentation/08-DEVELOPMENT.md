# 08 - Development Guide

## Overview

This guide covers the development workflow for Epic Insight Engine, including setup, coding standards, testing, and contribution guidelines.

## Development Environment

### Recommended Tools

| Tool | Purpose | Installation |
|------|---------|--------------|
| VS Code | IDE | [code.visualstudio.com](https://code.visualstudio.com) |
| Node.js 20 | Runtime | [nodejs.org](https://nodejs.org) |
| Bun (optional) | Package manager | [bun.sh](https://bun.sh) |
| Supabase CLI | Backend management | `npm i -g supabase` |
| Git | Version control | [git-scm.com](https://git-scm.com) |

### VS Code Extensions

Recommended extensions for this project:

- **ESLint** - Code linting
- **Prettier** - Code formatting
- **Tailwind CSS IntelliSense** - CSS autocomplete
- **TypeScript Importer** - Auto-imports
- **GitLens** - Git integration
- **Thunder Client** - API testing

## Project Setup

### 1. Clone and Install

```bash
# Clone repository
git clone <repository-url>
cd epic-insight-engine

# Install dependencies
npm install

# Or with bun
bun install
```

### 2. Environment Configuration

Create `.env` file:

```env
# Supabase (Local or Cloud)
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbG...
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...

# AI Providers (Optional for development)
OPENAI_API_KEY=sk-...
NVIDIA_API_KEY=nvapi-...
```

### 3. Start Development Server

```bash
# Start Vite dev server
npm run dev

# App available at http://localhost:8080
```

### 4. Start Local Supabase (Optional)

```bash
# Start local Supabase
supabase start

# Stop when done
supabase stop
```

## Development Workflow

### Branch Strategy

```
main (production)
  |
  +-- feature/weekly-report-improvements
  +-- feature/exposure-analytics
  +-- bugfix/auth-redirect-issue
  +-- hotfix/critical-security-patch
```

**Branch Naming**:
- `feature/description` - New features
- `bugfix/description` - Bug fixes
- `hotfix/description` - Critical fixes
- `docs/description` - Documentation updates

### Commit Convention

Follow conventional commits:

```
type(scope): description

[optional body]

[optional footer]
```

**Types**:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `style` - Formatting
- `refactor` - Code restructuring
- `test` - Tests
- `chore` - Maintenance

**Examples**:
```
feat(discover): add island comparison chart

fix(auth): resolve redirect loop on login

docs(readme): update deployment instructions

refactor(pipelines): simplify exposure collector
```

### Pull Request Process

1. Create feature branch from `main`
2. Make changes with clear commits
3. Run tests and linting
4. Push branch to remote
5. Create Pull Request with:
   - Clear title and description
   - Screenshots (if UI changes)
   - Test results
   - Related issue links

## Code Standards

### TypeScript Guidelines

#### Types

```typescript
// Use interfaces for objects
interface Island {
  code: string;
  name: string;
  creator: string;
  plays: number;
}

// Use type for unions/aliases
type IslandStatus = 'active' | 'inactive' | 'pending';

// Explicit return types on functions
function calculateTrend(current: number, previous: number): number {
  return ((current - previous) / previous) * 100;
}
```

#### Naming

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `IslandLookup.tsx` |
| Hooks | camelCase, use prefix | `useAuth.tsx` |
| Functions | camelCase | `fetchIslandData` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Types/Interfaces | PascalCase | `IslandData` |
| Files | camelCase or PascalCase | `utils.ts`, `Button.tsx` |

### React Guidelines

#### Component Structure

```typescript
// Imports
import React from 'react';
import { useQuery } from '@tanstack/react-query';

// Types
interface Props {
  islandCode: string;
}

// Component
export function IslandCard({ islandCode }: Props) {
  // Hooks
  const { data, isLoading } = useQuery({...});
  
  // Handlers
  const handleClick = () => {...};
  
  // Render
  if (isLoading) return <Skeleton />;
  
  return (
    <Card>
      <h3>{data.name}</h3>
    </Card>
  );
}
```

#### Hook Rules

1. Only call hooks at the top level
2. Only call hooks from React functions
3. Use custom hooks for reusable logic
4. Prefix custom hooks with `use`

### Styling Guidelines

#### Tailwind CSS

```typescript
// Use cn() utility for conditional classes
import { cn } from '@/lib/utils';

<div className={cn(
  "base-classes",
  isActive && "active-classes",
  size === 'lg' && "text-lg"
)}>
```

#### Order of Classes

1. Layout (display, position, flex, grid)
2. Box model (width, height, margin, padding)
3. Visual (background, border, shadow)
4. Typography (font, text, color)
5. Transforms/Animations

### Database Guidelines

#### Migrations

```sql
-- Naming: YYYYMMDDHHMMSS_description.sql
-- Example: 20260215120000_add_island_index.sql

-- Always wrap in transaction
BEGIN;

-- Add new column
ALTER TABLE discover_islands 
ADD COLUMN rating_average DECIMAL(3,2);

-- Create index
CREATE INDEX idx_islands_rating 
ON discover_islands(rating_average);

COMMIT;
```

#### RLS Policies

```sql
-- Enable RLS
ALTER TABLE discover_reports ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY "Users can view own reports"
ON discover_reports
FOR SELECT
TO authenticated
USING (user_id = auth.uid());
```

## Testing

### Test Structure

```
src/
+-- test/
    +-- setup.ts           # Test configuration
    +-- example.test.ts    # Example tests
    +-- utils/
        +-- test-helpers.ts # Test utilities
```

### Running Tests

```bash
# Run all tests
npm run test

# Run in watch mode
npm run test:watch

# Run with coverage
npm run test -- --coverage
```

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IslandCard } from '@/components/IslandCard';

describe('IslandCard', () => {
  it('renders island name', () => {
    render(<IslandCard islandCode="1234-5678" />);
    expect(screen.getByText('Test Island')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<IslandCard islandCode="1234-5678" />);
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });
});
```

### Test Categories

| Type | Purpose | Location |
|------|---------|----------|
| Unit | Individual functions | Co-located or `test/` |
| Component | React components | `test/components/` |
| Integration | API + DB | `test/integration/` |
| E2E | Full workflows | `test/e2e/` |

## Debugging

### Frontend Debugging

```typescript
// Use console.log sparingly
console.log('Debug:', data);

// Better: use debugger
debugger; // Pauses execution in DevTools

// React DevTools
// Install browser extension for component inspection
```

### Backend Debugging

```bash
# View Edge Function logs
supabase functions logs discover-collector

# Tail logs in real-time
supabase functions logs discover-collector --tail

# Check database logs
supabase db logs
```

### Ralph Debugging

```bash
# Run with debug logging
RALPH_LOG_LEVEL=debug npm run ralph:local

# Query memory
npm run ralph:memory:query
```

## Common Development Tasks

### Adding a New Page

1. Create page component in `src/pages/`
2. Add route in `App.tsx`
3. Add navigation link (if needed)
4. Create test file

### Adding an Edge Function

1. Create function in `supabase/functions/`
2. Add `index.ts` with handler
3. Deploy: `supabase functions deploy function-name`
4. Add cron job if scheduled

### Adding a Database Table

1. Create migration: `supabase migration new description`
2. Write SQL in generated file
3. Apply: `supabase db push`
4. Update types if needed

### Adding a Component

1. Create file in `src/components/` or `src/components/ui/`
2. Use shadcn/ui pattern if UI component
3. Add to barrel export if needed
4. Write tests

## Performance Optimization

### Frontend

1. **Code Splitting**: Use dynamic imports
   ```typescript
   const HeavyComponent = lazy(() => import('./HeavyComponent'));
   ```

2. **Memoization**: Use `useMemo` and `useCallback`
   ```typescript
   const expensiveValue = useMemo(() => compute(data), [data]);
   ```

3. **Query Optimization**: Configure TanStack Query
   ```typescript
   const { data } = useQuery({
     queryKey: ['islands'],
     queryFn: fetchIslands,
     staleTime: 5 * 60 * 1000, // 5 minutes
   });
   ```

### Backend

1. **Database Indexes**: Add indexes for frequent queries
2. **Edge Function Caching**: Use appropriate cache headers
3. **Batch Operations**: Process data in batches
4. **Connection Pooling**: Use Supabase connection pooler

## Code Review Checklist

### For Authors

- [ ] Tests pass locally
- [ ] Linting passes (`npm run lint`)
- [ ] Type checking passes (`npx tsc --noEmit`)
- [ ] Self-reviewed code
- [ ] Clear commit messages
- [ ] PR description explains changes

### For Reviewers

- [ ] Code follows style guidelines
- [ ] Logic is clear and correct
- [ ] Tests cover new functionality
- [ ] No security vulnerabilities
- [ ] Performance considerations addressed
- [ ] Documentation updated if needed

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| `Module not found` | Check import path, run `npm install` |
| `Type error` | Run `npx tsc --noEmit` to see all errors |
| `Test fails` | Check test setup in `test/setup.ts` |
| `Build fails` | Clear `dist/` and `node_modules/.vite` |
| `Supabase connection refused` | Ensure `supabase start` is running |

### Getting Unstuck

1. **Check logs**: Console, terminal, Supabase logs
2. **Isolate issue**: Comment out code to find problem
3. **Search history**: `git log --all --grep="keyword"`
4. **Ask for help**: Create issue with reproduction steps

## Resources

### Documentation

- [React Docs](https://react.dev)
- [TypeScript Handbook](https://typescriptlang.org/docs)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [Supabase Docs](https://supabase.com/docs)
- [TanStack Query](https://tanstack.com/query/latest)

### Internal References

- `documentation/README.md` - Documentation index
- `documentation/02-ARCHITECTURE.md` - System architecture
- `documentation/04-BACKEND.md` - Backend details
- `docs/archive/` - Historical context (read-only)

## Contributing

### Before Contributing

1. Read [01-PROJECT-OVERVIEW.md](./01-PROJECT-OVERVIEW.md)
2. Understand the architecture
3. Set up development environment
4. Join team communication channels

### Contribution Areas

| Area | Skills Needed | Complexity |
|------|---------------|------------|
| Frontend | React, TypeScript, Tailwind | Medium |
| Backend | SQL, Edge Functions | Medium |
| Data Pipelines | Data engineering, APIs | High |
| AI/Ralph | LLMs, automation | High |
| Documentation | Technical writing | Low |

### Recognition

Contributors will be:
- Listed in project credits
- Mentioned in release notes
- Invited to team events

---

**Questions^** Check the documentation index in [README.md](./README.md) or ask the team.

Happy coding! 🚀
