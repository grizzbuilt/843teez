/**
 * File: scripts/indexnow-submit.js
 * Purpose:
 * - Read sitemap.xml from the local repo
 * - Extract <loc> and <lastmod>
 * - Skip low-value pages like thank-you.html
 * - Optionally submit only recently updated pages
 * - Send matching URLs to IndexNow
 *
 * Usage:
 *   node scripts/indexnow-submit.js
 *
 * Optional:
 *   node scripts/indexnow-submit.js --all
 *     -> submits all eligible URLs in sitemap
 *
 *   node scripts/indexnow-submit.js --days=7
 *     -> submits only URLs updated in last 7 days
 *
 *   node scripts/indexnow-submit.js --dry-run
 *     -> shows which URLs would be submitted without sending them
 *
 *   node scripts/indexnow-submit.js --limit=10
 *     -> submits only the first 10 eligible URLs
 *
 *   node scripts/indexnow-submit.js --include-sitemap
 *     -> also submits the sitemap.xml URL itself
 */

const fs = require("fs");
const https = require("https");
const path = require("path");

const INDEXNOW_KEY = "066e27e04fd842eeb1b8268f8ede0542";
const HOST = "843teez.com";
const SITEMAP_PATH = path.join(__dirname, "..", "sitemap.xml");
const SITEMAP_URL = `https://${HOST}/sitemap.xml`;
const INDEXNOW_ENDPOINT = "api.indexnow.org";
const BATCH_SIZE = 100;

// Pages to skip
const EXCLUDED_PATHS = new Set([
  "/thank-you.html"
]);

// -------- CLI args --------
const args = process.argv.slice(2);

const submitAll = args.includes("--all");
const dryRun = args.includes("--dry-run");
const includeSitemap = args.includes("--include-sitemap");

let daysBack = 14; // default window
const daysArg = args.find(arg => arg.startsWith("--days="));
if (daysArg) {
  const parsed = Number(daysArg.split("=")[1]);
  if (!Number.isNaN(parsed) && parsed > 0) {
    daysBack = parsed;
  }
}

let limit = null;
const limitArg = args.find(arg => arg.startsWith("--limit="));
if (limitArg) {
  const parsed = Number(limitArg.split("=")[1]);
  if (!Number.isNaN(parsed) && parsed > 0) {
    limit = parsed;
  }
}

// -------- Helpers --------
function parseSitemap(xml) {
  const urlBlocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(match => match[1]);

  return urlBlocks
    .map(block => {
      const locMatch = block.match(/<loc>(.*?)<\/loc>/);
      const lastmodMatch = block.match(/<lastmod>(.*?)<\/lastmod>/);

      return {
        loc: locMatch ? locMatch[1].trim() : null,
        lastmod: lastmodMatch ? lastmodMatch[1].trim() : null
      };
    })
    .filter(entry => entry.loc);
}

function isValidHttpUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isHostMatch(urlString) {
  try {
    const url = new URL(urlString);
    return url.hostname === HOST;
  } catch {
    return false;
  }
}

function isExcluded(urlString) {
  try {
    const url = new URL(urlString);
    return EXCLUDED_PATHS.has(url.pathname);
  } catch {
    return true;
  }
}

function parseLastmod(lastmod) {
  if (!lastmod) return null;

  // Supports YYYY-MM-DD and full ISO strings
  const parsed = new Date(lastmod);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  const fallback = new Date(`${lastmod}T00:00:00`);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback;
  }

  return null;
}

function isRecent(lastmod, windowDays) {
  const modifiedDate = parseLastmod(lastmod);
  if (!modifiedDate) return false;

  const now = new Date();
  const msDiff = now.getTime() - modifiedDate.getTime();
  const dayDiff = msDiff / (1000 * 60 * 60 * 24);

  return dayDiff <= windowDays;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function uniqueUrls(urls) {
  return [...new Set(urls)];
}

function submitBatch(urlList, batchNumber, totalBatches) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      host: HOST,
      key: INDEXNOW_KEY,
      urlList
    });

    const req = https.request(
      {
        hostname: INDEXNOW_ENDPOINT,
        path: "/indexnow",
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (res) => {
        let body = "";

        res.on("data", chunk => {
          body += chunk;
        });

        res.on("end", () => {
          console.log(
            `Batch ${batchNumber}/${totalBatches}: ${res.statusCode}${body ? ` ${body}` : ""}`
          );

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              ok: true,
              statusCode: res.statusCode,
              body
            });
          } else {
            reject(
              new Error(`IndexNow batch failed with status ${res.statusCode}: ${body}`)
            );
          }
        });
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// -------- Main --------
async function main() {
  if (!fs.existsSync(SITEMAP_PATH)) {
    throw new Error(`Could not find sitemap at: ${SITEMAP_PATH}`);
  }

  const xml = fs.readFileSync(SITEMAP_PATH, "utf8");
  const entries = parseSitemap(xml);

  console.log(`Found ${entries.length} URLs in sitemap`);

  let filtered = entries.filter(entry => isValidHttpUrl(entry.loc));
  console.log(`Valid URLs: ${filtered.length}`);

  filtered = filtered.filter(entry => isHostMatch(entry.loc));
  console.log(`Matching host (${HOST}): ${filtered.length}`);

  const excludedCountBefore = filtered.length;
  filtered = filtered.filter(entry => !isExcluded(entry.loc));
  console.log(`Excluded paths removed: ${excludedCountBefore - filtered.length}`);

  if (!submitAll) {
    const beforeRecentFilter = filtered.length;
    filtered = filtered.filter(entry => isRecent(entry.lastmod, daysBack));
    console.log(`Filtering to pages updated in last ${daysBack} days`);
    console.log(`Filtered out by date: ${beforeRecentFilter - filtered.length}`);
  } else {
    console.log("Submitting all eligible URLs");
  }

  let urls = filtered.map(entry => entry.loc);
  urls = uniqueUrls(urls);

  if (includeSitemap) {
    urls.unshift(SITEMAP_URL);
    urls = uniqueUrls(urls);
    console.log("Including sitemap.xml in submission");
  }

  if (limit !== null) {
    urls = urls.slice(0, limit);
    console.log(`Limiting submission to first ${limit} URL(s)`);
  }

  if (urls.length === 0) {
    console.log("No URLs matched. Nothing to submit.");
    return;
  }

  console.log(`Submitting ${urls.length} URL(s):`);
  urls.forEach(url => console.log(`- ${url}`));

  if (dryRun) {
    console.log("\nDry run enabled. No submission sent.");
    return;
  }

  const batches = chunkArray(urls, BATCH_SIZE);
  let submittedCount = 0;

  for (let i = 0; i < batches.length; i++) {
    await submitBatch(batches[i], i + 1, batches.length);
    submittedCount += batches[i].length;
  }

  console.log(`IndexNow submission complete. Submitted ${submittedCount} URL(s).`);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
