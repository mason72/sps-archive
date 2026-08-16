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
  /**
   * Pull an SPS event's camera files into the archive. Carries only the job id —
   * every other fact lives on the `sps_pull_jobs` row, so a re-send is always a
   * resume rather than a second interpretation of the same import. The lane
   * self-continues by re-sending this event when a run has used its step budget.
   */
  "sps/pull.requested": {
    data: {
      jobId: string;
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
  /**
   * Ask the naming engine to match an event's anonymous face clusters against
   * the archive's named identities. Fired after clustering; writes only
   * SUGGESTIONS — a human confirms, always.
   */
  "people/identity-scan.requested": {
    data: {
      eventId: string;
    };
  };
};

export const inngest = new Inngest({
  id: "pixeltrunk",
  schemas: new EventSchemas().fromRecord<Events>(),
});
