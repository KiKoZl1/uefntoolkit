# Usage Guide

This guide explains how to use the Epic Insight Engine platform.

## Table of Contents

1. [Authentication](#authentication)
2. [Public Portal](#public-portal)
3. [Client Dashboard](#client-dashboard)
4. [Admin Panel](#admin-panel)
5. [Reports](#reports)
6. [Island Lookup](#island-lookup)

---

## Authentication

### Signing Up

1. Navigate to `/auth`
2. Enter your email and password
3. Click "Sign Up"
4. Check your email for confirmation link
5. Click the confirmation link
6. You will be redirected to the dashboard

### Signing In

1. Navigate to `/auth`
2. Enter your credentials
3. Click "Sign In"
4. You will be redirected to your dashboard

### Password Reset

1. Click "Forgot Password" on the auth page
2. Enter your email
3. Check your inbox for reset link
4. Create a new password

---

## Public Portal

The public portal is accessible without authentication.

### Home Page (`/`)

- Platform overview
- Featured reports
- Quick links to recent reports

### Reports List (`/reports`)

- Browse all published reports
- Filter by date
- Search functionality

### Report View (`/reports/:slug`)

- Detailed report with all metrics
- Shareable via URL
- Export options (if available)

---

## Client Dashboard

Access at `/app` (requires authentication, client role or higher)

### Overview

- Dashboard with key metrics
- Recent activity
- Quick access to projects

### Project Detail (`/app/projects/:id`)

- View project details
- Associated reports
- Island statistics

### Report Dashboard (`/app/projects/:id/reports/:reportId`)

- Detailed metrics for a specific report
- Interactive charts
- Download options

### Island Lookup (`/app/island-lookup`)

Search and explore individual islands:

1. Enter an island code
2. View current metrics
3. See historical data
4. Check trends

---

## Admin Panel

Access at `/admin` (requires admin or editor role)

### Overview (`/admin`)

- Platform KPIs
- System status
- Recent reports

### Reports Management

#### View All Reports (`/admin/reports`)

- List of all reports
- Status indicators (draft, published)
- Quick actions (edit, delete, publish)

#### Create New Report

1. Click "New Report" in admin panel
2. Configure report settings
3. Run data collection
4. Review and publish

#### Edit Report (`/admin/reports/:id/edit`)

- Modify report content
- Update KPIs
- Add custom sections
- AI-assisted editing

#### Publish Report

1. Complete all required fields
2. Set publication date
3. Click "Publish"
4. Report becomes publicly accessible

---

## Reports

### Report Structure

Each weekly report contains:

- **KPIs** - Platform-wide metrics
- **Rankings** - Top islands by various metrics
- **AI Narratives** - Automated insights
- **Trends** - Trending topics and patterns
- **Categories** - Category breakdowns

### Key Metrics

| Metric | Description |
|--------|-------------|
| Total Plays | Number of game sessions |
| Unique Players | Distinct players |
| Minutes Played | Total time played |
| Peak CCU | Highest concurrent users |
| D1/D7 Retention | Day 1/7 retention rate |
| Favorites | Total favorites |
| Recommendations | Total recommendations |

### Rankings Available

- Top by Peak CCU
- Top by Unique Players
- Top by Total Plays
- Top by Minutes Played
- Top by Retention (D1/D7)
- Top Creators
- Top Categories
- Trending Topics
- Top Risers/Decliners

---

## Island Lookup

Search for any Fortnite island using its island code.

### How to Use

1. Go to `/app/island-lookup`
2. Enter the island code (e.g., `1234-5678-9012`)
3. View detailed metrics

### Information Available

- Current statistics
- Historical performance
- Trend analysis
- Category information

---

## API Endpoints

### Edge Functions

| Function | Purpose |
|----------|---------|
| `discover-collector` | Collects island data from Fortnite API |
| `ai-analyst` | Generates AI insights |
| `discover-island-lookup` | Island search functionality |
| `discover-report-ai` | Report AI generation |

### Authentication

All authenticated endpoints require:
- Valid Supabase session token
- Appropriate role (admin/editor/client)

---

## Best Practices

### For Admins

1. Run data collection weekly
2. Review AI narratives before publishing
3. Check for anomalies in metrics
4. Publish reports promptly

### For Editors

1. Verify data accuracy
2. Add contextual notes
3. Review rankings for errors

### For Clients

1. Check your assigned projects regularly
2. Review report summaries
3. Use island lookup for research

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Report not loading | Check internet connection |
| Metrics seem wrong | Wait for data refresh |
| Can't access admin | Contact admin for role upgrade |
| Island not found | Verify island code format |

### Support

For additional help:
- Check the README for technical details
- Review error messages in console
- Contact system administrator

