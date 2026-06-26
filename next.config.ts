import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baseline security headers on every response. A full Content-Security-Policy
  // is intentionally NOT set here: it would need to allowlist the Google Identity
  // sign-in script + iframe (accounts.google.com/gsi), Google Fonts
  // (fonts.googleapis.com / fonts.gstatic.com), the hotlinked Minghui images
  // (en.minghui.org), and Tailwind's injected styles — getting it wrong silently
  // breaks login or rendering, so it's left for a dedicated, tested pass.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
