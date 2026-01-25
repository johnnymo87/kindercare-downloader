#!/usr/bin/env node
/**
 * KinderCare Photo/Video Downloader
 *
 * Connects to Chrome via CDP, scrapes activities from KinderCare,
 * downloads media, and sets EXIF dates.
 *
 * Usage: node kindercare-downloader.cjs [--pages N] [--dry-run]
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

const DOWNLOAD_DIR = path.join(process.env.HOME, 'Downloads', 'kindercare');
const CDP_URL = 'http://localhost:9222';

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const incremental = args.includes('--incremental');
const pagesArg = args.find(a => a.startsWith('--pages='));
const stopBeforeArg = args.find(a => a.startsWith('--stop-before-date='));
const stopBeforeDate = stopBeforeArg ? stopBeforeArg.split('=')[1] : null; // YYYY-MM-DD format
const maxPages = pagesArg ? parseInt(pagesArg.split('=')[1]) : (incremental || stopBeforeDate ? 999 : 2);

function parseDateStr(dateStr) {
  // Convert "1/23/26" to "2026-01-23"
  const [month, day, year] = dateStr.split('/').map(Number);
  const fullYear = year < 50 ? 2000 + year : 1900 + year;
  return `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function setExifDate(filePath, dateStr, hour, minute) {
  // dateStr is like "1/23/26" (M/D/YY)
  const [month, day, year] = dateStr.split('/').map(Number);
  const fullYear = year < 50 ? 2000 + year : 1900 + year;
  // Format for exiftool: YYYY:MM:DD HH:MM:SS
  const exifDate = `${fullYear}:${String(month).padStart(2, '0')}:${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

  try {
    execSync(`exiftool -overwrite_original -AllDates="${exifDate}" "${filePath}"`, {
      stdio: 'pipe'
    });
    return true;
  } catch (err) {
    console.error(`  Failed to set EXIF date: ${err.message}`);
    return false;
  }
}

function convertVideoToMp4(movPath, dateStr, hour, minute) {
  // Convert MOV to MP4 using ffmpeg with remux (no re-encoding)
  // Also sets creation_time metadata
  const [month, day, year] = dateStr.split('/').map(Number);
  const fullYear = year < 50 ? 2000 + year : 1900 + year;
  const isoDate = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

  const mp4Path = movPath.replace(/\.MOV$/i, '.mp4');

  try {
    execSync(`ffmpeg -i "${movPath}" -c copy -movflags use_metadata_tags -metadata creation_time="${isoDate}" "${mp4Path}" -y`, {
      stdio: 'pipe'
    });
    // Delete original MOV after successful conversion
    fs.unlinkSync(movPath);
    // Set file modification time as well
    const date = new Date(fullYear, month - 1, day, hour, minute, 0);
    fs.utimesSync(mp4Path, date, date);
    return true;
  } catch (err) {
    console.error(`  Failed to convert video: ${err.message}`);
    return false;
  }
}

async function scrapeActivitiesPage(page) {
  return await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    const activities = [];

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 8) continue;

      const dateCell = cells[1];
      const date = dateCell?.textContent?.trim();

      // Find download link
      const downloadLink = row.querySelector('a[download]');
      if (!downloadLink) continue;

      const url = downloadLink.href;
      const filename = downloadLink.getAttribute('download');
      const isVideo = url.includes('/video/') || filename?.match(/\.(mov|mp4|avi)$/i);

      activities.push({
        date,
        url,
        filename,
        isVideo
      });
    }

    return activities;
  });
}

function activityFileExists(activity) {
  // Check if the file for this activity already exists
  const [month, day, year] = activity.date.split('/').map(Number);
  const fullYear = year < 50 ? 2000 + year : 1900 + year;
  const datePrefix = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const destFilename = `${datePrefix}_${activity.filename}`;
  const destPath = path.join(DOWNLOAD_DIR, destFilename);
  const mp4Path = destPath.replace(/\.MOV$/i, '.mp4');
  const finalPath = activity.isVideo ? mp4Path : destPath;
  return fs.existsSync(finalPath);
}

async function main() {
  console.log(`KinderCare Downloader`);
  const modeDesc = stopBeforeDate ? `until ${stopBeforeDate}` : (incremental ? 'incremental (stops when caught up)' : `scrape ${maxPages} pages`);
  console.log(`  Mode: ${modeDesc}`);
  console.log(`  Dry run: ${dryRun}`);
  console.log(`  Download dir: ${DOWNLOAD_DIR}`);
  console.log('');

  // Ensure download directory exists
  if (!dryRun) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }

  // Connect to browser
  console.log('Connecting to Chrome...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  const page = pages.find(p => p.url().includes('kindercare'));

  if (!page) {
    console.error('KinderCare page not found. Please open https://classroom.kindercare.com/accounts/720217/activities');
    await browser.close();
    process.exit(1);
  }

  console.log('Connected to:', page.url());

  // Always navigate to page 1 of activities list
  await page.goto('https://classroom.kindercare.com/accounts/720217/activities?page=1');
  await page.waitForLoadState('domcontentloaded');

  let allActivities = [];
  let stoppedEarly = false;

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    console.log(`\nScraping page ${pageNum}...`);

    // Scrape current page
    const activities = await scrapeActivitiesPage(page);
    console.log(`  Found ${activities.length} activities with media`);

    // In incremental mode, check if all files on this page already exist
    if (incremental && activities.length > 0) {
      const existingCount = activities.filter(a => activityFileExists(a)).length;
      console.log(`  Already have: ${existingCount}/${activities.length}`);

      if (existingCount === activities.length) {
        console.log(`  All files on this page exist - caught up!`);
        stoppedEarly = true;
        break;
      }
    }

    // Check for stop-before-date: filter out items at or before the cutoff
    if (stopBeforeDate && activities.length > 0) {
      const filteredActivities = activities.filter(a => parseDateStr(a.date) > stopBeforeDate);
      const oldestOnPage = activities[activities.length - 1];
      const oldestDate = parseDateStr(oldestOnPage.date);

      if (filteredActivities.length < activities.length) {
        console.log(`  Reached cutoff date (oldest on page: ${oldestDate})`);
        allActivities = allActivities.concat(filteredActivities);
        stoppedEarly = true;
        break;
      }
    }

    allActivities = allActivities.concat(activities);

    // Navigate to next page if not on last page
    if (pageNum < maxPages) {
      const nextUrl = `https://classroom.kindercare.com/accounts/720217/activities?page=${pageNum + 1}`;
      await page.goto(nextUrl);
      await page.waitForLoadState('domcontentloaded');
    }
  }

  console.log(`\nTotal activities with media: ${allActivities.length}`);

  // Assign order indices within each day to preserve page order
  // Page shows newest first, so first item of a day = most recent = latest time
  const dateCounters = {};
  for (const activity of allActivities) {
    if (!dateCounters[activity.date]) {
      dateCounters[activity.date] = 0;
    }
    activity.orderInDay = dateCounters[activity.date]++;
  }
  // Store total count per day for time calculation
  const dateTotals = { ...dateCounters };

  // Download files
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const activity of allActivities) {
    // Convert date to filename prefix: 1/23/26 -> 2026-01-23
    const [month, day, year] = activity.date.split('/').map(Number);
    const fullYear = year < 50 ? 2000 + year : 1900 + year;
    const datePrefix = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Calculate time based on order: spread items across 8:00-20:00 (12 hours)
    // First item (order 0) = latest time, last item = earliest time
    const totalForDay = dateTotals[activity.date];
    const reversedOrder = totalForDay - 1 - activity.orderInDay;
    const minutesIntoDay = totalForDay > 1
      ? Math.round((reversedOrder / (totalForDay - 1)) * 720) // 720 minutes = 12 hours
      : 360; // single item gets noon
    const hour = 8 + Math.floor(minutesIntoDay / 60);
    const minute = minutesIntoDay % 60;

    const destFilename = `${datePrefix}_${activity.filename}`;
    const destPath = path.join(DOWNLOAD_DIR, destFilename);
    // For videos, check if mp4 version already exists
    const mp4Path = destPath.replace(/\.MOV$/i, '.mp4');
    const finalPath = activity.isVideo ? mp4Path : destPath;

    if (fs.existsSync(finalPath)) {
      const finalFilename = activity.isVideo ? destFilename.replace(/\.MOV$/i, '.mp4') : destFilename;
      console.log(`  SKIP (exists): ${finalFilename}`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  WOULD DOWNLOAD: ${destFilename} (${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')})`);
      console.log(`    URL: ${activity.url.slice(0, 100)}...`);
      downloaded++;
      continue;
    }

    const displayFilename = activity.isVideo ? destFilename.replace(/\.MOV$/i, '.mp4') : destFilename;
    console.log(`  Downloading: ${displayFilename} (${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')})`);
    try {
      await downloadFile(activity.url, destPath);

      // Set date metadata (and convert video to mp4)
      if (activity.isVideo) {
        convertVideoToMp4(destPath, activity.date, hour, minute);
      } else {
        setExifDate(destPath, activity.date, hour, minute);
      }

      downloaded++;
    } catch (err) {
      console.error(`    FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone!`);
  console.log(`  Downloaded: ${downloaded}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  console.log(`  Failed: ${failed}`);

  await browser.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
