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
 * Clean Gemini's plain-text (markdown) translation reply.
 * The translate route asks for the Thai markdown DIRECTLY — not JSON — because
 * JSON mode's constrained decoding makes the model close the object early and
 * truncate long bodies (finishReason STOP after one block). The model returns the
 * body verbatim, but can occasionally wrap it in a ```markdown … ``` fence or pad
 * it with surrounding whitespace. Strip a single fence ONLY when it brackets the
 * whole reply (so an inner code block is left intact) and trim. Throws (caught by
 * the route's try/catch) on an empty reply.
 */
export function cleanTranslationText(raw: string): string {
  let text = (raw ?? "").trim();
  const wrapped = text.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/);
  if (wrapped) text = wrapped[1].trim();
  if (!text) {
    throw new Error("Gemini API returned an empty translation.");
  }
  return text;
}

/**
 * Clean Gemini's plain-text TITLE reply. A title is a single line, but despite
 * the prompt's "no quotes / no preamble" instruction the model often wraps a
 * title in quotation marks — and nothing downstream would strip them, so the
 * stored title_th could ship as `"ความเมตตา"`. Reuses {@link cleanTranslationText}
 * (trim, unwrap a stray ``` fence, reject empty), collapses any stray newline to
 * a space, then peels surrounding straight/curly quote pairs. Throws on empty.
 */
export function cleanTitleText(raw: string): string {
  let text = cleanTranslationText(raw).replace(/\s+/g, " ").trim();
  const quotePairs: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"], // “ ”
    ["‘", "’"], // ‘ ’
  ];
  for (let peeled = true; peeled;) {
    peeled = false;
    for (const [open, close] of quotePairs) {
      if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
        text = text.slice(open.length, text.length - close.length).trim();
        peeled = true;
      }
    }
  }
  if (!text) {
    throw new Error("Gemini API returned an empty title translation.");
  }
  return text;
}
