/**
 * Read a ZIP's file list (names, CRC-32s, sizes) from its URL without downloading it.
 *
 * Pixieset's download links are presigned S3 objects that honor HTTP Range, and a
 * ZIP keeps its whole table of contents (the "central directory") at the very end:
 * 78 KB for a 331 MB archive of 651 files, measured 2026-10-30. That is every byte
 * `planEntries` needs to say which photographs an archive holds.
 *
 * ZIP64 archives (over 4 GiB, or over 65,535 entries) are refused rather than read
 * wrongly; the caller lists them as unread and they get a whole download instead.
 */
import type { ZipEntry } from "./plan-entries";

export type RangeReader = (range: string) => Promise<{ status: number; total: number | null; body: Buffer }>;

const TAIL = 1 << 20;
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

export function httpRangeReader(url: string, timeoutMs = 60_000): RangeReader {
  return async (range) => {
    const res = await fetch(url, { headers: { Range: range }, signal: AbortSignal.timeout(timeoutMs) });
    const body = Buffer.from(await res.arrayBuffer());
    const m = res.headers.get("content-range")?.match(/\/(\d+)$/);
    return { status: res.status, total: m ? Number(m[1]) : null, body };
  };
}

/** The last EOCD record that accounts for the bytes after it (a comment may hold a lookalike). */
function findEocd(tail: Buffer): number {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD && i + 22 + tail.readUInt16LE(i + 20) === tail.length) return i;
  }
  throw new Error("no end-of-central-directory record in the tail");
}

export function parseCentralDirectory(cd: Buffer): ZipEntry[] {
  const out: ZipEntry[] = [];
  let p = 0;
  while (p < cd.length) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CENTRAL) throw new Error(`bad central directory record at ${p}`);
    const flags = cd.readUInt16LE(p + 8);
    const crc = cd.readUInt32LE(p + 16);
    const size = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    if (size === 0xffffffff) throw new Error("ZIP64 entry");
    const raw = cd.subarray(p + 46, p + 46 + nameLen);
    // Flag bit 11 means UTF-8. Without it the spec says CP437; a non-ASCII name then
    // decodes wrongly, reads as missing, and costs a re-download rather than a loss.
    const name = (flags & 0x800 ? raw.toString("utf8") : raw.toString("latin1")).normalize("NFC");
    if (!name.endsWith("/")) out.push({ entry: name, name, crc, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Every file in the archive at `read`, in at most two ranged requests. */
export async function readZipEntries(read: RangeReader): Promise<ZipEntry[]> {
  const first = await read(`bytes=-${TAIL}`);
  if (first.status !== 206) throw new Error(`expected 206, got ${first.status}`);
  const eocd = findEocd(first.body);
  const count = first.body.readUInt16LE(eocd + 10);
  const cdSize = first.body.readUInt32LE(eocd + 12);
  const cdOffset = first.body.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error("ZIP64 archive");

  let cd: Buffer;
  if (cdSize <= eocd) {
    cd = first.body.subarray(eocd - cdSize, eocd);
  } else {
    const second = await read(`bytes=${cdOffset}-${cdOffset + cdSize - 1}`);
    if (second.status !== 206 || second.body.length !== cdSize) throw new Error(`central directory read: ${second.status}, ${second.body.length} of ${cdSize} bytes`);
    cd = second.body;
  }
  const entries = parseCentralDirectory(cd);
  // Counted against the archive's own record: a directory read short must not read as "fewer photos".
  let records = 0;
  for (let p = 0; p < cd.length; records++) p += 46 + cd.readUInt16LE(p + 28) + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32);
  if (records !== count) throw new Error(`central directory holds ${records} records, the archive says ${count}`);
  return entries;
}
