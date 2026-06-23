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
// Recreate a missing per-day index.json from the article JSON files in that
// folder (e.g. a sync that saved articles but died before flushing the index).
const REBUILD = process.argv.includes("--rebuild-index");
// Read-only audit: compare the stored category in the index entry AND the
// per-article JSON against the live Minghui breadcrumb, and report mismatches.
// Never writes (ignores --apply).
const VERIFY = process.argv.includes("--verify");
// Add article files that exist in a date folder but are missing from that day's
// index.json back into the index (so they appear in the app and aren't
// re-translated on the next sync). Requires --apply to actually write.
const ADOPT = process.argv.includes("--adopt-orphans");
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

async function createJson(parentId, name, obj) {
  await drive.files.create({
    supportsAllDrives: true,
    requestBody: { name, parents: [parentId], mimeType: "application/json" },
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

// Rebuild a missing index.json for a date folder from its article JSON files.
// Returns the number of entries that were (or would be) written.
async function rebuildIndex(date, folderId, byName) {
  const articleFiles = [...byName.entries()].filter(([name]) =>
    /^\d+\.json$/.test(name),
  );
  if (!articleFiles.length) {
    console.log(`${date}: no article files — nothing to rebuild`);
    return 0;
  }

  const entries = [];
  for (const [name, id] of articleFiles) {
    try {
      const art = await downloadJson(id);
      if (!art || typeof art !== "object" || !art.url) {
        console.warn(`  ! ${date}/${name}: missing url — skipped`);
        continue;
      }
      entries.push({
        url: art.url,
        title_en: art.title_en ?? "",
        title_th: art.title_th ?? "",
        date: art.published_date || date,
        category: art.category || "Cultivation",
        filePath: `/${date}/${name}`,
      });
    } catch (e) {
      console.warn(`  ! ${date}/${name}: ${e.message}`);
    }
  }

  console.log(
    `${date}: rebuild index from ${entries.length} article file(s)` +
      `${APPLY ? "" : " (dry-run)"}`,
  );
  if (APPLY && entries.length) await createJson(folderId, "index.json", entries);
  return entries.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const inRange = (date) => (!FROM || date >= FROM) && (!TO || date <= TO);

async function main() {
  const mode = VERIFY
    ? "VERIFY (read-only audit)"
    : APPLY
      ? "APPLY (writing)"
      : "DRY-RUN (no writes)";
  console.log(
    `Backfill categories — mode: ${mode}` +
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
  let totalIndexesRebuilt = 0;
  let totalRebuiltEntries = 0;
  let totalAdopted = 0;
  // --verify tallies
  let vOk = 0;
  let vMismatch = 0;
  let vMissing = 0;
  let vUnresolved = 0;
  let vFieldDrift = 0; // index entry fields disagree with the article file
  let vOrphan = 0; // article file on disk not referenced by the index
  let vDup = 0; // same url listed more than once in an index

  for (const folder of dateFolders) {
    const date = folder.name;
    const files = await listAll(
      `'${folder.id}' in parents and trashed = false`,
      "files(id, name)",
    );
    const byName = new Map(files.map((f) => [f.name, f.id]));

    const indexId = byName.get("index.json");
    if (!indexId) {
      if (REBUILD) {
        const n = await rebuildIndex(date, folder.id, byName);
        if (n) {
          totalIndexesRebuilt++;
          totalRebuiltEntries += n;
        }
      } else {
        console.log(
          `${date}: no index.json — skipping (use --rebuild-index to recreate)`,
        );
      }
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

    // --verify: read-only audit. Two layers:
    //  (a) category three-way: index entry vs article file vs Minghui breadcrumb
    //  (b) index<->data integrity: fields agree, no missing/orphan files, no dups
    if (VERIFY) {
      const referenced = new Set(); // article file names the index points to
      const urlSeen = new Set();
      const articleFileNames = [...byName.keys()].filter((n) =>
        /^\d+\.json$/.test(n),
      );

      for (const entry of entries) {
        if (!entry?.url) {
          vFieldDrift++;
          console.log(`${date}: index entry with no url — ${JSON.stringify(entry).slice(0, 80)}`);
          continue;
        }
        const id = entry.url.split("/").pop();

        // Duplicate url within this day's index.
        if (urlSeen.has(entry.url)) {
          vDup++;
          console.log(`${date}: ${id}  DUPLICATE url in index`);
        }
        urlSeen.add(entry.url);

        const fileName = (entry.filePath || "").split("/").pop();
        if (fileName) referenced.add(fileName);
        const articleId = fileName && byName.get(fileName);

        // index entry -> article file must exist.
        if (!articleId) {
          vMissing++;
          console.log(
            `${date}: ${id}  FILE-MISSING  index points to "${entry.filePath}" which is absent`,
          );
          continue;
        }

        let art;
        try {
          art = await downloadJson(articleId);
        } catch (e) {
          vMissing++;
          console.log(`${date}: ${id}  FILE-UNREADABLE (${e.message})`);
          continue;
        }
        if (!art || typeof art !== "object") {
          vMissing++;
          console.log(`${date}: ${id}  FILE-INVALID (not a JSON object)`);
          continue;
        }

        // (b) field integrity: index entry must agree with the article file.
        const drift = [];
        const cmp = (field, a, b) => {
          if ((a ?? "") !== (b ?? "")) drift.push(`${field}: index="${a ?? "—"}" file="${b ?? "—"}"`);
        };
        cmp("url", entry.url, art.url);
        cmp("title_en", entry.title_en, art.title_en);
        cmp("title_th", entry.title_th, art.title_th);
        cmp("date", entry.date, art.published_date);

        // (a) category three-way.
        const truth = categoryCache.get(entry.url);
        const idxCat = entry.category ?? "—";
        const artCat = art.category ?? "—";
        let catState = "ok";
        if (!truth) {
          catState = "unresolved";
        } else if (idxCat !== truth || artCat !== truth) {
          catState = idxCat === "—" || artCat === "—" ? "missing" : "mismatch";
        }

        if (drift.length === 0 && catState === "ok") {
          vOk++;
        } else {
          if (drift.length) {
            vFieldDrift++;
            console.log(`${date}: ${id}  FIELD-DRIFT  ${drift.join("; ")}`);
          }
          if (catState === "unresolved") {
            vUnresolved++;
            console.log(`${date}: ${id}  CATEGORY-UNRESOLVED (breadcrumb unreadable)`);
          } else if (catState === "missing") {
            vMissing++;
            console.log(`${date}: ${id}  CATEGORY-MISSING index="${idxCat}" file="${artCat}" truth="${truth}"`);
          } else if (catState === "mismatch") {
            vMismatch++;
            console.log(`${date}: ${id}  CATEGORY-MISMATCH index="${idxCat}" file="${artCat}" truth="${truth}"`);
          }
        }
      }

      // Orphan article files present on disk but absent from the index.
      for (const name of articleFileNames) {
        if (!referenced.has(name)) {
          vOrphan++;
          console.log(`${date}: ${name}  ORPHAN — article file not listed in index.json`);
        }
      }
      continue; // verify never mutates
    }

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

    // Adopt orphan article files (present in the folder, missing from the index).
    if (ADOPT) {
      const referenced = new Set(
        entries
          .map((e) => (e.filePath || "").split("/").pop())
          .filter(Boolean),
      );
      const orphans = [...byName.entries()].filter(
        ([name]) => /^\d+\.json$/.test(name) && !referenced.has(name),
      );
      for (const [name, id] of orphans) {
        try {
          const art = await downloadJson(id);
          if (!art || typeof art !== "object" || !art.url) {
            console.warn(`  ! ${date}/${name}: not a valid article — not adopted`);
            continue;
          }
          entries.push({
            url: art.url,
            title_en: art.title_en ?? "",
            title_th: art.title_th ?? "",
            date: art.published_date || date,
            category: art.category || "Cultivation",
            filePath: `/${date}/${name}`,
          });
          dayChanged++;
          totalAdopted++;
          console.log(`${date}: ${name}  ADOPTED into index${APPLY ? "" : " (dry-run)"}`);
        } catch (e) {
          console.warn(`  ! ${date}/${name}: ${e.message}`);
        }
      }
    }

    if (dayChanged && APPLY) {
      await updateJson(indexId, entries);
    }
  }

  if (VERIFY) {
    const bad =
      vMismatch + vMissing + vUnresolved + vFieldDrift + vOrphan + vDup;
    console.log(
      `\nVerify complete. entries: ${totalEntries}, ok: ${vOk}\n` +
        `  category — mismatch: ${vMismatch}, missing: ${vMissing}, unresolved: ${vUnresolved}\n` +
        `  integrity — field-drift: ${vFieldDrift}, file-missing: counted in missing, ` +
        `orphan files: ${vOrphan}, duplicate urls: ${vDup}`,
    );
    console.log(
      bad === 0
        ? "✓ index.json and the article data agree; all categories correct."
        : `✗ ${bad} issue(s) found — see lines above.`,
    );
    return;
  }

  console.log(
    `\nDone. entries scanned: ${totalEntries}, ` +
      `entries ${APPLY ? "updated" : "to update"}: ${totalChanged}, ` +
      `article files ${APPLY ? "rewritten" : "to rewrite"}: ${totalArticleFiles}, ` +
      `unresolved (left as-is): ${totalUnresolved}` +
      (REBUILD
        ? `, indexes ${APPLY ? "rebuilt" : "to rebuild"}: ${totalIndexesRebuilt}` +
          ` (${totalRebuiltEntries} entries)`
        : "") +
      (ADOPT
        ? `, orphans ${APPLY ? "adopted" : "to adopt"}: ${totalAdopted}`
        : "") +
      ".",
  );
  if (!APPLY && (totalChanged || totalRebuiltEntries || totalAdopted)) {
    console.log("Re-run with --apply to write these changes.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
