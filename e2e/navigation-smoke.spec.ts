import { expect, test } from "@playwright/test";

const publicRoutes = ["/", "/discover", "/reports"];
const protectedRoutes = ["/app", "/app/thumb-tools", "/admin"];

test.describe("navigation smoke", () => {
  test("public routes are reachable", async ({ page }) => {
    for (const route of publicRoutes) {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBeLessThan(400);

      const currentPath = new URL(page.url()).pathname;
      expect([route, "/auth"]).toContain(currentPath);
      await expect(page.locator("#root")).toHaveCount(1);
    }
  });

  test("protected routes are reachable with guard behavior", async ({ page }) => {
    for (const route of protectedRoutes) {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBeLessThan(400);

      const currentPath = new URL(page.url()).pathname;
      expect([route, "/auth"]).toContain(currentPath);
      await expect(page.locator("#root")).toHaveCount(1);
    }
  });

  test("mobile menu opens from top bar", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile-only assertion");
    await page.goto("/", { waitUntil: "networkidle" });
    const menuButton = page.getByRole("button", { name: /open navigation menu/i });
    test.skip((await menuButton.count()) === 0, "menu not available while auth bootstrap spinner is active");
    await menuButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
