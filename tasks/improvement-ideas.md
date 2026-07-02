# Pixeltrunk — Improvement & Delight Roadmap

> Generated from full code audit of Phase 12 analytics + gallery + lightbox + dashboard

---

## 🎯 High-Impact Delight (Quick Wins)

### D1: Animated Stat Card Counters — SHIPPED (useCountUp + in-view trigger, trend arrow, sparkline)
**Where:** `StatCard.tsx`
**Current:** Numbers render static
**Upgrade:** Count-up animation on mount (0 → actual value over 600ms). Trend arrow (↑ emerald / ↓ stone-400) comparing all-time to 30d. Subtle lift + glow on hover.

### D2: Favorite Heart Celebration — SHIPPED 2026-07-02 (pixel-mosaic burst on the guest's first favorite; grid + lightbox)
**Where:** Gallery public view favorite button
**Current:** Silent toggle, heart fills
**Upgrade:** Brief confetti micro-burst (8-12 particles, 400ms) on first favorite. Subsequent favorites get a gentle scale pulse. Use the existing `usePixelBurst` hook pattern.

### D3: Gallery Cover Entrance Animation — SHIPPED (ken-burns-settle on CoverSection)
**Where:** Gallery page cover section
**Current:** Static render
**Upgrade:** Cover image fades in with a subtle 3% zoom-out (Ken Burns settle). Photographer logo fades in 200ms after. Event title types in or reveals from below.

### D4: SmartStack Expand Animation — SHIPPED (staggered scale-in via .stack-expand-item)
**Where:** `SmartStack.tsx` toggle
**Current:** Instant toggle between collapsed/expanded
**Upgrade:** Smooth height transition, items scale-in with staggered delay (50ms between items). "Best shot" badge pulses briefly on expand.

### D5: Empty State Illustrations — SHIPPED 2026-07-02 (gallery camera sketch ✓, events dashed-border + BrandButton ✓, analytics pixel-elephant added)
**Where:** Dashboard (no events), Analytics (no data), Gallery (no images)
**Current:** Plain text messages
**Upgrade:** Illustrated empty states with encouraging copy. "Your first masterpiece awaits" with a subtle camera icon animation.

---

## 📊 Analytics Polish

### A1: Chart Entrance Animations — SHIPPED (in-view triggered, area + bar)
**Where:** `AnalyticsDashboard.tsx` area/bar charts
**Upgrade:** Charts animate from left to right on page load (recharts supports `isAnimationActive`). Add milestone markers on the x-axis (vertical dashed lines at notable dates).

### A2: Activity Feed Timeline — SHIPPED (date-bucket grouping)
**Where:** `AnalyticsDashboard.tsx` recent activity section
**Current:** Flat list
**Upgrade:** Vertical timeline connector line on the left. Color-coded icons per action type (emerald eye for views, blue download for downloads, orange heart for favorites). Group by "Today", "Yesterday", "This Week".

### A3: Stat Card Hover Detail — SHIPPED (30d vs all-time tooltip)
**Where:** `StatCard.tsx`
**Upgrade:** On hover, show a tooltip with breakdown (e.g., "Downloads: 42 individual + 8 bulk"). Uses the existing metadata from the totals API.

### A4: Celebration Milestones — SHIPPED 2026-07-02 (analytics banner at 100/1k/10k views, 100/1k downloads; localStorage-dismissed)
**Where:** Analytics overview
**Upgrade:** When a photographer hits a milestone (100 views, 1000 downloads), show a one-time celebratory banner. Store milestones in `user_profiles.metadata`.

---

## 🖼️ Gallery Experience

### G1: Image Load Placeholder — SHIPPED 2026-07-02 (sharp dominant color at thumbnail time, migration 032, backfilled; grid + stack tiles glow in the photo's hue while loading)
**Where:** Gallery grid
**Current:** Images pop in when loaded
**Upgrade:** Extract dominant color from thumbnail → use as placeholder background. Images crossfade in over 200ms. Creates a polished "magazine layout" feel while loading.

### G2: Lightbox Quality Glow — DEFERRED (AI-gated: aesthetic scores need the Modal pipeline)
**Where:** Lightbox metadata panel
**Current:** Score bars are neutral colored
**Upgrade:** Images with aesthetic score ≥ 8.0 get a subtle warm glow border in the lightbox. Scene tags become emerald-tinted. Makes high-quality shots feel special.

### G3: Download Progress Feedback — PARTIAL (bulk: preparing-toast + double-click guard; individual: success toast; no live progress %)
**Where:** Gallery download button (individual + bulk)
**Current:** Silent — no feedback until complete
**Upgrade:** Individual: brief checkmark animation on the download icon. Bulk: progress toast showing "Preparing 47 images…" → "Download ready!" with elapsed time.

