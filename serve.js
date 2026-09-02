// Minimal static file server for local development. The app itself is plain
// static files, so any static host will do; this exists only so `node serve.js`
// works with no dependencies.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

// `node serve.js` serves this directory on 4173.
// `node serve.js vault 4174` serves the vault on a second origin, which is what
// the cross-origin tool federation needs locally.
const [dirArg, portArg] = process.argv.slice(2);
const base = new URL(".", import.meta.url).pathname;
const root = dirArg ? join(base, dirArg) : base;
const port = Number(portArg || process.env.PORT || 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const rel = normalize(path === "/" ? "/index.html" : path).replace(/^(\.\.[/\\])+/, "");
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, {
      "content-type": TYPES[extname(rel)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}).listen(port, () => console.log(`ombuds on http://localhost:${port}`));
