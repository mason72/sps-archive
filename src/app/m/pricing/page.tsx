"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandButton } from "@/components/ui/brand-button";
import { Check, Minus } from "lucide-react";


const PLANS = [
  {
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    storage: "10 GB",
    storageDetail: "~1,250 images",
    events: "1",
    seats: "1",
    features: {
      ai: true,
      search: true,
      sharing: true,
      branding: true,
      sps: true,
      proofing: false,
      batch: false,
      analytics: false,
    },
    cta: "Request an Invite",
    highlight: false,
  },
  {
    name: "Solo",
    monthlyPrice: 25,
    annualPrice: 19,
    storage: "100 GB",
    storageDetail: "~12,500 images",
    events: "Unlimited",
    seats: "1",
    features: {
      ai: true,
      search: true,
      sharing: true,
      branding: true,
      sps: true,
      proofing: false,
      batch: false,
      analytics: false,
    },
    cta: "Request an Invite",
    highlight: false,
  },
  {
    name: "Pro",
    monthlyPrice: 59,
    annualPrice: 49,
    storage: "750 GB",
    storageDetail: "~93,000 images",
    events: "Unlimited",
    seats: "3",
    features: {
      ai: true,
      search: true,
      sharing: true,
      branding: true,
      sps: true,
      proofing: true,
      batch: false,
      analytics: false,
    },
    cta: "Request an Invite",
    highlight: true,
    badge: "Most Popular",
  },
  {
    name: "Studio",
    monthlyPrice: 99,
    annualPrice: 79,
    storage: "2 TB",
    storageDetail: "~250,000 images",
    events: "Unlimited",
    seats: "10",
    features: {
      ai: true,
      search: true,
      sharing: true,
      branding: true,
      sps: true,
      proofing: true,
      batch: true,
      analytics: true,
    },
    cta: "Request an Invite",
    highlight: false,
    extraStorage: "$5 / 100 GB / mo",
  },
  {
    name: "Enterprise",
    monthlyPrice: null,
    annualPrice: null,
    storage: "Unlimited",
    storageDetail: "Custom",
    events: "Unlimited",
    seats: "Unlimited",
    features: {
      ai: true,
      search: true,
      sharing: true,
      branding: true,
      sps: true,
      proofing: true,
      batch: true,
      analytics: true,
    },
    cta: "Contact Us",
    highlight: false,
    extra: "Dedicated support + SLA",
  },
];

const FEATURE_LABELS: Record<string, string> = {
  ai: "All AI Features",
  search: "Natural Language Search",
  sharing: "Unlimited Sharing Links",
  branding: "Custom Branding",
  sps: "SPS Integration",
  proofing: "Client Favorites & Proofing",
  batch: "Batch Operations",
  analytics: "Analytics Dashboard",
};

const FAQS = [
  {
    q: "How do I get access?",
    a: "Pixeltrunk is invitation-only while we work closely with a small group of photographers. Request an invite with a link to your work — we review every application personally and send invites in small batches.",
  },
  {
    q: "Does the alpha cost anything?",
    a: "No. Invited photographers use Pixeltrunk free during the alpha. Paid plans start when we open up — and you'll get plenty of notice before anything changes.",
  },
  {
    q: "What counts toward my storage?",
    a: "Original images, thumbnails, and any RAW files. AI processing data (embeddings, scores) doesn't count against your storage.",
  },
  {
    q: "Can I change plans later?",
    a: "Yes — upgrade or downgrade anytime. When upgrading, you're charged the prorated difference. When downgrading, the new rate takes effect at your next billing cycle.",
  },
  {
    q: "How does SPS integration work?",
    a: "Pixeltrunk shares the same R2 storage as SimplePhotoShare. Import images with zero-copy — no duplicate uploads, no wasted storage.",
  },
  {
    q: "What if I exceed my storage limit?",
    a: "You'll see a banner as you approach your limit. Uploads are paused at 110% — no surprise charges. Studio plan users can purchase additional storage at $5 / 100 GB.",
  },
];

