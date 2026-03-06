#!/usr/bin/env node

/**
 * Configure CORS on the R2 bucket for direct browser uploads.
 *
 * This is a ONE-TIME setup script. Run it once per environment.
 *
 * Prerequisites:
 *   - R2 API token with "Admin Read & Write" permissions
 *     (the default "Object Read & Write" token does NOT have PutBucketCors access)
 *   - .env.local in project root with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 *     R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME
 *
 * Usage:
 *   node scripts/setup-r2-cors.mjs
 *
 * If this script fails with AccessDenied, configure CORS manually:
 *   1. Go to Cloudflare Dashboard → R2 → your bucket → Settings → CORS Policy
 *   2. Add a rule:
 *      - Allowed Origins: *
 *      - Allowed Methods: GET, PUT, HEAD
 *      - Allowed Headers: Content-Type
 *      - Max Age: 86400
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} from "@aws-sdk/client-s3";

// ─── Load .env.local ───
function loadEnv() {
  const envPath = resolve(process.cwd(), ".env.local");
  let content;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch {
    console.error("ERROR: .env.local not found. Run from project root.\n");
    process.exit(1);
  }

  const vars = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

const env = loadEnv();
const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
const missing = required.filter((k) => !env[k]);
if (missing.length > 0) {
  console.error(`ERROR: Missing env vars in .env.local: ${missing.join(", ")}\n`);
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = env.R2_BUCKET_NAME;

const CORS_RULES = [
  {
    AllowedOrigins: ["*"],
    AllowedMethods: ["GET", "PUT", "HEAD"],
    AllowedHeaders: ["Content-Type"],
    MaxAgeSeconds: 86400,
  },
];

async function main() {
  console.log(`\nConfiguring CORS on R2 bucket: ${BUCKET}\n`);

  // 1. Check current CORS config
  try {
    const current = await client.send(
      new GetBucketCorsCommand({ Bucket: BUCKET })
    );
    if (current.CORSRules?.length) {
      console.log("Current CORS rules:");
      console.log(JSON.stringify(current.CORSRules, null, 2));
      console.log();
    }
  } catch (err) {
    if (err.name === "AccessDenied" || err.Code === "AccessDenied") {
      console.error(
        "ERROR: AccessDenied reading CORS config.\n\n" +
        "Your R2 API token needs 'Admin Read & Write' permissions.\n" +
        "The default 'Object Read & Write' token cannot manage bucket settings.\n\n" +
        "MANUAL SETUP:\n" +
        "  1. Go to Cloudflare Dashboard → R2 → Buckets → " + BUCKET + " → Settings\n" +
        "  2. Scroll to 'CORS Policy' and click 'Add CORS policy'\n" +
        "  3. Configure:\n" +
        "     Allowed Origins: *\n" +
        "     Allowed Methods: GET, PUT, HEAD\n" +
        "     Allowed Headers: Content-Type\n" +
        "     Max Age Seconds: 86400\n" +
        "  4. Save\n"
      );
      process.exit(1);
    }
    // NoSuchCORSConfiguration is fine — we'll set it
    if (err.name !== "NoSuchCORSConfiguration" && err.Code !== "NoSuchCORSConfiguration") {
      throw err;
    }
    console.log("No existing CORS config found. Setting up...\n");
  }

  // 2. Apply CORS rules
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: BUCKET,
        CORSConfiguration: { CORSRules: CORS_RULES },
      })
    );
    console.log("CORS configured successfully!\n");
    console.log("Rules applied:");
    console.log(JSON.stringify(CORS_RULES, null, 2));
    console.log("\nDirect browser uploads to R2 are now enabled.\n");
  } catch (err) {
    if (err.name === "AccessDenied" || err.Code === "AccessDenied") {
      console.error(
        "ERROR: AccessDenied setting CORS config.\n\n" +
        "Your R2 API token needs 'Admin Read & Write' permissions.\n\n" +
        "MANUAL SETUP:\n" +
        "  1. Go to Cloudflare Dashboard → R2 → Buckets → " + BUCKET + " → Settings\n" +
        "  2. Scroll to 'CORS Policy' and click 'Add CORS policy'\n" +
        "  3. Configure:\n" +
        "     Allowed Origins: *\n" +
        "     Allowed Methods: GET, PUT, HEAD\n" +
        "     Allowed Headers: Content-Type\n" +
        "     Max Age Seconds: 86400\n" +
        "  4. Save\n"
      );
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
