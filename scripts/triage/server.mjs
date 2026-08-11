#!/usr/bin/env node
/**
 * Local-only triage server for the Pixieset migration.
 *
 * Not part of the app. Nothing here touches Supabase, R2, or Pixieset — it
 * serves a static page, accepts the scraped inventory, and persists keep/trash
 * decisions to a JSON file. "Trash" is a manifest entry, never an action.
 *
 *   node scripts/triage/server.mjs          # http://localhost:4477
 */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "data");
const INVENTORY = join(DATA, "inventory.json");
const DECISIONS = join(DATA, "decisions.json");
const PORT = Number(process.env.TRIAGE_PORT || 4477);

await mkdir(DATA, { recursive: true });

/** Chrome requires this for HTTPS pages calling into localhost (Private Network Access). */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function json(res, code, body) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    return res.end();
  }

  // --- inventory intake (posted once from the Pixieset tab) ---
  if (req.method === "POST" && url.pathname === "/ingest") {
    try {
      const rows = JSON.parse(await body(req));
      if (!Array.isArray(rows) || !rows.length) {
        return json(res, 400, { error: "expected a non-empty array" });
      }
      await writeFile(INVENTORY, JSON.stringify(rows), "utf8");
      const photos = rows.reduce((s, r) => s + (r[3] || 0), 0);
      console.log(`[ingest] ${rows.length} collections, ${photos.toLocaleString()} photos`);
      return json(res, 200, { ok: true, collections: rows.length, photos });
    } catch (err) {
      return json(res, 400, { error: String(err) });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/inventory") {
    const inv = await readJson(INVENTORY, null);
    if (!inv) return json(res, 404, { error: "no inventory ingested yet" });
    return json(res, 200, { inventory: inv, decisions: await readJson(DECISIONS, {}) });
  }

  // --- decisions: full snapshot each write, so undo is trivially consistent ---
  if (req.method === "POST" && url.pathname === "/api/decisions") {
    try {
      const next = JSON.parse(await body(req));
      await writeFile(DECISIONS, JSON.stringify(next, null, 2), "utf8");
      const counts = Object.values(next).reduce((a, d) => {
        a[d.verdict] = (a[d.verdict] || 0) + 1;
        return a;
      }, {});
      console.log(`[save] ${Object.keys(next).length} decided`, counts);
      return json(res, 200, { ok: true, saved: Object.keys(next).length });
    } catch (err) {
      return json(res, 400, { error: String(err) });
    }
  }

  // --- illustrations ---
  if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
    const name = url.pathname.slice("/assets/".length);
    if (/[^a-z0-9._-]/i.test(name)) return json(res, 400, { error: "bad asset name" });
    try {
      const buf = await readFile(join(HERE, "assets", name));
      cors(res);
      // no-cache: this is a tool we iterate on, and a stale asset reads as a bug
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
      return res.end(buf);
    } catch {
      return json(res, 404, { error: "no such asset" });
    }
  }

  // --- the app ---
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    cors(res);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(await readFile(join(HERE, "app.html"), "utf8"));
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`triage server  →  http://localhost:${PORT}`);
  console.log(`data           →  ${DATA}`);
});
