import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import {
  readFailuresIndex,
  ARCHIVE_LIST_TAG,
  type Article,
} from "@/lib/gdrive";

export const dynamic = "force-dynamic";

// The failures index is one small root-level file (only currently-FAILED
// articles), so this read is O(1) regardless of how large the archive grows —
// unlike scanning every per-day index. Cached under the shared archive-list tag
// so a sync (which updates the index in /api/index) purges this view too.
const loadFailuresCached = unstable_cache(
  async (): Promise<Article[]> => {
    const entries = await readFailuresIndex();
    return entries.sort((a, b) => b.date.localeCompare(a.date));
  },
  ["needs-review"],
  { tags: [ARCHIVE_LIST_TAG], revalidate: 300 },
);

export async function GET() {
  try {
    const articles = await loadFailuresCached();

    return NextResponse.json(
      { articles },
      {
        // Same short CDN window as /api/articles: the edge cache can't be purged
        // by revalidateTag, so a sync's status changes surface within ~60s on
        // reload. The owner's own session sees them immediately because the client
        // unions in this session's freshly-flagged items.
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    const err = error as Error;
    console.error("Error in GET /api/needs-review:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
