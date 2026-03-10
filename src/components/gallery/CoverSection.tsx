import { cn } from "@/lib/utils";

interface CoverSectionProps {
  imageUrl: string;
  eventName: string;
  headingClass: string;
  primaryColor?: string;
  titlePosition: "above" | "over" | "below";
  titleAlignment?: "left" | "center" | "right";
  titlePlacement?: { vertical: string; horizontal: string };
}

/**
 * Shared cover section for public + preview galleries.
 *
 * Three modes:
 * - `above` / `below` — renders just the hero image (parent handles title)
 * - `over` — renders image + title overlay at chosen placement with gradient
 */
export function CoverSection({
  imageUrl,
  eventName,
  headingClass,
  primaryColor,
  titlePosition,
  titlePlacement,
}: CoverSectionProps) {
  if (titlePosition === "over") {
    // Determine overlay alignment from titlePlacement (defaults to center/center)
    const v = titlePlacement?.vertical || "center";
    const h = titlePlacement?.horizontal || "center";

    // flex-col: justify-* = vertical (main axis), items-* = horizontal (cross axis)
    const verticalClass =
      v === "top" ? "justify-start" : v === "bottom" ? "justify-end" : "justify-center";
    const horizontalClass =
      h === "left" ? "items-start text-left" : h === "right" ? "items-end text-right" : "items-center text-center";

    return (
      <div className="relative h-[50vh] md:h-[60vh] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          className="w-full h-full object-cover ken-burns-settle"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/20 to-transparent" />
        <div
          className={cn(
            "absolute inset-0 flex flex-col p-8 md:p-16",
            verticalClass,
            horizontalClass
          )}
        >
          <h1
            className={cn(
              headingClass,
              "text-[clamp(36px,6vw,72px)] leading-[0.95] text-white"
            )}
          >
            {eventName}
          </h1>
        </div>
      </div>
    );
  }

  // above / below — just the image, parent handles title
  return (
    <div className="relative h-[50vh] md:h-[60vh] overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt=""
        className="w-full h-full object-cover ken-burns-settle"
        style={{ color: primaryColor }}
      />
    </div>
  );
}
