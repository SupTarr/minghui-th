import * as cheerio from "cheerio";

export interface ParsedArticle {
  /** English article title (empty string if not found). */
  title_en: string;
  /** English body, paragraphs joined by blank lines with markdown markers. */
  content_en: string;
}

/**
 * Extract the English title and body text from a Minghui article page.
 *
 * The body is emitted as markdown: headings become `#`/`##`/..., list items
 * become `- `, quotes/poems become `> ` blockquotes, and code becomes fenced
 * blocks. Returns empty strings when nothing matches — callers decide whether
 * that is an error.
 */
export function parseArticleHtml(html: string): ParsedArticle {
  const $ = cheerio.load(html);

  const title_en = $(".article-title").text().trim();

  const contentElements: string[] = [];
  $(".article-body-content")
    .find("p, h1, h2, h3, h4, h5, h6, blockquote, li, td, th, pre, code")
    .each((_, el) => {
      const element = $(el);
      // `splitted` is overloaded on Minghui: it tags the trailing metadata
      // block (p.splitted), image captions (p.splitted.image-container), AND
      // poem/quote blocks (p.splitted.quote). Only the first two are noise —
      // quotes are real article content (e.g. Master Li's Hong Yin poems), so
      // skip a splitted element only when it is NOT a quote.
      const splittedRoot = element.closest(".splitted");
      const isSplitted = splittedRoot.length > 0;
      const isSplittedQuote = isSplitted && splittedRoot.hasClass("quote");
      if (
        (isSplitted && !isSplittedQuote) ||
        element.hasClass("copyright-notice") ||
        element.closest(".copyright-notice").length > 0
      ) {
        return;
      }

      // Avoid duplicating text by checking if an ancestor element is also in
      // our matched set.
      const parentSelected = element
        .parent()
        .closest(
          "p, h1, h2, h3, h4, h5, h6, blockquote, li, td, th, pre, code",
        );
      if (parentSelected.length > 0) {
        return;
      }

      // Poem/quote lines live in <span class="section"> — one span per line.
      // cheerio's .text() concatenates them with no separator, mashing the
      // lines together ("...sought,In death..."), so rebuild the line breaks
      // from the spans when present.
      const sections = element.find("span.section");
      let text =
        sections.length > 0
          ? sections
              .map((_, s) => $(s).text().trim())
              .get()
              .filter(Boolean)
              .join("\n")
          : element.text().trim();
      if (!text) return;

      const tagName = el.tagName.toLowerCase();
      const isQuote =
        tagName === "blockquote" ||
        element.hasClass("quote") ||
        element.closest(".quote").length > 0;

      // Convert elements to standard markdown indicators for formatting
      if (tagName === "h1") {
        text = `# ${text}`;
      } else if (tagName === "h2") {
        text = `## ${text}`;
      } else if (tagName === "h3") {
        text = `### ${text}`;
      } else if (tagName.startsWith("h")) {
        text = `#### ${text}`;
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

      contentElements.push(text);
    });

  return { title_en, content_en: contentElements.join("\n\n") };
}
