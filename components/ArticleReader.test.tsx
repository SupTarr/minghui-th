import { describe, it, expect } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { renderInline } from "./ArticleReader";

// Recursively collect element tag names, anchor hrefs, and text from a
// renderInline() React tree, so we can assert on what a reader actually sees.
function collect(
  node: ReactNode,
  types: string[],
  hrefs: string[],
  texts: string[],
) {
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, types, hrefs, texts));
    return;
  }
  if (typeof node === "string") {
    texts.push(node);
    return;
  }
  if (isValidElement(node)) {
    const props = node.props as { href?: string; children?: ReactNode };
    const t = typeof node.type === "string" ? node.type : "component";
    types.push(t);
    if (t === "a" && props.href) hrefs.push(props.href);
    collect(props.children, types, hrefs, texts);
  }
}

function walk(text: string) {
  const types: string[] = [];
  const hrefs: string[] = [];
  const texts: string[] = [];
  collect(renderInline(text), types, hrefs, texts);
  return { types, hrefs, joined: texts.join("") };
}

describe("renderInline — markup nested inside emphasis", () => {
  it("renders a link inside italics as an anchor, not literal [text](url) (regression)", () => {
    // Minghui italicises+links book titles: <em><a>Zhuan Falun</a></em> ->
    // parser emits *[Zhuan Falun](url)*. Previously the italic branch printed the
    // capture as a plain string, exposing the raw URL with no working link.
    const url = "https://en.falundafa.org/eng/zfl_2014_9.html";
    const { types, hrefs, joined } = walk(
      `(Lecture Nine, *[Zhuan Falun](${url})*)`,
    );
    expect(types).toContain("em");
    expect(types).toContain("a");
    expect(hrefs).toContain(url);
    expect(joined).toContain("Zhuan Falun");
    expect(joined).not.toContain("[Zhuan Falun]"); // no literal markdown brackets
    expect(joined).not.toContain(url); // raw URL must not be printed as text
  });

  it("still renders link-wrapping-emphasis [*text*](url) correctly", () => {
    const url = "https://en.falundafa.org/eng/hongyin.html";
    const { types, hrefs, joined } = walk(`[*Hong Yin*](${url})`);
    expect(types).toContain("a");
    expect(types).toContain("em");
    expect(hrefs).toContain(url);
    expect(joined).toContain("Hong Yin");
  });

  it("renders a link embedded in a LONGER italic run (editor's-note variant)", () => {
    // *Editor's note: … ([Hong Yin](url))* — the link sits inside a fully
    // italicised paragraph, not as the whole italic span.
    const url = "https://en.falundafa.org/eng/hy2.html";
    const { types, hrefs, joined } = walk(
      `*Editor's note: see ([Hong Yin](${url})) for the source*`,
    );
    expect(types).toContain("em");
    expect(types).toContain("a");
    expect(hrefs).toContain(url);
    expect(joined).toContain("Editor's note: see");
    expect(joined).toContain("Hong Yin");
    expect(joined).not.toContain(url);
  });
});

describe("renderInline — opposite-type emphasis nested in bold (lazy-balanced)", () => {
  it("renders **bold *italic* bold** as <strong> wrapping <em>, with no literal *", () => {
    // The trusted EN parser emits this for <strong>…<em>…</em>…</strong> (e.g.
    // a bolded sentence quoting an italicised book title). The old no-star regex
    // re-anchored on the inner stars and leaked the outer ** as literal text.
    const { types, joined } = walk("**bold *it* bold**");
    expect(types).toContain("strong");
    expect(types).toContain("em");
    expect(joined).toBe("bold it bold");
    expect(joined).not.toContain("*"); // no leaked asterisks
  });

  it("renders an italicised link inside bold (**a *[t](url)* b**) fully", () => {
    const url = "https://en.falundafa.org/eng/zfl_2014_9.html";
    const { types, hrefs, joined } = walk(`**a *[Zhuan Falun](${url})* b**`);
    expect(types).toContain("strong");
    expect(types).toContain("em");
    expect(types).toContain("a");
    expect(hrefs).toContain(url);
    expect(joined).toBe("a Zhuan Falun b");
    expect(joined).not.toContain("*");
    expect(joined).not.toContain("["); // no leaked markdown brackets
    expect(joined).not.toContain(url);
  });

  it("still renders ***bold-italic*** wrapping a link (***[t](url)***)", () => {
    const url = "https://en.falundafa.org/eng/hongyin.html";
    const { types, hrefs, joined } = walk(`***[Hong Yin](${url})***`);
    expect(types).toContain("strong");
    expect(types).toContain("em");
    expect(types).toContain("a");
    expect(hrefs).toContain(url);
    expect(joined).toContain("Hong Yin");
  });

  it("does not leak literal asterisks for *italic **bold** italic* (bold-in-italic)", () => {
    // The flat regex can't fully resolve this rarer reverse-nesting (the inner
    // bold renders as separate emphasis rather than nested <strong>), but the
    // user-visible invariant — never show raw * — must hold.
    const { joined } = walk("*a **b** c*");
    expect(joined).toBe("a b c");
    expect(joined).not.toContain("*");
  });
});
