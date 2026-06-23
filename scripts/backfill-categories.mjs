// One-time backfill: fix the article sub-category in the Google Drive archive.
//
// Historical data was written with a hardcoded category of "Cultivation
// Insights" (see the old app/api/save/route.ts), so every archived article —
// regardless of its real category — carries that same wrong label, and the
// per-day index.json entries carry no category at all.
//
// This script walks every date folder in the archive, re-derives each article's
// true sub-category from its Minghui breadcrumb (Home > Cultivation > <sub>),
// and rewrites both the per-article JSON and the per-day index entry.
//
// Usage:
//   node --env-file=.env scripts/backfill-categories.mjs            # dry-run (no writes)
//   node --env-file=.env scripts/backfill-categories.mjs --apply    # write changes
//   ... --from=2026-06-01 --to=2026-06-30                           # limit date range
//
// Safe to re-run: it only writes when the derived category differs from what's
// stored, and it never deletes anything.

import { google } from "googleapis";

const APPLY = process.argv.includes("--apply");
const argVal = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const FROM = argVal("from"); // inclusive YYYY-MM-DD, optional
const TO = argVal("to"); // inclusive YYYY-MM-DD, optional
const FETCH_CONCURRENCY = 4;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Google Drive client (mirrors lib/gdrive.ts: OAuth2 first, Service Account next)
// ---------------------------------------------------------------------------
function initDrive() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: "v3", auth: oauth2Client });
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !privateKey) {
    throw new Error(
      "Missing Google credentials (OAuth2 or Service Account). Check your .env.",
    );
  }
  const auth = new google.auth.JWT({
    email,
    key: privateKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

const drive = initDrive();
const DRIVE_ID = process.env.GOOGLE_DRIVE_ID || null;

function listParams(q, fields) {
  const p = {
    q,
    fields,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 1000,
  };
  if (DRIVE_ID) {
    p.corpora = "drive";
    p.driveId = DRIVE_ID;
  }
  return p;
}

async function listAll(q, fields) {
  const out = [];
  let pageToken;
  do {
    const params = listParams(q, `nextPageToken, ${fields}`);
    if (pageToken) params.pageToken = pageToken;
    const res = await drive.files.list(params);
    out.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return out;
}

async function resolveRootId() {
  const raw = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!raw) throw new Error("GOOGLE_DRIVE_FOLDER_ID is not set.");
  if (!raw.includes("/")) return raw;
  // Path form: resolve segment by segment.
  let parent = "root";
  for (const part of raw.split("/").filter(Boolean)) {
    const files = await listAll(
      `mimeType = 'application/vnd.google-apps.folder' and name = '${part}' and '${parent}' in parents and trashed = false`,
      "files(id)",
    );
    if (!files.length) throw new Error(`Folder path segment not found: ${part}`);
    parent = files[0].id;
  }
  return parent;
}

async function downloadJson(fileId) {
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "text" },
  );
  return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
}

async function updateJson(fileId, obj) {
  await drive.files.update({
    fileId,
    supportsAllDrives: true,
    media: { mimeType: "application/json", body: JSON.stringify(obj) },
    fields: "id",
  });
}

// ---------------------------------------------------------------------------
// Category resolution from the Minghui article breadcrumb
// ---------------------------------------------------------------------------
const categoryCache = new Map(); // url -> category string | null

async function fetchCategory(url) {
  if (categoryCache.has(url)) return categoryCache.get(url);
  let category = null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) {
      const html = await res.text();
      const bc = html.match(/<div class="bread-crumb">([\s\S]*?)<\/div>/);
      if (bc) {
        const links = [...bc[1].matchAll(/<a href="\/cc\/\d+\/?">([^<]+)<\/a>/g)];
        if (links.length) category = links[links.length - 1][1].trim();
      }
    } else {
      console.warn(`  ! HTTP ${res.status} for ${url}`);
    }
  } catch (e) {
    console.warn(`  ! fetch failed for ${url}: ${e.message}`);
  }
  categoryCache.set(url, category);
  return category;
}

