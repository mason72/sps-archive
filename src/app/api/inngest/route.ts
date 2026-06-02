import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  processUploadedImage,
  processImportedEvent,
} from "@/lib/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processUploadedImage, processImportedEvent],
});
