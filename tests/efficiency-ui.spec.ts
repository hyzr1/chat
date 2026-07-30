import { expect, test } from "@playwright/test";

async function createTestAccount(page: import("@playwright/test").Page) {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const response = await page.request.post("/api/auth/signup", {
    data: { email: `browser-${nonce}@example.test`, password: `hyzr-browser-${nonce}` },
  });
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
