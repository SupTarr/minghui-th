import { describe, it, expect } from "vitest";
import { toYMD, parseArticleDateFromUrl, parseDateText } from "./date";

describe("toYMD", () => {
  it("zero-pads month and day (month is 0-indexed in Date)", () => {
    expect(toYMD(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toYMD(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("parseArticleDateFromUrl", () => {
  it("extracts and zero-pads the date from a Minghui article URL", () => {
    expect(
      parseArticleDateFromUrl(
        "https://en.minghui.org/html/articles/2026/6/26/234818.html",
      ),
    ).toBe("2026-06-26");
    expect(parseArticleDateFromUrl("/articles/2026/12/3/1.html")).toBe(
      "2026-12-03",
    );
  });
  it("returns null when the path carries no date", () => {
    expect(parseArticleDateFromUrl("https://en.minghui.org/cc/24/")).toBeNull();
    expect(parseArticleDateFromUrl("not a url")).toBeNull();
  });
});

describe("parseDateText", () => {
  it("parses a free-text date to YYYY-MM-DD, trimming and collapsing whitespace", () => {
    expect(parseDateText("June 23, 2026")).toBe("2026-06-23");
    expect(parseDateText("  June  23,   2026  ")).toBe("2026-06-23");
  });
  it("returns null for unparseable text", () => {
    expect(parseDateText("not a date")).toBeNull();
    expect(parseDateText("")).toBeNull();
  });
});
