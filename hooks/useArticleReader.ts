"use client";

import { useCallback, useEffect, useState } from "react";
import type { ArticleDetails } from "@/components/types";

/**
 * Owns the article reader: which article is open (synced to the `?article=` URL
 * param, with back/forward support), its fetched content + load state, the
 * th/en/both language toggle, and copy-share-link. `addLog` surfaces load errors
 * to the dashboard console.
 */
export function useArticleReader(addLog: (message: string) => void) {
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
  const [copied, setCopied] = useState(false);

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

  return {
    readingArticlePath,
    articleContent,
    isLoadingArticle,
    articleError,
    readerLanguage,
    setReaderLanguage,
    openArticle,
    closeArticle,
    handleCopyShareLink,
    copied,
  };
}
