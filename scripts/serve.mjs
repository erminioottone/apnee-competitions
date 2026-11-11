import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2),
  option = (name, fallback) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const host = option("--host", "127.0.0.1"),
  port = Number(option("--port", "3000")),
  root = path.resolve(new URL("..", import.meta.url).pathname);
const mime = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".ics": "text/calendar",
};
http
  .createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        ),
        relative = pathname === "/" ? "index.html" : pathname.slice(1),
        file = path.resolve(root, relative);
      if (
        !file.startsWith(root + path.sep) ||
        relative.split("/").some((p) => p.startsWith("."))
      )
        throw new Error("Forbidden");
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type":
          (mime[path.extname(file)] || "application/octet-stream") +
          "; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(port, host, () =>
    console.log(`Calendar preview: http://${host}:${port}`),
  );
