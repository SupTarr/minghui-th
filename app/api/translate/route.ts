import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { authorize } from "@/lib/auth";
import {
  parseArticleHtml,
  parseBreadcrumb,
  sourceBodyTextLength,
} from "@/lib/parseArticle";
import { validateArticle } from "@/lib/contentValidation";
import {
  ALLOWED_ARTICLE_HOST,
  isAllowedArticleUrl,
  isMinghuiSiteUrl,
  parseTranslationResponse,
} from "@/lib/apiValidation";

export async function POST(req: Request) {
  try {
    const auth = await authorize(req);
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized", reason: auth.reason },
        { status: auth.status },
      );
    }

    const body = await req.json().catch(() => null);
    const url = body?.url;

    // SSRF guard: only ever fetch an https://en.minghui.org article. Without this
    // the server would fetch any pasted URL (e.g. http://169.254.169.254/… or an
    // internal service). The client-side shape check is UX only, not a boundary.
    if (!isAllowedArticleUrl(url)) {
      return NextResponse.json(
        {
          error: `Article URL must be an https://${ALLOWED_ARTICLE_HOST} link`,
        },
        { status: 400 },
      );
    }

    // 1. Fetch the individual article HTML
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      // Bound a hung upstream so one slow fetch can't pin the serverless invocation.
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch article page: status ${response.status}`,
      );
    }

    // SSRF defense-in-depth: the host is validated pre-fetch, but fetch follows
    // redirects, so confirm the FINAL URL stayed on the minghui.org site. A same-
    // site canonicalization (http→https, or en.→www.) still passes; an off-site
    // hop (to an internal/cloud-metadata host or another domain) is rejected.
    if (!isMinghuiSiteUrl(response.url)) {
      throw new Error(
        `Article URL redirected off minghui.org: ${response.url}`,
      );
    }

    const html = await response.text();

    // 2. Extract English title & content paragraphs
    const { title_en, content_en } = parseArticleHtml(html);
    // The article's own breadcrumb is the authoritative source for its category
    // hierarchy (it covers manual imports from any section, not just the scraped
    // /cc/24/ listing). Both fields may be undefined on a breadcrumb-less page.
    const { category, subcategory } = parseBreadcrumb(html);
    if (!title_en) {
      throw new Error("Could not find article title on the page.");
    }
    if (!content_en) {
      throw new Error(
        "Could not extract any content paragraphs from the article.",
      );
    }

    // 3. Initialize Gemini client
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not defined.");
    }

    const ai = new GoogleGenAI({ apiKey });
    // Use gemini-2.5-flash as the standard robust and fast model.
    const generationConfig = {
      responseMimeType: "application/json",
      // responseMimeType alone guarantees valid JSON but NOT its shape: on long
      // articles the model segments the body and emits one `content_th` key per
      // markdown block. Duplicate keys are valid JSON, so JSON.parse keeps only
      // the last — the whole body collapses to the final paragraph. A schema
      // makes a second `content_th` key structurally impossible.
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title_th: { type: Type.STRING },
          content_th: { type: Type.STRING },
        },
        required: ["title_th", "content_th"],
      },
      // gemini-2.5-flash has "thinking" ON by default; on long articles it can
      // burn that budget thinking and then emit a schema-valid but near-empty body
      // (finishReason STOP after a single paragraph). Disable thinking — this is a
      // mechanical, formatting-bound translation that needs none — so the entire
      // output budget goes to the Thai text. The cap below then guards length.
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 32768,
    };

    const prompt = `Translate the following English article to Thai. 
