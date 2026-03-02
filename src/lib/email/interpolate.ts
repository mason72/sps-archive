/**
 * Interpolate template variables in email HTML.
 * Replaces {event_name}, {gallery_link}, {business_name}, etc.
 */
export function interpolateTemplate(
  html: string,
  vars: Record<string, string>
): string {
  return html.replace(/\{(\w+)\}/g, (match, key) => {
    return vars[key] ?? match;
  });
}
