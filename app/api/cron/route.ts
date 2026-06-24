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

// Stop *starting* new chunks once elapsed passes this, so a chunk launched just
// under the line still has room to finish (~70s) before the 300s hard cap —
// the function returns cleanly instead of being killed mid-write. Leftover
// articles are picked up next run (scrape-time dedup self-heals). 26 articles
// finish in ~3 chunks (~210s) so this only bites on abnormally large batches.
const TIME_BUDGET_MS = 220_000;

type Article = { url: string; title_en: string; date: string };
type ArticleResult = { url: string; filePath: string; entry: unknown };

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
      filePath: saveResult.filePath,
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

  console.log(
    `Cron pipeline found ${articles.length} new articles to process.`,
  );

  // 2. Process articles in concurrent chunks: translate+save run in parallel
  // within a chunk, then a single index write commits the chunk's entries.
  const startedAt = Date.now();
  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      console.warn(
        `Time budget hit after ${processed.length} articles; ` +
          `${articles.length - i} left for the next run.`,
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
      chunk.map((article) => processArticle(origin, article, headers)),
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

  return processed;
}

export async function GET(req: Request) {
  try {
    if (!(await isAuthorized(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { origin } = new URL(req.url);
    const processed = await runPipeline(origin, req.headers);

    return NextResponse.json({
      success: true,
      processedCount: processed.length,
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
    const processed = await runPipeline(origin, req.headers);

    return NextResponse.json({
      success: true,
      processedCount: processed.length,
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
