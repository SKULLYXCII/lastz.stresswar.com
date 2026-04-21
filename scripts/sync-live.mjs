import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";

const LIVE_ORIGIN = "https://lastz.stresswar.com";
const root = resolve(process.cwd());
const statePath = join(root, ".lastz-live-state.json");
const dryRun = process.argv.includes("--dry-run");

const routePaths = new Set(["/", "/tank", "/research", "/heroes", "/calculators", "/feedback", "/hq"]);
const assetPaths = new Set([
  "/__manifest",
  "/site.webmanifest",
  "/favicon.ico",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
]);
const dataPaths = new Set();

const state = loadState();
const visitedUrls = new Set();
const summary = {
  checked: 0,
  skipped: 0,
  downloaded: 0,
  written: 0,
  unchanged: 0,
  failed: 0,
};

discoverLocalRoutes();
discoverLocalDataFiles(root);
await sync();

function loadState() {
  if (!existsSync(statePath)) return { version: 1, urls: {} };
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return { version: 1, urls: {} };
  }
}

function saveState() {
  const out = {
    version: 1,
    source: LIVE_ORIGIN,
    urls: Object.fromEntries(
      Object.entries(state.urls || {})
        .filter(([url]) => visitedUrls.has(url))
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  if (!dryRun) {
    writeFileIfChanged(statePath, `${JSON.stringify(out, null, 2)}\n`);
  }
}

function discoverLocalRoutes() {
  const researchDir = join(root, "research");
  if (existsSync(researchDir)) {
    for (const name of readdirSync(researchDir)) {
      const full = join(researchDir, name);
      if (statSync(full).isDirectory() && existsSync(join(full, "index.html"))) {
        routePaths.add(`/research/${name}`);
      }
    }
  }
}

function discoverLocalDataFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules" || name === "output") continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      discoverLocalDataFiles(full);
      continue;
    }
    if (name.endsWith(".data")) {
      const rel = relative(root, full).split(sep).join("/");
      if (rel === ".data" || rel === "_root.data") continue;
      dataPaths.add(`/${rel}`);
    }
  }
}

async function sync() {
  const work = [];
  for (const path of routePaths) work.push({ path, kind: "route" });
  for (const path of dataPaths) work.push({ path, kind: "data" });
  for (const path of assetPaths) work.push({ path, kind: "asset" });

  const queue = [...work];
  const seen = new Set();

  while (queue.length) {
    const item = queue.shift();
    if (!item || seen.has(item.path)) continue;
    seen.add(item.path);

    const result = await syncOne(item);
    for (const discovered of result.discovered) {
      if (!seen.has(discovered)) queue.push({ path: discovered, kind: "asset" });
    }
  }

  ensureRootDataAlias();
  saveState();
  printSummary();

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

async function syncOne(item) {
  summary.checked += 1;
  const url = new URL(item.path, LIVE_ORIGIN).toString();
  visitedUrls.add(url);
  const previous = state.urls?.[url];

  try {
    const head = await fetchHead(url);
    if (previous && head && remoteLooksUnchanged(previous, head)) {
      summary.skipped += 1;
      return { discovered: [] };
    }

    const response = await fetch(url, {
      headers: previous?.etag ? { "if-none-match": previous.etag } : {},
    });

    if (response.status === 304) {
      summary.skipped += 1;
      remember(url, previous, head);
      return { discovered: [] };
    }

    if (!response.ok) {
      summary.failed += 1;
      console.warn(`miss ${response.status} ${item.path}`);
      return { discovered: [] };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (item.path === "/__manifest" && bytes.length === 0 && existsSync(join(root, "__manifest"))) {
      summary.unchanged += 1;
      delete state.urls[url];
      console.warn("skip empty /__manifest response");
      return { discovered: [] };
    }

    summary.downloaded += 1;
    const contentType = response.headers.get("content-type") || "";
    const meta = headersToState(response.headers, bytes);
    remember(url, meta, head);

    const discovered = discoverAssetReferences(bytes, item.path, contentType);
    const targets = localTargets(item);

    for (const target of targets) {
      const targetFile = join(root, target);
      const output = item.kind === "route" ? normalizeHtml(bytes.toString("utf8"), item.path, targetFile) : bytes;
      if (writeFileIfChanged(targetFile, output)) {
        summary.written += 1;
        console.log(`${dryRun ? "would write" : "wrote"} ${target}`);
      } else {
        summary.unchanged += 1;
      }
    }

    return { discovered };
  } catch (error) {
    summary.failed += 1;
    console.warn(`fail ${item.path}: ${error.message}`);
    return { discovered: [] };
  }
}

async function fetchHead(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) return null;
    return headersToState(response.headers);
  } catch {
    return null;
  }
}

function headersToState(headers, bytes = null) {
  const meta = {
    etag: headers.get("etag") || null,
    lastModified: headers.get("last-modified") || null,
    contentLength: headers.get("content-length") || null,
    contentType: headers.get("content-type") || null,
  };
  if (bytes) {
    meta.sha256 = createHash("sha256").update(bytes).digest("hex");
    meta.bytes = bytes.length;
  }
  return meta;
}

