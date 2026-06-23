"use client";

import { useState, useEffect, useRef, useCallback } from "react";

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

  const loadArticleContent = useCallback(async (path: string) => {
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
  }, [addLog]);

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
            className="text-3xl font-extrabold tracking-tight mt-10 mb-4 text-slate-100 font-sans border-b border-slate-800 pb-2"
          >
            {para.replace(/^#\s+/, "")}
          </h1>
        );
      }
      if (para.startsWith("## ")) {
        return (
          <h2
            key={idx}
            className="text-2xl font-bold tracking-tight mt-8 mb-4 text-slate-100 font-sans"
          >
            {para.replace(/^##\s+/, "")}
          </h2>
        );
      }
      if (para.startsWith("### ")) {
        return (
          <h3
            key={idx}
            className={`text-xl font-bold tracking-tight mt-8 mb-4 font-sans ${
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
            className="text-lg font-bold tracking-tight mt-6 mb-3 text-slate-200 font-sans"
          >
            {para.replace(/^####\s+/, "")}
          </h4>
        );
      }

      // 2. Blockquotes
      if (para.startsWith("> ")) {
        return (
          <blockquote
            key={idx}
            className="border-l-4 border-teal-500/50 bg-slate-900/35 px-6 py-4 my-6 rounded-r-xl italic text-slate-300 leading-relaxed font-serif text-base"
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
              className={`text-base leading-relaxed ${lang === "en" ? "text-slate-300" : "text-slate-200"}`}
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
            className="bg-slate-950 border border-slate-800 p-4 rounded-xl overflow-x-auto text-xs font-mono my-5 text-teal-400/90 leading-relaxed"
          >
            <code>{codeText}</code>
          </pre>
        );
      }

      // 5. Standard Paragraph
      return (
        <p
          key={idx}
          className={`indent-8 leading-relaxed mb-4 text-base sm:text-lg ${
            lang === "en" ? "text-slate-300" : "text-slate-200"
          }`}
        >
          {para}
        </p>
      );
    });
  }

  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchArchivedArticles = useCallback(async () => {
    try {
      setLoadingInitial(true);
      const res = await fetch("/api/scrape");
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
  }, [addLog]);

  // Load already archived articles on mount
  useEffect(() => {
    setTimeout(() => {
      fetchArchivedArticles();
    }, 0);
  }, [fetchArchivedArticles]);

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
        throw new Error("Unauthorized");
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
          throw new Error("Unauthorized");
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
          throw new Error("Unauthorized");
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
        if (
          err.message?.includes("Unauthorized") ||
          err.message?.includes("401") ||
          err.message?.includes("403")
        ) {
          addLog(
            "❌ อีเมลนี้ไม่ได้รับสิทธิ์เข้าใช้งานระบบ หรือเซสชันหมดอายุ",
          );
          setStatusMessage("ไม่มีสิทธิ์เข้าใช้งานระบบ");
        } else {
          setStatusMessage("เกิดข้อผิดพลาดในการแปล/บันทึก");
          addLog(`❌ ข้อผิดพลาด: ${err.message || String(err)}`);
        }
      }
    } finally {
      setIsSyncing(false);
      setIsCancelling(false);
      abortControllerRef.current = null;
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-teal-500 selection:text-slate-900">
      {/* Background glow effects */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-20 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-linear-to-tr from-teal-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <span className="font-bold text-slate-950 text-lg">M</span>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-linear-to-r from-teal-300 to-indigo-200 bg-clip-text text-transparent">
                Minghui Scraper & Translator
              </h1>
              <p className="text-xs text-slate-400">
                ระบบดึงและแปลบทความฝึกปฏิบัติสมาธิ (อังกฤษ ➔ ไทย)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-slate-300 ring-1 ring-inset ring-slate-800">
              Vercel Deployed
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 sm:px-6 lg:px-8 relative z-10">
        {/* Top Control Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="md:col-span-1 bg-slate-900/60 border border-slate-800/60 rounded-2xl p-6 backdrop-blur-sm flex flex-col justify-between shadow-xl relative z-20">
            <div>
              <h2 className="text-lg font-semibold text-slate-200 mb-2">
                ควบคุมระบบ
              </h2>
              <p className="text-sm text-slate-400 mb-6">
                เริ่มการดึงข้อมูลจาก en.minghui.org หมวด Cultivation Insights
                แปลเป็นภาษาไทยด้วย Gemini และเก็บข้อมูลลง Google Drive
              </p>
            </div>

            <div className="space-y-2 mb-6 relative" ref={calendarRef}>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                เลือกกรองตามวันที่แปล (เลือกได้)
              </label>

              {/* Trigger Button */}
              <button
                type="button"
                onClick={() => !isSyncing && setShowCalendar(!showCalendar)}
                disabled={isSyncing}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-300 hover:border-slate-755 hover:border-slate-700/60 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 transition-all flex items-center justify-between group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-2.5">
                  <svg
                    className="w-4 h-4 text-slate-400 group-hover:text-teal-400 transition-colors"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
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
                        ? "text-teal-300 font-semibold"
                        : "text-slate-500"
                    }
                  >
                    {selectedDate
                      ? formatThaiDateShort(selectedDate)
                      : "ทั้งหมด (กรองตามวันที่)"}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {selectedDate && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDate("");
                      }}
                      className="p-1 rounded-md hover:bg-slate-900 text-slate-500 hover:text-slate-300 text-xs transition-colors"
                    >
                      ล้างค่า
                    </span>
                  )}
                  <svg
                    className={`w-4 h-4 text-slate-500 group-hover:text-slate-300 transition-transform duration-200 ${showCalendar ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
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
                <div className="absolute top-[105%] left-0 w-[290px] bg-slate-900/98 border border-slate-800 rounded-2xl p-4 shadow-2xl backdrop-blur-md z-30 animate-fade-in flex flex-col space-y-4">
                  {/* Month Navigation */}
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
                      className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2.5"
                          d="M15 19l-7-7 7-7"
                        />
                      </svg>
                    </button>
                    <span className="text-sm font-semibold text-slate-200 font-sans">
                      {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
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
                      className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
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

                  {/* Days of Week Header */}
                  <div className="grid grid-cols-7 gap-1 text-center">
                    {daysOfWeek.map((day, idx) => (
                      <span
                        key={idx}
                        className={`text-xs font-bold font-sans ${idx === 0 || idx === 6 ? "text-slate-500" : "text-slate-400"}`}
                      >
                        {day}
                      </span>
                    ))}
                  </div>

                  {/* Calendar Grid */}
                  <div className="grid grid-cols-7 gap-1.5">
                    {generateCalendarDays().map((item, idx) => {
                      const isSelected = selectedDate === item.dateStr;
                      const isToday =
                        formatDateToString(new Date()) === item.dateStr;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setSelectedDate(item.dateStr);
                            setShowCalendar(false);
                          }}
                          className={`h-7 w-7 rounded-lg flex items-center justify-center text-xs font-semibold font-mono transition-all ${
                            !item.isCurrentMonth
                              ? "text-slate-700 hover:bg-slate-850 hover:text-slate-500"
                              : isSelected
                                ? "bg-linear-to-tr from-teal-500 to-emerald-400 text-slate-950 font-bold shadow-md shadow-teal-500/25 scale-105"
                                : isToday
                                  ? "border border-teal-500/30 text-teal-400 hover:bg-slate-800"
                                  : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                          }`}
                        >
                          {item.day}
                        </button>
                      );
                    })}
                  </div>

                  {/* Calendar Footer Shortcuts */}
                  <div className="border-t border-slate-800 pt-3 flex justify-between items-center text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        const todayStr = formatDateToString(new Date());
                        setSelectedDate(todayStr);
                        setViewDate(new Date());
                        setShowCalendar(false);
                      }}
                      className="text-teal-400 hover:text-teal-300 font-semibold"
                    >
                      วันนี้
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDate("");
                        setShowCalendar(false);
                      }}
                      className="text-slate-500 hover:text-slate-300"
                    >
                      ล้างตัวกรอง
                    </button>
                  </div>
                </div>
              )}
            </div>

            {!googleIdToken ? (
              <div className="flex flex-col items-center justify-center p-5 bg-slate-900/30 border border-slate-800 rounded-2xl space-y-3 shadow-inner">
                <span className="text-xs text-slate-400 font-medium font-sans">
                  ลงชื่อเข้าใช้ Google เพื่อจัดการระบบ
                </span>
                <div
                  id="google-signin-btn"
                  className="w-full flex justify-center py-1"
                />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center bg-slate-900/50 border border-slate-800/80 px-4 py-3 rounded-2xl text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-slate-300 font-mono font-semibold truncate max-w-[150px] sm:max-w-xs">
                      {userEmail}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="text-rose-400 hover:text-rose-300 font-semibold cursor-pointer transition-colors px-2 py-1 rounded-lg hover:bg-rose-500/10"
                  >
                    ออกจากระบบ
                  </button>
                </div>

                {/* Hidden container to keep script happy */}
                <div id="google-signin-btn" className="hidden" />

                {isSyncing ? (
                  <div className="flex gap-2.5 w-full">
                    <button
                      disabled
                      className="flex-1 py-3.5 px-4 rounded-xl font-semibold shadow-lg flex items-center justify-center gap-2 bg-slate-900 text-slate-500 cursor-not-allowed border border-slate-800/80"
                    >
                      <svg
                        className="animate-spin -ml-1 mr-3 h-5 w-5 text-slate-500"
                        xmlns="http://www.w3.org/2000/svg"
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
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      กำลังรันระบบ...
                    </button>
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={isCancelling}
                      className={`px-5 py-3.5 rounded-xl font-semibold border transition-all duration-300 active:scale-95 ${
                        isCancelling
                          ? "bg-rose-500/10 border-rose-500/20 text-rose-500/50 cursor-not-allowed"
                          : "bg-rose-500/20 hover:bg-rose-500/30 border-rose-500/30 text-rose-300 hover:text-rose-100 shadow-lg shadow-rose-500/5 cursor-pointer"
                      }`}
                    >
                      {isCancelling ? "กำลังยกเลิก..." : "ยกเลิก"}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleSync}
                    className="w-full py-3.5 px-4 rounded-xl font-semibold shadow-lg transition-all duration-300 flex items-center justify-center gap-2 bg-linear-to-r from-teal-500 to-emerald-400 text-slate-950 hover:brightness-110 hover:-translate-y-0.5 active:translate-y-0 shadow-teal-500/10"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                      />
                    </svg>
                    Fetch บทความใหม่
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Console / Log Terminal */}
          <div className="md:col-span-2 bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[280px] shadow-2xl">
            <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex justify-between items-center">
              <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-rose-500/80" />
                <span className="w-3 h-3 rounded-full bg-amber-500/80" />
                <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
              </div>
              <span className="text-xs text-slate-500 font-mono">
                live_logger.sh
              </span>
            </div>

            <div className="p-4 flex-1 overflow-y-auto font-mono text-xs text-teal-400/90 space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800">
              {logs.length === 0 ? (
                <div className="text-slate-600 italic">
                  กดปุ่ม &quot;Fetch บทความใหม่&quot; เพื่อเริ่มต้นทำกระบวนการ...
                </div>
              ) : (
                logs.map((log, idx) => (
                  <div
                    key={idx}
                    className="leading-relaxed whitespace-pre-wrap"
                  >
                    {log}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>

            {/* Progress Bar */}
            {isSyncing && (
              <div className="bg-slate-900 border-t border-slate-800 px-4 py-3">
                <div className="flex justify-between items-center text-xs text-slate-400 mb-1.5">
                  <span className="truncate max-w-[80%] font-medium">
                    {statusMessage}
                  </span>
                  <span className="font-mono text-teal-400">
                    {progressPercent}%
                  </span>
                </div>
                <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                  <div
                    className="bg-linear-to-r from-teal-400 to-indigo-500 h-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sync Summary Notification */}
        {newCount !== null && (
          <div
            className={`mb-6 p-4 rounded-xl border flex items-center justify-between animate-fade-in ${
              newCount > 0
                ? "bg-teal-500/10 border-teal-500/20 text-teal-300"
                : "bg-slate-900/40 border-slate-800 text-slate-400"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 relative">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${newCount > 0 ? "bg-teal-400" : "bg-slate-600"}`}
                ></span>
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${newCount > 0 ? "bg-teal-500" : "bg-slate-600"}`}
                ></span>
              </span>
              <p className="text-sm font-medium">
                พบบทความใหม่{" "}
                <span className="font-bold underline">{newCount}</span> รายการ
              </p>
            </div>
            {newCount > 0 && isSyncing && (
              <p className="text-xs text-slate-400 animate-pulse">
                กำลังซิงค์เข้าคลังบทความ...
              </p>
            )}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="border-b border-slate-800/80 mb-6 flex justify-between items-end">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab("archived")}
              className={`pb-3 font-semibold text-sm transition-all relative ${
                activeTab === "archived"
                  ? "text-teal-400"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              คลังบทความทั้งหมด ({archivedArticles.length})
              {activeTab === "archived" && (
                <span className="absolute bottom-0 left-0 w-full h-0.5 bg-teal-400 rounded-full" />
              )}
            </button>
            <button
              onClick={() => setActiveTab("newly-synced")}
              className={`pb-3 font-semibold text-sm transition-all relative ${
                activeTab === "newly-synced"
                  ? "text-teal-400"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              แปลใหม่รอบนี้ ({newlySynced.length})
              {activeTab === "newly-synced" && (
                <span className="absolute bottom-0 left-0 w-full h-0.5 bg-teal-400 rounded-full" />
              )}
            </button>
          </div>
        </div>

        {/* Articles List container */}
        <div className="space-y-4">
          {loadingInitial && activeTab === "archived" ? (
            <div className="py-20 text-center text-slate-500 space-y-3">
              <svg
                className="animate-spin mx-auto h-8 w-8 text-teal-500"
                xmlns="http://www.w3.org/2000/svg"
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
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <p className="text-sm">กำลังโหลดคลังบทความจาก Google Drive...</p>
            </div>
          ) : activeTab === "archived" && archivedArticles.length === 0 ? (
            <div className="py-20 text-center text-slate-500 border border-dashed border-slate-800 rounded-2xl bg-slate-900/10">
              <svg
                className="w-12 h-12 mx-auto text-slate-600 mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="text-sm">
                ยังไม่มีบทความในคลัง กดดึงบทความใหม่ด้านบนเพื่อเริ่มต้น
              </p>
            </div>
          ) : activeTab === "archived" &&
            selectedDate &&
            archivedArticles.filter((a) => a.date === selectedDate).length ===
              0 ? (
            <div className="py-20 text-center text-slate-500 border border-dashed border-slate-800 rounded-2xl bg-slate-900/10">
              <svg
                className="w-12 h-12 mx-auto text-slate-600 mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <p className="text-sm mb-3">
                ไม่พบบทความที่บันทึกไว้ ณ วันที่ {selectedDate}
              </p>
              <button
                onClick={() => setSelectedDate("")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              >
                ล้างตัวกรองวันที่
              </button>
            </div>
          ) : activeTab === "newly-synced" && newlySynced.length === 0 ? (
            <div className="py-20 text-center text-slate-500 border border-dashed border-slate-800 rounded-2xl bg-slate-900/10">
              <svg
                className="w-12 h-12 mx-auto text-slate-600 mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                />
              </svg>
              <p className="text-sm">
                ยังไม่มีการซิงค์และแปลบทความใหม่ในรอบนี้
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {(activeTab === "archived"
                ? selectedDate
                  ? archivedArticles.filter((a) => a.date === selectedDate)
                  : archivedArticles
                : newlySynced
              ).map((article, idx) => (
                <div
                  key={idx}
                  className="bg-slate-900/40 border border-slate-800/80 hover:border-slate-700/80 rounded-2xl p-5 backdrop-blur-sm transition-all duration-300 hover:shadow-xl hover:shadow-teal-500/[0.02] group"
                >
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-md bg-slate-800 px-2 py-0.5 text-xs font-semibold text-teal-400 ring-1 ring-inset ring-teal-500/15 font-mono">
                          {article.date}
                        </span>
                        {article.filePath && (
                          <span className="inline-flex items-center rounded-md bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-400 ring-1 ring-inset ring-indigo-500/20 font-mono">
                            {article.filePath}
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-bold text-slate-100 group-hover:text-teal-300 transition-colors leading-snug">
                        {article.title_th}
                      </h3>
                      <p className="text-xs text-slate-400 leading-normal">
                        English:{" "}
                        <span className="italic">{article.title_en}</span>
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2 self-stretch sm:self-center">
                      {article.filePath && (
                        <button
                          onClick={() => openArticle(article.filePath!)}
                          className="inline-flex items-center justify-center gap-1.5 text-xs text-teal-400 hover:text-slate-950 border border-teal-500/20 hover:bg-teal-400 bg-teal-500/5 px-3.5 py-2.5 rounded-xl transition-all duration-300 font-semibold"
                        >
                          <span>อ่านบทความ</span>
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2.5"
                              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                            />
                          </svg>
                        </button>
                      )}
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1 text-xs text-slate-400 hover:text-teal-400 border border-slate-800 hover:border-teal-500/30 bg-slate-950/45 px-3.5 py-2.5 rounded-xl transition-all duration-300"
                      >
                        <span>ลิงก์ต้นฉบับ</span>
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2.5"
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          />
                        </svg>
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Reader Modal Overlay */}
      {readingArticlePath && (
        <div className="fixed inset-0 z-50 bg-slate-950/98 overflow-y-auto backdrop-blur-lg flex flex-col">
          {/* Reader Header */}
          <div className="sticky top-0 bg-slate-900/90 border-b border-slate-800 backdrop-blur-md z-10 px-4 py-4 sm:px-6 lg:px-8">
            <div className="max-w-5xl mx-auto flex items-center justify-between">
              <button
                onClick={closeArticle}
                className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors font-medium"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
                ย้อนกลับ
              </button>

              {articleContent && (
                <div className="flex bg-slate-950 p-1 border border-slate-800 rounded-xl text-xs">
                  <button
                    onClick={() => setReaderLanguage("th")}
                    className={`px-3 py-1.5 rounded-lg transition-all font-semibold ${
                      readerLanguage === "th"
                        ? "bg-teal-500 text-slate-950"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    ภาษาไทย
                  </button>
                  <button
                    onClick={() => setReaderLanguage("en")}
                    className={`px-3 py-1.5 rounded-lg transition-all font-semibold ${
                      readerLanguage === "en"
                        ? "bg-teal-500 text-slate-950"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    English
                  </button>
                  <button
                    onClick={() => setReaderLanguage("both")}
                    className={`px-3 py-1.5 rounded-lg transition-all font-semibold ${
                      readerLanguage === "both"
                        ? "bg-teal-500 text-slate-950"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    อ่านควบคู่ (สองภาษา)
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={handleCopyShareLink}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-950 border border-slate-800 text-teal-400 hover:text-teal-300 hover:bg-slate-900 transition-all duration-200 shadow-md shadow-teal-500/5 active:scale-95"
              >
                {copied ? (
                  <>
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2.5"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <span>คัดลอกสำเร็จ!</span>
                  </>
                ) : (
                  <>
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
                      />
                    </svg>
                    <span>คัดลอกลิงก์</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Reader Content */}
          <div className="flex-1 max-w-5xl w-full mx-auto px-4 py-8 sm:px-6 lg:px-8">
            {isLoadingArticle ? (
              <div className="h-[60vh] flex flex-col items-center justify-center text-slate-500 space-y-4">
                <svg
                  className="animate-spin h-10 w-10 text-teal-500"
                  xmlns="http://www.w3.org/2000/svg"
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
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                <p className="text-sm">
                  กำลังโหลดเนื้อหาบทความจาก Google Drive...
                </p>
              </div>
            ) : articleContent ? (
              <article className="space-y-8">
                {/* Metadata header */}
                <div className="border-b border-slate-800 pb-6 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="bg-teal-500/10 text-teal-400 px-2.5 py-0.5 rounded-md font-semibold font-mono border border-teal-500/15">
                      {articleContent.published_date}
                    </span>
                    <span className="bg-indigo-500/10 text-indigo-400 px-2.5 py-0.5 rounded-md font-semibold font-mono border border-indigo-500/15">
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
