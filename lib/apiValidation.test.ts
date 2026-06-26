import { describe, it, expect } from "vitest";
import {
  isAllowedArticleUrl,
  isMinghuiSiteUrl,
  isValidArticleDate,
  isHttpUrl,
  parseTranslationResponse,
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

describe("parseTranslationResponse (Gemini reply shape)", () => {
  it("returns the two string fields for a well-formed object", () => {
    expect(
      parseTranslationResponse('{"title_th":"ชื่อ","content_th":"เนื้อหา"}'),
    ).toEqual({ title_th: "ชื่อ", content_th: "เนื้อหา" });
  });

  it("throws a clear error on the literal `null` (not a destructure TypeError)", () => {
    // The original bug: JSON.parse("null") -> null, then destructure threw
    // "Cannot destructure property 'title_th' of null".
    expect(() => parseTranslationResponse("null")).toThrow(/not a JSON object/);
  });

  it("throws on non-object JSON (string / number)", () => {
    expect(() => parseTranslationResponse('"a string"')).toThrow(
      /not a JSON object/,
    );
    expect(() => parseTranslationResponse("42")).toThrow(/not a JSON object/);
  });

  it("throws on missing or non-string fields", () => {
    expect(() => parseTranslationResponse('{"title_th":"ก"}')).toThrow(
      /missing title_th\/content_th/,
    );
    expect(() => parseTranslationResponse("[1,2]")).toThrow(
      /missing title_th\/content_th/,
    );
  });

  it("throws on invalid JSON", () => {
    expect(() => parseTranslationResponse("{not json")).toThrow(
      /did not return valid JSON/,
    );
  });
});
