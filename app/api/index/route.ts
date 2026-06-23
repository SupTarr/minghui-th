import { NextResponse } from "next/server";
import { readDayIndex, writeDayIndex, type CatalogEntry } from "@/lib/gdrive";
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
    const entries: CatalogEntry[] = Array.isArray(body?.entries)
      ? body.entries
      : [];

    if (entries.length === 0) {
      return NextResponse.json({ success: true, added: 0, days: [] });
    }

    // Group incoming entries by their date so each day's index is written once.
    const byDate = new Map<string, CatalogEntry[]>();
    for (const entry of entries) {
      if (!entry?.url || !entry?.date) continue;
      const bucket = byDate.get(entry.date);
      if (bucket) bucket.push(entry);
      else byDate.set(entry.date, [entry]);
    }

    let added = 0;
    const days: string[] = [];
    for (const [date, dayEntries] of byDate) {
      // readDayIndex returns [] for a missing day and throws on a corrupted
      // (non-array) index — so a read failure aborts before any overwrite.
      const current = await readDayIndex(date);

      const merged = new Map<string, CatalogEntry>(
        current.map((e) => [e.url, e]),
      );
      for (const entry of dayEntries) merged.set(entry.url, entry);

      await writeDayIndex(date, Array.from(merged.values()));
      added += dayEntries.length;
      days.push(date);
    }

    return NextResponse.json({ success: true, added, days });
  } catch (error) {
    const err = error as Error;
    console.error("Error in POST /api/index:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
