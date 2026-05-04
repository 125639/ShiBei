# ShiBei Backend App

This is the backend deployment of ShiBei.

## Purpose

- Admin-side source management, scraping, RSS processing and AI summarization.
- BullMQ worker, Redis queue, Playwright/Chromium scraping, yt-dlp and ffmpeg support.
- Exports published articles and video metadata/files to the frontend through `/admin/sync`.
- Public pages are redirected to admin in backend mode.

## Target Server

- Minimum: 2 cores / 2GB RAM.
- Keep worker concurrency at `1` on low-memory servers.
- Increase worker concurrency only after observing stable memory usage.

## Run

```bash
cp .env.example .env
docker compose up --build -d
```

Open `/admin/sync` and save a shared sync token. Use the same token in the frontend app.

## Notes

- `docker-compose.yml` forces `APP_MODE=backend`.
- Model API keys are configured in `/admin/settings` and encrypted in the database.
- Only `PUBLISHED` posts are exported to frontend sync bundles.
