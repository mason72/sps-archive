# Pixeltrunk — Pricing Strategy

**Status:** Approved direction
**Last updated:** 2026-02-24

---

## 1. Positioning

Pixeltrunk is a **premium product**. Photographers currently pay two separate bills — one for AI culling ($10–60/mo for Narrative or AfterShoot) and one for gallery/archive/delivery ($20–65/mo for ShootProof, Pixieset, Pic-Time). That's $30–125/mo for tools that don't talk to each other.

Pixeltrunk is the only product that combines AI-powered organization, semantic search, smart stacks, and archive storage in one place — with native SPS integration for delivery. We do not undercut competitors. We price as a premium, feature-rich offering and deliver outsized value.

---

## 2. Pricing Model

**Tiered subscription based on storage volume.** Image counts shown as contextual data points (since file sizes vary by format and resolution). AI processing costs are absorbed in margins.

All tiers are available monthly or annually. Annual billing is the default presentation (17–24% discount). Most subscribers are expected to be annual.

---

## 3. Tiers

### Free — $0/mo

The free tier exists to let photographers experience the AI magic firsthand. One event is enough to see Smart Stacks, Auto Sections, and semantic search in action — and to realize they want it for every shoot.

| | |
|---|---|
| Storage | 10 GB |
| *~images (JPEG context)* | *~1,250* |
| Events | 1 |
| AI features | All (Smart Stacks, Auto Sections, Semantic Search, Filename Search, Face Search) |
| Sharing links | Unlimited |
| Custom branding | Yes |
| SPS integration | Yes |
| Team seats | 1 |
| Client favorites/proofing | — |
| Batch operations | — |
| Analytics | — |

**Cost to serve:** R2 $0.15/mo. AI processing ~$3.75 one-time. Effectively zero.

**Conversion mechanic:** Data stays in their account after trial. One event cap means every new shoot is an upgrade trigger. Share links keep working, keeping the product sticky even on Free.

### New account trial

Every new account gets **14 days of Pro** (750 GB, all features, no credit card required). After 14 days, unconverted accounts downgrade to Free. Data is preserved; they just can't upload more or create new events beyond the 1-event Free cap.

---

### Solo — $25/mo · $19/mo annual ($228/yr)

The approachable entry point. Part-time photographers, newer pros, or anyone archiving a moderate volume of shoots.

| | |
|---|---|
| Storage | 100 GB |
| *~images (JPEG)* | *~12,500* |
| *~images (mixed RAW + JPEG)* | *~8,600* |
| Events | Unlimited |
| AI features | All |
| Sharing links | Unlimited |
| Custom branding | Yes |
| SPS integration | Yes |
| Team seats | 1 |
| Client favorites/proofing | — |
| Batch operations | — |
| Analytics | — |

---

### Pro — $59/mo · $49/mo annual ($588/yr)

The working professional. Client-facing features unlock here — favorites, proofing, and team collaboration. This is the natural tier for active SPS users who want the full archive-to-delivery pipeline.

| | |
|---|---|
| Storage | 750 GB |
| *~images (JPEG)* | *~93,000* |
| *~images (mixed RAW + JPEG)* | *~65,000* |
| Events | Unlimited |
| AI features | All |
| Sharing links | Unlimited |
| Custom branding | Yes |
| SPS integration | Yes |
| Team seats | 3 |
| Client favorites/proofing | Yes |
| Batch operations | — |
| Analytics | — |

---

### Studio — $99/mo · $79/mo annual ($948/yr)

Multi-photographer studios and high-volume operations. Batch workflows, analytics, and generous team seats. Additional storage available for studios that outgrow 2 TB.

| | |
|---|---|
| Storage | 2 TB |
| *~images (JPEG)* | *~250,000* |
| *~images (mixed RAW + JPEG)* | *~173,000* |
| Events | Unlimited |
| AI features | All |
| Sharing links | Unlimited |
| Custom branding | Yes |
| SPS integration | Yes |
| Team seats | 10 |
| Client favorites/proofing | Yes |
| Batch operations | Yes (bulk download, move, delete, tag, export to SPS) |
| Analytics | Yes |
| Additional storage | $5 / 100 GB / mo |

---

### Enterprise — Custom pricing

For operations exceeding 5 TB or needing SLA guarantees. Contact sales.

- Unlimited storage (negotiated)
- Unlimited team seats
- Dedicated support + SLA
- Custom integrations
- Everything in Studio

---

## 4. Feature Gate Philosophy

Gates are minimal and intentional. Storage is the primary upgrade driver — not artificial feature restrictions.