function remember(url, current, head) {
  state.urls ||= {};
  state.urls[url] = { ...(current || {}), ...(head || {}) };
}

function remoteLooksUnchanged(previous, head) {
  if (previous.etag && head.etag && previous.etag === head.etag) return true;
  if (
    previous.lastModified &&
    head.lastModified &&
    previous.lastModified === head.lastModified &&
    previous.contentLength &&
    head.contentLength &&
    previous.contentLength === head.contentLength
  ) {
    return true;
  }
  return false;
}

function localTargets(item) {
  if (item.kind === "route") {
    if (item.path === "/") return ["index.html", "404.html"];
    const clean = item.path.slice(1);
    return [`${clean}.html`, `${clean}/index.html`];
  }

  const clean = item.path.replace(/^\//, "");
  return [clean || "index.html"];
}

function writeFileIfChanged(file, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  if (existsSync(file)) {
    const existing = readFileSync(file);
    if (existing.equals(bytes)) return false;
  }

  if (!dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  return true;
}

function ensureRootDataAlias() {
  const homeData = join(root, ".data");
  if (!existsSync(homeData)) return;

  if (writeFileIfChanged(join(root, "_root.data"), readFileSync(homeData))) {
    summary.written += 1;
    console.log(`${dryRun ? "would write" : "wrote"} _root.data`);
  } else {
    summary.unchanged += 1;
  }
}

function normalizeHtml(html, routePath, targetFile) {
  let out = html;
  out = out.replace(/<script[^>]*src=["']\/cdn-cgi\/[^"']+["'][^>]*>\s*<\/script>/g, "");
  out = out.replace(/<script>\(function\(\)\{function c\(\).*?<\/script>/gs, "");

  if (!/<base\s/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, '<head$1><base href="/">');
  }

  out = out.replace(/href=["']\/(tank|research|heroes|calculators|feedback|hq)\.html(["'])/g, 'href="/$1$2');
  out = out.replace(/href=["']\/research\/([^"']+)\.html(["'])/g, 'href="/research/$1$2');
  if (routePath === "/") {
    out = preserveExistingHomeLoader(out, targetFile);
  }
  return out;
}

function preserveExistingHomeLoader(html, targetFile) {
  if (!existsSync(targetFile)) return html;
  const existing = readFileSync(targetFile, "utf8");
  const loaderPattern =
    /<script>window\.__reactRouterContext\.streamController\.enqueue\("(?:(?!<\/script>).)*selectedMembers(?:(?!<\/script>).)*<\/script>/s;
  const previousLoader = existing.match(loaderPattern)?.[0];
  if (!previousLoader) return html;
  return html.replace(loaderPattern, previousLoader);
}

function discoverAssetReferences(bytes, sourcePath, contentType) {
  const textTypes = ["text/", "javascript", "json", "manifest", "svg", "css"];
  if (!textTypes.some((type) => contentType.includes(type)) && !looksTextual(sourcePath)) {
    return [];
  }

  const text = bytes.toString("utf8");
  const found = new Set();
  const regex = /["'(`]((?:\/|\.\.?\/)(?:assets|icons)\/[^"'()`\\\s<>]+|\/(?:android-chrome-[^"'()`\\\s<>]+|apple-touch-icon\.png|favicon(?:-[^"'()`\\\s<>]+)?\.(?:png|ico)|site\.webmanifest))["'()`]/g;

  for (const match of text.matchAll(regex)) {
    const normalizedPath = toRootPath(match[1], sourcePath);
    if (normalizedPath) found.add(normalizedPath);
  }

  if (sourcePath === "/__manifest") {
    try {
      const manifest = JSON.parse(text);
      for (const route of Object.values(manifest)) {
        if (route.module) found.add(route.module);
        for (const value of [...(route.imports || []), ...(route.css || [])]) found.add(value);
      }
    } catch {
      // The route manifest is best-effort discovery input.
    }
  }

  return [...found].filter((path) => safeRemotePath(path));
}

function toRootPath(value, sourcePath) {
  if (value.startsWith("/")) return value;
  if (!value.startsWith(".")) return null;

  const sourceDir = sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1);
  const resolved = normalize(`${sourceDir}${value}`).split("\\").join("/");
  return resolved.startsWith("/") ? resolved : `/${resolved}`;
}

function safeRemotePath(path) {
  if (!path.startsWith("/")) return false;
  if (path.includes("..")) return false;
  if (path.includes("${") || path.includes("\\")) return false;
  const ext = extname(path).toLowerCase();
  return [
    "",
    ".css",
    ".ico",
    ".js",
    ".json",
    ".png",
    ".svg",
    ".webmanifest",
    ".webp",
    ".woff",
    ".woff2",
  ].includes(ext);
}

function looksTextual(path) {
  return [".css", ".html", ".js", ".json", ".svg", ".webmanifest", ""].includes(extname(path));
}

function printSummary() {
  const mode = dryRun ? "dry run" : "sync";
  console.log(
    `${mode}: checked ${summary.checked}, skipped ${summary.skipped}, downloaded ${summary.downloaded}, written ${summary.written}, unchanged ${summary.unchanged}, failed ${summary.failed}`,
  );
}