### G4: Gallery Finish Moment — SHIPPED (end-of-gallery credit block + portfolio link)
**Where:** Gallery public view — when viewer reaches end
**Upgrade:** Subtle "end of gallery" moment with photographer's logo + "Photographed by [name]" + website link. Feels like closing a book. Optional CTA: "Book a session".

### G5: Favorite Summary Toast — SHIPPED (milestones 5/10/20; audit #17 wants a per-share opt-out)
**Where:** Gallery favorites
**Upgrade:** After favoriting 5+ images, show a warm toast: "You've loved 12 moments ❤️". Encourages engagement and feels rewarding.

---

## 🛠️ Quality of Life

### Q1: AI Feature Tooltips — DEFERRED (AI-gated: features hidden until the pipeline is live)
**Where:** SmartStacks, Scene Tags, Quality Scores
**Current:** No explanation of what these mean
**Upgrade:** "ℹ️" icon on SmartStack headers → popover explaining "SmartStacks group similar shots and surface the best one using AI quality scoring."

### Q2: Inline Image Naming — COVERED by the editor's rename tool (single-select pre-fills, extension-safe); lightbox inline edit deemed redundant
**Where:** Lightbox or detail view
**Current:** `parsed_name` is read-only
**Upgrade:** Click to edit parsed name inline. Photographers can rename "IMG_4521" → "First Dance" directly.

### Q3: Search Discovery Prompts — DEFERRED (AI-gated: example prompts would advertise semantic search, which is dormant; filename search is self-explanatory)
**Where:** Search bar empty state
**Current:** Plain placeholder text
**Upgrade:** Rotating example searches: "Try: 'golden hour portraits'" / "'group photos outdoors'" / "'close-up details'". Shows the power of natural language search.

### Q4: Share Preview Card (OG Image) — SHIPPED (/gallery/[slug]/opengraph-image: cover + branding; verified 200 image/png in prod)
**Where:** Gallery share links
**Current:** No og:image or rich preview
**Upgrade:** Auto-generate og:image from cover photo + photographer branding. When shared on social media or messaging, shows a beautiful preview card.

### Q5: Bulk Select UX — SHIPPED (select-all-in-stack + animated counter pill)
**Where:** Gallery/event grid selection
**Current:** Select individual images
**Upgrade:** "Select all in stack" button when a SmartStack is expanded. Running counter: "47 selected" with a pill badge that animates when count changes.

---

## 🎨 Visual Polish

### V1: Scene Tag Chips — DEFERRED (AI-gated: scene tags only exist once the Modal pipeline is live)
**Where:** Lightbox metadata, gallery grid overlays
**Current:** Plain text badges
**Upgrade:** Subtle gradient chips with icons (🌅 sunset, 👤 portrait, 🏞️ landscape). Hover reveals confidence percentage.

### V2: Camera Info Card — SHIPPED (MetadataPanel one-line camera/lens/exposure card; surface hidden while AI panel is dormant)
**Where:** Lightbox metadata sidebar
**Current:** Key-value text list
**Upgrade:** Compact card layout with camera icon, lens icon. Groups: "Sony A7III · 85mm f/1.4 · 1/250s · ISO 400". One line, elegant.

### V3: Dashboard Welcome Moment — SHIPPED (time-of-day Greeting + DashboardStats strip)
**Where:** Dashboard home
**Current:** Straight to event list
**Upgrade:** "Good morning, [name]" with a gentle fade. Quick stats strip: "3 galleries active · 127 views today · 12 new favorites". Warm, not corporate.

### V4: Photographer Signature Footer — SHIPPED
**Where:** Gallery public view footer
**Current:** Small text
**Upgrade:** Elegant signature-style footer with photographer's logo, business name, and a "View portfolio" link. Feels like signing a print.

---

## Priority Order (Suggested)

| Priority | ID | Effort | Impact |
|----------|-----|--------|--------|
| 1 | D1 | Small | High — numbers feel alive |
| 2 | D2 | Small | High — emotional connection |
| 3 | G1 | Medium | High — perceived performance |
| 4 | D3 | Small | High — first impression |
| 5 | V3 | Small | Medium — personal touch |
| 6 | A2 | Medium | Medium — analytics readability |
| 7 | D4 | Small | Medium — interaction polish |
| 8 | Q4 | Medium | High — social sharing |
| 9 | G4 | Small | Medium — memorable close |
| 10 | D5 | Medium | Medium — onboarding polish |