// Resolve categories for many urls with a small concurrency pool.
async function resolveCategories(urls) {
  const queue = [...urls];
  const workers = Array.from({ length: FETCH_CONCURRENCY }, async () => {
    while (queue.length) {
      const url = queue.shift();
      await fetchCategory(url);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const inRange = (date) => (!FROM || date >= FROM) && (!TO || date <= TO);

async function main() {
  console.log(
    `Backfill categories — mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}` +
      `${FROM || TO ? `, range: ${FROM || "…"}..${TO || "…"}` : ""}`,
  );

  const rootId = await resolveRootId();

  // Date folders are named YYYY-MM-DD.
  const folders = await listAll(
    `mimeType = 'application/vnd.google-apps.folder' and '${rootId}' in parents and trashed = false`,
    "files(id, name)",
  );
  const dateFolders = folders
    .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.name) && inRange(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`Found ${dateFolders.length} date folder(s) to scan.\n`);

  let totalEntries = 0;
  let totalChanged = 0;
  let totalArticleFiles = 0;
  let totalUnresolved = 0;

  for (const folder of dateFolders) {
    const date = folder.name;
    const files = await listAll(
      `'${folder.id}' in parents and trashed = false`,
      "files(id, name)",
    );
    const byName = new Map(files.map((f) => [f.name, f.id]));

    const indexId = byName.get("index.json");
    if (!indexId) {
      console.log(`${date}: no index.json — skipping`);
      continue;
    }

    let entries;
    try {
      entries = await downloadJson(indexId);
    } catch (e) {
      console.warn(`${date}: failed to read index.json (${e.message}) — skipping`);
      continue;
    }
    if (!Array.isArray(entries)) {
      console.warn(`${date}: index.json is not an array — skipping`);
      continue;
    }

    totalEntries += entries.length;

    // Resolve true categories for this day's articles in parallel.
    await resolveCategories(entries.map((e) => e.url).filter(Boolean));

    let dayChanged = 0;
    for (const entry of entries) {
      if (!entry?.url) continue;
      const truth = categoryCache.get(entry.url);
      if (!truth) {
        totalUnresolved++;
        continue; // couldn't determine — leave as-is
      }
      if (entry.category === truth) continue; // already correct

      console.log(
        `${date}: ${entry.url.split("/").pop()}  ` +
          `"${entry.category ?? "—"}" -> "${truth}"`,
      );
      entry.category = truth;
      dayChanged++;
      totalChanged++;

      // Also fix the per-article JSON (the reader reads category from here),
      // but only when its stored value is actually wrong.
      const fileName = (entry.filePath || "").split("/").pop();
      const articleId = fileName && byName.get(fileName);
      if (articleId) {
        if (APPLY) {
          try {
            const art = await downloadJson(articleId);
            if (art && typeof art === "object" && art.category !== truth) {
              art.category = truth;
              await updateJson(articleId, art);
              totalArticleFiles++;
            }
          } catch (e) {
            console.warn(`  ! failed updating ${fileName}: ${e.message}`);
          }
        } else {
          totalArticleFiles++; // upper bound; dry-run doesn't read article files
        }
      } else {
        console.warn(`  ! article file ${fileName} not found for index entry`);
      }
    }

    if (dayChanged && APPLY) {
      await updateJson(indexId, entries);
    }
  }

  console.log(
    `\nDone. entries scanned: ${totalEntries}, ` +
      `entries ${APPLY ? "updated" : "to update"}: ${totalChanged}, ` +
      `article files ${APPLY ? "rewritten" : "to rewrite"}: ${totalArticleFiles}, ` +
      `unresolved (left as-is): ${totalUnresolved}.`,
  );
  if (!APPLY && totalChanged) {
    console.log("Re-run with --apply to write these changes.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