**Ungated across all tiers (including Free):**
- Smart Stacks (face + burst)
- Auto Sections (scene-based + headshot alphabetical)
- Semantic search (CLIP-powered natural language)
- Filename search
- Face search (selfie upload)
- Unlimited sharing links
- Custom branding on shared galleries
- SPS integration (import + enhancement export)
- Full AI processing (CLIP, ArcFace, aesthetic scoring)

**Gated features and rationale:**

| Feature | Available | Why gated |
|---|---|---|
| Client favorites/proofing | Pro+ | Delivery workflow — solo archiving vs. client collaboration is a natural segmentation |
| Team seats (3+) | Pro+ | Real cost/complexity scaling with concurrent users |
| Batch operations | Studio | Studio workflow tool (bulk download ZIP, move between events, bulk tag, bulk export to SPS) |
| Analytics dashboard | Studio | Enterprise-grade reporting need |
| Additional storage purchase | Studio | Growth path before Enterprise |

---

## 5. Storage & R2 Economics

### What the customer sees
Storage tiers in GB/TB with approximate image counts as context. Overages are handled via a soft gate — a banner appears when approaching the limit, uploads blocked at 110%. No surprise charges.

### What it costs us (Cloudflare R2)
- **Storage:** $0.015 / GB / month ($15.36 / TB / month)
- **Egress:** Free (this is our structural advantage — client gallery viewing costs $0)
- **Class A operations (writes):** $4.50 / million
- **Class B operations (reads):** $0.36 / million
- **Thumbnails:** 3 sizes generated per image, stored alongside originals, included in storage allocation

### Additional storage pricing (Studio tier)
$5 per 100 GB per month ($50 / TB). Our R2 cost is $15.36/TB, yielding ~69% margin on overage storage.

### Margin analysis (annual billing)

| Tier | Revenue/mo | R2 cost | AI cost | Total cost | Gross margin |
|---|---|---|---|---|---|
| Free | $0 | $0.15 | ~$0.02 | $0.17 | N/A (acquisition) |
| Solo ($19) | $19 | $1.50 | $0.40 | $1.90 | **90%** |
| Pro ($49) | $49 | $11.25 | $3.00 | $14.25 | **71%** |
| Studio ($79) | $79 | $30.72 | $7.50 | $38.22 | **52%** |
| +1 TB overage | $50 | $15.36 | — | $15.36 | **69%** |

AI costs assume ~$0.003/image for CLIP + ArcFace + aesthetic scoring on Modal. These are one-time per image (on upload), not recurring. The AI cost column reflects amortized monthly processing for a steadily growing archive.

Studio margin improves as users add overage storage (69% margin on add-ons). Blended Studio margin with 500 GB overage: ~56%.

---

## 6. Competitive Pricing Context

| Platform | Category | Top tier | Our comparison |
|---|---|---|---|
| ShootProof | Gallery + sales | $50/mo unlimited | Pixeltrunk Studio at $79/mo includes AI that ShootProof doesn't offer |
| Pixieset Suite | All-in-one | $55/mo annual | Pixeltrunk Pro at $49/mo with superior AI capabilities |
| Pic-Time | Gallery + print | $42/mo annual | Pixeltrunk Pro comparable price, adds AI organization |
| Narrative Select | AI culling + editing | $60/mo | Pixeltrunk Studio at $79/mo adds archive + search + sharing |
| AfterShoot | AI culling + editing | $60/mo | Pixeltrunk Studio at $79/mo adds archive + search + sharing |
| SmugMug Pro | Portfolio + sales | $37/mo annual | Pixeltrunk Solo at $19/mo adds AI, comparable archive |
| CloudSpot | Gallery + CRM | $50/mo unlimited | Pixeltrunk Pro at $49/mo with AI features CloudSpot lacks |

**Key positioning:** Photographers paying for both a gallery platform ($30–55/mo) and an AI culling tool ($20–60/mo) spend $50–115/mo total. Pixeltrunk Pro at $49/mo or Studio at $79/mo replaces the AI tool and provides archive/search capabilities neither category offers alone.

---

## 7. Open Pricing Questions

1. **SPS bundle discount** — Should existing SPS subscribers get a discount on Pixeltrunk (or vice versa)? A 10–20% loyalty discount could accelerate cross-adoption.
2. **Annual-only option** — Should we offer monthly at all, or go annual-only like SmugMug? Monthly provides flexibility but annual improves cash flow and retention.
3. **Education/nonprofit pricing** — Discounted tiers for schools, churches, nonprofits? Common in the space.
4. **Referral program** — Free month or storage bonus for referrals? Photographers talk to each other constantly.
5. **Launch pricing** — Introductory rate for early adopters? e.g. "Founding member" pricing locked in permanently at 20% off.
