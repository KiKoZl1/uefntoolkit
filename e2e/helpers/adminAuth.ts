import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import { loadLocalEnv, mustEnv } from "./env";

export async function ensurePerfAdminAndLogin(page: Page, baseURL: string) {
  const env = loadLocalEnv();
  const appUrl = mustEnv(env, "VITE_SUPABASE_URL");
  const publishableKey = mustEnv(env, "VITE_SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = mustEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const perfAdminEmail = String(env.PERF_ADMIN_EMAIL || "perf-admin@epic-insight.local").trim();
  const perfAdminPassword = String(env.PERF_ADMIN_PASSWORD || "PerfAdmin#2026!").trim();

  const service = createClient(appUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const usersPage = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersPage.error) throw usersPage.error;

  let userId = usersPage.data.users.find((u) => u.email?.toLowerCase() === perfAdminEmail.toLowerCase())?.id;
  if (!userId) {
    const created = await service.auth.admin.createUser({
      email: perfAdminEmail,
      password: perfAdminPassword,
      email_confirm: true,
      user_metadata: { display_name: "Perf Admin" },
    });
    if (created.error) throw created.error;
    userId = created.data.user?.id || "";
  } else {
    const updated = await service.auth.admin.updateUserById(userId, {
      password: perfAdminPassword,
      email_confirm: true,
      user_metadata: { display_name: "Perf Admin" },
    });
    if (updated.error) throw updated.error;
  }

  const roleUpsert = await service
    .from("user_roles")
    .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
  if (roleUpsert.error && roleUpsert.error.code !== "23505") throw roleUpsert.error;

  const anon = createClient(appUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await anon.auth.signInWithPassword({ email: perfAdminEmail, password: perfAdminPassword });
  if (signIn.error) throw signIn.error;

  await page.goto(`${baseURL}/auth`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.fill("#email", perfAdminEmail);
  await page.fill("#password", perfAdminPassword);
  await page.click("button[type='submit']");
  await page.waitForURL("**/app", { timeout: 60_000 });

  // Wait for role hydration to complete; otherwise admin routes may redirect to /app.
  let adminReady = false;
  for (let i = 0; i < 8; i += 1) {
    await page.goto(`${baseURL}/admin`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(600);
    const finalPath = await page.evaluate(() => new URL(window.location.href).pathname);
    if (finalPath.startsWith("/admin")) {
      adminReady = true;
      break;
    }
    await page.goto(`${baseURL}/app`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(400);
  }
  if (!adminReady) {
    throw new Error("Admin role not active in frontend session (still redirected from /admin to /app)");
  }

  return {
    email: perfAdminEmail,
    userId,
    accessToken: signIn.data.session?.access_token || "",
  };
}
