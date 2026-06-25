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

function parseDateText(dateStr: string): string | null {
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
  // Return null rather than echoing the raw text back: an unparseable date must
  // never become a Drive folder name.
  return null;
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
      subcategory?: string;
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
      // This listing only covers the Cultivation section (/cc/24/), so the
      // top-level category is "Cultivation" and the listed label is the leaf.
      // These are provisional — /api/translate re-derives both from the
      // article's own breadcrumb (the authoritative source); they're the
      // pre-translate card preview and the fallback if that parse comes up empty.
      const metaText = a.find(".category-article-date").text().trim();
      const pipeIdx = metaText.indexOf("|");
      const dateText = pipeIdx === -1 ? metaText : metaText.slice(0, pipeIdx);
      const subcategory =
        pipeIdx === -1 ? undefined : metaText.slice(pipeIdx + 1).trim();

      // Prefer the date embedded in the URL; fall back to the listed date text.
      let date = parseDateFromUrl(href);
      if (!date) {
        date = parseDateText(dateText.trim());
      }

      // An article we can't date can't be stored or deduped correctly. Skip it,
      // but log each skip — a silently dropped article is the same data-loss sin
      // as the budget-skip path.
      if (!date) {
        console.warn(
          `Skipping article with unparseable date: url=${url}, dateText="${dateText.trim()}"`,
        );
        return;
      }

      if (title_en && url) {
        articles.push({
          url,
          title_en,
          date,
          category: "Cultivation",
          subcategory,
        });
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
          // readDayIndex returns [] for a missing index and only throws when the
          // file exists but is corrupt (non-array). So reaching here means this
          // day's index is corrupt: dedup can't see it, so every article for the
          // day looks new and gets re-translated each run until it's repaired.
          // Log loudly (error, not warn) so the corruption is actionable.
          console.error(
            `CORRUPT day index for ${date} — dedup skipped; this day's ` +
              `articles will be re-translated every run until the index is fixed:`,
            e,
          );
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
