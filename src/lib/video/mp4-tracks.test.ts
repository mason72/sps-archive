import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isMp4Container,
  mp4DurationSeconds,
  mp4HasAudio,
  mp4SilentH264Problems,
  mp4TrackKinds,
  mp4VideoCodecs,
  Mp4ParseError,
} from "./mp4-tracks";

// Real files, made by modal/tests/test_video_mute.py with ffmpeg: a 3 s H.264
// clip with an AAC tone, and the pipeline's muted rendition of it.
const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "__fixtures__", name)));
const withAudio = fixture("tone-with-audio.mp4");
const muted = fixture("tone-muted.mp4");

describe("mp4TrackKinds", () => {
  it("finds the audio track in a clip that has one", () => {
    expect(mp4TrackKinds(withAudio).sort()).toEqual(["soun", "vide"]);
    expect(mp4HasAudio(withAudio)).toBe(true);
  });

  it("finds only video in the muted rendition", () => {
    expect(mp4TrackKinds(muted)).toEqual(["vide"]);
    expect(mp4HasAudio(muted)).toBe(false);
  });

  it("refuses to answer for a file it cannot walk, rather than saying 'no audio'", () => {
    expect(() => mp4TrackKinds(withAudio.subarray(0, 64))).toThrow(Mp4ParseError);
    expect(() => mp4TrackKinds(new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]))).toThrow(/no moov/);
    const lying = new Uint8Array(withAudio);
    new DataView(lying.buffer).setUint32(0, lying.length + 100); // ftyp claims more than the file
    expect(() => mp4TrackKinds(lying)).toThrow(/past the end/);
  });

  it("knows an MP4 by its ftyp box", () => {
    expect(isMp4Container(withAudio)).toBe(true);
    expect(isMp4Container(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });
});

describe("mp4DurationSeconds / mp4VideoCodecs (read from the stored file)", () => {
  it("reads the 3 s length and the H.264 sample entry of both fixtures", () => {
    for (const f of [withAudio, muted]) {
      expect(mp4DurationSeconds(f)).toBeGreaterThan(2.9);
      expect(mp4DurationSeconds(f)).toBeLessThan(3.2);
      expect(mp4VideoCodecs(f)).toEqual(["avc1"]);
    }
  });

  it("throws on a file with no movie header rather than guessing a length", () => {
    expect(() => mp4DurationSeconds(withAudio.subarray(0, 64))).toThrow(Mp4ParseError);
  });
});

/** Indices of every `hdlr` box type in a file. */
function hdlrAt(buf: Uint8Array): number[] {
  const out: number[] = [];
  const b = Buffer.from(buf);
  for (let i = b.indexOf("hdlr"); i >= 0; i = b.indexOf("hdlr", i + 4)) out.push(i);
  return out;
}

describe("mp4SilentH264Problems (allow-list: one track, video, every entry H.264)", () => {
  const fragmented = fixture("tone-muted-fragmented.mp4");
  const twoVideo = fixture("tone-two-video-tracks.mp4");

  it("finds nothing in the muted copy", () => {
    expect(mp4SilentH264Problems(muted)).toEqual([]);
  });

  it("refuses the AAC clip (a second track, of handler soun, entry mp4a)", () => {
    const p = mp4SilentH264Problems(withAudio);
    expect(p).toContain("2 tracks (exactly one video track allowed)");
    expect(p).toContain("a soun track");
  });

  it("refuses an audio track relabelled vide", () => {
    const relabeled = new Uint8Array(withAudio);
    const b = Buffer.from(relabeled.buffer, relabeled.byteOffset, relabeled.byteLength);
    const soun = hdlrAt(relabeled).find((i) => b.toString("latin1", i + 12, i + 16) === "soun");
    expect(soun).toBeDefined();
    b.write("vide", soun! + 12, "latin1");
    expect(mp4TrackKinds(relabeled)).toEqual(["vide", "vide"]);
    const p = mp4SilentH264Problems(relabeled).join("; ");
    expect(p).toMatch(/2 tracks/);
    expect(p).toMatch(/sample entry "mp4a" in a vide track/);
  });

  it("refuses a second VIDEO track", () => {
    expect(mp4TrackKinds(twoVideo)).toEqual(["vide", "vide"]);
    expect(mp4SilentH264Problems(twoVideo)).toEqual(["2 tracks (exactly one video track allowed)"]);
  });

  it("refuses an unknown sample entry, rather than looking for known audio names", () => {
    for (const fourcc of ["apac", "enca", "hvc1"]) {
      const b = Buffer.from(muted);
      b.write(fourcc, b.indexOf("avc1", b.indexOf("stsd")), "latin1");
      expect(mp4SilentH264Problems(b).join()).toContain(`sample entry "${fourcc}"`);
    }
  });

  it("refuses a fragmented file, even a silent one", () => {
    expect(mp4TrackKinds(fragmented)).toEqual(["vide"]);
    const problems = mp4SilentH264Problems(fragmented);
    expect(problems).toContain("fragmented (moof)");
    expect(problems).toContain("fragmented (mvex)");
  });

  it("refuses a file with more than one moov", () => {
    const b = Buffer.from(muted);
    const at = b.indexOf("moov") - 4;
    const size = b.readUInt32BE(at);
    const twice = Buffer.concat([b, b.subarray(at, at + size)]);
    expect(mp4SilentH264Problems(twice)).toContain("2 moov boxes");
  });

  it("refuses a video track with no sample description", () => {
    const b = Buffer.from(muted);
    b.write("xxxx", b.indexOf("stsd"), "latin1"); // the box is still there, just not an stsd
    expect(mp4SilentH264Problems(b)).toContain("a vide track with no sample description");
  });

  it("fails closed on a file it cannot walk", () => {
    expect(() => mp4SilentH264Problems(muted.subarray(0, 64))).toThrow(Mp4ParseError);
  });
});
