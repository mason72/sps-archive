/**
 * Minimal JPEG dimension reader.
 *
 * Exists for one reason: proving a downloaded archive holds ORIGINALS and not
 * Pixieset's "Web Size" rendition. Nothing else in the pipeline can tell them
 * apart — a web-size ZIP passes CRC, carries the right filenames, and lands the
 * right file count. Only the pixel dimensions give it away.
 *
 * Deliberately dependency-free and header-only: we read the first few KB of each
 * sampled entry, not the whole image. `sharp` is in the tree but pulling a native
 * image decoder into a byte-mover to read two 16-bit integers is the wrong trade.
 */

/** Markers that carry frame dimensions. C4/C8/CC are tables, not frames. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Pull {width,height} from a JPEG header.
 *
 * Returns null rather than throwing on anything unparseable — a single odd file
 * must never abort a 1,371-collection run, and the caller treats null as
 * "no evidence" rather than as a failure.
 */
export function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null; // not SOI
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }          // resync past padding
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }           // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    if (SOF.has(marker)) {
      // segment: [len:2][precision:1][height:2][width:2]
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xda) return null;                 // start of scan — no frame header found
    i += 2 + len;
  }
  return null;
}

/** Long edge, orientation-independent. What the fidelity table in the migration doc reports. */
export function longEdge(size) {
  return size ? Math.max(size.width, size.height) : null;
}
