import { NextResponse } from "next/server";
import { requireScoutKey } from "@/lib/scout-integration/auth";
import { SCOUT_PUBLISH_TARGETS } from "@/lib/scout-integration/validate";
import { sceneForKey } from "@/lib/site/scenes";

/** GET /api/integrations/scout/publish-targets — the website scenes a postcard may go to. */
export async function GET(request: Request) {
  const refused = requireScoutKey(request);
  if (refused) return refused;
  return NextResponse.json({
    targets: SCOUT_PUBLISH_TARGETS.map((key) => ({ key, label: sceneForKey(key)?.label ?? key })),
  });
}
