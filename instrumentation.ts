/**
 * Next.js Instrumentation hook — runs once per server cold-start.
 *
 * Initializes Sentry when a DSN is configured; otherwise no-op. Keeping
 * the config minimal and gated on env means Sentry is purely opt-in —
 * shipping this file doesn't force every deploy to talk to Sentry.
 */
import * as Sentry from "@sentry/nextjs";

const SERVER_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

export async function register() {
  if (!SERVER_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: SERVER_DSN,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
      // Don't dial home from local dev unless explicitly enabled
      enabled: process.env.NODE_ENV !== "development" || !!process.env.SENTRY_ENABLE_DEV,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: SERVER_DSN,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
      enabled: process.env.NODE_ENV !== "development" || !!process.env.SENTRY_ENABLE_DEV,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
