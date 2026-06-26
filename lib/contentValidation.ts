// Deterministic completeness/correctness checks for scraped + translated
// article content. Pure, dependency-free TypeScript so the one implementation is
// shared, with no drift, by:
//   - the Next app  (app/api/translate runs it; ArticleReader reuses the regex)
//   - the audit CLI (scripts/backfill-validation.mts, run by plain `node`)
//   - vitest        (lib/contentValidation.test.ts)
//
// The validator never blocks the pipeline: it tags an article PASS/FAILED with a
// human-readable statusDesc, and a "Needs review" admin tab surfaces FAILED ones.
//
// Scope & known limits (deterministic-only, by product choice — the LLM
// faithfulness audit was deliberately declined):
//   - It cannot see SEMANTIC loss: a paragraph silently dropped from content_th,
//     or a faithful-looking but mistranslated/partial body, has no structural
//     tell and is not caught here (only volume warnings hint at it). Per-block
//     Thai detection (warn) and length ratios approximate this; true coverage
//     needs the offline audit tier.
//   - It cannot verify text↔link pairing (anchor text is translated) or heading
//     text correctness across languages — only structure (URL set, level
//     sequence) is checked.
//
// Design notes:
//   - content_en comes from our own tested parser (lib/parseArticle.ts) → it is
//     the known-good reference; content_th (Gemini's output) is the suspect.
//   - The inline-markdown regex is THE renderer's regex (createInlineRegex), so
//     "what the validator treats as a link/emphasis" == "what the reader renders".
//     renderContent splits a body into "\n\n" blocks and calls renderInline on
//     each block's text *after* stripping its prefix, so we mirror that exactly:
//     all inline analysis is per-block, on the same stripped text, and recurses
//     into matches the way renderInline does.

import {
  CONFIG,
  CONFIG_VERSION,
  renderFailures,
  type StoredFailure,
} from "./validationMessages.ts";

// Re-exported for the backfill CLI's version gate. The rule registry —
// thresholds, severity, and message text — is the repo-root validation.json
// (the single source of truth); this module holds only the check LOGIC.
export { CONFIG_VERSION };
export type { StoredFailure } from "./validationMessages.ts";

// Tunable thresholds, all sourced from validation.json. These consts feed the
// CHECK LOGIC below; the message text and its threshold interpolation come from
// the same registry via renderMessage, so nothing is duplicated.
const param = (id: string, key: string): number =>
  CONFIG.rules[id].params![key] as number;
const THAI_RATIO_MIN = param("th_translated", "thaiRatioMin"); // min Thai-share of letters in content_th
const THAI_RATIO_MIN_LETTERS = param("th_translated", "thaiRatioMinLetters"); // don't judge ratio on a near-empty body
const BLOCK_UNTRANSLATED_MIN_LETTERS = param(
  "th_untranslated_block",
  "blockUntranslatedMinLetters",
); // a block must be this substantial to judge
const BLOCK_THAI_MIN = param("th_untranslated_block", "blockThaiMin"); // below this Thai-share, a block looks untranslated
const LEN_RATIO_MIN = param("length_ratio", "lenRatioMin"); // content_th / content_en plain-text char ratio band
const LEN_RATIO_MAX = param("length_ratio", "lenRatioMax");
const SEVERE_TRUNCATION_MAX = param("severe_truncation", "severeTruncationMax"); // below this TH/EN ratio the body is truncated, not merely short (error)
const COMPLETENESS_MIN = param("parser_completeness", "completenessMin"); // parsed-EN / source-body text ratio floor
const MAX_CONTENT_CHARS = param("content_sane", "maxContentChars"); // beyond this, content is abnormal — skip heavy regex
// A *consecutive*-run guard can't catch SPARSE adversarial markers ("[a[a[a…"),
// which still drive the link/emphasis regex into O(n^2) backtracking. Cap the
// TOTAL [/* count too (a linear char-class scan, no backtracking). Legitimate
// articles carry well under this; thousands of unbalanced markers are corrupt.
const MAX_INLINE_MARKERS = param("content_sane", "maxInlineMarkers");
const PATHOLOGICAL_RUN = new RegExp(
  CONFIG.rules.content_sane.params!.pathologicalPattern as string,
  CONFIG.rules.content_sane.params!.pathologicalFlags as string,
); // 200+ consecutive [ or * → corrupt; avoids O(n^2) regex

