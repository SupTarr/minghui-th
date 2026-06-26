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

// Derive the YYYY-MM-DD date from a minghui article URL
// (e.g. .../articles/2026/6/26/234818.html → 2026-06-26). Mirrors the parser in
// app/api/scrape/route.ts. Falls back to today only as a safety net — minghui
// article URLs always carry the date in the path.
function parseDateFromArticleUrl(url: string): string {
  const match = url.match(
    /\/articles\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/\d+\.html/,
  );
  if (match) {
    const [, yyyy, mm, dd] = match;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function Dashboard() {
  const [archivedArticles, setArchivedArticles] = useState<Article[]>([]);
  const [newlySynced, setNewlySynced] = useState<Article[]>([]);
  const [activeTab, setActiveTab] = useState<
    "archived" | "newly-synced" | "needs-review"
  >("archived");
  const [isSyncing, setIsSyncing] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [newCount, setNewCount] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [archiveError, setArchiveError] = useState(false);
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

  const PAGE_SIZE = 5;
  const [currentPage, setCurrentPage] = useState(1);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Articles the validator flagged FAILED, within the current date scope. Drawn
  // from archivedArticles (which already includes this session's synced items),
  // so backfilled old content and freshly flagged content share one tab.
  const needsReview = useMemo(
    () => archivedArticles.filter((a) => a.status === "FAILED"),
    [archivedArticles],
  );

  const listArticles = useMemo(() => {
    // The archive list is already date-scoped by the server fetch, so the
    // "archived" tab renders it as-is; "newly-synced" is this session's results,
    // and "needs-review" is the date-scoped articles the validator flagged.
    if (activeTab === "newly-synced") return newlySynced;
    if (activeTab === "needs-review") return needsReview;
    return archivedArticles;
  }, [activeTab, archivedArticles, newlySynced, needsReview]);

  // Reset paging whenever the view (tab or date filter) changes. Done during
  // render (not in an effect) per React's "adjusting state on prop change"
  // guidance, so it applies before paint without an extra commit.
  const viewKey = `${activeTab}|${startDate}|${endDate}`;
  const [prevViewKey, setPrevViewKey] = useState(viewKey);
  if (viewKey !== prevViewKey) {
    setPrevViewKey(viewKey);
    setCurrentPage(1);
  }

  // Clamp the page during render so a shrinking list (e.g. the sync resetting
  // newlySynced to []) can never strand the view on a now-empty page.
  const totalPages = Math.max(1, Math.ceil(listArticles.length / PAGE_SIZE));
  const clampedPage = Math.min(currentPage, totalPages);
  if (clampedPage !== currentPage) {
    setCurrentPage(clampedPage);
  }

  const [readingArticlePath, setReadingArticlePath] = useState<string | null>(
    null,
  );
  const [articleContent, setArticleContent] = useState<ArticleDetails | null>(
    null,
  );
  const [isLoadingArticle, setIsLoadingArticle] = useState(false);
  const [articleError, setArticleError] = useState(false);
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

  async function handleGoogleLoginResponse(response: GoogleCredentialResponse) {
    const idToken = response.credential;
    if (!idToken) return;

    let email: string | null = null;
    try {
      const payload = JSON.parse(atob(idToken.split(".")[1]));
      email = payload.email ?? null;
    } catch (e) {
      console.error("Failed to parse ID token payload", e);
      return;
    }

    // Verify the account against the server allow-list before trusting the
    // session, so a disallowed email never reaches a logged-in state — we bounce
    // it straight back to the login screen instead of showing the email.
    try {
      const res = await fetch("/api/auth/verify", {
        headers: { "X-Google-ID-Token": idToken },
      });
      if (!res.ok) {
        const reason = await res
          .json()
          .then((d) => d?.reason as string | undefined)
          .catch(() => undefined);
        if (res.status === 403) {
          console.warn(`Login denied — ไม่อนุญาต (${reason}): ${email}`);
          addLog(
            `❌ อีเมล ${email ?? "นี้"} ไม่ได้รับอนุญาตให้ใช้งานระบบ — กรุณาเข้าสู่ระบบด้วยบัญชีที่ได้รับสิทธิ์`,
          );
        } else {
          console.warn(`Login rejected (${reason}): ${email}`);
          addLog(
            "❌ เซสชันไม่ถูกต้องหรือหมดอายุ — กรุณาเข้าสู่ระบบใหม่อีกครั้ง",
          );
        }
        handleSignOut();
        return;
      }
    } catch (e) {
      // Network/verify failure: the email wasn't rejected, the check just didn't
      // run. Fail closed (don't show the email) but say so accurately.
      console.error("Auth verify failed", e);
      addLog(
        "❌ ไม่สามารถตรวจสอบสิทธิ์การเข้าสู่ระบบได้ — กรุณาลองใหม่อีกครั้ง",
      );
      handleSignOut();
      return;
    }

    setGoogleIdToken(idToken);
    setUserEmail(email);
    localStorage.setItem("google_id_token", idToken);
    if (email) localStorage.setItem("google_user_email", email);
  }

  function handleSignOut() {
    setGoogleIdToken(null);
    setUserEmail(null);
    localStorage.removeItem("google_id_token");
    localStorage.removeItem("google_user_email");
  }

  // Returns true if a Google ID token (JWT) is missing, malformed, or past its exp.
  function isTokenExpired(idToken: string): boolean {
    try {
      const payload = JSON.parse(atob(idToken.split(".")[1]));
      if (typeof payload.exp !== "number") return true;
      return Date.now() >= payload.exp * 1000;
    } catch {
      return true;
    }
  }

  // Load Google Identity Services dynamically
  useEffect(() => {
    const token = localStorage.getItem("google_id_token");
    const email = localStorage.getItem("google_user_email");
    if (token && email && !isTokenExpired(token)) {
      setTimeout(() => {
        setGoogleIdToken(token);
        setUserEmail(email);
      }, 0);
    } else {
      // Stale or timed-out session: drop it so the email isn't shown.
      localStorage.removeItem("google_id_token");
      localStorage.removeItem("google_user_email");
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

  async function handleCopyShareLink() {
    if (!readingArticlePath) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?article=${encodeURIComponent(readingArticlePath)}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        // The async Clipboard API is undefined in non-secure (http) contexts;
        // fall back to a hidden textarea + execCommand so copy still works.
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("execCommand copy failed");
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Copy failed", e);
      addLog("⚠️ คัดลอกลิงก์ไม่สำเร็จ");
    }
  }

  const loadArticleContent = useCallback(
    async (path: string, signal?: AbortSignal) => {
      try {
        setIsLoadingArticle(true);
        setArticleError(false);
        const res = await fetch(
          `/api/article?filePath=${encodeURIComponent(path)}`,
          { signal },
        );
        if (signal?.aborted) return;
        if (res.ok) {
          const data = await res.json();
          if (signal?.aborted) return;
          setArticleContent(data);
        } else {
          setArticleError(true);
          addLog(`❌ โหลดบทความล้มเหลว: ${path}`);
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        console.error(e);
        setArticleError(true);
        addLog(`❌ เกิดข้อผิดพลาดในการโหลดบทความ: ${path}`);
      } finally {
        if (!signal?.aborted) setIsLoadingArticle(false);
      }
    },
    [addLog],
  );

  // Fetch article content on path update. Guard against out-of-order responses:
  // a rapid path change A→B must not let A's slower response render under B's
  // URL. Abort the in-flight fetch and cancel the deferred call on cleanup.
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    if (readingArticlePath) {
      const path = readingArticlePath;
      timer = setTimeout(() => {
        // Clear any prior article so a slow load can't flash stale content.
        setArticleContent(null);
        setArticleError(false);
        loadArticleContent(path, controller.signal);
      }, 0);
    } else {
      timer = setTimeout(() => {
        setArticleContent(null);
        setArticleError(false);
        setIsLoadingArticle(false);
      }, 0);
    }
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
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
    async (start?: string, end?: string, signal?: AbortSignal) => {
      try {
        setLoadingInitial(true);
        setArchiveError(false);
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

        const res = await fetch(`/api/articles?from=${from}&to=${to}`, {
          signal,
        });
        // Only the latest request may commit state — a stale (superseded) fetch
        // that resolves late is dropped here.
        if (signal?.aborted) return;
        if (res.ok) {
          const data = await res.json();
          if (signal?.aborted) return;
          const sorted = (data.articles || []).sort(
            (a: Article, b: Article) =>
              new Date(b.date).getTime() - new Date(a.date).getTime(),
          );
          setArchivedArticles(sorted);
        } else {
          setArchiveError(true);
          addLog("ระบบเกิดข้อผิดพลาดในการโหลดบทความที่บันทึกไว้");
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        console.error(e);
        setArchiveError(true);
        addLog("ไม่สามารถติดต่อเซิร์ฟเวอร์เพื่อโหลดบทความเก่าได้");
      } finally {
        if (!signal?.aborted) setLoadingInitial(false);
      }
    },
    [addLog],
  );

  // Load the archive on mount and whenever the date filter changes. The
  // controller aborts the previous request so a two-click range pick (which
  // fires two fetches) can't render the slower response's results.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchArchivedArticles(
        startDate || undefined,
        endDate || undefined,
        controller.signal,
      );
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fetchArchivedArticles, startDate, endDate]);

  // Auto-scroll terminal logs to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  async function handleSync() {
    if (isSyncing || isImporting) return;

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

      for (let i = 0; i < newArticles.length; i++) {
        if (isCancelledRef.current) {
          throw new DOMException("Aborted by user", "AbortError");
        }

        const article = newArticles[i];
        const stepWeight = 85 / newArticles.length;
        const currentBaseProgress = 15 + i * stepWeight;

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
            // Prefer the breadcrumb hierarchy /api/translate derived from the
            // page; fall back to the scraped listing values when it's empty.
            category: transData.category || article.category,
            subcategory: transData.subcategory || article.subcategory,
            // Persist the validator's result and flag the catalog entry.
            validation: transData.validation,
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

        const syncedArticle: Article = {
          url: article.url,
          title_en: article.title_en,
          title_th: transData.title_th,
          date: article.date,
          category: saveData.entry?.category ?? article.category,
          subcategory: saveData.entry?.subcategory ?? article.subcategory,
          filePath: saveData.filePath,
          // Carry the validation flag so it rides into the per-day index and the
          // session's in-memory lists (powering the "Needs review" tab).
          status: saveData.entry?.status,
          failures: saveData.entry?.failures,
        };

        // Dedupe before prepending: re-syncing an article (e.g. after an index
        // write failed on the first pass) would otherwise insert a second card
        // with the same React key.
        const dedupePrepend = (prev: Article[]) => [
          syncedArticle,
          ...prev.filter(
            (a) =>
              a.filePath !== syncedArticle.filePath &&
              a.url !== syncedArticle.url,
          ),
        ];
        setNewlySynced(dedupePrepend);
        setArchivedArticles(dedupePrepend);

        // Write this article's entry to its per-day index.json immediately,
        // right after the save succeeds (the index points at the saved file).
        // Writing per article instead of one batch at the end means a cancel or
        // crash mid-run leaves every already-translated article indexed. A
        // failed index write only costs a re-translation next sync (dedup
        // self-heals), so we warn and keep going.
        try {
          const indexRes = await fetch("/api/index", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Google-ID-Token": googleIdToken || "",
            },
            body: JSON.stringify({ entries: [syncedArticle] }),
            signal: controller.signal,
          });
          if (!indexRes.ok) {
            throw new Error(`Status ${indexRes.status}`);
          }
          addLog("🗂️ อัปเดตดัชนีคลังบทความแล้ว");
        } catch (e) {
          if (isCancelledRef.current) {
            throw new DOMException("Aborted by user", "AbortError");
          }
          const msg = e instanceof Error ? e.message : String(e);
          addLog(
            `⚠️ อัปเดตดัชนีคลังล้มเหลว (${msg}) — บทความถูกบันทึกแล้ว ระบบจะเพิ่มลงดัชนีอัตโนมัติในการซิงค์ครั้งถัดไป`,
          );
        }

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
      setIsSyncing(false);
      setIsCancelling(false);
      abortControllerRef.current = null;
    }
  }

  // Import a single article by its URL — one handleSync iteration without the
  // scrape: translate → save → index, then surface it like a synced article.
  async function handleImportUrl() {
    if (isImporting || isSyncing) return;

    const url = importUrl.trim();
    if (!url) return;

    // The link must be an article URL ending in /<id>.html — that's the shape
    // /api/save needs to derive the article ID and the date parser expects.
    // Reject a section page or a fat-fingered paste before hitting the network.
    if (!/^https?:\/\/.+\/\d+\.html(?:[?#].*)?$/i.test(url)) {
      addLog(
        "❌ ลิงก์ไม่ถูกต้อง — กรุณาวางลิงก์บทความของ Minghui ที่ลงท้ายด้วยรหัสบทความ เช่น .../234818.html",
      );
      return;
    }

    setIsImporting(true);
    setActiveTab("newly-synced");

    try {
      addLog(`กำลังนำเข้าบทความจากลิงก์: ${url}`);
      setStatusMessage("กำลังนำเข้าบทความจากลิงก์...");

      const date = parseDateFromArticleUrl(url);

      const transRes = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Google-ID-Token": googleIdToken || "",
        },
        body: JSON.stringify({ url }),
      });
      if (transRes.status === 401 || transRes.status === 403) {
        throw new Error(`Unauthorized:${transRes.status}`);
      }
      if (!transRes.ok) {
        const detail = await transRes
          .json()
          .then((d) => (d?.error ? `: ${d.error}` : ""))
          .catch(() => "");
        throw new Error(
          `แปลบทความไม่สำเร็จ (สถานะ ${transRes.status})${detail}`,
        );
      }

      const transData = await transRes.json();
      addLog(`✨ แปลสำเร็จ: "${transData.title_th}"`);

      setStatusMessage(`กำลังบันทึก: ${transData.title_th}`);
      addLog("กำลังบันทึกบทความลง Google Drive...");

      const saveRes = await fetch("/api/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Google-ID-Token": googleIdToken || "",
        },
        body: JSON.stringify({
          url,
          title_en: transData.title_en,
          title_th: transData.title_th,
          content_en: transData.content_en,
          content_th: transData.content_th,
          date,
          // A manual import can be from any Minghui section, so trust the
          // breadcrumb hierarchy /api/translate read off the page. If the page
          // had no breadcrumb, /api/save falls back to "Cultivation".
          category: transData.category,
          subcategory: transData.subcategory,
          validation: transData.validation,
        }),
      });
      if (saveRes.status === 401 || saveRes.status === 403) {
        throw new Error(`Unauthorized:${saveRes.status}`);
      }
      if (!saveRes.ok) {
        const detail = await saveRes
          .json()
          .then((d) => (d?.error ? `: ${d.error}` : ""))
          .catch(() => "");
        throw new Error(
          `บันทึกบทความไม่สำเร็จ (สถานะ ${saveRes.status})${detail}`,
        );
      }

      const saveData = await saveRes.json();
      addLog(`💾 บันทึกสำเร็จ: ${saveData.filePath}`);

      const importedArticle: Article = {
        url,
        title_en: transData.title_en,
        title_th: transData.title_th,
        date,
        category: saveData.entry?.category ?? "Cultivation",
        subcategory: saveData.entry?.subcategory ?? transData.subcategory,
        filePath: saveData.filePath,
        status: saveData.entry?.status,
        failures: saveData.entry?.failures,
      };

      // Dedupe before prepending so re-importing the same URL can't double-insert
      // a card with the same React key (matches the sync loop's behavior).
      const dedupePrepend = (prev: Article[]) => [
        importedArticle,
        ...prev.filter(
          (a) =>
            a.filePath !== importedArticle.filePath &&
            a.url !== importedArticle.url,
        ),
      ];
      setNewlySynced(dedupePrepend);
      setArchivedArticles(dedupePrepend);

      // Write the per-day index entry. A failed index write only costs a
      // re-translation on the next sync (dedup self-heals), so warn and continue.
      try {
        const indexRes = await fetch("/api/index", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Google-ID-Token": googleIdToken || "",
          },
          body: JSON.stringify({ entries: [importedArticle] }),
        });
        if (!indexRes.ok) {
          throw new Error(`Status ${indexRes.status}`);
        }
        addLog("🗂️ อัปเดตดัชนีคลังบทความแล้ว");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog(
          `⚠️ อัปเดตดัชนีคลังล้มเหลว (${msg}) — บทความถูกบันทึกแล้ว ระบบจะเพิ่มลงดัชนีอัตโนมัติในการซิงค์ครั้งถัดไป`,
        );
      }

      setStatusMessage("นำเข้าบทความเสร็จสมบูรณ์!");
      addLog("🎉 นำเข้าบทความจากลิงก์เสร็จสมบูรณ์แล้ว!");
      setImportUrl("");
    } catch (error) {
      const err = error as Error;
      console.error(err);
      const authMatch = err.message?.match(/Unauthorized:(\d+)/);
      if (authMatch) {
        if (authMatch[1] === "403") {
          addLog(
            `❌ อีเมล ${userEmail ?? "นี้"} ไม่อยู่ในรายชื่อที่ได้รับอนุญาตให้ใช้งานระบบ — โปรดติดต่อผู้ดูแลเพื่อขอสิทธิ์`,
          );
          setStatusMessage("อีเมลไม่ได้รับอนุญาต");
        } else {
          addLog(
            "❌ เซสชันหมดอายุหรือไม่ถูกต้อง — กรุณากด Sign Out แล้วลงชื่อเข้าใช้ใหม่อีกครั้ง",
          );
          setStatusMessage("เซสชันหมดอายุ");
        }
      } else {
        setStatusMessage("เกิดข้อผิดพลาดในการนำเข้าบทความ");
        addLog(`❌ ข้อผิดพลาด: ${err.message || String(err)}`);
      }
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#060913] text-[#f8fafc] font-sans selection:bg-teal-500 selection:text-slate-950 relative overflow-x-hidden">
      <div className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] bg-teal-500/[0.03] rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[20%] right-[10%] w-[600px] h-[600px] bg-indigo-500/[0.03] rounded-full blur-[150px] pointer-events-none" />

      <Header googleIdToken={googleIdToken} userEmail={userEmail} />

      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 relative z-10">
        {newCount !== null && (
          <div
            className={`mb-6 p-4 rounded-2xl border flex items-center justify-between animate-fade-in ${
              newCount > 0
                ? "bg-teal-500/10 border-teal-500/20 text-teal-300"
                : "bg-slate-900/40 border-slate-900 text-slate-400"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-2 w-2 relative">
                {newCount > 0 && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-teal-400" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${newCount > 0 ? "bg-teal-500" : "bg-slate-600"}`}
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
            needsReview={needsReview}
            listArticles={listArticles}
            currentPage={clampedPage}
            setCurrentPage={setCurrentPage}
            pageSize={PAGE_SIZE}
            totalPages={totalPages}
            loadingInitial={loadingInitial}
            archiveError={archiveError}
            onRetryArchive={() =>
              fetchArchivedArticles(
                startDate || undefined,
                endDate || undefined,
              )
            }
            scrollContainerRef={scrollContainerRef}
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
            importUrl={importUrl}
            setImportUrl={setImportUrl}
            isImporting={isImporting}
            handleImportUrl={handleImportUrl}
          />
        </div>
      </main>

      {readingArticlePath && (
        <ArticleReader
          articleContent={articleContent}
          isLoadingArticle={isLoadingArticle}
          articleError={articleError}
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
