import { describe, it, expect } from "vitest";
import {
  validateArticle,
  extractSkeleton,
  toStoredRecord,
} from "./contentValidation";
import { renderFailures } from "./validationMessages";

// A structurally faithful EN/TH pair: same headings, same link URL, balanced
// markers, Thai actually present. The translated link *text* differs (expected);
// the URL is byte-identical (required).
const EN = `# Understanding Cultivation

A practitioner shares her story about [Zhuan Falun](https://en.minghui.org/zhuanfalun).

### A Turning Point

She felt *peace* after reading **Falun Dafa** books.

> Truth Compassion Forbearance
> is the guiding principle.`;

const TH = `# ความเข้าใจเรื่องการบำเพ็ญ

ผู้ฝึกคนหนึ่งเล่าเรื่องราวของเธอเกี่ยวกับ [จ้วนฝ่าหลุน](https://en.minghui.org/zhuanfalun)

### จุดเปลี่ยน

เธอรู้สึก *สงบ* หลังจากอ่านหนังสือ **ฝ่าหลุนต้าฝ่า**

> สัจจะ เมตตา อดทน
> คือหลักการชี้นำ`;

const base = {
  title_en: "Understanding Cultivation",
  title_th: "ความเข้าใจเรื่องการบำเพ็ญ",
  content_en: EN,
  content_th: TH,
};

const failed = (id: string, r: ReturnType<typeof validateArticle>) =>
  r.checks.find((c) => c.id === id && !c.ok);

describe("extractSkeleton", () => {
  it("mirrors the renderer's block split and per-block inline parse", () => {
    const skel = extractSkeleton(EN);
    expect(skel.map((b) => b.type)).toEqual(["h1", "p", "h3", "p", "quote"]);
    const links = skel
      .flatMap((b) => b.inlines)
      .filter((i) => i.kind === "link");
    expect(links).toEqual([
      { kind: "link", url: "https://en.minghui.org/zhuanfalun" },
    ]);
  });

  it("recurses into emphasis to find a nested link (*[..](..)*)", () => {
    const skel = extractSkeleton("*[Hong Yin](https://en.minghui.org/hy)*");
    expect(skel[0].inlines).toEqual([
      { kind: "italic" },
      { kind: "link", url: "https://en.minghui.org/hy" },
    ]);
  });

  it("recurses into bold to find a nested italic (**a *b* c**)", () => {
    // The lazy-balanced emphasis regex lets the outer ** capture the whole inner
    // run, so the shared regex (renderer + validator) sees [bold, italic] rather
    // than orphan markers.
    const skel = extractSkeleton("**ก *ข* ค**");
    expect(skel[0].inlines).toEqual([{ kind: "bold" }, { kind: "italic" }]);
  });
});

describe("validateArticle — PASS", () => {
  it("a faithful translation passes with no error-level failures", () => {
    const r = validateArticle(base);
    const errors = r.checks.filter((c) => c.severity === "error" && !c.ok);
    expect(errors).toEqual([]);
    expect(r.status).toBe("PASS");
    expect(r.configVersion).toBeGreaterThan(0);
  });

  it("a minimal clean pair yields statusDesc OK (no warnings either)", () => {
    const r = validateArticle({
      title_en: "Title",
      title_th: "หัวข้อ",
      content_en: "# Title\n\nHello world from a practitioner.",
      content_th: "# หัวข้อ\n\nสวัสดีจากผู้ฝึกฝนคนหนึ่งนะ",
    });
    expect(r.status).toBe("PASS");
    expect(r.statusDesc).toBe("OK");
  });

  it("stamps checkedAt from the caller, not internally", () => {
    expect(validateArticle(base).checkedAt).toBe("");
    expect(validateArticle(base, "2026-06-25T00:00:00Z").checkedAt).toBe(
      "2026-06-25T00:00:00Z",
    );
  });
});

