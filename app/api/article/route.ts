import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { readFileAtPath, ARCHIVE_CACHE_TAG } from "@/lib/gdrive";

export const dynamic = "force-dynamic";

// Article content is immutable once saved, so cache it aggressively keyed by
// filePath. The archive tag still lets us purge it on demand if ever needed.
const readArticleCached = unstable_cache(
  (filePath: string) => readFileAtPath(filePath),
  ["article-content"],
  { tags: [ARCHIVE_CACHE_TAG], revalidate: 3600 },
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

    return NextResponse.json(content);
  } catch (error) {
    const err = error as Error;
    console.error("Error in GET /api/article:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
