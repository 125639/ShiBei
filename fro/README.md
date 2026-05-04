# ShiBei Frontend App

This is the lightweight frontend deployment of ShiBei.

## Purpose

- Public blog pages, article reading, video display and user settings.
- Admin pages for posts, videos, music, sync and basic settings.
- Pulls published articles from the backend automatically or imports ZIP bundles manually.
- Allows manual video upload and `[[video:ID]]` insertion into any article.
- Does not include Redis, BullMQ worker, Playwright, Chromium, yt-dlp, ffmpeg or Python.

## Target Server

- Minimum: 1 core / 512MB RAM.
- Recommended: 1 core / 1GB RAM.
- Use lightweight sync by default. Avoid large local video ZIP imports on very small servers.

## Run

```bash
cp .env.example .env
docker compose up --build -d
```

Open `/admin/sync` after startup and configure:

- Backend URL, for example `http://backend-server:3000`.
- Shared sync token, same as the backend.
- Sync mode: automatic by default, manual if you only want ZIP upload.

## Notes

- `docker-compose.yml` forces `APP_MODE=frontend`.
- The app starts a lightweight sync worker. If sync is not configured yet, it waits and retries.
- Automatic sync downloads article/video metadata only; use backend manual ZIP export with files if you need local videos.
