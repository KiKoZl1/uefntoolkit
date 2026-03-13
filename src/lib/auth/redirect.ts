import { BRAND_CANONICAL_URL } from "@/config/brand";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function getAuthRedirectBaseUrl(): string {
  if (typeof window === "undefined") return trimTrailingSlash(BRAND_CANONICAL_URL);

  const currentUrl = new URL(window.location.href);
  if (isLocalHost(currentUrl.hostname)) return trimTrailingSlash(window.location.origin);

  return trimTrailingSlash(BRAND_CANONICAL_URL);
}

export function getAuthRedirectUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getAuthRedirectBaseUrl()}${normalizedPath}`;
}
