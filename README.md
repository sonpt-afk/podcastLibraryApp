# Son Podcast Library

A personalized podcast library webapp that allows you to maintain your favorite podcasts and episodes from Podbean using Puppeteer for web scraping.

## Tech Stack

**Frontend:**
- Next.js 15 (App Router)
- TypeScript
- TailwindCSS
- Shadcn UI
- React Query
- Zustand

**Backend:**
- Node.js (Next.js API Routes)
- PostgreSQL
- Puppeteer

## Features

### Favorite Podcast Display
- View favorite podcasts in a grid layout
- See "No podcasts added yet" watermark when empty
- Display podcast icon, name, and episode count
- Click podcast to view episodes

### Favorite Podcast Entry
- Add new podcasts via '+' button
- Validate Podbean URLs
- Scrape podcast details automatically
- Persist favorites across sessions

### Episode Management
- View recent episodes for each podcast
- Mark episodes as favorites
- Rate episodes (1-5 stars)
- Add custom hashtags
- Sort by favorites, ratings, and date

### Bonus Features
- Episode ratings with 5-star system
- Custom hashtag support
- Search episodes by hashtags

## Setup Instructions

### Prerequisites
- Node.js 18+ installed
- PostgreSQL 14+ installed and running

### 1. Install Dependencies

```bash
npm install
```

### 2. Database Setup

Create a PostgreSQL database:

```bash
createdb son_podcast_library
```

Initialize the database schema:

```bash
psql -d son_podcast_library -f scripts/init-db.sql
```

### 3. Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Update the `.env` file with your database credentials:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/son_podcast_library
NODE_ENV=development
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Adding a Podcast

1. Click the '+' button in the top right
2. Enter a Podbean podcast URL (must start with `https://www.podbean.com/podcast-detail/`)
3. Click 'Save'
4. The podcast will be scraped and added to your library

### Viewing Episodes

1. Click on a podcast card
2. View the list of recent episodes
3. Click episode icons to open on Podbean
4. Use the heart icon to mark favorites
5. Click stars to rate episodes
6. Add hashtags for organization

### Searching by Hashtags

1. Enter hashtags in the search box on the main page
2. Click 'Search' to find episodes across all podcasts
3. Click 'Cancel' to return to the main page

## Project Structure

```
son-podcast-library/
├── app/                      # Next.js app directory
│   ├── api/                  # API routes
│   │   ├── podcasts/         # Podcast endpoints
│   │   └── episodes/         # Episode endpoints
│   ├── layout.tsx            # Root layout
│   └── page.tsx              # Home page
├── components/               # React components
│   ├── ui/                   # Shadcn UI components
│   └── providers/            # Context providers
├── lib/                      # Utilities
│   ├── db.ts                 # Database client
│   ├── store.ts              # Zustand store
│   ├── types.ts              # TypeScript types
│   └── utils.ts              # Helper functions
├── scripts/                  # Database scripts
│   └── init-db.sql           # DB initialization
└── public/                   # Static assets
```

## API Endpoints

### Podcasts
- `POST /api/podcasts/scrape` - Scrape and add a podcast
- `GET /api/podcasts` - Get all podcasts
- `DELETE /api/podcasts?id={id}` - Delete a podcast

### Episodes
- `GET /api/podcasts/{id}/episodes` - Get episodes for a podcast
- `POST /api/podcasts/{id}/episodes` - Scrape episodes for a podcast
- `PATCH /api/episodes/{id}/favorite` - Toggle favorite status
- `PATCH /api/episodes/{id}/rating` - Update episode rating
- `POST /api/episodes/{id}/hashtags` - Add hashtag
- `DELETE /api/episodes/{id}/hashtags?tag={tag}` - Remove hashtag

## Development

### Build for Production

```bash
npm run build
npm start
```

### Linting

```bash
npm run lint
```

## Notes

- The app uses Puppeteer for web scraping, which requires Chrome/Chromium to be installed
- Scraping may take a few seconds depending on the podcast page
- Make sure PostgreSQL is running before starting the development server
- Data is persisted both in PostgreSQL (server-side) and localStorage (client-side Zustand state)

## License

MIT
