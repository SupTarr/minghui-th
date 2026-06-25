import { NextResponse } from "next/server";
import { writeFile } from "@/lib/gdrive";
import { authorize } from "@/lib/auth";

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
      validation,
    } = article;
    // Fall back to the parent category when the list row had no sub-category.
    const articleCategory = category || "Cultivation";

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

    const articlePayload = {
      url,
      title_en,
      title_th,
      content_en,
      content_th,
      category: articleCategory,
      published_date: date,
      fetched_at: new Date().toISOString(),
      // Full validation detail (optional — absent on manual saves that skip it).
      ...(validation && typeof validation === "object" ? { validation } : {}),
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
      category: articleCategory,
      filePath: `/${folderName}/${fileName}`,
      // Mirror the validation status onto the catalog entry so the archive list
      // and "Needs review" tab can filter without loading each article file.
      ...(validation && typeof validation === "object"
        ? { status: validation.status, statusDesc: validation.statusDesc }
        : {}),
    };

    return NextResponse.json({
      success: true,
      filePath: entry.filePath,
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
