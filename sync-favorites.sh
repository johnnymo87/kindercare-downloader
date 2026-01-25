#!/bin/bash
# Sync favorited photos from Apple Photos to a folder for Google Photos upload

set -e

KINDERCARE_DIR="$HOME/Downloads/kindercare"
FAVORITES_DIR="$HOME/Downloads/kindercare-favorites"
PHOTOS_DB="$HOME/Pictures/Photos Library.photoslibrary/database/Photos.sqlite"

# Create favorites directory
mkdir -p "$FAVORITES_DIR"

echo "Querying Apple Photos for favorites..."

# Query favorites and process each one
sqlite3 "$PHOTOS_DB" "SELECT datetime(ZDATECREATED + 978307200, 'unixepoch', 'localtime') FROM ZASSET WHERE ZFAVORITE = 1;" | while read -r timestamp; do
  # Convert timestamp "2025-12-26 11:36:00" to match our filename pattern
  # Our files are like: 2025-12-26_*.jpg with EXIF time 11:36:00

  date_part=$(echo "$timestamp" | cut -d' ' -f1)
  time_part=$(echo "$timestamp" | cut -d' ' -f2 | cut -d':' -f1-2)  # HH:MM

  # Find matching file by date prefix and check EXIF/file time
  for file in "$KINDERCARE_DIR/$date_part"*; do
    if [ -f "$file" ]; then
      # Check if this file's time matches
      if [[ "$file" == *.mp4 ]]; then
        # For mp4, check creation_time metadata
        file_time=$(ffprobe -v quiet -show_entries format_tags=creation_time -of csv=p=0 "$file" 2>/dev/null | cut -dT -f2 | cut -d: -f1-2)
      else
        # For images, check EXIF DateTimeOriginal
        file_time=$(exiftool -s -s -s -DateTimeOriginal "$file" 2>/dev/null | cut -d' ' -f2 | cut -d: -f1-2 | tr ':' ':')
      fi

      if [ "$file_time" = "$time_part" ]; then
        filename=$(basename "$file")
        if [ ! -f "$FAVORITES_DIR/$filename" ]; then
          echo "  Copying: $filename"
          cp "$file" "$FAVORITES_DIR/"
        else
          echo "  Already exists: $filename"
        fi
        break
      fi
    fi
  done
done

echo ""
echo "Favorites synced to: $FAVORITES_DIR"
echo "Total files: $(ls -1 "$FAVORITES_DIR" | wc -l | tr -d ' ')"
