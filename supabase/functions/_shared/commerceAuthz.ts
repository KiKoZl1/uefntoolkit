export type CommerceRoleFlags = {
  role: string;
  isAdmin: boolean;
  isEditor: boolean;
  canManageFinancialAdmin: boolean;
};

function normalizeRole(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function resolveCommerceRoleFlags(roleValue: unknown): CommerceRoleFlags {
  const role = normalizeRole(roleValue);
  const isAdmin = role === "admin";
  const isEditor = role === "editor";

  return {
    role,
    isAdmin,
    isEditor,
    canManageFinancialAdmin: isAdmin,
  };
}
