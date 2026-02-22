# SPS Archive

AI-powered photo archive for professional photographers. Sister product to SimplePhotoShare (spsv2).

## Quick Reference

- **Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS 4, Supabase (pgvector), Cloudflare R2, Modal GPU, Inngest
- **Status:** Scaffold complete, not yet deployed
- **Docs:** `docs/PRD.md` (product), `docs/TECHNICAL.md` (technical), `docs/SESSION-HANDOFF.md` (handoff prompt)

## Project Structure

- `src/app/` — Next.js App Router pages and API routes
- `src/components/` — UI components (button, upload, gallery, search)
- `src/lib/` — Business logic (supabase, r2, ai, upload, sps-integration)
- `modal/` — Python AI pipeline (CLIP, ArcFace, aesthetic scoring)
- `docs/` — PRD and technical documentation

## Key Patterns

- Presigned URL uploads (client → R2 direct)
- AI processing via Modal serverless GPU
- pgvector for CLIP semantic search
- Smart Stacks group similar images, surface best shot
- Auto Sections from AI scene classification
- SPS integration via shared R2 bucket (zero-copy imports)

## Design System

- Tailwind stone palette (stone-900 primary, white surfaces)
- Button variants: primary, secondary, ghost, danger
- lucide-react icons
- CSS columns masonry layout
- `cn()` utility for class merging (clsx + tailwind-merge)

## Development

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # ESLint
npm run db:gen-types # Regenerate Supabase types
modal deploy modal/ai_pipeline.py  # Deploy AI pipeline
```
