# Pixeltrunk — Pricing Strategy

**Status:** Approved direction (planning doc — not all features priced here ship today)
**Last updated:** 2026-05-30

> IMPORTANT — read before using this for marketing. This document was written assuming the AI features (Smart Stacks, semantic search, face search, Auto Sections, aesthetic scoring) are live. **They are not active in production yet** (the Modal pipeline is unconfigured). The pricing structure below (storage tiers, prices, margins) is the plan of record, but any tier copy that promises "AI" must be gated to what actually ships, or reframed as "coming soon," until the pipeline is stood up. Treat AI-feature mentions below as the intended end state, not current capability.

What ships today and justifies the price right now: unlimited events/photos within the storage tier, section-based organization, client gallery sharing with passwords/PIN, client favorites/proofing, downloads, custom branding, and (zero-egress) R2-backed storage.

---

## 1. Positioning

Photographers typically pay two bills — gallery/delivery (ShootProof, Pixieset, Pic-Time: ~$20-65/mo) and, separately, AI culling (Narrative, AfterShoot: ~$10-60/mo). Pixeltrunk's long-term play is to combine archive storage, organized client delivery, and (once active) AI organization in one product with native SPS integration. Premium positioning; we sell on value, not by undercutting.

---

## 2. Pricing Model

**Tiered subscription based on storage volume.** Image counts are shown only as context (file sizes vary by format/resolution). Available monthly or annually; annual is the default presentation (17-24% discount).

---

## 3. Tiers

> "AI features" rows below describe the intended end state. Until the Modal pipeline is live, treat them as not-yet-available regardless of tier.

### Free — $0/mo
| | |
|---|---|
| Storage | 10 GB (~1,250 JPEGs) |
| Events | 1 |
| Sharing links | Unlimited |
| Custom branding | Yes |
| SPS integration | Yes (import) |
| Team seats | 1 |
| Client favorites/proofing | — |
| AI features *(planned)* | All, once live |

**Cost to serve:** R2 ~$0.15/mo. Effectively zero. **Conversion mechanic:** data persists after trial; the 1-event cap makes every new shoot an upgrade trigger; share links keep working.

**New-account trial:** 14 days of Pro (750 GB, all then-available features, no card). Unconverted accounts drop to Free; data is preserved but uploads/new events are capped at the Free limit.

### Solo — $25/mo · $19/mo annual ($228/yr)
| | |
|---|---|
| Storage | 100 GB (~12,500 JPEG / ~8,600 mixed RAW+JPEG) |
| Events | Unlimited |
| Team seats | 1 |
| Client favorites/proofing | — |
| Custom branding, sharing, SPS import | Yes |
| AI features *(planned)* | All, once live |

### Pro — $59/mo · $49/mo annual ($588/yr)
Client-facing features unlock here.
| | |
|---|---|
| Storage | 750 GB (~93,000 JPEG / ~65,000 mixed) |
| Events | Unlimited |
| Team seats | 3 |
| Client favorites/proofing | Yes |
| Custom branding, sharing, SPS import | Yes |
| AI features *(planned)* | All, once live |

### Studio — $99/mo · $79/mo annual ($948/yr)
| | |
|---|---|
| Storage | 2 TB (~250,000 JPEG / ~173,000 mixed) |
| Events | Unlimited |
| Team seats | 10 |
| Client favorites/proofing | Yes |
| Batch operations | Yes (bulk download, move, delete, tag, export to SPS) |
| Analytics | Yes |
| Additional storage | $5 / 100 GB / mo |
| AI features *(planned)* | All, once live |

### Enterprise — Custom
For operations beyond 5 TB or needing SLAs: negotiated storage, unlimited seats, dedicated support, custom integrations.

---

## 4. Feature-Gate Philosophy

Storage is the primary upgrade driver, not artificial feature locks.

**Intended to be ungated across all tiers (incl. Free):** sharing links, custom branding, SPS import, and — once live — all AI processing (CLIP/ArcFace/aesthetic), Smart Stacks, Auto Sections, semantic + face search.

**Gated:**
| Feature | Available | Why |
|---|---|---|
| Client favorites/proofing | Pro+ | Solo archiving vs. client collaboration is a natural split |
| Team seats (3+) | Pro+ | Cost/complexity scales with concurrent users |
| Batch operations | Studio | Studio workflow tool |
| Analytics dashboard | Studio | Reporting need |
| Additional storage purchase | Studio | Growth path before Enterprise |

---

## 5. Storage & R2 Economics

**What the customer sees:** GB/TB tiers with approximate image counts. Soft gate — a banner near the limit, uploads blocked at 110%. No surprise charges.

**What R2 costs us:**
- Storage: $0.015 / GB / mo ($15.36 / TB / mo)
- Egress: **free** (structural advantage — client gallery viewing costs $0)
- Class A (writes): $4.50 / million · Class B (reads): $0.36 / million
- Thumbnails: 3 sizes per image, stored alongside originals, counted in the allocation

**Additional storage (Studio):** $5 / 100 GB / mo ($50/TB) vs. our $15.36/TB cost -> ~69% margin.

**Margin analysis (annual billing):**
| Tier | Rev/mo | R2 cost | AI cost* | Total | Margin |
|---|---|---|---|---|---|
| Free | $0 | $0.15 | ~$0.02 | $0.17 | acquisition |
| Solo ($19) | $19 | $1.50 | $0.40 | $1.90 | **90%** |
| Pro ($49) | $49 | $11.25 | $3.00 | $14.25 | **71%** |
| Studio ($79) | $79 | $30.72 | $7.50 | $38.22 | **52%** |
| +1 TB overage | $50 | $15.36 | — | $15.36 | **69%** |

\* AI cost assumes ~$0.003/image one-time on Modal **once the pipeline is live**. Today AI cost is $0 (dormant), so current margins are slightly higher than shown.

---

## 6. Competitive Pricing Context

| Platform | Category | Top tier | Comparison |
|---|---|---|---|
| ShootProof | Gallery + sales | $50/mo unlimited | Studio $79/mo (adds AI once live) |
| Pixieset Suite | All-in-one | $55/mo annual | Pro $49/mo |
| Pic-Time | Gallery + print | $42/mo annual | Pro comparable, adds organization |
| Narrative Select | AI culling | $60/mo | Studio adds archive + sharing |
| AfterShoot | AI culling | $60/mo | Studio adds archive + sharing |
| SmugMug Pro | Portfolio + sales | $37/mo annual | Solo $19/mo |
| CloudSpot | Gallery + CRM | $50/mo unlimited | Pro $49/mo |

---

## 7. Open Pricing Questions

1. **SPS bundle discount** — loyalty discount for existing SPS subscribers to drive cross-adoption?
2. **Annual-only?** — drop monthly for cash-flow/retention, or keep for flexibility?
3. **Education/nonprofit pricing** — discounted tiers for schools/churches/nonprofits?
4. **Referral program** — free month or storage bonus?
5. **Launch pricing** — founding-member rate locked in at ~20% off?
6. **AI gating at launch** — if AI ships after paid launch, how to price/communicate tiers in the interim (the open question this doc most depends on).
