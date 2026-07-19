import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  listDateFolders,
  listDayFiles,
  readJsonById,
  writeJsonById,
  writeFailuresIndex,
  ARCHIVE_LIST_TAG,
  type Article,
} from "@/lib/gdrive";
import {
  validateArticle,
  toStoredRecord,
  isStoredValidation,
  CONFIG_VERSION,
  type StoredValidation,
} from "@/lib/contentValidation";
import { authorize } from "@/lib/auth";
import { isValidArticleDate } from "@/lib/apiValidation";

export const dynamic = "force-dynamic";

// A worst-case day is dozens of Drive reads plus a write per changed article;
// same fluid-compute ceiling the cron uses.
export const maxDuration = 300;

// Admin web replacement for `scripts/backfill-validation.mts`: re-runs the
// deterministic validator over the archive without leaving the dashboard.
//
//   GET                          → { dates } — every date folder in the archive
//   POST { date, force? }        → re-validate that one day; writes the slim
//                                  validation record into each per-article JSON
//                                  and mirrors status/failures onto the day
//                                  index; returns the day's summary + its
//                                  currently-FAILED entries
//   POST { rebuild, failures }   → authoritatively overwrite needs-review.json
//                                  from the accumulated failures
//
// The client (app/page.tsx handleRevalidate) drives the loop day-by-day so a
// full-archive pass is cancellable and never runs into the per-invocation cap.
// Like the CLI it replaces, a run is idempotent and version-gated: an article
// already validated at CONFIG_VERSION is skipped unless force is set. Unlike
// the CLI, a skipped article STILL mirrors its stored record onto the index
// entry — index-vs-article drift is exactly what a repair run is for. The
// completeness check's source refetch (CLI --refetch) is deliberately not
// offered here; it's a rare calibration tool, not a repair step.

const CONCURRENCY = 4;

// The full per-article record; only the validated fields are typed.
interface StoredArticle {
  title_en?: string;
  content_en?: string;
  title_th?: string;
  content_th?: string;
  validation?: StoredValidation;
  [k: string]: unknown;
}

interface DaySummary {
  date: string;
  scanned: number;
  pass: number;
  failed: number;
  skipped: number;
  changed: number;
  /** Entries currently FAILED in this day's index (input to the final rebuild). */
  failures: Article[];
}

async function revalidateDay(date: string, force: boolean): Promise<DaySummary> {
  const summary: DaySummary = {
    date,
    scanned: 0,
    pass: 0,
    failed: 0,
    skipped: 0,
    changed: 0,
    failures: [],
  };

  const byName = await listDayFiles(date);
  const indexId = byName?.get("index.json");
  if (!byName || !indexId) return summary; // folder or index missing — nothing to repair

  const data = await readJsonById(indexId);
  if (!Array.isArray(data)) {
    throw new Error(`${date}/index.json exists but is not a JSON array`);
  }
  const entries = data as Article[];

  const mirror = (entry: Article, stored: StoredValidation) => {
    if (
      entry.status !== stored.status ||
      JSON.stringify(entry.failures ?? null) !== JSON.stringify(stored.failures)
    ) {
      entry.status = stored.status;
      entry.failures = stored.failures;
      summary.changed++;
    }
  };

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    await Promise.all(
      entries.slice(i, i + CONCURRENCY).map(async (entry) => {
        const fileName = (entry.filePath || "").split("/").pop() || "";
        const articleId = fileName ? byName.get(fileName) : undefined;
        if (!articleId) return; // missing article file — leave the entry as-is

        let art: StoredArticle;
        try {
          const raw = await readJsonById(articleId);
          if (!raw || typeof raw !== "object") return;
          art = raw as StoredArticle;
        } catch (e) {
          console.warn(`${date}/${fileName}: ${(e as Error).message}`);
          return;
        }

        summary.scanned++;

        if (
          !force &&
          isStoredValidation(art.validation) &&
          art.validation.configVersion === CONFIG_VERSION
        ) {
          summary.skipped++;
          if (art.validation.status === "FAILED") summary.failed++;
          else summary.pass++;
          mirror(entry, art.validation);
          return;
        }

        const stored = toStoredRecord(
          validateArticle(
            {
              title_en: art.title_en ?? "",
              content_en: art.content_en ?? "",
              title_th: art.title_th ?? "",
              content_th: art.content_th ?? "",
            },
            new Date().toISOString(),
          ),
        );
        if (stored.status === "FAILED") summary.failed++;
        else summary.pass++;
        mirror(entry, stored);

        art.validation = stored;
        try {
          await writeJsonById(articleId, art);
        } catch (e) {
          console.warn(
            `${date}/${fileName}: failed writing validation (${(e as Error).message})`,
          );
        }
      }),
    );
  }

  if (summary.changed > 0) await writeJsonById(indexId, entries);

  summary.failures = entries.filter((e) => e.url && e.status === "FAILED");
  return summary;
}

export async function GET(req: Request) {
  try {
    const auth = await authorize(req);
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized", reason: auth.reason },
        { status: auth.status },
      );
    }

    const dates = await listDateFolders();
    return NextResponse.json({ dates, configVersion: CONFIG_VERSION });
  } catch (error) {
    const err = error as Error;
    console.error("Error in GET /api/revalidate:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}

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

    if (body?.rebuild === true) {
      // Overwrite (not merge) — the caller just scanned the whole archive, so
      // its accumulated list IS the authoritative failure set. Filtered to
      // FAILED entries with a url so a buggy caller can't stuff junk in.
      const failures = Array.isArray(body.failures)
        ? (body.failures as Article[]).filter(
            (e) => e?.url && e?.status === "FAILED",
          )
        : [];
      await writeFailuresIndex(failures);
      revalidateTag(ARCHIVE_LIST_TAG, { expire: 0 });
      return NextResponse.json({ success: true, count: failures.length });
    }

    if (!isValidArticleDate(body?.date)) {
      return NextResponse.json(
        { error: "Invalid or missing date (expected YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    const summary = await revalidateDay(body.date, body?.force === true);
    // Status flips landed in this day's index — expire the cached archive list
    // (shared with the needs-review view) so the next load reflects them.
    if (summary.changed > 0) revalidateTag(ARCHIVE_LIST_TAG, { expire: 0 });
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    const err = error as Error;
    console.error("Error in POST /api/revalidate:", err);
    // Admin-only route (mirrors /api/index): the real message is fine to echo.
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
