"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { BrandButton } from "@/components/ui/brand-button";
import { cn } from "@/lib/utils";
import {
  User,
  Paintbrush,
  Save,
  ArrowLeft,
  Upload,
  X,
} from "lucide-react";
import type { UserProfile, Branding } from "@/types/user-profile";
import { DEFAULT_BRANDING } from "@/types/user-profile";
import { SettingsPanelSkeleton } from "@/components/ui/Skeleton";

type Tab = "profile" | "branding";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "profile", label: "Profile", icon: <User size={16} /> },
  { id: "branding", label: "Branding", icon: <Paintbrush size={16} /> },
];

export default function AccountPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  // Redirect if not logged in
  useEffect(() => {
    if (!user && !isLoading) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  // Fetch profile
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/account");
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();
        const p = data.profile;
        setProfile(p);
        setDisplayName(p.displayName || "");
        setBusinessName(p.businessName || "");
        setBio(p.bio || "");
        setWebsite(p.website || "");
        setPhone(p.phone || "");
        setLocation(p.location || "");
        setBranding({ ...DEFAULT_BRANDING, ...p.branding });
        setLogoUrl(p.logoUrl || null);
      } catch (err) {
        console.error("Load profile failed:", err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          businessName,
          bio,
          website,
          phone,
          location,
          branding,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success("Profile saved");
    } catch (err) {
      console.error("Save profile failed:", err);
      toast.error("Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [displayName, businessName, bio, website, phone, location, branding]);

  if (!user) return null;

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <Nav>
        <Link
          href="/"
          className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
        >
          Dashboard
        </Link>
      </Nav>

      <main className="px-8 md:px-16 pt-12 pb-24 max-w-3xl">
        {/* Header */}
        <div className="mb-10">
          <Link
            href="/"
            className="label-caps text-accent hover:text-accent-hover transition-colors duration-300 mb-4 inline-flex items-center gap-1.5"
          >
            <ArrowLeft size={12} />
            Back to archive
          </Link>
          <h1 className="font-editorial text-[clamp(32px,4vw,48px)] leading-[0.95] text-stone-900 reveal">
            Account Settings
          </h1>
          <p className="caption-italic mt-3">
            {user.email}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-stone-200 mb-10">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-5 py-3 text-[12px] uppercase tracking-[0.15em] font-medium border-b-2 transition-all duration-300",
                activeTab === tab.id
                  ? "border-stone-900 text-stone-900"
                  : "border-transparent text-stone-400 hover:text-stone-600"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <SettingsPanelSkeleton />
        ) : (
          <>
            {/* Profile Tab */}
            {activeTab === "profile" && (
              <div key="profile" className="space-y-8 reveal">
                <div className="editorial-divider mb-6">
                  <span className="label-caps shrink-0">Profile</span>
                </div>

                <FormField
                  label="Display Name"
                  value={displayName}
                  onChange={setDisplayName}
                  placeholder="Your name"
                />

                <FormField
                  label="Business Name"
                  value={businessName}
                  onChange={setBusinessName}
                  placeholder="Studio or business name"
                />

                <FormField
                  label="Bio"
                  value={bio}
                  onChange={setBio}
                  placeholder="A brief description of your photography"
                  multiline
                />

                <div className="editorial-divider mb-6 mt-10">
                  <span className="label-caps shrink-0">Contact</span>
                </div>

                <FormField
                  label="Website"
                  value={website}
                  onChange={setWebsite}
                  placeholder="https://yoursite.com"
                />

                <div className="grid grid-cols-2 gap-6">
                  <FormField
                    label="Phone"
                    value={phone}
                    onChange={setPhone}
                    placeholder="+1 (555) 000-0000"
                  />
                  <FormField
                    label="Location"
                    value={location}
                    onChange={setLocation}
                    placeholder="City, State"
                  />
                </div>
              </div>
            )}

            {/* Branding Tab */}
            {activeTab === "branding" && (
              <div key="branding" className="space-y-8 reveal">
                <div className="editorial-divider mb-6">
                  <span className="label-caps shrink-0">Brand Colors</span>
                </div>

                <p className="text-[13px] text-stone-400 -mt-4 mb-6">
                  These colors will be used as defaults for new events and in client-facing emails.
                </p>

                <div className="grid grid-cols-2 gap-6">
                  <ColorField
                    label="Primary"
                    value={branding.primaryColor}
                    onChange={(v) => setBranding({ ...branding, primaryColor: v })}
                  />
                  <ColorField
                    label="Secondary"
                    value={branding.secondaryColor}
                    onChange={(v) => setBranding({ ...branding, secondaryColor: v })}
                  />
                  <ColorField
                    label="Accent"
                    value={branding.accentColor}
                    onChange={(v) => setBranding({ ...branding, accentColor: v })}
                  />
                  <ColorField
                    label="Background"
                    value={branding.backgroundColor}
                    onChange={(v) => setBranding({ ...branding, backgroundColor: v })}
                  />
                </div>

                <div className="editorial-divider mb-6 mt-10">
                  <span className="label-caps shrink-0">Logo</span>
                </div>

                <div className="flex items-center gap-6">
                  {logoUrl ? (
                    <div className="relative group">
                      <img
                        src={logoUrl}
                        alt="Logo"
                        className="h-16 w-auto max-w-[200px] object-contain border border-stone-200 p-2"
                      />
                      <button
                        onClick={async () => {
                          await fetch("/api/account/logo", { method: "DELETE" });
                          setLogoUrl(null);
                          toast.success("Logo removed");
                        }}
                        className="absolute -top-2 -right-2 p-1 bg-white border border-stone-200 text-stone-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="h-16 w-16 border border-dashed border-stone-200 flex items-center justify-center">
                      <Upload size={16} className="text-stone-300" />
                    </div>
                  )}
                  <div>
                    <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 text-[12px] uppercase tracking-[0.15em] font-medium border border-stone-200 text-stone-600 hover:border-stone-400 transition-all">
                      <Upload size={12} />
                      {isUploadingLogo ? "Uploading…" : logoUrl ? "Replace" : "Upload logo"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml,image/webp"
                        className="hidden"
                        disabled={isUploadingLogo}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 2 * 1024 * 1024) {
                            toast.error("File too large. Maximum 2MB.");
                            return;
                          }
                          setIsUploadingLogo(true);
                          try {
                            const res = await fetch("/api/account/logo", {
                              method: "PUT",
                              headers: { "Content-Type": file.type },
                              body: file,
                            });
                            if (!res.ok) {
                              const err = await res.json().catch(() => ({}));
                              throw new Error(err.error || "Upload failed");
                            }
                            // Refetch profile to get fresh presigned URL
                            const profileRes = await fetch("/api/account");
                            if (profileRes.ok) {
                              const profileData = await profileRes.json();
                              setLogoUrl(profileData.profile?.logoUrl || null);
                            }
                            toast.success("Logo uploaded");
                          } catch {
                            toast.error("Failed to upload logo");
                          } finally {
                            setIsUploadingLogo(false);
                            e.target.value = "";
                          }
                        }}
                      />
                    </label>
                    <p className="text-[11px] text-stone-400 mt-2">PNG, JPG, SVG, or WebP. Max 2MB.</p>
                  </div>
                </div>

                <div className="editorial-divider mb-6 mt-10">
                  <span className="label-caps shrink-0">Logo Placement</span>
                </div>

                <div className="flex gap-4">
                  {(["left", "center"] as const).map((placement) => (
                    <button
                      key={placement}
                      onClick={() =>
                        setBranding({ ...branding, logoPlacement: placement })
                      }
                      className={cn(
                        "flex-1 py-4 border text-[12px] uppercase tracking-[0.15em] font-medium transition-all duration-300",
                        branding.logoPlacement === placement
                          ? "border-stone-900 bg-stone-900 text-white"
                          : "border-stone-200 text-stone-500 hover:border-stone-400"
                      )}
                    >
                      {placement}
                    </button>
                  ))}
                </div>

                <div className="editorial-divider mb-6 mt-10">
                  <span className="label-caps shrink-0">Preview</span>
                </div>

                {/* Branding preview card */}
                <div
                  className="border border-stone-200 p-8"
                  style={{ backgroundColor: branding.backgroundColor }}
                >
                  <div
                    className={cn(
                      "mb-4",
                      branding.logoPlacement === "center" && "text-center"
                    )}
                  >
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt={businessName || "Logo"}
                        className="h-10 w-auto max-w-[180px] object-contain"
                        style={branding.logoPlacement === "center" ? { margin: "0 auto" } : undefined}
                      />
                    ) : (
                      <span
                        className="font-editorial text-[24px]"
                        style={{ color: branding.primaryColor }}
                      >
                        {businessName || "Your Studio"}
                      </span>
                    )}
                  </div>
                  <p
                    className="text-[13px] leading-relaxed"
                    style={{ color: branding.secondaryColor }}
                  >
                    Your gallery is ready to view. Click the link below to see
                    your photos.
                  </p>
                  <div className="mt-4">
                    <span
                      className="inline-block px-5 py-2.5 text-[12px] uppercase tracking-[0.15em] font-medium text-white"
                      style={{ backgroundColor: branding.accentColor }}
                    >
                      View Gallery
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Save button */}
            <div className="mt-12 flex items-center gap-4">
              <BrandButton onClick={handleSave} disabled={isSaving}>
                <Save size={14} />
                {isSaving ? "Saving…" : saved ? "Saved" : "Save Changes"}
              </BrandButton>
              {saved && (
                <span className="text-[13px] text-accent">Changes saved</span>
              )}
            </div>

            {/* Quick links */}
            <div className="mt-16">
              <div className="editorial-divider mb-6">
                <span className="label-caps shrink-0">More Settings</span>
              </div>
              <Link
                href="/settings/emails"
                className="flex items-center justify-between group border border-stone-200 hover:border-stone-400 p-5 transition-all duration-300"
              >
                <div>
                  <h3 className="text-[15px] font-medium text-stone-900 mb-1">
                    Email Templates
                  </h3>
                  <p className="text-[13px] text-stone-400">
                    Create and manage branded email templates for sharing galleries.
                  </p>
                </div>
                <ArrowLeft size={14} className="text-stone-300 group-hover:text-stone-500 rotate-180 transition-colors" />
              </Link>
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}

/** Text input field with editorial styling */
function FormField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      <label htmlFor={id} className="label-caps mb-2 block">{label}</label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full text-[14px] text-stone-900 placeholder:text-stone-300 bg-transparent border-b border-stone-200 focus:border-stone-900 outline-none py-2 resize-none transition-colors"
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full text-[14px] text-stone-900 placeholder:text-stone-300 bg-transparent border-b border-stone-200 focus:border-stone-900 outline-none py-2 transition-colors"
        />
      )}
    </div>
  );
}

/** Color picker with swatch + hex input */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      <label htmlFor={id} className="label-caps mb-2 block">{label}</label>
      <div className="flex items-center gap-3">
        <label className="relative cursor-pointer">
          <div
            className="w-8 h-8 border border-stone-200"
            style={{ backgroundColor: value }}
          />
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
          }}
          className="flex-1 text-[13px] text-stone-700 font-mono bg-transparent border-b border-stone-200 focus:border-stone-900 outline-none py-1 transition-colors"
        />
      </div>
    </div>
  );
}