// Severity is now config-sourced, so a rule id the validator emits but the
// registry lacks would silently drop the check (an error-severity drop flips
// FAILED→PASS). Fail loud at module load instead.
const EXPECTED_RULE_IDS = [
  "content_sane",
  "th_nonempty",
  "title_translated",
  "th_translated",
  "link_set",
  "link_count",
  "image_set",
  "markdown_balance",
  "heading_skeleton",
  "th_untranslated_block",
  "block_drift",
  "length_ratio",
  "severe_truncation",
  "parser_completeness",
  "validator_error",
] as const;
for (const id of EXPECTED_RULE_IDS) {
  if (!CONFIG.rules[id]) {
    throw new Error(`validation.json is missing rule "${id}"`);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One validation rule's outcome (in-memory). Carries no rendered text: the
 * message is derived from validation.json via `variant`/`vars` on demand.
 */
export interface ValidationCheck {
  id: string;
  severity: "error" | "warn";
  ok: boolean;
  /** Template variant that fired (rules with a `messages` map; absent when ok). */
  variant?: string;
  /** Measured values for message interpolation (no thresholds; absent when ok). */
  vars?: Record<string, string | number>;
}

export interface ValidationResult {
  /** FAILED iff any severity:"error" check failed; warnings never flip it. */
  status: "PASS" | "FAILED";
  /** Joined rendered messages of failing checks (errors first), or "OK".
   *  Computed in-memory for display/tests; NOT persisted (see StoredValidation). */
  statusDesc: string;
  checks: ValidationCheck[];
  /** ISO timestamp; stamped by the caller (kept out of the pure fn). */
  checkedAt: string;
  configVersion: number;
}

/**
 * What gets PERSISTED per article / index entry: only the dynamic facts. No
 * rendered text, no severity, no passing checks — the UI renders messages from
 * validation.json via renderFailures(failures). `toStoredRecord` slims a
 * ValidationResult into this at the save/backfill boundary.
 */
export interface StoredValidation {
  status: "PASS" | "FAILED";
  failures: StoredFailure[];
  checkedAt: string;
  configVersion: number;
}

/** A failing check → its persisted, text-free shape. */
function toStoredFailure(c: ValidationCheck): StoredFailure {
  return {
    id: c.id,
    ...(c.variant ? { variant: c.variant } : {}),
    ...(c.vars ? { vars: c.vars } : {}),
  };
}

/** Slim a full in-memory result to the persisted record (drops text + passing checks). */
export function toStoredRecord(r: ValidationResult): StoredValidation {
  return {
    status: r.status,
    failures: r.checks.filter((c) => !c.ok).map(toStoredFailure),
    checkedAt: r.checkedAt,
    configVersion: r.configVersion,
  };
}

/**
 * True iff `v` is a full in-memory {@link ValidationResult} (carries the `checks`
 * array). /api/translate sends this; a manual re-save may instead send an already
 * slim {@link StoredValidation}. Lets the save route narrow an untrusted body
 * without an `as unknown as` cast.
 */
export function isValidationResult(v: unknown): v is ValidationResult {
  return (
    !!v &&
    typeof v === "object" &&
    Array.isArray((v as ValidationResult).checks)
  );
}

/** True iff `v` is already a slim {@link StoredValidation} (status + failures[]). */
export function isStoredValidation(v: unknown): v is StoredValidation {
  if (!v || typeof v !== "object") return false;
  const r = v as StoredValidation;
  return (
    (r.status === "PASS" || r.status === "FAILED") && Array.isArray(r.failures)
  );
}

export interface ValidateInput {
  title_en: string;
  content_en: string;
  title_th: string;
  content_th: string;
  /** Plain-text length of the source article body, for the completeness check. */
  sourceTextLength?: number;
}

export type BlockType =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "quote"
  | "list"
  | "code"
  | "hr"
  | "image"
  | "p";

export type InlineKind = "bold" | "italic" | "bolditalic" | "link";

export interface InlineToken {
  kind: InlineKind;
  /** Present only for kind === "link". */
  url?: string;
}

export interface SkelBlock {
  type: BlockType;
  inlines: InlineToken[];
}

// ---------------------------------------------------------------------------
// Shared inline-markdown regex (the renderer imports createInlineRegex too)
// ---------------------------------------------------------------------------

// ***bold-italic*** | **bold** | *italic* | [text](http-url). Emphasis bodies use
// LAZY balanced matches ([\s\S]+? / [^\n]+?) rather than a no-star class, so an
// emphasis run may contain a nested opposite-type span — **bold *italic* bold**,
// or an italicised link inside bold — with the outer marker capturing the whole
// inner run and callers recursing into it. A no-star class would re-anchor on the
// inner markers and leak the outer ** as literal asterisks. Capture-group order
// (bold-italic, bold, italic, link-text, link-url) is unchanged, so collectInlines
// / residueOf / renderInline keep working. The /g regex is stateful (lastIndex),
// so every caller must get a fresh instance.
export const INLINE_MD_PATTERN =
  "\\*\\*\\*([\\s\\S]+?)\\*\\*\\*|\\*\\*([\\s\\S]+?)\\*\\*|\\*([^\\n]+?)\\*|\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)";

export function createInlineRegex(): RegExp {
  return new RegExp(INLINE_MD_PATTERN, "g");
}

// A whole block that is a single markdown image: ![alt](http-url). Images are
// block-level (Minghui images are standalone figures), so this is detected by
// classifyBlock and rendered by renderContent — deliberately NOT an inline kind,
// which keeps the image URL out of the link/emphasis regex above (the `[alt](url)`
// substring would otherwise be miscounted as a link). `[^\]]*` allows an EMPTY alt
// (multi-image containers attach their one caption to a sibling block, leaving the
// images alt-less). Exported so the renderer and the validator share ONE matcher —
// the same "what validates == what renders" guarantee createInlineRegex provides.
// No /g flag, so a single module-level compiled regex is safe to reuse.
export const IMAGE_BLOCK_PATTERN =
  "^!\\[([^\\]]*)\\]\\((https?:\\/\\/[^)\\s]+)\\)$";
const IMAGE_BLOCK_RE = new RegExp(IMAGE_BLOCK_PATTERN);

/** Match a trimmed block against IMAGE_BLOCK_PATTERN; m[1] = alt, m[2] = url. */
export function matchImageBlock(block: string): RegExpMatchArray | null {
  return block.trim().match(IMAGE_BLOCK_RE);
}

/**
 * Collect inline tokens from a single block's text, recursing into each
 * emphasis/link capture exactly as renderInline does — so a link nested in
 * italics (`*[Zhuan Falun](url)*`) or emphasis nested in a link
 * (`[*Hong Yin*](url)`) is found, not missed.
 */
export function collectInlines(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  const re = createInlineRegex();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) {
      out.push({ kind: "bolditalic" });
      out.push(...collectInlines(m[1]));
    } else if (m[2] !== undefined) {
      out.push({ kind: "bold" });
      out.push(...collectInlines(m[2]));
    } else if (m[3] !== undefined) {
      out.push({ kind: "italic" });
      out.push(...collectInlines(m[3]));
    } else {
      out.push({ kind: "link", url: m[5] });
      out.push(...collectInlines(m[4]));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block model (mirrors components/ArticleReader.tsx renderContent)
// ---------------------------------------------------------------------------

/** Classify a "\n\n"-separated block by its markdown prefix. */
function classifyBlock(para: string): BlockType {
  if (para.startsWith("#### ")) return "h4";
  if (para.startsWith("### ")) return "h3";
  if (para.startsWith("## ")) return "h2";
  if (para.startsWith("# ")) return "h1";
  if (para.startsWith("> ")) return "quote";
  if (para.startsWith("- ")) return "list";
  if (para.startsWith("```")) return "code";
  if (matchImageBlock(para)) return "image";
  if (/^-{3,}$/.test(para.trim())) return "hr";
  return "p";
}

/**
 * The exact string renderContent passes to renderInline for a block (prefix
 * stripped the same way), or null for blocks the renderer never inlines (code,
 * horizontal rule). Mirrors renderContent's per-block, starts-with-``` code
 * detection — NOT a global fence strip — so the validator sees exactly the
 * blocks the reader inlines (a fenced block with an internal blank line splits
 * into a code block + a non-code tail the reader renders literally).
 */
function blockInlineText(para: string, type: BlockType): string | null {
  switch (type) {
    case "h1":
      return para.replace(/^#\s+/, "");
    case "h2":
      return para.replace(/^##\s+/, "");
    case "h3":
      return para.replace(/^###\s+/, "");
    case "h4":
      return para.replace(/^####\s+/, "");
    case "quote":
      return para.replace(/^>\s?/gm, "");
    case "list":
      return para.replace(/^-\s+/, "");
    case "image": {
      // Caption (alt) only — never the full ![..](url), so the shared inline regex
      // can't miscount the image URL as a link. The caption still counts toward the
      // Thai-ratio / length checks; the URL is guarded separately by image_set.
      const m = matchImageBlock(para);
      return m ? m[1] : "";
    }
    case "code":
    case "hr":
      return null;
    default:
      return para;
  }
}

/** Iterate a body's non-empty blocks with their type and inline text. */
function eachBlock(
  md: string,
  fn: (type: BlockType, inlineText: string | null, raw: string) => void,
): void {
  for (const para of (md || "").split("\n\n")) {
    if (!para.trim()) continue;
    const type = classifyBlock(para);
    fn(type, blockInlineText(para, type), para);
  }
}

/** Split a body into the same blocks the renderer iterates, dropping blanks. */
export function extractSkeleton(md: string): SkelBlock[] {
  const blocks: SkelBlock[] = [];
  eachBlock(md, (type, inlineText) => {
    blocks.push({
      type,
      inlines: inlineText === null ? [] : collectInlines(inlineText),
    });
  });
  return blocks;
}

// ---------------------------------------------------------------------------
// Derived views used by the checks
// ---------------------------------------------------------------------------

const HEADINGS = new Set<BlockType>(["h1", "h2", "h3", "h4"]);

function headingLevels(md: string): BlockType[] {
  return extractSkeleton(md)
    .map((b) => b.type)
    .filter((t) => HEADINGS.has(t));
}

function blockTypes(md: string): BlockType[] {
  return extractSkeleton(md).map((b) => b.type);
}

/** Every link URL occurrence (a multiset, document order). */
function collectLinks(md: string): string[] {
  const urls: string[] = [];
  for (const block of extractSkeleton(md)) {
    for (const inline of block.inlines) {
      if (inline.kind === "link" && inline.url) urls.push(inline.url);
    }
  }
  return urls;
}

/**
 * Every image-block URL occurrence (a multiset, document order). The shared inline
 * regex deliberately never sees image URLs (image blocks are alt-only there), so
 * this is their dedicated collector — the image_set analogue of collectLinks.
 */
function collectImages(md: string): string[] {
  const urls: string[] = [];
  eachBlock(md, (type, _inlineText, raw) => {
    if (type !== "image") return;
    const m = matchImageBlock(raw);
    if (m) urls.push(m[2]);
  });
  return urls;
}

/**
 * Count the markdown "residue" a block leaves AFTER the renderer's regex
 * consumes every valid emphasis/link span — recursing into matches exactly as
 * renderInline does (it recurses into emphasis captures AND link text). A
 * leftover `*` is an orphan emphasis marker that renders as a literal asterisk;
 * a leftover `](` is a link the renderer can't parse (non-http/broken URL). The
 * recursion is what catches an orphan `*` hiding inside link text — where the
 * reader looks but a flat scan would not.
 */
function residueOf(text: string): { star: number; link: number } {
  let star = 0;
  let link = 0;
  const re = createInlineRegex();
  let last = 0;
  let m: RegExpExecArray | null;
  const scanGap = (s: string) => {
    star += (s.match(/\*/g) || []).length;
    link += (s.match(/\]\(/g) || []).length;
  };
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) scanGap(text.slice(last, m.index));
    const inner = m[1] ?? m[2] ?? m[3] ?? m[4]; // emphasis content or link text
    const r = residueOf(inner);
    star += r.star;
    link += r.link;
    last = re.lastIndex;
  }
  if (last < text.length) scanGap(text.slice(last));
  return { star, link };
}

/** Total residual orphan-marker counts across a body's inlined blocks. */
function markdownResidue(md: string): { star: number; link: number } {
  let star = 0;
  let link = 0;
  eachBlock(md, (_type, inlineText) => {
    if (inlineText === null) return;
    const r = residueOf(inlineText);
    star += r.star;
    link += r.link;
  });
  return { star, link };
}

/** A block's de-marked plain text: link URLs and emphasis markers removed. */
function blockPlainText(inlineText: string): string {
  return inlineText
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1") // links → text
    .replace(/\*+/g, ""); // emphasis markers
}

/** De-marked plain text of a whole body (code/hr blocks excluded). */
function plainText(md: string): string {
  const out: string[] = [];
  eachBlock(md, (_type, inlineText) => {
    if (inlineText === null) return;
    out.push(blockPlainText(inlineText));
  });
  return out.join("\n");
}

function countThaiLatin(s: string): { thai: number; latin: number } {
  return {
    thai: (s.match(/[฀-๿]/g) || []).length,
    latin: (s.match(/[A-Za-z]/g) || []).length,
  };
}

function thaiRatio(md: string): { ratio: number; letters: number } {
  const { thai, latin } = countThaiLatin(plainText(md));
  const letters = thai + latin;
  return { ratio: letters > 0 ? thai / letters : 1, letters };
}

/**
 * Substantial blocks that look untranslated (mostly Latin). Per-block, so a
 * single English paragraph embedded in a Thai body is visible — which the
 * whole-body ratio cannot see. Warn-level: legitimate Thai blocks carry some
 * Latin (proper nouns, URLs-as-text), so this is a signal for calibration, not
 * a hard fail.
 */
function untranslatedBlockCount(md: string): number {
  let count = 0;
  eachBlock(md, (_type, inlineText) => {
    if (inlineText === null) return;
    const { thai, latin } = countThaiLatin(blockPlainText(inlineText));
    const letters = thai + latin;
    if (
      letters >= BLOCK_UNTRANSLATED_MIN_LETTERS &&
      thai / letters < BLOCK_THAI_MIN
    ) {
      count++;
    }
  });
  return count;
}

function compactLen(md: string): number {
  return plainText(md).replace(/\s+/g, "").length;
}

function sameSeq<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function summarizeCounts(types: BlockType[]): string {
  const counts = new Map<BlockType, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([t, n]) => `${n}${t}`).join(",") || "empty";
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

function runChecks(input: ValidateInput, now: string): ValidationResult {
  const { title_en, content_en, title_th, content_th, sourceTextLength } =
    input;
  const en = content_en || "";
  const th = content_th || "";
  const checks: ValidationCheck[] = [];
  const add = (
    id: string,
    ok: boolean,
    variant?: string,
    vars?: Record<string, string | number>,
  ) => {
    const rule = CONFIG.rules[id];
    if (!rule) return; // unknown id never emitted (registry verified at load)
    checks.push({
      id,
      severity: rule.severity,
      ok,
      ...(variant ? { variant } : {}),
      ...(vars ? { vars } : {}),
    });
  };

  // Robustness: many [ or * make the link/emphasis regex O(n^2). Guard BOTH a
  // long *consecutive* run (PATHOLOGICAL_RUN) and the *total* marker count —
  // sparse "[a[a…" evades the run check but still backtracks. Such volumes never
  // occur in legitimate content — flag as corrupt and skip heavy work.
  if (
    en.length > MAX_CONTENT_CHARS ||
    th.length > MAX_CONTENT_CHARS ||
    (en.match(/[[*]/g) || []).length > MAX_INLINE_MARKERS ||
    (th.match(/[[*]/g) || []).length > MAX_INLINE_MARKERS ||
    PATHOLOGICAL_RUN.test(en) ||
    PATHOLOGICAL_RUN.test(th)
  ) {
    return finalize(
      [
        {
          id: "content_sane",
          severity: CONFIG.rules.content_sane.severity,
          ok: false,
        },
      ],
      now,
    );
  }

  // 1. th_nonempty — Thai title & content present.
  const tThEmpty = !title_th || !title_th.trim();
  const cThEmpty = !th.trim();
  add(
    "th_nonempty",
    !(tThEmpty || cThEmpty),
    tThEmpty && cThEmpty
      ? "both"
      : tThEmpty
        ? "title"
        : cThEmpty
          ? "content"
          : undefined,
  );

  // 2. title_translated — the title must not be left byte-identical to English.
  const titleIdentical =
    (title_th || "").trim().length > 0 &&
    (title_th || "").trim() === (title_en || "").trim();
  add("title_translated", !titleIdentical);

  // 3. th_translated — body not identical to English, and actually in Thai.
  const identical = th.trim().length > 0 && th.trim() === en.trim();
  const tr = thaiRatio(th);
  const lowThai =
    tr.letters >= THAI_RATIO_MIN_LETTERS && tr.ratio < THAI_RATIO_MIN;
  add(
    "th_translated",
    !identical && !lowThai,
    identical ? "identical" : lowThai ? "lowThai" : undefined,
    lowThai ? { ratioPct: (tr.ratio * 100).toFixed(0) } : undefined,
  );

  // 4. link_set — every DISTINCT destination URL in EN must be present in TH and
  //    vice-versa (URLs are never translated). A dropped/added/mutated
  //    destination is corruption. NOTE (known limit): this cannot verify which
  //    anchor text wraps which URL — a label↔URL swap that preserves the URL set
  //    is invisible here.
  const enLinks = collectLinks(en);
  const thLinks = collectLinks(th);
  const enSet = new Set(enLinks);
  const thSet = new Set(thLinks);
  const missing = [...enSet].filter((u) => !thSet.has(u));
  const extra = [...thSet].filter((u) => !enSet.has(u));
  const linksOk = missing.length === 0 && extra.length === 0;
  add(
    "link_set",
    linksOk,
    undefined,
    linksOk
      ? undefined
      : { missingCount: missing.length, extraCount: extra.length },
  );

  // 5. link_count (warn) — same destinations but a different NUMBER of link
  //    occurrences (e.g. Gemini consolidated a URL repeated twice). Not an error
  //    (no destination lost), but worth a reviewer's glance.
  const countOk = !linksOk || enLinks.length === thLinks.length;
  add(
    "link_count",
    countOk,
    undefined,
    countOk ? undefined : { enCount: enLinks.length, thCount: thLinks.length },
  );

  // 5b. image_set — every DISTINCT image URL in EN must be present in TH and
  //     vice-versa. Image URLs, like link destinations, are never translated, so a
  //     dropped/added/mutated one is corruption. The shared inline regex never sees
  //     image URLs (image blocks are alt-only there), so this is their own guard —
  //     the link_set analogue for `![alt](url)` blocks.
  const enImages = collectImages(en);
  const thImages = collectImages(th);
  const enImgSet = new Set(enImages);
  const thImgSet = new Set(thImages);
  const imgMissing = [...enImgSet].filter((u) => !thImgSet.has(u));
  const imgExtra = [...thImgSet].filter((u) => !enImgSet.has(u));
  const imagesOk = imgMissing.length === 0 && imgExtra.length === 0;
  add(
    "image_set",
    imagesOk,
    undefined,
    imagesOk
      ? undefined
      : { missingCount: imgMissing.length, extraCount: imgExtra.length },
  );

  // 6. markdown_balance — DIFFERENTIAL: flag only orphan markers / unrenderable
  //    links that TH introduced beyond EN. Symmetric literal asterisks (a
  //    footnote or masked name present in both sides) are intended content, not
  //    a translation defect; a marker that appears only in TH (incl. one hiding
  //    inside translated link text) renders as a literal and is real corruption.
  const enRes = markdownResidue(en);
  const thRes = markdownResidue(th);
  const introducedStar = thRes.star > enRes.star;
  const introducedLink = thRes.link > enRes.link;
  const balOk = !introducedStar && !introducedLink;
  add(
    "markdown_balance",
    balOk,
    balOk
      ? undefined
      : introducedStar && introducedLink
        ? "both"
        : introducedStar
          ? "star"
          : "link",
    balOk
      ? undefined
      : {
          starCount: thRes.star - enRes.star,
          linkCount: thRes.link - enRes.link,
        },
  );

  // 7. heading_skeleton — heading count & level sequence must match. NOTE (known
  //    limit): heading TEXT and heading↔body association are not checked.
  const enHeads = headingLevels(en);
  const thHeads = headingLevels(th);
  const headOk = sameSeq(enHeads, thHeads);
  add(
    "heading_skeleton",
    headOk,
    undefined,
    headOk
      ? undefined
      : {
          enHeads: enHeads.join(",") || "none",
          thHeads: thHeads.join(",") || "none",
        },
  );

  // 8. th_untranslated_block (warn) — a substantial block left mostly in Latin.
  //    Catches an embedded untranslated paragraph the whole-body ratio misses.
  const untranslated = untranslatedBlockCount(th);
  add(
    "th_untranslated_block",
    untranslated === 0,
    undefined,
    untranslated === 0 ? undefined : { count: untranslated },
  );

  // 9. block_drift (warn) — Gemini may merge/split blocks; informational.
  const enBlocks = blockTypes(en);
  const thBlocks = blockTypes(th);
  const driftOk = sameSeq(enBlocks, thBlocks);
  add(
    "block_drift",
    driftOk,
    undefined,
    driftOk
      ? undefined
      : {
          enCount: enBlocks.length,
          enSummary: summarizeCounts(enBlocks),
          thCount: thBlocks.length,
          thSummary: summarizeCounts(thBlocks),
        },
  );

  // 10. length_ratio (warn) — gross truncation/duplication. NOTE: faithful Thai
  //     is already ~0.5-0.6 of EN (no inter-word spaces), so this is a coarse
  //     hint, not a coverage guarantee; real coverage needs the offline audit.
  const enLen = compactLen(en);
  const thLen = compactLen(th);
  const lr = enLen > 0 ? thLen / enLen : 1;
  const lrOk = enLen === 0 || (lr >= LEN_RATIO_MIN && lr <= LEN_RATIO_MAX);
  add(
    "length_ratio",
    lrOk,
    undefined,
    lrOk ? undefined : { ratio: lr.toFixed(2) },
  );

  // 10b. severe_truncation (error) — a body far below any faithful Thai ratio is
  //      a truncated reply (Gemini early-STOP), not a short translation. Unlike
  //      the lenient length_ratio warn band, this flips status=FAILED so the
  //      translate route's retry loop re-calls. Reuses lr/enLen — no recompute.
  const truncOk = enLen === 0 || lr >= SEVERE_TRUNCATION_MAX;
  add(
    "severe_truncation",
    truncOk,
    undefined,
    truncOk ? undefined : { ratio: lr.toFixed(2) },
  );

  // 11. parser_completeness (warn) — only when a source body length is supplied.
  if (typeof sourceTextLength === "number" && sourceTextLength > 0) {
    const cr = compactLen(en) / sourceTextLength;
    const crOk = cr >= COMPLETENESS_MIN;
    add(
      "parser_completeness",
      crOk,
      undefined,
      crOk ? undefined : { pct: (cr * 100).toFixed(0) },
    );
  }

  return finalize(checks, now);
}

function finalize(checks: ValidationCheck[], now: string): ValidationResult {
  const failing = checks.filter((c) => !c.ok);
  const status: "PASS" | "FAILED" = failing.some((c) => c.severity === "error")
    ? "FAILED"
    : "PASS";
  // statusDesc is rendered (errors first) from the same registry the UI uses,
  // for display/tests only — it is not persisted (see toStoredRecord).
  const statusDesc =
    failing.length === 0 ? "OK" : renderFailures(failing.map(toStoredFailure));
  return {
    status,
    statusDesc,
    checks,
    checkedAt: now,
    configVersion: CONFIG_VERSION,
  };
}

/**
 * Run the deterministic structural checks on one article's EN/TH content.
 * Pure and timestamp-free: pass `now` (an ISO string) to stamp checkedAt; tests
 * omit it. status is FAILED iff any error-severity check fails. Any unexpected
 * throw is caught and surfaced as a FAILED result, so a malformed input can
 * never crash the translate route or the audit script.
 */
export function validateArticle(
  input: ValidateInput,
  now = "",
): ValidationResult {
  try {
    return runChecks(input, now);
  } catch (e) {
    return finalize(
      [
        {
          id: "validator_error",
          // Hardcoded fallback so the failsafe never depends on a clean lookup.
          severity: CONFIG.rules.validator_error?.severity ?? "error",
          ok: false,
          vars: { error: (e as Error).message },
        },
      ],
      now,
    );
  }
}
