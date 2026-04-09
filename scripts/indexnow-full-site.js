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
 */

const fs = require("fs");
const https = require("https");
const path = require("path");

const INDEXNOW_KEY = "066e27e04fd842eeb1b8268f8ede0542";
const HOST = "843teez.com";
const SITEMAP_PATH = path.join(__dirname, "..", "sitemap.xml");

// Pages to skip
const EXCLUDED_PATHS = new Set([
  "/thank-you.html"
]);

// -------- CLI args --------
const args = process.argv.slice(2);
const submitAll = args.includes("--all");

let daysBack = 14; // default window
const daysArg = args.find(arg => arg.startsWith("--days="));
if (daysArg) {
  const parsed = Number(daysArg.split("=")[1]);
  if (!Number.isNaN(parsed) && parsed > 0) {
    daysBack = parsed;
  }
}

// -------- Helpers --------
function parseSitemap(xml) {
  const urlBlocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => m[1]);

  return urlBlocks.map(block => {
    const locMatch = block.match(/<loc>(.*?)<\/loc>/);
    const lastmodMatch = block.match(/<lastmod>(.*?)<\/lastmod>/);

    return {
      loc: locMatch ? locMatch[1].trim() : null,
      lastmod: lastmodMatch ? lastmodMatch[1].trim() : null
    };
  }).filter(entry => entry.loc);
}

function isExcluded(urlString) {
  try {
    const url = new URL(urlString);
    return EXCLUDED_PATHS.has(url.pathname);
  } catch {
    return true;
  }
}

function isRecent(lastmod, windowDays) {
  if (!lastmod) return false;

  const modifiedDate = new Date(`${lastmod}T00:00:00`);
  if (Number.isNaN(modifiedDate.getTime())) return false;

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

function submitBatch(urlList, batchNumber, totalBatches) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      host: HOST,
      key: INDEXNOW_KEY,
      urlList
    });

    const req = https.request(
      {
        hostname: "api.indexnow.org",
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
            `Batch ${batchNumber}/${totalBatches}: ${res.statusCode}${
              body ? ` ${body}` : ""
            }`
          );

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
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

  let filtered = entries.filter(entry => !isExcluded(entry.loc));

  if (!submitAll) {
    filtered = filtered.filter(entry => isRecent(entry.lastmod, daysBack));
    console.log(`Filtering to pages updated in last ${daysBack} days`);
  } else {
    console.log("Submitting all eligible URLs");
  }

  const urls = filtered.map(entry => entry.loc);

  if (urls.length === 0) {
    console.log("No URLs matched. Nothing to submit.");
    return;
  }

  console.log(`Submitting ${urls.length} URL(s):`);
  urls.forEach(url => console.log(`- ${url}`));

  const batches = chunkArray(urls, 100);

  for (let i = 0; i < batches.length; i++) {
    await submitBatch(batches[i], i + 1, batches.length);
  }

  console.log("IndexNow submission complete.");
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
