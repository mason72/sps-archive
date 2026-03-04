import { createServiceClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateSection {
  name: string;
  sortOrder: number;
  filterQuery?: string;
}

export interface MatchedTemplate {
  id: string;
  name: string;
  sections: TemplateSection[];
  settings: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Default templates for common event types (used when no user template exists)
// ---------------------------------------------------------------------------

const DEFAULT_TEMPLATES: Record<
  string,
  { name: string; sections: TemplateSection[] }
> = {
  wedding: {
    name: "Wedding",
    sections: [
      { name: "Getting Ready", sortOrder: 0, filterQuery: "getting-ready" },
      { name: "Ceremony", sortOrder: 1, filterQuery: "ceremony" },
      { name: "Portraits", sortOrder: 2, filterQuery: "portrait" },
      { name: "Reception", sortOrder: 3, filterQuery: "reception" },
      { name: "Speeches & Toasts", sortOrder: 4, filterQuery: "speeches" },
      { name: "First Dance", sortOrder: 5, filterQuery: "first-dance" },
      { name: "Details", sortOrder: 6, filterQuery: "detail-shot" },
    ],
  },
  corporate: {
    name: "Corporate Event",
    sections: [
      { name: "Presentations", sortOrder: 0, filterQuery: "presentation" },
      { name: "Networking", sortOrder: 1, filterQuery: "networking" },
      { name: "Panels", sortOrder: 2, filterQuery: "panel" },
      { name: "Headshots", sortOrder: 3, filterQuery: "headshot" },
      { name: "Venue & Details", sortOrder: 4, filterQuery: "venue" },
    ],
  },
  headshot: {
    name: "Headshot Session",
    sections: [
      { name: "All Headshots", sortOrder: 0, filterQuery: "headshot" },
      { name: "Portraits", sortOrder: 1, filterQuery: "portrait" },
    ],
  },
  portrait: {
    name: "Portrait Session",
    sections: [
      { name: "Portraits", sortOrder: 0, filterQuery: "portrait" },
      { name: "Candids", sortOrder: 1, filterQuery: "candid" },
      { name: "Details", sortOrder: 2, filterQuery: "detail-shot" },
    ],
  },
  event: {
    name: "Event",
    sections: [
      { name: "Group Photos", sortOrder: 0, filterQuery: "group-photo" },
      { name: "Candids", sortOrder: 1, filterQuery: "candid" },
      { name: "Venue & Details", sortOrder: 2, filterQuery: "venue" },
      { name: "Food & Drink", sortOrder: 3, filterQuery: "food" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Template matching
// ---------------------------------------------------------------------------

/**
 * Find the best matching event template for a detected event type.
 *
 * First checks for user-created templates, then falls back to built-in defaults.
 */
export async function matchEventTemplate(
  detectedType: string,
  eventId: string
): Promise<MatchedTemplate | null> {
  const supabase = createServiceClient();

  // Get the event's user_id for user template lookup
  const { data: event } = await supabase
    .from("events")
    .select("user_id")
    .eq("id", eventId)
    .single();

  if (!event) return null;

  // Check for user-created templates matching this event type
  const { data: userTemplates } = await supabase
    .from("event_templates")
    .select("id, name, settings, sections")
    .eq("user_id", event.user_id)
    .order("created_at", { ascending: false });

  if (userTemplates && userTemplates.length > 0) {
    // Try to find a template that matches the detected type
    const matchingTemplate = userTemplates.find((t: { settings: unknown }) => {
      const settings = (t.settings ?? {}) as Record<string, unknown>;
      return settings.event_type === detectedType;
    });

    if (matchingTemplate) {
      const sections = Array.isArray(matchingTemplate.sections)
        ? (matchingTemplate.sections as TemplateSection[])
        : [];

      return {
        id: matchingTemplate.id,
        name: matchingTemplate.name,
        sections,
        settings: (matchingTemplate.settings ?? {}) as Record<string, unknown>,
      };
    }
  }

  // Fall back to default template
  const defaultTemplate = DEFAULT_TEMPLATES[detectedType];
  if (defaultTemplate) {
    return {
      id: `default-${detectedType}`,
      name: defaultTemplate.name,
      sections: defaultTemplate.sections,
      settings: { event_type: detectedType, is_default: true },
    };
  }

  return null;
}

/**
 * Get all available templates (user + defaults) for display in UI.
 */
export async function getAvailableTemplates(
  userId: string
): Promise<MatchedTemplate[]> {
  const supabase = createServiceClient();

  const templates: MatchedTemplate[] = [];

  // User templates
  const { data: userTemplates } = await supabase
    .from("event_templates")
    .select("id, name, settings, sections")
    .eq("user_id", userId)
    .order("name");

  if (userTemplates) {
    for (const t of userTemplates) {
      templates.push({
        id: t.id,
        name: t.name,
        sections: Array.isArray(t.sections)
          ? (t.sections as TemplateSection[])
          : [],
        settings: (t.settings ?? {}) as Record<string, unknown>,
      });
    }
  }

  // Default templates
  for (const [type, template] of Object.entries(DEFAULT_TEMPLATES)) {
    templates.push({
      id: `default-${type}`,
      name: template.name,
      sections: template.sections,
      settings: { event_type: type, is_default: true },
    });
  }

  return templates;
}
