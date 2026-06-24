import { google, drive_v3 } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

// Cache tags for the read paths, kept separate on purpose: the article list
// changes when new articles are synced (purge it then), but article content is
// immutable once saved, so it has its own tag and isn't purged on every sync.
export const ARCHIVE_LIST_TAG = "archive-list";
export const ARTICLE_CONTENT_TAG = "article-content";

// Reuse the Drive client across invocations within a warm container. Building a
// fresh client per call discards googleapis' cached OAuth access token, forcing
// a token refresh on every Drive operation; a singleton refreshes once and
// reuses the HTTP connection.
let cachedDrive: drive_v3.Drive | null = null;

/**
 * Initializes the Google Drive API client using either OAuth2 or Service Account JWT.
 */
export function initDrive(): drive_v3.Drive {
  if (cachedDrive) return cachedDrive;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  // 1. Try OAuth2 Auth (Recommended for personal @gmail.com accounts to use user's quota)
  if (clientId && clientSecret && refreshToken) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    cachedDrive = google.drive({ version: "v3", auth: oauth2Client });
    return cachedDrive;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  // 2. Fallback to Service Account (Recommended for Google Workspace Shared Drives)
  if (!email || !privateKey) {
    throw new Error(
      "Missing Google credentials. Please provide either OAuth2 variables (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN) or Service Account variables (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).",
    );
  }

  // Format the private key to handle literal \n
  const formattedPrivateKey = privateKey.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key: formattedPrivateKey,
    scopes: SCOPES,
  });

  cachedDrive = google.drive({ version: "v3", auth });
  return cachedDrive;
}

/**
 * Helper to construct list parameters, adding driveId and corpora if GOOGLE_DRIVE_ID is set.
 */
function getListParams(
  query: string,
  fields: string,
): drive_v3.Params$Resource$Files$List {
  const params: drive_v3.Params$Resource$Files$List = {
    q: query,
    fields: fields,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    // Drive permits duplicate names under one parent, and a cross-process race
    // (cron + manual sync, retried invocations) can create duplicate date
    // folders / files. Sorting by createdTime makes every reader and writer
    // resolve files[0] to the SAME (oldest) match, so reads and writes converge
    // on one canonical node instead of picking nondeterministically. Our queries
    // filter by exact name + parent (a tiny result set), so the "avoid
    // createdTime on large collections" caveat doesn't apply.
    orderBy: "createdTime",
  };

  const driveId = process.env.GOOGLE_DRIVE_ID;
  if (driveId) {
    params.corpora = "drive";
    params.driveId = driveId;
  }

  return params;
}

// Drive query terms wrap string literals in single quotes, so a value
// containing a single quote (or backslash) would break out of the literal and
// rewrite the query — an injection sink when the value comes from user input
// (e.g. /api/article?filePath). Escape backslash first, then the quote.
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// gaxios (googleapis' HTTP layer) retries only idempotent verbs by default
// (GET/HEAD/PUT/OPTIONS/DELETE), so files.create (POST) and files.update (PATCH)
// get ZERO retries — a single transient Drive 429/5xx aborts a write and orphans
// the article (file saved, index entry missing). We retry the WHOLE
// list-then-upsert (not just the failed call): a re-list turns a
// partially-succeeded create into an update, so retries can't manufacture
// duplicates the way a blind create retry would.
const RETRYABLE_DRIVE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_WRITE_ATTEMPTS = 4;

function driveErrorStatus(err: unknown): number | undefined {
  const e = err as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  const raw = e?.response?.status ?? e?.status ?? e?.code;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && !Number.isNaN(n) ? n : undefined;
}

async function withDriveWriteRetry<T>(
  label: string,
  op: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      const status = driveErrorStatus(err);
      if (
        attempt === MAX_WRITE_ATTEMPTS ||
        status === undefined ||
        !RETRYABLE_DRIVE_STATUS.has(status)
      ) {
        throw err;
      }
      // Honor Retry-After (seconds) when Drive sends it, else exponential
      // backoff capped at 8s with jitter to avoid a thundering herd. gaxios 7's
      // response.headers is a Web `Headers` instance, so it must be read with
      // .get() — bracket access returns undefined.
      const retryAfterRaw = (err as { response?: { headers?: Headers } })?.response
        ?.headers?.get?.("retry-after");
      const retryAfter = Number(retryAfterRaw);
      const backoff =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(8000, 500 * 2 ** (attempt - 1)) +
            Math.floor(Math.random() * 250);
      console.warn(
        `Drive ${label} attempt ${attempt}/${MAX_WRITE_ATTEMPTS} failed ` +
          `(status ${status}); retrying in ${backoff}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw lastErr;
}

async function resolvePathToId(
  drive: drive_v3.Drive,
  path: string,
): Promise<string> {
  const parts = path.split("/").filter((p) => p.length > 0);
  let currentParentId = "root";

  for (const part of parts) {
    const query = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapeDriveQueryValue(part)}' and '${currentParentId}' in parents and trashed = false`;
    const res = await drive.files.list(getListParams(query, "files(id)"));

    const files = res.data.files;
    if (files && files.length > 0) {
      currentParentId = files[0].id!;
    } else {
      // Create the folder if it doesn't exist
      const createRes = await drive.files.create({
        supportsAllDrives: true,
        requestBody: {
          name: part,
          mimeType: "application/vnd.google-apps.folder",
          parents: [currentParentId],
        },
        fields: "id",
      });
      currentParentId = createRes.data.id!;
    }
  }

  return currentParentId;
}

