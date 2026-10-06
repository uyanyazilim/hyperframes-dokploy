/**
 * hyperframes-dokploy gateway.
 * Traefik/Dokploy-ready: listens on 0.0.0.0:${PORT}, health on / and /health.
 * Spawns `npx hyperframes preview --port ${PREVIEW_PORT}` (binds 127.0.0.1
 * upstream) and reverse-proxies it under /preview/. Local Docker render only:
 * POST /api/render runs `npx hyperframes render` inside /app/video.
 * No Vercel/Cloudflare/Modal/Lambda. No API keys.
 */
import http from "node:http";
import { spawn, execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = parseInt(process.env.PORT || "3002", 10);
const PREVIEW_PORT = parseInt(process.env.PREVIEW_PORT || "3102", 10);
const VIDEO_DIR = "/app/video";
const RENDERS_DIR = "/app/renders";

fs.mkdirSync(VIDEO_DIR, { recursive: true });
fs.mkdirSync(RENDERS_DIR, { recursive: true });

function hasComposition() {
  try {
    const files = fs.readdirSync(VIDEO_DIR);
    if (files.includes("index.html")) return true;
    // nested project dir (e.g. my-video/index.html)
    for (const f of files) {
      const p = path.join(VIDEO_DIR, f);
      try {
        if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "index.html"))) return true;
      } catch {}
    }
    return false;
  } catch {
    return false;
  }
}

function doInit() {
  // init directly inside VIDEO_DIR so index.html lands where preview/render look
  const r = { code: 0, stdout: "", stderr: "" };
  try {
    const out = execFileSync("npx", ["--yes", "hyperframes", "init", "--yes"], {
      cwd: VIDEO_DIR,
      timeout: 180000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    r.stdout = String(out || "");
  } catch (e) {
    r.code = e?.status ?? 1;
    r.stdout = String(e?.stdout || "");
    r.stderr = String(e?.stderr || e?.message || "");
  }
  r.after = fs.readdirSync(VIDEO_DIR);
  return r;
}

function ensureStarter() {
  if (hasComposition()) {
    console.log("[gateway] composition found, skipping init");
    return;
  }
  console.log("[gateway] /app/video has no composition — running `hyperframes init`...");
  const r = doInit();
  console.log(`[gateway] init code=${r.code} files=${JSON.stringify(r.after)}`);
  if (r.stdout) console.log(`[gateway] init stdout: ${r.stdout.slice(-2000)}`);
  if (r.stderr) console.error(`[gateway] init stderr: ${r.stderr.slice(-2000)}`);
}

ensureStarter();

let previewChild = null;
function startPreview() {
  console.log(`[gateway] starting preview on 127.0.0.1:${PREVIEW_PORT} ...`);
  previewChild = spawn("npx", ["hyperframes", "preview", "--port", String(PREVIEW_PORT)], {
    cwd: VIDEO_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PREVIEW_PORT) },
  });
  previewChild.stdout.on("data", (d) => process.stdout.write(`[preview] ${d}`));
  previewChild.stderr.on("data", (d) => process.stderr.write(`[preview] ${d}`));
  previewChild.on("exit", (code) => {
    console.error(`[gateway] preview exited code=${code}, restarting in 5s...`);
    setTimeout(startPreview, 5000);
  });
}
startPreview();

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 600000, maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ code: err?.code ?? 0, stdout: String(stdout || ""), stderr: String(stderr || err?.message || "") });
    });
  });
}

function proxy(req, res, prefix = "/preview") {
  const targetPath = req.url.slice(prefix.length) || "/";
  const opts = {
    host: "127.0.0.1",
    port: PREVIEW_PORT,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${PREVIEW_PORT}` },
  };
  const preq = http.request(opts, (pres) => {
    res.writeHead(pres.statusCode, pres.headers);
    pres.pipe(res);
  });
  preq.on("error", (e) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "preview not ready", detail: e.message }));
  });
  req.pipe(preq);
}

function serveFile(res, filePath, contentType = "video/mp4") {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  res.writeHead(200, { "content-type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/" || url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "hyperframes-dokploy", preview: "/preview/", renders: "/renders/", doctor: "/api/doctor", render: "POST /api/render", init: "POST /api/init" }));
    return;
  }

  if (url.pathname === "/api/doctor") {
    const r = await runCmd("npx", ["hyperframes", "doctor"], { cwd: VIDEO_DIR });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: r.code, stdout: r.stdout.slice(-8000), stderr: r.stderr.slice(-4000) }));
    return;
  }

  // manual scaffold trigger: POST /api/init
  if (url.pathname === "/api/init" && req.method === "POST") {
    const r = doInit();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: r.code, files: r.after, stdout: String(r.stdout).slice(-4000), stderr: String(r.stderr).slice(-4000) }));
    return;
  }

  if (url.pathname === "/api/render" && req.method === "POST") {
    if (!hasComposition()) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no composition in /app/video — POST /api/init first", files: fs.readdirSync(VIDEO_DIR) }));
      return;
    }
    const output = (url.searchParams.get("output") || `render-${Date.now()}.mp4`).replace(/[^a-zA-Z0-9._-]/g, "_");
    const outAbs = path.join(RENDERS_DIR, output);
    console.log(`[gateway] render → ${outAbs}`);
    const r = await runCmd("npx", ["hyperframes", "render", "--output", outAbs], { cwd: VIDEO_DIR });
    res.writeHead(r.code === 0 ? 200 : 500, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: r.code, output: `/renders/${output}`, stdout: r.stdout.slice(-8000), stderr: r.stderr.slice(-4000) }));
    return;
  }

  if (url.pathname.startsWith("/renders/")) {
    const name = path.basename(url.pathname);
    serveFile(res, path.join(RENDERS_DIR, name));
    return;
  }
  if (url.pathname === "/renders") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ files: fs.readdirSync(RENDERS_DIR) }));
    return;
  }

  if (url.pathname === "/preview" || url.pathname.startsWith("/preview/")) {
    proxy(req, res, "/preview");
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found", hint: "GET / for routes" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[gateway] listening on 0.0.0.0:${PORT} (preview 127.0.0.1:${PREVIEW_PORT})`);
});
