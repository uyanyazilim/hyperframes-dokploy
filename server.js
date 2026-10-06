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

function ensureStarter() {
  const files = fs.readdirSync(VIDEO_DIR);
  if (files.length > 0) return;
  console.log("[gateway] /app/video empty — running `hyperframes init my-video` scaffold...");
  try {
    execFileSync("npx", ["--yes", "hyperframes", "init", "my-video"], {
      cwd: "/app",
      timeout: 120000,
      stdio: "inherit",
    });
    const src = "/app/my-video";
    if (fs.existsSync(src)) {
      for (const f of fs.readdirSync(src)) {
        fs.renameSync(path.join(src, f), path.join(VIDEO_DIR, f));
      }
      fs.rmdirSync(src);
    }
  } catch (e) {
    console.error("[gateway] starter scaffold failed (non-fatal):", e?.message || e);
  }
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
    res.end(JSON.stringify({ status: "ok", service: "hyperframes-dokploy", preview: "/preview/", renders: "/renders/", doctor: "/api/doctor", render: "POST /api/render" }));
    return;
  }

  if (url.pathname === "/api/doctor") {
    const r = await runCmd("npx", ["hyperframes", "doctor"], { cwd: VIDEO_DIR });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: r.code, stdout: r.stdout.slice(-8000), stderr: r.stderr.slice(-4000) }));
    return;
  }

  if (url.pathname === "/api/render" && req.method === "POST") {
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
