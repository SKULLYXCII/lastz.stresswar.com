import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.cwd());
const port = Number(process.env.PORT || process.argv[2] || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".data": "text/x-script; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  "": "application/json; charset=utf-8",
};

function candidatePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = resolve(join(root, clean));

  if (!full.startsWith(root + sep) && full !== root) return null;
  if (existsSync(full) && statSync(full).isFile()) return full;
  if (existsSync(full) && statSync(full).isDirectory()) {
    const index = join(full, "index.html");
    if (existsSync(index)) return index;
  }

  const html = `${full}.html`;
  if (existsSync(html)) return html;

  const nestedIndex = join(full, "index.html");
  if (existsSync(nestedIndex)) return nestedIndex;

  return join(root, "404.html");
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const file = candidatePath(url.pathname);

  if (!file || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const status = file.endsWith("404.html") && url.pathname !== "/404.html" ? 404 : 200;
  const type = types[extname(file)] || "application/octet-stream";
  res.writeHead(status, { "content-type": type });
  createReadStream(file).pipe(res);
});

server.listen(port, () => {
  console.log(`Serving ${root} at http://localhost:${port}`);
});
