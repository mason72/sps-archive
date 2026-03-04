import { createServiceClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Summary of EXIF-derived metadata across a set of images */
export interface ExifSummary {
  earliestDate: string | null;
  latestDate: string | null;
  dateRange: string | null;
  cameras: string[];
  dominantCamera: string | null;
  hasGps: boolean;
  averageLat: number | null;
  averageLng: number | null;
  imageCount: number;
}

/** A detected time gap that may indicate separate events */
export interface TimeGap {
  /** ISO timestamp of last image before the gap */
  beforeTimestamp: string;
  /** ISO timestamp of first image after the gap */
  afterTimestamp: string;
  /** Gap duration in minutes */
  gapMinutes: number;
  /** Index in the sorted image list where the split occurs */
  splitIndex: number;
  /** Number of images before this gap */
  imageCountBefore: number;
  /** Number of images after this gap */
  imageCountAfter: number;
}

/** A suggested event from splitting a bulk upload */
export interface SuggestedEvent {
  name: string;
  eventDate: string | null;
  eventType: string;
  imageIds: string[];
  confidence: number;
  sceneSummary: Record<string, number>;
}

/** Full result from AI event analysis */
export interface EventAnalysisResult {
  /** Detected event type (wedding, corporate, headshot, etc.) */
  detectedEventType: string;
  /** Confidence in the detected type (0-1) */
  typeConfidence: number;
  /** AI-suggested event name */
  suggestedName: string;
  /** EXIF metadata summary */
  exifSummary: ExifSummary;
  /** Scene tag distribution across analyzed images */
  sceneDistribution: Record<string, number>;
  /** Detected time gaps that could split into separate events */
  timeGaps: TimeGap[];
  /** Suggested events if splitting is recommended */
  suggestedEvents: SuggestedEvent[];
  /** Whether splitting is recommended */
  shouldSplit: boolean;
}

// ---------------------------------------------------------------------------
// Event type detection rules
// ---------------------------------------------------------------------------

/** Maps scene tag patterns to event types with weights */
const EVENT_TYPE_RULES: {
  type: string;
  tags: string[];
  weight: number;
  minTagCount: number;
}[] = [
  {
    type: "wedding",
    tags: [
      "ceremony",
      "reception",
      "first-dance",
      "speeches",
      "getting-ready",
      "bridal-party",
      "cake-cutting",
      "bouquet-toss",
      "first-look",
    ],
    weight: 2.0,
    minTagCount: 2,
  },
  {
    type: "headshot",
    tags: ["headshot", "portrait"],
    weight: 1.5,
    minTagCount: 1,
  },
  {
    type: "corporate",
    tags: ["presentation", "networking", "panel", "headshot"],
    weight: 1.5,
    minTagCount: 2,
  },
  {
    type: "portrait",
    tags: ["portrait", "outdoor", "golden-hour"],
    weight: 1.0,
    minTagCount: 2,
  },
  {
    type: "event",
    tags: [
      "group-photo",
      "candid",
      "food",
      "venue",
      "decoration",
      "indoor",
    ],
    weight: 1.0,
    minTagCount: 2,
  },
];

// ---------------------------------------------------------------------------
// Core analysis functions
// ---------------------------------------------------------------------------

/**
 * Analyze a set of images to detect event type, extract metadata,
 * and suggest event creation parameters.
 *
 * Can work with either:
 * - imageIds: analyze already-uploaded images in the DB
 * - sceneTags + exifData: analyze pre-extracted data (for preview before commit)
 */
export async function analyzeEventFromImages(
  imageIds: string[]
): Promise<EventAnalysisResult> {
  const supabase = createServiceClient();

  const { data: images, error } = await supabase
    .from("images")
    .select(
      "id, scene_tags, taken_at, camera_make, camera_model, gps_lat, gps_lng, original_filename"
    )
    .in("id", imageIds)
    .order("taken_at", { ascending: true, nullsFirst: false });

  if (error) throw error;
  if (!images || images.length === 0) {
    throw new Error("No images found for analysis");
  }

  const typedImages: ImageRow[] = images as ImageRow[];

  // Build EXIF summary
  const exifSummary = buildExifSummary(typedImages);

  // Build scene distribution
  const sceneDistribution = buildSceneDistribution(typedImages);

  // Detect event type
  const { type: detectedEventType, confidence: typeConfidence } =
    detectEventType(sceneDistribution, typedImages.length);

  // Detect time gaps for potential splitting
  const timeGaps = detectTimeGaps(typedImages);

  // Generate suggested name
  const suggestedName = generateEventName(
    detectedEventType,
    exifSummary.earliestDate
  );

  // Build suggested events (splitting if needed)
  const shouldSplit = timeGaps.some((g) => g.gapMinutes >= 120);
  const suggestedEvents = shouldSplit
    ? buildSuggestedEvents(typedImages, timeGaps, detectedEventType)
    : [
        {
          name: suggestedName,
          eventDate: exifSummary.earliestDate,
          eventType: detectedEventType,
          imageIds: typedImages.map((i: ImageRow) => i.id),
          confidence: typeConfidence,
          sceneSummary: sceneDistribution,
        },
      ];

  return {
    detectedEventType,
    typeConfidence,
    suggestedName,
    exifSummary,
    sceneDistribution,
    timeGaps,
    suggestedEvents,
    shouldSplit,
  };
}

/**
 * Lightweight analysis using only scene tags from a sample of images.
 * Used during the upload flow before full processing is complete.
 */
export function analyzeSceneTagsForEventType(
  sceneTags: string[][]
): { type: string; confidence: number } {
  const distribution: Record<string, number> = {};
  const totalImages = sceneTags.length;

  for (const tags of sceneTags) {
    for (const tag of tags) {
      distribution[tag] = (distribution[tag] || 0) + 1;
    }
  }

  return detectEventType(distribution, totalImages);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ImageRow {
  id: string;
  scene_tags: string[] | null;
  taken_at: string | null;
  camera_make: string | null;
  camera_model: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  original_filename: string;
}

function buildExifSummary(images: ImageRow[]): ExifSummary {
  const timestamps = images
    .map((i) => i.taken_at)
    .filter((t): t is string => t !== null)
    .sort();

  const cameras = new Map<string, number>();
  let gpsCount = 0;
  let latSum = 0;
  let lngSum = 0;

  for (const img of images) {
    if (img.camera_make || img.camera_model) {
      const cam = [img.camera_make, img.camera_model]
        .filter(Boolean)
        .join(" ");
      cameras.set(cam, (cameras.get(cam) || 0) + 1);
    }
    if (img.gps_lat !== null && img.gps_lng !== null) {
      gpsCount++;
      latSum += img.gps_lat;
      lngSum += img.gps_lng;
    }
  }

  const dominantCamera =
    cameras.size > 0
      ? [...cameras.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : null;

  const earliestDate = timestamps.length > 0 ? timestamps[0] : null;
  const latestDate =
    timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;

  let dateRange: string | null = null;
  if (earliestDate && latestDate) {
    const diffMs =
      new Date(latestDate).getTime() - new Date(earliestDate).getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours < 24) {
      dateRange = `${Math.round(diffHours)} hours`;
    } else {
      dateRange = `${Math.round(diffHours / 24)} days`;
    }
  }

  return {
    earliestDate,
    latestDate,
    dateRange,
    cameras: [...cameras.keys()],
    dominantCamera,
    hasGps: gpsCount > 0,
    averageLat: gpsCount > 0 ? latSum / gpsCount : null,
    averageLng: gpsCount > 0 ? lngSum / gpsCount : null,
    imageCount: images.length,
  };
}

function buildSceneDistribution(
  images: ImageRow[]
): Record<string, number> {
  const distribution: Record<string, number> = {};

  for (const img of images) {
    if (!img.scene_tags) continue;
    for (const tag of img.scene_tags) {
      distribution[tag] = (distribution[tag] || 0) + 1;
    }
  }

  return distribution;
}

function detectEventType(
  sceneDistribution: Record<string, number>,
  totalImages: number
): { type: string; confidence: number } {
  const scores: { type: string; score: number }[] = [];

  for (const rule of EVENT_TYPE_RULES) {
    let matchCount = 0;
    let weightedTotal = 0;

    for (const tag of rule.tags) {
      const count = sceneDistribution[tag] || 0;
      if (count > 0) {
        matchCount++;
        weightedTotal += count * rule.weight;
      }
    }

    if (matchCount >= rule.minTagCount) {
      // Normalize by total images to get a proportion-based score
      const coverage = weightedTotal / totalImages;
      scores.push({ type: rule.type, score: coverage });
    }
  }

  if (scores.length === 0) {
    return { type: "general", confidence: 0.3 };
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];

  // Confidence based on how dominant the top type is
  const secondBest = scores[1]?.score || 0;
  const confidence = Math.min(
    1.0,
    best.score / Math.max(0.01, best.score + secondBest)
  );

  return { type: best.type, confidence };
}

/**
 * Detect significant time gaps in image timestamps.
 * Gaps over 2 hours suggest separate events/sessions.
 */
function detectTimeGaps(images: ImageRow[]): TimeGap[] {
  const withTimestamps = images.filter(
    (i): i is ImageRow & { taken_at: string } => i.taken_at !== null
  );

  if (withTimestamps.length < 2) return [];

  const sorted = [...withTimestamps].sort(
    (a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime()
  );

  const gaps: TimeGap[] = [];
  const MIN_GAP_MINUTES = 30; // Report gaps >= 30 min

  for (let i = 1; i < sorted.length; i++) {
    const prevTime = new Date(sorted[i - 1].taken_at).getTime();
    const currTime = new Date(sorted[i].taken_at).getTime();
    const gapMinutes = (currTime - prevTime) / (1000 * 60);

    if (gapMinutes >= MIN_GAP_MINUTES) {
      gaps.push({
        beforeTimestamp: sorted[i - 1].taken_at,
        afterTimestamp: sorted[i].taken_at,
        gapMinutes: Math.round(gapMinutes),
        splitIndex: i,
        imageCountBefore: i,
        imageCountAfter: sorted.length - i,
      });
    }
  }

  return gaps;
}

/**
 * Generate a suggested event name from detected type and date.
 */
function generateEventName(
  eventType: string,
  date: string | null
): string {
  const typeLabels: Record<string, string> = {
    wedding: "Wedding",
    headshot: "Headshot Session",
    corporate: "Corporate Event",
    portrait: "Portrait Session",
    event: "Event",
    general: "Photo Session",
  };

  const label = typeLabels[eventType] || "Photo Session";

  if (date) {
    const d = new Date(date);
    const month = d.toLocaleString("en-US", { month: "long" });
    const day = d.getDate();
    const year = d.getFullYear();
    return `${label} — ${month} ${day}, ${year}`;
  }

  return label;
}

/**
 * Build suggested events by splitting images at major time gaps.
 * Only splits at gaps >= 2 hours.
 */
function buildSuggestedEvents(
  images: ImageRow[],
  timeGaps: TimeGap[],
  fallbackType: string
): SuggestedEvent[] {
  const significantGaps = timeGaps.filter((g) => g.gapMinutes >= 120);
  if (significantGaps.length === 0) {
    return [
      {
        name: generateEventName(fallbackType, images[0]?.taken_at || null),
        eventDate: images[0]?.taken_at || null,
        eventType: fallbackType,
        imageIds: images.map((i) => i.id),
        confidence: 0.5,
        sceneSummary: buildSceneDistribution(images),
      },
    ];
  }

  // Sort images by timestamp (nulls at end)
  const sorted = [...images].sort((a, b) => {
    if (!a.taken_at && !b.taken_at) return 0;
    if (!a.taken_at) return 1;
    if (!b.taken_at) return -1;
    return new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime();
  });

  // Split into groups at each significant gap
  const splitIndices = significantGaps.map((g) => g.splitIndex);
  const groups: ImageRow[][] = [];
  let start = 0;

  for (const splitIdx of splitIndices) {
    groups.push(sorted.slice(start, splitIdx));
    start = splitIdx;
  }
  groups.push(sorted.slice(start)); // Last group

  return groups
    .filter((g) => g.length > 0)
    .map((group, idx) => {
      const sceneDist = buildSceneDistribution(group);
      const { type, confidence } = detectEventType(sceneDist, group.length);
      const date = group[0]?.taken_at || null;
      const name = generateEventName(type, date);

      return {
        name: groups.length > 1 ? `${name} (Part ${idx + 1})` : name,
        eventDate: date,
        eventType: type,
        imageIds: group.map((i) => i.id),
        confidence,
        sceneSummary: sceneDist,
      };
    });
}

/**
 * Analyze an event that already exists and has processed images.
 * Updates the event with detected type and suggested configuration.
 */
export async function analyzeExistingEvent(eventId: string): Promise<EventAnalysisResult> {
  const supabase = createServiceClient();

  const { data: images, error } = await supabase
    .from("images")
    .select("id")
    .eq("event_id", eventId)
    .eq("processing_status", "complete");

  if (error) throw error;
  if (!images || images.length === 0) {
    throw new Error("No processed images found for event");
  }

  return analyzeEventFromImages(images.map((i: { id: string }) => i.id));
}
