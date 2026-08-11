import { ElephantWalk } from "@/components/brand/ElephantWalk";

/**
 * /people takes a few seconds honestly: it scans the whole archive and
 * presigns a thumbnail for every person. A skeleton grid implied the page was
 * nearly there; the elephant says "this is work, it's happening" — which is
 * the truth, and is the sort of wait worth making pleasant rather than hiding.
 */
export default function Loading() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-8">
      <ElephantWalk
        message="Gathering everyone you've photographed…"
        detail="Reading every event in the archive — this takes a few seconds."
      />
    </div>
  );
}
