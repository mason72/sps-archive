/**
 * Tiny structured logger.
 *
 * Wraps console + (optionally) Sentry. Use this instead of bare console
 * calls so failures are searchable in production logs and routed to error
 * monitoring when configured.
 *
 *   log.error("upload/complete", "thumbnails failed", { imageId, eventId, err });
 *
 * The first arg is a short channel ("api/upload", "inngest/process",
 * "stripe-webhook") that prefixes the log line and gets attached as a
 * Sentry tag. The second is a human-readable message. The third is an
 * optional context object — `err` can be an Error instance and will be
 * forwarded to Sentry.captureException; other fields land as Sentry tags
 * / extras.
 */

import * as Sentry from "@sentry/nextjs";

type Context = Record<string, unknown> | undefined;

function format(channel: string, message: string, ctx?: Context): string {
  if (!ctx || Object.keys(ctx).length === 0) {
    return `[${channel}] ${message}`;
  }
  // err is rendered separately; everything else gets JSON-stringified.
  const { err: _err, ...rest } = ctx;
  void _err;
  const payload = Object.keys(rest).length > 0 ? " " + JSON.stringify(rest) : "";
  return `[${channel}] ${message}${payload}`;
}

function toSentry(level: "info" | "warning" | "error", channel: string, message: string, ctx?: Context) {
  // No-op when Sentry isn't initialized (its hub will simply discard).
  try {
    Sentry.withScope((scope) => {
      scope.setTag("channel", channel);
      if (ctx) {
        for (const [key, value] of Object.entries(ctx)) {
          if (key === "err") continue;
          // Tag short strings/numbers; everything else lands in extras.
          if (typeof value === "string" && value.length < 200) {
            scope.setTag(key, value);
          } else if (typeof value === "number" || typeof value === "boolean") {
            scope.setTag(key, String(value));
          } else {
            scope.setExtra(key, value);
          }
        }
      }
      const err = ctx?.err;
      if (err instanceof Error) {
        Sentry.captureException(err);
      } else if (level !== "info") {
        Sentry.captureMessage(message, level);
      }
    });
  } catch {
    // Never let logging blow up the caller.
  }
}

export const log = {
  info(channel: string, message: string, ctx?: Context) {
    console.log(format(channel, message, ctx));
    // info() doesn't ship to Sentry by default (too noisy); add `&& false`
    // off-switch wins if needed later.
  },

  warn(channel: string, message: string, ctx?: Context) {
    console.warn(format(channel, message, ctx));
    toSentry("warning", channel, message, ctx);
  },

  error(channel: string, message: string, ctx?: Context) {
    const formatted = format(channel, message, ctx);
    if (ctx?.err instanceof Error) {
      console.error(formatted, ctx.err);
    } else {
      console.error(formatted);
    }
    toSentry("error", channel, message, ctx);
  },
};