export default function PricingPage() {
  const [annual, setAnnual] = useState(true);

  return (
    <div className="px-8 md:px-16">
      {/* ─── Header ─── */}
      <section className="pt-20 pb-12 text-center max-w-2xl mx-auto">
        <p className="label-caps mb-4 reveal">Pricing</p>
        <h1
          className="font-editorial text-[clamp(36px,5vw,56px)] leading-[0.92] text-stone-900 reveal"
          style={{ animationDelay: "0.05s" }}
        >
          Simple, transparent pricing
        </h1>
        <p
          className="text-stone-400 text-[15px] mt-4 leading-relaxed reveal"
          style={{ animationDelay: "0.1s" }}
        >
          All plans include the full AI suite. No feature restrictions on
          Smart Stacks, search, or sharing.
        </p>

        {/* Billing toggle */}
        <div
          className="mt-8 inline-flex items-center gap-3 reveal"
          style={{ animationDelay: "0.15s" }}
        >
          <button
            onClick={() => setAnnual(false)}
            className={`text-[13px] font-medium transition-colors duration-300 ${
              !annual ? "text-stone-900" : "text-stone-300"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setAnnual(!annual)}
            className={`relative w-11 h-6 rounded-full transition-colors duration-300 ${
              annual ? "bg-emerald-500" : "bg-stone-200"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-300 ${
                annual ? "translate-x-5" : ""
              }`}
            />
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={`text-[13px] font-medium transition-colors duration-300 ${
              annual ? "text-stone-900" : "text-stone-300"
            }`}
          >
            Annual
          </button>
          {annual && (
            <span className="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
              Save up to 24%
            </span>
          )}
        </div>
      </section>

      {/* ─── Plan Cards ─── */}
      <section className="pb-24 max-w-6xl mx-auto">
        <div className="grid gap-4 md:grid-cols-5">
          {PLANS.map((plan, i) => {
            const price = annual ? plan.annualPrice : plan.monthlyPrice;
            const isEnterprise = price === null;

            return (
              <div
                key={plan.name}
                className={`relative flex flex-col p-6 reveal ${
                  plan.highlight
                    ? "bg-stone-900 text-white ring-2 ring-stone-900"
                    : "bg-white border border-stone-200"
                }`}
                style={{ animationDelay: `${0.1 + i * 0.06}s` }}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="text-[10px] uppercase tracking-[0.15em] font-medium bg-emerald-500 text-white px-3 py-1 whitespace-nowrap">
                      {plan.badge}
                    </span>
                  </div>
                )}

                <p
                  className={`font-editorial text-[20px] mb-3 ${
                    plan.highlight ? "text-white" : "text-stone-900"
                  }`}
                >
                  {plan.name}
                </p>

                {isEnterprise ? (
                  <p
                    className={`font-editorial text-[28px] mb-1 ${
                      plan.highlight ? "text-white" : "text-stone-900"
                    }`}
                  >
                    Custom
                  </p>
                ) : (
                  <div className="mb-1">
                    <span
                      className={`font-editorial text-[36px] ${
                        plan.highlight ? "text-white" : "text-stone-900"
                      }`}
                    >
                      ${price}
                    </span>
                    <span
                      className={`text-[13px] ${
                        plan.highlight ? "text-white/50" : "text-stone-400"
                      }`}
                    >
                      /mo
                    </span>
                  </div>
                )}

                {!isEnterprise && annual && plan.monthlyPrice! > 0 && (
                  <p
                    className={`text-[11px] mb-4 ${
                      plan.highlight ? "text-white/40" : "text-stone-300"
                    }`}
                  >
                    ${plan.monthlyPrice}/mo if billed monthly
                  </p>
                )}
                {(isEnterprise || price === 0) && <div className="mb-4" />}

                {/* Key specs */}
                <div
                  className={`space-y-2 text-[12px] mb-6 py-4 border-y ${
                    plan.highlight
                      ? "border-white/10"
                      : "border-stone-100"
                  }`}
                >
                  <div className="flex justify-between">
                    <span
                      className={
                        plan.highlight ? "text-white/60" : "text-stone-400"
                      }
                    >
                      Storage
                    </span>
                    <span className="font-medium">{plan.storage}</span>
                  </div>
                  <div className="flex justify-between">
                    <span
                      className={
                        plan.highlight ? "text-white/60" : "text-stone-400"
                      }
                    >
                      Events
                    </span>
                    <span className="font-medium">{plan.events}</span>
                  </div>
                  <div className="flex justify-between">
                    <span
                      className={
                        plan.highlight ? "text-white/60" : "text-stone-400"
                      }
                    >
                      Team Seats
                    </span>
                    <span className="font-medium">{plan.seats}</span>
                  </div>
                </div>

                {/* Feature checklist */}
                <ul className="space-y-2 mb-6 flex-1">
                  {Object.entries(plan.features).map(([key, available]) => (
                    <li key={key} className="flex items-center gap-2">
                      {available ? (
                        <Check
                          className={`h-3.5 w-3.5 shrink-0 ${
                            plan.highlight
                              ? "text-emerald-400"
                              : "text-emerald-500"
                          }`}
                        />
                      ) : (
                        <Minus
                          className={`h-3.5 w-3.5 shrink-0 ${
                            plan.highlight
                              ? "text-white/20"
                              : "text-stone-200"
                          }`}
                        />
                      )}
                      <span
                        className={`text-[12px] ${
                          available
                            ? plan.highlight
                              ? "text-white/80"
                              : "text-stone-600"
                            : plan.highlight
                            ? "text-white/20"
                            : "text-stone-300"
                        }`}
                      >
                        {FEATURE_LABELS[key]}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                {plan.highlight ? (
                  <Link href="/#invite">
                    <BrandButton
                      size="sm"
                      color="emerald"
                      className="w-full"
                    >
                      {plan.cta}
                    </BrandButton>
                  </Link>
                ) : isEnterprise ? (
                  <a
                    href="mailto:hello@pixeltrunk.com"
                    className="inline-flex items-center justify-center h-8 px-4 text-[11px] uppercase tracking-[0.12em] font-medium border border-stone-200 text-stone-600 hover:border-stone-400 hover:text-stone-900 transition-colors duration-300 whitespace-nowrap"
                  >
                    Contact Us
                  </a>
                ) : (
                  <Link
                    href="/#invite"
                    className="inline-flex items-center justify-center h-8 px-4 text-[11px] uppercase tracking-[0.12em] font-medium border border-stone-200 text-stone-600 hover:border-stone-400 hover:text-stone-900 transition-colors duration-300 whitespace-nowrap"
                  >
                    {plan.cta}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section className="border-t border-stone-200 py-24 max-w-3xl mx-auto">
        <h2 className="font-editorial text-[clamp(28px,3.5vw,40px)] text-stone-900 mb-12 text-center reveal">
          Frequently Asked Questions
        </h2>
        <div className="space-y-8">
          {FAQS.map((faq, i) => (
            <div
              key={i}
              className="reveal"
              style={{ animationDelay: `${0.05 + i * 0.04}s` }}
            >
              <h3 className="text-[15px] font-medium text-stone-900 mb-2">
                {faq.q}
              </h3>
              <p className="text-[14px] text-stone-400 leading-relaxed">
                {faq.a}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Bottom CTA ─── */}
      <section className="border-t border-stone-200 py-20 text-center">
        <p className="font-editorial text-[clamp(20px,3vw,28px)] text-stone-900 mb-6 reveal">
          Want in?
        </p>
        <div className="reveal" style={{ animationDelay: "0.05s" }}>
          <Link href="/#invite">
            <BrandButton size="lg" color="emerald" celebrate>
              Request an Invite
            </BrandButton>
          </Link>
        </div>
        <p
          className="mt-3 text-[12px] text-stone-300 reveal"
          style={{ animationDelay: "0.1s" }}
        >
          Invitation-only · We review every application
        </p>
      </section>
    </div>
  );
}
