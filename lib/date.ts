// Shared date helpers used on both the client (dashboard) and the server (API
// routes). Pure and dependency-free, so this module is safe to import from either
// side — previously these were re-implemented in app/page.tsx, app/api/scrape and
// app/api/articles, which drifted apart (only one carried a today fallback).

/** Format a Date as YYYY-MM-DD in local time (the shape used for Drive folders). */
export function toYMD(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Derive the YYYY-MM-DD date embedded in a Minghui article URL
 * (e.g. .../articles/2026/6/26/234818.html → 2026-06-26). Returns null when the
 * path carries no date, so each caller picks its own fallback (the scraper skips
 * the article; the dashboard import falls back to today).
 */
export function parseArticleDateFromUrl(url: string): string | null {
  const match = url.match(
    /\/articles\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/\d+\.html/,
  );
  if (!match) return null;
  const [, yyyy, mm, dd] = match;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

/**
 * Parse a free-text date (e.g. "June 23, 2026") to YYYY-MM-DD, or null when it
 * can't be parsed — an unparseable date must never become a Drive folder name.
 */
export function parseDateText(dateStr: string): string | null {
  try {
    const dateObj = new Date(dateStr.replace(/\s+/g, " ").trim());
    if (!isNaN(dateObj.getTime())) return toYMD(dateObj);
  } catch (e) {
    console.error("Error parsing date text:", dateStr, e);
  }
  return null;
}
