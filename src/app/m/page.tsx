import Link from "next/link";
import { BrandButton } from "@/components/ui/brand-button";
import {
  Layers,
  Search,
  LayoutGrid,
  ArrowRight,
  Zap,
  Shield,
  Camera,
} from "lucide-react";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";

export const metadata = {
  title: "Pixeltrunk — A Photo Archive for Photographers",
  description:
    "Upload, organize, and deliver client galleries from one beautiful archive. Built for professional photographers.",
};

export default function MarketingLandingPage() {
  return (
    <>
      {/* ─── Hero ─── */}
      <section className="px-8 md:px-16 pt-20 pb-28">
        <div className="max-w-4xl">
          <p
            className="label-caps mb-6 reveal"
            style={{ animationDelay: "0.1s" }}
          >
            A photo archive for photographers
          </p>
          <h1
            className="font-editorial text-[clamp(48px,7vw,80px)] leading-[0.92] text-stone-900 reveal"
            style={{ animationDelay: "0.15s" }}
          >
            Every frame,
            <br />
            organized{" "}
            <span className="italic text-emerald-600 font-serif font-normal">
              beautifully
            </span>
          </h1>
          <p
            className="text-stone-400 text-[16px] mt-8 max-w-xl leading-[1.8] reveal"
            style={{ animationDelay: "0.2s" }}
          >
            Upload thousands of images. Organize them into sections, build
            beautiful shareable galleries, and deliver to clients — all from
            one trunk. Smart search and stacking are on the way.
          </p>
          <div
            className="mt-12 flex items-center gap-5 reveal"
            style={{ animationDelay: "0.3s" }}
          >
            <a href={`${APP_URL}/signup`}>
              <BrandButton size="lg" color="emerald">
                Start Free Trial
              </BrandButton>
            </a>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-stone-500 hover:text-stone-900 transition-colors duration-300 tracking-wide"
            >
              See Pricing <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <p
            className="mt-4 text-[12px] text-stone-300 reveal"
            style={{ animationDelay: "0.35s" }}
          >
            14-day Pro trial · No credit card required
          </p>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section id="features" className="border-t border-stone-200">
        <div className="px-8 md:px-16 py-24">
          <div className="mx-8 md:mx-0 mb-16">
            <p className="label-caps mb-4 reveal">A clean workflow</p>
            <h2
              className="font-editorial text-[clamp(32px,4vw,48px)] leading-[0.95] text-stone-900 max-w-2xl reveal"
              style={{ animationDelay: "0.05s" }}
            >
              Everything you need to organize and deliver
            </h2>
          </div>

          <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-4 max-w-6xl">
            {[
              {
                icon: Layers,
                title: "Sections",
                description:
                  "Organize each shoot into sections — Ceremony, Reception, Portraits. Reorder with drag-and-drop; photos can live in more than one.",
              },
              {
                icon: Search,
                title: "Fast Filename Search",
                description:
                  "Find any photo by filename or photographer's parsed names. Per-event or across your entire archive.",
              },
              {
                icon: LayoutGrid,
                title: "Branded Galleries",
                description:
                  "Share with clients via password-protected galleries that wear your branding. Track favorites, downloads, and views.",
              },
              {
                icon: Zap,
                title: "SPS Integration",
                description:
                  "Zero-copy import from SimplePhotoShare. Your archive and delivery platform, seamlessly connected.",
              },
            ].map((feature, i) => (
              <div
                key={feature.title}
                className="reveal"
                style={{ animationDelay: `${0.1 + i * 0.08}s` }}
              >
                <div className="w-10 h-10 bg-stone-100 flex items-center justify-center mb-4">
                  <feature.icon className="h-5 w-5 text-stone-600" />
                </div>
                <h3 className="font-editorial text-[22px] text-stone-900 mb-3">
                  {feature.title}
                </h3>
                <p className="text-stone-400 text-[14px] leading-[1.8]">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section className="border-t border-stone-200 bg-stone-50/50">
        <div className="px-8 md:px-16 py-24">
          <p className="label-caps mb-4 reveal">How It Works</p>
          <h2
            className="font-editorial text-[clamp(28px,3.5vw,40px)] leading-[0.95] text-stone-900 mb-16 reveal"
            style={{ animationDelay: "0.05s" }}
          >
            Three steps to an organized archive
          </h2>

          <div className="grid gap-16 md:grid-cols-3 max-w-4xl">
            {[
              {
                step: "01",
                title: "Upload",
                description:
                  "Drag and drop thousands of images. RAW + JPEG, any camera. Thumbnails generate instantly.",
              },
              {
                step: "02",
                title: "Organize",
                description:
                  "Sort into sections, set a cover image, and pick the best shots with the keyboard-driven culling view. Reorder anything by drag-and-drop.",
              },
              {
                step: "03",
                title: "Share & Deliver",
                description:
                  "Generate beautiful shareable galleries. Email clients directly. Export to SPS for proofing and delivery.",
              },
            ].map((item, i) => (
              <div
                key={item.step}
                className="reveal"
                style={{ animationDelay: `${0.1 + i * 0.1}s` }}
              >
                <span className="label-caps text-emerald-600 mb-3 block">
                  {item.step}
                </span>
                <h3 className="font-editorial text-[24px] text-stone-900 mb-3">
                  {item.title}
                </h3>
                <p className="text-stone-400 text-[14px] leading-[1.8]">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing Preview ─── */}
      <section className="border-t border-stone-200">
        <div className="px-8 md:px-16 py-24">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="label-caps mb-4 reveal">Simple Pricing</p>
            <h2
              className="font-editorial text-[clamp(28px,3.5vw,40px)] leading-[0.95] text-stone-900 reveal"
              style={{ animationDelay: "0.05s" }}
            >
              Plans for every photographer
            </h2>
            <p
              className="text-stone-400 text-[15px] mt-4 leading-relaxed reveal"
              style={{ animationDelay: "0.1s" }}
            >
              From solo shooters to multi-photographer studios. Every plan
              includes unlimited galleries, branded sharing, and proofing.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3 max-w-3xl mx-auto mb-12">
            {[
              { name: "Solo", price: "$19", period: "/mo", note: "billed annually" },
              {
                name: "Pro",
                price: "$49",
                period: "/mo",
                note: "billed annually",
                highlight: true,
              },
              { name: "Studio", price: "$79", period: "/mo", note: "billed annually" },
            ].map((plan, i) => (
              <div
                key={plan.name}
                className={`p-6 text-center reveal ${
                  plan.highlight
                    ? "bg-stone-900 text-white"
                    : "bg-stone-50 text-stone-900"
                }`}
                style={{ animationDelay: `${0.1 + i * 0.08}s` }}
              >
                {plan.highlight && (
                  <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400 font-medium mb-2">
                    Most Popular
                  </p>
                )}
                <p className="font-editorial text-[18px]">{plan.name}</p>
                <p className="mt-2">
                  <span className="font-editorial text-[36px]">
                    {plan.price}
                  </span>
                  <span
                    className={`text-[13px] ${
                      plan.highlight ? "text-white/60" : "text-stone-400"
                    }`}
                  >
                    {plan.period}
                  </span>
                </p>
                <p
                  className={`text-[11px] mt-1 ${
                    plan.highlight ? "text-white/40" : "text-stone-300"
                  }`}
                >
                  {plan.note}
                </p>
              </div>
            ))}
          </div>

          <div className="text-center reveal" style={{ animationDelay: "0.35s" }}>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-stone-500 hover:text-stone-900 transition-colors duration-300 tracking-wide"
            >
              View full pricing & compare plans{" "}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Trust ─── */}
      <section className="border-t border-stone-200 bg-stone-50/50">
        <div className="px-8 md:px-16 py-20">
          <div className="grid gap-8 md:grid-cols-3 max-w-4xl mx-auto text-center">
            {[
              {
                icon: Shield,
                title: "Secure by Design",
                description:
                  "Your images stored on Cloudflare R2 with zero egress fees. Presigned URLs. Row-level security.",
              },
              {
                icon: Camera,
                title: "Built for Photographers",
                description:
                  "By photographers, for photographers. We understand RAW files, culling workflows, and client delivery.",
              },
              {
                icon: Zap,
                title: "Fast Uploads",
                description:
                  "Direct-to-storage uploads with real progress, automatic thumbnails, and bulk retry — handle a 3,000-photo wedding without breaking a sweat.",
              },
            ].map((item, i) => (
              <div
                key={item.title}
                className="reveal"
                style={{ animationDelay: `${0.1 + i * 0.08}s` }}
              >
                <item.icon className="h-5 w-5 text-stone-400 mx-auto mb-3" />
                <h3 className="font-medium text-[14px] text-stone-900 mb-2 tracking-wide">
                  {item.title}
                </h3>
                <p className="text-[13px] text-stone-400 leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="border-t border-stone-200">
        <div className="px-8 md:px-16 py-24 text-center">
          <blockquote className="max-w-2xl mx-auto mb-12 reveal">
            <p className="font-serif italic text-[clamp(24px,3.5vw,36px)] leading-[1.4] text-stone-700">
              &ldquo;The archive should be as beautiful as the work it
              holds.&rdquo;
            </p>
          </blockquote>
          <div className="reveal" style={{ animationDelay: "0.1s" }}>
            <a href={`${APP_URL}/signup`}>
              <BrandButton size="lg" color="emerald" celebrate>
                Start Your Free Trial
              </BrandButton>
            </a>
          </div>
          <p
            className="mt-4 text-[12px] text-stone-300 reveal"
            style={{ animationDelay: "0.15s" }}
          >
            14-day Pro trial · No credit card required
          </p>
        </div>
      </section>
    </>
  );
}
