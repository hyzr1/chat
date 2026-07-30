import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { __test } from "../src/core.mjs";

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

test("static projects run on a direct local preview server", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hyzr-static-preview-"));
  const workspace = path.join(root, "static-chat");
  await mkdir(workspace);
  await writeFile(path.join(workspace, "index.html"), "<!doctype html><h1>Direct local preview</h1>");
  try {
    const result = await __test.startPreviewServer({ workspaceRoot: root, tools: {} }, "static-chat");
    assert.match(result.localUrl, /^http:\/\/localhost:\d+$/);
    const response = await fetch(result.localUrl);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Direct local preview/);
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

test("broad product work becomes a bounded mixed-provider specialist graph", () => {
  const plan = __test.specialistPlan({
    plan: true,
    prompt: "Build a production-grade responsive weather web app with a generated background image and a difficult forecast formula.",
  }, { claude: "claude", codex: "codex" });
  assert.deepEqual(plan.map((task) => task.label), [
    "Interface and product design",
    "Technical and mathematical design",
    "Visual asset generation",
    "Implementation",
  ]);
  assert.ok(plan.some((task) => task.engine === "claude"));
  assert.ok(plan.some((task) => task.engine === "codex"));
  assert.ok(plan.length <= 4);
});

test("small prompts avoid orchestration overhead", () => {
  assert.deepEqual(__test.specialistPlan({ plan: true, prompt: "Fix typo" }, { claude: "claude", codex: "codex" }), []);
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
