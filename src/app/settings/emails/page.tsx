"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { EmailPreview } from "@/components/email/EmailPreview";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Eye,
  Edit3,
  Mail,
  Variable,
  Star,
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
  const [showPreview, setShowPreview] = useState(false);

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
    setShowPreview(false);
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
        await fetch(`/api/emails/templates/${id}`, { method: "DELETE" });
        setTemplates((prev) => prev.filter((t) => t.id !== id));
        if (activeTemplate?.id === id) {
          setView("list");
          setActiveTemplate(null);
        }
      } catch (err) {
        console.error("Delete template failed:", err);
      }
    },
    [activeTemplate]
  );

  const insertVariable = useCallback(
    (key: string) => {
      setEditBody((prev) => prev + key);
    },
    []
  );

  if (!user) return null;

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-8 md:px-16 fade-in">
        <Link href="/" className="font-editorial text-[28px] text-stone-900">
          Prism
        </Link>
        <div className="flex items-center gap-6">
          <Link
            href="/account"
            className="text-[13px] tracking-wide editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
          >
            Account
          </Link>
        </div>
      </nav>
      <div className="mx-8 md:mx-16 rule reveal-line" />

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
                {templates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => openTemplate(template)}
                    className="w-full text-left group border border-stone-200 hover:border-stone-400 p-5 transition-all duration-300"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
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
                      </div>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteTemplate(template.id);
                          }}
                          className="p-1.5 text-stone-400 hover:text-red-500 transition-colors cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
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
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-[0.15em] font-medium border transition-all duration-300",
                    showPreview
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-200 text-stone-500 hover:border-stone-400"
                  )}
                >
                  {showPreview ? <Edit3 size={12} /> : <Eye size={12} />}
                  {showPreview ? "Edit" : "Preview"}
                </button>
                <Button
                  onClick={saveTemplate}
                  disabled={isSaving}
                  size="sm"
                >
                  <Save size={12} />
                  {isSaving ? "Saving…" : saved ? "Saved ✓" : "Save"}
                </Button>
              </div>
            </div>

            {showPreview ? (
              /* Preview */
              <div className="max-w-lg mx-auto">
                <EmailPreview
                  subject={editSubject}
                  bodyHtml={editBody}
                  branding={branding}
                  businessName={businessName}
                />
              </div>
            ) : (
              /* Edit form */
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
                  <div className="flex items-center justify-between mb-2">
                    <label className="label-caps">Email Body</label>
                    <span className="text-[11px] text-stone-400">
                      HTML supported
                    </span>
                  </div>
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    placeholder="<p>Hi {client_name},</p><p>Your gallery is ready!</p>"
                    rows={12}
                    className="w-full text-[13px] text-stone-900 placeholder:text-stone-300 bg-stone-50 border border-stone-200 focus:border-stone-900 outline-none p-4 resize-y transition-colors font-mono leading-relaxed"
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
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="px-8 md:px-16 py-8 border-t border-stone-200">
        <p className="text-[12px] text-stone-400">
          <span className="font-editorial text-[14px] text-stone-900">Prism</span>
          {" "}— Intelligent photo archiving
        </p>
      </footer>
    </div>
  );
}
