import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function requireUser(req: Request) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { user: null, error: new Error("Missing Authorization Bearer token") };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    return { user: null, error: new Error("Invalid JWT") };
  }

  return { user: data.user, error: null };
}