// The root folder ID is stable for the process lifetime; cache it so a path-form
// GOOGLE_DRIVE_FOLDER_ID isn't re-resolved (one list call per segment) on every
// read/write.
let cachedRootFolderId: string | null = null;

/**
 * Returns the resolved Google Drive root folder ID.
 * If GOOGLE_DRIVE_FOLDER_ID contains a path (e.g., /Folder/Subfolder), it resolves it to an ID.
 */
export async function getRootFolderId(drive: drive_v3.Drive): Promise<string> {
  if (cachedRootFolderId) return cachedRootFolderId;

  const rawId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rawId) {
    throw new Error(
      "GOOGLE_DRIVE_FOLDER_ID is not defined in environment variables.",
    );
  }

  cachedRootFolderId = rawId.includes("/")
    ? await resolvePathToId(drive, rawId)
    : rawId;

  return cachedRootFolderId;
}

// Drive allows multiple folders with the same name under one parent, so the
// check-then-create in createFolder is NOT safe to run concurrently for the
// same folder: N parallel callers all miss the existence check and each create
// a duplicate `YYYY-MM-DD` folder, splitting that day's article files and
// index.json across the duplicates → articles silently vanish from the site.
// The cron fans saves out in-process within a single Node instance, so an
// in-process singleflight (no await between the get and set below, so two
// callers can't both pass the check) collapses concurrent calls for the same
// (parent, name) into one list+create; the rest await the same result.
const inflightFolderCreates = new Map<string, Promise<string>>();

/**
 * Checks if a folder exists inside a parent folder, and creates it if it doesn't.
 * Returns the folder ID. Concurrency-safe for the same (parent, name).
 */
export async function createFolder(
  folderName: string,
  parentId: string,
): Promise<string> {
  const key = `${parentId}/${folderName}`;
  const inflight = inflightFolderCreates.get(key);
  if (inflight) return inflight;

  const promise = withDriveWriteRetry(`createFolder(${folderName})`, async () => {
    const drive = initDrive();

    // Search for existing folder. On a retry after a transient create failure
    // this re-list finds the folder we just made, so we return it instead of
    // creating a duplicate.
    const query = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapeDriveQueryValue(folderName)}' and '${parentId}' in parents and trashed = false`;
    const listRes = await drive.files.list(
      getListParams(query, "files(id, name)"),
    );

    const files = listRes.data.files;
    if (files && files.length > 0) {
      return files[0].id!;
    }

    // Create new folder
    const folder = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      },
      fields: "id",
    });

    return folder.data.id!;
  });

  inflightFolderCreates.set(key, promise);
  try {
    return await promise;
  } finally {
    // Pure singleflight: drop the entry once settled so the next call re-checks
    // Drive (and now finds the folder we just created) rather than caching a
    // possibly-stale ID for the process lifetime.
    inflightFolderCreates.delete(key);
  }
}

/**
 * Reads a JSON file from the root folder in Google Drive.
 * Returns null if the file does not exist.
 */
export async function readFile(fileName: string): Promise<unknown> {
  const drive = initDrive();
  const rootFolderId = await getRootFolderId(drive);

  // Search for the file
  const query = `name = '${escapeDriveQueryValue(fileName)}' and '${rootFolderId}' in parents and trashed = false`;
  const listRes = await drive.files.list(getListParams(query, "files(id)"));

  const files = listRes.data.files;
  if (!files || files.length === 0) {
    return null;
  }

  const fileId = files[0].id!;

  // Download file content
  const fileRes = await drive.files.get(
    {
      fileId: fileId,
      alt: "media",
      supportsAllDrives: true,
    },
    { responseType: "text" },
  );

  const data = fileRes.data;
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      // Every file we store here is JSON; a non-JSON body means the file is
      // corrupt. Throw instead of returning the raw string so callers surface a
      // 500 rather than serving (and caching) double-encoded garbage.
      throw new Error(`File ${fileName} exists but is not valid JSON`);
    }
  }
  return data;
}

