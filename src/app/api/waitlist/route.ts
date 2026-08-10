import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkAuthRateLimit, clientIp } from "@/lib/security/rate-limit";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * POST /api/waitlist — public application form on the marketing site.
 *
 * Defenses, in order: honeypot (the "company" field is invisible to humans —
 * a filled one gets a fake success), per-IP rate limit, then an
 * ignore-duplicates insert so re-applying is always a quiet success. The
 * response NEVER reveals whether an email was already known.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const workUrl =
      typeof body.workUrl === "string" && body.workUrl.trim()
        ? body.workUrl.trim().slice(0, 500)
        : null;
    const honeypot = typeof body.company === "string" && body.company.length > 0;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
    }
    if (honeypot) {
      // A bot filled the invisible field. Smile, nod, store nothing.
      return NextResponse.json({ ok: true });
    }

    const supabase = createServiceClient();
    if (!(await checkAuthRateLimit(supabase, "waitlist", email, clientIp(request)))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const { error } = await supabase
      .from("waitlist")
      .upsert(
        { email, work_url: workUrl },
        { onConflict: "email", ignoreDuplicates: true }
      );
    if (error) throw error;

    // Heads-up to the admin — best-effort, the application is already saved.
    const resendKey = process.env.RESEND_API_KEY;
    const notify = process.env.ADMIN_ALERT_EMAIL;
    if (resendKey && notify) {
      const esc = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `Pixeltrunk <${process.env.RESEND_FROM_EMAIL || "gallery@resend.dev"}>`,
          to: [notify],
          subject: `Waitlist application: ${email}`,
          html: `<p><strong>${esc(email)}</strong> asked for a Pixeltrunk invite.</p>
<p>Work: ${workUrl ? esc(workUrl) : "(not provided)"}</p>
<p>Review on <a href="https://app.pixeltrunk.com/ops">/ops</a>.</p>`,
        }),
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("waitlist.post", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
