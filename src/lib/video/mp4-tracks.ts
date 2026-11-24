/**
 * Which kinds of track an MP4/QuickTime file holds, read from its own boxes.
 *
 * Every track is a `trak` box inside `moov`, and its `mdia/hdlr` box names its
 * kind: `vide` for video, `soun` for audio (also `text`, `sbtl`, `meta`...).
 * This reads ONLY that, with no ffmpeg and no dependency, so the server can
 * check a file Modal wrote without trusting Modal's own report of it: the
 * Scout integration refuses to file a clip whose stored bytes still carry a
 * `soun` track, whatever the pipeline said (a guard must not share the
 * assumption it guards).
 *
 * Throws on a file it cannot walk (no `moov`, a box that runs past the end),
 * because "could not read it" must never read as "no audio".
 */

export class Mp4ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Mp4ParseError";
  }
}

interface Box {
  type: string;
  /** Offset of the payload (after the header). */
  start: number;
  /** Offset one past the box's last byte. */
  end: number;
}

function* boxes(buf: Uint8Array, from: number, to: number): Generator<Box> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let at = from;
  while (at + 8 <= to) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(buf[at + 4], buf[at + 5], buf[at + 6], buf[at + 7]);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) throw new Mp4ParseError(`truncated 64-bit size for "${type}"`);
      const big = view.getBigUint64(at + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Mp4ParseError(`"${type}" is too large`);
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      size = to - at; // runs to the end of its parent
    }
    if (size < header) throw new Mp4ParseError(`"${type}" has an impossible size ${size}`);
    const end = at + size;
    if (end > to) throw new Mp4ParseError(`"${type}" runs past the end of its parent`);
    yield { type, start: at + header, end };
    at = end;
  }
}

function child(buf: Uint8Array, parent: Box, type: string): Box | null {
  for (const b of boxes(buf, parent.start, parent.end)) if (b.type === type) return b;
  return null;
}

/** The ONE `type` box in `parent`; a second one is recorded as a problem. */
function onlyChild(buf: Uint8Array, parent: Box, type: string, problems: string[]): Box | null {
  const found = [...boxes(buf, parent.start, parent.end)].filter((b) => b.type === type);
  if (found.length > 1) problems.push(`${found.length} ${type} boxes where one is allowed`);
  return found[0] ?? null;
}

/** True when the file opens with an `ftyp` box (MP4 / QuickTime family). */
export function isMp4Container(buf: Uint8Array): boolean {
  return (
    buf.length >= 12 &&
    buf[4] === 0x66 && // f
    buf[5] === 0x74 && // t
    buf[6] === 0x79 && // y
    buf[7] === 0x70 // p
  );
}

/** The handler type of every track, in file order (e.g. ["vide", "soun"]). */
export function mp4TrackKinds(buf: Uint8Array): string[] {
  let moov: Box | null = null;
  for (const b of boxes(buf, 0, buf.length)) {
    if (b.type === "moov") {
      moov = b;
      break;
    }
  }
  if (!moov) throw new Mp4ParseError("no moov box: not a complete MP4");

  const kinds: string[] = [];
  for (const b of boxes(buf, moov.start, moov.end)) {
    if (b.type !== "trak") continue;
    const mdia = child(buf, b, "mdia");
    const hdlr = mdia ? child(buf, mdia, "hdlr") : null;
    // hdlr payload: version+flags (4), pre_defined (4), handler_type (4).
    if (!hdlr || hdlr.start + 12 > hdlr.end) throw new Mp4ParseError("a track has no readable hdlr box");
    kinds.push(String.fromCharCode(...buf.subarray(hdlr.start + 8, hdlr.start + 12)));
  }
  return kinds;
}

function findMoov(buf: Uint8Array): Box {
  for (const b of boxes(buf, 0, buf.length)) if (b.type === "moov") return b;
  throw new Mp4ParseError("no moov box: not a complete MP4");
}

/**
 * The movie's length in seconds, from `moov/mvhd` (timescale and duration;
 * version 0 is 32-bit, version 1 is 64-bit). Read from the STORED file, so the
 * length the row carries and the cap it is held to describe the bytes that
 * will play, not an earlier read of somebody else's URL.
 */
export function mp4DurationSeconds(buf: Uint8Array): number {
  const mvhd = child(buf, findMoov(buf), "mvhd");
  if (!mvhd) throw new Mp4ParseError("no mvhd box");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = buf[mvhd.start];
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (mvhd.start + 32 > mvhd.end) throw new Mp4ParseError("mvhd is truncated");
    timescale = view.getUint32(mvhd.start + 20);
    duration = Number(view.getBigUint64(mvhd.start + 24));
  } else {
    if (mvhd.start + 20 > mvhd.end) throw new Mp4ParseError("mvhd is truncated");
    timescale = view.getUint32(mvhd.start + 12);
    duration = view.getUint32(mvhd.start + 16);
  }
  if (!timescale) throw new Mp4ParseError("mvhd has no timescale");
  return duration / timescale;
}

/**
 * The sample format of every VIDEO track (`stsd`'s first entry): `avc1` or
 * `avc3` is H.264, `hvc1`/`hev1` is HEVC. Read from the stored file.
 */
