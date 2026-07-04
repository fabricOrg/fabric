import { expect, test } from "@playwright/test";

function moneyValue(label: string): number {
  const normalized = label.replace(/[^\d.-]/g, "");
  return Number.parseFloat(normalized);
}

test("development customer sends and sees a delivered, charged message", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("overview-desktop.png"),
    fullPage: true,
  });

  const walletLink = page.getByRole("link", { name: /GHS/ }).first();
  const before = moneyValue(await walletLink.innerText());

  await page.goto("/send");
  await page
    .getByRole("textbox", { name: "To", exact: true })
    .fill("+233200000001");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill(`Browser verification ${Date.now().toString()}`);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Message sent", { exact: true })).toBeVisible();

  await page.goto("/messages");
  await expect(
    page.getByText("Delivered", { exact: true }).first(),
  ).toBeVisible();

  await page.goto("/wallet");
  const after = moneyValue(
    await page.getByRole("link", { name: /GHS/ }).first().innerText(),
  );
  expect(before - after).toBeCloseTo(0.03, 2);
  await expect(page.getByText("SMS charge").first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("overview-mobile.png"),
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
});
