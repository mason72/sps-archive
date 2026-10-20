/**
 * Probe (2026-10-20): does the R2 client's timeout actually abort a request to
 * a server that accepts the connection and never answers?
 *
 *   npx tsx scripts/triage/r2-timeout-mode-probe.ts
 *
 * Runs the same HEAD against a local black-hole server under two handler
 * configs, each with a 2 s timeout and an 8 s outer deadline:
 *   requestTimeout (what client.ts had): on @smithy/node-http-handler 4.9.x
 *     this is a TOTAL timer that only logs a WARN unless throwOnRequestTimeout
 *   socketTimeout: the idle timer, which destroys the socket and rejects
 * Expected after the fix: first one HANGS to the outer deadline, second aborts
 * at ~2 s. No credentials leave the machine; the key pair is fake.
 */
import net from "node:net";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

async function attempt(port: number, handler: Record<string, number>): Promise<string> {
  const client = new S3Client({
    region: "auto",
    endpoint: `http://127.0.0.1:${port}`,
    forcePathStyle: true,
    credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
    maxAttempts: 1,
    requestHandler: handler,
  });
  const started = Date.now();
  const outcome = await Promise.race([
    client
      .send(new HeadObjectCommand({ Bucket: "b", Key: "k" }))
      .then(() => "answered")
      .catch((e: Error) => `threw ${e.name}`),
    new Promise<string>((r) => setTimeout(() => r("HUNG past the 8 s deadline"), 8000)),
  ]);
  client.destroy();
  return `${outcome} after ${((Date.now() - started) / 1000).toFixed(1)} s`;
}

async function main() {
  const sockets: net.Socket[] = [];
  const server = net.createServer((s) => sockets.push(s)); // accept, never answer
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;

  console.log("requestTimeout 2000:", await attempt(port, { connectionTimeout: 1000, requestTimeout: 2000 }));
  console.log("socketTimeout  2000:", await attempt(port, { connectionTimeout: 1000, socketTimeout: 2000 }));

  for (const s of sockets) s.destroy();
  server.close();
}

main();
