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

/**
 * Caption text fit for an image's alt slot in `![alt](url)`: drop inline markers
 * (the caption is styled by the renderer, not re-emphasised) and any character that
 * would break the block shape — `[`, `]`, and newlines — collapsing whitespace.
 */
function sanitizeAlt(s: string): string {
  return stripInlineMarkers(s)
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Wrap an image caption as italic context, one `*…*` per line. Minghui already
 * styles the caption with emphasis, so strip inner markers first (an inner *title*
 * would otherwise collide into a malformed `*… *title**`). Returns "" when nothing
 * survives. Shared by the caption-only and multi-image container paths.
 */
function italicizeCaption(caption: string): string {
  return caption
    .split("\n")
    .map((line) => stripInlineMarkers(line).trim())
    .filter(Boolean)
    .map((line) => `*${line}*`)
    .join("\n");
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
 * If a <p> is wholly a single emphasis wrapper, classify it: "bi" (bold+italic,
 * e.g. <strong><em>…</em></strong> or <em><strong>…</strong></em>), "italic"
 * (a single <em>/<i>), or "bold" (a single <strong>/<b>). Whitespace-only text
 * nodes and a lone <br> are ignored. Returns null when the paragraph mixes
 * emphasis with other content, so "<strong>(Minghui.org)</strong> text",
 * captions, and poems never match.
 */
function wholeParagraphEmphasis(
  $: cheerio.CheerioAPI,
  el: AnyNode,
): "bi" | "italic" | "bold" | null {
  const kids = $(el)
    .contents()
    .toArray()
    .filter(
      (n) =>
        !(isText(n) && !n.data.trim()) &&
        !(isTag(n) && n.tagName.toLowerCase() === "br"),
    );
  if (kids.length !== 1 || !isTag(kids[0])) return null;
  const tag = kids[0].tagName.toLowerCase();
  const inner = $(kids[0])
    .contents()
    .toArray()
    .filter((n) => !(isText(n) && !n.data.trim()));
  const innerIs = (names: string[]) =>
    inner.length === 1 &&
    isTag(inner[0]) &&
    names.includes(inner[0].tagName.toLowerCase());
  if (tag === "strong" || tag === "b")
    return innerIs(["em", "i"]) ? "bi" : "bold";
  if (tag === "em" || tag === "i")
    return innerIs(["strong", "b"]) ? "bi" : "italic";
  return null;
}

/** The block immediately after `el` is a prose <p> (not another emphasis heading). */
function nextBlockIsProse($: cheerio.CheerioAPI, el: AnyNode): boolean {
  const sib = $(el)
    .nextAll("p, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, table, pre")
    .first();
  if (
    sib.length === 0 ||
    !isTag(sib[0]) ||
    sib[0].tagName.toLowerCase() !== "p"
  )
    return false;
  if (wholeParagraphEmphasis($, sib[0])) return false;
  return $(sib).text().trim().length > 0;
}

/**
 * Minghui marks some section subheadings as a whole <p> wrapped entirely in
 * emphasis (e.g. <p class="normal"><strong><em>Title</em></strong></p>) rather
 * than an <hN>; left alone, the parser emits `***Title***`/`*Title*` and the
 * reader shows an emphasised paragraph instead of a heading. Promote those to a
 * markdown heading. Bold+italic is an unambiguous heading signal. Italic-only is
 * weaker (italics also wrap book titles, bylines, editor's notes), so it is
 * promoted only when short, unpunctuated, followed by prose, and not an author
 * byline or editor's note — guards verified against 344 real articles. The level
 * is one below the article's <h3> sections (#### ), or ### when the article has
 * no real heading of its own, so the outline never skips a level. Returns the
 * heading marker, or null when the paragraph is not a promotable heading.
 */
function emphasisHeadingMarker(
  $: cheerio.CheerioAPI,
  el: AnyNode,
  hasH3: boolean,
): string | null {
  const kind = wholeParagraphEmphasis($, el);
  if (!kind || kind === "bold") return null;
  const plain = $(el).text().replace(/\s+/g, " ").trim();
  if (!plain) return null;
  const level = hasH3 ? "####" : "###";
  if (kind === "bi") return level;
  // italic-only: apply the false-positive guards
  if (plain.length > 90) return null;
  if (/[.!?。！？]$/.test(plain)) return null;
  if (/^By\b/i.test(plain)) return null; // author byline ("By a … practitioner …")
  if (/^Editor['’]?s note/i.test(plain)) return null;
  if (!nextBlockIsProse($, el)) return null;
  return level;
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

  // Real headings in Minghui bodies are <h3>; emphasis-paragraph subheadings nest
  // one level below them (so → ####). When an article has no <h3> at all, those
  // paragraphs are its top-level sections (so → ###, no outline level-skip).
  const hasH3 = body.find("h3").length > 0;

  const blocks: { text: string; isQuote: boolean }[] = [];
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
    // An image container holds zero-or-more <img> plus a caption. Detected by its
    // own class (not via `splitted`) so a non-splitted image-container still counts.
    const imageRoot = element.closest(".image-container");
    const isCaption = imageRoot.length > 0;
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

    // Image container: emit each <img> as a standalone markdown image block, plus
    // its caption. Handled before the empty-text guard below because an image-only
    // container has no caption text and would otherwise be dropped there. <img> srcs
    // are relative (/u/article_images/…); resolveHref makes them absolute and nulls
    // out anything unusable (empty/data:/#/relative-without-slash).
    if (isCaption) {
      const caption = blockText($, el); // image <span>s serialize empty → caption only
      const srcs = imageRoot
        .find("img")
        .toArray()
        .map((img) => resolveHref($(img).attr("src")))
        .filter((s): s is string => Boolean(s));
      if (srcs.length === 1) {
        // Single image: the caption becomes its alt → renderer shows a <figcaption>.
        blocks.push({
          text: `![${sanitizeAlt(caption)}](${srcs[0]})`,
          isQuote: false,
        });
      } else {
        // Many images share one caption (alt-less images, then the caption once); or
        // zero usable images (caption-only / unresolvable src) — keep the caption as
        // italic context, exactly as before. The loop is empty when srcs is empty.
        for (const src of srcs) blocks.push({ text: `![](${src})`, isQuote: false });
        const cap = italicizeCaption(caption);
        if (cap) blocks.push({ text: cap, isQuote: false });
      }
      return;
    }

    let text = blockText($, el);
    if (!text) return;

    const tagName = el.tagName.toLowerCase();

    // A symbol-only paragraph (e.g. "* * * * * * *") is a decorative scene break;
    // its bare asterisks would otherwise be mangled by the renderer's emphasis
    // regex, so normalise it to a markdown horizontal rule.
    if (tagName === "p" && /\*/.test(text) && /^[*\s]+$/.test(text)) {
      blocks.push({ text: "---", isQuote: false });
      return;
    }

    const isQuote =
      tagName === "blockquote" ||
      element.hasClass("quote") ||
      element.closest(".quote").length > 0;

    // A whole-paragraph emphasis subheading (<p><strong><em>…</em></strong></p>)
    // is promoted to a real heading rather than left as inline emphasis.
    const emphMarker =
      tagName === "p" ? emphasisHeadingMarker($, el, hasH3) : null;

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
    } else if (emphMarker) {
      text = `${emphMarker} ${stripInlineMarkers(text)}`;
    } else if (isQuote) {
      // Prefix every line so a multi-line poem stays one blockquote.
      text = text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    } else if (tagName === "li") {
      text = `- ${text}`;
    } else if (tagName === "pre" || tagName === "code") {
      text = `\`\`\`\n${text}\n\`\`\``;
    }

    blocks.push({ text, isQuote });
  });

  // Join blocks with a blank line, EXCEPT between two adjacent quote blocks: a
  // single multi-paragraph quotation that Minghui split across sibling
  // <p class="quote"> elements is rejoined into one `> ` blockquote (otherwise
  // the renderer paints each fragment as its own separate quote box).
  let content_en = "";
  blocks.forEach((b, i) => {
    if (i > 0) content_en += b.isQuote && blocks[i - 1].isQuote ? "\n" : "\n\n";
    content_en += b.text;
  });

  return { title_en, content_en };
}

/** Separator joining the levels of a multi-level sub-category path. */
export const CATEGORY_SEPARATOR = " › ";

/** A Minghui article's category hierarchy, read from its breadcrumb. */
export interface ArticleCategory {
  /** Top-level section, e.g. "Cultivation" / "News & Events". Undefined when the page has no breadcrumb. */
  category?: string;
  /**
   * Everything below the top level, as a single path. One level →
   * "Cultivation Insights"; deeper → "World Falun Dafa Day › Dafa Day
   * Perspectives". Undefined when the breadcrumb has only the top level.
   */
  subcategory?: string;
}

/**
 * Read the category hierarchy from a Minghui article's breadcrumb
 * (`Home > <Section> > <Sub> [> <Sub-sub> …]`). The breadcrumb's section links
 * point at `/cc/<id>/` pages; the `Home` link (href "/") is excluded by matching
 * only that shape. The first section link is the top-level `category`; every
 * level below it is joined with {@link CATEGORY_SEPARATOR} into `subcategory`,
 * so a 3+-level path (e.g. News & Events) keeps its full chain instead of
 * skipping the middle. Returns `{}` when the page has no breadcrumb (e.g. some
 * scripture pages) — never throws, so callers fall back to their own default
 * (/api/save → "Cultivation").
 */
export function parseBreadcrumb(html: string): ArticleCategory {
  const $ = cheerio.load(html);
  const links = $(".bread-crumb a")
    .toArray()
    .filter((a) => /^\/cc\/\d+\/?$/.test($(a).attr("href") ?? ""))
    .map((a) => $(a).text().replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (links.length === 0) return {};
  return {
    category: links[0],
    subcategory:
      links.length > 1 ? links.slice(1).join(CATEGORY_SEPARATOR) : undefined,
  };
}

/**
 * Plain-text length (whitespace-stripped) of a source article's body container,
 * for the content validator's completeness heuristic. Mirrors the body selection
 * in parseArticleHtml (.article-body-content, falling back to the jingwen
 * container) and drops the copyright notice the parser also excludes. Returns 0
 * when no recognized body container is present.
 */
export function sourceBodyTextLength(html: string): number {
  const $ = cheerio.load(html);
  let body = $(".article-body-content");
  if (body.length === 0) body = $(".jingwenNei");
  if (body.length === 0) return 0;
  const clone = body.clone();
  clone.find(".copyright-notice").remove();
  return clone.text().replace(/\s+/g, "").length;
}
