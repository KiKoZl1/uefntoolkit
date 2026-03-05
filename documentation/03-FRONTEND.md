# 03 - Frontend Documentation

## Overview

The Epic Insight Engine frontend is a **React 18** application built with **TypeScript** and **Vite**. It uses a modern stack including Tailwind CSS for styling, shadcn/ui for components, and TanStack Query for server state management.

## Tech Stack Details

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.3.1 | UI framework |
| TypeScript | 5.8.3 | Type safety |
| Vite | 5.4.19 | Build tool & dev server |
| React Router | 6.30.1 | Client-side routing |
| TanStack Query | 5.83.0 | Server state management |
| Tailwind CSS | 3.4.17 | Utility-first CSS |
| shadcn/ui | latest | Accessible UI components |
| Radix UI | various | Headless UI primitives |
| Recharts | 2.15.4 | Data visualization |
| i18next | 25.8.8 | Internationalization |

## Project Structure

```
src/
+-- components/           # Reusable React components
|   +-- ui/              # shadcn/ui components (40+)
|   +-- navigation/      # Global topbar and mobile drawer
|   +-- discover/        # Discovery-specific components
|   +-- admin/           # Admin-specific components
|   +-- *.tsx            # Layout and routing components
+-- pages/               # Page-level components
|   +-- public/          # Public-facing pages
|   +-- admin/           # Admin dashboard pages
|   +-- *.tsx            # Main app pages
+-- hooks/               # Custom React hooks
+-- integrations/        # Third-party service integrations
|   +-- supabase/        # Supabase client & types
+-- lib/                 # Utility libraries
|   +-- parsing/         # Data processing utilities
+-- i18n/                # Internationalization
|   +-- config.ts        # i18n configuration
|   +-- locales/         # Translation files
+-- navigation/          # Unified nav contracts and visibility rules
+-- test/                # Test files
+-- App.tsx              # Root application component
+-- main.tsx             # Application entry point
+-- index.css            # Global styles
```

## Routing Architecture

### Route Configuration

The application uses **React Router v6** with a nested route structure:

```typescript
// Current route hierarchy (source: src/App.tsx)
/
+-- /                      (Public Home)
+-- /discover              (Public Discover Live)
+-- /reports               (Public Reports List)
+-- /reports/:slug         (Public Report View)
+-- /island^code=XXXX-XXXX-XXXX (Public Island Page)
+-- /auth                  (Authentication)
�
+-- /app                   (Protected App)
+-- /app/island-lookup
+-- /app/projects/:id
+-- /app/projects/:id/reports/:reportId
�
+-- /admin                 (Admin/Editor)
+-- /admin/reports
+-- /admin/reports/:id/edit
+-- /admin/exposure
+-- /admin/intel
+-- /admin/panels
```

### Route Guards

| Component | Purpose | Usage |
|-----------|---------|-------|
| `ProtectedRoute` | Requires authentication | `/app/*` routes |
| `AdminRoute` | Requires admin/editor role | `/admin/*` routes |
| `PublicLayout` | Anonymous access allowed | `/`, `/discover`, `/reports`, `/reports/:slug`, `/island` |
### Layout System

```text
SmartLayout decides layout by auth state:
- user authenticated -> AppLayout (sticky topbar)
- user anonymous -> PublicLayout (sticky topbar + footer)

Admin routes are wrapped by AdminRoute + AdminLayout.
```
## Component Categories

### 1. Layout Components

| Component | File | Purpose |
|-----------|------|---------|
| `SmartLayout` | `SmartLayout.tsx` | Route-based layout selector |
| `PublicLayout` | `PublicLayout.tsx` | Public pages wrapper |
| `AppLayout` | `AppLayout.tsx` | Authenticated app wrapper |
| `AdminLayout` | `AdminLayout.tsx` | Admin dashboard wrapper |
| `TopBar` | `navigation/TopBar.tsx` | Unified sticky navigation bar |
| `MobileTopNav` | `navigation/MobileTopNav.tsx` | Sectioned mobile drawer navigation |

### 2. Route Protection Components

| Component | File | Purpose |
|-----------|------|---------|
| `ProtectedRoute` | `ProtectedRoute.tsx` | Authentication guard |
| `AdminRoute` | `AdminRoute.tsx` | Role-based access control |

### Navigation Contracts

Unified contracts live in `src/navigation/`:
- `NavItem`
- `NavSection`
- `NavVisibilityRule` (`anon`, `authenticated`, `client`, `editor`, `admin`)
- `TopBarContext` (`public`, `app`, `admin`)

The top bar resolves items by route context + role visibility and keeps platform/app/admin navigation in one source of truth.

### 3. UI Components (shadcn/ui)

Located in `src/components/ui/`, these are **40+ accessible components** built on Radix UI primitives:

