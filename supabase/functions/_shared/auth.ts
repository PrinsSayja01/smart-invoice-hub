import { corsHeaders } from "./cors.ts";

export async function requireSupabaseUser(req: Request) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      ok: false,
      res: new Response(JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY in function secrets" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      res: new Response(JSON.stringify({ error: "Missing/invalid Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  // ✅ Manual token verification (bypasses gateway "Invalid JWT")
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: authHeader,
    },
  });

  if (!r.ok) {
    const t = await r.text();
    return {
      ok: false,
      res: new Response(JSON.stringify({ error: "Invalid Supabase session token", details: t }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  const user = await r.json();
  return { ok: true, user };
}
