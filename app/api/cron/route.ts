import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { POST as scrapePOST } from "@/app/api/scrape/route";
import { POST as translatePOST } from "@/app/api/translate/route";
import { POST as savePOST } from "@/app/api/save/route";
import { POST as indexPOST } from "@/app/api/index/route";

export const dynamic = "force-dynamic";

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
      const translateReq = new Request(`${origin}/api/translate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ url: article.url }),
      });
      const translateRes = await translatePOST(translateReq);

      if (!translateRes.ok) {
        console.error(`Translation failed for: ${article.url}`);
        continue;
      }

      const translation = await translateRes.json();

      // Call Save API
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
        continue;
      }

      const saveResult = await saveRes.json();
      processed.push({
        url: article.url,
        filePath: saveResult.filePath,
      });

      if (saveResult.entry) {
        try {
          const indexReq = new Request(`${origin}/api/index`, {
            method: "POST",
            headers,
            body: JSON.stringify({ entries: [saveResult.entry] }),
          });
          const indexRes = await indexPOST(indexReq);
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
