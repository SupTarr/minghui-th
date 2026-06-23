import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import {
  readDayIndex,
  writeDayIndex,
  readFile,
  ARCHIVE_CACHE_TAG,
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
 * Reads the catalog entries for the given dates (newest first), with a one-time
 * lazy backfill from the legacy global index.json for any day that has no
 * per-day index yet (e.g. data created before the per-day migration).
 */
async function loadArticlesForDates(dates: string[]): Promise<CatalogEntry[]> {
  // Read each day's index in parallel; a corrupted single day degrades to
  // empty (and falls through to the legacy backfill) rather than failing all.
  const dayResults = await Promise.all(
    dates.map(async (date) => {
      try {
        return { date, entries: await readDayIndex(date) };
      } catch (e) {
        console.error(`Failed reading day index ${date}:`, e);
        return { date, entries: [] as CatalogEntry[] };
      }
    }),
  );

  // For any in-range day with no per-day index yet, derive it from the legacy
  // global index, serve it, and persist a per-day index so the global file is
  // never read for that day again. Global is read at most once here.
  const missingDays = dayResults.filter((r) => r.entries.length === 0);
  if (missingDays.length > 0) {
    let legacyByDate: Map<string, CatalogEntry[]> | null = null;
    try {
      const legacy = await readFile("index.json");
      if (Array.isArray(legacy)) {
        legacyByDate = new Map();
        for (const e of legacy as CatalogEntry[]) {
          if (!e?.date) continue;
          const bucket = legacyByDate.get(e.date);
          if (bucket) bucket.push(e);
          else legacyByDate.set(e.date, [e]);
        }
      }
    } catch (e) {
      console.warn("Legacy index.json backfill read failed:", e);
    }

    if (legacyByDate) {
      for (const result of missingDays) {
        const legacyDay = legacyByDate.get(result.date);
        if (legacyDay && legacyDay.length > 0) {
          result.entries = legacyDay;
          try {
            await writeDayIndex(result.date, legacyDay);
          } catch (e) {
            console.error(`Backfill write for ${result.date} failed:`, e);
          }
        }
      }
    }
  }

  return dayResults
    .flatMap((r) => r.entries)
    .sort((a, b) => b.date.localeCompare(a.date));
}

// Cache the per-range read in Next's Data Cache (keyed by the date list) so
// repeated views don't re-hit Drive. Invalidated via revalidateTag on write.
const loadArticlesForDatesCached = unstable_cache(
  loadArticlesForDates,
  ["articles-range"],
  { tags: [ARCHIVE_CACHE_TAG], revalidate: 300 },
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dates = enumerateDates(
      searchParams.get("from"),
      searchParams.get("to"),
    );

    const articles = await loadArticlesForDatesCached(dates);

    return NextResponse.json({
      articles,
      range: { from: dates[dates.length - 1] ?? null, to: dates[0] ?? null },
    });
  } catch (error) {
    const err = error as Error;
    console.error("Error in GET /api/articles:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
