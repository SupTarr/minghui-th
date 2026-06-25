"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { ArticleDetails } from "@/components/types";
import { createInlineRegex } from "../lib/contentValidation";

// Parses inline markdown — **bold**, *italic*, [text](url) — plus \n line breaks
// within a block, returning React nodes. The block-level parser (renderContent)
// strips the block prefix, then hands the remainder here. Each emphasis/link
// capture is rendered by recursing, so markup nested inside another marker —
// e.g. a link inside italics, *[Zhuan Falun](url)* — is resolved instead of
// printed as literal text.
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Shared with the validator so "what renders" == "what is validated".
  const re = createInlineRegex();
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  const pushText = (s: string) => {
    s.split("\n").forEach((part, i) => {
      if (i > 0) out.push(<br key={`br${key++}`} />);
      if (part) out.push(part);
    });
  };
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) pushText(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(
        <strong key={`bi${key++}`} className="font-semibold text-slate-100">
          <em>{renderInline(m[1])}</em>
        </strong>,
      );
    } else if (m[2] !== undefined) {
      out.push(
        <strong key={`b${key++}`} className="font-semibold text-slate-100">
          {renderInline(m[2])}
        </strong>,
      );
    } else if (m[3] !== undefined) {
      out.push(<em key={`i${key++}`}>{renderInline(m[3])}</em>);
    } else {
      out.push(
        <a
          key={`a${key++}`}
          href={m[5]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-400 underline decoration-dotted underline-offset-2 hover:text-indigo-300"
        >
          {renderInline(m[4])}
        </a>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) pushText(text.slice(last));
  return out;
}

// Parses markdown structures (headings, blockquotes, bullet lists, code blocks)
// and renders styled elements.
function renderContent(content: string, lang: "th" | "en") {
  return content.split("\n\n").map((para, idx) => {
    // 1. Headings
    if (para.startsWith("# ")) {
      return (
        <h1
          key={idx}
          className="text-2xl sm:text-3xl font-display font-bold tracking-tight mt-10 mb-4 text-slate-100 border-b border-slate-900/60 pb-3"
        >
          {renderInline(para.replace(/^#\s+/, ""))}
        </h1>
      );
    }
    if (para.startsWith("## ")) {
      return (
        <h2
          key={idx}
          className="text-xl sm:text-2xl font-display font-bold tracking-tight mt-8 mb-4 text-slate-100"
        >
          {renderInline(para.replace(/^##\s+/, ""))}
        </h2>
      );
    }
    if (para.startsWith("### ")) {
      return (
        <h3
          key={idx}
          className={`text-lg sm:text-xl font-display font-bold tracking-tight mt-6 mb-3 ${
            lang === "th" ? "text-teal-400" : "text-indigo-400"
          }`}
        >
          {renderInline(para.replace(/^###\s+/, ""))}
        </h3>
      );
    }
    if (para.startsWith("#### ")) {
      return (
        <h4
          key={idx}
          className="text-base sm:text-lg font-display font-bold tracking-tight mt-6 mb-3 text-slate-200"
        >
          {renderInline(para.replace(/^####\s+/, ""))}
        </h4>
      );
    }

    // 2. Blockquotes (Gold-tinted Zen style)
    if (para.startsWith("> ")) {
      return (
        <blockquote
          key={idx}
          className="border-l-2 border-amber-500/40 bg-[#0c1220]/25 px-6 py-4 my-6 rounded-r-xl italic text-slate-300 font-sans text-sm sm:text-base leading-loose"
        >
          {renderInline(para.replace(/^>\s?/gm, ""))}
        </blockquote>
      );
    }

    // 3. Bullet points / Lists
    if (para.startsWith("- ")) {
      return (
        <ul key={idx} className="list-disc pl-8 mb-3 space-y-1">
          <li
            className={`text-sm sm:text-base ${
              lang === "en"
                ? "text-slate-300 font-sans leading-relaxed"
                : "text-slate-200 font-sans leading-loose"
            }`}
          >
            {renderInline(para.replace(/^-\s+/, ""))}
          </li>
        </ul>
      );
    }

    // 4. Code Blocks
    if (para.startsWith("```")) {
      const codeText = para.replace(/```[a-z]*\n?/g, "").replace(/```$/g, "");
      return (
        <pre
          key={idx}
          className="bg-[#0c1220]/60 border border-slate-900 p-4 rounded-xl overflow-x-auto text-3xs font-mono my-5 text-teal-400/90 leading-relaxed"
        >
          <code>{codeText}</code>
        </pre>
      );
    }

    // 5. Horizontal rule (a normalized decorative scene break)
    if (/^-{3,}$/.test(para.trim())) {
      return <hr key={idx} className="my-8 border-t border-slate-800/70" />;
    }

    // 6. Standard Paragraph (Typographically tuned)
    return (
      <p
        key={idx}
        className={`indent-8 mb-5 text-sm sm:text-base ${
          lang === "en"
            ? "text-slate-300 font-sans leading-relaxed"
            : "text-slate-100 font-sans leading-loose"
        }`}
      >
        {renderInline(para)}
      </p>
    );
  });
}

interface ArticleReaderProps {
  articleContent: ArticleDetails | null;
  isLoadingArticle: boolean;
  articleError: boolean;
  readerLanguage: "th" | "en" | "both";
  setReaderLanguage: (lang: "th" | "en" | "both") => void;
  closeArticle: () => void;
  handleCopyShareLink: () => void;
  copied: boolean;
}

export default function ArticleReader({
  articleContent,
  isLoadingArticle,
  articleError,
  readerLanguage,
  setReaderLanguage,
  closeArticle,
  handleCopyShareLink,
  copied,
}: ArticleReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Hold the latest closeArticle so the mount-only effect calls the current one
  // without re-running (the parent re-renders often and passes a new identity).
  // Updated in an effect, not during render, per the react-hooks/refs rule.
  const closeRef = useRef(closeArticle);
  useEffect(() => {
    closeRef.current = closeArticle;
  });

  // Make the overlay a proper modal dialog: move focus in on open, trap Tab
  // inside it, close on Escape, lock body scroll, and restore focus on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const activeInside = active ? container.contains(active) : false;
      if (!activeInside) {
        // Focus drifted out of the dialog (e.g. to <body> after clicking
        // selectable body text); a default Tab would land on the background
        // controls still mounted behind the overlay. Pull it back in. Guarding
        // only on Tab (not via focusin) keeps mouse text-selection uninterrupted.
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
    // Mount/unmount only — closeArticle is read via closeRef to avoid re-running
    // (which would steal focus on every parent re-render). Only stable refs are
    // referenced, so the empty dep list is exhaustive.
  }, []);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="ตัวอ่านบทความ"
      className="fixed inset-0 z-50 bg-[#060913]/98 overflow-y-auto backdrop-blur-xl flex flex-col animate-fade-in select-text"
    >
      {/* Reader Header */}
      <div className="sticky top-0 bg-[#060913]/90 border-b border-slate-900/60 backdrop-blur-md z-30 px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between font-sans">
          <button
            type="button"
            ref={closeButtonRef}
            onClick={closeArticle}
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors font-semibold cursor-pointer"
          >
            <svg
              aria-hidden="true"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            กลับหน้าหลัก
          </button>

          {articleContent && (
            <div
              role="group"
              aria-label="เลือกภาษาที่แสดง"
              className="flex bg-[#060913] p-1 border border-slate-900 rounded-xl text-3xs font-mono"
            >
              <button
                type="button"
                aria-pressed={readerLanguage === "th"}
                onClick={() => setReaderLanguage("th")}
                className={`px-3 py-1.5 rounded-lg transition-all font-semibold cursor-pointer ${
                  readerLanguage === "th"
                    ? "bg-teal-500 text-slate-950 font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                ภาษาไทย
              </button>
              <button
                type="button"
                aria-pressed={readerLanguage === "en"}
                onClick={() => setReaderLanguage("en")}
                className={`px-3 py-1.5 rounded-lg transition-all font-semibold cursor-pointer ${
                  readerLanguage === "en"
                    ? "bg-teal-500 text-slate-950 font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                English
              </button>
              <button
                type="button"
                aria-pressed={readerLanguage === "both"}
                onClick={() => setReaderLanguage("both")}
                className={`px-3 py-1.5 rounded-lg transition-all font-semibold cursor-pointer ${
                  readerLanguage === "both"
                    ? "bg-teal-500 text-slate-950 font-bold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                อ่านควบคู่
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleCopyShareLink}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-2xs font-semibold bg-[#0c1220] border border-slate-900 text-teal-400 hover:text-teal-300 hover:bg-[#0c1220]/80 transition-all duration-200 active:scale-95 cursor-pointer"
          >
            {copied ? (
              <>
                <svg
                  aria-hidden="true"
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>คัดลอกแล้ว!</span>
              </>
            ) : (
              <>
                <svg
                  aria-hidden="true"
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
                  />
                </svg>
                <span>ลิงก์สำหรับแชร์</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Reader Content Container */}
      <div className="flex-1 max-w-5xl w-full mx-auto px-4 py-8 sm:px-6 lg:px-8 relative">
        {/* Watermark Lotus Flower in background */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02] select-none">
          <svg
            aria-hidden="true"
            className="w-[500px] h-[500px]"
            viewBox="0 0 100 100"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          >
            <path d="M50 80 C15 70, 10 40, 50 20 C90 40, 85 70, 50 80 Z" />
            <path d="M50 80 C20 75, 20 45, 50 35 C80 45, 80 75, 50 80 Z" />
            <path d="M50 80 C32 75, 32 50, 50 42 C68 50, 68 75, 50 80 Z" />
          </svg>
        </div>

        {isLoadingArticle ? (
          <div className="h-[60vh] flex flex-col items-center justify-center text-slate-500 space-y-4 relative z-10 font-sans">
            <svg
              aria-hidden="true"
              className="animate-spin h-8 w-8 text-teal-500"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <p className="text-3xs uppercase tracking-wider text-slate-400 font-mono">
              กำลังโหลดเนื้อหาจาก Drive...
            </p>
          </div>
        ) : articleContent ? (
          <article className="space-y-8 relative z-10">
            {/* Metadata Header */}
            <div className="border-b border-slate-900/60 pb-6 space-y-4 font-sans">
              <div className="flex flex-wrap items-center gap-2 text-3xs font-mono font-semibold">
                <span className="bg-amber-500/10 text-amber-400 px-2.5 py-0.5 rounded-md border border-amber-500/15">
                  {articleContent.published_date}
                </span>
                <span className="bg-indigo-500/10 text-indigo-400 px-2.5 py-0.5 rounded-md border border-indigo-500/15">
                  {articleContent.category}
                </span>
                <a
                  href={articleContent.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 hover:text-teal-400 underline transition-colors"
                >
                  ดูบทความต้นฉบับ (Minghui.org)
                </a>
              </div>

              {readerLanguage !== "en" && (
                <h1 className="text-3xl font-extrabold text-slate-100 tracking-tight leading-tight">
                  {articleContent.title_th}
                </h1>
              )}
              {readerLanguage !== "th" && (
                <h2
                  className={`text-slate-300 tracking-tight leading-tight ${readerLanguage === "en" ? "text-3xl font-extrabold" : "text-lg italic text-slate-400"}`}
                >
                  {articleContent.title_en}
                </h2>
              )}
            </div>

            {/* Body Text */}
            <div className="prose prose-invert max-w-none text-slate-200">
              {readerLanguage === "both" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 divide-y md:divide-y-0 md:divide-x divide-slate-800">
                  {/* Thai content */}
                  <div className="space-y-6 text-base leading-relaxed pr-0 md:pr-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-teal-400 mb-4 font-mono">
                      ภาษาไทย
                    </h3>
                    {renderContent(articleContent.content_th, "th")}
                  </div>
                  {/* English content */}
                  <div className="space-y-6 text-base leading-relaxed pl-0 md:pl-8 pt-6 md:pt-0">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-400 mb-4 font-mono">
                      English
                    </h3>
                    {renderContent(articleContent.content_en, "en")}
                  </div>
                </div>
              ) : (
                <div className="max-w-3xl mx-auto space-y-6 text-lg leading-relaxed">
                  {readerLanguage === "th"
                    ? renderContent(articleContent.content_th, "th")
                    : renderContent(articleContent.content_en, "en")}
                </div>
              )}
            </div>
          </article>
        ) : (
          <div className="py-20 text-center text-slate-500 border border-dashed border-slate-800 rounded-2xl">
            <p className="text-sm">
              {articleError
                ? "โหลดบทความไม่สำเร็จ — โปรดลองอีกครั้ง"
                : "ไม่พบข้อมูลของบทความนี้"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
