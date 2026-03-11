import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AppRole = "admin" | "editor" | "client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  role: AppRole | null;
  isAdmin: boolean;
  isEditor: boolean;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const ROLE_CACHE_TTL_MS = 5 * 60 * 1000;
const ROLE_STORAGE_PREFIX = "epic_role_cache_v1:";

function readStoredRole(userId: string): { role: AppRole; fetchedAt: number } | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(`${ROLE_STORAGE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { role?: string; fetchedAt?: number };
    const role = parsed?.role as AppRole | undefined;
    const fetchedAt = Number(parsed?.fetchedAt || 0);
    if (!role || !["admin", "editor", "client"].includes(role)) return null;
    if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return null;
    if (Date.now() - fetchedAt > ROLE_CACHE_TTL_MS) return null;
    return { role, fetchedAt };
  } catch {
    return null;
  }
}

function writeStoredRole(userId: string, role: AppRole, fetchedAt: number) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${ROLE_STORAGE_PREFIX}${userId}`, JSON.stringify({ role, fetchedAt }));
  } catch {
    // best effort only
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<AppRole | null>(null);

  const roleRef = useRef<AppRole | null>(null);
  const roleCacheRef = useRef<Map<string, { role: AppRole; fetchedAt: number }>>(new Map());
  const roleRequestRef = useRef<Map<string, Promise<AppRole>>>(new Map());
  const resolvedRoleUserRef = useRef<string | null>(null);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  const fetchRole = async (userId: string): Promise<AppRole> => {
    const now = Date.now();
    const cached = roleCacheRef.current.get(userId);
    if (cached && now - cached.fetchedAt <= ROLE_CACHE_TTL_MS && cached.role !== "client") {
      return cached.role;
    }
    const stored = readStoredRole(userId);
    if (stored && stored.role !== "client") {
      roleCacheRef.current.set(userId, stored);
      return stored.role;
    }

    const inFlight = roleRequestRef.current.get(userId);
    if (inFlight) return inFlight;

    const request = (async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .limit(1)
        .single();

      const nextRole = error ? "client" : ((data?.role as AppRole) || "client");
      const fetchedAt = Date.now();
      roleCacheRef.current.set(userId, { role: nextRole, fetchedAt });
      writeStoredRole(userId, nextRole, fetchedAt);
      return nextRole;
    })();

    roleRequestRef.current.set(userId, request);
    try {
      return await request;
    } finally {
      roleRequestRef.current.delete(userId);
    }
  };

  const hydrateRole = async (nextUser: User | null) => {
    if (!nextUser) {
      resolvedRoleUserRef.current = null;
      setRole(null);
      setLoading(false);
      return;
    }

    const roleCache = roleCacheRef.current.get(nextUser.id);
    const roleCacheFresh = Boolean(roleCache && Date.now() - roleCache.fetchedAt <= ROLE_CACHE_TTL_MS);
    if (
      resolvedRoleUserRef.current === nextUser.id &&
      roleRef.current != null &&
      roleRef.current !== "client" &&
      roleCacheFresh
    ) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const nextRole = await fetchRole(nextUser.id);
    resolvedRoleUserRef.current = nextUser.id;
    setRole(nextRole);
    setLoading(false);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUser = nextSession?.user ?? null;
      setSession(nextSession);
      setUser(nextUser);

      queueMicrotask(() => {
        hydrateRole(nextUser).catch(() => {
          setRole("client");
          setLoading(false);
        });
      });
    });

    supabase.auth.getSession().then(async ({ data: { session: nextSession } }) => {
      const nextUser = nextSession?.user ?? null;
      setSession(nextSession);
      setUser(nextUser);
      try {
        await hydrateRole(nextUser);
      } catch {
        setRole("client");
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, displayName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { display_name: displayName },
      },
    });
    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    if (user?.id && typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(`${ROLE_STORAGE_PREFIX}${user.id}`);
      } catch {
        // ignore
      }
    }
    resolvedRoleUserRef.current = null;
    await supabase.auth.signOut();
  };

  const isAdmin = role === "admin";
  const isEditor = role === "editor" || role === "admin";

  return (
    <AuthContext.Provider value={{ session, user, loading, role, isAdmin, isEditor, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
