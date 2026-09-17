"use client";

import { useEffect, useState } from "react";

export interface SessionUser {
  id: string;
  email: string;
  full_name: string | null;
  tier: "viewer" | "admin";
}

export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) setUser(json.user ?? null);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  return {
    user,
    email: user?.email ?? null,
    tier: user?.tier ?? null,
    loading,
    logout,
  };
}
