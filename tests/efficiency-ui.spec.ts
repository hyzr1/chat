import { expect, test } from "@playwright/test";

async function createTestAccount(page: import("@playwright/test").Page) {
  const credentials = {
    email: `hyzr-playwright-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    password: "hyzr-playwright-password",
  };
  const response = await page.request.post("/api/auth/signup", { data: credentials });
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
  await expect(page.locator(".primary-nav").getByRole("button", { name: /^(Tasks|Proof|Projects)$/ })).toHaveCount(0);
  for (const destination of ["Work intake", "Library"]) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("button", { name: new RegExp(`^${destination}$`) }).click();
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

test("terminal device approval is clear and mobile-safe", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/agent/device/approve?code=ABCD-EFGH", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      code: "ABCD-EFGH",
      status: "pending",
      account: { email: "developer@example.test" },
      agent: {
        host: "Developer PC", platform: "win32", version: "1.2.0",
        workspaceRoot: "C:\\Users\\developer\\Hyzr",
        claude: true, codex: true, git: true, gh: true,
      },
    }),
  }));
  await page.goto("/pair/device?code=ABCD-EFGH");
  await expect(page.getByRole("heading", { name: "Connect this computer" })).toBeVisible();
  const codeInput = page.getByLabel("Pairing code");
  await expect(codeInput).toBeVisible();
  expect(await codeInput.inputValue()).toBe("ABCD-EFGH");
  await expect(page.getByRole("button", { name: "Connect Developer PC" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("terminal device approval is centered and uses the canonical mark", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/agent/device/approve?code=ABCD-EFGH", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      code: "ABCD-EFGH",
      status: "pending",
      account: { email: "developer@example.test" },
      agent: {
        host: "Developer PC", platform: "win32", version: "1.2.3",
        workspaceRoot: "C:\\Users\\developer\\Hyzr",
        claude: true, codex: true, git: true, gh: true,
      },
    }),
  }));
  await page.goto("/pair/device?code=ABCD-EFGH");
  const cardBox = await page.locator(".device-pair-card").boundingBox();
  expect(cardBox).not.toBeNull();
  expect(Math.abs(cardBox!.x + cardBox!.width / 2 - 720)).toBeLessThanOrEqual(1);
  await expect(page.locator(".device-pair-brand .hyzr-mark img")).toHaveAttribute("src", "/hyzr-chat-mark.svg?v=3");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /hyzr-chat-mark\.svg\?v=3/);
});

test("hosted computer setup is a compact self-pairing terminal download", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createTestAccount(page);
  await page.route("**/api/setup", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ hosted: true, platform: "", agentConnected: false, agent: null, ready: false }),
  }));
  await page.goto("/");
  await page.locator(".composer-modes").getByRole("button", { name: "Agent" }).click();
  await expect(page.locator(".pair-cta-download")).toHaveAttribute("href", "/api/agent/download?platform=windows");
  await expect(page.locator(".pair-cta-download")).toContainText("Download");
  await page.locator("button.agent-presence").click();
  await expect(page.getByRole("heading", { name: "Connect your computer" })).toBeVisible();
  const download = page.locator(".pair-download");
  await expect(download).toContainText(/Download hyzr/);
  await expect(download).toHaveAttribute("href", /\/api\/agent\/download\?platform=/);
  await expect(page.getByText("Tiny terminal launcher")).toBeVisible();
  await expect(page.getByText("Open the tiny launcher")).toBeVisible();
  await expect(page.getByText(/shows a secure one-time code/i)).toBeVisible();
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
  await page.locator(".composer-modes").getByRole("button", { name: "Agent" }).click();
  await expect(page.locator(".pair-cta-download")).toHaveAttribute("href", "/api/agent/download?platform=windows");
  const suggestionsBox = await page.locator(".suggestions").boundingBox();
  const offlineBox = await page.locator(".pair-cta.known-offline").boundingBox();
  expect(suggestionsBox).not.toBeNull();
  expect(offlineBox).not.toBeNull();
  expect(offlineBox!.y - (suggestionsBox!.y + suggestionsBox!.height)).toBeGreaterThanOrEqual(40);
  await page.locator("button.agent-presence").click();
  await expect(page.getByText("My PC is offline")).toBeVisible();
  await expect(page.getByText("Reopen Hyzr on your computer")).toBeVisible();
  await expect(page.getByText(/every launch creates a fresh one-time code/i)).toBeVisible();
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

test("compact model controls are theme-safe and expose visual effort", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await createTestAccount(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /^Code$/ })).toHaveCount(0);
  const chatComposerBox = await page.locator(".center .composer").boundingBox();
  await page.locator(".composer-modes").getByRole("button", { name: "Agent" }).click();
  await page.waitForTimeout(280);
  const agentComposerBox = await page.locator(".center .composer").boundingBox();
  expect(chatComposerBox).not.toBeNull();
  expect(agentComposerBox).not.toBeNull();
  expect(Math.abs(agentComposerBox!.y - chatComposerBox!.y)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("heading", { name: "What should we build?" })).toBeVisible();
  await expect(page.getByText("PC is ready", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Claude and Codex can work directly", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Choose model" }).click();
  await expect(page.locator(".simple-model-menu")).toBeVisible();
  await expect(page.locator(".simple-model-menu .m-blurb, .simple-model-menu .primary-model-copy")).toHaveCount(0);
  const openAiMark = page.locator(".simple-model-menu .brand-openai").first();
  await expect(openAiMark).toBeVisible();
  await page.locator("html").evaluate((element) => element.setAttribute("data-theme", "light"));
  expect(await openAiMark.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(32, 33, 36)");
  await page.getByRole("button", { name: "More models" }).hover();
  await expect(page.locator(".simple-model-submenu")).toBeVisible();
  const modelSubmenuBox = await page.locator(".simple-model-submenu").boundingBox();
  expect(modelSubmenuBox).not.toBeNull();
  expect(modelSubmenuBox!.y).toBeGreaterThanOrEqual(8);
  expect(modelSubmenuBox!.y + modelSubmenuBox!.height).toBeLessThanOrEqual(892);
  await page.mouse.move(24, 220);
  await expect(page.locator(".simple-model-submenu")).toHaveCount(0);
  await page.getByRole("button", { name: "Choose model" }).click();
  await page.getByRole("button", { name: /Reasoning effort:/ }).click();
  await expect(page.locator(".effort-help")).toHaveCount(0);
  const effortSlider = page.getByRole("slider", { name: "Reasoning effort" });
  await expect(effortSlider).toBeVisible();
  await effortSlider.fill("4");
  await expect(page.locator(".effort-menu-head strong")).toHaveText("Max");
  await page.keyboard.press("Escape");
  await page.locator(".attach-picker .round-btn").click();
  await page.getByRole("button", { name: "Connectors" }).hover();
  await expect(page.locator(".plus-submenu").getByRole("button", { name: "GitHub" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Work intake" }).click();
  await expect(page.locator(".intake-source-tabs").getByRole("button", { name: "GitHub" }).locator("svg")).toBeVisible();
});

test("Preview starts a project dev server even before an HTML build exists", async ({ page }) => {
  await createTestAccount(page);
  const agent = {
    host: "Preview PC",
    platform: "win32",
    version: "1.1.2",
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
  let modelJobs = 0;
  await page.route("**/api/agent/enqueue", (route) => {
    modelJobs += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, jobId: "preview-run" }),
    });
  });
  await page.route("**/api/agent/events**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      events: [{ type: "text", text: modelJobs > 1 ? "Started the dev server." : "Created the project." }, { type: "done" }],
      cursor: 2,
    }),
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
    body: JSON.stringify({
      url: "http://localhost:5173",
      localUrl: "http://localhost:5173",
      lanUrl: "http://192.168.1.44:5173",
      localPort: 5173,
      proxied: false,
    }),
  }));
  await page.route("http://localhost:5173/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><h1>Local preview</h1>",
  }));
  await page.goto("/");
  await page.locator(".composer-modes").getByRole("button", { name: "Agent" }).click();
  await page.locator("textarea").fill("Create a Next.js portfolio");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("iframe.preview-frame")).toHaveAttribute("src", /^http:\/\/localhost:5173\/?\?n=/);
  await page.getByRole("button", { name: "Toggle project files" }).click();
  await expect(page.locator(".file-browser")).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand all" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Collapse all" })).toHaveCount(0);
  await page.locator(".file-window-actions").getByRole("button", { name: "Close" }).click();
  await page.locator(".preview-actions").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".preview-path")).toHaveText("http://localhost:5173");
  const pageCount = page.context().pages().length;
  await page.locator(".preview-actions").getByRole("button", { name: "Close" }).click();
  await page.locator("textarea").fill("can you put it on a dev server");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Started the dev server.")).toBeVisible();
  await expect(page.locator("iframe.preview-frame")).toBeVisible();
  expect(modelJobs).toBe(2);
  expect(page.context().pages()).toHaveLength(pageCount);
});

test("a compound build and dev-server prompt reaches the coding agent", async ({ page }) => {
  await createTestAccount(page);
  const agent = {
    host: "Build PC",
    platform: "win32",
    version: "1.1.3",
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
  let submittedPrompt = "";
  const actions: string[] = [];
  await page.route("**/api/agent/enqueue", async (route) => {
    actions.push("enqueue");
    submittedPrompt = (await route.request().postDataJSON()).job.prompt;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, jobId: "compound-build-run" }),
    });
  });
  await page.route("**/api/agent/events**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      events: [{ type: "text", text: "Created the Hello World project and started its dev server." }, { type: "done" }],
      cursor: 2,
    }),
  }));
  await page.route("**/api/preview-server", (route) => {
    actions.push("preview");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ error: "not ready" }),
    });
  });
  await page.route("**/api/workspace**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ files: [], entry: null, count: 0 }),
  }));
  await page.goto("/");
  await page.locator(".composer-modes").getByRole("button", { name: "Agent" }).click();
  const prompt = "make a hello world and put it on a dev server";
  await page.locator("textarea").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Created the Hello World project and started its dev server.")).toBeVisible();
  expect(submittedPrompt).toBe(prompt);
  expect(actions[0]).toBe("enqueue");
  await expect(page.getByText(/couldn't find a previewable app/i)).toHaveCount(0);
});

test("Agent send waits for a known computer to reconnect and continues automatically", async ({ page }) => {
  await createTestAccount(page);
  let sending = false;
  let sendSetupCalls = 0;
  await page.route("**/api/setup", async (route) => {
    if (sending) sendSetupCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 700));
    const connected = sending && sendSetupCalls >= 2;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hosted: true,
        agentConnected: connected,
        ready: connected,
        agent: {
          host: "My PC",
          platform: "win32",
          version: "1.1.3",
          node: "v24",
          claude: true,
          codex: true,
          git: true,
          gh: true,
          engine: "claude+codex",
        },
      }),
    });
  });
  let enqueued = 0;
  await page.route("**/api/agent/enqueue", (route) => {
    enqueued += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, jobId: "reconnected-run" }),
    });
  });
  await page.route("**/api/agent/events**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ events: [{ type: "text", text: "The page is improved." }, { type: "done" }], cursor: 2 }),
  }));
  await page.route("**/api/workspace**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ files: [], entry: null, count: 0 }),
  }));
  await page.goto("/");
  await page.locator(".composer-modes").getByRole("button", { name: "Agent" }).click();
  await page.locator("textarea").fill("Improve the page");
  sending = true;
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/Waiting for.*My PC/i)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("The page is improved.")).toBeVisible({ timeout: 10_000 });
  expect(enqueued).toBe(1);
  await expect(page.getByText(/Analyzing your request/i)).toHaveCount(0);
});

test("Agent conversations stay in Agent history and restore their workspace surface", async ({ page }) => {
  await createTestAccount(page);
  const title = `Inspect repository code ${Date.now()}`;
  const agent = {
    host: "History PC",
    platform: "win32",
    version: "1.1.3",
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
    body: JSON.stringify({ ok: true, jobId: "history-run" }),
  }));
  await page.route("**/api/agent/events**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ events: [{ type: "text", text: "Repository inspected." }, { type: "done" }], cursor: 2 }),
  }));
  await page.route("**/api/workspace**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ files: [], entry: null, count: 0 }),
  }));
  await page.goto("/");
  await page.locator(".workmode-toggle").getByRole("tab", { name: "Agent" }).click();
  await page.locator("textarea").fill(title);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Repository inspected.")).toBeVisible();
  const agentUrl = page.url();
  await expect(page.getByRole("button", { name: title })).toBeVisible();
  await page.waitForTimeout(800);

  await page.locator(".workmode-toggle").getByRole("tab", { name: "Home" }).click();
  await expect(page.getByRole("button", { name: title })).toHaveCount(0);
  await page.goto(agentUrl);
  await expect(page.locator(".workmode-toggle").getByRole("tab", { name: "Agent" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".top-context")).toContainText("Project workspace");
  await expect(page.locator(".top-context")).not.toContainText("Free model");
});

test("mobile preview renders beside chat and targets the computer's Wi-Fi server", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createTestAccount(page);
  const agent = {
    host: "Preview PC",
    platform: "win32",
    version: "1.1.2",
    node: "v24",
    claude: true,
    codex: true,
    git: true,
    gh: true,
    engine: "claude+codex",
  };
  await page.route("**/api/setup", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ hosted: true, agentConnected: true, ready: true, agent }),
  }));
  await page.route("**/api/agent/enqueue", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, jobId: "mobile-preview" }),
  }));
  await page.route("**/api/agent/events**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ events: [{ type: "done" }], cursor: 1 }),
  }));
  await page.route("**/api/workspace**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ files: [{ name: "index.html", path: "index.html", type: "file", size: 100 }], entry: "index.html", count: 1 }),
  }));
  await page.route("**/api/preview-server", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      url: "http://localhost:43120",
      localUrl: "http://localhost:43120",
      lanUrl: "http://192.168.1.44:43120",
      localPort: 43120,
      proxied: false,
    }),
  }));
  await page.goto("/");
  await page.locator(".composer-modes").getByRole("button", { name: "Agent" }).click();
  await page.locator("textarea").fill("Create a static portfolio");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("iframe.preview-frame")).toHaveAttribute("src", /^http:\/\/192\.168\.1\.44:43120\/?\?n=/);
  await expect(page.locator(".preview-path")).toHaveText("http://192.168.1.44:43120");
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
