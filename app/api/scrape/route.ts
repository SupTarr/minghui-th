import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { readFile } from "@/lib/gdrive";
import { isAuthorized } from "@/lib/auth";

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

export async function GET() {
  try {
    let indexData = [];
    try {
      const driveIndex = await readFile("index.json");
      if (driveIndex && Array.isArray(driveIndex)) {
        indexData = driveIndex;
      }
    } catch (e) {
      console.warn("Could not read index.json in GET handler:", e);
    }
    return NextResponse.json({ articles: indexData });
  } catch (error) {
    const err = error as Error;
    console.error("Error in GET /api/scrape:", err);
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
    // 1. Fetch category cultivation insights
    const targetUrl = "https://en.minghui.org/cc/26/";
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

    const articles: Array<{ url: string; title_en: string; date: string }> = [];

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

      // Date parsing
      let date = parseDateFromUrl(href);
      if (!date) {
        const dateText = a.find(".category-article-date").text().trim();
        date = parseDateText(dateText);
      }

      if (title_en && url) {
        articles.push({ url, title_en, date });
      }
    });

    // 2. Load index.json from Drive to filter out already-fetched articles
    let indexData = [];
    try {
      const driveIndex = await readFile("index.json");
      if (driveIndex && Array.isArray(driveIndex)) {
        indexData = driveIndex;
      }
    } catch (e) {
      console.warn(
        "Could not read index.json from Drive, starting with fresh array:",
        e,
      );
    }

    const existingUrls = new Set(
      indexData.map((item: { url: string }) => item.url),
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
