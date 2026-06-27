"use client";

import DateRangePicker from "@/components/DateRangePicker";
import LotusFlower from "@/components/LotusFlower";

interface SyncControlsProps {
  isSyncing: boolean;
  progressPercent: number;
  startDate: string;
  setStartDate: (date: string) => void;
  endDate: string;
  setEndDate: (date: string) => void;
  userEmail: string | null;
  isCancelling: boolean;
  handleSync: () => void;
  handleCancel: () => void;
  handleSignOut: () => void;
  importUrl: string;
  setImportUrl: (url: string) => void;
  isImporting: boolean;
  handleImportUrl: () => void;
}

export default function SyncControls({
  isSyncing,
  progressPercent,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  userEmail,
  isCancelling,
  handleSync,
  handleCancel,
  handleSignOut,
  importUrl,
  setImportUrl,
  isImporting,
  handleImportUrl,
}: SyncControlsProps) {
  return (
    <section className="lg:col-span-3 space-y-6">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-teal-400 font-mono">
          ศูนย์ควบคุมการซิงค์
        </h2>
        <p className="text-3xs text-slate-500 font-sans mt-0.5">
          Control Panel & Synchronizer
        </p>
      </div>

      <div className="p-6 bg-[#0c1220]/30 border border-slate-900 rounded-2xl backdrop-blur-md flex flex-col items-center justify-between shadow-xl relative z-20">
        {/* Lotus Orbit Signature Component */}
        <div className="py-2 w-full">
          <LotusFlower active={isSyncing} progress={progressPercent} />
        </div>

        {/* System State Info Description */}
        <div className="text-center w-full px-2 mb-6">
          {!isSyncing ? (
            <p className="text-2xs text-slate-400 leading-relaxed font-sans">
              ระบบพร้อมสำหรับการเริ่มดึงข้อมูล (Scraping) แปลความด้วย AI (Gemini
              Translator) และนำเข้าบัญชีจัดเก็บ Google Drive ของระบบแบบเรียลไทม์
            </p>
          ) : (
            <p className="text-3xs text-teal-400 animate-pulse font-mono uppercase tracking-widest font-bold">
              กำลังดึงและถอดความสัมพันธ์...
            </p>
          )}
        </div>

        {/* Date Filter & Control Buttons */}
        <div className="w-full space-y-4">
          {/* Calendar Trigger */}
          <div className="space-y-1.5 relative w-full">
            <label className="block text-4xs font-bold text-slate-500 uppercase tracking-widest font-mono">
              เลือกตัวกรองวันที่ดึงข้อมูล
            </label>
            <DateRangePicker
              startDate={startDate}
              setStartDate={setStartDate}
              endDate={endDate}
              setEndDate={setEndDate}
              disabled={isSyncing || isImporting}
              align="right"
              size="md"
            />
          </div>

          {/* Sync action controls. This whole panel mounts only when an allowed
              admin is signed in (gated in app/page.tsx); the Google sign-in button
              lives in the header for logged-out visitors. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-[#060913] border border-slate-900 px-3.5 py-2.5 rounded-xl text-3xs">
              <div className="flex items-center gap-1.5 truncate max-w-[70%]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-opacity" />
                <span className="text-slate-300 font-mono truncate">
                  {userEmail}
                </span>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="text-rose-400 hover:text-rose-300 font-bold cursor-pointer transition-colors"
              >
                Sign Out
              </button>
            </div>

            {/* Import a single article by pasting its URL. */}
            <div className="space-y-1.5">
              <label className="block text-4xs font-bold text-slate-500 uppercase tracking-widest font-mono">
                นำเข้าบทความจากลิงก์
              </label>
              <input
                type="url"
                inputMode="url"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleImportUrl();
                  }
                }}
                disabled={isImporting || isSyncing}
                placeholder="https://en.minghui.org/html/articles/..."
                className="w-full bg-[#060913] border border-slate-900 rounded-xl px-4 py-2.5 text-xs text-slate-300 placeholder:text-slate-600 hover:border-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-mono"
              />
              <button
                type="button"
                onClick={handleImportUrl}
                disabled={isImporting || isSyncing || !importUrl.trim()}
                className="w-full py-2.5 px-4 rounded-xl font-bold text-xs shadow-lg transition-all duration-300 flex items-center justify-center gap-2 bg-indigo-500 text-white hover:bg-indigo-400 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer shadow-indigo-500/15 font-sans disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                {isImporting ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4 text-white"
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
                    กำลังนำเข้า...
                  </>
                ) : (
                  <>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 4.5v15m7.5-7.5h-15"
                      />
                    </svg>
                    นำเข้าบทความ
                  </>
                )}
              </button>
            </div>

            {/* Divider between single-article import and the full sync */}
            <div className="border-t border-slate-900/80" />

            {isSyncing ? (
              <div className="flex gap-2 w-full">
                <button
                  disabled
                  className="flex-1 py-3 px-4 rounded-xl font-bold text-xs bg-slate-900 text-slate-500 border border-slate-900 flex items-center justify-center gap-2 cursor-not-allowed font-sans"
                >
                  <svg
                    className="animate-spin h-4 w-4 text-slate-500"
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
                  กำลังซิงค์...
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isCancelling}
                  className={`px-4 py-3 rounded-xl font-bold text-xs border transition-all duration-300 active:scale-95 cursor-pointer font-sans ${
                    isCancelling
                      ? "bg-rose-500/10 border-rose-500/20 text-rose-500/40 cursor-not-allowed"
                      : "bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/20 text-rose-400 hover:text-rose-200"
                  }`}
                >
                  {isCancelling ? "รอยกเลิก..." : "ยกเลิก"}
                </button>
              </div>
            ) : (
              <button
                onClick={handleSync}
                disabled={isImporting}
                className="w-full py-3 px-4 rounded-xl font-bold text-xs shadow-lg transition-all duration-300 flex items-center justify-center gap-2 bg-teal-500 text-slate-950 hover:bg-teal-400 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer shadow-teal-500/15 font-sans disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
                ซิงค์ข้อมูลระบบ
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
