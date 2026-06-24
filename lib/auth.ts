import { timingSafeEqual } from "node:crypto";

// Constant-time string compare so the shared CRON_SECRET check doesn't leak how
// many leading bytes matched via response timing. Length is compared first
// (timingSafeEqual throws on unequal-length buffers); that only leaks the
// secret's length, which is not sensitive.
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function verifyGoogleToken(
  idToken: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!res.ok) {
      console.error(`Tokeninfo endpoint returned status: ${res.status}`);
      return null;
    }
    const data = await res.json();

    // Verify audience matches our Client ID
    if (data.aud !== process.env.GOOGLE_CLIENT_ID) {
      console.error(
        `Token aud mismatch: expected ${process.env.GOOGLE_CLIENT_ID}, got ${data.aud}`,
      );
      return null;
    }

    return data.email || null;
  } catch (e) {
    console.error("Error verifying Google ID token:", e);
    return null;
  }
}

// Stable codes so the client can distinguish *why* a request was rejected
// and show the right guidance (re-login vs. ask the owner for access).
export type AuthReason =
  | "missing_session" // no token supplied
  | "invalid_session" // token absent/expired/invalid → user should sign in again
  | "not_allowed" // valid Google account, but not on the allow-list
  | "not_configured"; // server is missing ALLOWED_EMAIL

export type AuthResult =
  | { authorized: true }
  | { authorized: false; status: 401 | 403; reason: AuthReason };

export async function authorize(req: Request): Promise<AuthResult> {
  // 1. Check Cron / Bearer token (for Vercel Cron)
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    const token = authHeader.replace("Bearer ", "").trim();
    if (process.env.CRON_SECRET && safeEqual(token, process.env.CRON_SECRET)) {
      return { authorized: true };
    }
  }

  // 2. Check X-Google-ID-Token header (custom header sent from our UI)
  const googleToken = req.headers.get("X-Google-ID-Token");
  if (!googleToken) {
    return { authorized: false, status: 401, reason: "missing_session" };
  }

  const email = await verifyGoogleToken(googleToken);
  if (!email) {
    // Token couldn't be verified — expired, malformed, or wrong audience.
    return { authorized: false, status: 401, reason: "invalid_session" };
  }

  // ALLOWED_EMAIL may be a single address or a comma-separated allow-list.
  // Compare case-insensitively and trimmed (Google emails are case-insensitive).
  const allowed = (process.env.ALLOWED_EMAIL || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) {
    console.error(
      "ALLOWED_EMAIL is not set — refusing all sign-ins. Set ALLOWED_EMAIL to the owner's email in your environment.",
    );
    return { authorized: false, status: 403, reason: "not_configured" };
  }

  if (allowed.includes(email.toLowerCase())) {
    return { authorized: true };
  }

  console.warn(`Unauthorized email attempt: ${email}`);
  return { authorized: false, status: 403, reason: "not_allowed" };
}

/**
 * Boolean convenience wrapper around {@link authorize}.
 */
export async function isAuthorized(req: Request): Promise<boolean> {
  return (await authorize(req)).authorized;
}
