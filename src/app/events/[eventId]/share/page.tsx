"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/layout/AppNav";
import { Footer } from "@/components/layout/Footer";
import { useAuth } from "@/components/auth/AuthProvider";
import { BrandButton } from "@/components/ui/brand-button";
import { ShareChecklist } from "@/components/shares/ShareChecklist";
import { EmailPreview } from "@/components/email/EmailPreview";
import { EmailEditor, type EmailEditorHandle } from "@/components/email/EmailEditor";
import { interpolateTemplate } from "@/lib/email/interpolate";
import { toast } from "sonner";
import {
  ArrowLeft,
  Copy,
  Check,
  Mail,
  ChevronRight,
  Send,
  Link2,
} from "lucide-react";
import type { EmailTemplate } from "@/types/email";
import { TEMPLATE_VARIABLES } from "@/types/email";
import type { Branding } from "@/types/user-profile";
import { DEFAULT_BRANDING } from "@/types/user-profile";

type Step = "template" | "compose";

/** Suspense wrapper required for useSearchParams in Next.js 14+ */
export default function ShareComposeWrapper() {
  return (
    <Suspense>
      <ShareComposePage />
    </Suspense>
  );
}

function ShareComposePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();

  // Share state
  const [shareSlug, setShareSlug] = useState(searchParams.get("slug") || "");
  const [eventName, setEventName] = useState("");
  const [copied, setCopied] = useState(false);

  // Template + compose state
  const [step, setStep] = useState<Step>("template");
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const editorRef = useRef<EmailEditorHandle | null>(null);
  const creatingShareRef = useRef(false);

  // Branding
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [businessName, setBusinessName] = useState("");
  const [photographerName, setPhotographerName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // Post-send success state — replaces the previous router.push() so the
  // photographer gets a confirmation moment with the sent details visible.
  interface SendReceipt {
    sentAt: string;
    recipients: string[];
    failed: string[];
    preview: string[];
    subject: string;
    providerConfigured: boolean;
  }
  const [sendReceipt, setSendReceipt] = useState<SendReceipt | null>(null);

  useEffect(() => {
    if (!user) {
      router.push("/login");
      return;
    }
  }, [user, router]);

  // Load event, templates, branding, and ensure share exists
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      try {
        const [eventRes, templatesRes, accountRes, sharesRes] =
          await Promise.all([
            fetch(`/api/events/${eventId}`),
            fetch("/api/emails/templates"),
            fetch("/api/account"),
            fetch(`/api/shares?eventId=${eventId}`),
          ]);

        // Event name
        if (eventRes.ok) {
          const data = await eventRes.json();
          setEventName(data.event?.name || "Untitled Event");
        }

        // Templates
        if (templatesRes.ok) {
          const data = await templatesRes.json();
          setTemplates(data.templates || []);
        }

        // Branding
        if (accountRes.ok) {
          const data = await accountRes.json();
          if (data.profile?.branding) {
            setBranding({ ...DEFAULT_BRANDING, ...data.profile.branding });
          }
          if (data.profile?.businessName) setBusinessName(data.profile.businessName);
          if (data.profile?.displayName) setPhotographerName(data.profile.displayName);
          if (data.profile?.logoUrl) setLogoUrl(data.profile.logoUrl);
        }

        // Share slug — use existing or create
        if (sharesRes.ok) {
          const data = await sharesRes.json();
          const active = (data.shares || []).find(
            (s: { isActive: boolean; shareType: string }) =>
              s.isActive && s.shareType === "full"
          );
          if (active) {
            setShareSlug(active.slug);
          } else if (!creatingShareRef.current) {
            // Auto-create a share (guarded against duplicate creation).
            // Pass useEventDefaults: true so the photographer's configured
            // password/expiry/PIN from the Design panel actually apply.
            // Pre-fix this dropped them silently, surprising photographers
            // who'd set a password and then watched Publish ship an
            // unprotected public link.
            creatingShareRef.current = true;
            const createRes = await fetch("/api/shares", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ eventId, useEventDefaults: true }),
            });
            if (createRes.ok) {
              const created = await createRes.json();
              setShareSlug(created.share.slug);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load share compose data:", err);
      } finally {
        setIsLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const galleryUrl = shareSlug
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/gallery/${shareSlug}`
    : "";

  /**
   * Template variables used for the right-rail preview.
   *
   * IMPORTANT: `gallery_link` is the RAW URL, not a pre-wrapped anchor.
   * The send route's `wrapGalleryLinkAsAnchor` step adds the <a> tags
   * server-side when wrapping the body in branded chrome — pre-wrapping
   * here would produce nested <a href="<a href=...">…</a></a> garbage
   * in the delivered email (the original "janky email" bug).
   *
   * `client_name` previews as "{first recipient's local-part}" so the
   * photographer can see what personalization will look like. The send
   * route resolves it per-recipient at delivery time.
   */
  const firstRecipientLocalPart = recipients
    .split(/[,;\n]+/)
    .map((r) => r.trim())
    .find((r) => r.includes("@"))
    ?.split("@")[0];

  const templateVars: Record<string, string> = {
    event_name: eventName,
    gallery_link: galleryUrl,
    business_name: businessName || "Your Business",
    photographer_name: photographerName || "Photographer",
    client_name: firstRecipientLocalPart || "Sarah",
  };

  const interpolatedSubject = interpolateTemplate(subject, templateVars);
  // Body preview shows the gallery URL anchored (matching what we'll
  // actually ship). We do the same auto-anchor pass the server does so
  // the preview is faithful to the delivered email.
  const previewBody = (() => {
    const interpolated = interpolateTemplate(body, templateVars);
    if (!galleryUrl) return interpolated;
    const escaped = galleryUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<!href=")${escaped}(?!")`, "g");
    return interpolated.replace(
      re,
      `<a href="${galleryUrl}" style="color:#1c1917;text-decoration:underline;">${galleryUrl}</a>`
    );
  })();

  const handleCopyLink = useCallback(() => {
    if (!galleryUrl) return;
    navigator.clipboard.writeText(galleryUrl);
    setCopied(true);
    toast.success("Gallery link copied");
    setTimeout(() => setCopied(false), 2000);
  }, [galleryUrl]);

  const selectTemplate = useCallback(
    (template: EmailTemplate) => {
      setSubject(template.subject);
      setBody(template.bodyHtml);
      setStep("compose");
    },
    []
  );

  const handleSend = useCallback(async () => {
    const recipientList = recipients
      .split(/[,;\n]+/)
      .map((r) => r.trim())
      .filter((r) => r.includes("@"));

    if (recipientList.length === 0) {
      toast.error("Add at least one recipient email address");
      return;
    }

    setIsSending(true);
    try {
      // Send the RAW subject + body (with template variables) plus the
      // ambient context (galleryUrl, eventName). The server resolves
      // per-recipient personalization and wraps in branded chrome.
      const res = await fetch("/api/emails/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: recipientList,
          subject,
          bodyHtml: body,
          eventId,
          galleryUrl,
          eventName,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to send email");
        return;
      }

      const data = (await res.json()) as {
        sent: number;
        failed: number;
        preview: number;
        results: { email: string; status: string; error?: string }[];
        providerConfigured: boolean;
      };

      // Honest signaling — don't conflate preview (no provider) with sent.
      if (data.preview > 0 && data.sent === 0) {
        toast(
          `Email preview saved — provider not configured (${data.preview} ${
            data.preview === 1 ? "recipient" : "recipients"
          })`,
          { duration: 5000 }
        );
      } else if (data.sent > 0 && data.failed === 0) {
        toast.success(
          `Email sent to ${data.sent} ${data.sent === 1 ? "recipient" : "recipients"}`
        );
      } else if (data.sent > 0 && data.failed > 0) {
        toast(
          `Sent to ${data.sent}, ${data.failed} failed — check the receipt below.`,
          { duration: 5000 }
        );
      } else if (data.failed > 0) {
        toast.error(`Failed to send to ${data.failed} ${data.failed === 1 ? "recipient" : "recipients"}`);
      }

      // Show the post-send receipt in place — no more router.push that
      // strips the photographer's confirmation moment.
      setSendReceipt({
        sentAt: new Date().toISOString(),
        recipients: data.results
          .filter((r) => r.status === "sent")
          .map((r) => r.email),
        failed: data.results
          .filter((r) => r.status === "failed")
          .map((r) => r.email),
        preview: data.results
          .filter((r) => r.status === "preview")
          .map((r) => r.email),
        subject: interpolatedSubject,
        providerConfigured: data.providerConfigured,
      });
    } catch (err) {
      console.error("Send error:", err);
      toast.error("Failed to send email");
    } finally {
      setIsSending(false);
    }
  }, [
    recipients,
    subject,
    body,
    interpolatedSubject,
    eventId,
    galleryUrl,
    eventName,
  ]);

  /** Reset the compose state so the photographer can send another. */
  const handleSendAnother = useCallback(() => {
    setSendReceipt(null);
    setRecipients("");
    // Keep subject + body so a quick follow-up doesn't require re-picking
    // the template; photographers often send the same gallery to another
    // family member.
  }, []);

  if (!user) return null;

  return (
    <div className="min-h-screen">
      <AppNav
        active="events"
        actions={
          <Link
            href={`/events/${eventId}`}
            className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
          >
            ← Back to event
          </Link>
        }
      />

      <main className="px-8 md:px-16 pt-12 pb-24 max-w-5xl">
        {/* Header */}
        <div className="mb-10">
          <Link
            href={`/events/${eventId}`}
            className="label-caps text-accent hover:text-accent-hover transition-colors duration-300 mb-4 inline-flex items-center gap-1.5"
          >
            <ArrowLeft size={12} />
            {eventName || "Event"}
          </Link>
          <h1 className="font-editorial text-[clamp(32px,4vw,48px)] leading-[0.95] text-stone-900 reveal">
            Share Gallery
          </h1>
          <p className="caption-italic mt-3">
            Send your gallery link to clients via email or copy it directly.
          </p>
        </div>

        {isLoading ? (
          <div className="py-24 text-center">
            <p className="text-[13px] text-stone-400">Loading…</p>
          </div>
        ) : (
          <div className="reveal space-y-10">
            {/* ─── Pre-flight checklist — quietly confirms the gallery is
                ready before the photographer hits send (photos uploaded,
                processing done, branding set, password decided). */}
            <ShareChecklist eventId={eventId} />

            {/* ─── Copy Link Section ─── */}
            <section>
              <div className="editorial-divider mb-6">
                <span className="label-caps shrink-0">Gallery Link</span>
              </div>
              <div className="flex items-center gap-3 p-4 border border-stone-200 bg-stone-50">
                <Link2 size={16} className="text-stone-400 shrink-0" />
                <span className="text-[13px] text-stone-600 truncate flex-1 font-mono">
                  {galleryUrl || "Creating link…"}
                </span>
                <button
                  onClick={handleCopyLink}
                  disabled={!galleryUrl}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-medium border border-stone-200 text-stone-600 hover:border-stone-400 hover:text-stone-900 transition-all shrink-0"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </section>

            {/* ─── Email Section ─── */}
            <section>
              <div className="editorial-divider mb-6">
                <span className="label-caps shrink-0">
                  <Mail size={12} className="inline mr-2" />
                  Email to Clients
                </span>
              </div>

              {sendReceipt ? (
                <SendReceiptPanel
                  receipt={sendReceipt}
                  onSendAnother={handleSendAnother}
                  galleryUrl={galleryUrl}
                  onCopyLink={handleCopyLink}
                  copied={copied}
                />
              ) : step === "template" ? (
                /* Step 1: Select Template */
                <div>
                  <p className="text-[13px] text-stone-500 mb-4">
                    Choose a template to start with, or compose from scratch.
                  </p>
                  <div className="space-y-2">
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => selectTemplate(t)}
                        className="w-full text-left flex items-center gap-4 p-4 border border-stone-200 hover:border-stone-400 transition-all group"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-medium text-stone-900 truncate">
                            {t.name}
                          </p>
                          <p className="text-[12px] text-stone-400 truncate">
                            {t.subject || "No subject"}
                          </p>
                        </div>
                        <ChevronRight
                          size={16}
                          className="text-stone-300 group-hover:text-stone-500 transition-colors shrink-0"
                        />
                      </button>
                    ))}
                    <button
                      onClick={() => setStep("compose")}
                      className="w-full text-left flex items-center gap-4 p-4 border border-dashed border-stone-300 hover:border-stone-400 transition-all group"
                    >
                      <div className="flex-1">
                        <p className="text-[14px] font-medium text-stone-500">
                          Start from scratch
                        </p>
                        <p className="text-[12px] text-stone-400">
                          Write a custom email
                        </p>
                      </div>
                      <ChevronRight
                        size={16}
                        className="text-stone-300 group-hover:text-stone-500 transition-colors shrink-0"
                      />
                    </button>
                  </div>

                  {templates.length === 0 && (
                    <p className="text-[12px] text-stone-400 mt-4">
                      No templates yet.{" "}
                      <Link
                        href="/settings/emails"
                        className="text-accent hover:text-accent-hover transition-colors"
                      >
                        Create templates
                      </Link>{" "}
                      to speed up your workflow.
                    </p>
                  )}
                </div>
              ) : (
                /* Step 2: Compose + Send */
                <div>
                  <button
                    onClick={() => setStep("template")}
                    className="label-caps text-stone-400 hover:text-stone-700 transition-colors inline-flex items-center gap-1.5 mb-6"
                  >
                    <ArrowLeft size={12} />
                    Choose different template
                  </button>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Left: Form */}
                    <div className="space-y-6">
                      <div>
                        <label className="label-caps mb-2 block">
                          Recipients
                        </label>
                        <textarea
                          value={recipients}
                          onChange={(e) => setRecipients(e.target.value)}
                          placeholder="client@example.com, friend@example.com"
                          rows={2}
                          className="w-full text-[13px] text-stone-900 placeholder:text-stone-300 bg-transparent border border-stone-200 focus:border-stone-900 outline-none p-3 resize-none transition-colors"
                        />
                        <p className="text-[11px] text-stone-400 mt-1">
                          Separate multiple addresses with commas
                        </p>
                      </div>

                      <div>
                        <label className="label-caps mb-2 block">Subject</label>
                        <input
                          type="text"
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                          placeholder="Your photos are ready!"
                          className="w-full text-[14px] text-stone-900 placeholder:text-stone-300 bg-transparent border-b border-stone-200 focus:border-stone-900 outline-none py-2 transition-colors"
                        />
                      </div>

                      <div>
                        <label className="label-caps mb-2 block">Body</label>
                        <EmailEditor
                          value={body}
                          onChange={setBody}
                          editorRef={editorRef}
                          placeholder="Start writing your email…"
                        />
                      </div>

                      {/* Variable chips */}
                      <div>
                        <span className="label-caps mb-2 block">
                          Insert Variable
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {TEMPLATE_VARIABLES.map((v) => (
                            <button
                              key={v.key}
                              onClick={() => {
                                if (editorRef.current) {
                                  editorRef.current.insertContent(v.key);
                                } else {
                                  setBody((prev) => prev + v.key);
                                }
                              }}
                              className="px-2.5 py-1 text-[11px] font-mono border border-stone-200 text-stone-600 hover:border-accent hover:text-accent transition-all"
                              title={v.label}
                            >
                              {v.key}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Send button */}
                      <BrandButton
                        color="emerald"
                        celebrate
                        onClick={handleSend}
                        disabled={isSending || !recipients.trim()}
                      >
                        <Send size={14} />
                        {isSending ? "Sending…" : "Send Email"}
                      </BrandButton>
                    </div>

                    {/* Right: Live Preview */}
                    <div className="lg:sticky lg:top-20 lg:self-start">
                      <p className="label-caps mb-3">Preview</p>
                      <div className="border border-stone-100 bg-stone-50 p-1">
                        <EmailPreview
                          subject={interpolatedSubject}
                          bodyHtml={previewBody}
                          branding={branding}
                          businessName={businessName}
                          logoUrl={logoUrl}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

/**
 * Post-send confirmation panel. Replaces the previous router.push() that
 * stripped the "I sent it" moment. Shows recipients as initials, the
 * delivered subject, and two quiet actions: copy the link or send the
 * same email to another address.
 */
function SendReceiptPanel({
  receipt,
  onSendAnother,
  galleryUrl,
  onCopyLink,
  copied,
}: {
  receipt: {
    sentAt: string;
    recipients: string[];
    failed: string[];
    preview: string[];
    subject: string;
    providerConfigured: boolean;
  };
  onSendAnother: () => void;
  galleryUrl: string;
  onCopyLink: () => void;
  copied: boolean;
}) {
  const total =
    receipt.recipients.length + receipt.failed.length + receipt.preview.length;
  const allSent = receipt.failed.length === 0 && receipt.preview.length === 0;

  return (
    <div className="border border-stone-200 bg-white">
      {/* Header */}
      <div className="px-8 pt-8 pb-6 border-b border-stone-100">
        <div className="flex items-start gap-4">
          <div className="shrink-0 mt-1">
            {allSent ? (
              <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center">
                <Check size={16} className="text-emerald-600" strokeWidth={2.5} />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center">
                <Mail size={14} className="text-amber-600" strokeWidth={2} />
              </div>
            )}
          </div>
          <div className="flex-1">
            <p className="font-editorial text-[22px] text-stone-900 leading-tight">
              {allSent ? (
                <>Sent to {receipt.recipients.length}{" "}
                  <span className="italic font-normal">
                    {receipt.recipients.length === 1 ? "recipient" : "recipients"}
                  </span>
                </>
              ) : receipt.preview.length === total ? (
                <>Preview <span className="italic font-normal">saved</span></>
              ) : (
                <>Partially sent</>
              )}
            </p>
            <p className="text-[12px] text-stone-400 mt-1">
              {new Date(receipt.sentAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Recipient initials */}
      <div className="px-8 py-6">
        <p className="label-caps mb-3">Subject</p>
        <p className="text-[14px] text-stone-700 mb-6">{receipt.subject}</p>

        {receipt.recipients.length > 0 && (
          <>
            <p className="label-caps mb-3">Delivered to</p>
            <ul className="space-y-1.5 mb-6">
              {receipt.recipients.map((email) => (
                <li
                  key={email}
                  className="flex items-center gap-3 text-[13px] text-stone-600"
                >
                  <span className="inline-flex items-center justify-center w-7 h-7 bg-emerald-50 text-emerald-700 text-[10px] font-medium tracking-wide rounded-full uppercase shrink-0">
                    {email.slice(0, 2)}
                  </span>
                  {email}
                </li>
              ))}
            </ul>
          </>
        )}

        {receipt.preview.length > 0 && !receipt.providerConfigured && (
          <div className="mb-6 p-4 border border-amber-200 bg-amber-50">
            <p className="text-[12px] text-amber-900 leading-relaxed">
              <strong>{receipt.preview.length}</strong>{" "}
              {receipt.preview.length === 1 ? "address" : "addresses"} were
              previewed but not sent — your email provider isn&apos;t configured.
              Set <code className="font-mono">RESEND_API_KEY</code> to enable
              delivery.
            </p>
          </div>
        )}

        {receipt.failed.length > 0 && (
          <>
            <p className="label-caps mb-3 text-red-500">Failed</p>
            <ul className="space-y-1.5 mb-6">
              {receipt.failed.map((email) => (
                <li
                  key={email}
                  className="flex items-center gap-3 text-[13px] text-stone-600"
                >
                  <span className="inline-flex items-center justify-center w-7 h-7 bg-red-50 text-red-600 text-[10px] font-medium tracking-wide rounded-full uppercase shrink-0">
                    {email.slice(0, 2)}
                  </span>
                  {email}
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-stone-100">
          <button
            onClick={onCopyLink}
            className="flex items-center gap-1.5 px-4 py-2 text-[12px] uppercase tracking-[0.15em] font-medium border border-stone-200 text-stone-600 hover:border-stone-400 hover:text-stone-900 transition-all"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy link"}
          </button>
          <button
            onClick={onSendAnother}
            className="flex items-center gap-1.5 px-4 py-2 text-[12px] uppercase tracking-[0.15em] font-medium text-stone-500 hover:text-stone-900 transition-colors"
          >
            <Send size={12} />
            Send to someone else
          </button>
          <span className="ml-auto text-[11px] text-stone-300 font-mono truncate max-w-[200px]">
            {galleryUrl}
          </span>
        </div>
      </div>
    </div>
  );
}
