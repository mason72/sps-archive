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
import zlib from "node:zlib";
import type { ZipEntry } from "./plan-entries";

export type RangeReader = (range: string) => Promise<{ status: number; total: number | null; body: Buffer }>;

/** A file-list entry plus where its bytes sit in the archive, for `readEntryBytes`. */
export type CentralEntry = ZipEntry & { offset: number; csize: number; method: number };

const TAIL = 1 << 20;
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

export function httpRangeReader(url: string, timeoutMs = 60_000): RangeReader {
  return async (range) => {
    const res = await fetch(url, { headers: { Range: range }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status !== 206) {
      // A 200 is the WHOLE archive, gigabytes of it. Read none of it; the caller
      // refuses anything but 206, and says what the server claimed to support.
      await res.body?.cancel();
      const ranges = res.headers.get("accept-ranges") ?? "none";
      const length = res.headers.get("content-length") ?? "?";
      return { status: res.status, total: null, body: Buffer.from(`accept-ranges ${ranges}, length ${length}`) };
    }
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

export function parseCentralDirectory(cd: Buffer): CentralEntry[] {
  const out: CentralEntry[] = [];
  let p = 0;
  while (p < cd.length) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CENTRAL) throw new Error(`bad central directory record at ${p}`);
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const crc = cd.readUInt32LE(p + 16);
    const csize = cd.readUInt32LE(p + 20);
    const size = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const offset = cd.readUInt32LE(p + 42);
    if (size === 0xffffffff || csize === 0xffffffff || offset === 0xffffffff) throw new Error("ZIP64 entry");
    const raw = cd.subarray(p + 46, p + 46 + nameLen);
    // Flag bit 11 means UTF-8. Without it the spec says CP437; a non-ASCII name then
    // decodes wrongly, reads as missing, and costs a re-download rather than a loss.
    const name = (flags & 0x800 ? raw.toString("utf8") : raw.toString("latin1")).normalize("NFC");
    if (!name.endsWith("/")) out.push({ entry: name, name, crc, size, offset, csize, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Every file in the archive at `read`, in at most two ranged requests. */
export async function readZipEntries(read: RangeReader): Promise<CentralEntry[]> {
  const first = await read(`bytes=-${TAIL}`);
  if (first.status !== 206) throw new Error(`expected 206, got ${first.status} (${first.body.toString().slice(0, 80)})`);
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

const LOCAL = 0x04034b50;
/** Room for the local header's own name and extra field, read in the same request. */
const LOCAL_SLACK = 4096;

/**
 * One entry's bytes, by Range. Whole, its CRC-32 is checked against the file list,
 * so a short or wrong read throws rather than hashing the wrong thing. With
 * `prefix`, only the first that-many bytes (enough for EXIF), unchecked.
 */
export async function readEntryBytes(read: RangeReader, e: CentralEntry, prefix?: number): Promise<Buffer> {
  if (e.method !== 0 && e.method !== 8) throw new Error(`${e.name}: compression method ${e.method}`);
  const want = prefix && e.method === 0 ? Math.min(prefix, e.csize) : e.csize;
  const fetchHeader = async (extra: number) => {
    const r = await read(`bytes=${e.offset}-${e.offset + 30 + extra + want - 1}`);
    if (r.status !== 206) throw new Error(`entry read: ${r.status}`);
    return r.body;
  };
  let buf = await fetchHeader(LOCAL_SLACK);
  if (buf.length < 30 || buf.readUInt32LE(0) !== LOCAL) throw new Error(`${e.name}: no local header at ${e.offset}`);
  const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  if (start > 30 + LOCAL_SLACK) buf = await fetchHeader(start - 30);
  const raw = buf.subarray(start, start + want);
  if (raw.length !== want) throw new Error(`${e.name}: read ${raw.length} of ${want} bytes`);
  if (prefix && e.method === 0) return raw;
  const bytes = e.method === 0 ? raw : zlib.inflateRawSync(raw);
  if (bytes.length !== e.size || zlib.crc32(bytes) >>> 0 !== e.crc >>> 0) throw new Error(`${e.name}: bytes do not match the file list`);
  return prefix ? bytes.subarray(0, prefix) : bytes;
}
