import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { POST as scrapePOST } from "@/app/api/scrape/route";
import { POST as translatePOST } from "@/app/api/translate/route";
import { POST as savePOST } from "@/app/api/save/route";
import { POST as indexPOST } from "@/app/api/index/route";

export const dynamic = "force-dynamic";

// Hobby + fluid compute caps a single invocation at 300s. Translation is
// network-bound (one Gemini call per article, ~30-40s), so we fan a chunk of
// articles out concurrently to fit a full daily batch inside that window
// instead of running them one-by-one (~15 min for ~26 articles).
export const maxDuration = 300;

// How many articles to translate+save in parallel. A chunk's wall time is set
// by its slowest article (~60-70s — Gemini latency dominates), so 26 articles
// at this width is ~3 chunks ≈ 210s, comfortably inside maxDuration. Gemini
// paid tier 1 allows ~1000 RPM, so 10 concurrent is well under quota.
const CONCURRENCY = 10;

// Stop *starting* new chunks once elapsed passes this. A chunk launched just
// under the line can still run one worst-case ARTICLE_TIMEOUT_MS article plus
// its index write, so this MUST stay below
// maxDuration - ARTICLE_TIMEOUT_MS - (index-write margin) for the function to
// return cleanly instead of being killed mid-write: 190 + 85 + ~15 ≈ 290s < 300.
// Leftover articles are picked up next run (scrape-time dedup self-heals); 26
// articles finish in ~3 chunks so this only bites on abnormally large batches.
const TIME_BUDGET_MS = 190_000;

// Cap a single article's translate+save. The between-chunk budget guard can't
// interrupt an in-flight chunk, and the in-process Gemini call is passed no
// AbortSignal, so without this one hung call could pin its whole chunk and push
// past maxDuration. On timeout the article is dropped to null (re-translated
// next run via dedup), bounding each chunk's wall time. Kept below
// maxDuration - TIME_BUDGET_MS so a chunk started near the budget edge still
// finishes (with its index write) before the 300s cap.
const ARTICLE_TIMEOUT_MS = 85_000;

type Article = {
  url: string;
  title_en: string;
  date: string;
  category: string;
  subcategory?: string;
};
type ArticleResult = { url: string; filePath: string; entry: unknown };

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms}ms: ${label}`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// Translate + save a single article. Returns its catalog entry on success, or
// null on any failure (logged) so one bad article never aborts its chunk.
async function processArticle(
  origin: string,
  article: Article,
  headers: Headers,
): Promise<ArticleResult | null> {
  try {
    const translateReq = new Request(`${origin}/api/translate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: article.url }),
    });
    const translateRes = await translatePOST(translateReq);
    if (!translateRes.ok) {
      console.error(`Translation failed for: ${article.url}`);
      return null;
    }
    const translation = await translateRes.json();

    const saveReq = new Request(`${origin}/api/save`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: article.url,
        title_en: translation.title_en,
        title_th: translation.title_th,
        content_en: translation.content_en,
        content_th: translation.content_th,
        date: article.date,
        // Prefer the breadcrumb-derived hierarchy from /api/translate; fall back
        // to the scraped listing values so a breadcrumb-less page keeps the
        // sub-category the listing already had instead of being mislabeled.
        category: translation.category || article.category,
        subcategory: translation.subcategory || article.subcategory,
        // Carry the validation result through so /api/save persists it and flags
        // the catalog entry (publish-all-and-flag; never blocks the save).
        validation: translation.validation,
      }),
    });
    const saveRes = await savePOST(saveReq);
    if (!saveRes.ok) {
      console.error(`Save API failed for: ${article.url}`);
      return null;
    }

    const saveResult = await saveRes.json();
    return {
      url: article.url,
      filePath: saveResult.entry?.filePath,
      entry: saveResult.entry,
    };
  } catch (articleError) {
    console.error(`Error processing article ${article.url}:`, articleError);
    return null;
  }
}

