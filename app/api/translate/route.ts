import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
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
  cleanTitleText,
  cleanTranslationText,
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
    // Translate in PLAIN-TEXT markdown mode — deliberately NO responseMimeType /
    // responseSchema. Root-cause fix for long-article truncation: JSON mode
    // (constrained decoding) lets the model satisfy + close the object early,
    // emitting a schema-valid but truncated body (finishReason STOP after one
    // block). An A/B harness over known-bad articles measured ~50% truncation in
    // JSON mode — and a fixed thinking budget made it WORSE (0/30 full bodies) —
    // versus 60/60 full bodies in plain-text mode (16- and 44-block articles). So
    // we ask Gemini for the Thai markdown directly and read text, not JSON.
    const textConfig = {
      // Thinking off: a mechanical, formatting-bound translation needs none, and
      // the harness confirmed plain-text + thinkingBudget 0 returns full bodies.
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 32768,
    };
    // One plain-text translation call → cleaned text (throws on an empty reply).
    // `clean` defaults to the body cleaner; the title passes cleanTitleText.
    const translate = async (
      prompt: string,
      clean: (raw: string) => string = cleanTranslationText,
    ): Promise<string> => {
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: textConfig,
      });
      return clean(result.text ?? "");
    };

    const formattingRules = `Keep proper nouns (Falun Dafa, Minghui, etc.) unchanged.
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
- When in doubt, prefer fewer markers: emit plain text rather than risk adding formatting the source does not have.`;

    // Title and body are two separate plain-text calls. The title is one short
    // line that never truncates; keeping it out of the body reply means there is
    // no JSON envelope around the body to segment or close early.
    const titlePrompt = `Translate this Falun Dafa article title to Thai. Keep proper nouns (Falun Dafa, Minghui, etc.) unchanged. Return ONLY the translated title on a single line — no quotes, no markdown, no preamble.

Title: ${title_en}`;

    const bodyPrompt = `Translate the following English article body to Thai. Return ONLY the translated Thai markdown body — no JSON, no code fences, no preamble, no sign-off. Output only the translated article text.
${formattingRules}

Article title (context only — do NOT include it in your output): ${title_en}
Article content: ${content_en}`;

    // Title — translate once (it never truncates); a second attempt only rides
    // out a rare transient error. Empty/failed twice → route catch (500).
    let title_th: string | undefined;
    let titleError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        title_th = await translate(titlePrompt, cleanTitleText);
        break;
      } catch (e) {
        titleError = e;
        console.error(
          `Gemini title translation attempt ${attempt}/2 failed:`,
          e,
        );
      }
    }
    if (title_th === undefined) {
      throw (
        titleError ??
        new Error("Gemini title translation produced no usable response.")
      );
    }

    // Body — plain-text mode removes truncation at the root, so this loop is no
    // longer the truncation mitigation it used to be (6× re-rolls of the same
    // failing config). It's now a small backstop: re-call once on a rare transient
    // error or a one-off validator FAIL (e.g. a dropped link), which a fresh
    // sample usually clears. We keep the last result so a final-attempt failure
    // can't discard a usable body; anything still FAILED after the last attempt is
    // persisted and surfaced in the "Needs review" admin tab (publish-all-and-flag).
    const MAX_ATTEMPTS = 2;
    let outcome:
      | {
          content_th: string;
          validation: ReturnType<typeof validateArticle>;
        }
      | undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let content_th: string;
      try {
        content_th = await translate(bodyPrompt);
      } catch (e) {
        // Empty or transient reply — log and retry; rarely repeats.
        lastError = e;
        console.error(
          `Gemini body translation attempt ${attempt}/${MAX_ATTEMPTS} failed:`,
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

      // Retain the latest result so a later transient failure can't throw away a
      // usable (if FAILED) translation.
      outcome = { content_th, validation };
      if (validation.status === "PASS") break;
      console.warn(
        `Gemini translation attempt ${attempt}/${MAX_ATTEMPTS} validation FAILED; ` +
          `${attempt < MAX_ATTEMPTS ? "retrying" : "keeping last result and flagging for review"}. ${validation.statusDesc}`,
      );
    }

    if (!outcome) {
      // Every attempt produced an empty/unusable body — surface to the route catch (500).
      throw (
        lastError ??
        new Error("Gemini translation produced no usable response.")
      );
    }
    const { content_th, validation } = outcome;

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
