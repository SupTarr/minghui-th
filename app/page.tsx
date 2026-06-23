"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Header from "@/components/Header";
import ArchiveList from "@/components/ArchiveList";
import SyncConsole from "@/components/SyncConsole";
import SyncControls from "@/components/SyncControls";
import ArticleReader from "@/components/ArticleReader";
import type { Article, ArticleDetails } from "@/components/types";

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
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });
  const [endDate, setEndDate] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

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
  const viewKey = `${activeTab}|${startDate}|${endDate}`;
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

  const logEndRef = useRef<HTMLDivElement>(null);

  // Fetches the archive for a date range. With no date, loads the last 7 days;
  // with a date, loads just that day. The catalog is date-partitioned, so the
  // server only reads the relevant per-day indexes (never the whole archive).
  const fetchArchivedArticles = useCallback(
    async (start?: string, end?: string) => {
      try {
        setLoadingInitial(true);
        const fmt = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
            d.getDate(),
          ).padStart(2, "0")}`;

        let from: string;
        let to: string;
        if (start) {
          from = start;
          to = end || start;
        } else {
          const today = new Date();
          const past = new Date();
          past.setDate(today.getDate() - 7);
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
      fetchArchivedArticles(startDate || undefined, endDate || undefined);
    }, 0);
  }, [fetchArchivedArticles, startDate, endDate]);

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

      // Filter by selected date range if specified
      if (startDate) {
        const end = endDate || startDate;
        newArticles = newArticles.filter(
          (article: Article) =>
            article.date >= startDate && article.date <= end,
        );
        addLog(
          `กรองตามช่วงวันที่เลือก: ${startDate} - ${end} (พบบทความใหม่ ${newArticles.length} รายการหลังจากกรอง)`,
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
            category: article.category,
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
          category: saveData.entry?.category ?? article.category,
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
          addLog(
            `🗂️ อัปเดตดัชนีคลังบทความสำเร็จ (${syncedEntries.length} รายการ)`,
          );
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

      <Header googleIdToken={googleIdToken} userEmail={userEmail} />

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
          <ArchiveList
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            archivedArticles={archivedArticles}
            newlySynced={newlySynced}
            listArticles={listArticles}
            visibleCount={visibleCount}
            loadingInitial={loadingInitial}
            scrollContainerRef={scrollContainerRef}
            loadMoreRef={loadMoreRef}
            openArticle={openArticle}
          />

          <SyncConsole
            archivedCount={archivedArticles.length}
            newlyCount={newlySynced.length}
            hasDateFilter={Boolean(startDate)}
            logs={logs}
            statusMessage={statusMessage}
            progressPercent={progressPercent}
            isSyncing={isSyncing}
            logEndRef={logEndRef}
          />

          <SyncControls
            isSyncing={isSyncing}
            progressPercent={progressPercent}
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
            googleIdToken={googleIdToken}
            userEmail={userEmail}
            isCancelling={isCancelling}
            handleSync={handleSync}
            handleCancel={handleCancel}
            handleSignOut={handleSignOut}
          />
        </div>
      </main>

      {/* Immersive Zen Reader Modal Overlay */}
      {readingArticlePath && (
        <ArticleReader
          articleContent={articleContent}
          isLoadingArticle={isLoadingArticle}
          readerLanguage={readerLanguage}
          setReaderLanguage={setReaderLanguage}
          closeArticle={closeArticle}
          handleCopyShareLink={handleCopyShareLink}
          copied={copied}
        />
      )}
    </div>
  );
}