async function runPipeline(origin: string, incomingHeaders: Headers) {
  const headers = new Headers(incomingHeaders);
  headers.set("Content-Type", "application/json");

  // Start the budget clock BEFORE the scrape so its network + Drive-list round
  // trips count against the window, leaving real headroom before the 300s cap.
  const startedAt = Date.now();

  // 1. Trigger the scraper endpoint to find new articles
  const scrapeReq = new Request(`${origin}/api/scrape`, {
    method: "POST",
    headers,
  });
  const scrapeRes = await scrapePOST(scrapeReq);

  if (!scrapeRes.ok) {
    throw new Error(`Scrape API failed with status ${scrapeRes.status}`);
  }

  const scrapeData = await scrapeRes.json();
  const articles: Article[] = scrapeData.articles || [];
  const processed: Array<{ url: string; filePath: string }> = [];
  let skipped = 0;

  console.log(
    `Cron pipeline found ${articles.length} new articles to process.`,
  );

  // 2. Process articles in concurrent chunks: translate+save run in parallel
  // within a chunk, then a single index write commits the chunk's entries.
  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      skipped = articles.length - i;
      // NOTE: leftovers only self-heal on the NEXT run while they're still on
      // the single scraped listing page. A large backlog (e.g. after an outage)
      // can scroll off page 1 and be lost — the real fix is a durable backlog
      // queue / search-archive pagination. Log loudly so it's visible meanwhile.
      console.error(
        `Time budget hit after ${processed.length} articles; ${skipped} ` +
          `left for the next run (at risk if they scroll off the listing page).`,
      );
      break;
    }

    const chunk = articles.slice(i, i + CONCURRENCY);
    console.log(
      `Processing chunk ${i / CONCURRENCY + 1}: ${chunk
        .map((a) => a.title_en)
        .join(" | ")}`,
    );

    const results = await Promise.all(
      chunk.map((article) =>
        withTimeout(
          processArticle(origin, article, headers),
          ARTICLE_TIMEOUT_MS,
          article.url,
        ).catch((err) => {
          console.error(`Article failed/timed out: ${article.url}`, err);
          return null;
        }),
      ),
    );
    const done = results.filter((r): r is ArticleResult => r !== null);

    // Commit this chunk's entries to their per-day index.json in ONE call.
    // Indexing per chunk (not per article) keeps index writes serialized across
    // chunks — concurrent read-modify-write to the same day's index would lose
    // entries. /api/index groups by date and merges, so multiple same-day
    // entries in one call are safe. Writing per chunk instead of once at the end
    // means a crash mid-run still leaves finished chunks indexed, so dedup skips
    // them next run. A failed index write only costs a re-translation next run
    // (dedup self-heals), so isolate the error and keep going.
    const entries = done
      .map((d) => d.entry)
      .filter((e) => e !== undefined && e !== null);
    if (entries.length > 0) {
      try {
        const indexReq = new Request(`${origin}/api/index`, {
          method: "POST",
          headers,
          body: JSON.stringify({ entries }),
        });
        const indexRes = await indexPOST(indexReq);
        if (!indexRes.ok) {
          console.error(`Index update failed: status ${indexRes.status}`);
        }
      } catch (indexError) {
        console.error("Index update threw:", indexError);
      }
    }

    for (const d of done) {
      processed.push({ url: d.url, filePath: d.filePath });
    }
  }

  return { processed, skipped };
}

export async function GET(req: Request) {
  try {
    if (!(await isAuthorized(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { origin } = new URL(req.url);
    const { processed, skipped } = await runPipeline(origin, req.headers);

    return NextResponse.json({
      success: true,
      processedCount: processed.length,
      skippedCount: skipped,
      processed,
    });
  } catch (error) {
    const err = error as Error;
    console.error("Cron pipeline exception:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    if (!(await isAuthorized(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { origin } = new URL(req.url);
    const { processed, skipped } = await runPipeline(origin, req.headers);

    return NextResponse.json({
      success: true,
      processedCount: processed.length,
      skippedCount: skipped,
      processed,
    });
  } catch (error) {
    const err = error as Error;
    console.error("Cron pipeline exception:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
