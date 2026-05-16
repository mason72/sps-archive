import type { NextConfig } from "next";

/**
 * Build the Image Optimizer remotePattern for R2.
 *
 * - When `R2_PUBLIC_URL` is configured (recommended), restrict to that
 *   specific hostname so we don't accept arbitrary R2 tenants.
 * - When `R2_ACCOUNT_ID` is set, restrict to that account's
 *   *.r2.cloudflarestorage.com subdomain.
 * - Otherwise fall back to the broader pattern (dev convenience). In
 *   production at least one of those env vars MUST be set.
 */
function r2RemotePatterns() {
  const patterns: Array<{ protocol: "https"; hostname: string }> = [];
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (publicUrl) {
    try {
      patterns.push({ protocol: "https", hostname: new URL(publicUrl).hostname });
    } catch {
      // ignore malformed env
    }
  }
  const accountId = process.env.R2_ACCOUNT_ID;
  if (accountId) {
    patterns.push({
      protocol: "https",
      hostname: `${accountId}.r2.cloudflarestorage.com`,
    });
  }
  if (patterns.length === 0) {
    patterns.push(
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "*.r2.dev" }
    );
  }
  return patterns;
}

/**
 * Strict-ish Content-Security-Policy for the app surface.
 *
 * - `'unsafe-inline'` on script/style is unavoidable for Next.js's
 *   inlined hydration scripts and Tailwind's runtime style injection.
 * - `img-src` allows our R2 host + data URLs (used by canvas-confetti
 *   and inline SVGs).
 * - `connect-src` allows Supabase, R2, and Inngest endpoints.
 * - `frame-ancestors 'none'` mirrors X-Frame-Options DENY; overridden
 *   for /gallery routes below.
 */
function appCsp(): string {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com https://*.r2.dev",
    "media-src 'self' blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "connect-src 'self' https://*.supabase.co https://*.supabase.in https://*.r2.cloudflarestorage.com https://*.r2.dev https://api.resend.com https://api.stripe.com https://inn.gs https://*.inngest.com",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
  ];
  return directives.join("; ");
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: r2RemotePatterns(),
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "geolocation=(), microphone=(), camera=(), fullscreen=(self), display-capture=(), payment=()",
          },
          { key: "Content-Security-Policy", value: appCsp() },
        ],
      },
      {
        // Gallery embeds can be framed (for client portfolio sites). Override
        // both X-Frame-Options and the CSP frame-ancestors directive.
        source: "/gallery/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: appCsp().replace(
              "frame-ancestors 'none'",
              "frame-ancestors 'self'"
            ),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
