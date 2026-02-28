import Link from "next/link";
import Image from "next/image";

interface NavProps {
  /** Page-specific nav items rendered on the right side */
  children?: React.ReactNode;
}

/**
 * Nav — Shared navigation bar with elephant logo + pixeltrunk wordmark.
 *
 * Pure presentational — works in both server and client components.
 * Each page passes its own nav items (auth links, action buttons, etc.) as children.
 */
export function Nav({ children }: NavProps) {
  return (
    <>
      <nav className="flex items-center justify-between px-8 py-8 md:px-16 fade-in">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="pixeltrunk"
            width={32}
            height={32}
            className="rounded-md"
          />
          <span className="font-brand text-[22px] text-stone-900">
            pixeltrunk
          </span>
        </Link>
        {children && (
          <div className="flex items-center gap-8 text-[13px] tracking-wide">
            {children}
          </div>
        )}
      </nav>
      <div className="mx-8 md:mx-16 rule reveal-line" />
    </>
  );
}
