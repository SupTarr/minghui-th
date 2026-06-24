import * as cheerio from "cheerio";
import { type AnyNode, isTag, isText } from "domhandler";

export interface ParsedArticle {
  /** English article title (empty string if not found). */
  title_en: string;
  /** English body, paragraphs joined by blank lines with markdown markers. */
  content_en: string;
}

// Block-level elements we emit as standalone content blocks.
const BLOCK_SELECTOR =
  "p, h1, h2, h3, h4, h5, h6, blockquote, li, td, th, pre, code";

// A `p.splitted` block whose text matches this is Minghui's trailing
// "Original article was published on …" footer — metadata, not article content.
const METADATA_RE =
  /\bwas published on\b|\boriginal (chinese )?article\b|^https?:\/\/\S+$/i;

/**
 * Split a string into [leadingWhitespace, core, trailingWhitespace] so inline
 * markers can wrap the core without swallowing the spaces that separate it from
 * neighbouring words (e.g. "<strong>(Minghui.org) </strong>The …" must stay
 * "**(Minghui.org)** The …", not "**(Minghui.org)**The …").
 */
function splitEdges(s: string): [string, string, string] {
  const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return m ? [m[1], m[2], m[3]] : ["", s, ""];
}

/**
 * Serialize an element's inline content to markdown, preserving the formatting
 * the downstream translator is asked to keep: <em>/<i> → *italic*,
 * <strong>/<b> → **bold**, <a href> → [text](url), <br> → newline. Tooltip-only
 * anchors (Minghui's <a title> with no href) and <img> contribute text only.
 * Recurses so nested inline tags (e.g. <em><a>Zhuan Falun</a></em>) work.
 */
function inlineMarkdown($: cheerio.CheerioAPI, el: AnyNode): string {
  let out = "";
  for (const node of $(el).contents().toArray()) {
    if (isText(node)) {
      // Collapse source-formatting whitespace (incl. indentation newlines) to a
      // single space here, the way a browser would, so the only "\n" left in the
      // output is the one an explicit <br> injects below.
      out += node.data.replace(/\s+/g, " ");
    } else if (isTag(node)) {
      const tag = node.tagName.toLowerCase();
      const inner = inlineMarkdown($, node);
      const [lead, core, trail] = splitEdges(inner);
      if (tag === "br") {
        out += "\n";
      } else if (tag === "em" || tag === "i") {
        out += core ? `${lead}*${core}*${trail}` : inner;
      } else if (tag === "strong" || tag === "b") {
        out += core ? `${lead}**${core}**${trail}` : inner;
      } else if (tag === "a") {
        const url = resolveHref($(node).attr("href"));
        out += url && core ? `${lead}[${core}](${url})${trail}` : inner;
      } else if (tag === "img") {
        out += ($(node).attr("alt") ?? "").trim();
      } else {
        out += inner;
      }
    }
  }
  return out;
}

/**
 * Drop inline emphasis/link *markers* (keeping link text) from a string. Used
 * for contexts whose own styling already conveys emphasis — headings (rendered
 * bold) and image captions (rendered italic) — where Minghui additionally wraps
 * the text in <strong>/<em>, which would otherwise stack into unparseable runs
 * like `**…** ***Zhuan Falun***` that render as literal asterisks.
 */
function stripInlineMarkers(s: string): string {
  return s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*+/g, "");
}

