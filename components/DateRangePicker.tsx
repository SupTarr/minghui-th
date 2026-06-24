"use client";

import { useState, useEffect, useRef } from "react";

interface DateRangePickerProps {
  startDate: string;
  setStartDate: (date: string) => void;
  endDate: string;
  setEndDate: (date: string) => void;
  disabled?: boolean;
  align?: "left" | "right";
  size?: "sm" | "md";
}

export default function DateRangePicker({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  disabled = false,
  align = "right",
  size = "md",
}: DateRangePickerProps) {
  const [viewDate, setViewDate] = useState<Date>(new Date());
  const [showCalendar, setShowCalendar] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);

  // Close calendar popover on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        calendarRef.current &&
        !calendarRef.current.contains(event.target as Node)
      ) {
        setShowCalendar(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Toggle the popover; when opening, jump to the selected start month
  const toggleCalendar = () => {
    if (disabled) return;
    if (!showCalendar && startDate) {
      const [y, m, d] = startDate.split("-").map(Number);
      setViewDate(new Date(y, m - 1, d));
    }
    setShowCalendar((open) => !open);
  };

  const monthNames = [
    "มกราคม",
    "กุมภาพันธ์",
    "มีนาคม",
    "เมษายน",
    "พฤษภาคม",
    "มิถุนายน",
    "กรกฎาคม",
    "สิงหาคม",
    "กันยายน",
    "ตุลาคม",
    "พฤศจิกายน",
    "ธันวาคม",
  ];

  const shortMonthNames = [
    "ม.ค.",
    "ก.พ.",
    "มี.ค.",
    "เม.ย.",
    "พ.ค.",
    "มิ.ย.",
    "ก.ค.",
    "ส.ค.",
    "ก.ย.",
    "ต.ค.",
    "พ.ย.",
    "ธ.ค.",
  ];

  const daysOfWeek = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

  function formatDateToString(date: Date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function formatThaiDateShort(dateStr: string) {
    if (!dateStr) return "ทั้งหมด (กรองตามวันที่)";
    const [y, m, d] = dateStr.split("-");
    const month = shortMonthNames[parseInt(m) - 1];
    return `${parseInt(d)} ${month} ${y}`;
  }

  // Format ranges (e.g. 16 มิ.ย. 2026 - 23 มิ.ย. 2026)
  function formatThaiDateRange(startStr: string, endStr: string) {
    if (!startStr) return "ทั้งหมด (ไม่มีกรอง)";
    const end = endStr || startStr;
    if (startStr === end) {
      return formatThaiDateShort(startStr);
    }
    return `${formatThaiDateShort(startStr)} - ${formatThaiDateShort(end)}`;
  }

  const getDaysDiff = (d1Str: string, d2Str: string) => {
    const d1 = new Date(d1Str);
    const d2 = new Date(d2Str);
    d1.setHours(0, 0, 0, 0);
    d2.setHours(0, 0, 0, 0);
    const diffTime = Math.abs(d2.getTime() - d1.getTime());
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
  };

  const getDaysInMonth = (year: number, month: number) =>
    new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) =>
    new Date(year, month, 1).getDay();

  const generateCalendarDays = () => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDayIndex = getFirstDayOfMonth(year, month);
    const prevMonthDays = getDaysInMonth(year, month - 1);

    const days: Array<{
      day: number;
      dateStr: string;
      isCurrentMonth: boolean;
    }> = [];

    // Days from previous month
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const prevDay = prevMonthDays - i;
      const prevDate = new Date(year, month - 1, prevDay);
      days.push({
        day: prevDay,
        dateStr: formatDateToString(prevDate),
        isCurrentMonth: false,
      });
    }

    // Days from current month
    for (let i = 1; i <= daysInMonth; i++) {
      const currentDate = new Date(year, month, i);
      days.push({
        day: i,
        dateStr: formatDateToString(currentDate),
        isCurrentMonth: true,
      });
    }

    // Days from next month (fill grid to 42 items)
    const totalGridItems = 42;
    const remainingDays = totalGridItems - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      const nextDate = new Date(year, month + 1, i);
      days.push({
        day: i,
        dateStr: formatDateToString(nextDate),
        isCurrentMonth: false,
      });
    }

    return days;
  };

  const handleDateClick = (dateStr: string) => {
    if (!startDate || (startDate && endDate)) {
      setStartDate(dateStr);
      setEndDate("");
    } else {
      if (dateStr < startDate) {
        setStartDate(dateStr);
      } else {
        setEndDate(dateStr);
        setShowCalendar(false);
      }
    }
  };

  const triggerText = startDate
    ? formatThaiDateRange(startDate, endDate)
    : size === "sm"
      ? "ทั้งหมด (ไม่มีกรอง)"
      : "ดึงทั้งหมด (ไม่มีกรอง)";

  return (
    <div className="relative w-full" ref={calendarRef}>
      {size === "sm" ? (
        <button
          type="button"
          disabled={disabled}
          onClick={toggleCalendar}
          className="bg-[#0c1220]/60 border border-slate-900 rounded-xl px-3 py-1.5 text-xs text-slate-350 hover:border-slate-800 focus:outline-none transition-all flex items-center gap-2 group cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg
            className="w-3.5 h-3.5 text-slate-555 group-hover:text-teal-400 transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className="text-3xs font-mono font-semibold text-teal-400">
            {triggerText}
          </span>
          <svg
            className={`w-3 h-3 text-slate-555 group-hover:text-slate-300 transition-transform duration-200 ${showCalendar ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={toggleCalendar}
          className="w-full bg-[#060913] border border-slate-900 rounded-xl px-4 py-2.5 text-xs text-slate-350 hover:border-slate-800 focus:outline-none transition-all flex items-center justify-between group disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-3.5 h-3.5 text-slate-555 group-hover:text-teal-400 transition-colors"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span
              className={
                startDate
                  ? "text-teal-400 font-semibold"
                  : "text-slate-500 font-medium"
              }
            >
              {triggerText}
            </span>
          </div>
          <svg
            className={`w-3.5 h-3.5 text-slate-555 group-hover:text-slate-300 transition-transform duration-200 ${showCalendar ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      )}

      {showCalendar && (
        <div
          className={`absolute top-[105%] ${align === "left" ? "left-0" : "right-0"} w-70 bg-[#0c1220]/95 border border-slate-900 rounded-2xl p-4 shadow-2xl backdrop-blur-lg z-30 animate-fade-in flex flex-col space-y-4`}
        >
          <div className="flex justify-between items-center">
            <button
              type="button"
              aria-label="เดือนก่อนหน้า"
              onClick={() =>
                setViewDate(
                  new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1),
                )
              }
              className="p-1.5 rounded-lg hover:bg-slate-900 text-slate-450 hover:text-slate-200 transition-colors cursor-pointer"
            >
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
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <span className="text-xs font-semibold text-slate-200 font-sans">
              {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
            </span>
            <button
              type="button"
              aria-label="เดือนถัดไป"
              onClick={() =>
                setViewDate(
                  new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1),
                )
              }
              className="p-1.5 rounded-lg hover:bg-slate-900 text-slate-450 hover:text-slate-200 transition-colors cursor-pointer"
            >
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
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-4xs font-semibold text-slate-555 uppercase tracking-widest font-mono">
            {daysOfWeek.map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {generateCalendarDays().map((item, idx) => {
              const isStart = startDate === item.dateStr;
              const isEnd = endDate === item.dateStr;
              const isInRange =
                startDate &&
                endDate &&
                item.dateStr > startDate &&
                item.dateStr < endDate;
              const isTod = formatDateToString(new Date()) === item.dateStr;
              const isDisabled =
                startDate &&
                !endDate &&
                item.dateStr > startDate &&
                getDaysDiff(startDate, item.dateStr) > 7;
              return (
                <button
                  key={idx}
                  type="button"
                  disabled={!!isDisabled}
                  aria-label={formatThaiDateShort(item.dateStr)}
                  aria-pressed={isStart || isEnd}
                  aria-current={isTod ? "date" : undefined}
                  onClick={() => handleDateClick(item.dateStr)}
                  className={`py-1 text-3xs rounded-md transition-colors cursor-pointer ${
                    isDisabled
                      ? "text-slate-800 opacity-20 cursor-not-allowed pointer-events-none"
                      : !item.isCurrentMonth
                        ? "text-slate-700 hover:bg-[#060913]"
                        : isStart || isEnd
                          ? "bg-teal-500 text-slate-950 font-bold"
                          : isInRange
                            ? "bg-teal-500/15 text-teal-300 font-medium"
                            : isTod
                              ? "bg-[#060913] text-teal-400 border border-teal-500/20"
                              : "text-slate-350 hover:bg-[#060913]"
                  }`}
                >
                  {item.day}
                </button>
              );
            })}
          </div>

          <div className="border-t border-slate-900 pt-3 flex justify-center items-center text-4xs font-semibold">
            <button
              type="button"
              onClick={() => {
                const today = new Date();
                const past = new Date();
                past.setDate(today.getDate() - 7);
                setStartDate(formatDateToString(past));
                setEndDate(formatDateToString(today));
                setShowCalendar(false);
              }}
              className="text-teal-400 hover:text-teal-350 transition-colors cursor-pointer"
            >
              7 วันล่าสุด
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
