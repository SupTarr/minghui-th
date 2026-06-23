import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function runPipeline(origin: string) {
  // 1. Trigger the scraper endpoint to find new articles
  const scrapeRes = await fetch(`${origin}/api/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!scrapeRes.ok) {
    throw new Error(`Scrape API failed with status ${scrapeRes.status}`);
  }

  const scrapeData = await scrapeRes.json();
  const articles = scrapeData.articles || [];
  const processed: Array<{ url: string; filePath: string }> = [];

  console.log(`Cron pipeline found ${articles.length} new articles to process.`);

  // 2. Loop through each article and perform translate -> save
  for (const article of articles) {
    try {
      console.log(`Processing article: ${article.title_en}`);

      // Call Translate API
      const translateRes = await fetch(`${origin}/api/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: article.url }),
      });

      if (!translateRes.ok) {
        console.error(`Translation failed for: ${article.url}`);
        continue;
      }

      const translation = await translateRes.json();

      // Call Save API
      const saveRes = await fetch(`${origin}/api/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
    const { origin } = new URL(req.url);
    const processed = await runPipeline(origin);

    return NextResponse.json({
      success: true,
      processedCount: processed.length,
      processed,
    });
  } catch (error: any) {
    console.error('Cron pipeline exception:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { origin } = new URL(req.url);
    const processed = await runPipeline(origin);

    return NextResponse.json({
      success: true,
      processedCount: processed.length,
      processed,
    });
  } catch (error: any) {
    console.error('Cron pipeline exception:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