**Layout Components:**
- `accordion`, `collapsible`, `tabs`, `separator`, `scroll-area`
- `resizable`, `sidebar`, `sheet`, `drawer`

**Form Components:**
- `button`, `input`, `textarea`, `select`, `checkbox`, `radio-group`
- `switch`, `slider`, `calendar`, `date-picker`
- `form`, `label`, `input-otp`

**Feedback Components:**
- `alert`, `alert-dialog`, `dialog`, `toast`, `sonner`
- `progress`, `skeleton`, `spinner`

**Data Display:**
- `table`, `card`, `badge`, `avatar`, `tooltip`
- `hover-card`, `popover`, `chart`

**Navigation:**
- `breadcrumb`, `navigation-menu`, `menubar`, `pagination`
- `dropdown-menu`, `context-menu`, `command`

**Overlay:**
- `dialog`, `alert-dialog`, `sheet`, `drawer`, `hover-card`
- `popover`, `tooltip`, `context-menu`

### 4. Discovery Components

Located in `src/components/discover/`, specialized for analytics:

| Component | Purpose |
|-----------|---------|
| `AiNarrative.tsx` | AI-generated narrative display |
| `DistributionChart.tsx` | Data distribution visualization |
| `EvolutionDashboard.tsx` | Metrics evolution over time |
| `KpiCard.tsx` | Key performance indicator cards |
| `MoversTable.tsx` | Top movers and shakers table |
| `RankingTable.tsx` | Island/creator rankings |
| `ReportSkeleton.tsx` | Loading state for reports |
| `SectionHeader.tsx` | Consistent section headers |

### 5. Admin Components

Located in `src/components/admin/`:

| Component | Purpose |
|-----------|---------|
| `ReportPreview.tsx` | Live report preview |

### 6. Utility Components

| Component | Purpose |
|-----------|---------|
| `LanguageSwitcher.tsx` | i18n locale selection |
| `ZipUploader.tsx` | Bulk ZIP file upload |

## Page Components

### Public Pages (`src/pages/public/`)

| Page | Route | Purpose |
|------|-------|---------|
| `Home.tsx` | `/` | Landing page with platform overview |
| `DiscoverLive.tsx` | `/discover` | Live discovery data |
| `ReportsList.tsx` | `/reports` | Public reports listing |
| `ReportView.tsx` | `/reports/:slug` | Individual report view |
| `IslandPage.tsx` | `/island^code=...` | Public island analytics page |

### App Pages (`src/pages/`)

| Page | Route | Purpose |
|------|-------|---------|
| `Auth.tsx` | `/auth` | Authentication (login/register) |
| `AppDashboard.tsx` | `/app` | User dashboard |
| `IslandLookup.tsx` | `/app/island-lookup` | Island search tool |
| `ProjectDetail.tsx` | `/app/projects/:id` | Project details |
| `ReportDashboard.tsx` | `/app/projects/:id/reports/:reportId` | Project report dashboard |
| `NotFound.tsx` | `*` | 404 page |

### Admin Pages (`src/pages/admin/`)

| Page | Route | Purpose |
|------|-------|---------|
| `AdminOverview.tsx` | `/admin` | Admin dashboard overview |
| `AdminReportsList.tsx` | `/admin/reports` | Manage all reports |
| `AdminReportEditor.tsx` | `/admin/reports/:id/edit` | Create/edit reports |
| `AdminExposureHealth.tsx` | `/admin/exposure` | Exposure system health |
| `AdminIntel.tsx` | `/admin/intel` | Intelligence dashboard |
| `AdminPanelManager.tsx` | `/admin/panels` | Panel management |
## Custom Hooks

Located in `src/hooks/`:

| Hook | Purpose |
|------|---------|
| `useAuth.tsx` | Authentication context and methods |
| `use-mobile.tsx` | Mobile device detection |
| `use-toast.ts` | Toast notification system |

### useAuth Hook

```typescript
// Provides authentication state and methods
const {
  user,           // Current user object
  session,        // Supabase session
  userRole,       // 'admin' | 'editor' | 'client'
  isLoading,      // Auth state loading
  signIn,         // Login method
  signUp,         // Register method
  signOut,        // Logout method
  isAdmin,        // Boolean check
  isEditor        // Boolean check
} = useAuth();
```

## State Management

### Server State (TanStack Query)

```typescript
// Example: Fetching reports
const { data, isLoading, error } = useQuery({
  queryKey: ['reports', page],
  queryFn: () => fetchReports(page),
  staleTime: 5 * 60 * 1000, // 5 minutes
});
```

### Client State (React Context)

- **Auth Context** (`useAuth.tsx`): User authentication state
- **Theme Context** (via next-themes): Dark/light mode

