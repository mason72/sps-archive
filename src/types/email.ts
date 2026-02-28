export interface EmailTemplate {
  id: string;
  userId: string;
  name: string;
  subject: string;
  bodyHtml: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailSend {
  id: string;
  userId: string;
  eventId: string | null;
  templateId: string | null;
  recipients: string[];
  subject: string;
  bodyHtml: string;
  status: string;
  sentAt: string;
}

/**
 * Variables available for template interpolation.
 * Used in subject and body_html fields.
 */
export const TEMPLATE_VARIABLES = [
  { key: "{event_name}", label: "Event Name", example: "Sarah & Tom's Wedding" },
  { key: "{gallery_link}", label: "Gallery Link", example: "https://pixeltrunk.app/g/abc123" },
  { key: "{business_name}", label: "Your Business Name", example: "Two Dudes Photo" },
  { key: "{photographer_name}", label: "Your Name", example: "Matt Foster" },
  { key: "{client_name}", label: "Client Name", example: "Sarah" },
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]["key"];

/** Default starter templates seeded for new users */
export const STARTER_TEMPLATES = [
  {
    name: "Gallery Ready",
    subject: "Your photos from {event_name} are ready!",
    bodyHtml: `<p>Hi {client_name},</p>
<p>Great news — your gallery from <strong>{event_name}</strong> is ready to view!</p>
<p>Click the link below to browse, download, and select your favorites:</p>
<p><a href="{gallery_link}">{gallery_link}</a></p>
<p>The gallery will be available for 30 days. Let me know if you have any questions!</p>
<p>Best,<br/>{photographer_name}<br/>{business_name}</p>`,
    isDefault: true,
  },
  {
    name: "Favorites Reminder",
    subject: "Don't forget to pick your favorites from {event_name}",
    bodyHtml: `<p>Hi {client_name},</p>
<p>Just a friendly reminder that your gallery from <strong>{event_name}</strong> is still available.</p>
<p>If you haven't already, take a moment to mark your favorite photos — I'd love to know which ones you love most!</p>
<p><a href="{gallery_link}">View your gallery →</a></p>
<p>Cheers,<br/>{photographer_name}</p>`,
    isDefault: false,
  },
] as const;
