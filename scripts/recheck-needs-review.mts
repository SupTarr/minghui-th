// Read-only consistency check: find articles whose per-day index entry is
// status FAILED but are MISSING from the maintained needs-review.json (and the
// reverse — stale entries in needs-review.json that are no longer FAILED).
//
//   node --env-file=.env scripts/recheck-needs-review.mts
//
// Diagnoses drift between the per-day indexes (source of truth for a day) and
// the root failures index that the "Needs review" tab reads. Writes nothing;
// run scripts/backfill-validation.mts --apply to repair.

import { google, type drive_v3 } from "googleapis";

const NEEDS_REVIEW_FILE = "needs-review.json";

interface IndexEntry {
  url?: string;
  filePath?: string;
  date?: string;
  status?: "PASS" | "FAILED";
  [k: string]: unknown;
}

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
  if (!email || !privateKey)
    throw new Error("Missing Google credentials. Check your .env.");
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

async function main() {
  const rootId = await resolveRootId();

  // 1. Read the maintained failures index.
  const nrFiles = await listAll(
    `name = '${NEEDS_REVIEW_FILE}' and '${rootId}' in parents and trashed = false`,
    "files(id, name)",
  );
  let needsReview: IndexEntry[] = [];
  if (nrFiles.length) {
    const data = await downloadJson(nrFiles[0].id as string);
    if (Array.isArray(data)) needsReview = data as IndexEntry[];
    else console.warn(`! ${NEEDS_REVIEW_FILE} is not a JSON array`);
  } else {
    console.warn(`! ${NEEDS_REVIEW_FILE} not found at root`);
  }
  const inNeedsReview = new Set(needsReview.map((e) => e.url).filter(Boolean));

  // 2. Scan every per-day index for FAILED entries.
  const folders = await listAll(
    `mimeType = 'application/vnd.google-apps.folder' and '${rootId}' in parents and trashed = false`,
    "files(id, name)",
  );
  const dateFolders = folders
    .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.name ?? ""))
    .sort((a, b) => (a.name as string).localeCompare(b.name as string));

  const failedInIndexes: IndexEntry[] = [];
  for (const folder of dateFolders) {
    const date = folder.name as string;
    const files = await listAll(
      `'${folder.id}' in parents and trashed = false`,
      "files(id, name)",
    );
    const indexId = files.find((f) => f.name === "index.json")?.id;
    if (!indexId) continue;
    const data = await downloadJson(indexId as string).catch((e) => {
      console.warn(
        `${date}: failed to read index.json (${(e as Error).message})`,
      );
      return null;
    });
    if (!Array.isArray(data)) continue;
    for (const entry of data as IndexEntry[]) {
      if (entry.status === "FAILED") failedInIndexes.push({ ...entry, date });
    }
  }

  const failedUrls = new Set(failedInIndexes.map((e) => e.url).filter(Boolean));

  // 3a. FAILED in a day index but MISSING from needs-review.json (the bug).
  const missing = failedInIndexes.filter((e) => !inNeedsReview.has(e.url));
  // 3b. In needs-review.json but no longer FAILED anywhere (stale).
  const stale = needsReview.filter((e) => !failedUrls.has(e.url));

  console.log(`\n=== Needs-review consistency check ===`);
  console.log(`Date folders scanned:        ${dateFolders.length}`);
  console.log(`FAILED entries in day index: ${failedInIndexes.length}`);
  console.log(`Entries in needs-review.json: ${needsReview.length}`);
  console.log(
    `\nMISSING (FAILED but not in needs-review.json): ${missing.length}`,
  );
  for (const e of missing) console.log(`  - ${e.date}  ${e.url}`);
  console.log(
    `\nSTALE (in needs-review.json but no longer FAILED): ${stale.length}`,
  );
  for (const e of stale) console.log(`  - ${e.date ?? "?"}  ${e.url}`);

  if (missing.length || stale.length) {
    console.log(
      `\nDrift detected. Repair with:\n  node --env-file=.env scripts/backfill-validation.mts --apply`,
    );
  } else {
    console.log(`\nNo drift — needs-review.json matches the per-day indexes.`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
