// supabase/functions/drive-list/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const providerToken = body?.providerToken;

    if (!providerToken) {
      return new Response(JSON.stringify({ error: "Missing providerToken" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Search ALL user Drive, not just root.
    const q =
      `(mimeType='application/pdf' or mimeType contains 'image/') and trashed=false`;

    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", q);
    url.searchParams.set("pageSize", "50");
    url.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime)");
    url.searchParams.set("orderBy", "modifiedTime desc");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    const text = await r.text();
    if (!r.ok) {
      return new Response(
        JSON.stringify({
          error: "Google Drive API failed",
          status: r.status,
          details: text,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const json = JSON.parse(text);
    return new Response(JSON.stringify({ files: json.files || [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
