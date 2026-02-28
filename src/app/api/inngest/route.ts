import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  processUploadedImage,
  buildEventStacks,
  processImportedEvent,
} from "@/lib/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processUploadedImage, buildEventStacks, processImportedEvent],
});
