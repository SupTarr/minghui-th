import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { readFileAtPath, ARTICLE_CONTENT_TAG } from "@/lib/gdrive";

export const dynamic = "force-dynamic";

// Article content is immutable once saved, so cache it aggressively keyed by
// filePath, under its own tag so routine syncs don't purge it.
const readArticleCached = unstable_cache(
  (filePath: string) => readFileAtPath(filePath),
  ["article-content"],
  { tags: [ARTICLE_CONTENT_TAG], revalidate: 3600 },
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const filePath = searchParams.get("filePath");

    if (!filePath) {
      return NextResponse.json(
        { error: 'Missing required query parameter "filePath"' },
        { status: 400 },
      );
    }

    const content = await readArticleCached(filePath);
    if (!content) {
      return NextResponse.json(
        { error: `Article at path "${filePath}" not found` },
        { status: 404 },
      );
    }

    return NextResponse.json(content, {
      // Content never changes after it's saved, so let the CDN hold it for a
      // long time and serve stale while revalidating.
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    const err = error as Error;
    console.error("Error in GET /api/article:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
