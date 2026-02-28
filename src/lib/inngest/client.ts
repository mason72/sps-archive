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
};

export const inngest = new Inngest({
  id: "sps-prism",
  schemas: new EventSchemas().fromRecord<Events>(),
});
