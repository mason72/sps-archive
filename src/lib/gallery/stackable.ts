import { buildStacks } from "./stacks";
import { isPersonLike } from "@/lib/sections/auto-plan";

/**
 * Should Smart Stacks be ON for this set?
 *
 * Stacking is only ever right for repeat-shot-per-person work (headshot days).
 * Photo booth and event coverage name files after the camera, so stacking them
 * is noise — and the naive test ("what share of images land in a group of 2+?")
 * is actively dangerous, because a WEDDING scores 100% on it: every filename
 * shares one or two prefixes, so 1,020 photos collapse into two tiles. Measured
 * on the real archive, "Jessica & Koji's Big Day" (2 groups) and "Future of Us
 * Festival" (3 groups) both looked *more* stackable than the genuine headshot
 * jobs.
 *
 * So three things must hold at once:
 *  1. the names read like PEOPLE (delegated to the same person-likeness test
 *     auto-sections uses, so the two features can't disagree about a set),
 *  2. most images actually land in a multi-shot group,
 *  3. there are enough distinct people, each with a plausible number of shots —
 *     this is the clause that rejects the wedding.
 *
 * Grouping comes from buildStacks, the SAME function that renders the stacks,
 * so detection can never claim a set is stackable in a way the grid disagrees
 * with.
 */

/** Below this share of images inside multi-shot groups, stacking is noise. */
const MIN_STACKED_RATIO = 0.6;
/** Fewer distinct people than this and the "groups" aren't people. */
const MIN_PEOPLE = 5;
/** A person's shoot is tens of frames; hundreds means the group isn't a person. */
const MAX_SHOTS_PER_PERSON = 60;

export interface StackableSummary {
  stackable: boolean;
  /** Distinct groups holding 2+ images. */
  people: number;
  /** Share of images sitting in a multi-shot group, 0–1. */
  stackedRatio: number;
  /** Mean shots across the multi-shot groups. */
  shotsPerPerson: number;
}

export function detectStackable<
  T extends { parsedName: string | null; originalFilename: string }
>(images: T[]): StackableSummary {
  const empty: StackableSummary = {
    stackable: false,
    people: 0,
    stackedRatio: 0,
    shotsPerPerson: 0,
  };
  if (images.length === 0) return empty;

  const groups = buildStacks(images);
  const multi = groups.filter((g) => g.images.length > 1);
  if (multi.length === 0) return empty;

  const stackedImages = multi.reduce((a, g) => a + g.images.length, 0);
  const stackedRatio = stackedImages / images.length;
  const shotsPerPerson = stackedImages / multi.length;
  const personLike = multi.filter((g) => isPersonLike(g.personName)).length;
  const personLikeRatio = personLike / multi.length;

  return {
    stackable:
      personLikeRatio >= 0.6 &&
      stackedRatio >= MIN_STACKED_RATIO &&
      multi.length >= MIN_PEOPLE &&
      shotsPerPerson <= MAX_SHOTS_PER_PERSON,
    people: multi.length,
    stackedRatio: Math.round(stackedRatio * 100) / 100,
    shotsPerPerson: Math.round(shotsPerPerson * 10) / 10,
  };
}
