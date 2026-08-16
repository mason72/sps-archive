import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { spsPull } from "@/lib/inngest/sps-pull";
import {
  processUploadedImage,
  processUploadedVideo,
  favoritesDigest,
  zipBuild,
  zipCleanup,
  uploadReconciler,
  coverRaster,
  coverFocal,
  autoFocal,
  aiIndex,
  faceCluster,
  identityScan,
} from "@/lib/inngest/functions";
import {
  usageAnomalyDaily,
  pricingSummaryWeekly,
} from "@/lib/inngest/ops-functions";

// zip-build streams a whole gallery into R2 inside one step — give the
// execution route the Fluid ceiling, same reasoning as the download route.
export const maxDuration = 800;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processUploadedImage,
    processUploadedVideo,
    spsPull,
    favoritesDigest,
    zipBuild,
    zipCleanup,
    uploadReconciler,
    coverRaster,
    coverFocal,
    autoFocal,
    aiIndex,
    faceCluster,
    identityScan,
    usageAnomalyDaily,
    pricingSummaryWeekly,
  ],
});
