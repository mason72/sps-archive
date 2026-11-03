import { createHash, createHmac, type Hash, type Hmac } from "node:crypto";
import { SignatureV4 } from "@smithy/signature-v4";

/**
 * Presigned GET URLs for R2, signed with the bare SigV4 signer.
 *
 * WHY NOT getSignedUrl: the SDK's presigner runs the whole S3 middleware stack
 * (endpoint resolution, bucket rules, serialization) for every URL. A gallery
 * payload signs two to four URLs per photo, and on Webex One (8,248 photos)
 * that was 16,500 to 33,000 signs per load: 1,767 ms per 16,000 on a laptop
 * and several times that on a Vercel function, the largest single cost of a
 * guest gallery after the database (2026-11-02, lesson 198). The bare signer
 * does the same SigV4 work without the stack: 216 ms per 16,000.
 *
 * The output is BYTE-IDENTICAL to getSignedUrl's for the same inputs, and
 * presign.test.ts holds it to that with the SDK as the oracle. That matters
 * beyond correctness: identical inputs give an identical URL, which is what
 * keeps the browser's image cache warm across reloads (see the quantized
 * signing window in client.ts).
 *
 * Shape it reproduces (virtual-hosted R2, as the SDK builds it):
 *   https://<bucket>.<account>.r2.cloudflarestorage.com/<escaped key>
 *   ?X-Amz-Algorithm…&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD…&x-id=GetObject
 * with `response-content-disposition` when a download filename is asked for.
 */

export interface R2PresignConfig {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface PresignGetOptions {
  expiresIn: number;
  signingDate: Date;
  /** Signed as `response-content-disposition`; omit for inline display. */
  contentDisposition?: string;
}

/** What the signer hands a hash: smithy's SourceData. */
type SourceData = string | ArrayBuffer | ArrayBufferView;

function toHashInput(data: SourceData): string | Uint8Array {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** The signer's hash interface over node:crypto (HMAC when given a secret). */
class NodeSha256 {
  private readonly h: Hash | Hmac;
  constructor(secret?: SourceData) {
    this.h = secret
      ? createHmac("sha256", toHashInput(secret))
      : createHash("sha256");
  }
  update(data: SourceData) {
    this.h.update(toHashInput(data));
  }
  async digest(): Promise<Uint8Array> {
    return new Uint8Array(this.h.digest());
  }
}

/** RFC 3986 escaping, as the SDK applies to keys and query values. */
function escapeUri(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** A key is a path: escape each segment, keep the slashes. */
function escapeKey(key: string): string {
  return key.split("/").map(escapeUri).join("/");
}

export function createR2GetPresigner(config: R2PresignConfig) {
  const host = `${config.bucket}.${config.accountId}.r2.cloudflarestorage.com`;
  const signer = new SignatureV4({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    region: "auto",
    service: "s3",
    sha256: NodeSha256,
    // S3 signs the path exactly as sent; the key is escaped once, above.
    uriEscapePath: false,
    applyChecksum: false,
  });

  // The SDK puts a bucket in the HOSTNAME only when the name can be one over
  // TLS (lowercase, digits, hyphens; no dots), and falls back to a path-style
  // URL otherwise. This signer only knows the first form, so any other name
  // must fail loudly here rather than sign a different URL than the SDK.
  // Checked on use, not at construction: client.ts builds this at import,
  // where tests have no R2 env at all.
  // Also refused: punycode labels (xn--), which the SDK rejects as an invalid
  // URL, and S3 Express names (--x-s3, --xa-s3), which it signs another way.
  const bucketIsHostLabel =
    /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket ?? "") &&
    !/^xn--|--xa?-s3$/.test(config.bucket);

  return async function presignGet(
    key: string,
    { expiresIn, signingDate, contentDisposition }: PresignGetOptions
  ): Promise<string> {
    if (!bucketIsHostLabel) {
      throw new Error(
        `R2 bucket name ${JSON.stringify(config.bucket)} cannot be a hostname label; presign.ts signs virtual-hosted URLs only`
      );
    }
    const query: Record<string, string> = { "x-id": "GetObject" };
    if (contentDisposition !== undefined) {
      query["response-content-disposition"] = contentDisposition;
    }
    const signed = await signer.presign(
      {
        method: "GET",
        protocol: "https:",
        hostname: host,
        path: `/${escapeKey(key)}`,
        query,
        // As the SDK's S3 presigner sends them. The signer reads the payload
        // marker as the payload hash, then hoists every x-amz-* header into
        // the query, so all three end up in the URL and only host is a
        // signed header. x-amz-checksum-mode is the SDK's default response
        // checksum validation ("when supported") on GetObject.
        headers: {
          host,
          "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
          "x-amz-checksum-mode": "ENABLED",
        },
      },
      { expiresIn, signingDate }
    );
    // The SDK serializes the query in sorted key order; so must we, or the
    // same photo gets a different (still valid) URL and misses the cache.
    const qs = Object.keys(signed.query ?? {})
      .sort()
      .map((k) => `${escapeUri(k)}=${escapeUri(String(signed.query![k]))}`)
      .join("&");
    return `https://${host}${signed.path}?${qs}`;
  };
}
