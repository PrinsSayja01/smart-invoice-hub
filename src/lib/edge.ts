import { supabase } from "@/integrations/supabase/client";

export async function invokeEdge<T = any>(name: string, body: any): Promise<T> {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
  }

  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;

  if (!jwt) throw new Error("No Supabase session. Please login again.");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,                 // ✅ REQUIRED (your logs showed it missing)
      Authorization: `Bearer ${jwt}`,            // ✅ REQUIRED if verify_jwt=true
    },
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok) {
    const msg = json?.error || json?.message || text || `HTTP ${res.status}`;
    throw new Error(`Edge Function "${name}" failed (${res.status}): ${msg}`);
  }

  return (json ?? {}) as T;
}
