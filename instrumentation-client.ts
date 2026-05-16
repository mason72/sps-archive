/**
 * Sentry browser SDK initialization. Next.js auto-loads this file in the
 * client bundle when it exists. No-ops when NEXT_PUBLIC_SENTRY_DSN isn't
 * set, so adding Sentry is a pure env-var change later.
 */
import * as Sentry from "@sentry/nextjs";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    tracesSampleRate: parseFloat(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || "0.1"
    ),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: parseFloat(
      process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE || "0"
    ),
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
    enabled:
      process.env.NODE_ENV !== "development" ||
      !!process.env.NEXT_PUBLIC_SENTRY_ENABLE_DEV,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
