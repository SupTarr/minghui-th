// Backfill the content-validation status onto the existing archive.
//
// Runs the SAME deterministic validator the live pipeline uses
// (lib/contentValidation.ts) over every archived article, writes the slim
// `validation` record into the per-article JSON, and mirrors status/failures
// onto the per-day index entry — so old content shows up in the app's
// "Needs review" tab alongside freshly-flagged content.
//
// TypeScript ESM (`.mts`) run directly by Node ≥ 22.18 (native type-stripping):
//   node --env-file=.env scripts/backfill-validation.mts            # dry-run (no writes)
//   node --env-file=.env scripts/backfill-validation.mts --apply    # write changes
//   ... --from=2026-06-01 --to=2026-06-30                           # limit date range
//   ... --refetch        # also re-download source HTML for the completeness check
//   ... --force          # re-validate even entries already at the current version
//
// Safe to re-run: idempotent and stamped with the validator version, so it only
// re-checks an article when the validator has changed (or with --force), and it
// never deletes anything.

import { google, type drive_v3 } from "googleapis";
import {
  validateArticle,
  toStoredRecord,
  CONFIG_VERSION,
  type StoredValidation,
  type StoredFailure,
} from "../lib/contentValidation.ts";

const APPLY = process.argv.includes("--apply");
const REFETCH = process.argv.includes("--refetch");
const FORCE = process.argv.includes("--force");
const argVal = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const FROM = argVal("from"); // inclusive YYYY-MM-DD, optional
const TO = argVal("to"); // inclusive YYYY-MM-DD, optional

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Loaded lazily only with --refetch so the default path never pulls in cheerio.
let sourceBodyTextLength: ((html: string) => number) | null = null;

interface ArticleFile {
  url?: string;
  title_en?: string;
  title_th?: string;
  content_en?: string;
  content_th?: string;
  validation?: StoredValidation;
  [k: string]: unknown;
}

interface IndexEntry {
  url?: string;
  filePath?: string;
  status?: "PASS" | "FAILED";
  failures?: StoredFailure[];
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

async function updateJson(fileId: string, obj: unknown): Promise<void> {
  await drive.files.update({
    fileId,
    supportsAllDrives: true,
    media: { mimeType: "application/json", body: JSON.stringify(obj) },
    fields: "id",
  });
}

// ---------------------------------------------------------------------------
// Source-body length (for the completeness check) — only with --refetch
// ---------------------------------------------------------------------------
const sourceLenCache = new Map<string, number>();

async function fetchSourceLen(url: string): Promise<number | undefined> {
  if (!REFETCH || !sourceBodyTextLength) return undefined;
  if (sourceLenCache.has(url)) return sourceLenCache.get(url);
  let len = 0;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) len = sourceBodyTextLength(await res.text());
    else console.warn(`  ! HTTP ${res.status} for ${url}`);
  } catch (e) {
    console.warn(`  ! fetch failed for ${url}: ${(e as Error).message}`);
  }
  sourceLenCache.set(url, len);
  return len > 0 ? len : undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const inRange = (date: string): boolean =>
  (!FROM || date >= FROM) && (!TO || date <= TO);

async function main(): Promise<void> {
  if (REFETCH) {
    ({ sourceBodyTextLength } = await import("../lib/parseArticle.ts"));
  }

  const mode = APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)";
  console.log(
    `Backfill validation — mode: ${mode}, configVersion: ${CONFIG_VERSION}` +
      `${REFETCH ? ", refetch: on" : ""}` +
      `${FROM || TO ? `, range: ${FROM || "…"}..${TO || "…"}` : ""}`,
  );

  const rootId = await resolveRootId();
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

  let scanned = 0;
  let pass = 0;
  let failed = 0;
  let skipped = 0; // already at current version (no --force)
  let changed = 0; // entries whose status/desc changed (would be) written
  const checkFailCounts = new Map<string, number>();

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
      console.log(`${date}: no index.json — skipping`);
      continue;
    }

    let entries: IndexEntry[];
    try {
      const data = await downloadJson(indexId);
      if (!Array.isArray(data)) {
        console.warn(`${date}: index.json is not an array — skipping`);
        continue;
      }
      entries = data as IndexEntry[];
    } catch (e) {
      console.warn(
        `${date}: failed to read index.json (${(e as Error).message}) — skipping`,
      );
      continue;
    }

    let dayChanged = 0;
    for (const entry of entries) {
      const fileName = (entry.filePath || "").split("/").pop() || "";
      const articleId = fileName && byName.get(fileName);
      if (!articleId) continue; // file-missing handled by the category audit

      let art: ArticleFile;
      try {
        const data = await downloadJson(articleId);
        if (!data || typeof data !== "object") continue;
        art = data as ArticleFile;
      } catch (e) {
        console.warn(`  ! ${date}/${fileName}: ${(e as Error).message}`);
        continue;
      }

      scanned++;
      if (
        !FORCE &&
        art.validation &&
        art.validation.configVersion === CONFIG_VERSION
      ) {
        skipped++;
        if (art.validation.status === "FAILED") failed++;
        else pass++;
        continue;
      }

      const sourceTextLength = entry.url
        ? await fetchSourceLen(entry.url)
        : undefined;

      const result = validateArticle(
        {
          title_en: art.title_en ?? "",
          content_en: art.content_en ?? "",
          title_th: art.title_th ?? "",
          content_th: art.content_th ?? "",
          sourceTextLength,
        },
        new Date().toISOString(),
      );

      if (result.status === "FAILED") {
        failed++;
        for (const c of result.checks) {
          if (!c.ok)
            checkFailCounts.set(c.id, (checkFailCounts.get(c.id) ?? 0) + 1);
        }
        console.log(`${date}: ${fileName}  FAILED — ${result.statusDesc}`);
      } else {
        pass++;
        // Still record tripped warnings for calibration visibility.
        for (const c of result.checks) {
          if (!c.ok)
            checkFailCounts.set(c.id, (checkFailCounts.get(c.id) ?? 0) + 1);
        }
      }

      const stored = toStoredRecord(result);
      const entryChanged =
        entry.status !== stored.status ||
        JSON.stringify(entry.failures ?? null) !==
          JSON.stringify(stored.failures);
      if (entryChanged) {
        entry.status = stored.status;
        entry.failures = stored.failures;
        dayChanged++;
        changed++;
      }

      if (APPLY) {
        art.validation = stored;
        try {
          await updateJson(articleId, art);
        } catch (e) {
          console.warn(
            `  ! failed writing ${fileName}: ${(e as Error).message}`,
          );
        }
      }
    }

    if (dayChanged && APPLY) {
      try {
        await updateJson(indexId, entries);
      } catch (e) {
        console.warn(
          `${date}: failed writing index.json (${(e as Error).message})`,
        );
      }
    }
  }

  console.log(
    `\nDone. scanned: ${scanned}, PASS: ${pass}, FAILED: ${failed}, ` +
      `skipped (up-to-date): ${skipped}, entries ${APPLY ? "updated" : "to update"}: ${changed}`,
  );
  if (checkFailCounts.size) {
    const lines = [...checkFailCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `  ${id}: ${n}`);
    console.log("Check failures/warnings (for threshold calibration):");
    console.log(lines.join("\n"));
  }
  if (!APPLY && changed) {
    console.log("\nRe-run with --apply to write these flags.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
