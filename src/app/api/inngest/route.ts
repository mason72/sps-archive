import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  processUploadedImage,
  processUploadedVideo,
  processImportedEvent,
} from "@/lib/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processUploadedImage, processUploadedVideo, processImportedEvent],
});
