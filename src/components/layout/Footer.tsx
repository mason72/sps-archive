/**
 * Footer — Shared site footer with pixeltrunk wordmark + tagline.
 *
 * Pure presentational — works in both server and client components.
 * Note: The public gallery page (gallery/[slug]) uses its own branded footer.
 */
export function Footer() {
  return (
    <footer className="px-8 md:px-16 py-8 border-t border-stone-200 mt-auto">
      <p className="text-[12px] text-stone-400">
        <span className="font-brand text-[14px] text-stone-900">
          pixeltrunk
        </span>
        {" "}— Intelligent photo archiving for professionals
      </p>
    </footer>
  );
}
