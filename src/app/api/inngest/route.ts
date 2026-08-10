import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  processUploadedImage,
  processUploadedVideo,
  processImportedEvent,
  favoritesDigest,
  zipBuild,
  zipCleanup,
  uploadReconciler,
  coverRaster,
  coverFocal,
  autoFocal,
  aiIndex,
  faceCluster,
} from "@/lib/inngest/functions";

// zip-build streams a whole gallery into R2 inside one step — give the
// execution route the Fluid ceiling, same reasoning as the download route.
export const maxDuration = 800;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processUploadedImage,
    processUploadedVideo,
    processImportedEvent,
    favoritesDigest,
    zipBuild,
    zipCleanup,
    uploadReconciler,
    coverRaster,
    coverFocal,
    autoFocal,
    aiIndex,
    faceCluster,
  ],
});
