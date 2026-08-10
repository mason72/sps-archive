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
  // Manual triggers for the ops crons (first-run verification, on-demand).
  "ops/anomaly.run": {
    data: Record<string, never>;
  };
  "ops/pricing-summary.run": {
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
  /**
   * AI-index an event (SigLIP-2 embeddings, face embeddings, quality scores).
   * Settlement-triggered: debounced 15m per event AND the job re-checks that
   * no uploads are pending before touching anything. Fired from upload
   * finalize/reconcile paths and the nightly reconciler sweep.
   */
  "ai/index.requested": {
    data: {
      eventId: string;
    };
  };
  /**
   * (Re)cluster an event's faces into persons. Fired when ai-index finishes
   * an event; incremental and name-preserving, so safe to over-fire.
   */
  "faces/cluster.requested": {
    data: {
      eventId: string;
    };
  };
};

export const inngest = new Inngest({
  id: "pixeltrunk",
  schemas: new EventSchemas().fromRecord<Events>(),
});
