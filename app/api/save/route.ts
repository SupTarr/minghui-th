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

    const article = await req.json();
    const { url, title_en, title_th, content_en, content_th, date, category } =
      article;
    // Fall back to the parent category when the list row had no sub-category.
    const articleCategory = category || "Cultivation";

    if (!url || !title_en || !title_th || !content_en || !content_th || !date) {
      return NextResponse.json(
        { error: "Missing required article fields in request body" },
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

    const articlePayload = {
      url,
      title_en,
      title_th,
      content_en,
      content_th,
      category: articleCategory,
      published_date: date,
      fetched_at: new Date().toISOString(),
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
