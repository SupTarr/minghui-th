import { google, drive_v3 } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

// Cache tag for the read paths (article list + content). Bump via revalidateTag
// whenever the catalog changes so new articles appear without waiting for TTL.
export const ARCHIVE_CACHE_TAG = "archive";

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
  };

  const driveId = process.env.GOOGLE_DRIVE_ID;
  if (driveId) {
    params.corpora = "drive";
    params.driveId = driveId;
  }

  return params;
}

async function resolvePathToId(
  drive: drive_v3.Drive,
  path: string,
): Promise<string> {
  const parts = path.split("/").filter((p) => p.length > 0);
  let currentParentId = "root";

  for (const part of parts) {
    const query = `mimeType = 'application/vnd.google-apps.folder' and name = '${part}' and '${currentParentId}' in parents and trashed = false`;
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

/**
 * Checks if a folder exists inside a parent folder, and creates it if it doesn't.
 * Returns the folder ID.
 */
export async function createFolder(
  folderName: string,
  parentId: string,
): Promise<string> {
  const drive = initDrive();

  // Search for existing folder
  const query = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName}' and '${parentId}' in parents and trashed = false`;
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
}

/**
 * Reads a JSON file from the root folder in Google Drive.
 * Returns null if the file does not exist.
 */
export async function readFile(fileName: string): Promise<unknown> {
  const drive = initDrive();
  const rootFolderId = await getRootFolderId(drive);

  // Search for the file
  const query = `name = '${fileName}' and '${rootFolderId}' in parents and trashed = false`;
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
      return data;
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

  // Search for existing file
  const query = `name = '${fileName}' and '${targetFolderId}' in parents and trashed = false`;
  const listRes = await drive.files.list(getListParams(query, "files(id)"));

  const files = listRes.data.files;
  const bodyString =
    typeof content === "string" ? content : JSON.stringify(content);

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
      query = `name = '${part}' and '${currentParentId}' in parents and trashed = false`;
    } else {
      // Find the intermediate folder
      query = `mimeType = 'application/vnd.google-apps.folder' and name = '${part}' and '${currentParentId}' in parents and trashed = false`;
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
      return data;
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
