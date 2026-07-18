import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { readFileAtPath, ARTICLE_CONTENT_TAG } from "@/lib/gdrive";

export const dynamic = "force-dynamic";

// This endpoint is intentionally public (it serves article content to every
// reader), so filePath is attacker-controllable. Stored article paths are always
// `/YYYY-MM-DD/<id>.json`; pin filePath to exactly that shape so it can't be
// used to traverse the folder tree or smuggle characters toward the Drive query.
const ARTICLE_PATH_RE = /^\/\d{4}-\d{2}-\d{2}\/\d+\.json$/;

// Article content changes only on a repair re-save (which expires the tag), so
// cache it aggressively keyed by filePath, under its own tag so routine syncs
// don't purge it.
//
// A miss must NOT be cached: the article may be saved moments later (e.g. a
// share link opened mid-sync), and a cached null would serve 404 for an hour.
// unstable_cache never caches a thrown error, so signal the miss by throwing
// this marker and map it back to a 404 in the handler.
const ARTICLE_NOT_FOUND = "ARTICLE_NOT_FOUND";
const readArticleCached = unstable_cache(
  async (filePath: string) => {
    const content = await readFileAtPath(filePath);
    if (content === null) throw new Error(ARTICLE_NOT_FOUND);
    return content;
  },
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

    if (!ARTICLE_PATH_RE.test(filePath)) {
      return NextResponse.json(
        { error: 'Invalid "filePath" format' },
        { status: 400 },
      );
    }

    let content: unknown;
    try {
      content = await readArticleCached(filePath);
    } catch (e) {
      if ((e as Error)?.message === ARTICLE_NOT_FOUND) {
        return NextResponse.json(
          { error: `Article at path "${filePath}" not found` },
          { status: 404 },
        );
      }
      throw e;
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
    // Public endpoint: return a generic message (real error logged above) so
    // internal/Drive details aren't echoed to arbitrary callers.
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
