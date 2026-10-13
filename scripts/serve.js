import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 5173);
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

const server = createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400).end("Invalid path");
    return;
  }
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  if (!/^\/(?:index\.html|vault\.html|login\.html|register\.html|css\/[\w.-]+|js\/[\w.-]+)$/.test(requestedPath)) {
    response.writeHead(404).end("Not found");
    return;
  }
  const filePath = path.resolve(root, `.${requestedPath}`);
  try {
    if (!filePath.startsWith(`${root}${path.sep}`) || !(await stat(filePath)).isFile()) throw new Error("Not found");
  } catch {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": types.get(path.extname(filePath)) || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  if (request.method === "HEAD") return response.end();
  createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => console.log(`BUNKER: http://127.0.0.1:${port}/`));
