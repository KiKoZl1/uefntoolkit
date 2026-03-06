# 03 - Frontend Documentation (As-Built)

## Overview

The frontend is a React 18 + TypeScript + Vite application with:
- Tailwind CSS + shadcn/Radix UI primitives
- React Router v6 with nested layouts and route guards
- TanStack Query for server-state caching
- Supabase client for DB and Edge Function integration
- i18next (`en`, `pt-BR`) for localization

## Current Navigation Architecture

Navigation is unified in a sticky top bar (public/app/admin):
- `src/components/navigation/TopBar.tsx`
- `src/components/navigation/MobileTopNav.tsx`
- `src/navigation/config.ts`
- `src/navigation/types.ts`

Contracts in use:
- `NavItem`
- `NavSection`
- `NavVisibilityRule` (`anon`, `authenticated`, `client`, `editor`, `admin`)
- `TopBarContext` (`public`, `app`, `admin`)

## Routing & Layouts

Routes are defined in `src/App.tsx` and now use `React.lazy + Suspense` for route-level splitting.

Layouts:
- `SmartLayout` (chooses public/app shell by auth)
- `PublicLayout`
- `AppLayout`
- `AdminLayout`

Guards:
- `ProtectedRoute` for `/app/*`
- `AdminRoute` for `/admin/*`

## UX State System

A reusable page-state kit is now available:
- `src/types/page-state.ts`
- `src/components/ui/page-state.tsx`

Used to standardize loading/empty/error states in priority pages:
- `/reports` (`ReportsList`)
- `/discover` (`DiscoverLive`)
- `/island` (`IslandPage`)
- `/app` (`AppDashboard`)

## Data Fetching Pattern

Public high-traffic routes now use React Query hooks in:
- `src/hooks/queries/publicQueries.ts`

Implemented hooks:
- `usePublicReportsQuery()`
- `useDiscoverLiveQuery(region)`
- `useIslandPageQuery(islandCode, enabled)`

Notes:
- stale/cache windows configured in hooks and QueryClient
- backend contracts were preserved (no API/Supabase contract change)

## Performance (As-Built)

### Route and chunk strategy

- Route-level lazy loading in `src/App.tsx`
- Heavy 3D preview lazy loaded in `CameraControlPage` (`CameraGizmo3D` via `React.lazy`)
- Manual chunking configured in `vite.config.ts`:
  - `vendor-react`
  - `vendor-data`
  - `vendor-radix`
  - `vendor-charts`
  - `vendor-three`
  - `route-admin`
  - `route-thumb-tools`
  - `route-discovery`

### Build snapshot (local)

Before refactor (single main bundle):
- `index-*.js`: ~2,476 kB (gzip ~669 kB)

After refactor:
- entry `index-*.js`: ~122 kB (gzip ~40 kB)
- heavy code shifted to route/vendor chunks loaded on demand

This exceeds the minimum acceptance goal of 20% gzip reduction on initial public load.

## Accessibility (Current)

Implemented in this refactor:
- visible focus rings preserved in nav/dropdowns/drawer components
- keyboard interaction maintained for tools flyout and mobile drawer
- `Auth` inputs updated with proper `autocomplete`:
  - `email`
  - `current-password`
  - `new-password`
  - `name` (signup)
- `LanguageSwitcher` trigger now has accessible label
- reduced-motion nav tokens are respected in `src/index.css`

## Lint/Test/Build Commands

- `npm run build`
- `npm run test`
- `npm run test:e2e`
- `npm run lint`

Current status:
- build passing
- unit tests passing
- e2e smoke passing
- lint passing with existing project warnings (no new lint errors)
- route screenshots captured in `documentation/artifacts/frontend-smoke-2026-03-05/`

## Known Gaps / Follow-ups

- Large legacy warning surface (`any`, hook deps, refresh rules) remains across app/admin/supabase files.
- Some legacy translation strings still contain mojibake outside the refactor scope.
- `vendor-three` remains large by nature; further reductions would require feature-level code splitting or 3D dependency optimization.

## Main Files Touched in This Refactor

- `src/App.tsx`
- `src/components/LanguageSwitcher.tsx`
- `src/components/ui/page-state.tsx`
- `src/types/page-state.ts`
- `src/hooks/queries/publicQueries.ts`
- `src/pages/public/ReportsList.tsx`
- `src/pages/public/DiscoverLive.tsx`
- `src/pages/public/IslandPage.tsx`
- `src/pages/AppDashboard.tsx`
- `src/pages/Auth.tsx`
- `src/pages/thumb-tools/CameraControlPage.tsx`
- `src/pages/Index.tsx` (removed)
- `vite.config.ts`
- `eslint.config.js`
- `src/i18n/locales/en.json`
- `src/i18n/locales/pt-BR.json`
