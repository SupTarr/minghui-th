// Pure, unit-testable guards/parsers for untrusted inputs at the API boundary.
// Extracted from the route handlers so the security-relevant checks — the SSRF
// host allowlist, stored-field shapes, and Gemini-response parsing — can be
// tested directly (the handlers themselves sit behind auth + network calls).

/** The only host /api/translate may fetch (SSRF guard); /api/scrape hardcodes it too. */
export const ALLOWED_ARTICLE_HOST = "en.minghui.org";

/**
 * True iff `url` is a well-formed https://en.minghui.org URL — the sole host the
 * translate route may fetch. Blocks SSRF to internal / cloud-metadata hosts.
 * Note: this validates the URL only; `fetch` still follows redirects, which is
 * acceptable under this route's owner-only, trusted-source threat model.
 */
export function isAllowedArticleUrl(url: unknown): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" && parsed.hostname === ALLOWED_ARTICLE_HOST
  );
}

/** The registrable minghui.org site — any subdomain — for redirect-target checks. */
const ALLOWED_ARTICLE_SITE = "minghui.org";

/**
 * True iff `url` is an https URL anywhere on the minghui.org site (the exact
 * registrable domain or any subdomain). Looser than {@link isAllowedArticleUrl}
 * by design: it validates the FINAL url after `fetch` follows redirects, so a
 * same-site canonicalization (http→https, or en.→www.) passes while an off-site
 * hop — to an internal/cloud-metadata host or another domain — is rejected.
 */
export function isMinghuiSiteUrl(url: unknown): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    (parsed.hostname === ALLOWED_ARTICLE_SITE ||
      parsed.hostname.endsWith(`.${ALLOWED_ARTICLE_SITE}`))
  );
}

/** Stored-article date must be exactly YYYY-MM-DD — it becomes a Drive folder name. */
export function isValidArticleDate(date: unknown): boolean {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/** Reject non-http(s) urls (e.g. javascript:) before storing / rendering as an href. */
export function isHttpUrl(url: unknown): boolean {
  return typeof url === "string" && /^https?:\/\//.test(url);
}

/**
 * Parse Gemini's translation reply into its two required string fields.
 * responseMimeType guarantees valid JSON but not the shape (there's no
 * responseSchema), and JSON.parse can return a non-object — the literal `null`,
 * or a string/number, is valid JSON — which would throw a misleading TypeError on
 * destructure. Validate explicitly so a malformed reply fails at its real cause.
 * Throws (caught by the route's try/catch) on any of: invalid JSON, non-object,
 * or missing/non-string title_th/content_th.
 */
export function parseTranslationResponse(responseText: string): {
  title_th: string;
  content_th: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("Gemini API did not return valid JSON translation.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Gemini translation is not a JSON object.");
  }
  const { title_th, content_th } = parsed as {
    title_th?: unknown;
    content_th?: unknown;
  };
  if (typeof title_th !== "string" || typeof content_th !== "string") {
    throw new Error(
      "Gemini translation is missing title_th/content_th string fields.",
    );
  }
  return { title_th, content_th };
}
