import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-8">
      <div className="text-center max-w-md">
        <h1 className="font-editorial text-[clamp(28px,4vw,48px)] text-stone-900">
          Page not <span className="italic font-normal">found</span>
        </h1>
        <p className="text-[14px] text-stone-400 mt-3">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <div className="mt-8">
          <Link
            href="/"
            className="text-[13px] text-stone-900 border border-stone-200 px-6 py-2.5 hover:bg-stone-50 transition-colors inline-block"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
