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
 *
 * Used in subject and body_html fields. The send route resolves each
 * variable per-recipient (so {client_name} can be personalized) and
 * auto-wraps {gallery_link} as an anchor if it appears unwrapped —
 * don't pre-wrap it in templates, or you'll ship nested <a> tags.
 *
 * {client_name} resolves to a per-recipient name from the photographer's
 * "Personalize" panel, or falls back to the local-part of the email.
 */
export const TEMPLATE_VARIABLES = [
  { key: "{event_name}", label: "Event Name", example: "Sarah & Tom's Wedding" },
  { key: "{gallery_link}", label: "Gallery Link", example: "https://app.pixeltrunk.com/gallery/abc123" },
  { key: "{business_name}", label: "Your Business Name", example: "Two Dudes Photo" },
  { key: "{photographer_name}", label: "Your Name", example: "Matt Foster" },
  { key: "{client_name}", label: "Client Name", example: "Sarah (or local-part of email)" },
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]["key"];

/** Default starter templates seeded for new users.
 *
 *  `{gallery_link}` is the raw URL — DO NOT pre-wrap it in <a> tags.
 *  The send route auto-anchors bare occurrences when wrapping the body
 *  in branded chrome, and pre-wrapped templates produce nested anchors
 *  that email clients render as broken garbage.
 */
export const STARTER_TEMPLATES = [
  {
    name: "Gallery Ready",
    subject: "Your photos from {event_name} are ready",
    bodyHtml: `<p>Hi {client_name},</p>
<p>Your gallery from <strong>{event_name}</strong> is ready to view.</p>
<p>{gallery_link}</p>
<p>The gallery will be available for 30 days. Let me know if you have any questions.</p>
<p>Best,<br/>{photographer_name}</p>`,
    isDefault: true,
  },
  {
    name: "Favorites Reminder",
    subject: "Don't forget to pick your favorites from {event_name}",
    bodyHtml: `<p>Hi {client_name},</p>
<p>A friendly reminder that your gallery from <strong>{event_name}</strong> is still available.</p>
<p>If you haven't already, take a moment to mark your favorite photos — I'd love to know which ones you love most.</p>
<p>{gallery_link}</p>
<p>Cheers,<br/>{photographer_name}</p>`,
    isDefault: false,
  },
  {
    name: "More Photos Added",
    subject: "I added more photos from {event_name}",
    bodyHtml: `<p>Hi {client_name},</p>
<p>I just added a few more photos to your gallery from <strong>{event_name}</strong>. Take another look whenever you have a moment.</p>
<p>{gallery_link}</p>
<p>Best,<br/>{photographer_name}</p>`,
    isDefault: false,
  },
] as const;
