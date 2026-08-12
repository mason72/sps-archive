/**
 * Tests for the JPEG header reader.
 *
 *   node --test scripts/pixieset/lib/jpeg.test.mjs
 *
 * This parser is the only thing standing between the archive and a silent
 * fidelity loss — a Web Size rendition is identical to the originals in name,
 * file count and CRC. So the cases that matter are the awkward ones: markers it
 * must skip past, and garbage it must decline to guess about.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { jpegSize, longEdge } from "./jpeg.mjs";

/** A JPEG carrying a real SOF0 frame header of the given dimensions. */
function jpegWithSize(width, height, { marker = 0xc0, before = [] } = {}) {
  return Buffer.from([
    0xff, 0xd8,
    ...before,
    0xff, marker, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

/** An APPn segment — the real-world thing that sits between SOI and the frame. */
const app1 = (bytes = 40) => [0xff, 0xe1, ((bytes + 2) >> 8) & 0xff, (bytes + 2) & 0xff, ...new Array(bytes).fill(0)];

test("reads width and height from a baseline SOF0", () => {
  assert.deepEqual(jpegSize(jpegWithSize(4800, 3250)), { width: 4800, height: 3250 });
});

test("skips APPn segments to find the frame header", () => {
  // Every camera JPEG has EXIF ahead of the frame; a parser that only looks at a
  // fixed offset reads garbage and reports a plausible-but-wrong size.
  assert.deepEqual(jpegSize(jpegWithSize(2048, 3072, { before: app1(120) })), { width: 2048, height: 3072 });
});

test("handles progressive JPEGs (SOF2), not just baseline", () => {
  assert.deepEqual(jpegSize(jpegWithSize(3840, 2160, { marker: 0xc2 })), { width: 3840, height: 2160 });
});

test("returns null rather than guessing on non-JPEG or truncated input", () => {
  // A single odd file must never abort a 1,371-collection run — null means
  // "no evidence", which the caller treats differently from "small image".
  assert.equal(jpegSize(Buffer.from([0x50, 0x4b, 0x03, 0x04])), null, "a ZIP is not a JPEG");
  assert.equal(jpegSize(Buffer.from([0xff, 0xd8])), null, "SOI alone carries no dimensions");
  assert.equal(jpegSize(Buffer.alloc(0)), null);
});

test("does not mistake a quantisation table for a frame header", () => {
  // 0xC4 (DHT) sits in the same 0xC0-0xCF block as the SOF markers but carries no
  // dimensions. Reading it as a frame yields nonsense that looks like a real size.
  const dht = [0xff, 0xc4, 0x00, 0x14, ...new Array(18).fill(0)];
  assert.deepEqual(jpegSize(jpegWithSize(5760, 3840, { before: dht })), { width: 5760, height: 3840 });
});

test("longEdge is orientation-independent", () => {
  assert.equal(longEdge({ width: 4800, height: 3250 }), 4800);
  assert.equal(longEdge({ width: 3301, height: 4800 }), 4800, "portrait frames must not read as smaller");
  assert.equal(longEdge(null), null);
});
