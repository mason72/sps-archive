import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMp4Container, mp4HasAudio, mp4TrackKinds, Mp4ParseError } from "./mp4-tracks";

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
