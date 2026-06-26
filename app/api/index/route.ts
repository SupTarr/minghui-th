import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  readDayIndex,
  writeDayIndex,
  readFailuresIndex,
  writeFailuresIndex,
  ARCHIVE_LIST_TAG,
  type Article,
} from "@/lib/gdrive";
import { authorize } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Merges a batch of catalog entries into the relevant per-day index files
 * (`/{date}/index.json`), one read-merge-write per distinct date.
 *
 * Per-day indexes replace the single global index.json: each day's file is only
 * ever touched by that day's articles, which removes the global write hotspot
 * (no cross-day races) and bounds every read to a small file.
 */
export async function POST(req: Request) {
  try {
    const auth = await authorize(req);
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized", reason: auth.reason },
        { status: auth.status },
      );
    }

    const body = await req.json().catch(() => ({}));
    const entries: Article[] = Array.isArray(body?.entries)
      ? body.entries
      : [];

    if (entries.length === 0) {
      return NextResponse.json({ success: true, added: 0, days: [] });
    }

    // Group incoming entries by their date so each day's index is written once.
    const byDate = new Map<string, Article[]>();
    for (const entry of entries) {
      if (!entry?.url || !entry?.date) continue;
      const bucket = byDate.get(entry.date);
      if (bucket) bucket.push(entry);
      else byDate.set(entry.date, [entry]);
    }

    // NOTE: each day's index is a read-merge-write with no cross-process lock.
    // Drive API v3 exposes no conditional-write / If-Match precondition, so a
    // true compare-and-set isn't possible here. Concurrent writers to the SAME
    // day (the scheduled cron overlapping a manual UI sync) can still lose
    // updates; that residual is handled out-of-band by the archive
    // reconcile/adopt-orphans tooling and is low-risk for a single-user app.
    let added = 0;
    const days: string[] = [];
    const failed: string[] = [];
    // Entries that actually committed to a per-day index, so the failures index
    // below only mirrors written data (not entries from a day whose write threw).
    const indexedEntries: Article[] = [];
    for (const [date, dayEntries] of byDate) {
      // Isolate each day: readDayIndex throws on a corrupted (non-array) index,
      // and writes can fail transiently. Catching per day means one bad day no
      // longer aborts the rest and leaves earlier days written behind a 500 that
      // hides the partial write.
      try {
        const current = await readDayIndex(date);

        const merged = new Map<string, Article>(
          current.map((e) => [e.url, e]),
        );
        for (const entry of dayEntries) merged.set(entry.url, entry);

        await writeDayIndex(date, Array.from(merged.values()));
        added += dayEntries.length;
        days.push(date);
        indexedEntries.push(...dayEntries);
      } catch (dayErr) {
        console.error(`Failed to update index for ${date}:`, dayErr);
        failed.push(date);
      }
    }

    // Maintain the global failures index from the committed entries: a FAILED
    // entry is upserted, a PASS entry clears any prior failure for that url — so
    // the "Needs review" tab reads one small file in O(1) instead of scanning
    // every per-day index. In its own try so a hiccup here never fails the
    // article-index write above; the backfill rebuilds this index authoritatively,
    // so any drift self-heals. Keyed by url to match the per-day merge.
    if (indexedEntries.length > 0) {
      try {
        const failures = new Map<string, Article>(
          (await readFailuresIndex()).map((e) => [e.url, e]),
        );
        for (const entry of indexedEntries) {
          if (entry.status === "FAILED") failures.set(entry.url, entry);
          else failures.delete(entry.url);
        }
        await writeFailuresIndex(Array.from(failures.values()));
      } catch (failErr) {
        console.error("Failed to update needs-review index:", failErr);
      }
    }

    // New articles landed — expire the cached article list (and the failures
    // index, which shares this tag) immediately so they show up on the next load
    // instead of serving stale (expire:0 is the sanctioned route-handler pattern
    // for immediate invalidation in Next 16). Article content is immutable and
    // has its own tag, so it's left untouched.
    if (days.length > 0) {
      revalidateTag(ARCHIVE_LIST_TAG, { expire: 0 });
    }

    // Only a total failure (nothing written) is a 500; a partial success still
    // reports the days that did commit so the caller isn't told everything failed.
    const allFailed = days.length === 0 && failed.length > 0;
    return NextResponse.json(
      { success: !allFailed, added, days, failed },
      { status: allFailed ? 500 : 200 },
    );
  } catch (error) {
    const err = error as Error;
    console.error("Error in POST /api/index:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
