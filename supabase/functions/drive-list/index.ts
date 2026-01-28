import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { requireSupabaseUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ✅ verify Supabase session manually (fixes Invalid JWT)
  const auth = await requireSupabaseUser(req);
  if (!auth.ok) return auth.res;

  try {
    const { providerToken } = await req.json();
    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const q = "mimeType='application/pdf' or mimeType contains 'image/'";

    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", q);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime)");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await r.text();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "Google Drive API failed", status: r.status, details: text }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = JSON.parse(text);
    const files = Array.isArray(json?.files) ? json.files : [];

    return new Response(JSON.stringify({ files }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
