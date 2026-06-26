import { describe, it, expect } from "vitest";
import {
  isAllowedArticleUrl,
  isMinghuiSiteUrl,
  isValidArticleDate,
  isHttpUrl,
  cleanTitleText,
  cleanTranslationText,
} from "./apiValidation";

describe("isAllowedArticleUrl (SSRF guard)", () => {
  it("accepts a real https en.minghui.org article URL", () => {
    expect(
      isAllowedArticleUrl(
        "https://en.minghui.org/html/articles/2026/6/23/234818.html",
      ),
    ).toBe(true);
  });

  it("rejects http (non-https) even on the allowed host", () => {
    expect(isAllowedArticleUrl("http://en.minghui.org/x/1.html")).toBe(false);
  });

  it("rejects any other host", () => {
    expect(isAllowedArticleUrl("https://evil.com/x/1.html")).toBe(false);
  });

  it("rejects internal / cloud-metadata SSRF targets", () => {
    expect(
      isAllowedArticleUrl("http://169.254.169.254/latest/meta-data/"),
    ).toBe(false);
    expect(isAllowedArticleUrl("http://localhost:6379/")).toBe(false);
    expect(isAllowedArticleUrl("http://10.0.0.5:8080/admin")).toBe(false);
  });

  it("rejects look-alike host tricks (suffix and userinfo)", () => {
    // hostname is en.minghui.org.evil.com — not the allowed host
    expect(isAllowedArticleUrl("https://en.minghui.org.evil.com/1.html")).toBe(
      false,
    );
    // userinfo trick: real host is evil.com
    expect(isAllowedArticleUrl("https://en.minghui.org@evil.com/1.html")).toBe(
      false,
    );
  });

  it("rejects non-http schemes, malformed, empty, and non-strings", () => {
    expect(isAllowedArticleUrl("javascript:alert(1)//234818.html")).toBe(false);
    expect(isAllowedArticleUrl("not a url")).toBe(false);
    expect(isAllowedArticleUrl("")).toBe(false);
    expect(isAllowedArticleUrl(null)).toBe(false);
    expect(isAllowedArticleUrl(undefined)).toBe(false);
    expect(isAllowedArticleUrl(42)).toBe(false);
  });
});

describe("isMinghuiSiteUrl (redirect-target guard, subdomain-tolerant)", () => {
  it("accepts the exact host and any minghui.org subdomain over https", () => {
    expect(isMinghuiSiteUrl("https://en.minghui.org/x/1.html")).toBe(true);
    expect(isMinghuiSiteUrl("https://www.minghui.org/x")).toBe(true);
    expect(isMinghuiSiteUrl("https://minghui.org/x")).toBe(true);
  });

  it("rejects http (non-https)", () => {
    expect(isMinghuiSiteUrl("http://en.minghui.org/x")).toBe(false);
  });

  it("rejects off-site hosts and look-alike suffix tricks", () => {
    expect(isMinghuiSiteUrl("https://evil.com/x")).toBe(false);
    expect(isMinghuiSiteUrl("https://minghui.org.evil.com/x")).toBe(false);
    expect(isMinghuiSiteUrl("https://evilminghui.org/x")).toBe(false);
    expect(isMinghuiSiteUrl("https://169.254.169.254/")).toBe(false);
  });

  it("rejects malformed, empty, and non-strings", () => {
    expect(isMinghuiSiteUrl("not a url")).toBe(false);
    expect(isMinghuiSiteUrl("")).toBe(false);
    expect(isMinghuiSiteUrl(null)).toBe(false);
    expect(isMinghuiSiteUrl(undefined)).toBe(false);
  });
});

describe("isValidArticleDate (Drive folder-name guard)", () => {
  it("accepts an exact YYYY-MM-DD", () => {
    expect(isValidArticleDate("2026-06-23")).toBe(true);
  });

  it("rejects unpadded, wrong-separator, traversal, and trailing junk", () => {
    expect(isValidArticleDate("2026-6-3")).toBe(false);
    expect(isValidArticleDate("2026/06/23")).toBe(false);
    expect(isValidArticleDate("../2026-06-23")).toBe(false);
    expect(isValidArticleDate("2026-06-23/../x")).toBe(false);
    expect(isValidArticleDate("2026-06-23x")).toBe(false);
    expect(isValidArticleDate("")).toBe(false);
    expect(isValidArticleDate(20260623)).toBe(false);
  });
});

describe("isHttpUrl (stored-href guard)", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("https://en.minghui.org/x")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
  });

  it("rejects javascript: and other non-http schemes", () => {
    expect(isHttpUrl("javascript:alert(1)//1.html")).toBe(false);
    expect(isHttpUrl("ftp://example.com")).toBe(false);
    expect(isHttpUrl("//evil.com")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
  });
});

describe("cleanTranslationText (Gemini plain-text reply)", () => {
  it("returns the trimmed markdown body unchanged", () => {
    expect(cleanTranslationText("  สวัสดี\n\nเนื้อหา  ")).toBe(
      "สวัสดี\n\nเนื้อหา",
    );
  });

  it("strips a wrapping ```markdown / ``` code fence", () => {
    expect(cleanTranslationText("```markdown\nเนื้อหา\n```")).toBe("เนื้อหา");
    expect(cleanTranslationText("```\nบรรทัด\n```")).toBe("บรรทัด");
  });

  it("keeps an inner code fence that doesn't wrap the whole reply", () => {
    const body = "ก่อน\n\n```\ncode\n```\n\nหลัง";
    expect(cleanTranslationText(body)).toBe(body);
  });

  it("throws on an empty (or whitespace-only) reply", () => {
    expect(() => cleanTranslationText("")).toThrow(/empty translation/);
    expect(() => cleanTranslationText("   \n  ")).toThrow(/empty translation/);
  });
});

describe("cleanTitleText (Gemini title reply)", () => {
  it("returns a plain title unchanged", () => {
    expect(cleanTitleText("ความเมตตาที่แท้จริง")).toBe("ความเมตตาที่แท้จริง");
  });

  it("peels surrounding straight and curly quotes", () => {
    expect(cleanTitleText('"ความเมตตา"')).toBe("ความเมตตา");
    expect(cleanTitleText("'ความเมตตา'")).toBe("ความเมตตา");
    expect(cleanTitleText("“ความเมตตา”")).toBe("ความเมตตา");
    expect(cleanTitleText("‘ความเมตตา’")).toBe("ความเมตตา");
  });

  it("collapses a stray newline and trims", () => {
    expect(cleanTitleText("  ความเมตตา\nที่แท้จริง  ")).toBe(
      "ความเมตตา ที่แท้จริง",
    );
  });

  it("keeps an interior quote that doesn't wrap the whole title", () => {
    expect(cleanTitleText('เขาพูดว่า "ดี"')).toBe('เขาพูดว่า "ดี"');
  });

  it("throws when the reply is empty or only quotes", () => {
    expect(() => cleanTitleText("")).toThrow(/empty/);
    expect(() => cleanTitleText('""')).toThrow(/empty title/);
  });
});
