# KinderCare Downloader

Download photos and videos from KinderCare, sync favorites to Google Photos.

## Quick Start

### Prerequisites

```bash
brew install exiftool ffmpeg rclone
npm install  # installs playwright
```

### 1. Start Chrome with Remote Debugging

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 &
```

### 2. Log into KinderCare

Navigate to `https://classroom.kindercare.com/accounts/YOUR_ACCOUNT_ID/activities` and log in.

### 3. Download Media

```bash
# Download recent pages (default: 2)
node kindercare-downloader.cjs

# Download until a specific date
node kindercare-downloader.cjs --stop-before-date=2025-12-01

# Incremental: download new content only
node kindercare-downloader.cjs --incremental

# Dry run (see what would be downloaded)
node kindercare-downloader.cjs --pages=10 --dry-run
```

### 4. Sync Favorites to Google Photos

```bash
# First: favorite photos in Apple Photos app

# Sync favorites from Apple Photos
./sync-favorites.sh

# Upload to Google Photos
./upload-to-gphotos.sh
```

## Configuration

### Google Photos (rclone)

Create `~/.config/rclone/rclone.conf`:
```ini
[gphotos]
type = google photos
client_id = YOUR_CLIENT_ID
client_secret = YOUR_CLIENT_SECRET
token = {"access_token":"...","refresh_token":"..."}
```

Get token: `rclone authorize "google photos" CLIENT_ID CLIENT_SECRET`

### Environment Variables

Copy `.env.example` to `.env` and fill in your credentials (not committed to git).

## Skills

| Skill | Description |
|-------|-------------|
| [Architecture](.claude/skills/architecture.md) | System design, data flow, dependencies |

## File Structure

```
kindercare-downloader/
├── kindercare-downloader.cjs  # Main download script
├── sync-favorites.sh          # Apple Photos → favorites folder
├── upload-to-gphotos.sh       # Favorites → Google Photos
├── package.json
├── .env                       # Secrets (not in git)
├── .env.example               # Template for secrets
└── .claude/
    └── skills/
        └── architecture.md
```
