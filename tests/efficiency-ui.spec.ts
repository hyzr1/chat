import { expect, test } from "@playwright/test";

async function createTestAccount(page: import("@playwright/test").Page) {
  const credentials = {
    email: "hyzr-playwright@example.test",
    password: "hyzr-playwright-password",
  };
  let response = await page.request.post("/api/auth/login", { data: credentials });
  if (response.ok()) return;
  response = await page.request.post("/api/auth/signup", { data: credentials });
  if (response.ok()) return;
  response = await page.request.post("/api/auth/login", { data: credentials });
  expect(response.ok()).toBeTruthy();
}

for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`${viewport.name} usage UI stays inside the viewport`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await createTestAccount(page);
    await page.goto("/");
    await expect(page.locator(".app")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: /Usage & limits/i }).click();
    await expect(page.getByText("Measured execution efficiency")).toBeVisible();
    await expect(page.getByText("No invented savings")).toBeVisible();
    const settingsOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(settingsOverflow).toBeLessThanOrEqual(1);

    if (viewport.name === "mobile") await page.locator(".settings-mobile-back").click();
    await page.getByRole("button", { name: /^Routing$/i }).click();
    await expect(page.getByText("Adaptive intelligence")).toBeVisible();
    await expect(page.getByText("Learn from accepted deliveries")).toBeVisible();
    const routingOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(routingOverflow).toBeLessThanOrEqual(1);
  });
}

test("mobile primary navigation remains usable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createTestAccount(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("tab", { name: "Agent" }).click();
  for (const destination of ["Tasks", "Proof", "Projects", "Work intake", "Library"]) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    const accessibleName = destination === "Tasks" ? /^Tasks(?: \d+)?$/ : new RegExp(`^${destination}$`);
    await page.getByRole("button", { name: accessibleName }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${destination} should not overflow horizontally`).toBeLessThanOrEqual(1);
    const durableUrl = page.url();
    expect(durableUrl, `${destination} should have a refresh-safe URL`).toContain("?view=");
    await page.reload();
    await expect(page).toHaveURL(durableUrl);
    await expect(page.locator(".nav-btn.active")).toContainText(destination);
  }
});

for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`${viewport.name} proof dashboard is honest and responsive`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?view=proof");
    await expect(page.getByRole("heading", { name: "Proof, not promises." })).toBeVisible();
    await expect(page.getByText("Hyzr Chat routing vs premium-only")).toBeVisible();
    await expect(page.getByText("No synthetic ROI")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("mobile text controls do not trigger Safari focus zoom", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const undersized = await page.locator("input:visible, textarea:visible, select:visible").evaluateAll((elements) =>
    elements.filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 16).map((element) => `${element.tagName}:${getComputedStyle(element).fontSize}`),
  );
  expect(undersized).toEqual([]);
});

test("mobile pairing gate is usable and contained", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pair");
  await expect(page.getByRole("heading", { name: "Pair this device" })).toBeVisible();
  const input = page.getByLabel("Access key");
  await expect(input).toBeVisible();
  expect(await input.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("hosted computer setup is a compact terminal download and code", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createTestAccount(page);
  await page.route("**/api/setup", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ hosted: true, platform: "", agentConnected: false, agent: null, ready: false }),
  }));
  await page.route("**/api/agent/code", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: "ABC123" }),
  }));
  await page.route("**/api/agent/status**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ status: "waiting" }),
  }));
  await page.goto("/");
  await page.locator("button.top-download").click();
  await expect(page.getByRole("heading", { name: "Connect your computer" })).toBeVisible();
  const download = page.locator(".pair-download");
  await expect(download).toContainText(/Download hyzr/);
  await expect(download).toHaveAttribute("href", /\/api\/agent\/download\?platform=/);
  await expect(page.locator(".pair-code > div code")).toHaveText(/[A-Z0-9]{6}/);
  await expect(page.getByText("Tiny terminal launcher")).toBeVisible();
  const box = await page.locator(".pair-sheet").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("a known offline computer asks to reopen Hyzr instead of pairing again", async ({ page }) => {
  await createTestAccount(page);
  await page.route("**/api/setup", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      hosted: true,
      agentConnected: false,
      ready: false,
      agent: {
        host: "My PC",
        platform: "win32",
        version: "1.1.1",
        node: "v24",
        claude: true,
        codex: true,
        git: true,
        gh: true,
        engine: "claude+codex",
        workspaceRoot: "C:\\Users\\developer\\Hyzr",
      },
    }),
  }));
  await page.goto("/");
  await page.locator("button.top-download").click();
  await expect(page.getByText("My PC is offline")).toBeVisible();
  await expect(page.getByText("Reopen Hyzr on your computer")).toBeVisible();
  await expect(page.getByText(/there is no code to enter again/i)).toBeVisible();
  await expect(page.locator(".pair-code")).toHaveCount(0);
});

test("opening and closing settings preserves the desktop sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await createTestAccount(page);
  await page.goto("/");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).not.toHaveClass(/collapsed/);
  await page.locator(".side-account").click();
  await expect(page.locator(".settings-modal")).toBeVisible();
  await expect(sidebar).not.toHaveClass(/collapsed/);
  const aboutMark = page.getByRole("button", { name: /About Hyzr Chat/ }).locator(".hyzr-mark");
  const markBox = await aboutMark.boundingBox();
  expect(markBox).not.toBeNull();
  expect(markBox!.width).toBeLessThanOrEqual(18);
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.locator(".settings-modal")).toHaveCount(0);
  await expect(sidebar).not.toHaveClass(/collapsed/);
});

test("Preview starts a project dev server even before an HTML build exists", async ({ page }) => {
  await createTestAccount(page);
  const agent = {
    host: "Preview PC",
    platform: "win32",
    version: "1.1.1",
    node: "v24",
    claude: true,
    codex: true,
    git: true,
    gh: true,
    engine: "claude+codex",
    workspaceRoot: "C:\\Users\\developer\\Hyzr",
  };
  await page.route("**/api/setup", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ hosted: true, agentConnected: true, ready: true, agent }),
  }));
  await page.route("**/api/agent/enqueue", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, jobId: "preview-run" }),
  }));
  await page.route("**/api/agent/events**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ events: [{ type: "done" }], cursor: 1 }),
  }));
  await page.route("**/api/followups", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ followups: [] }),
  }));
  await page.route("**/api/workspace**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ files: [{ name: "package.json", path: "package.json", type: "file", size: 180 }], entry: null, count: 1 }),
  }));
  await page.route("**/api/preview-server", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ url: "/preview/_dev/preview-project/", localPort: 5173, proxied: true }),
  }));
  await page.goto("/");
  await page.locator(".composer-modes").getByRole("button", { name: "Agent" }).click();
  await page.locator("textarea").fill("Create a Next.js portfolio");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("iframe.preview-frame")).toHaveAttribute("src", /\/preview\/_dev\/preview-project\/\?n=/);
});

test("evaluation lab runs free audits and gates paid comparisons", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=proof");
  await expect(page.getByText("Continuous routing evidence")).toBeVisible();
  await page.getByRole("button", { name: /Run free audit/i }).click();
  await expect(page.locator(".proof-evaluation-list article").first()).toContainText("Routing audit");
  await expect(page.locator(".proof-evaluation-list article").first()).toContainText("16/16", { timeout: 10_000 });
  await page.getByRole("button", { name: /Run live comparison/i }).click();
  await expect(page.getByText("Confirm paid paired evaluation")).toBeVisible();
  await expect(page.getByText(/120,000 measured tokens/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and run" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