describe("validateArticle — FAILED (error checks)", () => {
  it("flags a dropped link", () => {
    const content_th = TH.replace(
      "[จ้วนฝ่าหลุน](https://en.minghui.org/zhuanfalun)",
      "จ้วนฝ่าหลุน",
    );
    const r = validateArticle({ ...base, content_th });
    expect(r.status).toBe("FAILED");
    expect(failed("link_set", r)).toBeTruthy();
  });

  it("flags a mutated link URL", () => {
    const content_th = TH.replace(
      "https://en.minghui.org/zhuanfalun",
      "https://en.minghui.org/WRONG",
    );
    const r = validateArticle({ ...base, content_th });
    expect(r.status).toBe("FAILED");
    expect(failed("link_set", r)).toBeTruthy();
  });

  it("flags a TH-introduced unbalanced emphasis marker (literal-asterisk leak)", () => {
    const content_th = TH.replace(
      "เธอรู้สึก *สงบ* หลังจากอ่านหนังสือ **ฝ่าหลุนต้าฝ่า**",
      "เธอรู้สึก *สงบ *สันติ**",
    );
    const r = validateArticle({ ...base, content_th });
    expect(r.status).toBe("FAILED");
    expect(failed("markdown_balance", r)).toBeTruthy();
  });

  it("flags an orphan '*' hiding inside translated link text (recursive residue)", () => {
    const r = validateArticle({
      title_en: "t",
      title_th: "หัว",
      content_en: "อ่าน [หนังสือเล่มนี้](https://en.minghui.org/book) ให้จบ",
      content_th: "อ่าน [หนังสือ *เล่มนี้](https://en.minghui.org/book) ให้จบ",
    });
    expect(r.status).toBe("FAILED");
    expect(failed("markdown_balance", r)).toBeTruthy();
  });

  it("flags a heading that lost its prefix in translation", () => {
    const content_th = TH.replace("### จุดเปลี่ยน", "จุดเปลี่ยน");
    const r = validateArticle({ ...base, content_th });
    expect(r.status).toBe("FAILED");
    expect(failed("heading_skeleton", r)).toBeTruthy();
  });

  it("flags content left in English (untranslated)", () => {
    const r = validateArticle({
      ...base,
      content_th:
        "This paragraph was never translated and remains entirely in English prose for the reader.",
    });
    expect(r.status).toBe("FAILED");
    expect(failed("th_translated", r)).toBeTruthy();
  });

  it("flags empty Thai content", () => {
    const r = validateArticle({ ...base, content_th: "   " });
    expect(r.status).toBe("FAILED");
    expect(failed("th_nonempty", r)).toBeTruthy();
  });

  it("flags a title left byte-identical to English", () => {
    const r = validateArticle({ ...base, title_th: base.title_en });
    expect(r.status).toBe("FAILED");
    expect(failed("title_translated", r)).toBeTruthy();
  });

  it("short-circuits to FAILED on a pathological marker run (no hang)", () => {
    const r = validateArticle({
      title_en: "t",
      title_th: "หัว",
      content_en: "# Title\n\nbody",
      content_th: "[".repeat(5000),
    });
    expect(r.status).toBe("FAILED");
    expect(failed("content_sane", r)).toBeTruthy();
  });

  it("short-circuits on SPARSE markers the consecutive-run guard misses (no hang)", () => {
    // "[a[a[a…" never has 200 in a row, so PATHOLOGICAL_RUN can't catch it, but it
    // still drives the link regex into O(n^2). The total-marker-count guard does.
    const r = validateArticle({
      title_en: "t",
      title_th: "หัว",
      content_en: "# Title\n\nbody",
      content_th: "[a".repeat(5000), // 5000 '[' total, never consecutive
    });
    expect(r.status).toBe("FAILED");
    expect(failed("content_sane", r)).toBeTruthy();
  });
});

describe("validateArticle — differential markdown (no false positives)", () => {
  it("does NOT flag a literal '*' present symmetrically in EN and TH (e.g. masked name)", () => {
    const r = validateArticle({
      title_en: "Report",
      title_th: "รายงาน",
      content_en: "Officer L*** detained the practitioner at the station.",
      content_th: "เจ้าหน้าที่ L*** ควบคุมตัวผู้ฝึกไว้ที่สถานี",
    });
    expect(r.status).toBe("PASS");
    expect(failed("markdown_balance", r)).toBeFalsy();
  });

  it("does NOT flag balanced nested emphasis (**bold *italic* bold**) as introduced markup", () => {
    // The lazy regex now consumes the whole nested run on both sides, so no orphan
    // '*' residue is left — what the reader renders cleanly, the validator passes.
    const r = validateArticle({
      title_en: "t",
      title_th: "หัว",
      content_en: "He said to **read *Zhuan Falun* often** every day.",
      content_th: "เขาบอกให้ **อ่าน *จ้วนฝ่าหลุน* บ่อยครั้ง** ทุกวัน",
    });
    expect(r.status).toBe("PASS");
    expect(failed("markdown_balance", r)).toBeFalsy();
  });
});