export function mp4VideoCodecs(buf: Uint8Array): string[] {
  const out: string[] = [];
  for (const trak of boxes(buf, findMoov(buf).start, findMoov(buf).end)) {
    if (trak.type !== "trak") continue;
    const mdia = child(buf, trak, "mdia");
    const hdlr = mdia ? child(buf, mdia, "hdlr") : null;
    if (!mdia || !hdlr || hdlr.start + 12 > hdlr.end) throw new Mp4ParseError("a track has no readable hdlr box");
    if (String.fromCharCode(...buf.subarray(hdlr.start + 8, hdlr.start + 12)) !== "vide") continue;
    const minf = child(buf, mdia, "minf");
    const stbl = minf ? child(buf, minf, "stbl") : null;
    const stsd = stbl ? child(buf, stbl, "stsd") : null;
    // stsd payload: version+flags (4), entry_count (4), then sample entries.
    if (!stsd || stsd.start + 16 > stsd.end) throw new Mp4ParseError("a video track has no readable stsd box");
    const first = boxes(buf, stsd.start + 8, stsd.end).next();
    if (first.done) throw new Mp4ParseError("a video track has no sample entry");
    out.push(first.value.type);
  }
  return out;
}

/**
 * The ALLOW-LIST a stored Scout clip must meet, judged on structure alone.
 * Empty = acceptable. Anything not explicitly allowed is refused, rather than
 * hunting for known audio formats (a block-list misses the next codec name):
 *   - exactly one `moov`, and no `moof` / `mvex` (not fragmented: tracks and
 *     samples could otherwise arrive after the header read here);
 *   - exactly ONE track, of handler `vide`;
 *   - that track has an `stsd` with at least one sample entry, and EVERY entry
 *     is H.264 (`avc1` / `avc3`).
 * A second track of any kind, an audio track relabelled `vide` (its entry is
 * `mp4a`), or an unknown entry (`apac`, `enca`, ...) is refused. Throws on a
 * file it cannot walk; the caller treats a throw as a refusal (fail closed).
 */
export function mp4SilentH264Problems(buf: Uint8Array): string[] {
  const problems: string[] = [];
  let moovs = 0;
  for (const b of boxes(buf, 0, buf.length)) {
    if (b.type === "moov") moovs++;
    if (b.type === "moof") problems.push("fragmented (moof)");
  }
  if (moovs === 0) throw new Mp4ParseError("no moov box: not a complete MP4");
  if (moovs > 1) problems.push(`${moovs} moov boxes`);

  const moov = findMoov(buf);
  const traks: Box[] = [];
  for (const b of boxes(buf, moov.start, moov.end)) {
    if (b.type === "mvex") problems.push("fragmented (mvex)");
    if (b.type === "trak") traks.push(b);
  }
  if (traks.length !== 1) problems.push(`${traks.length} tracks (exactly one video track allowed)`);

  for (const trak of traks) {
    // Exactly one of each box along the chain that is checked: a second
    // mdia/hdlr/minf/stbl/stsd could hold what this walk does not look at.
    const mdia = onlyChild(buf, trak, "mdia", problems);
    const hdlr = mdia ? onlyChild(buf, mdia, "hdlr", problems) : null;
    if (!mdia || !hdlr || hdlr.start + 12 > hdlr.end) throw new Mp4ParseError("a track has no readable hdlr box");
    const handler = String.fromCharCode(...buf.subarray(hdlr.start + 8, hdlr.start + 12));
    if (handler !== "vide") problems.push(`a ${handler} track`);
    const minf = onlyChild(buf, mdia, "minf", problems);
    const stbl = minf ? onlyChild(buf, minf, "stbl", problems) : null;
    const stsd = stbl ? onlyChild(buf, stbl, "stsd", problems) : null;
    if (!stsd || stsd.start + 8 > stsd.end) {
      problems.push(`a ${handler} track with no sample description`);
      continue;
    }
    const entries = [...boxes(buf, stsd.start + 8, stsd.end)].map((e) => e.type);
    if (!entries.length) problems.push(`a ${handler} track with no sample entry`);
    for (const t of entries) {
      if (!H264_SAMPLE_ENTRIES.has(t)) problems.push(`sample entry ${JSON.stringify(t)} in a ${handler} track`);
    }
  }
  return [...new Set(problems)];
}

/** H.264 sample entries. */
export const H264_SAMPLE_ENTRIES: ReadonlySet<string> = new Set(["avc1", "avc3"]);

/** Video codecs that are not H.264: a clip in one of these is Scout's to re-export (415). */
export const OTHER_VIDEO_SAMPLE_ENTRIES: ReadonlySet<string> = new Set([
  "hvc1", "hev1", "dvh1", "dvhe", "av01", "vp08", "vp09", "mp4v", "s263", "mjp2", "jpeg",
  "apch", "apcn", "apcs", "apco", "ap4h",
]);

/** Every sample entry of every `vide` track (all entries, not just the first). */
export function mp4VideoSampleEntries(buf: Uint8Array): string[] {
  const out: string[] = [];
  const moov = findMoov(buf);
  for (const trak of boxes(buf, moov.start, moov.end)) {
    if (trak.type !== "trak") continue;
    const mdia = child(buf, trak, "mdia");
    const hdlr = mdia ? child(buf, mdia, "hdlr") : null;
    if (!mdia || !hdlr || hdlr.start + 12 > hdlr.end) throw new Mp4ParseError("a track has no readable hdlr box");
    if (String.fromCharCode(...buf.subarray(hdlr.start + 8, hdlr.start + 12)) !== "vide") continue;
    const minf = child(buf, mdia, "minf");
    const stbl = minf ? child(buf, minf, "stbl") : null;
    const stsd = stbl ? child(buf, stbl, "stsd") : null;
    if (!stsd) continue;
    for (const e of boxes(buf, stsd.start + 8, stsd.end)) out.push(e.type);
  }
  return out;
}

export function mp4HasAudio(buf: Uint8Array): boolean {
  return mp4TrackKinds(buf).includes("soun");
}
