"use client";

import type { RefObject } from "react";
import DateRangePicker from "@/components/DateRangePicker";
import type { Article } from "@/components/types";

interface ArchiveListProps {
  startDate: string;
  setStartDate: (date: string) => void;
  endDate: string;
  setEndDate: (date: string) => void;
  activeTab: "archived" | "newly-synced" | "needs-review";
  setActiveTab: (tab: "archived" | "newly-synced" | "needs-review") => void;
  archivedArticles: Article[];
  newlySynced: Article[];
  needsReview: Article[];
  listArticles: Article[];
  currentPage: number;
  setCurrentPage: (page: number) => void;
  pageSize: number;
  totalPages: number;
  loadingInitial: boolean;
  archiveError: boolean;
  onRetryArchive: () => void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  openArticle: (path: string) => void;
}

export default function ArchiveList({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  activeTab,
  setActiveTab,
  archivedArticles,
  newlySynced,
  needsReview,
  listArticles,
  currentPage,
  setCurrentPage,
  pageSize,
  totalPages,
  loadingInitial,
  archiveError,
  onRetryArchive,
  scrollContainerRef,
  openArticle,
}: ArchiveListProps) {
  function goToPage(page: number) {
    setCurrentPage(page);
    // Jump back to the top of the list so the new page starts in view.
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <section className="lg:col-span-6 flex flex-col space-y-4 lg:sticky lg:top-24 h-auto lg:h-[calc(100vh-140px)] min-h-[500px]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-teal-400 font-mono">
            คลังบทความ
          </h2>
          <p className="text-3xs text-slate-500 font-sans mt-0.5">
            Archive Library & Index Ledger
          </p>
        </div>
        <DateRangePicker
          startDate={startDate}
          setStartDate={setStartDate}
          endDate={endDate}
          setEndDate={setEndDate}
          align="left"
          size="sm"
        />
      </div>

      {/* Tab Toggles */}
      <div className="flex bg-[#0c1220]/60 p-1 border border-slate-900 rounded-xl">
        <button
          type="button"
          aria-pressed={activeTab === "archived"}
          onClick={() => setActiveTab("archived")}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeTab === "archived"
              ? "bg-[#14b8a6]/10 text-teal-400 font-bold border border-teal-500/15"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {startDate ? "ช่วงวันที่เลือก" : "7 วันล่าสุด"} (
          {archivedArticles.length})
        </button>
        <button
          type="button"
          aria-pressed={activeTab === "newly-synced"}
          onClick={() => setActiveTab("newly-synced")}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeTab === "newly-synced"
              ? "bg-[#14b8a6]/10 text-teal-400 font-bold border border-teal-500/15"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          แปลรอบนี้ ({newlySynced.length})
        </button>
        <button
          type="button"
          aria-pressed={activeTab === "needs-review"}
          onClick={() => setActiveTab("needs-review")}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
            activeTab === "needs-review"
              ? "bg-red-500/10 text-red-300 font-bold border border-red-500/20"
              : needsReview.length > 0
                ? "text-red-300/80 hover:text-red-200"
                : "text-slate-400 hover:text-slate-200"
          }`}
        >
          ต้องตรวจสอบ ({needsReview.length})
        </button>
      </div>

      {/* Scrollable list of articles */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto scrollbar-thin pr-1 space-y-3 pb-6"
      >
        {loadingInitial && activeTab === "archived" ? (
          <div className="h-[250px] flex flex-col items-center justify-center text-slate-500 space-y-3">
            <svg
              aria-hidden="true"
              className="animate-spin h-6 w-6 text-teal-500/70"
              viewBox="0 0 24 24"
              fill="none"
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
            <span className="text-3xs uppercase tracking-wider text-slate-500 font-mono">
              กำลังเชื่อมต่อข้อมูลคลัง...
            </span>
          </div>
        ) : activeTab === "archived" && archiveError ? (
          <div className="h-[200px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-red-500/30 rounded-2xl text-slate-400 space-y-3">
            <span className="text-xs font-sans text-red-300/90">
              โหลดคลังบทความไม่สำเร็จ — เซิร์ฟเวอร์ไม่ตอบสนอง
            </span>
            <button
              type="button"
              onClick={onRetryArchive}
              className="text-3xs font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg border border-teal-500/30 text-teal-400 hover:bg-teal-500/10 transition-colors cursor-pointer"
            >
              ลองอีกครั้ง
            </button>
          </div>
        ) : activeTab === "archived" && archivedArticles.length === 0 ? (
          <div className="h-[200px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-900 rounded-2xl text-slate-500">
            <span className="text-xs font-sans">
              {startDate
                ? "ไม่พบบทความสำหรับช่วงวันที่ระบุ"
                : "ไม่พบบทความในช่วง 7 วันล่าสุด — เลือกวันที่เพื่อดูย้อนหลัง"}
            </span>
          </div>
        ) : activeTab === "newly-synced" && newlySynced.length === 0 ? (
          <div className="h-[200px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-900 rounded-2xl text-slate-500">
            <span className="text-xs font-sans">
              ยังไม่มีบทความที่ดึงใหม่ในเซสชันนี้
            </span>
          </div>
        ) : activeTab === "needs-review" && needsReview.length === 0 ? (
          <div className="h-[200px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-900 rounded-2xl text-slate-500">
            <span className="text-xs font-sans">
              ไม่มีบทความที่ต้องตรวจสอบในช่วงนี้ — เนื้อหาผ่านการตรวจครบถ้วน
            </span>
          </div>
        ) : (
          <>
            {listArticles
              .slice((currentPage - 1) * pageSize, currentPage * pageSize)
              .map((article: Article, idx: number) => (
                <button
                  type="button"
                  key={article.filePath ?? article.url ?? idx}
                  disabled={!article.filePath}
                  onClick={() =>
                    article.filePath && openArticle(article.filePath)
                  }
                  className="w-full text-left p-4 rounded-xl bg-[#0c1220]/30 border border-slate-900 hover:border-teal-500/30 hover:bg-[#0c1220]/60 transition-all duration-300 group cursor-pointer shadow-xs active:scale-[0.99] animate-fade-in disabled:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-3xs font-mono bg-slate-900/80 px-2 py-0.5 rounded text-slate-400 border border-slate-800 shrink-0">
                        {article.date}
                      </span>
                      {article.category && (
                        <span className="text-3xs font-sans px-2 py-0.5 rounded bg-teal-500/10 text-teal-400/90 border border-teal-500/15 truncate">
                          {article.category}
                        </span>
                      )}
                      {article.status === "FAILED" && (
                        <span className="text-3xs font-mono px-2 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20 shrink-0">
                          ต้องตรวจ
                        </span>
                      )}
                    </div>
                    <svg
                      aria-hidden="true"
                      className="w-3.5 h-3.5 text-slate-600 group-hover:text-teal-400 transition-colors"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                      />
                    </svg>
                  </div>
                  <h3 className="text-sm font-display font-bold text-slate-100 leading-relaxed group-hover:text-teal-400 transition-colors line-clamp-2">
                    {article.title_th}
                  </h3>
                  <p className="text-3xs text-slate-500 font-sans line-clamp-1 mt-1.5 italic group-hover:text-slate-400 transition-colors">
                    {article.title_en}
                  </p>
                  {article.status === "FAILED" && article.statusDesc && (
                    <p className="text-3xs text-red-300/80 font-sans line-clamp-2 mt-2 leading-relaxed">
                      ⚠ {article.statusDesc}
                    </p>
                  )}
                </button>
              ))}
            {totalPages > 1 && (
              <div className="pt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="text-3xs font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg border border-slate-800 text-slate-400 hover:border-teal-500/30 hover:text-teal-400 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default disabled:hover:border-slate-800 disabled:hover:text-slate-400"
                >
                  ← ก่อนหน้า
                </button>
                <span className="text-3xs text-slate-500 font-mono uppercase tracking-wider shrink-0">
                  หน้า {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className="text-3xs font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg border border-slate-800 text-slate-400 hover:border-teal-500/30 hover:text-teal-400 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default disabled:hover:border-slate-800 disabled:hover:text-slate-400"
                >
                  ถัดไป →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
