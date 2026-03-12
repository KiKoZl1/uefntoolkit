const DEVICE_SEED_STORAGE_KEY = "commerce_device_seed_v1";

let cachedHash: string | null = null;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function safeGetStorageValue(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorageValue(key: string, value: string) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    // best effort only
  }
}

function getOrCreateDeviceSeed(): string | null {
  if (typeof window === "undefined") return null;

  let seed = safeGetStorageValue(DEVICE_SEED_STORAGE_KEY);
  if (seed && seed.trim().length > 0) return seed;

  seed = crypto.randomUUID();
  safeSetStorageValue(DEVICE_SEED_STORAGE_KEY, seed);
  return seed;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function getCommerceDeviceFingerprintHash(): Promise<string | null> {
  if (cachedHash) return cachedHash;
  if (typeof window === "undefined") return null;

  const seed = getOrCreateDeviceSeed();
  if (!seed) return null;

  const language = String(navigator.language || "").trim().toLowerCase();
  const userAgent = String(navigator.userAgent || "").trim().toLowerCase();
  const platform = String(navigator.platform || "").trim().toLowerCase();
  const timezone = String(Intl.DateTimeFormat().resolvedOptions().timeZone || "").trim().toLowerCase();

  const payload = [seed, language, userAgent, platform, timezone].join("|");
  const hash = await sha256Hex(payload);
  cachedHash = hash;
  return hash;
}

