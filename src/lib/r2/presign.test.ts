import { describe, it, expect } from "vitest";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createR2GetPresigner } from "./presign";
import { r2ClientConfig } from "./client";

// Fake account and credentials: signing is pure computation, so the SDK is a
// complete oracle with no network and no real secret anywhere in the test.
// The oracle is built with the APP's client settings, not a copy of them.
const config = {
  accountId: "0123456789abcdef0123456789abcdef",
  bucket: "test-bucket",
  accessKeyId: "AKIDEXAMPLE0000000000",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const sdk = new S3Client(r2ClientConfig(config));
const presignGet = createR2GetPresigner(config);

// The shapes real keys take, plus the characters most likely to be escaped
// differently: spaces and the "(AI) " render prefix, accents, the reserved
// set, RFC 3986's sub-delims that encodeURIComponent leaves alone, and a
// double slash.
const KEYS = [
  "events/evt1/thumbnails/thumb-md/IMG_0001.jpg",
  "events/evt1/originals/(AI) José Núñez_03.jpg",
  "events/e/originals/a b+c&d=e?f#g%h.jpg",
  "events/e/originals/it's!a*(test)~ok.JPG",
  "events/e/originals/日本語 ファイル.heic",
  "events/e//originals/double slash.png",
  "brand/logo.svg",
];
const DATES = [
  new Date(Date.UTC(2026, 10, 3, 0, 0, 0)),
  new Date(Date.UTC(2026, 0, 1, 7, 30, 0)),
];

describe("createR2GetPresigner", () => {
  it("matches getSignedUrl byte for byte for inline URLs", async () => {
    for (const key of KEYS) {
      for (const signingDate of DATES) {
        for (const expiresIn of [3600, 14400]) {
          const want = await getSignedUrl(
            sdk,
            new GetObjectCommand({ Bucket: config.bucket, Key: key }),
            { expiresIn, signingDate }
          );
          expect(await presignGet(key, { expiresIn, signingDate })).toBe(want);
        }
      }
    }
  });

  it("matches getSignedUrl byte for byte for attachment URLs", async () => {
    const signingDate = DATES[0];
    for (const disposition of [
      `attachment; filename="IMG_0001.jpg"; filename*=UTF-8''IMG_0001.jpg`,
      `attachment; filename="Jos_ N_ez.jpg"; filename*=UTF-8''${encodeURIComponent("José Núñez.jpg")}`,
      `attachment; filename="a (1) it's.jpg"; filename*=UTF-8''a%20(1)%20it's.jpg`,
    ]) {
      for (const key of KEYS) {
        const want = await getSignedUrl(
          sdk,
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: key,
            ResponseContentDisposition: disposition,
          }),
          { expiresIn: 3600, signingDate }
        );
        expect(
          await presignGet(key, {
            expiresIn: 3600,
            signingDate,
            contentDisposition: disposition,
          })
        ).toBe(want);
      }
    }
  });

  it("refuses a bucket the SDK would address path-style", async () => {
    // getSignedUrl switches to /bucket/key for these; this signer would not.
    for (const bucket of ["my.bucket", "Bad_Bucket", "ab", "", "xn--abc", "photos--x-s3", "photos--xa-s3"]) {
      const p = createR2GetPresigner({ ...config, bucket });
      await expect(
        p(KEYS[0], { expiresIn: 60, signingDate: DATES[0] })
      ).rejects.toThrow(/hostname label/);
    }
  });

  it("is deterministic within a signing window and changes across windows", async () => {
    const opts = { expiresIn: 14400, signingDate: DATES[0] };
    const a = await presignGet(KEYS[0], opts);
    expect(await presignGet(KEYS[0], opts)).toBe(a);
    expect(await presignGet(KEYS[0], { ...opts, signingDate: DATES[1] })).not.toBe(a);
  });
});
