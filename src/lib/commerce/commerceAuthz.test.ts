import { describe, expect, it } from "vitest";
import { resolveCommerceRoleFlags } from "../../../supabase/functions/_shared/commerceAuthz.ts";

describe("commerce authz policy", () => {
  it("allows financial admin operations only for admin role", () => {
    const adminFlags = resolveCommerceRoleFlags("admin");
    const editorFlags = resolveCommerceRoleFlags("editor");
    const unknownFlags = resolveCommerceRoleFlags("client");

    expect(adminFlags.isAdmin).toBe(true);
    expect(adminFlags.canManageFinancialAdmin).toBe(true);

    expect(editorFlags.isAdmin).toBe(false);
    expect(editorFlags.isEditor).toBe(true);
    expect(editorFlags.canManageFinancialAdmin).toBe(false);

    expect(unknownFlags.isAdmin).toBe(false);
    expect(unknownFlags.isEditor).toBe(false);
    expect(unknownFlags.canManageFinancialAdmin).toBe(false);
  });

  it("normalizes role values before authorization checks", () => {
    const flags = resolveCommerceRoleFlags("  AdMiN ");
    expect(flags.role).toBe("admin");
    expect(flags.isAdmin).toBe(true);
    expect(flags.canManageFinancialAdmin).toBe(true);
  });
});
