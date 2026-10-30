/**
 * npx tsx --test scripts/pixieset/zip-central.test.ts
 *
 * Real ZIPs (made by Python, read back by Python as the reference) over a real
 * local HTTP server that honors Range, so the reader meets the same bytes and the
 * same 206s it gets from S3.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { httpRangeReader, readZipEntries } from "./zip-central";

let tmp: string;
let server: http.Server;
let base: string;
let requests: string[] = [];

const makeZip = (name: string, count: number, fillName = "") => {
  const py = `
import zipfile, sys, json
out = sys.argv[1]; n = int(sys.argv[2]); pad = sys.argv[3]
with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
    z.writestr("Color/", b"")
    for i in range(n):
        z.writestr(f"Color/{pad}IMG_{i}.jpg", f"color {i}".encode())
        z.writestr(f"BW/{pad}IMG_{i}.jpg", f"bw photo {i}".encode())
    z.writestr("Color/Andreas Löcher.jpg", b"utf8 name")
print(json.dumps([[i.filename, i.CRC, i.file_size] for i in zipfile.ZipFile(out).infolist() if not i.filename.endswith("/")]))`;
  const p = path.join(tmp, name);
  const r = spawnSync("python3", ["-I", "-c", py, p, String(count), fillName], { encoding: "utf8", maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as [string, number, number][];
};

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zip-central-"));
  server = http.createServer((req, res) => {
    const file = path.join(tmp, path.basename(req.url!.split("?")[0]));
    if (req.url!.includes("norange")) { res.writeHead(200); res.end(fs.readFileSync(file)); return; }
    const all = fs.readFileSync(file);
    requests.push(String(req.headers.range));
    const range = String(req.headers.range);
    const suffix = range.match(/^bytes=-(\d+)$/);
    const span = range.match(/^bytes=(\d+)-(\d+)$/);
    const start = suffix ? Math.max(0, all.length - Number(suffix[1])) : Number(span![1]);
    const end = suffix ? all.length - 1 : Number(span![2]);
    res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${all.length}` });
    res.end(all.subarray(start, end + 1));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const asTuples = (e: { name: string; crc: number; size: number }[]) => e.map((x) => [x.name, x.crc, x.size]);

test("a small archive: every name, CRC and size matches Python's reading, in one request", async () => {
  const expected = makeZip("small.zip", 5);
  requests = [];
  const got = await readZipEntries(httpRangeReader(`${base}/small.zip`));
  assert.deepEqual(asTuples(got), expected);
  assert.equal(requests.length, 1);
  assert.ok(got.some((e) => e.name === "Color/Andreas Löcher.jpg"));
});

test("a directory larger than the tail takes a second, exact request", async () => {
  // Long names push the table of contents past the 1 MiB tail.
  const expected = makeZip("big.zip", 3000, "x".repeat(200));
  requests = [];
  const got = await readZipEntries(httpRangeReader(`${base}/big.zip`));
  assert.equal(got.length, expected.length);
  assert.deepEqual(asTuples(got), expected);
  assert.equal(requests.length, 2);
});

test("a server that ignores Range is an error, never a guess", async () => {
  makeZip("plain.zip", 1);
  await assert.rejects(readZipEntries(httpRangeReader(`${base}/plain.zip?norange`)), /expected 206/);
});

test("a file that is not a ZIP is an error", async () => {
  fs.writeFileSync(path.join(tmp, "junk.zip"), Buffer.alloc(5000, 7));
  await assert.rejects(readZipEntries(httpRangeReader(`${base}/junk.zip`)), /end-of-central-directory/);
});

test("a directory that holds fewer records than the archive claims is an error", async () => {
  makeZip("short.zip", 2);
  const zip = fs.readFileSync(path.join(tmp, "short.zip"));
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  zip.writeUInt16LE(zip.readUInt16LE(eocd + 10) + 1, eocd + 10);
  fs.writeFileSync(path.join(tmp, "short.zip"), zip);
  await assert.rejects(readZipEntries(httpRangeReader(`${base}/short.zip`)), /holds \d+ records/);
});

test("a ZIP64 marker is refused", async () => {
  makeZip("z64.zip", 1);
  const zip = fs.readFileSync(path.join(tmp, "z64.zip"));
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  zip.writeUInt32LE(0xffffffff, eocd + 16);
  fs.writeFileSync(path.join(tmp, "z64.zip"), zip);
  await assert.rejects(readZipEntries(httpRangeReader(`${base}/z64.zip`)), /ZIP64/);
});
