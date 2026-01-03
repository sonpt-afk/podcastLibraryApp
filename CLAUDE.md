# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Son Podcast Library is a full-stack web application that allows users to maintain a personalized collection of favorite podcasts from Podbean. The app combines Puppeteer-based web scraping with a PostgreSQL backend and a modern React frontend.

## Common Commands

### Development
```bash
npm run dev          # Start development server (http://localhost:3000)
npm run build        # Build for production
npm start            # Start production server
npm run lint         # Run ESLint
```

### Database
```bash
createdb son_podcast_library                          # Create PostgreSQL database
psql -d son_podcast_library -f scripts/init-db.sql   # Initialize schema
```

### Environment Setup
```bash
cp .env.example .env  # Copy environment template
```

Update `.env` with:
```
DATABASE_URL=postgresql://user:password@localhost:5432/son_podcast_library
NODE_ENV=development
```

## Architecture

### High-Level Design

The application uses a **hybrid state management approach**:

1. **Server-Side State (PostgreSQL)**: Persists all podcast and episode data with full schema support for ratings, hashtags, and favorites
2. **Client-Side State (Zustand + localStorage)**: Maintains a local cache of podcasts and episodes for offline capability and instant UI updates
3. **API Layer (Next.js Route Handlers)**: Bridges server and client, with Puppeteer integration for web scraping

### Data Flow

1. **Adding Podcasts**: User enters Podbean URL → API route uses Puppeteer to scrape details → Stores in PostgreSQL → Returns to client → Zustand store caches locally
2. **Episode Management**: Client-side operations (favorites, ratings, hashtags) update Zustand store immediately (optimistic updates) → API requests sync with PostgreSQL
3. **Data Consistency**: Client store is source of truth for UI; PostgreSQL is authoritative backup

### Key Layers

#### Frontend (`app/` and `components/`)
- **Next.js 15 App Router**: Server and client components
- **Zustand Store** (`lib/store.ts`): Client-side state with localStorage persistence
  - Episodes organized by `podcastId` key
  - Actions: `addPodcast`, `toggleFavorite`, `updateRating`, `addHashtag`, etc.
- **React Query**: Likely used for API synchronization (check dependencies)
- **UI Components**: Shadcn UI components (Button, Card, Dialog, Input) with TailwindCSS styling

#### Backend (API Routes in `app/api/`)
- **PostgreSQL**: Normalizes data into podcasts, episodes, and hashtags tables
- **Puppeteer**: Scrapes Podbean podcast pages for metadata (title, icon, episode count)
  - Launched in headless mode with sandbox disabled for deployment compatibility
  - Validates URLs start with `https://www.podbean.com/podcast-detail/`

### Database Schema

**Podcasts Table**
- UUID primary key, URL uniqueness constraint
- `episode_count`: Scraped from Podbean, not necessarily real-time
- Auto-updated `created_at` and `updated_at` timestamps

**Episodes Table**
- Foreign key to podcasts (cascade delete)
- `rating`: 1-5 constraint
- Indexes on `podcast_id`, `broadcast_date`, `is_favorite` for performance

**Hashtags Table**
- Separate junction table for episode tags
- Composite unique constraint on (episode_id, tag)

## Important Implementation Details

### Client-Side State (Zustand)
- Uses `localStorage` for persistence with `zustand/middleware`
- Store key is `'podcast-storage'`
- Episodes are keyed by `podcastId` for efficient lookups

### Puppeteer Scraping
- Selectors: `.podcast-logo`, `.podcast-image` (icon), `h1.title` (name), `.episode-item` (episodes)
- Uses `networkidle0` wait condition to ensure full page load
- Closes browser after each request (not pooled)

### API Response Patterns
- Query results from PostgreSQL use snake_case columns
- API responses convert to camelCase (e.g., `icon_url` → `iconUrl`)
- Errors return JSON with `error` field and appropriate HTTP status codes

## File Structure Quick Reference

- `app/page.tsx` - Home page rendering podcast grid
- `app/layout.tsx` - Root layout
- `app/api/podcasts/scrape/route.ts` - Podcast scraping endpoint
- `app/api/podcasts/route.ts` - GET/DELETE podcasts
- `app/api/podcasts/[id]/episodes/route.ts` - GET/POST episodes for a podcast
- `app/api/episodes/[id]/*.ts` - Episode-specific actions (favorite, rating, hashtags)
- `lib/db.ts` - PostgreSQL pool with query helper
- `lib/store.ts` - Zustand store definition
- `lib/types.ts` - TypeScript interfaces for Podcast and Episode
- `components/podcast-card.tsx` - Individual podcast card component
- `components/add-podcast-dialog.tsx` - Dialog for adding podcasts
- `scripts/init-db.sql` - Database initialization with schema and triggers

## Testing Strategy

Currently no test files present. If adding tests:
- API routes can be tested with mocked `puppeteer` and database
- Zustand store can be tested by calling actions and verifying state changes
- Components can be tested with React Testing Library

## Common Development Tasks

### Adding a New Episode Feature
1. Update `Episode` interface in `lib/types.ts`
2. Add Zustand action in `lib/store.ts` if client-side mutation needed
3. Update PostgreSQL schema in `scripts/init-db.sql` (add column/table)
4. Create API route in `app/api/episodes/[id]/` if server-side mutation needed
5. Update components to display/interact with new field

### Modifying Scraper Behavior
- Main scraping logic in `app/api/podcasts/scrape/route.ts`
- Adjust CSS selectors based on Podbean page structure changes
- Remember to close browser to avoid memory leaks
- Consider adding retry logic for network timeouts

### Debugging Client-State Sync Issues
- Check Redux DevTools equivalent: Zustand persists to `localStorage['podcast-storage']`
- Inspect API responses in Network tab to ensure camelCase conversion
- Verify database changes with `psql` queries directly
