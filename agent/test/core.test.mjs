import assert from "node:assert/strict";
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
