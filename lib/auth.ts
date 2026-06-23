export async function verifyGoogleToken(idToken: string): Promise<string | null> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!res.ok) {
      console.error(`Tokeninfo endpoint returned status: ${res.status}`);
      return null;
    }
    const data = await res.json();
    
    // Verify audience matches our Client ID
    if (data.aud !== process.env.GOOGLE_CLIENT_ID) {
      console.error(`Token aud mismatch: expected ${process.env.GOOGLE_CLIENT_ID}, got ${data.aud}`);
      return null;
    }
    
    return data.email || null;
  } catch (e) {
    console.error('Error verifying Google ID token:', e);
    return null;
  }
}

export async function isAuthorized(req: Request): Promise<boolean> {
  // 1. Check Cron / Bearer token (for Vercel Cron)
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '').trim();
    if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) {
      return true;
    }
  }

  // 2. Check X-Google-ID-Token header (custom header sent from our UI)
  const googleToken = req.headers.get('X-Google-ID-Token');
  if (googleToken) {
    const email = await verifyGoogleToken(googleToken);
    if (email && email === process.env.ALLOWED_EMAIL) {
      return true;
    }
    console.warn(`Unauthorized email attempt: ${email}`);
  }

  return false;
}
