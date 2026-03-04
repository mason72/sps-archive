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
  "event/analyze": {
    data: {
      eventId: string;
      /** If true, auto-apply detected settings to the event */
      autoApply: boolean;
    };
  };
  "event/analysis.complete": {
    data: {
      eventId: string;
      detectedEventType: string;
      suggestedName: string;
      shouldSplit: boolean;
    };
  };
};

export const inngest = new Inngest({
  id: "pixeltrunk",
  schemas: new EventSchemas().fromRecord<Events>(),
});
