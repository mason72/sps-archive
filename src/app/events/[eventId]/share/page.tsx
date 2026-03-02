"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { useAuth } from "@/components/auth/AuthProvider";
import { BrandButton } from "@/components/ui/brand-button";
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
            // Auto-create a share (guarded against duplicate creation)
            creatingShareRef.current = true;
            const createRes = await fetch("/api/shares", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ eventId }),
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

  const templateVars: Record<string, string> = {
    event_name: eventName,
    gallery_link: galleryUrl ? `<a href="${galleryUrl}">${galleryUrl}</a>` : "",
    business_name: businessName || "Your Business",
    photographer_name: photographerName || "Photographer",
    client_name: "{client_name}",
  };

  const interpolatedSubject = interpolateTemplate(subject, {
    ...templateVars,
    gallery_link: galleryUrl,
  });
  const interpolatedBody = interpolateTemplate(body, templateVars);

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
      const res = await fetch("/api/emails/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: recipientList,
          subject: interpolatedSubject,
          bodyHtml: interpolatedBody,
          eventId,
        }),
      });

      if (!res.ok) throw new Error("Failed to send");
      toast.success(`Email sent to ${recipientList.length} recipient${recipientList.length > 1 ? "s" : ""}`);
      router.push(`/events/${eventId}`);
    } catch {
      toast.error("Failed to send email");
    } finally {
      setIsSending(false);
    }
  }, [recipients, interpolatedSubject, interpolatedBody, eventId, router]);

  if (!user) return null;

  return (
    <div className="min-h-screen">
      <Nav>
        <Link
          href={`/events/${eventId}`}
          className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
        >
          Back to Event
        </Link>
      </Nav>

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

              {step === "template" ? (
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
                          bodyHtml={interpolatedBody}
                          branding={branding}
                          businessName={businessName}
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