## Styling Architecture

### Tailwind CSS Configuration

```typescript
// tailwind.config.ts
{
  theme: {
    extend: {
      colors: {
        // Custom brand colors
        primary: {...},
        secondary: {...},
        // shadcn/ui theme colors
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        // ...
      }
    }
  }
}
```

### CSS Organization

| File | Purpose |
|------|---------|
| `index.css` | Global styles, Tailwind directives, CSS variables |
| `App.css` | App-specific styles (minimal) |

### Theme System

Uses **next-themes** for dark/light mode:
- CSS variables for colors
- `dark` class on html element
- Automatic system preference detection

## Internationalization (i18n)

### Configuration

```typescript
// src/i18n/config.ts
i18n
  .use(LanguageDetector)  // Detect user language
  .use(initReactI18next)  // React integration
  .init({
    resources: {
      en: { translation: enTranslations },
      "pt-BR": { translation: ptBRTranslations },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'pt-BR'],
  });
```

### Supported Languages

| Language | Code | Status |
|----------|------|--------|
| English | `en` | ^ Complete |
| Portuguese (Brazil) | `pt-BR` | ^ Complete |
### Usage

```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();
  return <h1>{t('welcome.title')}</h1>;
}
```

## Data Fetching Patterns

### 1. Query with Loading State

```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ['islands', islandCode],
  queryFn: () => fetchIslandData(islandCode),
});

if (isLoading) return <ReportSkeleton />;
if (error) return <ErrorMessage error={error} />;
return <IslandView data={data} />;
```

### 2. Mutation with Optimistic Updates

```typescript
const mutation = useMutation({
  mutationFn: updateReport,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['reports'] });
    toast.success('Report updated');
  },
});
```

### 3. Infinite Scroll

```typescript
const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
} = useInfiniteQuery({
  queryKey: ['reports'],
  queryFn: fetchReportsPage,
  getNextPageParam: (lastPage) => lastPage.nextCursor,
});
```

## Form Handling

Using **React Hook Form** with **Zod** validation:

```typescript
const form = useForm<ReportFormData>({
  resolver: zodResolver(reportSchema),
  defaultValues: {
    title: '',
    content: '',
  },
});

<form onSubmit={form.handleSubmit(onSubmit)}>
  <Input {...form.register('title')} />
  {form.formState.errors.title && (
    <ErrorMessage>{form.formState.errors.title.message}</ErrorMessage>
  )}
  <Button type="submit">Save</Button>
</form>
```

## Chart Components

Using **Recharts** for data visualization:

```typescript
import { LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';

<LineChart data={data}>
  <XAxis dataKey="date" />
  <YAxis />
  <Tooltip />
  <Line type="monotone" dataKey="plays" stroke="#8884d8" />
</LineChart>
```

## Testing

### Test Setup

| File | Purpose |
|------|---------|
| `src/test/setup.ts` | Test environment setup |
| `vitest.config.ts` | Vitest configuration |

### Running Tests

```bash
npm run test        # Run tests once
npm run test:watch  # Run tests in watch mode
```

### Example Test

```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

describe('Component', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

## Build Configuration

### Vite Configuration

| File | Purpose |
|------|---------|
| `vite.config.ts` | Main Vite configuration |
| `tsconfig.app.json` | TypeScript app config |
| `tsconfig.node.json` | TypeScript Node config |

### Environment Variables

| Variable | Vite Prefix | Purpose |
|----------|-------------|---------|
| `VITE_SUPABASE_URL` | `VITE_` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `VITE_` | Supabase anon key |

**Note**: Only variables with `VITE_` prefix are exposed to the frontend.

## Performance Optimizations

1. **Code Splitting**: Route-based lazy loading
2. **Query Caching**: TanStack Query stale-while-revalidate
3. **Image Optimization**: Lazy loading, proper sizing
4. **Bundle Analysis**: Vite build analysis
5. **Tree Shaking**: Dead code elimination

## Best Practices

### Component Guidelines

1. **Functional Components**: Use function declarations
2. **Props Interface**: Define with TypeScript interfaces
3. **Default Exports**: One default export per file
4. **Composition**: Prefer composition over inheritance
5. **Accessibility**: Use shadcn/ui for a11y compliance

### State Management Guidelines

1. **Server State**: Use TanStack Query
2. **Client State**: Use React Context sparingly
3. **URL State**: Use React Router for shareable state
4. **Form State**: Use React Hook Form

### Styling Guidelines

1. **Tailwind First**: Use Tailwind utilities
2. **Component Classes**: Use `cn()` utility for conditional classes
3. **CSS Variables**: Use for theme values
4. **Responsive**: Mobile-first approach

---

**Next**: Read [04-BACKEND.md](./04-BACKEND.md) for backend documentation.



