"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

interface Article {
  url: string;
  title_en: string;
  title_th: string;
  date: string;
  filePath?: string;
}

interface ArticleDetails {
  published_date: string;
  category: string;
  url: string;
  title_th: string;
  title_en: string;
  content_th: string;
  content_en: string;
}

interface GoogleCredentialResponse {
  credential?: string;
}

interface WindowWithGoogle extends Window {
  google?: {
    accounts: {
      id: {
        initialize: (config: {
          client_id: string;
          callback: (response: GoogleCredentialResponse) => void;
        }) => void;
        renderButton: (
          element: HTMLElement,
          options: { theme: string; size: string },
        ) => void;
      };
    };
  };
}

function LotusFlower({
  active,
  progress,
}: {
  active: boolean;
  progress: number;
}) {
  return (
    <div className="relative w-32 h-32 flex items-center justify-center mx-auto mb-4 animate-float">
      {/* Glow behind the lotus */}
      <div
        className={`absolute inset-4 rounded-full blur-2xl transition-all duration-1000 ${
          active
            ? "bg-teal-500/25 shadow-[0_0_40px_rgba(20,184,166,0.4)] animate-pulse"
            : "bg-amber-500/[0.04] shadow-[0_0_20px_rgba(234,179,8,0.05)]"
        }`}
      />

      {/* Orbit Ring */}
      <svg
        className={`absolute inset-0 w-full h-full ${
          active ? "animate-spin" : "animate-pulse"
        }`}
        style={{ animationDuration: active ? "12s" : "4s" }}
        viewBox="0 0 100 100"
      >
        <circle
          className="text-slate-800/40"
          strokeWidth="1.5"
          stroke="currentColor"
          fill="transparent"
          r="44"
          cx="50"
          cy="50"
        />
        {active && (
          <circle
            className="text-teal-400/80 transition-all duration-300"
            strokeWidth="2"
            strokeDasharray={276.46}
            strokeDashoffset={276.46 - (276.46 * progress) / 100}
            strokeLinecap="round"
            stroke="currentColor"
            fill="transparent"
            r="44"
            cx="50"
            cy="50"
          />
        )}
      </svg>

      {/* Lotus Petals SVG */}
      <svg
        className={`w-16 h-16 transition-all duration-1000 ${
          active
            ? "text-teal-400 scale-105"
            : "text-slate-500 hover:text-teal-300"
        }`}
        viewBox="0 0 100 100"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        {/* Base leaves */}
        <path
          d="M50 78 C35 78, 25 72, 25 65 C25 58, 35 55, 50 55 C65 55, 75 58, 75 65 C75 72, 65 78, 50 78 Z"
          fill="currentColor"
          fillOpacity="0.05"
        />

        {/* Outer Petals */}
        <path
          d="M50 80 C15 70, 10 40, 50 20 C90 40, 85 70, 50 80 Z"
          fill="currentColor"
          fillOpacity={active ? 0.12 : 0.03}
        />

        {/* Left/Right Petals */}
        <path
          d="M50 80 C20 75, 20 45, 50 35 C80 45, 80 75, 50 80 Z"
          fill="currentColor"
          fillOpacity={active ? 0.1 : 0.02}
        />

        {/* Center Petals */}
        <path
          d="M50 80 C32 75, 32 50, 50 42 C68 50, 68 75, 50 80 Z"
          fill="currentColor"
          fillOpacity={active ? 0.18 : 0.04}
        />

        {/* Core Bud */}
        <path
          d="M50 80 C40 75, 40 60, 50 50 C60 60, 60 75, 50 80 Z"
          fill="currentColor"
          fillOpacity={active ? 0.3 : 0.08}
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}

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

export default function Dashboard() {
  const [archivedArticles, setArchivedArticles] = useState<Article[]>([]);
  const [newlySynced, setNewlySynced] = useState<Article[]>([]);
  const [activeTab, setActiveTab] = useState<"archived" | "newly-synced">(
    "archived",
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [newCount, setNewCount] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>("");

  // Pagination for the archive list — render in chunks so a large catalog
  // (1000+ articles) doesn't mount thousands of card nodes at once.
  const PAGE_SIZE = 60;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const listArticles = useMemo(() => {
    // The archive list is already date-scoped by the server fetch, so the
    // "archived" tab renders it as-is; the other tab is this session's results.
    return activeTab === "newly-synced" ? newlySynced : archivedArticles;
  }, [activeTab, archivedArticles, newlySynced]);

  // Reset paging whenever the view (tab or date filter) changes. Done during
  // render (not in an effect) per React's "adjusting state on prop change"
  // guidance, so it applies before paint without an extra commit.
  const viewKey = `${activeTab}|${selectedDate}`;
  const [prevViewKey, setPrevViewKey] = useState(viewKey);
  if (viewKey !== prevViewKey) {
    setPrevViewKey(viewKey);
    setVisibleCount(PAGE_SIZE);
  }

  // Reveal the next chunk as the sentinel scrolls into view
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((c) => (c < listArticles.length ? c + PAGE_SIZE : c));
        }
      },
      { root: scrollContainerRef.current, rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [listArticles.length, visibleCount]);

  const [readingArticlePath, setReadingArticlePath] = useState<string | null>(
    null,
  );
  const [articleContent, setArticleContent] = useState<ArticleDetails | null>(
    null,
  );
  const [isLoadingArticle, setIsLoadingArticle] = useState(false);
  const [readerLanguage, setReaderLanguage] = useState<"th" | "en" | "both">(
    "th",
  );

  const isCancelledRef = useRef(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const addLog = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setLogs((prev) => [...prev, `[${time}] ${message}`]);
  }, []);

  function handleCancel() {
    isCancelledRef.current = true;
    setIsCancelling(true);
    addLog("⚠️ ร้องขอการยกเลิกกระบวนการจากผู้ใช้...");
    setStatusMessage("กำลังยกเลิกกระบวนการ...");
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }

  function openArticle(path: string) {
    setReadingArticlePath(path);
    const params = new URLSearchParams(window.location.search);
    params.set("article", path);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState({ path: newUrl }, "", newUrl);
  }

  function closeArticle() {
    setReadingArticlePath(null);
    const params = new URLSearchParams(window.location.search);
    params.delete("article");
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.pushState({ path: newUrl }, "", newUrl);
  }

  const [copied, setCopied] = useState(false);
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  function handleGoogleLoginResponse(response: GoogleCredentialResponse) {
    const idToken = response.credential;
    if (!idToken) return;
    setGoogleIdToken(idToken);

    try {
      const payload = JSON.parse(atob(idToken.split(".")[1]));
      setUserEmail(payload.email);
      localStorage.setItem("google_id_token", idToken);
      localStorage.setItem("google_user_email", payload.email);
    } catch (e) {
      console.error("Failed to parse ID token payload", e);
    }
  }

  function handleSignOut() {
    setGoogleIdToken(null);
    setUserEmail(null);
    localStorage.removeItem("google_id_token");
    localStorage.removeItem("google_user_email");
  }

  // Load Google Identity Services dynamically
  useEffect(() => {
    const token = localStorage.getItem("google_id_token");
    const email = localStorage.getItem("google_user_email");
    if (token && email) {
      setTimeout(() => {
        setGoogleIdToken(token);
        setUserEmail(email);
      }, 0);
    }

    fetch("/api/auth/config")
      .then((res) => res.json())
      .then((data) => {
        if (data.clientId) {
          const script = document.createElement("script");
          script.src = "https://accounts.google.com/gsi/client";
          script.async = true;
          script.defer = true;
          document.body.appendChild(script);

          script.onload = () => {
            const google = (window as unknown as WindowWithGoogle).google;
            if (google) {
              google.accounts.id.initialize({
                client_id: data.clientId,
                callback: handleGoogleLoginResponse,
              });

              const btn = document.getElementById("google-signin-btn");
              if (btn) {
                google.accounts.id.renderButton(btn, {
                  theme: "outline",
                  size: "large",
                });
              }
            }
          };
        }
      })
      .catch((err) => console.error("Failed to load auth config:", err));
  }, []);

  function handleCopyShareLink() {
    if (!readingArticlePath) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?article=${encodeURIComponent(readingArticlePath)}`;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const loadArticleContent = useCallback(
    async (path: string) => {
      try {
        setIsLoadingArticle(true);
        const res = await fetch(
          `/api/article?filePath=${encodeURIComponent(path)}`,
        );
        if (res.ok) {
          const data = await res.json();
          setArticleContent(data);
        } else {
          addLog(`❌ โหลดบทความล้มเหลว: ${path}`);
        }
      } catch (e) {
        console.error(e);
        addLog(`❌ เกิดข้อผิดพลาดในการโหลดบทความ: ${path}`);
      } finally {
        setIsLoadingArticle(false);
      }
    },
    [addLog],
  );

  // Fetch article content on path update
  useEffect(() => {
    if (readingArticlePath) {
      const path = readingArticlePath;
      setTimeout(() => {
        loadArticleContent(path);
      }, 0);
    } else {
      setTimeout(() => {
        setArticleContent(null);
      }, 0);
    }
  }, [readingArticlePath, loadArticleContent]);

  // Synchronize readingArticlePath with URL on mount & handle browser back/forward buttons
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const articleParam = params.get("article");
    if (articleParam) {
      setTimeout(() => {
        setReadingArticlePath(articleParam);
      }, 0);
    }

    function handlePopState() {
      const p = new URLSearchParams(window.location.search);
      const art = p.get("article");
      setReadingArticlePath(art || null);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Custom Datepicker state and helper logic
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

  // Parses markdown structures (headings, blockquotes, bullet lists, code blocks) and renders styled elements
  function renderContent(content: string, lang: "th" | "en") {
    return content.split("\n\n").map((para, idx) => {
      // 1. Headings
      if (para.startsWith("# ")) {
        return (
          <h1
            key={idx}
            className="text-2xl sm:text-3xl font-display font-bold tracking-tight mt-10 mb-4 text-slate-100 border-b border-slate-900/60 pb-3"
          >
            {para.replace(/^#\s+/, "")}
          </h1>
        );
      }
      if (para.startsWith("## ")) {
        return (
          <h2
            key={idx}
            className="text-xl sm:text-2xl font-display font-bold tracking-tight mt-8 mb-4 text-slate-100"
          >
            {para.replace(/^##\s+/, "")}
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
            {para.replace(/^###\s+/, "")}
          </h3>
        );
      }
      if (para.startsWith("#### ")) {
        return (
          <h4
            key={idx}
            className="text-base sm:text-lg font-display font-bold tracking-tight mt-6 mb-3 text-slate-200"
          >
            {para.replace(/^####\s+/, "")}
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
            {para.replace(/^>\s+/, "")}
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
                  ? "text-slate-350 font-sans leading-relaxed"
                  : "text-slate-200 font-sans leading-loose"
              }`}
            >
              {para.replace(/^-\s+/, "")}
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

      // 5. Standard Paragraph (Typographically tuned)
      return (
        <p
          key={idx}
          className={`indent-8 mb-5 text-sm sm:text-base ${
            lang === "en"
              ? "text-slate-350 font-sans leading-relaxed"
              : "text-slate-100 font-sans leading-loose"
          }`}
        >
          {para}
        </p>
      );
    });
  }

  const logEndRef = useRef<HTMLDivElement>(null);

  // Fetches the archive for a date range. With no date, loads the last 7 days;
  // with a date, loads just that day. The catalog is date-partitioned, so the
  // server only reads the relevant per-day indexes (never the whole archive).
  const fetchArchivedArticles = useCallback(
    async (date?: string) => {
      try {
        setLoadingInitial(true);
        const fmt = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
            d.getDate(),
          ).padStart(2, "0")}`;

        let from: string;
        let to: string;
        if (date) {
          from = to = date;
        } else {
          const today = new Date();
          const past = new Date();
          past.setDate(today.getDate() - 6);
          to = fmt(today);
          from = fmt(past);
        }

        const res = await fetch(`/api/articles?from=${from}&to=${to}`);
        if (res.ok) {
          const data = await res.json();
          // Sort by date descending
          const sorted = (data.articles || []).sort(
            (a: Article, b: Article) =>
              new Date(b.date).getTime() - new Date(a.date).getTime(),
          );
          setArchivedArticles(sorted);
        } else {
          addLog("ระบบเกิดข้อผิดพลาดในการโหลดบทความที่บันทึกไว้");
        }
      } catch (e) {
        console.error(e);
        addLog("ไม่สามารถติดต่อเซิร์ฟเวอร์เพื่อโหลดบทความเก่าได้");
      } finally {
        setLoadingInitial(false);
      }
    },
    [addLog],
  );

  // Load the archive on mount and whenever the date filter changes.
  useEffect(() => {
    setTimeout(() => {
      fetchArchivedArticles(selectedDate || undefined);
    }, 0);
  }, [fetchArchivedArticles, selectedDate]);

  // Auto-scroll terminal logs to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  async function handleSync() {
    if (isSyncing) return;

    setIsSyncing(true);
    isCancelledRef.current = false;
    setIsCancelling(false);
    setNewCount(null);
    setProgressPercent(5);
    setLogs([]);
    setNewlySynced([]);
    setActiveTab("newly-synced");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Catalog entries saved this run, flushed to index.json once at the end
    // (instead of rewriting the whole index per article).
    const syncedEntries: Article[] = [];

    try {
      addLog("กำลังเริ่มตรวจสอบบทความใหม่จาก en.minghui.org...");
      setStatusMessage("กำลังตรวจหาบทความใหม่...");

      // 1. Scrape
      const scrapeRes = await fetch("/api/scrape", {
        method: "POST",
        headers: {
          "X-Google-ID-Token": googleIdToken || "",
        },
        signal: controller.signal,
      });
      if (scrapeRes.status === 401 || scrapeRes.status === 403) {
        throw new Error(`Unauthorized:${scrapeRes.status}`);
      }
      if (!scrapeRes.ok) {
        throw new Error(`Scrape API failed (Status ${scrapeRes.status})`);
      }

      if (isCancelledRef.current) {
        throw new DOMException("Aborted by user", "AbortError");
      }

      const scrapeData = await scrapeRes.json();
      let newArticles = scrapeData.articles || [];

      // Filter by selected date if specified
      if (selectedDate) {
        newArticles = newArticles.filter(
          (article: Article) => article.date === selectedDate,
        );
        addLog(
          `กรองตามวันที่เลือก: ${selectedDate} (พบบทความใหม่ ${newArticles.length} รายการหลังจากกรอง)`,
        );
      }

      setNewCount(newArticles.length);
      addLog(`ตรวจสอบเสร็จสิ้น: พบบทความใหม่ ${newArticles.length} รายการ`);

      if (newArticles.length === 0) {
        setStatusMessage("ไม่พบบทความใหม่");
        setProgressPercent(100);
        setIsSyncing(false);
        addLog("ระบบสิ้นสุดการทำงาน เนื่องจากไม่มีบทความใหม่");
        return;
      }

      setProgressPercent(15);

      // 2. Loop through each article for translate -> save
      for (let i = 0; i < newArticles.length; i++) {
        if (isCancelledRef.current) {
          throw new DOMException("Aborted by user", "AbortError");
        }

        const article = newArticles[i];
        const stepWeight = 85 / newArticles.length;
        const currentBaseProgress = 15 + i * stepWeight;

        // --- Translation Step ---
        addLog(`กำลังแปล: ${article.title_en}...`);
        setStatusMessage(
          `กำลังแปล (${i + 1}/${newArticles.length}): ${article.title_en}`,
        );
        setProgressPercent(Math.round(currentBaseProgress + stepWeight * 0.4));

        const transRes = await fetch("/api/translate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Google-ID-Token": googleIdToken || "",
          },
          body: JSON.stringify({ url: article.url }),
          signal: controller.signal,
        });

        if (isCancelledRef.current) {
          throw new DOMException("Aborted by user", "AbortError");
        }

        if (transRes.status === 401 || transRes.status === 403) {
          throw new Error(`Unauthorized:${transRes.status}`);
        }
        if (!transRes.ok) {
          addLog(`❌ แปลล้มเหลวสำหรับบทความ: ${article.title_en}`);
          continue;
        }

        const transData = await transRes.json();
        addLog(`✨ แปลสำเร็จ: "${transData.title_th}"`);

        // --- Save Step ---
        setStatusMessage(
          `กำลังบันทึก (${i + 1}/${newArticles.length}): ${transData.title_th}`,
        );
        setProgressPercent(Math.round(currentBaseProgress + stepWeight * 0.8));
        addLog(`กำลังบันทึกบทความลง Google Drive...`);

        const saveRes = await fetch("/api/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Google-ID-Token": googleIdToken || "",
          },
          body: JSON.stringify({
            url: article.url,
            title_en: article.title_en,
            title_th: transData.title_th,
            content_en: transData.content_en,
            content_th: transData.content_th,
            date: article.date,
          }),
          signal: controller.signal,
        });

        if (isCancelledRef.current) {
          throw new DOMException("Aborted by user", "AbortError");
        }

        if (saveRes.status === 401 || saveRes.status === 403) {
          throw new Error(`Unauthorized:${saveRes.status}`);
        }
        if (!saveRes.ok) {
          addLog(`❌ บันทึกล้มเหลวสำหรับบทความ: ${transData.title_th}`);
          continue;
        }

        const saveData = await saveRes.json();
        addLog(`💾 บันทึกสำเร็จ: ${saveData.filePath}`);

        // Add to newly synced list
        const syncedArticle: Article = {
          url: article.url,
          title_en: article.title_en,
          title_th: transData.title_th,
          date: article.date,
          filePath: saveData.filePath,
        };

        syncedEntries.push(syncedArticle);
        setNewlySynced((prev) => [syncedArticle, ...prev]);
        setArchivedArticles((prev) => [syncedArticle, ...prev]);

        setProgressPercent(Math.round(currentBaseProgress + stepWeight));

        // Rate limit: add 1s delay between articles
        if (i < newArticles.length - 1) {
          addLog("หน่วงเวลา 1 วินาที เพื่อป้องกัน Rate Limit...");
          for (let d = 0; d < 10; d++) {
            if (isCancelledRef.current) {
              throw new DOMException("Aborted by user", "AbortError");
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      }

      setStatusMessage("เสร็จสิ้นการซิงค์ข้อมูล!");
      setProgressPercent(100);
      addLog("🎉 กระบวนการแปลและบันทึกเสร็จสมบูรณ์แล้ว!");
    } catch (error) {
      const err = error as Error;
      if (err.name === "AbortError" || isCancelledRef.current) {
        addLog("🛑 กระบวนการถูกยกเลิกโดยผู้ใช้");
        setStatusMessage("ยกเลิกกระบวนการซิงค์เรียบร้อยแล้ว");
      } else {
        console.error(err);
        const authMatch = err.message?.match(/Unauthorized:(\d+)/);
        if (authMatch) {
          if (authMatch[1] === "403") {
            // Valid Google sign-in, but the email isn't on the allow-list.
            addLog(
              `❌ อีเมล ${userEmail ?? "นี้"} ไม่อยู่ในรายชื่อที่ได้รับอนุญาตให้ใช้งานระบบ — โปรดติดต่อผู้ดูแลเพื่อขอสิทธิ์`,
            );
            setStatusMessage("อีเมลไม่ได้รับอนุญาต");
          } else {
            // 401 — token missing/expired/invalid.
            addLog(
              "❌ เซสชันหมดอายุหรือไม่ถูกต้อง — กรุณากด Sign Out แล้วลงชื่อเข้าใช้ใหม่อีกครั้ง",
            );
            setStatusMessage("เซสชันหมดอายุ");
          }
        } else {
          setStatusMessage("เกิดข้อผิดพลาดในการแปล/บันทึก");
          addLog(`❌ ข้อผิดพลาด: ${err.message || String(err)}`);
        }
      }
    } finally {
      // Persist all articles saved this run to the catalog in one merge-write,
      // even if the run was cancelled or errored partway through.
      if (syncedEntries.length > 0) {
        try {
          addLog("กำลังบันทึกดัชนีคลังบทความ...");
          const indexRes = await fetch("/api/index", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Google-ID-Token": googleIdToken || "",
            },
            body: JSON.stringify({ entries: syncedEntries }),
          });
          if (!indexRes.ok) {
            throw new Error(`Status ${indexRes.status}`);
          }
          addLog(`🗂️ อัปเดตดัชนีคลังบทความสำเร็จ (${syncedEntries.length} รายการ)`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          addLog(
            `⚠️ อัปเดตดัชนีคลังล้มเหลว (${msg}) — บทความถูกบันทึกแล้ว ระบบจะเพิ่มลงดัชนีอัตโนมัติในการซิงค์ครั้งถัดไป`,
          );
        }
      }
      setIsSyncing(false);
      setIsCancelling(false);
      abortControllerRef.current = null;
    }
  }

  return (
    <div className="min-h-screen bg-[#060913] text-[#f8fafc] font-sans selection:bg-teal-500 selection:text-slate-955 relative overflow-x-hidden">
      {/* Background glow effects - soft and meditative */}
      <div className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] bg-teal-500/[0.03] rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[20%] right-[10%] w-[600px] h-[600px] bg-indigo-500/[0.03] rounded-full blur-[150px] pointer-events-none" />

      {/* Header */}
      <header className="border-b border-slate-900/60 bg-[#060913]/70 backdrop-blur-md sticky top-0 z-50 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-[#0c1220] border border-slate-900 flex items-center justify-center shadow-md relative group overflow-hidden">
              <div className="absolute inset-0 bg-teal-500/5 group-hover:bg-teal-500/10 transition-colors duration-500" />
              <svg
                className="w-6 h-6 text-teal-400/90 relative z-10 transition-transform duration-700 group-hover:rotate-180"
                viewBox="0 0 100 100"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path
                  d="M50 82 C25 72, 20 45, 50 25 C80 45, 75 72, 50 82 Z"
                  fill="currentColor"
                  fillOpacity="0.1"
                />
                <path
                  d="M50 82 C35 77, 35 55, 50 45 C65 55, 65 77, 50 82 Z"
                  fill="currentColor"
                  fillOpacity="0.2"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-display font-bold tracking-wide text-slate-100 flex items-center gap-2">
                <span>MINGHUI INSIGHTS</span>
                <span className="text-2xs font-mono px-2 py-0.5 rounded-md bg-teal-500/10 text-teal-400 border border-teal-500/15 uppercase font-medium tracking-widest">
                  TH
                </span>
              </h1>
              <p className="text-3xs sm:text-2xs text-slate-455 font-sans tracking-wide">
                ระบบสืบค้นข้อมูลและแปลถอดความบทความสัจธรรมธรรมปฏิบัติฝึกสมาธิ
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {googleIdToken && (
              <div className="hidden sm:flex items-center gap-2 bg-[#0c1220]/60 border border-slate-900 px-3.5 py-1.5 rounded-xl text-3xs font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-opacity" />
                <span className="text-slate-350 max-w-[140px] truncate">
                  {userEmail}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 relative z-10">
        {/* Sync Summary Notification */}
        {newCount !== null && (
          <div
            className={`mb-6 p-4 rounded-2xl border flex items-center justify-between animate-fade-in ${
              newCount > 0
                ? "bg-teal-500/10 border-teal-500/20 text-teal-300"
                : "bg-slate-900/40 border-slate-900 text-slate-455"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-2 w-2 relative">
                {newCount > 0 && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-teal-400" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${newCount > 0 ? "bg-teal-500" : "bg-slate-650"}`}
                />
              </span>
              <p className="text-xs font-semibold font-sans">
                พบบทความใหม่สำหรับวันนี้ใน Minghui.org:{" "}
                <span className="font-mono font-bold underline bg-teal-500/10 px-1.5 py-0.5 rounded text-teal-400 ml-1">
                  {newCount}
                </span>{" "}
                รายการ
              </p>
            </div>
            {newCount > 0 && isSyncing && (
              <p className="text-3xs text-slate-500 animate-pulse uppercase tracking-wider font-mono">
                กำลังซิงค์เข้าคลังระบบจัดเก็บ...
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* LEFT COLUMN: ARCHIVE LEDGER */}
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
              {selectedDate && (
                <span className="text-3xs font-mono bg-teal-500/10 text-teal-400 border border-teal-500/15 px-2.5 py-1 rounded-lg flex items-center gap-1.5 animate-fade-in">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                  {formatThaiDateShort(selectedDate)}
                </span>
              )}
            </div>

            {/* Tab Toggles */}
            <div className="flex bg-[#0c1220]/60 p-1 border border-slate-900 rounded-xl">
              <button
                onClick={() => setActiveTab("archived")}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  activeTab === "archived"
                    ? "bg-[#14b8a6]/10 text-teal-400 font-bold border border-teal-500/15"
                    : "text-slate-455 hover:text-slate-200"
                }`}
              >
                {selectedDate ? "วันที่เลือก" : "7 วันล่าสุด"} (
                {archivedArticles.length})
              </button>
              <button
                onClick={() => setActiveTab("newly-synced")}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  activeTab === "newly-synced"
                    ? "bg-[#14b8a6]/10 text-teal-400 font-bold border border-teal-500/15"
                    : "text-slate-455 hover:text-slate-200"
                }`}
              >
                แปลรอบนี้ ({newlySynced.length})
              </button>
            </div>

            {/* Scrollable list of articles */}
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto scrollbar-thin pr-1 space-y-3 pb-6"
            >
              {loadingInitial && activeTab === "archived" ? (
                <div className="h-[250px] flex flex-col items-center justify-center text-slate-550 space-y-3">
                  <svg
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
                  <span className="text-3xs uppercase tracking-wider text-slate-555 font-mono">
                    กำลังเชื่อมต่อข้อมูลคลัง...
                  </span>
                </div>
              ) : activeTab === "archived" && archivedArticles.length === 0 ? (
                <div className="h-[200px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-900 rounded-2xl text-slate-500">
                  <span className="text-xs font-sans">
                    {selectedDate
                      ? "ไม่พบบทความสำหรับวันที่ระบุ"
                      : "ไม่พบบทความในช่วง 7 วันล่าสุด — เลือกวันที่เพื่อดูย้อนหลัง"}
                  </span>
                </div>
              ) : activeTab === "newly-synced" && newlySynced.length === 0 ? (
                <div className="h-[200px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-900 rounded-2xl text-slate-500">
                  <span className="text-xs font-sans">
                    ยังไม่มีบทความที่ดึงใหม่ในเซสชันนี้
                  </span>
                </div>
              ) : (
                <>
                  {listArticles
                    .slice(0, visibleCount)
                    .map((article: Article, idx: number) => (
                  <div
                    key={article.filePath ?? article.url ?? idx}
                    onClick={() =>
                      article.filePath && openArticle(article.filePath)
                    }
                    className="p-4 rounded-xl bg-[#0c1220]/30 border border-slate-900 hover:border-teal-500/30 hover:bg-[#0c1220]/60 transition-all duration-300 group cursor-pointer shadow-xs active:scale-[0.99] animate-fade-in"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-3xs font-mono bg-slate-900/80 px-2 py-0.5 rounded text-slate-450 border border-slate-850">
                        {article.date}
                      </span>
                      <svg
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
                  </div>
                    ))}
                  {visibleCount < listArticles.length && (
                    <div
                      ref={loadMoreRef}
                      className="py-4 flex items-center justify-center"
                    >
                      <span className="text-3xs text-slate-550 font-mono uppercase tracking-wider">
                        แสดงเพิ่มเติม ({visibleCount}/{listArticles.length})
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* MIDDLE COLUMN: WORKSPACE CONSOLE */}
          <section className="lg:col-span-3 space-y-6">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-teal-400 font-mono">
                แผงคอนโซลควบคุม
              </h2>
              <p className="text-3xs text-slate-550 font-sans mt-0.5">
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
                  {archivedArticles.length}
                </p>
                <span className="text-4xs text-slate-550 font-sans mt-0.5 block leading-none">
                  {selectedDate ? "ในวันที่เลือก" : "ใน 7 วันล่าสุด"}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-[#0c1220]/20 border border-slate-900 backdrop-blur-xs">
                <span className="text-4xs uppercase tracking-wider text-slate-500 font-mono">
                  แปลสำเร็จ
                </span>
                <p className="text-lg font-mono font-bold text-[#fda4af] mt-0.5">
                  {newlySynced.length}
                </p>
                <span className="text-4xs text-slate-550 font-sans mt-0.5 block leading-none">
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
                <span className="text-4xs text-slate-550 font-mono tracking-wide uppercase">
                  live_operation.sh
                </span>
                <span className="w-8" />
              </div>

              <div className="p-3 flex-1 overflow-y-auto font-mono text-4xs space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800 bg-[#060913]">
                {logs.length === 0 ? (
                  <div className="text-slate-655 italic font-sans text-3xs">
                    รอเริ่มการซิงค์ข้อมูล... กรุณากดปุ่ม
                    &quot;ซิงค์ข้อมูลระบบ&quot; ในแผงควบคุมขวา
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
                    <span className="truncate max-w-[80%] text-slate-455 font-sans tracking-wide">
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

          {/* RIGHT COLUMN: DESK CONTROLS */}
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
                  <p className="text-2xs text-slate-455 leading-relaxed font-sans">
                    ระบบพร้อมสำหรับการเริ่มดึงข้อมูล (Scraping) แปลความด้วย AI
                    (Gemini Translator) และนำเข้าบัญชีจัดเก็บ Google Drive
                    ของระบบแบบเรียลไทม์
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
                <div className="space-y-1.5 relative w-full" ref={calendarRef}>
                  <label className="block text-4xs font-bold text-slate-500 uppercase tracking-widest font-mono">
                    เลือกตัวกรองวันที่ดึงข้อมูล
                  </label>
                  <button
                    type="button"
                    onClick={() => !isSyncing && setShowCalendar(!showCalendar)}
                    disabled={isSyncing}
                    className="w-full bg-[#060913] border border-slate-900 rounded-xl px-4 py-2.5 text-xs text-slate-350 hover:border-slate-800 focus:outline-none transition-all flex items-center justify-between group disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <svg
                        className="w-3.5 h-3.5 text-slate-550 group-hover:text-teal-400 transition-colors"
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
                          selectedDate
                            ? "text-teal-400 font-semibold"
                            : "text-slate-500 font-medium"
                        }
                      >
                        {selectedDate
                          ? formatThaiDateShort(selectedDate)
                          : "ดึงทั้งหมด (ไม่มีกรอง)"}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {selectedDate && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDate("");
                          }}
                          className="px-1.5 py-0.5 rounded-md hover:bg-slate-900 text-slate-500 hover:text-slate-350 text-4xs transition-colors"
                        >
                          ล้างค่า
                        </span>
                      )}
                      <svg
                        className={`w-3.5 h-3.5 text-slate-550 group-hover:text-slate-300 transition-transform duration-200 ${showCalendar ? "rotate-180" : ""}`}
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
                    </div>
                  </button>

                  {/* Calendar Popover */}
                  {showCalendar && (
                    <div className="absolute top-[105%] right-0 w-[280px] bg-[#0c1220]/95 border border-slate-900 rounded-2xl p-4 shadow-2xl backdrop-blur-lg z-30 animate-fade-in flex flex-col space-y-4">
                      <div className="flex justify-between items-center">
                        <button
                          type="button"
                          onClick={() =>
                            setViewDate(
                              new Date(
                                viewDate.getFullYear(),
                                viewDate.getMonth() - 1,
                                1,
                              ),
                            )
                          }
                          className="p-1.5 rounded-lg hover:bg-slate-900 text-slate-450 hover:text-slate-200 transition-colors cursor-pointer"
                        >
                          <svg
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
                          {monthNames[viewDate.getMonth()]}{" "}
                          {viewDate.getFullYear()}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setViewDate(
                              new Date(
                                viewDate.getFullYear(),
                                viewDate.getMonth() + 1,
                                1,
                              ),
                            )
                          }
                          className="p-1.5 rounded-lg hover:bg-slate-900 text-slate-450 hover:text-slate-200 transition-colors cursor-pointer"
                        >
                          <svg
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

                      <div className="grid grid-cols-7 gap-1 text-center text-4xs font-semibold text-slate-505 uppercase tracking-widest font-mono">
                        {daysOfWeek.map((day) => (
                          <div key={day}>{day}</div>
                        ))}
                      </div>

                      <div className="grid grid-cols-7 gap-1">
                        {/* Calendar Grid Days */}
                        {generateCalendarDays().map((item, idx) => {
                          const isSel = selectedDate === item.dateStr;
                          const isTod =
                            formatDateToString(new Date()) === item.dateStr;
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setSelectedDate(item.dateStr);
                                setShowCalendar(false);
                              }}
                              className={`py-1 text-3xs rounded-md transition-colors cursor-pointer ${
                                !item.isCurrentMonth
                                  ? "text-slate-700 hover:bg-[#060913]"
                                  : isSel
                                    ? "bg-teal-500 text-slate-950 font-bold"
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

                      <div className="border-t border-slate-900 pt-3 flex justify-between items-center text-4xs font-semibold">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDate(formatDateToString(new Date()));
                            setShowCalendar(false);
                          }}
                          className="text-teal-400 hover:text-teal-350 transition-colors cursor-pointer"
                        >
                          วันนี้
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDate("");
                            setShowCalendar(false);
                          }}
                          className="text-slate-500 hover:text-slate-350 transition-colors cursor-pointer"
                        >
                          ล้างตัวกรอง
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Authentication sync action buttons */}
                {!googleIdToken ? (
                  <div className="flex flex-col items-center justify-center p-4 bg-[#060913] border border-slate-900 rounded-2xl space-y-2.5 shadow-inner">
                    <span className="text-2xs text-slate-500 font-medium text-center leading-normal font-sans">
                      จำเป็นต้องลงชื่อเข้าบัญชีของเจ้าของสิทธิ์ระบบเพื่อซิงค์ข้อมูล
                    </span>
                    <div
                      id="google-signin-btn"
                      className="w-full flex justify-center py-1 scale-95"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between bg-[#060913] border border-slate-900 px-3.5 py-2.5 rounded-xl text-3xs">
                      <div className="flex items-center gap-1.5 truncate max-w-[70%]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-opacity" />
                        <span className="text-slate-350 font-mono truncate">
                          {userEmail}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="text-rose-450 hover:text-rose-350 font-bold cursor-pointer transition-colors"
                      >
                        Sign Out
                      </button>
                    </div>

                    {/* Hidden sign-in container */}
                    <div id="google-signin-btn" className="hidden" />

                    {isSyncing ? (
                      <div className="flex gap-2 w-full">
                        <button
                          disabled
                          className="flex-1 py-3 px-4 rounded-xl font-bold text-xs bg-slate-900 text-slate-550 border border-slate-900 flex items-center justify-center gap-2 cursor-not-allowed font-sans"
                        >
                          <svg
                            className="animate-spin h-4 w-4 text-slate-550"
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
                        className="w-full py-3 px-4 rounded-xl font-bold text-xs shadow-lg transition-all duration-300 flex items-center justify-center gap-2 bg-teal-500 text-slate-950 hover:bg-teal-400 hover:-translate-y-0.5 active:translate-y-0 cursor-pointer shadow-teal-500/15 font-sans"
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
                )}
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Immersive Zen Reader Modal Overlay */}
      {readingArticlePath && (
        <div className="fixed inset-0 z-50 bg-[#060913]/98 overflow-y-auto backdrop-blur-xl flex flex-col animate-fade-in select-text">
          {/* Reader Header */}
          <div className="sticky top-0 bg-[#060913]/90 border-b border-slate-900/60 backdrop-blur-md z-30 px-4 py-3.5 sm:px-6 lg:px-8">
            <div className="max-w-5xl mx-auto flex items-center justify-between font-sans">
              <button
                onClick={closeArticle}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors font-semibold cursor-pointer"
              >
                <svg
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
                <div className="flex bg-[#060913] p-1 border border-slate-900 rounded-xl text-3xs font-mono">
                  <button
                    onClick={() => setReaderLanguage("th")}
                    className={`px-3 py-1.5 rounded-lg transition-all font-semibold cursor-pointer ${
                      readerLanguage === "th"
                        ? "bg-teal-500 text-slate-950 font-bold"
                        : "text-slate-455 hover:text-slate-200"
                    }`}
                  >
                    ภาษาไทย
                  </button>
                  <button
                    onClick={() => setReaderLanguage("en")}
                    className={`px-3 py-1.5 rounded-lg transition-all font-semibold cursor-pointer ${
                      readerLanguage === "en"
                        ? "bg-teal-500 text-slate-955 font-bold"
                        : "text-slate-455 hover:text-slate-200"
                    }`}
                  >
                    English
                  </button>
                  <button
                    onClick={() => setReaderLanguage("both")}
                    className={`px-3 py-1.5 rounded-lg transition-all font-semibold cursor-pointer ${
                      readerLanguage === "both"
                        ? "bg-teal-500 text-slate-955 font-bold"
                        : "text-slate-455 hover:text-slate-200"
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
              <div className="h-[60vh] flex flex-col items-center justify-center text-slate-550 space-y-4 relative z-10 font-sans">
                <svg
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
                <p className="text-3xs uppercase tracking-wider text-slate-450 font-mono">
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
                <p className="text-sm">ไม่พบข้อมูลของบทความนี้</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
