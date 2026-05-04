# ShiBei Full App

This is the full single-server deployment of ShiBei.

## Purpose

- Public frontend, admin backend, scraping, AI summarization, Redis queue and worker in one deployment.
- Best for simple one-server use when you do not need frontend/backend separation.

## Target Server

- Minimum: 2 cores / 4GB RAM.
- Recommended: more memory if scraping many pages or processing videos.

## Run

```bash
cp .env.example .env
docker compose up --build -d
```

Open:

```text
http://server-ip:3000
http://server-ip:3000/admin
```

## Notes

- `docker-compose.yml` forces `APP_MODE=full`.
- This image includes Playwright/Chromium, yt-dlp and ffmpeg.
- If memory pressure is frequent, split deployment into `fro` + `back` instead.
