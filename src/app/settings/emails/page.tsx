"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Nav } from "@/components/layout/Nav";
import { AppNav } from "@/components/layout/AppNav";
import { Footer } from "@/components/layout/Footer";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { BrandButton } from "@/components/ui/brand-button";
import { EmailPreview } from "@/components/email/EmailPreview";
import { EmailEditor, type EmailEditorHandle } from "@/components/email/EmailEditor";
import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Mail,
  Variable,
  Star,
  X,
} from "lucide-react";
import type { EmailTemplate } from "@/types/email";
import { TEMPLATE_VARIABLES } from "@/types/email";
import type { Branding } from "@/types/user-profile";
import { DEFAULT_BRANDING } from "@/types/user-profile";

type View = "list" | "edit";

export default function EmailSettingsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTemplate, setActiveTemplate] = useState<EmailTemplate | null>(null);
  const [view, setView] = useState<View>("list");

  // Edit state
  const [editName, setEditName] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Two-step delete: the first tap arms this id, the second deletes. A phone
  // has no hover to hide the control behind, so the confirm is the guard.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const editorRef = useRef<EmailEditorHandle | null>(null);

  // Branding from account
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [businessName, setBusinessName] = useState("");

  useEffect(() => {
    if (!user) {
      router.push("/login");
      return;
    }
  }, [user, router]);

  // Load templates + branding
  useEffect(() => {
    (async () => {
      try {
        const [templatesRes, accountRes] = await Promise.all([
          fetch("/api/emails/templates"),
          fetch("/api/account"),
        ]);

        if (templatesRes.ok) {
          const data = await templatesRes.json();
          setTemplates(data.templates || []);
        }

        if (accountRes.ok) {
          const data = await accountRes.json();
          if (data.profile?.branding) {
            setBranding({ ...DEFAULT_BRANDING, ...data.profile.branding });
          }
          if (data.profile?.businessName) {
            setBusinessName(data.profile.businessName);
          }
        }
      } catch (err) {
        console.error("Load email settings failed:", err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const openTemplate = useCallback((template: EmailTemplate) => {
    setActiveTemplate(template);
    setEditName(template.name);
    setEditSubject(template.subject);
    setEditBody(template.bodyHtml);
    setView("edit");
  }, []);

  const createTemplate = useCallback(async () => {
    try {
      const res = await fetch("/api/emails/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Template" }),
      });
      if (!res.ok) throw new Error("Failed to create");
      const data = await res.json();
      setTemplates((prev) => [...prev, data.template]);
      openTemplate(data.template);
    } catch (err) {
      console.error("Create template failed:", err);
    }
  }, [openTemplate]);

  const saveTemplate = useCallback(async () => {
    if (!activeTemplate) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/emails/templates/${activeTemplate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          subject: editSubject,
          bodyHtml: editBody,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      setTemplates((prev) =>
        prev.map((t) => (t.id === activeTemplate.id ? data.template : t))
      );
      setActiveTemplate(data.template);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Save template failed:", err);
    } finally {
      setIsSaving(false);
    }
  }, [activeTemplate, editName, editSubject, editBody]);

  const deleteTemplate = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/emails/templates/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Delete failed (${res.status})`);
        setTemplates((prev) => prev.filter((t) => t.id !== id));
        if (activeTemplate?.id === id) {
          setView("list");
          setActiveTemplate(null);
        }
      } catch (err) {
        console.error("Delete template failed:", err);
        toast.error("Couldn't delete that template. Try again.");
      } finally {
        setConfirmDeleteId(null);
      }
    },
    [activeTemplate]
  );

  const insertVariable = useCallback(
    (key: string) => {
      if (editorRef.current) {
        editorRef.current.insertContent(key);
      } else {
        setEditBody((prev) => prev + key);
      }
    },
    []
  );

  if (!user) return null;

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <Nav>
        <AppNav />
      </Nav>

      <main className="px-8 md:px-16 pt-12 pb-24 max-w-5xl">
        {/* Header */}
        <div className="mb-10">
          <Link
            href="/account"
            className="label-caps text-accent hover:text-accent-hover transition-colors duration-300 mb-4 inline-flex items-center gap-1.5"
          >
            <ArrowLeft size={12} />
            Account Settings
          </Link>
          <h1 className="font-editorial text-[clamp(32px,4vw,48px)] leading-[0.95] text-stone-900 reveal">
            Email Templates
          </h1>
          <p className="caption-italic mt-3">
            Create and manage email templates for sharing galleries with clients.
          </p>
        </div>

        {isLoading ? (
          <div className="py-24 text-center">
            <p className="text-[13px] text-stone-400">Loading…</p>
          </div>
        ) : view === "list" ? (
          /* ─── Template List ─── */
          <div className="reveal">
            <div className="flex items-center justify-between mb-8">
              <div className="editorial-divider flex-1">
                <span className="label-caps shrink-0">Templates</span>
              </div>
              <button
                onClick={createTemplate}
                className="ml-6 flex items-center gap-2 text-[12px] uppercase tracking-[0.15em] font-medium text-accent hover:text-accent-hover transition-colors"
              >
                <Plus size={14} />
                New Template
              </button>
            </div>

            {templates.length === 0 ? (
              <div className="py-16 text-center">
                <Mail size={32} className="mx-auto text-stone-300 mb-4" />
                <p className="text-[13px] text-stone-400">
                  No templates yet. Create one to get started.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {templates.map((template) => {
                  const armed = confirmDeleteId === template.id;
                  return (
                    // Delete is a SIBLING of the card button (a button inside a
                    // button is invalid and swallowed taps). It hides until hover
                    // on desktop, and is visible + tappable on touch.
                    <div
                      key={template.id}
                      className="group relative border border-stone-200 hover:border-stone-400 transition-all duration-300"
                    >
                      <button
                        onClick={() => openTemplate(template)}
                        className="w-full text-left p-5 pr-14"
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <h3 className="text-[15px] font-medium text-stone-900 truncate">
                            {template.name}
                          </h3>
                          {template.isDefault && (
                            <span className="flex items-center gap-0.5 text-[10px] text-accent uppercase tracking-widest">
                              <Star size={10} />
                              Default
                            </span>
                          )}
                        </div>
                        <p className="text-[13px] text-stone-400 truncate">
                          {template.subject || "No subject"}
                        </p>
                      </button>
                      {armed ? (
                        <div className="absolute top-4 right-4 flex items-center gap-1 bg-white">
                          <button
                            onClick={() => deleteTemplate(template.id)}
                            className="flex items-center gap-1 rounded bg-red-500 px-2 py-1 pointer-coarse:min-h-10 pointer-coarse:px-3 text-[11px] font-medium text-white transition-colors hover:bg-red-600"
                            title="Permanently delete this template"
                          >
                            <Trash2 size={11} />
                            Delete?
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="p-1 pointer-coarse:p-[13px] text-stone-400 hover:text-stone-700 transition-colors"
                            title="Cancel"
                            aria-label="Cancel delete"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setConfirmDeleteId(template.id);
                            setTimeout(
                              () => setConfirmDeleteId((cur) => (cur === template.id ? null : cur)),
                              3000
                            );
                          }}
                          className="absolute top-5 right-5 p-1.5 pointer-coarse:top-3 pointer-coarse:right-3 pointer-coarse:p-[13px] text-stone-400 hover:text-red-500 transition-[color,opacity] opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto"
                          title="Delete template"
                          aria-label={`Delete template ${template.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* ─── Template Editor ─── */
          <div className="reveal">
            {/* Editor nav */}
            <div className="flex items-center justify-between mb-8">
              <button
                onClick={() => setView("list")}
                className="label-caps text-stone-400 hover:text-stone-700 transition-colors inline-flex items-center gap-1.5"
              >
                <ArrowLeft size={12} />
                All Templates
              </button>
              <BrandButton
                onClick={saveTemplate}
                disabled={isSaving}
                size="sm"
              >
                <Save size={12} />
                {isSaving ? "Saving…" : saved ? "Saved" : "Save"}
              </BrandButton>
            </div>

            {/* Side-by-side: editor + live preview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left: Editor */}
              <div className="space-y-8">
                <div>
                  <label className="label-caps mb-2 block">Template Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="e.g. Gallery Ready"
                    className="w-full text-[14px] text-stone-900 placeholder:text-stone-300 bg-transparent border-b border-stone-200 focus:border-stone-900 outline-none py-2 transition-colors"
                  />
                </div>

                <div>
                  <label className="label-caps mb-2 block">Subject Line</label>
                  <input
                    type="text"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    placeholder="Your photos from {event_name} are ready!"
                    className="w-full text-[14px] text-stone-900 placeholder:text-stone-300 bg-transparent border-b border-stone-200 focus:border-stone-900 outline-none py-2 transition-colors font-mono text-[13px]"
                  />
                </div>

                <div>
                  <label className="label-caps mb-2 block">Email Body</label>
                  <EmailEditor
                    value={editBody}
                    onChange={setEditBody}
                    editorRef={editorRef}
                    placeholder="Start writing your email…"
                  />
                </div>

                {/* Variable chips */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Variable size={14} className="text-stone-400" />
                    <span className="label-caps">Insert Variable</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {TEMPLATE_VARIABLES.map((v) => (
                      <button
                        key={v.key}
                        onClick={() => insertVariable(v.key)}
                        className="px-3 py-1.5 text-[11px] font-mono border border-stone-200 text-stone-600 hover:border-accent hover:text-accent transition-all duration-200"
                        title={`Example: ${v.example}`}
                      >
                        {v.key}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right: Live Preview */}
              <div className="lg:sticky lg:top-20 lg:self-start">
                <p className="label-caps mb-3">Preview</p>
                <div className="border border-stone-100 bg-stone-50 p-1">
                  <EmailPreview
                    subject={editSubject}
                    bodyHtml={editBody}
                    branding={branding}
                    businessName={businessName}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
