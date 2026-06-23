import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function runPipeline(origin: string, incomingHeaders: Headers) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const authHeader = incomingHeaders.get("Authorization");
  const googleToken = incomingHeaders.get("X-Google-ID-Token");
  if (authHeader) headers["Authorization"] = authHeader;
  if (googleToken) headers["X-Google-ID-Token"] = googleToken;

  // 1. Trigger the scraper endpoint to find new articles
  const scrapeRes = await fetch(`${origin}/api/scrape`, {
    method: "POST",
    headers,
  });

  if (!scrapeRes.ok) {
    throw new Error(`Scrape API failed with status ${scrapeRes.status}`);
  }

  const scrapeData = await scrapeRes.json();
  const articles = scrapeData.articles || [];
  const processed: Array<{ url: string; filePath: string }> = [];

  console.log(
    `Cron pipeline found ${articles.length} new articles to process.`,
  );

  // 2. Loop through each article and perform translate -> save
  for (const article of articles) {
    try {
      console.log(`Processing article: ${article.title_en}`);

      // Call Translate API
      const translateRes = await fetch(`${origin}/api/translate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ url: article.url }),
      });

      if (!translateRes.ok) {
        console.error(`Translation failed for: ${article.url}`);
        continue;
      }

      const translation = await translateRes.json();

      // Call Save API
      const saveRes = await fetch(`${origin}/api/save`, {
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

      if (!saveRes.ok) {
        console.error(`Save API failed for: ${article.url}`);
        continue;
      }

      const saveResult = await saveRes.json();
      processed.push({
        url: article.url,
        filePath: saveResult.filePath,
      });

      // Write this article's entry to its per-day index.json right after it's
      // saved (never before — the index points at the saved file). Writing per
      // article instead of one batch at the end means a crash mid-run leaves
      // every already-translated article indexed, so dedup skips it next run.
      // A failed index write only costs a re-translation next run (the dedup
      // self-heals), so isolate the error and keep going.
      if (saveResult.entry) {
        try {
          const indexRes = await fetch(`${origin}/api/index`, {
            method: "POST",
            headers,
            body: JSON.stringify({ entries: [saveResult.entry] }),
          });
          if (!indexRes.ok) {
            console.error(
              `Index update failed for ${article.url}: status ${indexRes.status}`,
            );
          }
        } catch (indexError) {
          console.error(`Index update threw for ${article.url}:`, indexError);
        }
      }

      // Rate limit Gemini calls: add 1s delay between articles to avoid quota errors
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (articleError) {
      console.error(`Error processing article ${article.url}:`, articleError);
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
