"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * Owns the Google Identity sign-in lifecycle: restoring a stored session,
 * loading the GIS script + rendering the button, verifying the account against
 * the server allow-list, and exposing sign-out. `addLog` surfaces status to the
 * dashboard console. Returns the active session (token + email) and sign-out.
 */
export function useGoogleAuth(addLog: (message: string) => void) {
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // GIS readiness + a handle to the loaded API, so the sign-in button can be
  // (re)rendered after sign-out — not just once on mount (see the effect below).
  const [gisReady, setGisReady] = useState(false);
  const googleApiRef = useRef<WindowWithGoogle["google"] | null>(null);

  // Stable (useCallback) so the mount-only bootstrap effect below can depend on
  // handleGoogleLoginResponse without re-injecting the Google SDK each render.
  const handleSignOut = useCallback(() => {
    setGoogleIdToken(null);
    setUserEmail(null);
    localStorage.removeItem("google_id_token");
    localStorage.removeItem("google_user_email");
  }, []);

  const handleGoogleLoginResponse = useCallback(
    async (response: GoogleCredentialResponse) => {
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
    },
    [addLog, handleSignOut],
  );

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
              // Stash the API and flag readiness; the button itself is drawn by the
              // effect below so it can be re-rendered after sign-out, not only here.
              googleApiRef.current = google;
              setGisReady(true);
            }
          };
        }
      })
      .catch((err) => console.error("Failed to load auth config:", err));
  }, [handleGoogleLoginResponse]);

  // Draw the Google button whenever we're signed out and GIS is ready. Keyed on
  // googleIdToken so signing out (token → null) re-renders it into the freshly
  // mounted container: renderButton is imperative and one-shot, so a mount-only
  // render would leave the button blank after the first sign-out.
  useEffect(() => {
    if (!gisReady || googleIdToken) return;
    const btn = document.getElementById("google-signin-btn");
    if (!btn) return;
    btn.innerHTML = "";
    googleApiRef.current?.accounts.id.renderButton(btn, {
      theme: "outline",
      size: "large",
    });
  }, [gisReady, googleIdToken]);

  return { googleIdToken, userEmail, handleSignOut };
}
