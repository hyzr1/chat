import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { __test } from "../src/core.mjs";
import { parseRouterPlan, buildRouterPrompt } from "../src/routing.mjs";

test("one conversation always resolves to one workspace", () => {
  const root = path.join(os.tmpdir(), "hyzr-test-workspaces");
  assert.equal(__test.safeWorkspace(root, "chat_123"), path.join(root, "chat_123"));
  assert.equal(__test.safeWorkspace(root, "chat_123"), __test.safeWorkspace(root, "chat_123"));
});

test("workspace ids and relative files cannot escape their root", () => {
  const root = path.join(os.tmpdir(), "hyzr-test-workspaces");
  assert.equal(path.dirname(__test.safeWorkspace(root, "../../outside")), path.resolve(root));
  assert.throws(() => __test.safeRelative(path.join(root, "chat"), "../../secret.txt"), /Invalid project path/);
});

test("explicit provider model wins before prompt heuristics", () => {
  const tools = { claude: "claude", codex: "codex" };
  assert.equal(__test.engineFor({ model: "claude-sonnet", prompt: "fix tests" }, tools), "claude");
  assert.equal(__test.engineFor({ model: "gpt-5.6-sol", prompt: "write a poem" }, tools), "codex");
});

test("the bridge forwards commands without injecting preview restrictions", () => {
  const prompt = "Run npm run dev on port 5000 and keep it running.";
  const direct = __test.transcript({ prompt, history: [] });
  assert.equal(direct, prompt);
  assert.doesNotMatch(direct, /Hyzr manages|do not start|persistent\/background/i);
  const migrated = __test.transcript({
    prompt,
    history: [
      { role: "assistant", content: "Hyzr manages preview servers itself, so I cannot start it." },
      { role: "user", content: "Why can't you run the command?" },
    ],
  });
  assert.doesNotMatch(migrated, /Hyzr manages|cannot start it/i);
  assert.match(migrated, /Why can't you run the command\?/);
  assert.match(migrated, /Run npm run dev on port 5000/);
});

test("relay credentials are never sent over remote plaintext HTTP", () => {
  assert.equal(__test.cleanRelay("https://chat.hyzr.ai/path"), "https://chat.hyzr.ai");
  assert.equal(__test.cleanRelay("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.throws(() => __test.cleanRelay("http://example.com"), /requires HTTPS/);
});

test("preview selection prefers built output and then shallow index", () => {
  assert.equal(__test.previewEntry([
    { type: "file", name: "other.html", path: "nested/other.html" },
    { type: "file", name: "index.html", path: "index.html" },
    { type: "file", name: "index.html", path: "dist/index.html" },
  ]), "dist/index.html");
});

test("preview discovery recognizes declared and framework dev ports", () => {
  assert.equal(__test.previewPortFor({ hyzr: { previewPort: 4567 } }, "next dev"), 4567);
  assert.equal(__test.previewPortFor({}, "vite --port 5199"), 5199);
  assert.equal(__test.previewPortFor({}, "next dev"), 3000);
  assert.equal(__test.previewPortFor({}, "vite"), 5173);
  assert.equal(__test.previewPortFor({}, "node server.js"), null);
  assert.equal(__test.previewPortFromPrompt("run it at http://localhost:8080/"), 8080);
  assert.equal(__test.previewPortFromPrompt("start the server on port 6000"), 6000);
  assert.equal(__test.previewPortFromPrompt("yes 8080"), 8080);
  assert.equal(__test.previewPortFromPrompt("no server requested"), null);
});

test("preview servers bind framework-specific hosts for Wi-Fi access", () => {
  assert.deepEqual(__test.previewHostArgs("next dev"), ["--hostname", "0.0.0.0"]);
  assert.deepEqual(__test.previewHostArgs("vite"), ["--host", "0.0.0.0"]);
  assert.deepEqual(__test.previewHostArgs("node server.js"), []);
});

test("Windows preview cleanup resolves the process listening on its assigned port", () => {
  const output = [
    "  TCP    0.0.0.0:43126        0.0.0.0:0              LISTENING       13028",
    "  TCP    127.0.0.1:3000       0.0.0.0:0              LISTENING       11740",
  ].join("\r\n");
  assert.deepEqual(__test.previewListenerPidsFromNetstat(output, 43126), [13028]);
});

test("preview discovery selects a private LAN address only", () => {
  assert.equal(__test.privateLanAddress({
    Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    "vEthernet (WSL)": [{ address: "172.22.16.1", family: "IPv4", internal: false }],
    Ethernet: [{ address: "192.168.1.44", family: "IPv4", internal: false }],
  }), "192.168.1.44");
  assert.equal(__test.privateLanAddress({
    Public: [{ address: "203.0.113.10", family: "IPv4", internal: false }],
  }), null);
});

test("static projects are served by the built-in static preview server", async () => {
  // The common case: plain index.html with no dev server. Previously this
  // REJECTED, so Preview 500'd for every static build. Now we serve it.
  const root = await mkdtemp(path.join(os.tmpdir(), "hyzr-static-preview-"));
  const workspace = path.join(root, "static-chat");
  await mkdir(workspace);
  await writeFile(path.join(workspace, "index.html"), "<!doctype html><h1>Direct local preview</h1>");
  try {
    const result = await __test.startPreviewServer({ workspaceRoot: root, tools: {} }, "static-chat");
    assert.ok(result.port >= 3001 && result.port < 3100, `served on a preview port, got ${result.port}`);
    assert.equal(result.static, true, "flagged as a static preview");
    const body = await (await fetch(`http://127.0.0.1:${result.port}/`)).text();
    assert.match(body, /Direct local preview/, "the file is actually served");
  } finally {
    __test.sweepPreviewServers(true);
    await rm(root, { recursive: true, force: true });
  }
});

test("framework preview passively attaches to the project's declared server", async () => {
  const projectServer = createServer((_request, response) => response.end("agent-owned preview"));
  await new Promise((resolve, reject) => {
    projectServer.once("error", reject);
    projectServer.listen(0, "0.0.0.0", resolve);
  });
  const address = projectServer.address();
  const declaredPort = typeof address === "object" && address ? address.port : 0;
  assert.ok(declaredPort > 0);

  const root = await mkdtemp(path.join(os.tmpdir(), "hyzr-declared-preview-"));
  const workspace = path.join(root, "declared-port-chat");
  await mkdir(workspace);
  await writeFile(path.join(workspace, "package.json"), JSON.stringify({
    private: true,
    scripts: { dev: `vite --host 0.0.0.0 --port ${declaredPort}` },
  }));
  try {
    const result = await __test.startPreviewServer({ workspaceRoot: root, tools: {} }, "declared-port-chat");
    assert.equal(result.port, declaredPort);
    assert.equal(result.localUrl, `http://localhost:${declaredPort}`);
    assert.equal(result.attached, true);
    assert.equal(await (await fetch(result.localUrl)).text(), "agent-owned preview");
    __test.sweepPreviewServers(true);
    assert.equal(await (await fetch(result.localUrl)).text(), "agent-owned preview");
  } finally {
    __test.sweepPreviewServers(true);
    await new Promise((resolve) => projectServer.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude text after tool work starts a readable paragraph", () => {
  assert.equal(__test.streamSeparator("Let me create it now."), "\n\n");
  assert.equal(__test.streamSeparator("Already separated.\n\n"), "");
  assert.equal(__test.streamSeparator(""), "");
});

test("coherence-first: a coupled app is one build; only the image splits off", () => {
  // Old behavior over-split this into 4 specialist tasks (design/tech/visual/impl)
  // which judged A/B proved BREAKS integration. Now the coupled app is ONE
  // coherent build on the best-suited model, and only the genuinely independent
  // image-generation deliverable splits off to ChatGPT (Claude can't make images).
  const plan = __test.specialistPlan({
    plan: true,
    prompt: "Build a production-grade responsive weather web app with a polished UI, and generate a background image.",
  }, { claude: "claude", codex: "codex" });
  assert.equal(plan.length, 2, `expected build + image, got ${plan.map((t) => t.capability).join(", ")}`);
  const media = plan.find((t) => t.capability === "media_generation");
  const build = plan.find((t) => t.capability !== "media_generation");
  assert.ok(build, "one coherent build");
  assert.equal(build.engine, "claude", "polished app build routes to Claude");
  assert.ok(media, "the image is its own subtask");
  assert.equal(media.engine, "codex", "image generation routes to ChatGPT (Claude can't)");
});

test("LLM router: valid plan honored; image forced to ChatGPT; over-split collapsed; garbage falls back", () => {
  const tools = { claude: "claude", codex: "codex" };
  const job = { prompt: "build a high quality game and generate a hero image", plan: true, history: [] };
  // Valid: high-craft build stays on the model the router chose; analysis surfaced.
  const ok = parseRouterPlan('{"analysis":"A game is a polished UI build.","subtasks":[{"title":"Build","capability":"frontend_design","model":"claude-fable","rationale":"top design"}]}', job, tools);
  assert.equal(ok.tasks[0].model, "claude-fable");
  assert.ok(ok.analysis.includes("polished"), "analysis is captured and shown");
  // Image generation MUST run on ChatGPT even if the router picked Claude.
  const media = parseRouterPlan('{"subtasks":[{"capability":"media_generation","model":"claude-opus"}]}', job, tools);
  assert.equal(media.tasks[0].engine, "codex");
  // Coherence: two code subtasks collapse to a single build (+ any media).
  const coh = parseRouterPlan('{"subtasks":[{"capability":"new_code","model":"claude-sonnet"},{"capability":"frontend_design","model":"claude-opus"},{"capability":"media_generation","model":"gpt-5.6-terra"}]}', job, tools);
  assert.equal(coh.tasks.filter((t) => t.capability !== "media_generation").length, 1, "one coherent build");
  assert.ok(coh.tasks.some((t) => t.capability === "media_generation"), "media kept");
  // Unparseable ⇒ null ⇒ deterministic fallback runs instead.
  assert.equal(parseRouterPlan("sorry, I can't do that", job, tools), null);
  // The router prompt always lists the models with their usage weights.
  assert.ok(/usage x/.test(buildRouterPrompt(job, tools)));
});

test("a trivial one-off still shows its routed model (one cheap node, no orchestration)", () => {
  // The user should always see which model will handle their request, and it
  // must be the quality-routed one (a padding tweak → a cheap model), not a
  // default. It's a single node — no multi-model orchestration.
  const plan = __test.specialistPlan({ plan: true, prompt: "change the button padding to 8px" }, { claude: "claude", codex: "codex" });
  assert.equal(plan.length, 1, "one routed node");
  assert.ok(plan[0].model, "the node names its model");
});

test("planning is skipped entirely when the Deep toggle is off", () => {
  assert.deepEqual(__test.specialistPlan({ plan: false, prompt: "build a whole app with an API and a UI" }, { claude: "claude", codex: "codex" }), []);
});

test("small prompts route to one model without multi-model orchestration", () => {
  const plan = __test.specialistPlan({ plan: true, prompt: "Fix typo" }, { claude: "claude", codex: "codex" });
  assert.equal(plan.length, 1, "a single routed node, no orchestration");
});

test("Windows command discovery prefers executable shims over extensionless npm shims", () => {
  const candidates = [
    "C:\\Users\\test\\AppData\\Roaming\\npm\\claude",
    "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd",
  ];
  assert.equal(__test.selectExecutable(candidates, true), candidates[1]);
  assert.equal(
    __test.selectExecutable([...candidates, "C:\\tools\\claude.exe"], true),
    candidates[1],
  );
});

test("Windows command arguments cannot break out of their quoted launcher", () => {
  assert.equal(__test.cmdQuote("safe&echo injected"), '"safe&echo injected"');
  assert.equal(__test.cmdQuote("100% ready"), '"100%% ready"');
  assert.equal(__test.cmdQuote("line\r\nbreak"), '"line  break"');
});

test("Windows console font helper loads successfully", { skip: process.platform !== "win32" }, () => {
  assert.equal(__test.setModernConsoleFont(), true);
});

test("single-instance locking replaces stale locks and rejects a live duplicate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hyzr-runtime-lock-"));
  const lock = path.join(root, "runtime.lock");
  try {
    await writeFile(lock, JSON.stringify({ pid: 999_999_999, nonce: "stale" }));
    const release = await __test.acquireRuntimeLock(lock);
    await assert.rejects(
      () => __test.acquireRuntimeLock(lock),
      (error) => error?.code === "ALREADY_RUNNING",
    );
    await release();
    const releaseAgain = await __test.acquireRuntimeLock(lock);
    await releaseAgain();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
