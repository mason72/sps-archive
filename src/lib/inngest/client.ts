import { Inngest, EventSchemas } from "inngest";

// Typed event schemas for the processing pipeline
type Events = {
  "image/uploaded": {
    data: {
      imageId: string;
      eventId: string;
      r2Key: string;
    };
  };
  "image/processed": {
    data: {
      imageId: string;
      eventId: string;
    };
  };
  "video/uploaded": {
    data: {
      imageId: string;
      eventId: string;
      r2Key: string;
    };
  };
  "event/imported": {
    data: {
      eventId: string;
      imageCount: number;
    };
  };
  "event/processing.complete": {
    data: {
      eventId: string;
    };
  };
  "zip/requested": {
    data: {
      jobId: string;
    };
  };
  // Manual trigger for the nightly upload reconciler (on-demand sweeps).
  "reconciler/run": {
    data: Record<string, never>;
  };
  // Recompose the cover raster (mosaic/solid) for email/OG serving.
  "cover/raster.generate": {
    data: {
      eventId: string;
    };
  };
  // Face-scan a cover's source images and fill missing focal points.
  "cover/focal.suggest": {
    data: {
      eventId: string;
    };
  };
  /**
   * Give an event's images face-based focal points. Debounced per event, so an
   * hour-long upload session fires it once after the dust settles rather than
   * per photo. Self-continues while candidates remain.
   */
  "focal/auto.suggest": {
    data: {
      eventId: string;
    };
  };
};

export const inngest = new Inngest({
  id: "pixeltrunk",
  schemas: new EventSchemas().fromRecord<Events>(),
});
