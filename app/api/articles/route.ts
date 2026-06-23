import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import {
  readDayIndex,
  ARCHIVE_LIST_TAG,
  type CatalogEntry,
} from "@/lib/gdrive";

export const dynamic = "force-dynamic";

const MAX_DAYS = 7;

function toDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Builds the list of date strings in [from, to], newest first, capped at
 * MAX_DAYS. A missing/invalid `to` ends at today; a missing `from` defaults to
 * the full MAX_DAYS window; an invalid/after-end `from` collapses to a single
 * day (the explicit single-date case).
 */
function enumerateDates(from: string | null, to: string | null): string[] {
  let end = to ? new Date(`${to}T00:00:00`) : new Date();
  if (isNaN(end.getTime())) end = new Date();

  let start: Date;
  if (from) {
    start = new Date(`${from}T00:00:00`);
    if (isNaN(start.getTime()) || start > end) start = new Date(end);
  } else {
    start = new Date(end);
    start.setDate(start.getDate() - (MAX_DAYS - 1));
  }

  const dates: string[] = [];
  const cursor = new Date(end);
  while (cursor >= start && dates.length < MAX_DAYS) {
    dates.push(toDateStr(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return dates;
}

/**
 * Reads the per-day catalog indexes for the given dates and returns the entries
 * newest-first. A corrupted single day degrades to empty rather than failing all.
 */
async function loadArticlesForDates(dates: string[]): Promise<CatalogEntry[]> {
  const dayResults = await Promise.all(
    dates.map(async (date) => {
      try {
        return await readDayIndex(date);
      } catch (e) {
        console.error(`Failed reading day index ${date}:`, e);
        return [] as CatalogEntry[];
      }
    }),
  );

  return dayResults.flat().sort((a, b) => b.date.localeCompare(a.date));
}

// Cache the per-range read in Next's Data Cache (keyed by the date list) so
// repeated views don't re-hit Drive. Invalidated via revalidateTag on write.
const loadArticlesForDatesCached = unstable_cache(
  loadArticlesForDates,
  ["articles-range"],
  { tags: [ARCHIVE_LIST_TAG], revalidate: 300 },
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dates = enumerateDates(
      searchParams.get("from"),
      searchParams.get("to"),
    );

    const articles = await loadArticlesForDatesCached(dates);

    return NextResponse.json(
      {
        articles,
        range: { from: dates[dates.length - 1] ?? null, to: dates[0] ?? null },
      },
      {
        // Let the CDN serve repeat loads. Kept short because the edge cache
        // can't be purged by revalidateTag, so a sync's new articles surface
        // within ~60s on reload (the owner's session shows them immediately).
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    const err = error as Error;
    console.error("Error in GET /api/articles:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
