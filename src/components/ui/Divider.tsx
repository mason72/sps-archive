import { cn } from "@/lib/utils";

/**
 * Editorial divider. Pages and modules previously used three different
 * primitives for the same role — `editorial-divider` with an inline
 * label, raw `border-t border-stone-200`, and opacity-30 hairlines on
 * the gallery — all visually similar but inconsistent in spacing and
 * tone. This component is the one path.
 *
 *   <Divider />                       // plain hairline rule
 *   <Divider label="Recent" />        // hairline with centered label
 *   <Divider label="Filters" right /> // label aligned to the right end
 *
 * Color comes from currentColor + opacity so it inherits the surrounding
 * text color cleanly (works under the public gallery's photographer-
 * branded palette as well as the stone app surfaces).
 */
interface Props {
  label?: React.ReactNode;
  /** Push the label to the right end instead of centering it. */
  right?: boolean;
  className?: string;
}

export function Divider({ label, right, className }: Props) {
  if (!label) {
    return (
      <div
        role="separator"
        className={cn("h-px w-full bg-stone-200/80", className)}
      />
    );
  }

  return (
    <div
      role="separator"
      aria-label={typeof label === "string" ? label : undefined}
      className={cn("flex items-center gap-4", className)}
    >
      {right ? <span className="h-px flex-1 bg-stone-200/80" /> : null}
      <span className="label-caps shrink-0">{label}</span>
      <span className="h-px flex-1 bg-stone-200/80" />
    </div>
  );
}
