import { createServer } from "http";
import { promises as fs } from "fs";
import path from "path";
import { chromium, type Browser } from "@playwright/test";
import { workspaceFor } from "./local-runner";
import type { VerificationCheck } from "./verifier";
import { STATE_DIRECTORY } from "./product-paths";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2",
};

async function staticRoot(workspace: string) {
  for (const candidate of ["dist", "build", "out", "."]) {
    const root = path.resolve(workspace, candidate);
    try { await fs.access(path.join(root, "index.html")); return root; } catch {}
  }
  return undefined;
}

async function serve(root: string) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
      const relative = pathname.replace(/^\/+/, "") || "index.html";
      let file = path.resolve(root, relative);
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw new Error("Unsafe path");
      try {
        const stat = await fs.stat(file);
        if (stat.isDirectory()) file = path.join(file, "index.html");
        await fs.access(file);
      } catch {
        if (path.extname(relative)) { response.writeHead(404).end(); return; }
        file = path.join(root, "index.html");
      }
      response.writeHead(200, { "Content-Type": contentTypes[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a verification port.");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function verifyViewport(browser: Browser, url: string, evidenceDirectory: string, name: string, viewport: { width: number; height: number }) {
  const started = Date.now();
  const context = await browser.newContext({ viewport, deviceScaleFactor: name === "mobile" ? 2 : 1, isMobile: name === "mobile", hasTouch: name === "mobile" });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText || "failed"}`));
  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await page.screenshot({ path: path.join(evidenceDirectory, `${name}.png`), fullPage: true });
  // Inject axe as source instead of AxeBuilder's serialized helper function.
  // The latter is rewritten by the Next server bundler and can reference a
  // CommonJS `module` global that does not exist inside the browser page.
  const axeSource = await fs.readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "node_modules", "axe-core", "axe.min.js"), "utf8");
  await page.addScriptTag({ content: axeSource });
  const accessibility = await page.evaluate("window.axe.run()") as { violations: Array<{ impact?: string | null; id: string; help: string }> };
  const violations = accessibility.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
  const horizontalOverflow = await page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1") as boolean;
  const mobileUsability = name === "mobile" ? await page.evaluate(`(() => {
    const visible = (element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute("content") || "";
    const controls = Array.from(document.querySelectorAll("input, textarea, select")).filter((element) => visible(element) && element.type !== "hidden");
    const smallTextControls = controls.filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 16).slice(0, 8).map((element) => element.tagName.toLowerCase() + (element.id ? "#" + element.id : ""));
    const targets = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')).filter(visible);
    const smallTargets = targets.filter((element) => {
      const box = element.getBoundingClientRect();
      return box.width < 28 || box.height < 28;
    }).slice(0, 8).map((element) => (element.textContent || element.getAttribute("aria-label") || element.tagName).trim().slice(0, 50));
    const coveredTargets = targets.filter((element) => {
      const box = element.getBoundingClientRect();
      const rawX = box.left + box.width / 2;
      const rawY = box.top + box.height / 2;
      if (rawX < 0 || rawX >= innerWidth || rawY < 0 || rawY >= innerHeight) return false;
      const x = rawX;
      const y = rawY;
      const top = document.elementFromPoint(x, y);
      return Boolean(top && top !== element && !element.contains(top));
    }).slice(0, 8).map((element) => (element.textContent || element.getAttribute("aria-label") || element.tagName).trim().slice(0, 50));
    return { viewportOk: /width\\s*=\\s*device-width/i.test(viewport), smallTextControls, smallTargets, coveredTargets };
  })()`) as { viewportOk: boolean; smallTextControls: string[]; smallTargets: string[]; coveredTargets: string[] } : undefined;
  await context.close();
  const failures = [
    !response?.ok() ? `HTTP ${response?.status() || "no response"}` : "",
    horizontalOverflow ? "Horizontal page overflow detected" : "",
    mobileUsability && !mobileUsability.viewportOk ? "Missing a width=device-width viewport declaration" : "",
    mobileUsability?.smallTextControls.length ? `Mobile form controls below 16px may trigger Safari zoom: ${mobileUsability.smallTextControls.join(", ")}` : "",
    mobileUsability?.smallTargets.length ? `Mobile controls below the 28px minimum target: ${mobileUsability.smallTargets.join(", ")}` : "",
    mobileUsability?.coveredTargets.length ? `Mobile controls are covered or not hit-testable: ${mobileUsability.coveredTargets.join(", ")}` : "",
    ...consoleErrors.slice(0, 10).map((error) => `Console: ${error}`),
    ...failedRequests.slice(0, 10).map((error) => `Network: ${error}`),
    ...violations.slice(0, 10).map((violation) => `A11y ${violation.impact}: ${violation.id} — ${violation.help}`),
  ].filter(Boolean);
  return {
    id: `browser-${name}`,
    label: `${name === "mobile" ? "Mobile" : "Desktop"} browser flow, screenshot, and accessibility`,
    status: failures.length ? "failed" : "passed",
    durationMs: Date.now() - started,
    output: failures.length ? failures.join("\n") : `Rendered without console/network errors, serious accessibility violations, or horizontal overflow. Evidence: ${path.join(evidenceDirectory, `${name}.png`)}`,
  } satisfies VerificationCheck;
}

export async function verifyBrowserExperience(workspaceId?: string): Promise<VerificationCheck[]> {
  const workspace = workspaceFor(workspaceId);
  const root = await staticRoot(workspace);
  if (!root) return [{ id: "browser-flow", label: "Browser flow verification", status: "skipped", durationMs: 0, output: "No static browser entrypoint was found. Framework-specific tests remain authoritative." }];
  const evidenceDirectory = path.join(STATE_DIRECTORY, "evidence", (workspaceId || "legacy").replace(/[^a-zA-Z0-9_-]/g, ""));
  await fs.mkdir(evidenceDirectory, { recursive: true });
  const hosted = await serve(root);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    return [
      await verifyViewport(browser, hosted.url, evidenceDirectory, "desktop", { width: 1440, height: 1000 }),
      await verifyViewport(browser, hosted.url, evidenceDirectory, "mobile", { width: 390, height: 844 }),
    ];
  } catch (error: any) {
    return [{ id: "browser-flow", label: "Browser flow verification", status: "failed", durationMs: 0, output: `Playwright could not run: ${String(error?.message || error)}` }];
  } finally {
    await browser?.close().catch(() => {});
    await new Promise<void>((resolve) => hosted.server.close(() => resolve()));
  }
}
