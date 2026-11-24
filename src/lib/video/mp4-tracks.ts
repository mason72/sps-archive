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

export function mp4HasAudio(buf: Uint8Array): boolean {
  return mp4TrackKinds(buf).includes("soun");
}
