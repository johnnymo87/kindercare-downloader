# KinderCare Downloader Architecture

## Overview

This project downloads photos and videos from KinderCare's classroom portal, organizes them with proper timestamps, and optionally syncs favorites to Google Photos.

## Components

### 1. KinderCare Downloader (`kindercare-downloader.cjs`)

Node.js script that:
- Connects to Chrome via CDP (Chrome DevTools Protocol) on port 9222
- Scrapes the KinderCare activities table for media download links
- Downloads photos/videos to `~/Downloads/kindercare/`
- Sets proper timestamps:
  - **Photos**: EXIF DateTimeOriginal via `exiftool`
  - **Videos**: Converts MOV→MP4 via `ffmpeg`, embeds `creation_time` metadata
- Preserves page order by spreading timestamps across 8:00-20:00 for each day

### 2. Favorites Sync (`sync-favorites.sh`)

Bash script that:
- Queries Apple Photos SQLite database for favorited items
- Maps favorites back to kindercare files by matching timestamps
- Copies matched files to `~/Downloads/kindercare-favorites/`

### 3. Google Photos Upload (`upload-to-gphotos.sh`)

Bash script that:
- Tracks uploaded files in `.uploaded` log (prevents duplicates)
- Uses `rclone` to upload new files to Google Photos
- Only uploads files not already in the log

## Data Flow

```
KinderCare Portal
       │
       ▼ (Chrome CDP + Playwright)
kindercare-downloader.cjs
       │
       ▼ (downloads + metadata)
~/Downloads/kindercare/
       │
       ▼ (import)
Apple Photos
       │
       ▼ (favorites query)
sync-favorites.sh
       │
       ▼ (copy favorites)
~/Downloads/kindercare-favorites/
       │
       ▼ (rclone)
upload-to-gphotos.sh
       │
       ▼
Google Photos
```

## Key Design Decisions

### Timestamp Preservation
- KinderCare only provides dates, not times
- Items are ordered newest-first on the page
- We assign synthetic times (8:00-20:00) preserving page order
- This ensures sequential photos/videos sort correctly in photo apps

### MOV to MP4 Conversion
- Uses `ffmpeg -c copy` (remux, no re-encoding)
- Embeds `creation_time` in MP4 container metadata
- Also sets file modification time as fallback

### Incremental Downloads
- `--incremental` flag stops scraping when a full page of existing files is found
- `--stop-before-date=YYYY-MM-DD` stops at a specific date boundary
- Existing files are skipped during download

### Duplicate Prevention (Google Photos)
- Google Photos API doesn't support duplicate detection
- We maintain `.uploaded` log file to track what's been uploaded
- Upload script only sends files not in the log

## Dependencies

- Node.js + Playwright (Chrome automation)
- Chrome with `--remote-debugging-port=9222`
- exiftool (EXIF metadata for photos)
- ffmpeg (video conversion)
- rclone (Google Photos upload)
- sqlite3 (query Apple Photos database)

## File Locations

| Path | Purpose |
|------|---------|
| `~/Downloads/kindercare/` | All downloaded media |
| `~/Downloads/kindercare-favorites/` | Favorited items for Google Photos |
| `~/Downloads/kindercare-favorites/.uploaded` | Upload tracking log |
| `~/.config/rclone/rclone.conf` | rclone Google Photos config |