/** Absolute http(s) URL for a link, or null for tooltip/anchor/scheme-only hrefs. */
function resolveHref(href: string | undefined): string | null {
  const h = href?.trim();
  if (!h) return null;
  if (/^https?:\/\//i.test(h)) return h;
  if (h.startsWith("/")) return `https://en.minghui.org${h}`;
  return null; // #fragment, mailto:, javascript:, relative
}

/**
 * Collapse horizontal whitespace runs to single spaces while preserving the
 * explicit newlines injected from <br>; trim spaces around those newlines and
 * cap consecutive blank lines.
 */
function normalizeInline(text: string): string {
  return text
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Text for a single block. Poem/quote lines and image captions live in
 * <span class="section"> — one per line — which a flat .text() would mash
 * together, so each section is serialized and rejoined on its own line.
 */
function blockText($: cheerio.CheerioAPI, el: AnyNode): string {
  const sections = $(el).find("span.section");
  if (sections.length > 0) {
    return sections
      .toArray()
      .map((s) => normalizeInline(inlineMarkdown($, s)))
      .filter(Boolean)
      .join("\n");
  }
  return normalizeInline(inlineMarkdown($, el));
}

/**
 * Extract the English title and body text from a Minghui article page.
 *
 * The body is emitted as markdown: headings become `#`/`##`/..., list items
 * become `- `, quotes/poems and image captions become `> `/`*…*`, inline
 * emphasis and links are preserved, and code becomes fenced blocks. Returns
 * empty strings when nothing matches — callers decide whether that is an error.
 */
export function parseArticleHtml(html: string): ParsedArticle {
  const $ = cheerio.load(html);

  // Standard articles carry the title in .article-title; Master Li's "jingwen"
  // scripture pages use <h1 class="cBBlue"> with no .article-title.
  let title_en = $(".article-title").text().trim();
  if (!title_en) title_en = $("h1.cBBlue").first().text().trim();

  // Standard body lives in .article-body-content; jingwen pages use .jingwenNei.
  let body = $(".article-body-content");
  if (body.length === 0) body = $(".jingwenNei");

  const contentElements: string[] = [];
  body.find(BLOCK_SELECTOR).each((_, el) => {
    const element = $(el);

    if (
      element.hasClass("copyright-notice") ||
      element.closest(".copyright-notice").length > 0
    ) {
      return;
    }

    // `splitted` is overloaded on Minghui. It tags: the trailing "published on"
    // metadata footer; image captions (.image-container); poem/quote blocks
    // (.quote); AND — crucially — some ordinary prose paragraphs. Only the
    // metadata footer is true noise, so a splitted block is dropped solely when
    // it is neither a caption nor a quote AND matches the metadata pattern.
    // (A blanket "splitted && !quote" skip silently ate real body paragraphs.)
    const splittedRoot = element.closest(".splitted");
    const isSplitted = splittedRoot.length > 0;
    const isCaption = isSplitted && splittedRoot.hasClass("image-container");
    const isSplittedQuote = isSplitted && splittedRoot.hasClass("quote");
    if (isSplitted && !isCaption && !isSplittedQuote) {
      // The metadata footer is a single short line; real body paragraphs that
      // happen to contain the phrase run far longer, so length-gate the match
      // to avoid eating a genuine paragraph.
      const splittedText = splittedRoot.text().replace(/\s+/g, " ").trim();
      if (splittedText.length < 200 && METADATA_RE.test(splittedText)) return;
    }

    // Avoid duplicating text when a matched ancestor already covers this node.
    if (element.parent().closest(BLOCK_SELECTOR).length > 0) return;

    let text = blockText($, el);
    if (!text) return;

    const tagName = el.tagName.toLowerCase();
    const isQuote =
      tagName === "blockquote" ||
      element.hasClass("quote") ||
      element.closest(".quote").length > 0;

    // Convert elements to standard markdown indicators for formatting. Headings
    // are styled bold by the renderer, so strip the redundant inline emphasis
    // Minghui wraps them in (otherwise `### **…** ***title***` leaks asterisks).
    if (tagName === "h1") {
      text = `# ${stripInlineMarkers(text)}`;
    } else if (tagName === "h2") {
      text = `## ${stripInlineMarkers(text)}`;
    } else if (tagName === "h3") {
      text = `### ${stripInlineMarkers(text)}`;
    } else if (tagName.startsWith("h")) {
      text = `#### ${stripInlineMarkers(text)}`;
    } else if (isQuote) {
      // Prefix every line so a multi-line poem stays one blockquote.
      text = text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    } else if (isCaption) {
      // The image can't survive into a text translation; keep its caption as
      // italic context. The whole line is already italic, so strip any inner
      // emphasis (an inner *title* would collide into malformed `*… *title**`);
      // wrap once per line.
      text = text
        .split("\n")
        .map((line) => stripInlineMarkers(line).trim())
        .filter(Boolean)
        .map((line) => `*${line}*`)
        .join("\n");
    } else if (tagName === "li") {
      text = `- ${text}`;
    } else if (tagName === "pre" || tagName === "code") {
      text = `\`\`\`\n${text}\n\`\`\``;
    }

    contentElements.push(text);
  });

  return { title_en, content_en: contentElements.join("\n\n") };
}