Return JSON only matching this schema:
{
  "title_th": "Translated Thai Title",
  "content_th": "Translated Thai Content"
}
Keep proper nouns (Falun Dafa, Minghui, etc.) unchanged.
Maintain ALL markdown formatting exactly, translating only the human-readable text:
- Block prefixes — headings (#, ##, ###, ####), bullet points (-), blockquotes (>) — keep the prefix on every line (a multi-line blockquote keeps "> " on each line).
- Inline emphasis — **bold** and *italic* — keep the * / ** markers wrapped around the translated words.
- Links — [text](url) — translate the bracketed text but keep the (url) byte-for-byte unchanged.
- Images — ![caption](url) — keep the leading "!" and the (url) byte-for-byte unchanged; translate only the caption text inside the brackets. An image with empty brackets — ![](url) — must be kept EXACTLY as-is (there is nothing to translate); do not drop it.

CRITICAL — translate the formatting 1:1; never introduce markup that is not already in the English source:
- Do NOT add links. If the English text names a person, organization, or website as plain text (no [text](url) around it), keep it plain text in Thai. Output a [text](url) link ONLY where the exact same link already exists in the source. Never invent, guess, or look up a URL.
- Do NOT add, remove, or reorder images, and never convert an image (![caption](url)) into a link ([text](url)) or vice-versa. Keep every image block in place with its leading "!" and its URL unchanged — including empty-caption images (![](url)), which are the easiest to drop by accident.
- Do NOT change block structure. A paragraph stays a paragraph. Never convert paragraphs into bullet points (-) or blockquotes (>), never merge or split blocks, and never reorder them. The Thai must have the same number, type, and order of blocks (paragraphs, headings, lists, quotes) as the English — line for line.
- Do NOT add emphasis. Never wrap words in ** or * unless the same word is already wrapped in the source (e.g. do not bold proper nouns like **Falun Dafa** if the English has them as plain text). Every * and ** you emit must come from the source, and every marker must stay balanced (each opener has its matching closer).
- When in doubt, prefer fewer markers: emit plain text rather than risk adding formatting the source does not have.

Article title: ${title_en}
Article content: ${content_en}`;

    // Even with thinking off, gemini-2.5-flash still early-STOPs on long articles
    // a good fraction of the time: the output is bimodal — either the full body or
    // a single first paragraph (~90 output tokens, finishReason STOP), never a
    // partial. Measured ~50% truncation PER CALL on a 50-block article, and the
    // failure is independent per call (same article flips between runs), so retries
    // genuinely fix it: re-call whenever the deterministic validator FAILs (or the
    // JSON is unparseable). At ~50%/call, 6 attempts leaves ~1.6% residual failure;
    // a truncated reply returns in well under a second (~90 tokens) and the first
    // success short-circuits, so the loop stays far inside the cron 85s per-article
    // timeout. We keep the last parseable result so a final-attempt parse error
    // can't discard a usable body; only an all-unparseable run falls through to the
    // route's catch (500). Anything still FAILED after the last attempt is persisted
    // and surfaced in the "Needs review" admin tab (publish-all-and-flag).
    const MAX_ATTEMPTS = 6;
    let outcome:
      | {
          title_th: string;
          content_th: string;
          validation: ReturnType<typeof validateArticle>;
        }
      | undefined;
    let lastParseError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let title_th: string;
      let content_th: string;
      let responseText: string | undefined;
      // Parse + shape-check the model reply (handles invalid JSON, a non-object
      // like literal `null`, and missing string fields — see parseTranslationResponse).
      try {
        const result = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: generationConfig,
        });
        responseText = result.text;
        if (!responseText) {
          throw new Error("Gemini API returned an empty translation response.");
        }
        ({ title_th, content_th } = parseTranslationResponse(responseText));
      } catch (e) {
        // Log the raw text for debugging, then retry; a stochastic early-STOP or
        // malformed reply rarely repeats.
        lastParseError = e;
        console.error(
          `Gemini translation attempt ${attempt}/${MAX_ATTEMPTS} was unparseable:`,
          responseText ?? "(no response text)",
          e,
        );
        continue;
      }

      // Deterministic completeness/correctness check before the article is saved.
      // Never blocks (publish-all-and-flag): the result is attached and persisted,
      // and FAILED items surface in the "Needs review" admin tab. `html` is still
      // in scope here, so the source-body completeness heuristic can run too.
      const validation = validateArticle(
        {
          title_en,
          content_en,
          title_th,
          content_th,
          sourceTextLength: sourceBodyTextLength(html),
        },
        new Date().toISOString(),
      );

      // Retain the latest parseable result so a later parse failure can't throw
      // away a usable (if FAILED) translation.
      outcome = { title_th, content_th, validation };
      if (validation.status === "PASS") break;
      console.warn(
        `Gemini translation attempt ${attempt}/${MAX_ATTEMPTS} validation FAILED; ` +
          `${attempt < MAX_ATTEMPTS ? "retrying" : "keeping last result and flagging for review"}. ${validation.statusDesc}`,
      );
    }

    if (!outcome) {
      // Every attempt produced unparseable JSON — surface to the route catch (500).
      throw (
        lastParseError ??
        new Error("Gemini translation produced no usable response.")
      );
    }
    const { title_th, content_th, validation } = outcome;

    return NextResponse.json({
      title_en,
      content_en,
      title_th,
      content_th,
      category,
      subcategory,
      validation,
    });
  } catch (error) {
    const err = error as Error;
    console.error("Error in /api/translate:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
