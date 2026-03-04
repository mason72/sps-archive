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
  title: "Pixeltrunk — AI-Powered Photo Archive for Photographers",
  description:
    "Smart Stacks, natural language search, and seamless client delivery. The only photo archive built for professional photographers.",
};

export default function MarketingLandingPage() {
  return (
    <>
      {/* ─── Hero ─── */}
      <section className="px-8 md:px-16 pt-20 pb-28">
        <div className="max-w-4xl">
          <div
            className="mb-6 reveal"
            style={{ animationDelay: "0.05s" }}
          >
            <span className="inline-block px-3 py-1 text-[11px] uppercase tracking-[0.15em] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200">
              Closed Beta
            </span>
          </div>
          <p
            className="label-caps mb-6 reveal"
            style={{ animationDelay: "0.1s" }}
          >
            AI-powered photo archive
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
            Upload thousands of images. AI organizes them into smart stacks,
            searchable sections, and shareable galleries — so you can focus on
            the creative work that matters.
          </p>
          <div
            className="mt-12 flex items-center gap-5 reveal"
            style={{ animationDelay: "0.3s" }}
          >
            <a href={`${APP_URL}/signup`}>
              <BrandButton size="lg" color="emerald">
                Join the Waitlist
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
            Currently in closed beta · Join the waitlist for early access
          </p>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section id="features" className="border-t border-stone-200">
        <div className="px-8 md:px-16 py-24">
          <div className="mx-8 md:mx-0 mb-16">
            <p className="label-caps mb-4 reveal">Intelligent Organization</p>
            <h2
              className="font-editorial text-[clamp(32px,4vw,48px)] leading-[0.95] text-stone-900 max-w-2xl reveal"
              style={{ animationDelay: "0.05s" }}
            >
              AI that understands your images
            </h2>
          </div>

          <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-4 max-w-6xl">
            {[
              {
                icon: Layers,
                title: "Smart Stacks",
                description:
                  "AI groups faces, bursts, and similar shots. The best rises to the top — expand to compare or let AI decide.",
              },
              {
                icon: Search,
                title: "Natural Search",
                description:
                  'Search by what you see, not filenames. "First dance", "speeches at sunset", or upload a selfie to find someone.',
              },
              {
                icon: LayoutGrid,
                title: "Auto Sections",
                description:
                  "AI detects scenes and creates overlapping sections. One photo can live in multiple contexts — ceremony, candids, portraits.",
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
                title: "AI Organizes",
                description:
                  "CLIP embeddings, face recognition, and aesthetic scoring run on every image. Smart Stacks and Sections appear automatically.",
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
              From solo shooters to multi-photographer studios. All plans
              include full AI features.
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
                title: "GPU-Powered AI",
                description:
                  "CLIP, ArcFace, and aesthetic scoring run on serverless GPUs. Results in seconds, not minutes.",
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
                Join the Waitlist
              </BrandButton>
            </a>
          </div>
          <p
            className="mt-4 text-[12px] text-stone-300 reveal"
            style={{ animationDelay: "0.15s" }}
          >
            Currently in closed beta · We&apos;ll notify you when your spot opens up
          </p>
        </div>
      </section>
    </>
  );
}
