import { describe, it, expect } from "vitest";
import { parseArticleHtml } from "./parseArticle";

// Fixture mirroring the real Minghui article DOM, including every `splitted`
// variant the parser must distinguish: metadata, image caption, and poem quote.
const FIXTURE = `
<html><body>
  <h1 class="article-title">Sample Cultivation Story</h1>
  <div class="article-body margin-15">
    <div class="article-body-content">
      <p class="normal">First normal paragraph.</p>
      <p class="normal">Second normal paragraph.</p>

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

      <!-- Image caption: splitted but NOT a quote -> dropped -->
      <p class="splitted image-container">Master's portrait at the conference (Minghui.org)</p>

      <!-- Trailing metadata: splitted -> dropped -->
      <p class="splitted">Original article was published on June 29, 2023.</p>

      <!-- Copyright -> dropped -->
      <p class="copyright-notice">Copyright Minghui.org.</p>
    </div>
  </div>
</body></html>
`;

describe("parseArticleHtml", () => {
  const { title_en, content_en } = parseArticleHtml(FIXTURE);

  it("extracts the title", () => {
    expect(title_en).toBe("Sample Cultivation Story");
  });

  it("keeps normal paragraphs", () => {
    expect(content_en).toContain("First normal paragraph.");
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

  it("drops image captions, trailing metadata, and copyright", () => {
    expect(content_en).not.toContain("Master's portrait");
    expect(content_en).not.toContain("Original article was published");
    expect(content_en).not.toContain("Copyright Minghui.org");
  });
});
