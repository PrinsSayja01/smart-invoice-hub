import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export function useAuthAndDriveToken() {
  const [userId, setUserId] = useState<string | null>(null);
  const [providerToken, setProviderToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);

      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error) {
        console.error("getSession error:", error);
        setUserId(null);
        setProviderToken(null);
        setLoading(false);
        return;
      }

      const session = data?.session ?? null;
      setUserId(session?.user?.id ?? null);

      // provider_token may exist in different places depending on provider
      const pt =
        (session as any)?.provider_token ||
        (session?.user?.identities?.[0] as any)?.identity_data?.provider_token ||
        null;

      setProviderToken(pt);
      setLoading(false);
    }

    load();

    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { userId, providerToken, loading };
}