/**
 * Writes/overwrites a JSON file in Google Drive.
 * If folderName is specified, it will write the file inside that subfolder.
 * If folderName is null or empty, it will write to the root folder.
 */
export async function writeFile(
  folderName: string | null,
  fileName: string,
  content: unknown,
): Promise<string> {
  const drive = initDrive();
  const rootFolderId = await getRootFolderId(drive);

  let targetFolderId = rootFolderId;
  if (folderName) {
    targetFolderId = await createFolder(folderName, rootFolderId);
  }

  const bodyString =
    typeof content === "string" ? content : JSON.stringify(content);

  // Retry the whole list-then-upsert so a transient failure after a create
  // re-lists, finds the file, and updates it instead of making a duplicate.
  return withDriveWriteRetry(`writeFile(${fileName})`, async () => {
    // Search for existing file
    const query = `name = '${escapeDriveQueryValue(fileName)}' and '${targetFolderId}' in parents and trashed = false`;
    const listRes = await drive.files.list(getListParams(query, "files(id)"));

    const files = listRes.data.files;
    const media = {
      mimeType: "application/json",
      body: bodyString,
    };

    if (files && files.length > 0) {
      // Update existing file
      const fileId = files[0].id!;
      const updateRes = await drive.files.update({
        fileId: fileId,
        supportsAllDrives: true,
        media: media,
        fields: "id",
      });
      return updateRes.data.id!;
    } else {
      // Create new file
      const createRes = await drive.files.create({
        supportsAllDrives: true,
        requestBody: {
          name: fileName,
          parents: [targetFolderId],
          mimeType: "application/json",
        },
        media: media,
        fields: "id",
      });
      return createRes.data.id!;
    }
  });
}

/**
 * Reads a JSON file from a specific relative path (e.g. /2026-06-22/234818.json)
 * relative to the root Google Drive folder.
 */
export async function readFileAtPath(filePath: string): Promise<unknown> {
  const drive = initDrive();
  const rootFolderId = await getRootFolderId(drive);

  // Normalize path (split and filter empty strings)
  const parts = filePath.split("/").filter((p) => p.length > 0);
  let currentParentId = rootFolderId;

  // Traverse the folder path
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;

    let query = "";
    if (isLast) {
      // Find the file
      query = `name = '${escapeDriveQueryValue(part)}' and '${currentParentId}' in parents and trashed = false`;
    } else {
      // Find the intermediate folder
      query = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapeDriveQueryValue(part)}' and '${currentParentId}' in parents and trashed = false`;
    }

    const listRes = await drive.files.list(getListParams(query, "files(id)"));
    const files = listRes.data.files;
    if (!files || files.length === 0) {
      return null;
    }
    currentParentId = files[0].id!;
  }

  // Download the resolved file ID
  const fileRes = await drive.files.get(
    {
      fileId: currentParentId,
      alt: "media",
      supportsAllDrives: true,
    },
    { responseType: "text" },
  );

  const data = fileRes.data;
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      // Stored files are always JSON; a non-JSON body is corruption. Throw so
      // /api/article returns a 500 instead of serving and caching a raw,
      // double-encoded string for an hour.
      throw new Error(`File at ${filePath} exists but is not valid JSON`);
    }
  }
  return data;
}

/**
 * A single article's entry in the lightweight catalog (per-day index).
 */
export interface CatalogEntry {
  url: string;
  title_en: string;
  title_th: string;
  date: string;
  category?: string;
  filePath: string;
}

/**
 * Reads the per-day catalog index at `/{date}/index.json`.
 *
 * Returns [] when the day has no index yet (legitimate — the day is empty or
 * not synced). Throws if the file exists but is not a JSON array, so callers can
 * abort instead of overwriting a corrupted index with partial data.
 */
export async function readDayIndex(date: string): Promise<CatalogEntry[]> {
  const data = await readFileAtPath(`/${date}/index.json`);
  if (data === null) return [];
  if (Array.isArray(data)) return data as CatalogEntry[];
  throw new Error(
    `Day index ${date}/index.json exists but is not a JSON array; aborting`,
  );
}

/**
 * Writes the per-day catalog index at `/{date}/index.json`, creating the date
 * folder if needed.
 */
export async function writeDayIndex(
  date: string,
  entries: CatalogEntry[],
): Promise<void> {
  await writeFile(date, "index.json", entries);
}
