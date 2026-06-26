import { NextResponse } from "next/server";
import { writeFile } from "@/lib/gdrive";
import { authorize } from "@/lib/auth";
import { isValidArticleDate, isHttpUrl } from "@/lib/apiValidation";
import {
  toStoredRecord,
  type ValidationResult,
  type StoredValidation,
} from "@/lib/contentValidation";

export async function POST(req: Request) {
  try {
    const auth = await authorize(req);
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized", reason: auth.reason },
        { status: auth.status },
      );
    }

    const article = await req.json().catch(() => null);
    if (!article || typeof article !== "object") {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    const {
      url,
      title_en,
      title_th,
      content_en,
      content_th,
      date,
      category,
      subcategory,
      validation,
    } = article;
    // category is the top-level section; subcategory is the leaf. Both arrive
    // already coalesced (breadcrumb ?? scraped) from the caller. When even that is
    // empty we leave category undefined (omitted below) rather than mislabeling an
    // unknown article as a real section like "Cultivation".
    const articleCategory =
      typeof category === "string" && category.length > 0 ? category : undefined;
    const articleSubcategory =
      typeof subcategory === "string" && subcategory.length > 0
        ? subcategory
        : undefined;

    // Require each field to be a non-empty string so a malformed body fails with
    // a 400 here (and url.match below never throws a TypeError on a non-string).
    const required = { url, title_en, title_th, content_en, content_th, date };
    for (const [field, value] of Object.entries(required)) {
      if (typeof value !== "string" || value.length === 0) {
        return NextResponse.json(
          { error: `Missing or invalid article field: ${field}` },
          { status: 400 },
        );
      }
    }

    // Defense in depth: `date` becomes a Drive folder name and `url` is rendered
    // as an <a href> in the reader, so pin both to safe shapes here rather than
    // trusting the caller — a malformed date can't create an odd folder, and a
    // non-http url (e.g. javascript:) can't be stored.
    if (!isValidArticleDate(date)) {
      return NextResponse.json(
        { error: `Invalid date format (expected YYYY-MM-DD): ${date}` },
        { status: 400 },
      );
    }
    if (!isHttpUrl(url)) {
      return NextResponse.json(
        { error: "Article url must be an http(s) link" },
        { status: 400 },
      );
    }

    // 1. Extract article ID from URL (e.g., 234818 from .../234818.html)
    const idMatch = url.match(/\/(\d+)\.html/);
    if (!idMatch) {
      return NextResponse.json(
        { error: `Could not parse article ID from URL: ${url}` },
        { status: 400 },
      );
    }
    const articleId = idMatch[1];

    // 2. Format names and content structure
    const folderName = date; // Format: YYYY-MM-DD
    const fileName = `${articleId}.json`;

    // Slim the validation to its persisted, text-free shape. /api/translate sends
    // the full in-memory result (has `checks`); a manual re-save may send an
    // already-slim record (has `failures`) — pass that through unchanged.
    const rawValidation =
      validation && typeof validation === "object"
        ? (validation as Record<string, unknown>)
        : null;
    const storedValidation: StoredValidation | undefined = rawValidation
      ? Array.isArray(rawValidation.checks)
        ? toStoredRecord(rawValidation as unknown as ValidationResult)
        : (rawValidation as unknown as StoredValidation)
      : undefined;

    const articlePayload = {
      url,
      title_en,
      title_th,
      content_en,
      content_th,
      ...(articleCategory ? { category: articleCategory } : {}),
      ...(articleSubcategory ? { subcategory: articleSubcategory } : {}),
      date,
      fetched_at: new Date().toISOString(),
      // Slim, text-free validation record (optional — absent on manual saves).
      ...(storedValidation ? { validation: storedValidation } : {}),
    };

    // 3. Write individual article JSON to Drive folder
    await writeFile(folderName, fileName, articlePayload);

    // 4. Return the catalog entry. The index.json isn't written here; the caller
    // posts this entry to /api/index right after the save succeeds, so each
    // article lands in its per-day index as soon as it's translated.
    const entry = {
      url,
      title_en,
      title_th,
      date,
      ...(articleCategory ? { category: articleCategory } : {}),
      ...(articleSubcategory ? { subcategory: articleSubcategory } : {}),
      filePath: `/${folderName}/${fileName}`,
      // Mirror the validation summary onto the catalog entry so the archive list
      // and "Needs review" tab can filter + render without loading each article
      // file. statusDesc is no longer written — the UI renders text from
      // validation.json via renderFailures(failures).
      ...(storedValidation
        ? {
            status: storedValidation.status,
            failures: storedValidation.failures,
          }
        : {}),
    };

    return NextResponse.json({
      success: true,
      entry,
    });
  } catch (error) {
    const err = error as Error;
    console.error("Error in /api/save:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
