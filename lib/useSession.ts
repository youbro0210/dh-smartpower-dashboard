"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

const AUTH_ENABLED = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function useSession() {
  const [email, setEmail] = useState<string | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [loading, setLoading] = useState(AUTH_ENABLED);

  useEffect(() => {
    if (!AUTH_ENABLED) return;
    let mounted = true;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted) return;
      setEmail(user?.email ?? null);
      if (user) {
        const { data } = await supabase.from("profiles").select("tier").eq("id", user.id).single();
        if (mounted) setTier(data?.tier ?? "viewer");
      }
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return { email, tier, loading, authEnabled: AUTH_ENABLED, logout };
}
