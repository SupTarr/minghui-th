import { describe, it, expect } from "vitest";
import { parseArticleHtml } from "./parseArticle";

// Fixture mirroring the real Minghui article DOM, including every `splitted`
// variant the parser must distinguish: metadata, image caption, poem quote, and
// ordinary prose — plus inline emphasis, links, and <br> line breaks.
const FIXTURE = `
<html><body>
  <h1 class="article-title">Sample Cultivation Story</h1>
  <div class="article-body margin-15">
    <div class="article-body-content">
      <p class="normal"><strong>(Minghui.org) </strong>First normal paragraph
        reading <em>Zhuan Falun</em> with a
        <a href="/html/articles/2025/2/3/225308.html">linked report</a> and a
        <a title="tooltip only">tooltip term</a>.</p>
      <p class="normal">Second normal paragraph.</p>

      <!-- <br> line break inside a plain paragraph (must not mash words) -->
      <p class="normal">Line A.<br>Line B.</p>

      <!-- Poem quote that is ALSO splitted — the screenshot case -->
      <p class="splitted quote">
        <span class="section">&ldquo;Pause for a moment of self-reflection,</span>
        <span class="section">and increase your righteous thoughts</span>
        <span class="section">Thoroughly analyze your shortcomings,</span>
        <span class="section">and progress with renewed diligence&rdquo;</span>
        <span class="section">(&ldquo;Rational and Awake,&rdquo; Hong Yin II)</span>
      </p>

      <!-- Plain quote (not splitted) with per-line spans -->
      <p class="quote">
        <span class="section">Line one of plain quote</span>
        <span class="section">Line two of plain quote</span>
      </p>

      <!-- Ordinary prose that happens to be tagged splitted -> MUST be kept -->
      <p class="splitted">
        <span class="section">First line of a real splitted paragraph.</span>
        <span class="section">Second line after a break.</span>
      </p>

      <!-- Image caption: splitted + image-container -> kept as italic context -->
      <p class="splitted image-container">Master's portrait at the conference (Minghui.org)</p>

      <!-- Trailing metadata: splitted + "published on" -> dropped -->
      <p class="splitted">Original article was published on June 29, 2023.</p>

      <!-- Copyright -> dropped -->
      <p class="copyright-notice">Copyright Minghui.org.</p>
    </div>
  </div>
</body></html>
`;

// Master Li's "jingwen" scripture template: no .article-title / .article-body-content.
const JINGWEN = `
<html><body>
  <h1 class="cBBlue timesNR">How Humankind Came To Be</h1>
  <div class="jingwenWrap"><div class="jingwenPaper"><div class="jingwenBody">
    <div class="jingwenNei timesNR">
      <p>The Creator cherishes all of the heavenly beings.</p>
      <p>New Year's would normally be a time for sharing remarks.</p>
    </div>
  </div></div></div>
</body></html>
`;

describe("parseArticleHtml", () => {
  const { title_en, content_en } = parseArticleHtml(FIXTURE);

  it("extracts the title", () => {
    expect(title_en).toBe("Sample Cultivation Story");
  });

  it("keeps normal paragraphs", () => {
    expect(content_en).toContain("First normal paragraph");
    expect(content_en).toContain("Second normal paragraph.");
  });

  it("keeps poems tagged 'splitted quote' (regression: previously dropped)", () => {
    expect(content_en).toContain("Pause for a moment of self-reflection");
    expect(content_en).toContain("Rational and Awake");
  });

  it("preserves poem line breaks as a multi-line blockquote", () => {
    // Each <span class="section"> becomes its own '> ' line — not mashed
    // together as ".text()" would do ("...self-reflection,and increase...").
    expect(content_en).toContain(
      "> “Pause for a moment of self-reflection,\n> and increase your righteous thoughts",
    );
    expect(content_en).not.toContain("self-reflection,and increase");
  });

  it("turns plain 'quote' paragraphs into blockquotes too", () => {
    expect(content_en).toContain(
      "> Line one of plain quote\n> Line two of plain quote",
    );
  });

  it("keeps ordinary 'splitted' prose paragraphs (regression: previously dropped)", () => {
    expect(content_en).toContain("First line of a real splitted paragraph.");
    expect(content_en).toContain("Second line after a break.");
  });

  it("keeps image captions as italic context", () => {
    expect(content_en).toContain(
      "*Master's portrait at the conference (Minghui.org)*",
    );
  });

  it("drops trailing metadata and copyright", () => {
    expect(content_en).not.toContain("Original article was published");
    expect(content_en).not.toContain("Copyright Minghui.org");
  });

  it("preserves inline emphasis as markdown without eating spaces", () => {
    expect(content_en).toContain("*Zhuan Falun*"); // <em> -> italic
    expect(content_en).toContain("**(Minghui.org)**"); // <strong> -> bold
    expect(content_en).toContain("**(Minghui.org)** First"); // separating space kept
  });

  it("preserves real links and resolves relative hrefs; ignores tooltip anchors", () => {
    expect(content_en).toContain(
      "[linked report](https://en.minghui.org/html/articles/2025/2/3/225308.html)",
    );
    // <a title> with no href contributes its text only, not a broken link.
    expect(content_en).toContain("tooltip term");
    expect(content_en).not.toContain("[tooltip term]");
  });

  it("turns <br> into a line break instead of mashing words", () => {
    expect(content_en).toContain("Line A.\nLine B.");
    expect(content_en).not.toContain("Line A.Line B.");
  });
});

describe("parseArticleHtml — Master Li jingwen template", () => {
  it("falls back to h1.cBBlue + .jingwenNei when the standard template is absent", () => {
    const { title_en, content_en } = parseArticleHtml(JINGWEN);
    expect(title_en).toBe("How Humankind Came To Be");
    expect(content_en).toContain("The Creator cherishes all of the heavenly beings.");
    expect(content_en).toContain("New Year's would normally be a time");
  });
});
