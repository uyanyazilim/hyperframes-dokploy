  // init directly inside VIDEO_DIR so index.html lands where preview/render look
  const r = { code: 0, stdout: "", stderr: "" };
  try {
    const out = execFileSync("npx", ["--yes", "hyperframes", "init", ".", "--non-interactive"], {
      cwd: VIDEO_DIR,
      timeout: 300000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: "1" },
    });
    r.stdout = String(out || "");
  } catch (e) {
    r.code = e?.status ?? 1;
    r.stdout = String(e?.stdout || "");
    r.stderr = String(e?.stderr || e?.message || "");
  }
  r.after = fs.readdirSync(VIDEO_DIR);
  return r;