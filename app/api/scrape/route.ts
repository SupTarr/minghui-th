import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { readDayIndex } from "@/lib/gdrive";
import { authorize } from "@/lib/auth";

// Mark route as dynamic to ensure it doesn't get cached at build time
export const dynamic = "force-dynamic";

function parseDateFromUrl(href: string): string | null {
  // Pattern: /html/articles/YYYY/M/D/ID.html
  const match = href.match(
    /\/articles\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/\d+\.html/,
  );
  if (match) {
    const yyyy = match[1];
    const mm = match[2].padStart(2, "0");
    const dd = match[3].padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function parseDateText(dateStr: string): string {
  try {
    const clean = dateStr.replace(/\s+/g, " ").trim();
    const dateObj = new Date(clean);
    if (!isNaN(dateObj.getTime())) {
      const yyyy = dateObj.getFullYear();
      const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
      const dd = String(dateObj.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  } catch (e) {
    console.error("Error parsing date text:", dateStr, e);
  }
  return dateStr;
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
    // 1. Fetch the parent "Cultivation" category (/cc/24/), which aggregates all
    // sub-categories (Cultivation Insights /cc/26/, Improving Oneself /cc/63/,
    // Journeys of Cultivation /cc/64/, ...). Scraping the parent captures every
    // cultivation article; scraping a single sub-category (e.g. /cc/26/) misses
    // the rest.
    const targetUrl = "https://en.minghui.org/cc/24/";
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      next: { revalidate: 0 }, // bypass next fetch cache
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Minghui list: status ${response.status}`,
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const articles: Array<{
      url: string;
      title_en: string;
      date: string;
      category: string;
    }> = [];

    // Select recent articles list elements
    $(".main-category-articles-list li a").each((_, el) => {
      const a = $(el);
      const href = a.attr("href");
      if (!href) return;

      const url = href.startsWith("http")
        ? href
        : `https://en.minghui.org${href}`;

      // The child div that is not .category-article-date contains the English title
      const titleDiv = a.find("div").not(".category-article-date");
      const title_en = titleDiv.text().trim();

      // The .category-article-date div holds "June 23, 2026 | Journeys of
      // Cultivation": left of the pipe is the date, right is the sub-category.
      const metaText = a.find(".category-article-date").text().trim();
      const pipeIdx = metaText.indexOf("|");
      const dateText = pipeIdx === -1 ? metaText : metaText.slice(0, pipeIdx);
      const category = pipeIdx === -1 ? "" : metaText.slice(pipeIdx + 1).trim();

      // Prefer the date embedded in the URL; fall back to the listed date text.
      let date = parseDateFromUrl(href);
      if (!date) {
        date = parseDateText(dateText.trim());
      }

      if (title_en && url) {
        articles.push({ url, title_en, date, category });
      }
    });

    // 2. Dedup against already-fetched articles. Scraped articles are recent and
    // date-partitioned, so we only read the per-day indexes for the dates present
    // in this batch (a small, bounded set) instead of a global catalog.
    const dates = [...new Set(articles.map((a) => a.date).filter(Boolean))];
    const existingUrls = new Set<string>();
    await Promise.all(
      dates.map(async (date) => {
        try {
          const dayIndex = await readDayIndex(date);
          for (const entry of dayIndex) existingUrls.add(entry.url);
        } catch (e) {
          console.warn(`Could not read day index for ${date}:`, e);
        }
      }),
    );

    // Filter to only new articles
    const newArticles = articles.filter(
      (article) => !existingUrls.has(article.url),
    );

    return NextResponse.json({ articles: newArticles });
  } catch (error) {
    const err = error as Error;
    console.error("Error in /api/scrape:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
