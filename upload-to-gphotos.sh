#!/bin/bash
# Upload kindercare favorites to Google Photos, tracking what's been uploaded

set -e

FAVORITES_DIR="$HOME/Downloads/kindercare-favorites"
UPLOADED_LOG="$HOME/Downloads/kindercare-favorites/.uploaded"

# Create uploaded log if it doesn't exist
touch "$UPLOADED_LOG"

echo "Checking for new files to upload..."

new_files=()
for file in "$FAVORITES_DIR"/*; do
  [ -f "$file" ] || continue
  filename=$(basename "$file")

  # Skip hidden files and the log itself
  [[ "$filename" == .* ]] && continue

  # Check if already uploaded
  if grep -qF "$filename" "$UPLOADED_LOG" 2>/dev/null; then
    echo "  Already uploaded: $filename"
  else
    new_files+=("$file")
  fi
done

if [ ${#new_files[@]} -eq 0 ]; then
  echo "No new files to upload."
  exit 0
fi

echo ""
echo "Uploading ${#new_files[@]} new files..."

# Create temp dir with only new files (symlinks)
tmp_dir=$(mktemp -d)
for file in "${new_files[@]}"; do
  ln -s "$file" "$tmp_dir/"
done

# Upload via rclone
if rclone copy "$tmp_dir" gphotos:upload -v 2>&1; then
  # Mark files as uploaded
  for file in "${new_files[@]}"; do
    basename "$file" >> "$UPLOADED_LOG"
    echo "  Marked uploaded: $(basename "$file")"
  done
  echo ""
  echo "Successfully uploaded ${#new_files[@]} files."
else
  echo "Upload failed!"
  exit 1
fi

# Cleanup
rm -rf "$tmp_dir"