describe("validateArticle — warnings keep status PASS", () => {
  it("a consolidated duplicate URL is a warn (link_count), not an error", () => {
    const r = validateArticle({
      title_en: "t",
      title_th: "หัว",
      content_en:
        "อ่าน [เล่มนี้](https://en.minghui.org/zf) และอ่าน [เล่มนี้](https://en.minghui.org/zf) อีก",
      content_th:
        "อ่าน [เล่มนี้](https://en.minghui.org/zf) ทุกวันและอ่านซ้ำบ่อยครั้ง",
    });
    expect(r.status).toBe("PASS");
    expect(failed("link_set", r)).toBeFalsy();
    expect(failed("link_count", r)?.severity).toBe("warn");
  });

  it("an embedded untranslated English block warns but does not fail", () => {
    const r = validateArticle({
      title_en: "t",
      title_th: "หัว",
      content_en:
        "First English paragraph about cultivation here.\n\nSecond English paragraph here too.\n\nThird English paragraph as well.",
      content_th:
        "ย่อหน้าแรกเกี่ยวกับการบำเพ็ญที่แปลแล้วอย่างครบถ้วนสมบูรณ์\n\nThis whole second paragraph was left untranslated in English entirely.\n\nย่อหน้าที่สามที่แปลเป็นภาษาไทยเรียบร้อยแล้วครบถ้วน",
    });
    expect(r.status).toBe("PASS");
    expect(failed("th_untranslated_block", r)?.severity).toBe("warn");
  });

  it("block drift warns but does not fail the article", () => {
    const r = validateArticle({
      title_en: "t",
      title_th: "หัว",
      content_en: "First paragraph here.\n\nSecond paragraph here.",
      content_th: "ย่อหน้าแรกอยู่ที่นี่ และย่อหน้าที่สองก็รวมเข้ามาด้วยกัน",
    });
    expect(r.status).toBe("PASS");
    expect(failed("block_drift", r)?.severity).toBe("warn");
    expect(r.statusDesc).toContain("โครงสร้างย่อหน้าคลาดเคลื่อน");
  });

  it("parser_completeness warns when parsed EN is short vs the source body", () => {
    const r = validateArticle({
      title_en: "t",
      title_th: "หัว",
      content_en: "# Title\n\nA very short body.",
      content_th: "# หัวข้อ\n\nเนื้อหาสั้นมากในภาษาไทย",
      sourceTextLength: 10000,
    });
    expect(r.status).toBe("PASS");
    expect(failed("parser_completeness", r)?.severity).toBe("warn");
  });

  it("omitting sourceTextLength skips the completeness check entirely", () => {
    const r = validateArticle({
      title_en: "t",
      title_th: "หัว",
      content_en: "# Title\n\nA very short body.",
      content_th: "# หัวข้อ\n\nเนื้อหาสั้นมากในภาษาไทย",
    });
    expect(
      r.checks.find((c) => c.id === "parser_completeness"),
    ).toBeUndefined();
  });
});

describe("toStoredRecord — slim, text-free persisted shape", () => {
  it("keeps only failing checks as {id, variant?, vars?}; no text/severity/checks", () => {
    const r = validateArticle({ ...base, title_th: base.title_en });
    const stored = toStoredRecord(r);
    expect(stored.status).toBe("FAILED");
    expect(stored.configVersion).toBe(r.configVersion);
    const rec = stored as unknown as Record<string, unknown>;
    expect(rec.statusDesc).toBeUndefined();
    expect(rec.checks).toBeUndefined();
    expect(stored.failures.every((f) => f.id && !("severity" in f))).toBe(true);
    expect(stored.failures.map((f) => f.id).sort()).toEqual(
      r.checks
        .filter((c) => !c.ok)
        .map((c) => c.id)
        .sort(),
    );
  });

  it("a PASS article stores an empty failures list", () => {
    const stored = toStoredRecord(validateArticle(base));
    expect(stored.status).toBe("PASS");
    expect(stored.failures).toEqual([]);
  });
});

describe("renderFailures — message text comes from validation.json", () => {
  it("renders a stored failure's Thai message from the registry", () => {
    const r = validateArticle({ ...base, title_th: base.title_en });
    const text = renderFailures(toStoredRecord(r).failures);
    expect(text).toBe(
      "ชื่อเรื่องภาษาไทยเหมือนภาษาอังกฤษทุกตัวอักษร (ยังไม่ได้แปลชื่อเรื่อง)",
    );
    // finalize renders statusDesc through the same path
    expect(text).toBe(r.statusDesc);
  });
});
