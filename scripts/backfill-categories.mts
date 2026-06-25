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

import { google, type drive_v3 } from "googleapis";

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
const argVal = (name: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const FROM = argVal("from"); // inclusive YYYY-MM-DD, optional
const TO = argVal("to"); // inclusive YYYY-MM-DD, optional
const FETCH_CONCURRENCY = 4;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface ArticleFile {
  url?: string;
  title_en?: string;
  title_th?: string;
  content_en?: string;
  content_th?: string;
  category?: string;
  published_date?: string;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Google Drive client (mirrors lib/gdrive.ts: OAuth2 first, Service Account next)
// ---------------------------------------------------------------------------
function initDrive(): drive_v3.Drive {
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

function listParams(
  q: string,
  fields: string,
): drive_v3.Params$Resource$Files$List {
  const p: drive_v3.Params$Resource$Files$List = {
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

async function listAll(
  q: string,
  fields: string,
): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const params = listParams(q, `nextPageToken, ${fields}`);
    if (pageToken) params.pageToken = pageToken;
    const res = await drive.files.list(params);
    out.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

async function resolveRootId(): Promise<string> {
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
    if (!files.length)
      throw new Error(`Folder path segment not found: ${part}`);
    parent = files[0].id as string;
  }
  return parent;
}

async function downloadJson(fileId: string): Promise<unknown> {
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "text" },
  );
  return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
}

async function updateJson(fileId: string, obj: unknown) {
  await drive.files.update({
    fileId,
    supportsAllDrives: true,
    media: { mimeType: "application/json", body: JSON.stringify(obj) },
    fields: "id",
  });
}

async function createJson(parentId: string, name: string, obj: unknown) {
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
const urlStatus = new Map(); // url -> "ok" | "404" | "http:NNN" | "error" (for --verify dead-link check)

async function fetchCategory(url: string) {
  if (categoryCache.has(url)) return categoryCache.get(url);
  let category = null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) {
      urlStatus.set(url, "ok");
      const html = await res.text();
      const bc = html.match(/<div class="bread-crumb">([\s\S]*?)<\/div>/);
      if (bc) {
        const links = [
          ...bc[1].matchAll(/<a href="\/cc\/\d+\/?">([^<]+)<\/a>/g),
        ];
        if (links.length) category = links[links.length - 1][1].trim();
      }
    } else {
      urlStatus.set(url, res.status === 404 ? "404" : `http:${res.status}`);
      console.warn(`  ! HTTP ${res.status} for ${url}`);
    }
  } catch (e) {
    urlStatus.set(url, "error");
    console.warn(`  ! fetch failed for ${url}: ${(e as Error).message}`);
  }
  categoryCache.set(url, category);
  return category;
}

// True when the string contains at least one Thai-script character.
const hasThai = (s: string) => /[฀-๿]/.test(s || "");

// Resolve categories for many urls with a small concurrency pool.
async function resolveCategories(urls: string[]) {
  const queue = [...urls];
  const workers = Array.from({ length: FETCH_CONCURRENCY }, async () => {
    while (queue.length) {
      const url = queue.shift();
      await fetchCategory(url as string);
    }
  });
  await Promise.all(workers);
}

// Rebuild a missing index.json for a date folder from its article JSON files.
// Returns the number of entries that were (or would be) written.
async function rebuildIndex(
  date: string,
  folderId: string,
  byName: Map<string, string>,
) {
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
      const art = (await downloadJson(id)) as ArticleFile;
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
      console.warn(`  ! ${date}/${name}: ${(e as Error).message}`);
    }
  }

  console.log(
    `${date}: rebuild index from ${entries.length} article file(s)` +
      `${APPLY ? "" : " (dry-run)"}`,
  );
  if (APPLY && entries.length)
    await createJson(folderId, "index.json", entries);
  return entries.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const inRange = (date: string) =>
  (!FROM || date >= FROM) && (!TO || date <= TO);

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
    .filter(
      (f) =>
        /^\d{4}-\d{2}-\d{2}$/.test(f.name ?? "") && inRange(f.name as string),
    )
    .sort((a, b) => (a.name as string).localeCompare(b.name as string));

  console.log(`Found ${dateFolders.length} date folder(s) to scan.\n`);

  let totalEntries = 0;
  let totalChanged = 0;
  let totalArticleFiles = 0;
  let totalUnresolved = 0;
  let totalIndexesRebuilt = 0;
  let totalRebuiltEntries = 0;
  let totalAdopted = 0;

  // --verify tallies. `ok` counts entries that pass every check; the rest are
  // independent issue counters (one entry can trip more than one).
  const au = {
    ok: 0,
    schema: 0, // index entry missing a required field
    idMismatch: 0, // url id != filename id != filePath id
    fieldDrift: 0, // index entry fields disagree with the article file
    fileMissing: 0, // index entry points to an absent/unreadable article file
    badJson: 0, // index.json or an article file is not valid JSON
    dateMisfiled: 0, // folder name / entry.date / published_date disagree
    catMismatch: 0,
    catMissing: 0,
    catUnresolved: 0,
    transEmpty: 0, // missing/empty Thai title or content
    transEnglish: 0, // Thai field contains no Thai characters
    transShort: 0, // Thai content suspiciously short vs the English
    orphan: 0, // article file on disk not referenced by the index
    dup: 0, // same url listed more than once within one day's index
    crossDup: 0, // same url archived under more than one date folder
    stray: 0, // unexpected file in a date folder
    deadUrl: 0, // source article URL returns 404 / unreachable
    noIndex: 0, // date folder has article files but no index.json
  };
  // url -> "date/file", to catch the same article archived under two dates.
  const globalUrls = new Map();

  for (const folder of dateFolders) {
    const date = folder.name as string;
    const files = await listAll(
      `'${folder.id}' in parents and trashed = false`,
      "files(id, name)",
    );
    const byName = new Map(
      files.map((f) => [f.name as string, f.id as string]),
    );

    const indexId = byName.get("index.json");
    if (!indexId) {
      if (VERIFY) {
        const n = [...byName.keys()].filter((x) =>
          /^\d+\.json$/.test(x),
        ).length;
        au.noIndex++;
        console.log(
          `${date}: NO-INDEX — ${n} article file(s) present but no index.json`,
        );
      } else if (REBUILD) {
        const n = await rebuildIndex(date, folder.id as string, byName);
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

    let entries: unknown;
    try {
      entries = await downloadJson(indexId);
    } catch (e) {
      if (VERIFY) {
        au.badJson++;
        console.log(
          `${date}: BAD-JSON index.json is not parseable (${(e as Error).message})`,
        );
      } else {
        console.warn(
          `${date}: failed to read index.json (${(e as Error).message}) — skipping`,
        );
      }
      continue;
    }
    if (!Array.isArray(entries)) {
      if (VERIFY) {
        au.badJson++;
        console.log(`${date}: BAD-JSON index.json is not a JSON array`);
      } else {
        console.warn(`${date}: index.json is not an array — skipping`);
      }
      continue;
    }

    totalEntries += entries.length;

    // Resolve true categories for this day's articles in parallel.
    await resolveCategories(entries.map((e) => e.url).filter(Boolean));

    // --verify: read-only audit. Reports (never writes) across these checks:
    //   category three-way (index vs file vs Minghui breadcrumb),
    //   field drift, schema completeness, id/date consistency,
    //   missing/orphan/stray files, in-day & cross-day url dups,
    //   translation quality, and dead source links.
    if (VERIFY) {
      const referenced = new Set(); // article file names the index points to
      const urlSeen = new Set();
      const articleFileNames = [...byName.keys()].filter((n) =>
        /^\d+\.json$/.test(n),
      );
      const REQUIRED = ["url", "title_en", "title_th", "date", "filePath"];
      const log = (id: string, tag: string, msg: string) =>
        console.log(`${date}: ${id}  ${tag} ${msg}`);

      for (const entry of entries) {
        const id = (entry?.url || entry?.filePath || "?").split("/").pop();
        const issues = [];

        // Schema: required fields present.
        const missingFields = REQUIRED.filter((f) => !entry?.[f]);
        if (missingFields.length) {
          au.schema++;
          issues.push("schema");
          log(id, "SCHEMA", `missing field(s): ${missingFields.join(", ")}`);
        }
        if (!entry?.url) continue; // nothing more we can key on

        // In-day duplicate url.
        if (urlSeen.has(entry.url)) {
          au.dup++;
          issues.push("dup");
          log(id, "DUPLICATE", "url repeated in this day's index");
        }
        urlSeen.add(entry.url);

        // Cross-day duplicate url (same article under two date folders).
        const where = `${date}/${(entry.filePath || "").split("/").pop()}`;
        if (globalUrls.has(entry.url)) {
          au.crossDup++;
          issues.push("crossDup");
          log(id, "CROSS-DUP", `also archived at ${globalUrls.get(entry.url)}`);
        } else {
          globalUrls.set(entry.url, where);
        }

        // ID consistency: url id == filePath id == actual filename.
        const urlId = (entry.url.match(/\/(\d+)\.html/) || [])[1];
        const fileName = (entry.filePath || "").split("/").pop();
        const pathId = (fileName.match(/^(\d+)\.json$/) || [])[1];
        if (urlId && pathId && urlId !== pathId) {
          au.idMismatch++;
          issues.push("idMismatch");
          log(id, "ID-MISMATCH", `url id ${urlId} != file id ${pathId}`);
        }

        if (fileName) referenced.add(fileName);
        const articleId = fileName && byName.get(fileName);
        if (!articleId) {
          au.fileMissing++;
          issues.push("fileMissing");
          log(
            id,
            "FILE-MISSING",
            `index points to "${entry.filePath}" (absent)`,
          );
          continue;
        }

        let art: ArticleFile;
        try {
          art = (await downloadJson(articleId)) as ArticleFile;
        } catch (e) {
          au.badJson++;
          issues.push("badJson");
          log(
            id,
            "BAD-JSON",
            `article file unparseable (${(e as Error).message})`,
          );
          continue;
        }
        if (!art || typeof art !== "object") {
          au.badJson++;
          issues.push("badJson");
          log(id, "BAD-JSON", "article file is not a JSON object");
          continue;
        }

        // Field drift: index entry must agree with the article file.
        const drift: string[] = [];
        const cmp = (
          field: string,
          a: string | undefined,
          b: string | undefined,
        ) => {
          if ((a ?? "") !== (b ?? ""))
            drift.push(`${field}(index="${a ?? "—"}" file="${b ?? "—"}")`);
        };
        cmp("url", entry.url, art.url);
        cmp("title_en", entry.title_en, art.title_en);
        cmp("title_th", entry.title_th, art.title_th);
        cmp("date", entry.date, art.published_date);
        if (drift.length) {
          au.fieldDrift++;
          issues.push("fieldDrift");
          log(id, "FIELD-DRIFT", drift.join("; "));
        }

        // Date misfiling: folder name == entry.date == published_date.
        if (
          entry.date !== date ||
          (art.published_date && art.published_date !== date)
        ) {
          au.dateMisfiled++;
          issues.push("dateMisfiled");
          log(
            id,
            "DATE-MISFILED",
            `folder=${date} entry.date=${entry.date} published_date=${art.published_date ?? "—"}`,
          );
        }

        // Category three-way.
        const truth = categoryCache.get(entry.url);
        const idxCat = entry.category ?? "—";
        const artCat = art.category ?? "—";
        if (!truth) {
          au.catUnresolved++;
          issues.push("catUnresolved");
          log(id, "CATEGORY-UNRESOLVED", "breadcrumb unreadable");
        } else if (idxCat !== truth || artCat !== truth) {
          if (idxCat === "—" || artCat === "—") {
            au.catMissing++;
            issues.push("catMissing");
            log(
              id,
              "CATEGORY-MISSING",
              `index="${idxCat}" file="${artCat}" truth="${truth}"`,
            );
          } else {
            au.catMismatch++;
            issues.push("catMismatch");
            log(
              id,
              "CATEGORY-MISMATCH",
              `index="${idxCat}" file="${artCat}" truth="${truth}"`,
            );
          }
        }

        // Translation quality.
        const tTh = (art.title_th || "").trim();
        const cTh = (art.content_th || "").trim();
        const cEn = (art.content_en || "").trim();
        if (!tTh || !cTh) {
          au.transEmpty++;
          issues.push("transEmpty");
          log(
            id,
            "TRANS-EMPTY",
            `title_th=${tTh ? "ok" : "EMPTY"} content_th=${cTh ? "ok" : "EMPTY"}`,
          );
        } else {
          if (!hasThai(tTh) || !hasThai(cTh)) {
            au.transEnglish++;
            issues.push("transEnglish");
            log(
              id,
              "TRANS-ENGLISH",
              "Thai field has no Thai characters (untranslated?)",
            );
          }
          // Suspiciously short Thai content relative to the English source.
          if (cEn && cTh.length < cEn.length * 0.15) {
            au.transShort++;
            issues.push("transShort");
            log(
              id,
              "TRANS-SHORT",
              `content_th ${cTh.length} chars vs content_en ${cEn.length} (truncated?)`,
            );
          }
        }

        // Dead source link (status captured during category fetch).
        const st = urlStatus.get(entry.url);
        if (st && st !== "ok") {
          au.deadUrl++;
          issues.push("deadUrl");
          log(id, "DEAD-URL", `source returned ${st}`);
        }

        if (issues.length === 0) au.ok++;
      }

      // Orphan article files: present on disk, absent from the index.
      for (const name of articleFileNames) {
        if (!referenced.has(name)) {
          au.orphan++;
          console.log(
            `${date}: ${name}  ORPHAN — article file not listed in index.json`,
          );
        }
      }

      // Stray files: not an article json and not the index.
      for (const name of byName.keys()) {
        if (name !== "index.json" && !/^\d+\.json$/.test(name)) {
          au.stray++;
          console.log(
            `${date}: ${name}  STRAY — unexpected file in date folder`,
          );
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
            const art = (await downloadJson(articleId)) as ArticleFile;
            if (art && typeof art === "object" && art.category !== truth) {
              art.category = truth;
              await updateJson(articleId, art);
              totalArticleFiles++;
            }
          } catch (e) {
            console.warn(
              `  ! failed updating ${fileName}: ${(e as Error).message}`,
            );
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
        entries.map((e) => (e.filePath || "").split("/").pop()).filter(Boolean),
      );
      const orphans = [...byName.entries()].filter(
        ([name]) => /^\d+\.json$/.test(name) && !referenced.has(name),
      );
      for (const [name, id] of orphans) {
        try {
          const art = (await downloadJson(id)) as ArticleFile;
          if (!art || typeof art !== "object" || !art.url) {
            console.warn(
              `  ! ${date}/${name}: not a valid article — not adopted`,
            );
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
          console.log(
            `${date}: ${name}  ADOPTED into index${APPLY ? "" : " (dry-run)"}`,
          );
        } catch (e) {
          console.warn(`  ! ${date}/${name}: ${(e as Error).message}`);
        }
      }
    }

    if (dayChanged && APPLY) {
      await updateJson(indexId, entries);
    }
  }

  if (VERIFY) {
    const { ok, ...issues } = au;
    const bad = Object.values(issues).reduce((a, b) => a + b, 0);
    console.log(
      `\nVerify complete. entries scanned: ${totalEntries}, fully OK: ${ok}\n` +
        `  category   — mismatch: ${au.catMismatch}, missing: ${au.catMissing}, unresolved: ${au.catUnresolved}\n` +
        `  integrity  — schema: ${au.schema}, id-mismatch: ${au.idMismatch}, field-drift: ${au.fieldDrift}, ` +
        `date-misfiled: ${au.dateMisfiled}, bad-json: ${au.badJson}\n` +
        `  files      — file-missing: ${au.fileMissing}, orphan: ${au.orphan}, stray: ${au.stray}, no-index: ${au.noIndex}\n` +
        `  duplicates — in-day: ${au.dup}, cross-day: ${au.crossDup}\n` +
        `  translation— empty: ${au.transEmpty}, english-leak: ${au.transEnglish}, too-short: ${au.transShort}\n` +
        `  source     — dead-url: ${au.deadUrl}`,
    );
    console.log(
      bad === 0
        ? "✓ All checks passed: index.json, article data, categories, and translations are consistent."
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
