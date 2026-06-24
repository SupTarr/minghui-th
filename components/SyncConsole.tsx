"use client";

import type { RefObject } from "react";

function formatLogLine(log: string) {
  let timestamp = "";
  let message = log;
  const match = log.match(/^(\[[0-9:]{8}\])\s*(.*)$/);
  if (match) {
    timestamp = match[1];
    message = match[2];
  }

  let colorClass = "text-slate-300";
  if (
    message.includes("❌") ||
    message.includes("🛑") ||
    message.toLowerCase().includes("fail") ||
    message.includes("ล้มเหลว") ||
    message.includes("ข้อผิดพลาด")
  ) {
    colorClass = "text-rose-400";
  } else if (
    message.includes("⚠️") ||
    message.toLowerCase().includes("warn") ||
    message.includes("ยกเลิก")
  ) {
    colorClass = "text-amber-400";
  } else if (
    message.includes("✅") ||
    message.includes("🎉") ||
    message.includes("เสร็จสิ้น") ||
    message.includes("สำเร็จ")
  ) {
    colorClass = "text-teal-400 font-medium";
  } else if (
    message.includes("ℹ️") ||
    message.includes("กำลังเริ่มต้น") ||
    message.includes("กำลัง")
  ) {
    colorClass = "text-teal-500/90";
  }

  return (
    <div className="flex gap-2">
      {timestamp && (
        <span className="text-slate-500 shrink-0 select-none font-mono">
          {timestamp}
        </span>
      )}
      <span className={colorClass}>{message}</span>
    </div>
  );
}

interface SyncConsoleProps {
  archivedCount: number;
  newlyCount: number;
  hasDateFilter: boolean;
  logs: string[];
  statusMessage: string;
  progressPercent: number;
  isSyncing: boolean;
  logEndRef: RefObject<HTMLDivElement | null>;
}

export default function SyncConsole({
  archivedCount,
  newlyCount,
  hasDateFilter,
  logs,
  statusMessage,
  progressPercent,
  isSyncing,
  logEndRef,
}: SyncConsoleProps) {
  return (
    <section className="lg:col-span-3 space-y-6">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-teal-400 font-mono">
          แผงคอนโซลควบคุม
        </h2>
        <p className="text-3xs text-slate-500 font-sans mt-0.5">
          Workspace Operations & Execution Logs
        </p>
      </div>

      {/* Statistics Row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-xl bg-[#0c1220]/20 border border-slate-900 backdrop-blur-xs">
          <span className="text-4xs uppercase tracking-wider text-slate-500 font-mono">
            คลังบทความ
          </span>
          <p className="text-lg font-mono font-bold text-teal-400 mt-0.5">
            {archivedCount}
          </p>
          <span className="text-4xs text-slate-500 font-sans mt-0.5 block leading-none">
            {hasDateFilter ? "ในช่วงที่เลือก" : "ใน 7 วันล่าสุด"}
          </span>
        </div>
        <div className="p-3 rounded-xl bg-[#0c1220]/20 border border-slate-900 backdrop-blur-xs">
          <span className="text-4xs uppercase tracking-wider text-slate-500 font-mono">
            แปลสำเร็จ
          </span>
          <p className="text-lg font-mono font-bold text-[#fda4af] mt-0.5">
            {newlyCount}
          </p>
          <span className="text-4xs text-slate-500 font-sans mt-0.5 block leading-none">
            ในเซสชันนี้
          </span>
        </div>
      </div>

      {/* Console / Log Terminal */}
      <div className="bg-[#060913] border border-slate-900 rounded-2xl overflow-hidden flex flex-col h-[320px] shadow-2xl relative">
        {/* Mac window header */}
        <div className="bg-[#0c1220]/85 px-4 py-1.5 border-b border-slate-900/60 flex justify-between items-center backdrop-blur-sm">
          <div className="flex gap-1.5">
            <span className="w-2 rounded-full h-2 bg-rose-500/40 border border-rose-500/20" />
            <span className="w-2 rounded-full h-2 bg-amber-500/40 border border-amber-500/20" />
            <span className="w-2 rounded-full h-2 bg-emerald-500/40 border border-emerald-500/20" />
          </div>
          <span className="text-4xs text-slate-500 font-mono tracking-wide uppercase">
            live_operation.sh
          </span>
          <span className="w-8" />
        </div>

        <div className="p-3 flex-1 overflow-y-auto font-mono text-4xs space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800 bg-[#060913]">
          {logs.length === 0 ? (
            <div className="text-slate-600 italic font-sans text-3xs">
              รอเริ่มการซิงค์ข้อมูล... กรุณากดปุ่ม &quot;ซิงค์ข้อมูลระบบ&quot;
              ในแผงควบคุมขวา
            </div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className="leading-relaxed">
                {formatLogLine(log)}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>

        {/* Progress Bar */}
        {isSyncing && (
          <div className="bg-[#0c1220]/60 border-t border-slate-900 px-4 py-2.5 backdrop-blur-xs">
            <div className="flex justify-between items-center text-4xs mb-1.5">
              <span className="truncate max-w-[80%] text-slate-400 font-sans tracking-wide">
                {statusMessage}
              </span>
              <span className="font-mono text-teal-400 font-bold">
                {progressPercent}%
              </span>
            </div>
            <div className="w-full bg-[#060913] rounded-full h-1 border border-slate-900 overflow-hidden">
              <div
                className="bg-linear-to-r from-teal-400 via-emerald-400 to-indigo-500 h-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
