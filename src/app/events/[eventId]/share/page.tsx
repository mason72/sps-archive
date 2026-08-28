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
import {
  GuestListAttachment,
  type GuestListSelection,
} from "@/components/email/GuestListAttachment";
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
  Lock,
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
  const [sendCopy, setSendCopy] = useState(true);
  // The event's gallery password, if one is set. Owner-only screen — showing
  // the real value is the point (this is the email he's about to send).
  const [galleryPassword, setGalleryPassword] = useState("");
  const [downloadPin, setDownloadPin] = useState("");
  /** Include the download PIN. Independent of the password — a gallery often
   *  has one and not the other, and the PIN is one the guest gets ASKED for. */
  const [includePin, setIncludePin] = useState(true);
  const [includePassword, setIncludePassword] = useState(true);
  /** The SPS guest-list sheet. `token` is non-null only when one was attached
   *  in THIS session and the photographer wants it in this email. */
  const [guestList, setGuestList] = useState<GuestListSelection>({
    token: null,
    message: "",
  });
  // Stable identity: the child reports upward from an effect, and an inline
  // arrow here would make that effect fire on every render.
  const handleGuestList = useCallback((sel: GuestListSelection) => {
    setGuestList(sel);
  }, []);
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Composed covers (mosaic/solid) exist in the email only once the raster
   * job has rendered them. While it's pending the preview must SAY so, not
   * silently show a fallback frame — so poll readiness until the raster
   * lands, then cache-bust the hero <img> so the finished cover pops in.
   */
  const [coverComposing, setCoverComposing] = useState(false);
  const [coverBust, setCoverBust] = useState(0);
  const composingRef = useRef(false);
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/share-readiness`);
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as { coverComposing?: boolean };
        if (cancelled) return;
        const now = !!j.coverComposing;
        if (composingRef.current && !now) setCoverBust((b) => b + 1);
        composingRef.current = now;
        setCoverComposing(now);
        if (now) timer = setTimeout(check, 10_000);
      } catch {
        // Readiness is a convenience; the preview just keeps its last state.
      }
    };
    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [eventId]);
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
          const pw = data.event?.settings?.sharing?.password;
          if (typeof pw === "string" && pw.trim()) setGalleryPassword(pw.trim());
          // Only surface the PIN when a gate actually asks for one — a PIN
          // sitting in settings with both flags off protects nothing, and
          // offering to email it would be noise.
          const sharing = data.event?.settings?.sharing;
          const gated = !!(sharing?.requirePinBulk || sharing?.requirePinIndividual);
          const p = sharing?.downloadPin;
          if (gated && typeof p === "string" && p.trim()) setDownloadPin(p.trim());
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
    // Plain URL in the body; the email shell renders the prominent "View
    // Gallery" button, so a bare link in the text isn't needed.
    gallery_link: galleryUrl,
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
          galleryUrl,
          sendCopy,
          // Request only — the server reads the password itself and refuses
          // unless the verified share actually carries a hash.
          includePassword: !!galleryPassword && includePassword,
          // Separate flag: a share can have a PIN and no password.
          includePin,
          // The one credential the server CAN'T re-read — it stores only the
          // hash — so the composer presents it and the server verifies it.
          guestListToken: guestList.token,
          guestListMessage: guestList.message,
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
  }, [
    recipients,
    interpolatedSubject,
    interpolatedBody,
    eventId,
    galleryUrl,
    sendCopy,
    galleryPassword,
    includePassword,
    // Both were missing: a stale closure here sends the PIN flag and the
    // guest-list token as they were on first render, not as the photographer
    // left them.
    includePin,
    guestList,
    router,
  ]);

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

                      {/* ─── Include the gallery password ─── */}
                      {/* Only appears when the event actually has one — an
                          always-visible dead toggle teaches people to ignore it. */}
                      {galleryPassword && (
                        <div className="border border-stone-200 p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Lock size={13} className="text-stone-400 shrink-0" />
                                <span className="text-[13px] text-stone-700">
                                  Include the password
                                </span>
                              </div>
                              <p className="text-[11px] text-stone-400 mt-1 leading-relaxed">
                                This gallery is password-protected. Add it to the
                                email so your client isn&rsquo;t locked out.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setIncludePassword((v) => !v)}
                              role="switch"
                              aria-checked={includePassword}
                              aria-label="Include the gallery password in this email"
                              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 mt-0.5 ${
                                includePassword ? "bg-emerald-500" : "bg-stone-200"
                              }`}
                            >
                              <div
                                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                                  includePassword ? "translate-x-4" : ""
                                }`}
                              />
                            </button>
                          </div>
                          {includePassword && (
                            <div className="mt-3 pt-3 border-t border-stone-100 flex items-center gap-2">
                              <span className="text-[10px] uppercase tracking-[0.18em] text-stone-400">
                                Password
                              </span>
                              <span className="font-mono text-[13px] tracking-[0.1em] text-stone-900 truncate">
                                {galleryPassword}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ─── Include the download PIN ─── */}
                      {/* Same rule as the password above: only shown when the
                          gallery actually has a PIN gate. The toggle existed in
                          state but had no control, so includePin was pinned to
                          true with no way to turn it off. */}
                      {downloadPin && (
                        <div className="border border-stone-200 p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Lock size={13} className="text-stone-400 shrink-0" />
                                <span className="text-[13px] text-stone-700">
                                  Include the download PIN
                                </span>
                              </div>
                              <p className="text-[11px] text-stone-400 mt-1 leading-relaxed">
                                Downloads from this gallery ask for a PIN. Add it
                                to the email so your client can save their photos.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setIncludePin((v) => !v)}
                              role="switch"
                              aria-checked={includePin}
                              aria-label="Include the download PIN in this email"
                              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 mt-0.5 ${
                                includePin ? "bg-emerald-500" : "bg-stone-200"
                              }`}
                            >
                              <div
                                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                                  includePin ? "translate-x-4" : ""
                                }`}
                              />
                            </button>
                          </div>
                          {includePin && (
                            <div className="mt-3 pt-3 border-t border-stone-100 flex items-center gap-2">
                              <span className="text-[10px] uppercase tracking-[0.18em] text-stone-400">
                                PIN
                              </span>
                              <span className="font-mono text-[13px] tracking-[0.1em] text-stone-900 truncate">
                                {downloadPin}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ─── The SPS guest-list spreadsheet ─── */}
                      {/* Lives here and nowhere else: the email recipient is
                          the only person who ever gets a path to it. */}
                      <GuestListAttachment
                        eventId={eventId}
                        initial={guestList}
                        onChange={handleGuestList}
                      />

                      {/* Send me a copy */}
                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={sendCopy}
                          onChange={(e) => setSendCopy(e.target.checked)}
                          className="h-3.5 w-3.5 accent-emerald-600"
                        />
                        <span className="text-[13px] text-stone-600">
                          Send me a copy
                        </span>
                      </label>

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
                          coverImageUrl={
                            shareSlug
                              ? `/api/gallery/${shareSlug}/cover${coverBust ? `?v=${coverBust}` : ""}`
                              : undefined
                          }
                          coverComposing={coverComposing}
                          password={includePassword ? galleryPassword : null}
                          downloadPin={includePin ? downloadPin : null}
                          guestList={
                            guestList.token
                              ? { message: guestList.message }
                              : null
                          }
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
