# SPS v2 → Cloudflare R2 Storage Migration Briefing

## Overview
Migrate SimplePhotoShare (SPS v2) from Supabase Storage to Cloudflare R2. Precursor to sharing storage infrastructure with Pixeltrunk. **No active users on SPS v2 — zero disruption risk.**

## Why R2?
- **20x cheaper at scale** (zero egress fees vs $0.09/GB on Supabase)
- S3-compatible API — minimal code changes
- Shared infrastructure with Pixeltrunk

---

## Current Architecture

### Supabase Storage Buckets
| Bucket | Max Size | Access | Purpose |
|--------|----------|--------|---------|
| `images` | 50 MB | Public | All photo uploads (5 size variants per image) |
| `assets` | 10 MB | Public | Event assets, watermark overlays |
| `watermarks` | 5 MB | Private | User-uploaded watermark files |

### Image Path Structure
```
{user_id}/{event_id}/{image_id}/{size}.jpg
```

### Size Variants (generated server-side with Sharp)
| Name | Spec |
|------|------|
| `thumb` | 200px wide |
| `medium` | 1200px wide |
| `large` | 2400px wide |
| `original` | Untouched |
| `email_thumb` | 300×300px square crop |

### Database Schema (`images` table)
URL columns that will need updating:
- `thumbnail_url`, `medium_url`, `large_url`, `original_url`, `ai_version_url`, `email_thumb_url`
- `storage_path` — relative path (critical for reconstructing URLs after migration)

### Storage API Patterns
| Operation | Count | Notes |
|-----------|-------|-------|
| `.upload()` | 7 locations | Standard file upload |
| `.getPublicUrl()` | 6 locations | No signed URLs used anywhere |
| `.remove()` | 4 locations | With 1000-file batch chunking |
| `.createSignedUrl()` | **0** | Not used — simplifies migration |
| Supabase transforms | **0** | All processing via Sharp server-side |

---

## ⚠️ BUG — Fix Before Migration

**Bucket naming inconsistency**: Upload code uses `'images'` but two cleanup routes reference `'event-images'`. Deletions are silently failing.

**Fix these two files** (change `'event-images'` → `'images'`):
- `apps/admin/src/app/api/events/cleanup/route.ts`
- `apps/master-admin/src/app/api/admin/events/[eventId]/route.ts`

---

## Files Referencing Storage (~18 files)

### Upload Operations (.upload)
1. `packages/shared/src/utils/imageProcessing.ts` — main image pipeline
2. `apps/gallery/src/app/api/upload/route.ts` — gallery upload endpoint
3. `apps/admin/src/app/api/events/[eventId]/assets/route.ts` — event assets
4. `apps/gallery/src/app/api/watermark/route.ts` — watermark upload
5. `packages/shared/src/utils/watermark.ts` — watermark processing

### Public URL Generation (.getPublicUrl)
6. `packages/shared/src/utils/imageProcessing.ts` — URL generation after upload
7. `apps/gallery/src/components/ImageGallery.tsx` — display
8. `apps/admin/src/components/EventImages.tsx` — admin display
9. `apps/gallery/src/app/api/download/route.ts` — download endpoint

### Deletion (.remove)
10. `apps/admin/src/app/api/events/cleanup/route.ts` ⚠️ BUG
11. `apps/master-admin/src/app/api/admin/events/[eventId]/route.ts` ⚠️ BUG
12. `packages/shared/src/utils/imageProcessing.ts` — replace on re-upload

### Storage Client Init
13. `packages/shared/src/lib/supabase.ts` — Supabase client creation

### Desktop App (Tauri)
14. `apps/desktop/src/lib/supabase.ts` — desktop storage client
15. `apps/desktop/src/components/Upload.tsx` — upload via HTTP plugin

---

## Migration Steps

### Step 1: Fix the Bug (5 min)
Change `'event-images'` → `'images'` in two cleanup routes (see above).

### Step 2: Set Up R2 (15 min)
- Create R2 bucket in Cloudflare dashboard
- Configure public access (custom domain or R2.dev subdomain)
- Generate API credentials (Access Key ID + Secret Access Key)

### Step 3: Copy Existing Files
```bash
# R2 is S3-compatible — use rclone or aws cli
rclone sync supabase:images r2:sps-images --progress
rclone sync supabase:assets r2:sps-assets --progress
rclone sync supabase:watermarks r2:sps-watermarks --progress
```

### Step 4: Create R2 Storage Client
Replace Supabase storage client with S3 SDK:

```typescript
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})
```

### Step 5: Replace Storage Operations (~18 files)
| Supabase Pattern | R2 Equivalent |
|------------------|---------------|
| `.upload(path, file)` | `PutObjectCommand({ Bucket, Key, Body, ContentType })` |
| `.getPublicUrl(path)` | Template literal: `` `${R2_PUBLIC_URL}/${path}` `` |
| `.remove([paths])` | `DeleteObjectCommand({ Bucket, Key })` in a loop |

### Step 6: Update Database URLs
```sql
UPDATE images SET
  thumbnail_url = REPLACE(thumbnail_url, 'OLD_SUPABASE_URL', 'NEW_R2_URL'),
  medium_url    = REPLACE(medium_url,    'OLD_SUPABASE_URL', 'NEW_R2_URL'),
  large_url     = REPLACE(large_url,     'OLD_SUPABASE_URL', 'NEW_R2_URL'),
  original_url  = REPLACE(original_url,  'OLD_SUPABASE_URL', 'NEW_R2_URL'),
  email_thumb_url = REPLACE(email_thumb_url, 'OLD_SUPABASE_URL', 'NEW_R2_URL')
WHERE thumbnail_url LIKE '%OLD_SUPABASE_URL%';
```

### Step 7: Environment Variables
```env
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_PUBLIC_URL=https://storage.yourdomain.com
R2_BUCKET_IMAGES=sps-images
R2_BUCKET_ASSETS=sps-assets
R2_BUCKET_WATERMARKS=sps-watermarks
```

### Step 8: Access Control
- **Public buckets** (images, assets): Serve via public URL — same as current
- **Private bucket** (watermarks): Proxy through API routes or use presigned URLs
- Upload auth unchanged: existing API routes authenticate before uploading

### Step 9: Desktop App
Update Tauri app's storage client and upload component to use R2.

### Step 10: Verify
- [ ] All uploads working (gallery, admin, desktop)
- [ ] All images display correctly across all size variants
- [ ] Event cleanup/deletion removes files from R2
- [ ] Watermark upload and application working
- [ ] Download endpoints working
- [ ] No remaining references to old Supabase storage URLs
- [ ] Remove old Supabase storage buckets after full verification

---

## Risk: LOW
- No active users = zero disruption risk
- S3-compatible API = mechanical code changes
- No Supabase-specific features used = clean swap
- All processing server-side with Sharp = no client changes
- `storage_path` column enables URL reconstruction
